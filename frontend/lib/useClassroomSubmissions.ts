"use client";

import { useEffect, useState, useCallback } from "react";

export interface PersonalSubmission {
  state: string;
  grade?: number | null;
  maxPoints?: number | null;
}

const LINKED_EMAIL_KEY = "schedule:classroom_linked_email";
const SUBMITTED_TASKS_KEY = "schedule:classroom_submitted_tasks";
const EVENT_NAME = "classroom-linked-change";

export function getLinkedEmail(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(LINKED_EMAIL_KEY);
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

export function unlinkClassroomEmail(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(LINKED_EMAIL_KEY);
    localStorage.removeItem(SUBMITTED_TASKS_KEY);
    window.dispatchEvent(new Event(EVENT_NAME));
  } catch {}
}

export function saveClassroomSyncData(
  userEmail: string | null | undefined,
  tasks: Array<any> | undefined
): void {
  if (typeof window === "undefined") return;
  try {
    if (userEmail) {
      localStorage.setItem(LINKED_EMAIL_KEY, userEmail);
    } else {
      localStorage.setItem(LINKED_EMAIL_KEY, "підключено");
    }

    const submittedMap: Record<string, PersonalSubmission> = {};
    if (tasks && Array.isArray(tasks)) {
      for (const t of tasks) {
        const url = t.url || t.alternate_link;
        const state = t.state;
        if (url && (state === "TURNED_IN" || state === "RETURNED")) {
          submittedMap[url] = {
            state,
            grade: t.grade ?? t.assigned_grade ?? t.assignedGrade ?? null,
            maxPoints: t.max_points ?? t.maxPoints ?? null,
          };
        }
      }
    }
    localStorage.setItem(SUBMITTED_TASKS_KEY, JSON.stringify(submittedMap));
    window.dispatchEvent(new Event(EVENT_NAME));
  } catch {}
}

export function useClassroomSubmissions() {
  const [linkedEmail, setLinkedEmail] = useState<string | null>(null);
  const [submissions, setSubmissions] = useState<Record<string, PersonalSubmission>>({});

  const reload = useCallback(() => {
    const email = getLinkedEmail();
    setLinkedEmail(email);
    if (email) {
      setSubmissions(getPersonalSubmissions());
    } else {
      setSubmissions({});
    }
  }, []);

  useEffect(() => {
    reload();
    window.addEventListener(EVENT_NAME, reload);
    return () => window.removeEventListener(EVENT_NAME, reload);
  }, [reload]);

  return {
    linkedEmail,
    isLinked: Boolean(linkedEmail),
    submissions,
    unlink: unlinkClassroomEmail,
    reload,
  };
}
