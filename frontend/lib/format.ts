export function formatTeacherName(value: string): string {
  const name = value.trim();
  if (!name || name.includes(".")) return name;

  const parts = name.split(/\s+/);
  if (parts.length < 2) return name;
  if (parts.some((part) => part.length <= 2)) return name;

  const surname = parts[0];
  const initials = parts
    .slice(1)
    .map((part) => part[0]?.toUpperCase())
    .filter(Boolean)
    .join(".");
  return `${surname} ${initials}.`;
}

export function formatLessonCount(count: number): string {
  const remainder10 = count % 10;
  const remainder100 = count % 100;
  const noun = remainder10 >= 2 && remainder10 <= 4 && (remainder100 < 12 || remainder100 > 14)
    ? "заняття"
    : remainder10 === 1 && remainder100 !== 11
      ? "заняття"
      : "занять";
  return `${count} ${noun}`;
}
