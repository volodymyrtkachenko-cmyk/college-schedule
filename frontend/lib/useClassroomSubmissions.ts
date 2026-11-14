"use client";

import { useEffect, useState, useCallback, useSyncExternalStore } from "react";
import { api } from "./api";
import { clearScheduleLocalStorageCache, invalidateScheduleCache } from "./hooks";

import {
  PersonalSubmission,
  extractClassroomTaskKey,
  isOwnTask,
} from "./classroomTaskFilter";
import {
  CLASSROOM_LINKED_EVENT,
  CLASSROOM_STORAGE_KEYS,
  type ClassroomUnlinkResult,
  clearClassroomUnlinkError,
  getClassroomUnlinkState,
  performClassroomUnlink,
  resetClassroomUnlinkState,
  subscribeClassroomUnlinkState,
} from "./classroomUnlink";

export type { PersonalSubmission, ClassroomUnlinkResult };
export { extractClassroomTaskKey, isOwnTask };

const LINKED_EMAIL_KEY = CLASSROOM_STORAGE_KEYS.LINKED_EMAIL;
const GOOGLE_USER_ID_KEY = CLASSROOM_STORAGE_KEYS.GOOGLE_USER_ID;
const LINKED_GROUP_ID_KEY = CLASSROOM_STORAGE_KEYS.LINKED_GROUP_ID;
const SUBMITTED_TASKS_KEY = CLASSROOM_STORAGE_KEYS.SUBMITTED_TASKS;
const PERSONAL_TEACHERS_KEY = CLASSROOM_STORAGE_KEYS.PERSONAL_TEACHERS;
const PERSONAL_SUBGROUP_KEY = CLASSROOM_STORAGE_KEYS.PERSONAL_SUBGROUP;
const ACCESS_TOKEN_KEY = CLASSROOM_STORAGE_KEYS.ACCESS_TOKEN;
const ACCESS_TOKEN_EXP_KEY = CLASSROOM_STORAGE_KEYS.ACCESS_TOKEN_EXP;
const REFRESH_TOKEN_KEY = CLASSROOM_STORAGE_KEYS.REFRESH_TOKEN;
const NEEDS_RELINK_KEY = CLASSROOM_STORAGE_KEYS.NEEDS_RELINK;
const NEEDS_RELINK_REASON_KEY = CLASSROOM_STORAGE_KEYS.NEEDS_RELINK_REASON;
const EVENT_NAME = CLASSROOM_LINKED_EVENT;

export function getLinkedEmail(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(LINKED_EMAIL_KEY);
  } catch {
    return null;
  }
}

export function getLinkedGroupId(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LINKED_GROUP_ID_KEY);
    return raw ? Number(raw) : null;
  } catch {
    return null;
  }
}

export function getPersonalSubmissions(): Record<string, PersonalSubmission> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(SUBMITTED_TASKS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function getPersonalTeachers(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(PERSONAL_TEACHERS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function getPersonalSubgroup(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(PERSONAL_SUBGROUP_KEY);
    if (!raw) return null;
    const n = parseInt(raw, 10);
    return n === 1 || n === 2 ? n : null;
  } catch {
    return null;
  }
}

export function getClassroomNeedsRelink(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(NEEDS_RELINK_KEY) === "true";
  } catch {
    return false;
  }
}

export function getClassroomRelinkReason(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(NEEDS_RELINK_REASON_KEY);
  } catch {
    return null;
  }
}

export function setClassroomNeedsRelink(val: boolean, reason?: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (val) {
      localStorage.setItem(NEEDS_RELINK_KEY, "true");
      if (reason) localStorage.setItem(NEEDS_RELINK_REASON_KEY, reason);
    } else {
      localStorage.removeItem(NEEDS_RELINK_KEY);
      localStorage.removeItem(NEEDS_RELINK_REASON_KEY);
    }
    window.dispatchEvent(new Event(EVENT_NAME));
  } catch {}
}

export function saveClassroomTokens(
  accessToken?: string | null,
  _refreshToken?: string | null,
  ttlSeconds: number = 3300
): void {
  if (typeof window === "undefined") return;
  try {
    if (accessToken) {
      localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
      localStorage.setItem(ACCESS_TOKEN_EXP_KEY, String(Date.now() + ttlSeconds * 1000));
    }
    // 1.5: Ніколи не зберігаємо сирий refresh_token у localStorage браузера!
    // Серверне оновлення токенів здійснюється через зашифрований ClassroomCredential за google_user_id.
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  } catch {}
}

export function getClassroomSilentAuth(): {
  accessToken: string | null;
  refreshToken: string | null;
  googleUserId: string | null;
} {
  if (typeof window === "undefined") {
    return { accessToken: null, refreshToken: null, googleUserId: null };
  }
  try {
    const rawToken = localStorage.getItem(ACCESS_TOKEN_KEY);
    const rawExp = Number(localStorage.getItem(ACCESS_TOKEN_EXP_KEY) || "0");
    const validAccess = rawToken && rawExp > Date.now() ? rawToken : null;
    const googleUserId = localStorage.getItem(GOOGLE_USER_ID_KEY) || null;
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    return { accessToken: validAccess, refreshToken: null, googleUserId };
  } catch {
    return { accessToken: null, refreshToken: null, googleUserId: null };
  }
}

export function clearClassroomAccessToken(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(ACCESS_TOKEN_EXP_KEY);
  } catch {}
}

// Ре-експорт чистих фільтрів із ./classroomTaskFilter

/**
 * Awaits server confirmation from /api/classroom/disconnect before clearing
 * local Classroom credentials and private schedule caches.
 */
export async function unlinkClassroomEmail(): Promise<ClassroomUnlinkResult> {
  return performClassroomUnlink({
    onClearCaches: () => {
      clearScheduleLocalStorageCache();
      invalidateScheduleCache(true);
    },
  });
}

export function saveClassroomSyncData(
  userEmail: string | null | undefined,
  tasks: Array<any> | undefined,
  accessToken?: string | null,
  refreshToken?: string | null,
  googleUserId?: string | null,
  groupId?: number | null,
  teachers?: string[] | null,
  subgroups?: number[] | null
): void {
  if (typeof window === "undefined") return;
  try {
    resetClassroomUnlinkState();
    const prevEmail = localStorage.getItem(LINKED_EMAIL_KEY);
    const prevGroupId = localStorage.getItem(LINKED_GROUP_ID_KEY);
    const prevUid = localStorage.getItem(GOOGLE_USER_ID_KEY);

    if (userEmail) {
      localStorage.setItem(LINKED_EMAIL_KEY, userEmail);
    } else if (!localStorage.getItem(LINKED_EMAIL_KEY)) {
      localStorage.setItem(LINKED_EMAIL_KEY, "підключено");
    }
    if (googleUserId) {
      localStorage.setItem(GOOGLE_USER_ID_KEY, googleUserId);
    }
    if (groupId) {
      localStorage.setItem(LINKED_GROUP_ID_KEY, String(groupId));
    }
    localStorage.removeItem(NEEDS_RELINK_KEY);
    localStorage.removeItem(NEEDS_RELINK_REASON_KEY);
    saveClassroomTokens(accessToken, refreshToken);

    const submittedMap: Record<string, PersonalSubmission> = {};
    const extractedTeachers = new Set<string>(teachers || []);

    if (tasks && Array.isArray(tasks)) {
      for (const t of tasks) {
        const url = t.url || t.alternate_link;
        if (url) {
          const state = t.state || "NEW";
          const subObj: PersonalSubmission = {
            state,
            grade: t.grade ?? t.assigned_grade ?? t.assignedGrade ?? null,
            maxPoints: t.max_points ?? t.maxPoints ?? null,
          };
          submittedMap[url] = subObj;
          const key = extractClassroomTaskKey(url);
          if (key) {
            submittedMap[key] = subObj;
          }
        }
        if (t.teacher) {
          extractedTeachers.add(t.teacher);
          const firstWord = t.teacher.trim().split(/[\s.]+/)[0];
          if (firstWord && firstWord.length >= 3) {
            extractedTeachers.add(firstWord);
          }
        }
      }
    }
    const prevTasksJson = localStorage.getItem(SUBMITTED_TASKS_KEY) || "{}";
    const nextTasksJson = JSON.stringify(submittedMap);
    const tasksChanged = prevTasksJson !== nextTasksJson;
    if (tasksChanged) {
      localStorage.setItem(SUBMITTED_TASKS_KEY, nextTasksJson);
    }

    const teachersList = Array.from(extractedTeachers);
    if (teachersList.length > 0) {
      localStorage.setItem(PERSONAL_TEACHERS_KEY, JSON.stringify(teachersList));
    }

    let detectedSub: number | null = null;
    if (subgroups && subgroups.length === 1 && (subgroups[0] === 1 || subgroups[0] === 2)) {
      detectedSub = subgroups[0];
    } else {
      const allTeachersStr = teachersList.join(" ").toLowerCase();
      if (allTeachersStr.includes("токар") && !allTeachersStr.includes("хочин")) {
        detectedSub = 1;
      } else if (allTeachersStr.includes("хочин") && !allTeachersStr.includes("токар")) {
        detectedSub = 2;
      }
    }
    if (detectedSub) {
      localStorage.setItem(PERSONAL_SUBGROUP_KEY, String(detectedSub));
      try {
        localStorage.setItem("schedule_selected_subgroup", String(detectedSub));
      } catch {}
    }

    const nextEmail = localStorage.getItem(LINKED_EMAIL_KEY);
    const nextGroupId = localStorage.getItem(LINKED_GROUP_ID_KEY);
    const nextUid = localStorage.getItem(GOOGLE_USER_ID_KEY);
    const identityChanged =
      prevEmail !== nextEmail || prevGroupId !== nextGroupId || prevUid !== nextUid;

    // Сповіщаємо картки розкладу ТІЛЬКИ якщо реально змінилися здані роботи або акаунт!
    if (tasksChanged || identityChanged) {
      window.dispatchEvent(new Event(EVENT_NAME));
      if (identityChanged) {
        window.dispatchEvent(new Event("classroom-access-changed"));
      }
    }
  } catch {}
}

interface ClassroomSnapshot {
  linkedEmail: string | null;
  linkedGroupId: number | null;
  submissions: Record<string, PersonalSubmission>;
  personalTeachers: string[];
  personalSubgroup: number | null;
  needsRelink: boolean;
  relinkReason: string | null;
  isUnlinking: boolean;
  unlinkError: string | null;
}

const DEFAULT_SERVER_CLASSROOM_SNAPSHOT: ClassroomSnapshot = {
  linkedEmail: null,
  linkedGroupId: null,
  submissions: {},
  personalTeachers: [],
  personalSubgroup: null,
  needsRelink: false,
  relinkReason: null,
  isUnlinking: false,
  unlinkError: null,
};

let _cachedClassroomSnapshot: ClassroomSnapshot | null = null;
const _classroomSubscribers = new Set<() => void>();

function readClassroomSnapshot(): ClassroomSnapshot {
  const email = getLinkedEmail();
  const gId = getLinkedGroupId();
  const unlinkState = getClassroomUnlinkState();
  if (email) {
    return {
      linkedEmail: email,
      linkedGroupId: gId,
      submissions: getPersonalSubmissions(),
      personalTeachers: getPersonalTeachers(),
      personalSubgroup: getPersonalSubgroup(),
      needsRelink: getClassroomNeedsRelink(),
      relinkReason: getClassroomRelinkReason(),
      isUnlinking: unlinkState.isUnlinking,
      unlinkError: unlinkState.error,
    };
  }
  return {
    linkedEmail: null,
    linkedGroupId: null,
    submissions: {},
    personalTeachers: [],
    personalSubgroup: null,
    needsRelink: false,
    relinkReason: null,
    isUnlinking: unlinkState.isUnlinking,
    unlinkError: unlinkState.error,
  };
}

function getClassroomSnapshot(): ClassroomSnapshot {
  if (!_cachedClassroomSnapshot) {
    _cachedClassroomSnapshot = readClassroomSnapshot();
  }
  return _cachedClassroomSnapshot;
}

function notifyClassroomChange() {
  _cachedClassroomSnapshot = readClassroomSnapshot();
  _classroomSubscribers.forEach((fn) => fn());
}

if (typeof window !== "undefined") {
  subscribeClassroomUnlinkState(notifyClassroomChange);
  window.addEventListener(EVENT_NAME, notifyClassroomChange);
  window.addEventListener("storage", (e: StorageEvent) => {
    if (e.key === null || (typeof e.key === "string" && (e.key.includes("classroom") || e.key.includes("subgroup")))) {
      notifyClassroomChange();
    }
  });
}

function subscribeClassroom(cb: () => void) {
  _classroomSubscribers.add(cb);
  return () => {
    _classroomSubscribers.delete(cb);
  };
}

export function useClassroomSubmissions() {
  const snapshot = useSyncExternalStore(
    subscribeClassroom,
    getClassroomSnapshot,
    () => DEFAULT_SERVER_CLASSROOM_SNAPSHOT
  );

  const isLinkedToGroup = useCallback(
    (gid?: number | null) => {
      if (!gid) return false;
      return Boolean(snapshot.linkedEmail && (!snapshot.linkedGroupId || snapshot.linkedGroupId === gid));
    },
    [snapshot.linkedEmail, snapshot.linkedGroupId]
  );

  return {
    linkedEmail: snapshot.linkedEmail,
    linkedGroupId: snapshot.linkedGroupId,
    isLinked: Boolean(snapshot.linkedEmail),
    isLinkedToGroup,
    submissions: snapshot.submissions,
    personalTeachers: snapshot.personalTeachers,
    personalSubgroup: snapshot.personalSubgroup,
    needsRelink: snapshot.needsRelink,
    relinkReason: snapshot.relinkReason,
    isUnlinking: snapshot.isUnlinking,
    unlinkError: snapshot.unlinkError,
    unlink: unlinkClassroomEmail,
    clearUnlinkError: clearClassroomUnlinkError,
    reload: notifyClassroomChange,
    syncSubmissions: syncPersonalSubmissions,
  };
}

export function useClassroomNeedsRelink(): boolean {
  const { isLinked, needsRelink } = useClassroomSubmissions();
  return isLinked && needsRelink;
}

let _isSyncingPersonalSubmissions = false;

export async function syncPersonalSubmissions(groupId?: number | null): Promise<boolean> {
  if (typeof window === "undefined" || _isSyncingPersonalSubmissions) return false;
  const email = getLinkedEmail();
  if (!email) return false;

  const { accessToken, googleUserId } = getClassroomSilentAuth();
  const gId = groupId ?? getLinkedGroupId();

  _isSyncingPersonalSubmissions = true;
  try {
    const res = await api.classroom.userSubmissions({
      group_id: gId ?? undefined,
      google_user_id: googleUserId ?? undefined,
      email: email !== "підключено" ? email : undefined,
      access_token: accessToken ?? undefined,
    });

    if ((res as any)?.needs_relink) {
      setClassroomNeedsRelink(true, (res as any).reason_code || (res as any).error || null);
    }

    if (res?.connected && res?.tasks) {
      setClassroomNeedsRelink(false);
      const personalTeachers = getPersonalTeachers();
      const personalSubgroup = getPersonalSubgroup();
      const existingLinkedGid = getLinkedGroupId();
      const resolvedGroupId = res.group_id ?? existingLinkedGid ?? gId;
      saveClassroomSyncData(
        res.user_email || email,
        res.tasks,
        res.access_token ?? accessToken,
        null,
        res.google_user_id || googleUserId,
        resolvedGroupId,
        personalTeachers,
        personalSubgroup ? [personalSubgroup] : null
      );

      if (Array.isArray(res.tasks) && res.tasks.length > 0) {
        const targetGid = res.group_id || resolvedGroupId || gId || getLinkedGroupId();
        try {
          localStorage.setItem("schedule:classroom_tasks", JSON.stringify(res.tasks));
          if (targetGid) {
            localStorage.setItem(
              `schedule:classroom_group_tasks:${targetGid}`,
              JSON.stringify(res.tasks)
            );
          }
          window.dispatchEvent(
            new CustomEvent("classroom-tasks-synced", {
              detail: { groupId: targetGid, tasks: res.tasks },
            })
          );
        } catch {}
      }

      return true;
    }
  } catch {
    // ignore network errors silently
  } finally {
    _isSyncingPersonalSubmissions = false;
  }
  return false;
}
