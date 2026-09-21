export function getMondayOf(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - (day || 7) + 1);
  d.setHours(12, 0, 0, 0);
  return d;
}
