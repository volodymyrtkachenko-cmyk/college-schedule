export function formatTeacherName(value: string): string {
  const name = value.trim();
  if (!name || name.includes(".")) return name;

  const parts = name.split(/\s+/);
  if (parts.length < 2) return name;
  if (parts.some((part) => part.length <= 2)) return name;

  const surname = parts[parts.length - 1];
  const initials = parts
    .slice(0, -1)
    .map((part) => part[0]?.toUpperCase())
    .filter(Boolean)
    .join(".");
  return `${surname} ${initials}.`;
}
