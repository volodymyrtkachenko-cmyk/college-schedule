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
 * Splits merged periods strictly into semester 1 or semester 2 without duplicating
 * boundary-spanning periods in both buckets.
 */
export function partitionSemesterPeriods<T extends MergedPeriod>(
  periods: T[],
  semesters?: EducationalProcessSemesterRange[] | null,
  weeks?: EducationalProcessWeekInfo[] | null
): { semester1: T[]; semester2: T[] } {
  const sem1 = semesters?.find((s) => s.semester_number === 1);
  const sem2 = semesters?.find((s) => s.semester_number === 2);

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
