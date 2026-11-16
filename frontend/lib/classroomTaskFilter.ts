export const MANUAL_DONE_STATE = "MANUAL_DONE";

export interface PersonalSubmission {
  state: string;
  grade?: number | null;
  maxPoints?: number | null;
  isManualOnly?: boolean;
}

export function isCompletedTaskState(state?: string | null): boolean {
  return state === "TURNED_IN" || state === "RETURNED" || state === MANUAL_DONE_STATE;
}

/**
 * Extracts a stable Classroom task identifier (`courseId_courseWorkId`) or clean URL key.
 */
export function extractClassroomTaskKey(url?: string | null): string | null {
  if (!url) return null;
  const m = url.match(/\/c\/([^\/\?#]+)\/a\/([^\/\?#]+)/i);
  if (m) {
    return `${m[1]}_${m[2]}`;
  }
  return url.split("?")[0].split("#")[0].replace(/\/details\/?$/i, "").replace(/\/+$/, "");
}

export function resolveManualTaskIdentities(target: {
  url?: string | null;
  id?: string | null;
}): string[] {
  const keys = new Set<string>();
  const fromUrl = extractClassroomTaskKey(target.url);
  if (fromUrl) keys.add(fromUrl);
  const cleanUrl = typeof target.url === "string" ? target.url.trim() : "";
  if (cleanUrl) keys.add(cleanUrl);
  const cleanId = typeof target.id === "string" ? target.id.trim() : "";
  if (cleanId) keys.add(cleanId);
  return Array.from(keys);
}

export function parseManualDoneList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    for (const item of parsed) {
      if (typeof item === "string" && item.trim().length > 0) {
        seen.add(item.trim());
      }
    }
    return Array.from(seen);
  } catch {
    return [];
  }
}

export function applyManualDoneOverlay(
  base: Record<string, PersonalSubmission>,
  manualKeys: readonly string[]
): Record<string, PersonalSubmission> {
  if (!manualKeys || manualKeys.length === 0) return base;
  const manualSet = new Set(manualKeys);
  const next: Record<string, PersonalSubmission> = { ...base };

  for (const [k, sub] of Object.entries(next)) {
    if (!sub || sub.state === "TURNED_IN" || sub.state === "RETURNED") continue;
    const extracted = extractClassroomTaskKey(k);
    if (manualSet.has(k) || (extracted && manualSet.has(extracted))) {
      next[k] = { ...sub, state: MANUAL_DONE_STATE };
    }
  }

  for (const mk of Array.from(manualSet)) {
    if (!next[mk]) {
      next[mk] = { state: MANUAL_DONE_STATE, isManualOnly: true };
    }
  }

  return next;
}

/**
 * Determines whether a task belongs to the currently linked student when personal submissions exist.
 */
export function isOwnTask(
  isLinked: boolean,
  submissions: Record<string, PersonalSubmission>,
  url: string | null | undefined,
  _taskTeacher?: string | null,
  _personalTeachers?: string[],
  _taskTitle?: string | null,
  _explicitSubgroup?: number | null
): boolean {
  if (!isLinked) return true;

  const hasSubmissions = Object.values(submissions).some((s) => Boolean(s && !s.isManualOnly));
  if (hasSubmissions && url) {
    const key = extractClassroomTaskKey(url);
    const sub = submissions[url] || (key ? submissions[key] : null);
    const isMyTask = Boolean(sub && !sub.isManualOnly);
    if (!isMyTask) {
      return false;
    }
  }

  return true;
}
