import {
  addDaysToCalendarIso,
  calendarDateIsoToUtcDate,
  getCalendarWeekdayMon0,
  getMondayCalendarIso,
} from "./calendarDate";

export let serverTimeOffsetMs = 0;

export function updateServerTimeOffset(dateHeader: string | null | undefined): void {
  if (!dateHeader) return;
  const serverMs = Date.parse(dateHeader);
  if (Number.isNaN(serverMs)) return;
  const diff = serverMs - Date.now();
  serverTimeOffsetMs = Math.abs(diff) > 60_000 ? diff : 0;
}

export function getSyncedNow(): Date {
  return new Date(Date.now() + serverTimeOffsetMs);
}

/**
 * Returns the Monday anchor (at 12:00 UTC) of the Kyiv calendar week containing `date`.
 * Uses Europe/Kyiv + UTC noon instead of browser-local Date components so Tokyo/NY/DST never drift.
 */
export function getMondayOf(date: Date): Date {
  const iso = formatKyivDateIso(date);
  return calendarDateIsoToUtcDate(getMondayCalendarIso(iso));
}

export const KYIV_DATE_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" });
export const KYIV_TIME_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Kyiv",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
export const UKR_WEEKDAY_LONG_FMT = new Intl.DateTimeFormat("uk-UA", {
  timeZone: "Europe/Kyiv",
  weekday: "long",
});
export const UKR_DAY_MONTH_SHORT_FMT = new Intl.DateTimeFormat("uk-UA", {
  timeZone: "Europe/Kyiv",
  day: "numeric",
  month: "short",
});
export const UKR_DAY_MONTH_LONG_FMT = new Intl.DateTimeFormat("uk-UA", {
  timeZone: "Europe/Kyiv",
  day: "numeric",
  month: "long",
});
export const UKR_FULL_DATE_FMT = new Intl.DateTimeFormat("uk-UA", {
  timeZone: "Europe/Kyiv",
  day: "numeric",
  month: "long",
  year: "numeric",
});
export const UKR_UTC_FULL_DATE_FMT = new Intl.DateTimeFormat("uk-UA", {
  timeZone: "UTC",
  day: "numeric",
  month: "long",
  year: "numeric",
});
export const UKR_MONTH_SHORT_FMT = new Intl.DateTimeFormat("uk-UA", {
  timeZone: "Europe/Kyiv",
  month: "short",
});

export function formatKyivDateIso(date: Date = getSyncedNow()): string {
  return KYIV_DATE_FMT.format(date);
}

export function formatKyivTime(date: Date = getSyncedNow()): string {
  return KYIV_TIME_FMT.format(date);
}

export function getKyivTomorrowDateIso(date: Date = getSyncedNow()): string {
  return addDaysToCalendarIso(formatKyivDateIso(date), 1);
}

export function getKyivInitialWeekAnchor(date: Date = getSyncedNow()): Date {
  const iso = formatKyivDateIso(date);
  const dowMon0 = getCalendarWeekdayMon0(iso);
  // Weekend jumps forward to next week's Monday; Mon-Fri resolves to this week's Monday.
  const effectiveIso = dowMon0 >= 5 ? addDaysToCalendarIso(iso, 7 - dowMon0) : iso;
  return calendarDateIsoToUtcDate(getMondayCalendarIso(effectiveIso));
}

export function getKyivMaxPublicDateIso(date: Date = getSyncedNow()): string {
  const anchorIso = formatKyivDateIso(getKyivInitialWeekAnchor(date));
  return addDaysToCalendarIso(anchorIso, 13);
}
