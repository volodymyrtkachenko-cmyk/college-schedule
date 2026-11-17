import type {
  StatisticsEntry,
  StatisticsResponse,
  TeacherGroupDetail,
  TeacherSubjectEntry,
} from "./api/types";

export type StudentSortMode = "hours" | "progress" | "name";
export type StudentFilterMode = "all" | "planned" | "unplanned" | "changes";
export type TeacherSortMode = "hours" | "name";

/**
 * Formats academic hours into pairs (1 pair = 2 academic hours),
 * preserving .5 for odd weekly hours (e.g. 19 hours/week -> "9.5").
 */
export function formatPairsFromHours(hours: number): string {
  const pairs = hours / 2;
  if (Number.isInteger(pairs)) return String(pairs);
  return pairs.toFixed(1).replace(/\.0$/, "");
}

/**
 * If semester_start is the Monday of the Sept 1 week (YYYY-08-31),
 * returns YYYY-09-01 for display so users see September 1 as the academic start.
 */
export function normalizeDisplaySemesterStart(isoDate: string): string {
  if (/^\d{4}-08-31$/.test(isoDate)) {
    return `${isoDate.slice(0, 4)}-09-01`;
  }
  return isoDate;
}

export interface StudentStatsSummary {
  totalCompletedHours: number;
  plannedTotalHours: number;
  plannedCompletedHours: number;
  unplannedCompletedHours: number;
  planCompletionPercent: number | null;
  remainingPlannedHours: number;
  overPlanHours: number;
  totalReplacedCount: number;
  totalCancelledCount: number;
  plannedSubjectsCount: number;
  unplannedSubjectsCount: number;
  completedSubjectsCount: number;
  changesSubjectsCount: number;
}

/**
 * Computes accurate student plan breakdown without letting unplanned subjects
 * artificially inflate curriculum completion percentage.
 */
export function summarizeStudentStatistics(stats: StatisticsResponse): StudentStatsSummary {
  const entries = stats.entries ?? [];
  let plannedCompletedHours = 0;
  let unplannedCompletedHours = 0;
  let remainingPlannedHours = 0;
  let overPlanHours = 0;
  let totalReplacedCount = 0;
  let totalCancelledCount = 0;
  let plannedSubjectsCount = 0;
  let unplannedSubjectsCount = 0;
  let completedSubjectsCount = 0;
  let changesSubjectsCount = 0;

  for (const entry of entries) {
    const planned = entry.planned_hours ?? 0;
    const completed = entry.completed_hours ?? 0;
    const replaced = entry.replaced_count ?? 0;
    const cancelled = entry.cancelled_count ?? 0;

    totalReplacedCount += replaced;
    totalCancelledCount += cancelled;
    if (replaced > 0 || cancelled > 0) {
      changesSubjectsCount += 1;
    }

    if (planned > 0) {
      plannedSubjectsCount += 1;
      plannedCompletedHours += completed;
      if (completed >= planned) {
        completedSubjectsCount += 1;
        overPlanHours += completed - planned;
      } else {
        remainingPlannedHours += planned - completed;
      }
    } else if (completed > 0) {
      unplannedSubjectsCount += 1;
      unplannedCompletedHours += completed;
    }
  }

  const plannedTotalHours = stats.planned_hours ?? 0;
  const effectiveCompletedForPlan =
    plannedSubjectsCount > 0 ? plannedCompletedHours : stats.total_hours;
  const planCompletionPercent =
    plannedTotalHours > 0
      ? Math.round((effectiveCompletedForPlan / plannedTotalHours) * 100)
      : null;

  return {
    totalCompletedHours: stats.total_hours,
    plannedTotalHours,
    plannedCompletedHours,
    unplannedCompletedHours,
    planCompletionPercent,
    remainingPlannedHours:
      plannedTotalHours > 0
        ? remainingPlannedHours > 0
          ? remainingPlannedHours
          : Math.max(0, plannedTotalHours - effectiveCompletedHoursFallback(effectiveCompletedForPlan))
        : 0,
    overPlanHours,
    totalReplacedCount,
    totalCancelledCount,
    plannedSubjectsCount,
    unplannedSubjectsCount,
    completedSubjectsCount,
    changesSubjectsCount,
  };
}

function effectiveCompletedHoursFallback(val: number): number {
  return Math.max(0, val);
}

export interface TeacherPlanStatus {
  hasPlan: boolean;
  isPartialPlan: boolean;
  plannedHours: number;
  completionPercent: number | null;
  remainingHours: number;
}

/**
 * Evaluates teacher semester plan reliability.
 * Detects partial curriculum coverage (e.g. when only 1 of 11 groups has curriculum rows,
 * causing planned_hours=34 while total_hours=340).
 */
export function evaluateTeacherPlanStatus(
  totalHours: number,
  plannedHours: number | null | undefined,
  subjects?: TeacherSubjectEntry[] | null
): TeacherPlanStatus {
  if (!plannedHours || plannedHours <= 0) {
    return {
      hasPlan: false,
      isPartialPlan: false,
      plannedHours: 0,
      completionPercent: null,
      remainingHours: 0,
    };
  }

  const subjs = subjects ?? [];
  const hasUnplannedActiveSubjects = subjs.some(
    (s) => s.completed_hours > 0 && !(s.planned_hours && s.planned_hours > 0)
  );
  const isSeverelyUnderPlanned = totalHours > plannedHours * 1.35;
  const isPartialPlan = isSeverelyUnderPlanned || (hasUnplannedActiveSubjects && totalHours > plannedHours);

  const completionPercent = Math.round((totalHours / plannedHours) * 100);
  const remainingHours = Math.max(0, plannedHours - totalHours);

  return {
    hasPlan: true,
    isPartialPlan,
    plannedHours,
    completionPercent,
    remainingHours,
  };
}

export function filterAndSortStudentEntries(
  entries: StatisticsEntry[],
  filter: StudentFilterMode,
  sort: StudentSortMode,
  searchQuery = ""
): StatisticsEntry[] {
  const query = searchQuery.trim().toLowerCase();
  const filtered = entries.filter((entry) => {
    if (query && !entry.name.toLowerCase().includes(query)) return false;
    if (filter === "planned") return (entry.planned_hours ?? 0) > 0;
    if (filter === "unplanned") return !(entry.planned_hours && entry.planned_hours > 0);
    if (filter === "changes") {
      return Boolean(entry.replaced_count || entry.cancelled_count);
    }
    return true;
  });

  return [...filtered].sort((a, b) => {
    if (sort === "name") {
      return a.name.localeCompare(b.name, "uk-UA");
    }
    if (sort === "progress") {
      const progA =
        a.planned_hours && a.planned_hours > 0
          ? (a.completed_hours / a.planned_hours) * 100
          : -1;
      const progB =
        b.planned_hours && b.planned_hours > 0
          ? (b.completed_hours / b.planned_hours) * 100
          : -1;
      if (progB !== progA) return progB - progA;
    }
    if (b.completed_hours !== a.completed_hours) {
      return b.completed_hours - a.completed_hours;
    }
    return a.name.localeCompare(b.name, "uk-UA");
  });
}

export function sortTeacherItems<T extends TeacherSubjectEntry | TeacherGroupDetail>(
  items: T[],
  sort: TeacherSortMode,
  searchQuery = ""
): T[] {
  const query = searchQuery.trim().toLowerCase();
  const filtered = query
    ? items.filter((item) => {
        if (item.name.toLowerCase().includes(query)) return true;
        if ("groups" in item && item.groups.some((g) => g.toLowerCase().includes(query))) {
          return true;
        }
        if (
          "subject_names" in item &&
          item.subject_names.some((s) => s.toLowerCase().includes(query))
        ) {
          return true;
        }
        return false;
      })
    : items;

  return [...filtered].sort((a, b) => {
    if (sort === "name") {
      return a.name.localeCompare(b.name, "uk-UA", { numeric: true });
    }
    if (b.completed_hours !== a.completed_hours) {
      return b.completed_hours - a.completed_hours;
    }
    return a.name.localeCompare(b.name, "uk-UA", { numeric: true });
  });
}
