import type {
  EducationalProcessCellInfo,
  EducationalProcessSemesterRange,
  EducationalProcessWeekInfo,
} from "./api/types";

export const MS_PER_DAY = 86_400_000;

export interface MergedPeriod {
  start_date: string;
  end_date: string;
  start_week: number;
  end_week: number;
  weeks_count: number;
  period_type: string;
  name: string | null;
}

/** Parses YYYY-MM-DD as UTC midnight milliseconds to avoid local timezone drift. */
export function parseUtcMidnightMs(dateStr: string): number {
  return Date.parse(`${dateStr}T00:00:00Z`);
}

/** Merges contiguous week cells of the same period_type and name into spans. */
export function mergeProcessCells(
  cells: EducationalProcessCellInfo[],
  weeks: EducationalProcessWeekInfo[]
): MergedPeriod[] {
  if (!cells.length || !weeks.length) return [];

  const weekMap = new Map<number, EducationalProcessWeekInfo>();
  for (const w of weeks) {
    weekMap.set(w.week_number, w);
  }

  const sortedCells = [...cells].sort((a, b) => a.week_number - b.week_number);
  const merged: MergedPeriod[] = [];
  let current: MergedPeriod | null = null;

  for (const cell of sortedCells) {
    const week = weekMap.get(cell.week_number);
    if (!week) continue;

    const normalizedName = cell.name ?? null;
    if (
      current &&
      current.period_type === cell.period_type &&
      current.name === normalizedName &&
      cell.week_number === current.end_week + 1
    ) {
      current.end_date = week.end_date;
      current.end_week = cell.week_number;
      current.weeks_count += 1;
    } else {
      if (current) merged.push(current);
      current = {
        start_date: week.start_date,
        end_date: week.end_date,
        start_week: cell.week_number,
        end_week: cell.week_number,
        weeks_count: 1,
        period_type: cell.period_type,
        name: normalizedName,
      };
    }
  }

  if (current) {
    merged.push(current);
  }

  return merged;
}

/**
 * Resolves consistent semester 1 and semester 2 ranges for the active academic year,
 * ignoring off-year or chronologically inverted semester 2 entries.
 */
export function resolveValidSemesters(
  semesters?: EducationalProcessSemesterRange[] | null,
  weeks?: EducationalProcessWeekInfo[] | null
): {
  sem1: EducationalProcessSemesterRange | undefined;
  sem2: EducationalProcessSemesterRange | undefined;
} {
  const yearStartDate = weeks?.[0]?.start_date;
  const sem1Raw = semesters?.find((s) => s.semester_number === 1);
  const sem1 =
    sem1Raw && (!yearStartDate || sem1Raw.end_date >= yearStartDate)
      ? sem1Raw
      : undefined;
  const sem2Raw = semesters?.find((s) => s.semester_number === 2);
  const sem2Valid =
    sem2Raw &&
    (!yearStartDate || sem2Raw.end_date >= yearStartDate) &&
    (!sem1?.start_date || sem2Raw.start_date > sem1.start_date);
  return {
    sem1,
    sem2: sem2Valid ? sem2Raw : undefined,
  };
}

/**
 * Splits merged periods strictly into semester 1 or semester 2 without duplicating
 * boundary-spanning periods in both buckets.
 */
export function partitionSemesterPeriods<T extends MergedPeriod>(
  periods: T[],
  semesters?: EducationalProcessSemesterRange[] | null,
  weeks?: EducationalProcessWeekInfo[] | null
): { semester1: T[]; semester2: T[] } {
  const { sem1, sem2 } = resolveValidSemesters(semesters, weeks);

  const week22StartDate = weeks?.find((w) => w.week_number === 22)?.start_date;
  const boundaryMs = sem2?.start_date
    ? parseUtcMidnightMs(sem2.start_date)
    : sem1?.end_date
    ? parseUtcMidnightMs(sem1.end_date) + MS_PER_DAY
    : week22StartDate
    ? parseUtcMidnightMs(week22StartDate)
    : null;
  const fallbackSem2StartWeek = sem2?.start_week ?? Math.max((sem1?.end_week ?? 21) + 1, 22);

  const semester1: T[] = [];
  const semester2: T[] = [];

  for (const period of periods) {
    let belongsToSem2 = false;

    if (boundaryMs !== null && !Number.isNaN(boundaryMs)) {
      const startMs = parseUtcMidnightMs(period.start_date);
      const endExclusiveMs = parseUtcMidnightMs(period.end_date) + MS_PER_DAY;
      if (startMs >= boundaryMs) {
        belongsToSem2 = true;
      } else if (endExclusiveMs > boundaryMs) {
        const daysInSem1 = boundaryMs - startMs;
        const daysInSem2 = endExclusiveMs - boundaryMs;
        belongsToSem2 = daysInSem2 > daysInSem1;
      }
    } else {
      belongsToSem2 = period.start_week >= fallbackSem2StartWeek;
    }

    if (belongsToSem2) {
      semester2.push(period);
    } else {
      semester1.push(period);
    }
  }

  return { semester1, semester2 };
}

const SUMMARY_ORDER = [
  "theory",
  "practice",
  "session",
  "diploma",
  "attestation",
  "holiday",
] as const;

export interface ProcessTypeSummary {
  period_type: string;
  weeks_count: number;
  spans_count: number;
}

/** Aggregates total week and span counts per period type for fast year-at-a-glance scanning. */
export function summarizeProcessPeriods(periods: MergedPeriod[]): ProcessTypeSummary[] {
  const totals = new Map<string, ProcessTypeSummary>();
  for (const period of periods) {
    const existing = totals.get(period.period_type);
    if (existing) {
      existing.weeks_count += period.weeks_count;
      existing.spans_count += 1;
    } else {
      totals.set(period.period_type, {
        period_type: period.period_type,
        weeks_count: period.weeks_count,
        spans_count: 1,
      });
    }
  }

  const ordered: ProcessTypeSummary[] = [];
  for (const type of SUMMARY_ORDER) {
    const entry = totals.get(type);
    if (entry && entry.weeks_count > 0) {
      ordered.push(entry);
      totals.delete(type);
    }
  }
  totals.forEach((entry) => {
    if (entry.weeks_count > 0) ordered.push(entry);
  });
  return ordered;
}

/** Selects the matching Ukrainian plural form for an integer count. */
export function pluralizeUk(count: number, [one, few, many]: [string, string, string]): string {
  const abs = Math.abs(count);
  const mod100 = abs % 100;
  const mod10 = abs % 10;
  if (mod100 >= 11 && mod100 <= 14) return `${count} ${many}`;
  if (mod10 === 1) return `${count} ${one}`;
  if (mod10 >= 2 && mod10 <= 4) return `${count} ${few}`;
  return `${count} ${many}`;
}
