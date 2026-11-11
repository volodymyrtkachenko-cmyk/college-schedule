"use client";

import { useCallback, useSyncExternalStore } from "react";
import { api, invalidateEtagCache } from "./api";
import { clearScheduleLocalStorageCache, invalidateScheduleCache } from "./hooks";

const TEACHER_PIN_KEY = "college_schedule_teacher_pin";
const EVENT_NAME = "teacher-access-changed";

let cachedPin: string | null = null;
let initialized = false;
const listeners = new Set<() => void>();

function readPin(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(TEACHER_PIN_KEY);
  } catch {
    return null;
  }
}

function initListeners() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  cachedPin = readPin();

  const handleUpdate = () => {
    const next = readPin();
    if (next !== cachedPin) {
      cachedPin = next;
      listeners.forEach((cb) => cb());
    }
  };

  window.addEventListener(EVENT_NAME, handleUpdate);
  window.addEventListener("storage", handleUpdate);
}

function subscribe(cb: () => void) {
  initListeners();
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): string | null {
  initListeners();
  return cachedPin;
}

function getServerSnapshot(): string | null {
  return null;
}

export function getStoredTeacherPin(): string | null {
  return readPin();
}

export function useTeacherAccess() {
  const teacherPin = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const isTeacherUnlocked = Boolean(teacherPin);

  const unlockTeacher = useCallback(async (pin: string): Promise<{ success: boolean; error?: string }> => {
    if (!pin || !pin.trim()) {
      return { success: false, error: "Введіть PIN-код викладача" };
    }
    try {
      const res = await api.settings.verifyTeacherPin(pin.trim());
      if (res.valid) {
        if (typeof window !== "undefined") {
          localStorage.setItem(TEACHER_PIN_KEY, pin.trim());
        }
        cachedPin = pin.trim();
        invalidateEtagCache();
        listeners.forEach((cb) => cb());
        window.dispatchEvent(new Event(EVENT_NAME));
        return { success: true };
      }
      return { success: false, error: "Невірний PIN-код викладача" };
    } catch {
      return { success: false, error: "Помилка перевірки PIN-коду. Спробуйте пізніше." };
    }
  }, []);

  const lockTeacher = useCallback(() => {
    if (typeof window !== "undefined") {
      try {
        localStorage.removeItem(TEACHER_PIN_KEY);
      } catch {}
    }
    cachedPin = null;
    clearScheduleLocalStorageCache();
    invalidateScheduleCache(true);
    listeners.forEach((cb) => cb());
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(EVENT_NAME));
    }
  }, []);

  const unlockTeacherAccess = useCallback((pin: string) => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(TEACHER_PIN_KEY, pin.trim());
      cachedPin = pin.trim();
      invalidateEtagCache();
      listeners.forEach((cb) => cb());
      window.dispatchEvent(new Event(EVENT_NAME));
    } catch {}
  }, []);

  const lockTeacherAccess = lockTeacher;

  return {
    teacherPin,
    isTeacherUnlocked,
    unlockTeacher,
    lockTeacher,
    unlockTeacherAccess,
    lockTeacherAccess,
  };
}
