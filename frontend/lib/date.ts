export function getMondayOf(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - (day || 7) + 1);
  d.setHours(12, 0, 0, 0);
  return d;
}

export const KYIV_DATE_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" });
export const KYIV_TIME_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Kyiv",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
export const UKR_WEEKDAY_LONG_FMT = new Intl.DateTimeFormat("uk-UA", { weekday: "long" });
export const UKR_DAY_MONTH_SHORT_FMT = new Intl.DateTimeFormat("uk-UA", { day: "numeric", month: "short" });
export const UKR_DAY_MONTH_LONG_FMT = new Intl.DateTimeFormat("uk-UA", { day: "numeric", month: "long" });
export const UKR_FULL_DATE_FMT = new Intl.DateTimeFormat("uk-UA", { day: "numeric", month: "long", year: "numeric" });
export const UKR_MONTH_SHORT_FMT = new Intl.DateTimeFormat("uk-UA", { month: "short" });

export function formatKyivDateIso(date: Date = new Date()): string {
  return KYIV_DATE_FMT.format(date);
}

export function formatKyivTime(date: Date = new Date()): string {
  return KYIV_TIME_FMT.format(date);
}
