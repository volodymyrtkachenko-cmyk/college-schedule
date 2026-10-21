"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "./api";

export interface PersonalSubmission {
  state: string;
  grade?: number | null;
  maxPoints?: number | null;
}

const LINKED_EMAIL_KEY = "schedule:classroom_linked_email";
const GOOGLE_USER_ID_KEY = "schedule:classroom_google_user_id";
const LINKED_GROUP_ID_KEY = "schedule:classroom_linked_group_id";
const SUBMITTED_TASKS_KEY = "schedule:classroom_submitted_tasks";
const ACCESS_TOKEN_KEY = "schedule:classroom_access_token";
const ACCESS_TOKEN_EXP_KEY = "schedule:classroom_access_token_exp";
const REFRESH_TOKEN_KEY = "schedule:classroom_refresh_token";
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

export function saveClassroomTokens(
  accessToken?: string | null,
  refreshToken?: string | null,
  ttlSeconds: number = 3300
): void {
  if (typeof window === "undefined") return;
  try {
    if (accessToken) {
      localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
      localStorage.setItem(ACCESS_TOKEN_EXP_KEY, String(Date.now() + ttlSeconds * 1000));
    }
    if (refreshToken) {
      localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
    }
  } catch {}
}

export function getClassroomSilentAuth(): {
  accessToken: string | null;
  refreshToken: string | null;
} {
  if (typeof window === "undefined") return { accessToken: null, refreshToken: null };
  try {
    const rawToken = localStorage.getItem(ACCESS_TOKEN_KEY);
    const rawExp = Number(localStorage.getItem(ACCESS_TOKEN_EXP_KEY) || "0");
    const validAccess = rawToken && rawExp > Date.now() ? rawToken : null;
    const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY) || null;
    return { accessToken: validAccess, refreshToken };
  } catch {
    return { accessToken: null, refreshToken: null };
  }
}

export function clearClassroomAccessToken(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(ACCESS_TOKEN_EXP_KEY);
  } catch {}
}

// Прив'язаний користувач бачить лише свої завдання (ті, що є в його submissions).
// Якщо особистих даних немає (напр., бракує scope) — показуємо всі, як для неприв'язаного.
export function isOwnTask(
  isLinked: boolean,
  submissions: Record<string, PersonalSubmission>,
  url: string | null | undefined
): boolean {
  if (!isLinked) return true;
  if (Object.keys(submissions).length === 0) return true;
  return Boolean(url && submissions[url]);
}

export function unlinkClassroomEmail(): void {
  if (typeof window === "undefined") return;
  try {
    const googleUserId = localStorage.getItem(GOOGLE_USER_ID_KEY);
    const groupIdRaw = localStorage.getItem(LINKED_GROUP_ID_KEY);
    const accessToken = localStorage.getItem(ACCESS_TOKEN_KEY);
    const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
    const groupId = groupIdRaw ? Number(groupIdRaw) : undefined;

    if (googleUserId || accessToken || refreshToken) {
      void api.classroom
        .disconnect({
          group_id: groupId && !Number.isNaN(groupId) ? groupId : undefined,
          google_user_id: googleUserId || undefined,
          access_token: accessToken || undefined,
          refresh_token: refreshToken || undefined,
        })
        .catch(() => {});
    }

    localStorage.removeItem(LINKED_EMAIL_KEY);
    localStorage.removeItem(GOOGLE_USER_ID_KEY);
    localStorage.removeItem(LINKED_GROUP_ID_KEY);
    localStorage.removeItem(SUBMITTED_TASKS_KEY);
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(ACCESS_TOKEN_EXP_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    window.dispatchEvent(new Event(EVENT_NAME));
  } catch {}
}

export function saveClassroomSyncData(
  userEmail: string | null | undefined,
  tasks: Array<any> | undefined,
  accessToken?: string | null,
  refreshToken?: string | null,
  googleUserId?: string | null,
  groupId?: number | null
): void {
  if (typeof window === "undefined") return;
  try {
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
    saveClassroomTokens(accessToken, refreshToken);

    const submittedMap: Record<string, PersonalSubmission> = {};
    if (tasks && Array.isArray(tasks)) {
      for (const t of tasks) {
        const url = t.url || t.alternate_link;
        const state = t.state;
        if (url && state && state !== "UNKNOWN") {
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
