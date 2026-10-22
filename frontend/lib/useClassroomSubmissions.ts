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

export function extractClassroomTaskKey(url?: string | null): string | null {
  if (!url) return null;
  const m = url.match(/\/c\/([^\/\?#]+)\/a\/([^\/\?#]+)/i);
  if (m) {
    return `${m[1]}_${m[2]}`;
  }
  return url.split("?")[0].split("#")[0].replace(/\/details\/?$/i, "").replace(/\/+$/, "");
}

// Користувач, який не залогінився (гість), бачить ВСІ посилання та ДЗ обох підгруп.
// Користувач, який прив'язав Classroom (залогінений), бачить ТІЛЬКИ свою підгрупу та своє ДЗ.
// Загальні предмети групи (математика, схемотехніка, електроніка, філософія тощо) бачать усі студенти!
export function isOwnTask(
  isLinked: boolean,
  submissions: Record<string, PersonalSubmission>,
  url: string | null | undefined,
  taskTeacher?: string | null,
  personalTeachers?: string[],
  taskTitle?: string | null,
  explicitSubgroup?: number | null
): boolean {
  let userSubgroup: number | null = explicitSubgroup ?? (isLinked ? getPersonalSubgroup() : null);
  if (!userSubgroup && typeof window !== "undefined") {
    try {
      const sel = localStorage.getItem("schedule_selected_subgroup");
      if (sel === "1" || sel === "2") userSubgroup = parseInt(sel, 10);
    } catch {}
  }
  if (!userSubgroup && isLinked) {
    const pJoined = (personalTeachers || []).join(" ").toLowerCase();
    if (pJoined.includes("токар") && !pJoined.includes("хочин")) {
      userSubgroup = 1;
    } else if (pJoined.includes("хочин") && !pJoined.includes("токар")) {
      userSubgroup = 2;
    }
  }

  if (userSubgroup === 1 || userSubgroup === 2) {
    const tLow = (taskTeacher || "").toLowerCase();
    const titleLow = (taskTitle || "").toLowerCase();

    const isSub1Task =
      tLow.includes("токар") ||
      titleLow.includes("токар") ||
      tLow.includes("1 підгр") ||
      tLow.includes("1-ша підгр") ||
      tLow.includes("1-а підгр") ||
      tLow.includes("1 підгрупа") ||
      titleLow.includes("1 підгр") ||
      titleLow.includes("1-ша підгр") ||
      titleLow.includes("1-а підгр") ||
      titleLow.includes("1 підгрупа");

    const isSub2Task =
      tLow.includes("хочин") ||
      titleLow.includes("хочин") ||
      tLow.includes("2 підгр") ||
      tLow.includes("2-га підгр") ||
      tLow.includes("2-а підгр") ||
      tLow.includes("2 підгрупа") ||
      titleLow.includes("2 підгр") ||
      titleLow.includes("2-га підгр") ||
      titleLow.includes("2-а підгр") ||
      titleLow.includes("2 підгрупа");

    if (isSub1Task && isSub2Task) {
      return true;
    }

    if (userSubgroup === 1 && isSub2Task && !isSub1Task) return false;
    if (userSubgroup === 2 && isSub1Task && !isSub2Task) return false;
  }

  if (!isLinked) return true;

  // Якщо користувач прив'язав акаунт і в нього є завантажені персональні завдання:
  // якщо викладач показав роботу не для всіх (індивідуально чи іншій підгрупі),
  // показуємо ТІЛЬКИ ті завдання, які призначені саме цьому студенту!
  const hasSubmissions = Object.keys(submissions).length > 0;
  if (hasSubmissions && url) {
    const key = extractClassroomTaskKey(url);
    const isMyTask = Boolean(submissions[url] || (key && submissions[key]));
    if (!isMyTask) {
      return false;
    }
  }

  // Усі загальні предмети та завдання своєї підгрупи завжди відображаються
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
  const [linkedGroupId, setLinkedGroupId] = useState<number | null>(null);
  const [submissions, setSubmissions] = useState<Record<string, PersonalSubmission>>({});
  const [personalTeachers, setPersonalTeachers] = useState<string[]>([]);
  const [personalSubgroup, setPersonalSubgroup] = useState<number | null>(null);

  const reload = useCallback(() => {
    const email = getLinkedEmail();
    const gId = getLinkedGroupId();
    setLinkedEmail(email);
    setLinkedGroupId(gId);
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

  const isLinkedToGroup = useCallback(
    (gid?: number | null) => {
      if (!gid) return false;
      return Boolean(linkedEmail && linkedGroupId === gid);
    },
    [linkedEmail, linkedGroupId]
  );

  return {
    linkedEmail,
    linkedGroupId,
    isLinked: Boolean(linkedEmail),
    isLinkedToGroup,
    submissions,
    personalTeachers,
    personalSubgroup,
    unlink: unlinkClassroomEmail,
    reload,
  };
}
