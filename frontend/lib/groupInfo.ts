import type { ReferenceRecord } from "./api";

/**
 * Визначає курс навчання (1–4) за номером або назвою групи коледжу ДФКР.
 */
export function getGroupCourse(groupName: string): number | null {
  if (!groupName) return null;
  const match = groupName.match(/\b(\d{2})\b/);
  if (!match) return null;
  const num = parseInt(match[1], 10);
  if (num >= 75 && num <= 80) return 4;
  if (num >= 81 && num <= 86) return 3;
  if (num >= 87 && num <= 91) return 2;
  if (num >= 92 && num <= 99) return 1;
  return null;
}

/**
 * Визначає рік вступу групи за її номером.
 */
export function getGroupAdmissionYear(groupName: string): number | null {
  const course = getGroupCourse(groupName);
  if (course === 4) return 2023;
  if (course === 3) return 2024;
  if (course === 2) return 2025;
  if (course === 1) return 2026;
  return null;
}

/**
 * Отримує коротку абревіатуру спеціальності за кодом відділення (faculty_id).
 */
export function getFacultyAbbreviation(facultyId?: number | null): string {
  switch (facultyId) {
    case 15:
      return "КІ"; // Комп'ютерна інженерія (123)
    case 14:
      return "КБ"; // Інжиніринг кіберсистем (125)
    case 13:
      return "РТ"; // Електронні комунікації та радіотехніка (172)
    case 12:
      return "ЕТ"; // Електроніка (171)
    case 11:
      return "МС"; // Інженерія та захист мережевих систем (125/172)
    default:
      return "ГР";
  }
}

/**
 * Отримує офіційну назву спеціальності за факультетом.
 */
export function getGroupSpecialtyName(facultyId?: number | null): string {
  switch (facultyId) {
    case 15:
      return "123 Комп'ютерна інженерія";
    case 14:
      return "125 Кібербезпека та захист інформації";
    case 13:
      return "172 Електронні комунікації та радіотехніка";
    case 12:
      return "171 Електроніка";
    case 11:
      return "125 Інженерія мережевих систем";
    default:
      return "Фаховий молодший бакалавр ДФКР";
  }
}

/**
 * Формує повний офіційний академічний шифр групи (наприклад, "КІ-24-1/9-85" для групи 85).
 */
export function getGroupFullCode(group: { name: string; faculty_id?: number | null }): string {
  const name = group.name.trim();
  const numMatch = name.match(/\b(\d{2})\b/);
  if (!numMatch) return name;

  const num = parseInt(numMatch[1], 10);
  const prefix = getFacultyAbbreviation(group.faculty_id);
  const admissionYear = getGroupAdmissionYear(name);
  const yy = admissionYear ? String(admissionYear).slice(-2) : "24";

  // Відомі точні академічні шифри для базових груп ДФКР
  const KNOWN_CODES: Record<number, string> = {
    85: "КІ-24-1/9-85",
    86: "КІ-24-2/9-86",
    83: "РТ-24-1/9-83",
    84: "РТ-24-2/9-84",
    81: "ЕТ-24-1/9-81",
    82: "ЕТ-24-2/9-82",
    79: "КІ-23-1/9-79",
    80: "КІ-23-2/9-80",
    90: "КІ-25-1/9-90",
    91: "КІ-25-2/9-91",
    97: "КІ-26-1/9-97",
    98: "КІ-26-2/9-98",
  };

  if (KNOWN_CODES[num]) {
    return KNOWN_CODES[num];
  }

  // Генерація за схемою: [Абревіатура]-[РікВступу]-1/9-[НомерГрупи]
  return `${prefix}-${yy}-1/9-${num}`;
}
