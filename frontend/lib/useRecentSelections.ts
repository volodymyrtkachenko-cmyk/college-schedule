"use client";

import { useCallback, useSyncExternalStore } from "react";

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

function readSnapshotFromStorage(): RecentSelectionsSnapshot {
  if (typeof window === "undefined") return DEFAULT_SNAPSHOT;

  const groupIds = parseStoredIds(RECENT_GROUPS_STORAGE_KEY);
  const teacherIds = parseStoredIds(RECENT_TEACHERS_STORAGE_KEY);

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
      if (e.key === RECENT_GROUPS_STORAGE_KEY || e.key === RECENT_TEACHERS_STORAGE_KEY) {
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
    return () => {
      _subscribers.delete(callback);
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(RECENT_SELECTIONS_CHANGE_EVENT, handleCustom);
    };
  }
  return () => {
    _subscribers.delete(callback);
  };
}

export function recordRecentGroupSelection(id: number | null | undefined) {
  if (typeof window === "undefined" || !id || Number.isNaN(id) || id <= 0) return;
  const current = parseStoredIds(RECENT_GROUPS_STORAGE_KEY);
  const next = [id, ...current.filter((item) => item !== id)].slice(0, MAX_RECENT_SELECTIONS);
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
