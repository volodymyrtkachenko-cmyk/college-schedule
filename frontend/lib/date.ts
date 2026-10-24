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

export function getKyivTomorrowDateIso(date: Date = new Date()): string {
  const iso = formatKyivDateIso(date);
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1, 12, 0, 0));
  return dt.toISOString().slice(0, 10);
}

export function getKyivInitialWeekAnchor(date: Date = new Date()): Date {
  const iso = formatKyivDateIso(date);
  const [y, m, d] = iso.split("-").map(Number);
  const kyivMidday = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const day = kyivMidday.getUTCDay();
  if (day === 0 || day === 6) {
    kyivMidday.setUTCDate(kyivMidday.getUTCDate() + (day === 0 ? 1 : 2));
  }
  const adjustedDay = kyivMidday.getUTCDay();
  kyivMidday.setUTCDate(kyivMidday.getUTCDate() - (adjustedDay || 7) + 1);
  return new Date(kyivMidday.getUTCFullYear(), kyivMidday.getUTCMonth(), kyivMidday.getUTCDate(), 12, 0, 0);
}
