"use client";

import { useCallback, useSyncExternalStore } from "react";
import { getLinkedGroupId } from "./useClassroomSubmissions";

export const MAX_RECENT_SELECTIONS = 3;
export const RECENT_GROUPS_STORAGE_KEY = "schedule:recent_group_ids";
export const RECENT_TEACHERS_STORAGE_KEY = "schedule:recent_teacher_ids";
export const RECENT_SELECTIONS_CHANGE_EVENT = "schedule:recent_selections_changed";

export interface RecentSelectionsSnapshot {
  groupIds: number[];
  teacherIds: number[];
}

const DEFAULT_SNAPSHOT: RecentSelectionsSnapshot = {
  groupIds: [],
  teacherIds: [],
};

let _cachedSnapshot: RecentSelectionsSnapshot | null = null;
const _subscribers = new Set<() => void>();

function parseStoredIds(key: string): number[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => Number(item))
      .filter((id) => !Number.isNaN(id) && id > 0)
      .slice(0, MAX_RECENT_SELECTIONS);
  } catch {
    return [];
  }
}

function resolveRecentGroupIds(): number[] {
  if (typeof window === "undefined") return [];
  const stored = parseStoredIds(RECENT_GROUPS_STORAGE_KEY);
  const linkedGid = getLinkedGroupId();
  const currentSelectedGid = Number(localStorage.getItem("schedule:groupId")) || null;

  const result: number[] = [];

  // 1. Група з підключеним Classroom ЗАВЖДИ має найвищий пріоритет
  if (linkedGid && linkedGid > 0) {
    result.push(linkedGid);
  }

  // 2. Збережені нещодавні вибори
  for (const id of stored) {
    if (!result.includes(id)) {
      result.push(id);
    }
  }

  // 3. Якщо користувач прямо зараз дивиться групу, якої ще немає в списку
  if (currentSelectedGid && currentSelectedGid > 0 && !result.includes(currentSelectedGid)) {
    result.push(currentSelectedGid);
  }

  return result.slice(0, MAX_RECENT_SELECTIONS);
}

function resolveRecentTeacherIds(): number[] {
  if (typeof window === "undefined") return [];
  const stored = parseStoredIds(RECENT_TEACHERS_STORAGE_KEY);
  const currentSelectedTid = Number(localStorage.getItem("schedule:teacherId")) || null;

  const result: number[] = [...stored];
  if (currentSelectedTid && currentSelectedTid > 0 && !result.includes(currentSelectedTid)) {
    result.push(currentSelectedTid);
  }

  return result.slice(0, MAX_RECENT_SELECTIONS);
}

function readSnapshotFromStorage(): RecentSelectionsSnapshot {
  if (typeof window === "undefined") return DEFAULT_SNAPSHOT;

  const groupIds = resolveRecentGroupIds();
  const teacherIds = resolveRecentTeacherIds();

  if (
    _cachedSnapshot &&
    _cachedSnapshot.groupIds.length === groupIds.length &&
    _cachedSnapshot.teacherIds.length === teacherIds.length &&
    _cachedSnapshot.groupIds.every((id, idx) => id === groupIds[idx]) &&
    _cachedSnapshot.teacherIds.every((id, idx) => id === teacherIds[idx])
  ) {
    return _cachedSnapshot;
  }

  const next: RecentSelectionsSnapshot = { groupIds, teacherIds };
  _cachedSnapshot = next;
  return next;
}

function notifySubscribers() {
  _cachedSnapshot = null;
  _subscribers.forEach((cb) => {
    try {
      cb();
    } catch {}
  });
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(RECENT_SELECTIONS_CHANGE_EVENT));
  }
}

function subscribe(callback: () => void) {
  _subscribers.add(callback);
  if (typeof window !== "undefined") {
    const handleStorage = (e: StorageEvent) => {
      if (
        e.key === RECENT_GROUPS_STORAGE_KEY ||
        e.key === RECENT_TEACHERS_STORAGE_KEY ||
        e.key === "schedule:groupId" ||
        e.key === "schedule:teacherId" ||
        e.key === "schedule:classroom_linked_group_id" ||
        e.key === "schedule:classroom_linked_email"
      ) {
        _cachedSnapshot = null;
        callback();
      }
    };
    const handleCustom = () => {
      _cachedSnapshot = null;
      callback();
    };
    window.addEventListener("storage", handleStorage);
    window.addEventListener(RECENT_SELECTIONS_CHANGE_EVENT, handleCustom);
    window.addEventListener("classroom-linked-change", handleCustom);
    return () => {
      _subscribers.delete(callback);
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(RECENT_SELECTIONS_CHANGE_EVENT, handleCustom);
      window.removeEventListener("classroom-linked-change", handleCustom);
    };
  }
  return () => {
    _subscribers.delete(callback);
  };
}

export function recordRecentGroupSelection(id: number | null | undefined) {
  if (typeof window === "undefined" || !id || Number.isNaN(id) || id <= 0) return;
  const current = parseStoredIds(RECENT_GROUPS_STORAGE_KEY);
  const linkedGid = getLinkedGroupId();

  // Формуємо новий список:
  // Якщо є прив'язана до Classroom група - вона стоїть найпершою (пріоритет),
  // а щойно вибрана група іде одразу за нею (або першою, якщо це вона сама).
  let next: number[];
  if (linkedGid && linkedGid > 0) {
    if (id === linkedGid) {
      next = [linkedGid, ...current.filter((item) => item !== linkedGid)].slice(0, MAX_RECENT_SELECTIONS);
    } else {
      const rest = [id, ...current.filter((item) => item !== id && item !== linkedGid)];
      next = [linkedGid, ...rest].slice(0, MAX_RECENT_SELECTIONS);
    }
  } else {
    next = [id, ...current.filter((item) => item !== id)].slice(0, MAX_RECENT_SELECTIONS);
  }

  try {
    localStorage.setItem(RECENT_GROUPS_STORAGE_KEY, JSON.stringify(next));
  } catch {}
  notifySubscribers();
}

export function recordRecentTeacherSelection(id: number | null | undefined) {
  if (typeof window === "undefined" || !id || Number.isNaN(id) || id <= 0) return;
  const current = parseStoredIds(RECENT_TEACHERS_STORAGE_KEY);
  const next = [id, ...current.filter((item) => item !== id)].slice(0, MAX_RECENT_SELECTIONS);
  try {
    localStorage.setItem(RECENT_TEACHERS_STORAGE_KEY, JSON.stringify(next));
  } catch {}
  notifySubscribers();
}

export function useRecentSelections() {
  const store = useSyncExternalStore(
    subscribe,
    readSnapshotFromStorage,
    () => DEFAULT_SNAPSHOT,
  );

  const recordGroup = useCallback((id: number | null | undefined) => {
    recordRecentGroupSelection(id);
  }, []);

  const recordTeacher = useCallback((id: number | null | undefined) => {
    recordRecentTeacherSelection(id);
  }, []);

  return {
    recentGroupIds: store.groupIds,
    recentTeacherIds: store.teacherIds,
    recordRecentGroup: recordGroup,
    recordRecentTeacher: recordTeacher,
  };
}
