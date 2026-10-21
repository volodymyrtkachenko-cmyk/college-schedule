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
const PERSONAL_TEACHERS_KEY = "schedule:classroom_personal_teachers";
const PERSONAL_SUBGROUP_KEY = "schedule:classroom_personal_subgroup";
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

// Користувач, який не залогінився (гість), бачить ВСІ посилання та ДЗ обох підгруп.
// Користувач, який прив'язав Classroom (залогінений), бачить ТІЛЬКИ свою підгрупу та своє ДЗ.
export function isOwnTask(
  isLinked: boolean,
  submissions: Record<string, PersonalSubmission>,
  url: string | null | undefined,
  taskTeacher?: string | null,
  personalTeachers?: string[]
): boolean {
  if (!isLinked) return true;

  const hasSubmissions = Object.keys(submissions).length > 0;
  if (url && hasSubmissions) {
    if (submissions[url]) return true;
  }

  if (taskTeacher && personalTeachers && personalTeachers.length > 0) {
    const tLow = taskTeacher.toLowerCase();
    const isTeacherOfUser = personalTeachers.some((pt) => {
      const pLow = pt.toLowerCase();
      return tLow.includes(pLow) || pLow.includes(tLow);
    });
    if (isTeacherOfUser) return true;

    const isKnownOtherTeacher =
      (tLow.includes("хочин") && personalTeachers.some((p) => p.toLowerCase().includes("токар"))) ||
      (tLow.includes("токар") && personalTeachers.some((p) => p.toLowerCase().includes("хочин")));
    if (isKnownOtherTeacher) {
      return false;
    }
  }

  if (url && hasSubmissions && !submissions[url]) {
    return false;
  }

  return true;
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
    localStorage.removeItem(PERSONAL_TEACHERS_KEY);
    localStorage.removeItem(PERSONAL_SUBGROUP_KEY);
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(ACCESS_TOKEN_EXP_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    try {
      localStorage.removeItem("schedule_selected_subgroup");
    } catch {}
    window.dispatchEvent(new Event(EVENT_NAME));
    window.dispatchEvent(new Event("storage"));
  } catch {}
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
    const extractedTeachers = new Set<string>(teachers || []);

    if (tasks && Array.isArray(tasks)) {
      for (const t of tasks) {
        const url = t.url || t.alternate_link;
        if (url) {
          const state = t.state || "NEW";
          submittedMap[url] = {
            state,
            grade: t.grade ?? t.assigned_grade ?? t.assignedGrade ?? null,
            maxPoints: t.max_points ?? t.maxPoints ?? null,
          };
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
    localStorage.setItem(SUBMITTED_TASKS_KEY, JSON.stringify(submittedMap));

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

    window.dispatchEvent(new Event(EVENT_NAME));
    window.dispatchEvent(new Event("storage"));
  } catch {}
}

export function useClassroomSubmissions() {
  const [linkedEmail, setLinkedEmail] = useState<string | null>(null);
  const [submissions, setSubmissions] = useState<Record<string, PersonalSubmission>>({});
  const [personalTeachers, setPersonalTeachers] = useState<string[]>([]);
  const [personalSubgroup, setPersonalSubgroup] = useState<number | null>(null);

  const reload = useCallback(() => {
    const email = getLinkedEmail();
    setLinkedEmail(email);
    if (email) {
      setSubmissions(getPersonalSubmissions());
      setPersonalTeachers(getPersonalTeachers());
      setPersonalSubgroup(getPersonalSubgroup());
    } else {
      setSubmissions({});
      setPersonalTeachers([]);
      setPersonalSubgroup(null);
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
    personalTeachers,
    personalSubgroup,
    unlink: unlinkClassroomEmail,
    reload,
  };
}
