import type { ReferenceRecord } from "./api";

const UKRAINIAN_TRANSLIT: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "h",
  ґ: "g",
  д: "d",
  е: "e",
  є: "ye",
  ж: "zh",
  з: "z",
  и: "y",
  і: "i",
  ї: "yi",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "kh",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "shch",
  ю: "yu",
  я: "ya",
  ь: "",
  "’": "",
  "'": "",
  "`": "",
};

/**
 * Перетворює ім'я викладача (наприклад, "Кондратов О.В.") у валідний URL-slug ("kondratov-ov").
 */
export function toTeacherSlug(name: string): string {
  if (!name) return "";
  const lower = name.toLowerCase().trim();
  const out: string[] = [];

  for (let i = 0; i < lower.length; i++) {
    const char = lower[i];
    if (char in UKRAINIAN_TRANSLIT) {
      out.push(UKRAINIAN_TRANSLIT[char]);
    } else if (/[a-z0-9]/.test(char)) {
      out.push(char);
    } else if (/[\s.,_\-—–/]/.test(char)) {
      out.push("-");
    }
  }

  const slug = out
    .join("")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return slug || "teacher";
}

/**
 * Знаходить викладача зі списку за його URL-slug або ID.
 */
export function findTeacherBySlug(
  teachers: ReferenceRecord[],
  slug: string
): ReferenceRecord | null {
  if (!slug || !teachers || teachers.length === 0) return null;

  const normalized = decodeURIComponent(slug).toLowerCase().trim();

  // 1. Пошук за числовим ID, якщо передано ID замість слага
  if (/^\d+$/.test(normalized)) {
    const id = Number(normalized);
    const foundById = teachers.find((t) => t.id === id);
    if (foundById) return foundById;
  }

  // 2. Точний збіг за транслітерованим слагом
  const foundBySlug = teachers.find((t) => toTeacherSlug(t.name) === normalized);
  if (foundBySlug) return foundBySlug;

  // 3. Збіг без дефісів (на випадок kondratovov замість kondratov-ov)
  const compactTarget = normalized.replace(/-/g, "");
  const foundCompact = teachers.find(
    (t) => toTeacherSlug(t.name).replace(/-/g, "") === compactTarget
  );
  if (foundCompact) return foundCompact;

  return null;
}
