/**
 * Location-agnostic YYYY-MM-DD calendar date primitives.
 *
 * Uses UTC noon (`12:00:00Z`) internally when delegating calendar overflow
 * arithmetic to Date.UTC so browser local timezone and DST transitions never
 * shift calendar days, month boundaries, or weekday indices.
 */

export interface CalendarDateParts {
  year: number;
  /** 1-based month (1..12) */
  month: number;
  /** 1-based day of month (1..31) */
  day: number;
}

export interface CalendarGridCell {
  dayNum: number;
  dateIso: string;
  isCurrentMonth: boolean;
  /** 0 = Monday .. 6 = Sunday */
  weekdayMon0: number;
  isWeekend: boolean;
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

/**
 * Parses a strict YYYY-MM-DD string into numeric calendar components.
 * Returns null for malformed or impossible calendar dates (e.g. 2026-02-30).
 */
export function parseCalendarDateIso(iso: string | null | undefined): CalendarDateParts | null {
  if (!iso) return null;
  const trimmed = iso.trim();
  const match = ISO_DATE_RE.exec(trimmed);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const probe = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

/**
 * Formats calendar components into YYYY-MM-DD, normalizing overflow/underflow
 * (such as day=0 or day=32) via UTC noon rather than browser-local time.
 */
export function formatCalendarDateParts(
  year: number,
  monthIndex0: number,
  day: number
): string {
  const utc = new Date(Date.UTC(year, monthIndex0, day, 12, 0, 0));
  const y = String(utc.getUTCFullYear()).padStart(4, "0");
  const m = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const d = String(utc.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Converts a YYYY-MM-DD calendar date to a UTC noon Date instant (`12:00:00Z`),
 * which lands on the same calendar date in Europe/Kyiv as well as Asia/Tokyo
 * and America/New_York.
 */
export function calendarDateIsoToUtcDate(iso: string): Date {
  const parts = parseCalendarDateIso(iso);
  if (!parts) {
    return new Date(iso);
  }
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12, 0, 0));
}

/** Adds whole calendar days to a YYYY-MM-DD string without local DST drift. */
export function addDaysToCalendarIso(iso: string, deltaDays: number): string {
  const parts = parseCalendarDateIso(iso);
  if (!parts) return iso;
  return formatCalendarDateParts(parts.year, parts.month - 1, parts.day + deltaDays);
}

/** Returns total calendar days in the given 0-indexed month. */
export function getDaysInCalendarMonth(year: number, monthIndex0: number): number {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0, 12, 0, 0)).getUTCDate();
}

/** Returns 0 = Monday .. 6 = Sunday for a YYYY-MM-DD calendar date. */
export function getCalendarWeekdayMon0(iso: string): number {
  const parts = parseCalendarDateIso(iso);
  if (!parts) return 0;
  const utcDay = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12, 0, 0)).getUTCDay();
  return (utcDay + 6) % 7;
}

/** Returns 0 = Sunday .. 6 = Saturday for a YYYY-MM-DD calendar date. */
export function getCalendarWeekdaySun0(iso: string): number {
  const parts = parseCalendarDateIso(iso);
  if (!parts) return 0;
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12, 0, 0)).getUTCDay();
}

/** Returns the Monday (YYYY-MM-DD) of the week containing the given calendar date. */
export function getMondayCalendarIso(iso: string): string {
  const dowMon0 = getCalendarWeekdayMon0(iso);
  return addDaysToCalendarIso(iso, -dowMon0);
}

/** Returns exact signed day count (`aIso - bIso`) using UTC midnight epochs. */
export function diffCalendarDays(aIso: string, bIso: string): number {
  const a = parseCalendarDateIso(aIso);
  const b = parseCalendarDateIso(bIso);
  if (!a || !b) return 0;
  const aMs = Date.UTC(a.year, a.month - 1, a.day);
  const bMs = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round((aMs - bMs) / MS_PER_DAY);
}

/** Returns exact signed whole-week distance between the Mondays of two calendar dates. */
export function diffCalendarWeeks(targetIso: string, baseIso: string): number {
  const targetMonday = getMondayCalendarIso(targetIso);
  const baseMonday = getMondayCalendarIso(baseIso);
  return Math.round(diffCalendarDays(targetMonday, baseMonday) / 7);
}

/** Resolves initial calendar view month/year strictly from calendar ISO components. */
export function resolveCalendarMonthAnchor(
  selectedDateIso: string | null | undefined,
  fallbackTodayIso: string
): { year: number; monthIndex0: number } {
  const parsed = parseCalendarDateIso(selectedDateIso) ?? parseCalendarDateIso(fallbackTodayIso);
  if (!parsed) {
    const now = new Date();
    return { year: now.getUTCFullYear(), monthIndex0: now.getUTCMonth() };
  }
  return { year: parsed.year, monthIndex0: parsed.month - 1 };
}

export function canNavigateCalendarPrevMonth(
  viewYear: number,
  viewMonthIndex0: number,
  minDateIso: string | null | undefined
): boolean {
  if (!minDateIso) return true;
  const prevMonthEndIso = formatCalendarDateParts(viewYear, viewMonthIndex0, 0);
  return prevMonthEndIso >= minDateIso;
}

export function canNavigateCalendarNextMonth(
  viewYear: number,
  viewMonthIndex0: number,
  maxDateIso: string | null | undefined
): boolean {
  if (!maxDateIso) return true;
  const nextMonthStartIso = formatCalendarDateParts(viewYear, viewMonthIndex0 + 1, 1);
  return nextMonthStartIso <= maxDateIso;
}

/**
 * Generates the fixed 42-cell (6x7 Mon..Sun) calendar grid purely from calendar components.
 * Cell dateIso values and weekday flags are identical regardless of browser timezone.
 */
export function buildCalendarMonthGrid(
  viewYear: number,
  viewMonthIndex0: number
): CalendarGridCell[] {
  const firstOfMonthIso = formatCalendarDateParts(viewYear, viewMonthIndex0, 1);
  const firstWeekday = getCalendarWeekdayMon0(firstOfMonthIso);
  const totalDays = getDaysInCalendarMonth(viewYear, viewMonthIndex0);
  const cells: CalendarGridCell[] = [];

  for (let i = -firstWeekday; i < 42 - firstWeekday; i++) {
    const dateIso = formatCalendarDateParts(viewYear, viewMonthIndex0, 1 + i);
    const weekdayMon0 = cells.length % 7;
    cells.push({
      dayNum: Number(dateIso.slice(8, 10)),
      dateIso,
      isCurrentMonth: i >= 0 && i < totalDays,
      weekdayMon0,
      isWeekend: weekdayMon0 >= 5,
    });
  }

  return cells;
}
