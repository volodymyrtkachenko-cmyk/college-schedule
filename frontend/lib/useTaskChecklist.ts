"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  readChecklistMap,
  TASK_CHECKLIST_KEY,
  toggleChecklistStep,
} from "./schedule/priorityNavigator";

const CHECKLIST_EVENT = "schedule:task-checklist-change";
const EMPTY_MAP: Record<string, number[]> = {};

let _cachedMap: Record<string, number[]> | null = null;
const _subscribers = new Set<() => void>();

function getSnapshot(): Record<string, number[]> {
  if (typeof window === "undefined") return EMPTY_MAP;
  if (!_cachedMap) {
    _cachedMap = readChecklistMap();
  }
  return _cachedMap;
}

function notifyChange() {
  _cachedMap = readChecklistMap();
  _subscribers.forEach((cb) => cb());
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e: StorageEvent) => {
    if (e.key === null || e.key === TASK_CHECKLIST_KEY) {
      notifyChange();
    }
  });
}

function subscribe(cb: () => void) {
  _subscribers.add(cb);
  return () => {
    _subscribers.delete(cb);
  };
}

export function useTaskChecklist() {
  const checklistMap = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_MAP);

  const toggleStep = useCallback((taskKey: string, stepIdx: number) => {
    toggleChecklistStep(taskKey, stepIdx);
    notifyChange();
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(CHECKLIST_EVENT));
    }
  }, []);

  return { checklistMap, toggleStep };
}
