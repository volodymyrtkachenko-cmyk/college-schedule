import { formatTeacherName } from "./format";

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
