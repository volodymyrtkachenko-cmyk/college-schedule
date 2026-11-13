import { useMemo } from "react";
import { FullTaskItem } from "../components/TaskCardItem";
import { getMondayOf, formatShortWeekRange, isSubjectMatch, normalizeSubjectName } from "./format";
import { getTaskPublishedTimestamp } from "./lesson-card";
import { KYIV_DATE_FMT } from "./date";

export interface SubjectChipItem {
  name: string;
  count: number;
}

export interface TaskGroupsResult {
  pastWeekTasks: FullTaskItem[];
  overdueTasks: FullTaskItem[];
  activeTasks: FullTaskItem[];
  noDateTasks: FullTaskItem[];
  turnedInTasks: FullTaskItem[];
  totalCount: number;
  activeCount: number;
  pendingCount: number;
  overdueTotalCount: number;
  doneCount: number;
  isOnlyTurnedIn: boolean;
  weekLabel: string;
  subjects: SubjectChipItem[];
}

export interface TaskFilterState {
  status: "all" | "pending" | "overdue" | "done";
  subject: string;
}

export const DEFAULT_TASK_FILTERS: TaskFilterState = { status: "all", subject: "" };

export function formatTaskWord(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "завдання";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "завдання";
  return "завдань";
}

export function useTaskGroups(
  tasks: FullTaskItem[],
  _scope: "week" | "all" = "all",
  weekAnchorDate?: Date,
  weekNumber?: number | null,
  isLinked: boolean = false,
  filters: TaskFilterState = DEFAULT_TASK_FILTERS
): TaskGroupsResult {
  const currentWeekMonday = useMemo(() => {
    return getMondayOf(weekAnchorDate || new Date());
  }, [weekAnchorDate]);

  const weekLabel = useMemo(() => {
    return formatShortWeekRange(currentWeekMonday, weekNumber);
  }, [currentWeekMonday, weekNumber]);

  return useMemo(() => {
    const subjectMap = new Map<string, number>();
    let pendingCount = 0;
    let overdueTotalCount = 0;
    let doneCount = 0;

    for (const t of tasks) {
      const isDone = isLinked && (t.state === "TURNED_IN" || t.state === "RETURNED");
      const isOverdue = !isDone && Boolean(t.deadline.isOverdue);

      const matchesSubject = !filters.subject || isSubjectMatch(t.subject, filters.subject);
      if (matchesSubject) {
        if (isDone) doneCount++;
        else if (isOverdue) overdueTotalCount++;
        else pendingCount++;
      }

      const matchesCurrentTab =
        filters.status === "done"
          ? isDone
          : filters.status === "overdue"
          ? isOverdue
          : filters.status === "pending"
          ? !isDone && !isOverdue
          : !isDone;

      if (matchesCurrentTab) {
        const cleanSubj = normalizeSubjectName(t.subject) || "Дисципліна";
        subjectMap.set(cleanSubj, (subjectMap.get(cleanSubj) || 0) + 1);
      }
    }

    const subjects: SubjectChipItem[] = Array.from(subjectMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "uk"));

    const subjectFiltered = tasks.filter((t) => {
      if (filters.subject && !isSubjectMatch(t.subject, filters.subject)) return false;
      return true;
    });

    const overdueTasks: FullTaskItem[] = [];
    const activeTasks: FullTaskItem[] = [];
    const noDateTasks: FullTaskItem[] = [];
    const turnedInTasks: FullTaskItem[] = [];

    for (const t of subjectFiltered) {
      const isDone = isLinked && (t.state === "TURNED_IN" || t.state === "RETURNED");
      let dueIso = t.dueDateIso;
      if (!dueIso && t.deadline.date) {
        dueIso = KYIV_DATE_FMT.format(t.deadline.date);
      }

      if (isDone) {
        turnedInTasks.push(t);
      } else if (t.deadline.isOverdue) {
        overdueTasks.push(t);
      } else if (dueIso) {
        activeTasks.push(t);
      } else {
        noDateTasks.push(t);
      }
    }

    // Сортуємо вкладку «Здано» та «Без терміну» від найновіших до найстаріших за датою публікації
    turnedInTasks.sort((a, b) => getTaskPublishedTimestamp(b) - getTaskPublishedTimestamp(a));
    noDateTasks.sort((a, b) => getTaskPublishedTimestamp(b) - getTaskPublishedTimestamp(a));

    const activeCount = overdueTasks.length + activeTasks.length + noDateTasks.length;
    const isOnlyTurnedIn = activeCount === 0 && turnedInTasks.length > 0;
    const totalCount = activeCount + turnedInTasks.length;

    return {
      pastWeekTasks: [],
      overdueTasks,
      activeTasks,
      noDateTasks,
      turnedInTasks,
      totalCount,
      activeCount,
      pendingCount,
      overdueTotalCount,
      doneCount,
      isOnlyTurnedIn,
      weekLabel,
      subjects,
    };
  }, [tasks, filters.status, filters.subject, isLinked, weekLabel]);
}
