"use client";

import { useState, useEffect, useCallback } from "react";
import { api, invalidateEtagCache } from "./api";

const TEACHER_PIN_KEY = "college_schedule_teacher_pin";
const EVENT_NAME = "teacher-access-changed";

export function getStoredTeacherPin(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(TEACHER_PIN_KEY);
  } catch {
    return null;
  }
}

export function useTeacherAccess() {
  const [teacherPin, setTeacherPin] = useState<string | null>(getStoredTeacherPin);
  const isTeacherUnlocked = Boolean(teacherPin);

  useEffect(() => {
    const handleUpdate = () => {
      setTeacherPin(getStoredTeacherPin());
    };
    window.addEventListener(EVENT_NAME, handleUpdate);
    window.addEventListener("storage", handleUpdate);
    return () => {
      window.removeEventListener(EVENT_NAME, handleUpdate);
      window.removeEventListener("storage", handleUpdate);
    };
  }, []);

  const unlockTeacher = useCallback(async (pin: string): Promise<{ success: boolean; error?: string }> => {
    if (!pin || !pin.trim()) {
      return { success: false, error: "Введіть PIN-код викладача" };
    }
    try {
      const res = await api.settings.verifyTeacherPin(pin.trim());
      if (res.valid) {
        localStorage.setItem(TEACHER_PIN_KEY, pin.trim());
        invalidateEtagCache();
        setTeacherPin(pin.trim());
        window.dispatchEvent(new CustomEvent(EVENT_NAME));
        return { success: true };
      }
      return { success: false, error: "Невірний PIN-код викладача" };
    } catch {
      return { success: false, error: "Помилка перевірки PIN-коду. Спробуйте пізніше." };
    }
  }, []);

  const lockTeacher = useCallback(() => {
    try {
      localStorage.removeItem(TEACHER_PIN_KEY);
      invalidateEtagCache();
      setTeacherPin(null);
      window.dispatchEvent(new CustomEvent(EVENT_NAME));
    } catch {}
  }, []);

  return {
    isTeacherUnlocked,
    teacherPin,
    unlockTeacher,
    lockTeacher,
  };
}
