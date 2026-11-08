import { formatTeacherName } from "./format";
import {
  getFacultyAbbreviation,
  getGroupCourse,
  getGroupFullCode,
  getGroupSpecialtyName,
} from "./groupInfo";

export interface QuickJumpTarget {
  mode: "student" | "teacher";
  id?: number;
  name?: string;
  label: string;
}

export interface SecondaryEntityItem {
  id?: number;
  name: string;
  displayName: string;
  target: QuickJumpTarget;
}

/**
 * Searches for a group ID by query name (exact, short_name, or cleaned match).
 */
export function findGroupIdByName(
  queryName: string | undefined,
  groups: Array<{ id: number; name: string; short_name?: string | null }>
): number | undefined {
  if (!queryName) return undefined;
  const clean = queryName.replace(/^(групи|група|гр\.)\s*/i, "").trim().toLowerCase();
  if (!clean) return undefined;

  // 1. Exact match by name or short_name
  const exact = groups.find((g) => {
    const gName = g.name.trim().toLowerCase();
    const gShort = g.short_name?.trim().toLowerCase();
    const gClean = gName.replace(/^(групи|група|гр\.)\s*/i, "").trim();
    return gName === clean || gShort === clean || gClean === clean;
  });
  if (exact) return exact.id;

  // 2. Partial / containment match
  const partial = groups.find((g) => {
    const gClean = g.name.trim().toLowerCase().replace(/^(групи|група|гр\.)\s*/i, "").trim();
    return gClean.includes(clean) || clean.includes(gClean);
  });
  return partial?.id;
}

/**
 * Searches for a teacher ID by query name (exact, formatted, surname + initials, or partial).
 */
export function findTeacherIdByName(
  queryName: string | undefined,
  teachers: Array<{ id: number; name: string; short_name?: string | null }>
): number | undefined {
  if (!queryName) return undefined;
  const clean = queryName.trim().toLowerCase();
  if (!clean) return undefined;

  // 1. Exact match by name
  const exact = teachers.find((t) => t.name.trim().toLowerCase() === clean);
  if (exact) return exact.id;

  // 2. Formatted teacher name match
  const formattedQuery = formatTeacherName(queryName).toLowerCase();
  const formattedMatch = teachers.find(
    (t) => formatTeacherName(t.name).toLowerCase() === formattedQuery
  );
  if (formattedMatch) return formattedMatch.id;

  // 3. Surname match (e.g. "Шевченко")
  const querySurname = clean.split(/[\s.]+/)[0];
  if (querySurname && querySurname.length >= 3) {
    const matched = teachers.filter((t) => {
      const tSurname = t.name.trim().toLowerCase().split(/[\s.]+/)[0];
      return tSurname === querySurname;
    });

    if (matched.length === 1) {
      return matched[0].id;
    }
    if (matched.length > 1) {
      const initials = clean.match(/[а-яіїєґ]/gi)?.slice(1) || [];
      if (initials.length > 0) {
        const found = matched.find((t) => {
          const tName = t.name.toLowerCase();
          return initials.every((init) => tName.includes(init));
        });
        if (found) return found.id;
      }
      return matched[0].id;
    }
  }

  // 4. Substring match
  const partial = teachers.find((t) => {
    const tName = t.name.trim().toLowerCase();
    return tName.includes(clean) || clean.includes(tName);
  });
  return partial?.id;
}

/**
 * Parses individual teachers from a lesson with their corresponding IDs or names.
 */
export function parseLessonTeachers(lesson: {
  teacher_id?: number | null;
  second_teacher_id?: number | null;
  teacher_name?: string | null;
}): SecondaryEntityItem[] {
  if (!lesson.teacher_name) return [];
  const rawParts = lesson.teacher_name
    .split(/\s*[,/]\s*/)
    .map((s) => s.trim())
    .filter(Boolean);

  return rawParts.map((raw, idx) => {
    const formatted = formatTeacherName(raw);
    const id = idx === 0 ? (lesson.teacher_id ?? undefined) : idx === 1 ? (lesson.second_teacher_id ?? undefined) : undefined;
    return {
      id,
      name: raw,
      displayName: formatted,
      target: {
        mode: "teacher",
        id,
        name: raw,
        label: formatted,
      },
    };
  });
}

/**
 * Parses individual groups from a lesson with their corresponding IDs or names.
 */
export function parseLessonGroups(lesson: {
  group_id?: number | null;
  group_name?: string | null;
}): SecondaryEntityItem[] {
  if (!lesson.group_name) return [];
  const rawParts = lesson.group_name
    .split(/\s*[,/]\s*/)
    .map((s) => s.trim())
    .filter(Boolean);

  return rawParts.map((raw, idx) => {
    const cleanName = raw.replace(/^(групи|група|гр\.)\s*/i, "").trim();
    const id = idx === 0 ? (lesson.group_id ?? undefined) : undefined;
    const nameToUse = cleanName || raw;
    return {
      id,
      name: nameToUse,
      displayName: nameToUse,
      target: {
        mode: "student",
        id,
        name: nameToUse,
        label: nameToUse,
      },
    };
  });
}

const EN_TO_UK_MAP: Record<string, string> = {
  q: "й", w: "ц", e: "у", r: "к", t: "е", y: "н", u: "г", i: "ш", o: "щ", p: "з", "[": "х", "]": "ї",
  a: "ф", s: "і", d: "в", f: "а", g: "п", h: "р", j: "о", k: "л", l: "д", ";": "ж", "'": "є",
  z: "я", x: "ч", c: "с", v: "м", b: "и", n: "т", m: "ь", ",": "б", ".": "ю", "`": "ґ",
};

const UK_TO_EN_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(EN_TO_UK_MAP).map(([en, uk]) => [uk, en])
);

export function convertEnToUkLayout(input: string): string {
  return Array.from(input.toLowerCase())
    .map((ch) => EN_TO_UK_MAP[ch] ?? ch)
    .join("");
}

export function convertUkToEnLayout(input: string): string {
  return Array.from(input.toLowerCase())
    .map((ch) => UK_TO_EN_MAP[ch] ?? ch)
    .join("");
}

function normalizeCompact(value: string): string {
  return value.toLowerCase().replace(/[\s\-/.(),'"«»`’]+/g, "");
}

export function getGroupSearchBadge(group: { name: string; faculty_id?: number | null }): string {
  const course = getGroupCourse(group.name);
  if (course) {
    return `${course} курс`;
  }
  return "";
}

export function filterAndRankEntities<
  T extends {
    id: number;
    name: string;
    short_name?: string | null;
    full_name?: string | null;
    faculty_id?: number | null;
    room?: string | null;
    course?: number | null;
  }
>(items: T[], query: string, mode: "student" | "teacher" | "groups" | "teachers" = "student"): T[] {
  const rawTrimmed = query.trim();
  if (!rawTrimmed) return items;

  const isGroupMode = mode === "student" || mode === "groups";
  const qLower = rawTrimmed.toLowerCase();
  const qUk = convertEnToUkLayout(qLower);
  const qEn = convertUkToEnLayout(qLower);
  const qTranslit = qLower
    .replace(/ki/g, "кі")
    .replace(/kb/g, "кб")
    .replace(/rt/g, "рт")
    .replace(/et/g, "ет")
    .replace(/ms/g, "мс");

  const queryVariants = Array.from(new Set([qLower, qUk, qEn, qTranslit])).filter(Boolean);
  const compactVariants = Array.from(new Set(queryVariants.map(normalizeCompact))).filter(Boolean);

  const isDigits = /^\d+$/.test(rawTrimmed);

  // Parse course intent: e.g. "1 курс", "1к", "курс 1", "3-й курс"
  const courseMatch = qLower.match(/^([1-4])\s*(?:-?[йяеі])?\s*(?:курс|к)?$/) || qLower.match(/^курс\s*([1-4])$/);
  const targetCourse = courseMatch && (qLower.includes("курс") || qLower.includes("к")) ? parseInt(courseMatch[1], 10) : null;

  // Parse prefix + group number combo: e.g. "кі-85", "кі 85", "ki85"
  const comboMatch = qLower.match(/^([а-яіїєґa-z]{2})[\s\-_/]*(\d{1,2})$/i);
  const comboAbbr = comboMatch
    ? convertEnToUkLayout(comboMatch[1])
        .replace(/ki/g, "кі")
        .replace(/kb/g, "кб")
        .replace(/rt/g, "рт")
        .replace(/et/g, "ет")
        .replace(/ms/g, "мс")
    : null;
  const comboNum = comboMatch ? comboMatch[2] : null;

  const scored: Array<{ item: T; score: number; index: number }> = [];

  items.forEach((item, index) => {
    const primaryName = (item.name || "").trim().toLowerCase();
    const primaryCompact = normalizeCompact(primaryName);
    const shortName = (item.short_name || "").trim().toLowerCase();

    let bestScore = 0;

    if (isGroupMode) {
      const cleanGroup = primaryName.replace(/^(групи|група|гр\.)\s*/i, "").trim();
      const fullCode = getGroupFullCode(item).toLowerCase();
      const fullCodeCompact = normalizeCompact(fullCode);
      const specialty = getGroupSpecialtyName(item.faculty_id).toLowerCase();
      const abbr = getFacultyAbbreviation(item.faculty_id).toLowerCase();
      const course = item.course ?? getGroupCourse(item.name);

      if (isDigits) {
        // Purely numeric query (e.g. "6", "8", "85", "123")
        // Numeric search must ONLY match the group number / name or a 3-digit specialty code.
        // It must NEVER match internal admission years or /9 in fullCode (e.g. "26" in fullCode for query "6").
        if (cleanGroup === qLower || primaryName === qLower) {
          bestScore = 100;
        } else if (cleanGroup.startsWith(qLower) || primaryName.startsWith(qLower)) {
          bestScore = 90;
        } else if (cleanGroup.endsWith(qLower)) {
          bestScore = 85;
        } else if (cleanGroup.includes(qLower) || primaryName.includes(qLower)) {
          bestScore = 80;
        } else if (qLower.length === 3 && specialty.startsWith(qLower)) {
          bestScore = 70;
        }
      } else {
        // Text / Alphanumeric / Specialty / Course query
        if (comboAbbr && comboNum && abbr === comboAbbr && cleanGroup === comboNum) {
          bestScore = Math.max(bestScore, 100);
        }

        for (const qv of queryVariants) {
          if (cleanGroup === qv || primaryName === qv || fullCode === qv || shortName === qv) {
            bestScore = Math.max(bestScore, 100);
          } else if (cleanGroup.startsWith(qv) || primaryName.startsWith(qv)) {
            bestScore = Math.max(bestScore, 90);
          } else if (cleanGroup.includes(qv) || primaryName.includes(qv)) {
            bestScore = Math.max(bestScore, 80);
          } else if (abbr === qv) {
            bestScore = Math.max(bestScore, 85);
          } else if (fullCode.startsWith(qv)) {
            bestScore = Math.max(bestScore, 85);
          } else if (targetCourse !== null && course === targetCourse) {
            bestScore = Math.max(bestScore, 75);
          } else if (qv.length >= 3 && specialty.includes(qv)) {
            bestScore = Math.max(bestScore, 60);
          }
        }

        for (const cv of compactVariants) {
          if (!cv) continue;
          if (primaryCompact === cv || fullCodeCompact === cv) {
            bestScore = Math.max(bestScore, 95);
          } else if (fullCodeCompact.startsWith(cv)) {
            bestScore = Math.max(bestScore, 85);
          }
        }
      }
    } else {
      const formatted = formatTeacherName(item.name).toLowerCase();
      const room = (item.room || "").trim().toLowerCase();
      const words = primaryName.split(/[\s.]+/).filter(Boolean);

      for (const qv of queryVariants) {
        if (primaryName === qv || formatted === qv || shortName === qv) {
          bestScore = Math.max(bestScore, 100);
        } else if (primaryName.startsWith(qv) || formatted.startsWith(qv)) {
          bestScore = Math.max(bestScore, 85);
        } else if (words.some((w) => w.startsWith(qv))) {
          bestScore = Math.max(bestScore, 75);
        } else if (primaryName.includes(qv) || formatted.includes(qv)) {
          bestScore = Math.max(bestScore, 55);
        } else if (room && (room === qv || (qv.length >= 2 && room.includes(qv)))) {
          bestScore = Math.max(bestScore, 40);
        }
      }

      for (const cv of compactVariants) {
        if (!cv) continue;
        if (primaryCompact === cv) {
          bestScore = Math.max(bestScore, 95);
        } else if (primaryCompact.startsWith(cv)) {
          bestScore = Math.max(bestScore, 80);
        } else if (primaryCompact.includes(cv)) {
          bestScore = Math.max(bestScore, 50);
        }
      }
    }

    if (bestScore > 0) {
      scored.push({ item, score: bestScore, index });
    }
  });

  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.map((entry) => entry.item);
}
