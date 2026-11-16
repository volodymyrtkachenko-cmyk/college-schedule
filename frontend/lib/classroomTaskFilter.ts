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
  if (fromUrl) {
    keys.add(fromUrl);
    const underscoreIdx = fromUrl.indexOf("_");
    if (underscoreIdx > 0 && underscoreIdx < fromUrl.length - 1) {
      keys.add(fromUrl.slice(underscoreIdx + 1));
    }
  }
  const cleanUrl = typeof target.url === "string" ? target.url.trim() : "";
  if (cleanUrl) keys.add(cleanUrl);
  const cleanId = typeof target.id === "string" ? target.id.trim() : "";
  if (cleanId) keys.add(cleanId);
  return Array.from(keys);
}

/**
 * Removes manual-done keys once Google Classroom confirms TURNED_IN or RETURNED,
 * preventing stale local flags if the user later unsubmits in Classroom.
 */
export function filterStaleManualDoneKeys(
  manualKeys: readonly string[],
  syncedTasks: ReadonlyArray<{ url?: string | null; alternate_link?: string | null; id?: string | null; state?: string | null }> | undefined
): string[] {
  if (!manualKeys || manualKeys.length === 0 || !Array.isArray(syncedTasks) || syncedTasks.length === 0) {
    return Array.from(manualKeys || []);
  }
  const completedIdentities = new Set<string>();
  for (const t of syncedTasks) {
    if (t?.state !== "TURNED_IN" && t?.state !== "RETURNED") continue;
    for (const identity of resolveManualTaskIdentities({ url: t.url || t.alternate_link, id: t.id })) {
      completedIdentities.add(identity);
    }
  }
  if (completedIdentities.size === 0) return Array.from(manualKeys);
  return manualKeys.filter((k) => !completedIdentities.has(k));
}

export const CLASSROOM_RETURN_TS_KEY = "schedule:classroom_return_ts";
export const MANUAL_DONE_STORAGE_KEY = "schedule:classroom_manual_done_tasks";

export function markPendingClassroomReturn(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(CLASSROOM_RETURN_TS_KEY, String(Date.now()));
  } catch {}
}

export function consumePendingClassroomReturn(
  minElapsedMs = 2000,
  maxAgeMs = 15 * 60 * 1000
): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = sessionStorage.getItem(CLASSROOM_RETURN_TS_KEY);
    if (!raw) return false;
    const ts = Number(raw);
    if (!Number.isFinite(ts) || ts <= 0) {
      sessionStorage.removeItem(CLASSROOM_RETURN_TS_KEY);
      return false;
    }
    const elapsed = Date.now() - ts;
    if (elapsed > maxAgeMs) {
      sessionStorage.removeItem(CLASSROOM_RETURN_TS_KEY);
      return false;
    }
    if (elapsed < minElapsedMs) {
      return false;
    }
    sessionStorage.removeItem(CLASSROOM_RETURN_TS_KEY);
    return true;
  } catch {
    return false;
  }
}

export function toggleManualDoneInStorage(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
  target: { url?: string | null; id?: string | null },
  done: boolean,
  storageKey = MANUAL_DONE_STORAGE_KEY
): boolean {
  const identities = resolveManualTaskIdentities(target);
  if (identities.length === 0) return false;
  try {
    const existing = new Set(parseManualDoneList(storage.getItem(storageKey)));
    if (done) {
      for (const k of identities) existing.add(k);
    } else {
      for (const k of identities) existing.delete(k);
    }
    const nextList = Array.from(existing);
    if (nextList.length > 0) {
      storage.setItem(storageKey, JSON.stringify(nextList));
    } else {
      storage.removeItem(storageKey);
    }
    return true;
  } catch {
    return false;
  }
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
