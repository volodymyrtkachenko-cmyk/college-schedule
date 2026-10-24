"use client";

import { api } from "./api";
import { invalidateScheduleCache } from "./hooks";
import { saveClassroomSyncData } from "./useClassroomSubmissions";

export const GOOGLE_CLIENT_ID =
  process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ||
  "1079868158360-ok75uv5l93pcql2iktfcple97sdu180b.apps.googleusercontent.com";

export const CLASSROOM_SCOPES = [
  "https://www.googleapis.com/auth/classroom.courses.readonly",
  "https://www.googleapis.com/auth/classroom.announcements.readonly",
  "https://www.googleapis.com/auth/classroom.rosters.readonly",
  "https://www.googleapis.com/auth/classroom.coursework.me.readonly",
  "https://www.googleapis.com/auth/classroom.student-submissions.me.readonly",
  "https://www.googleapis.com/auth/classroom.coursework.students.readonly",
  "https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly",
  "https://www.googleapis.com/auth/directory.readonly",
].join(" ");

export const loadGsiScript = (): Promise<void> =>
  new Promise((resolve, reject) => {
    if ((window as any).google?.accounts?.oauth2) return resolve();
    const existing = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Не вдалося завантажити Google OAuth")));
      return;
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Не вдалося завантажити Google OAuth"));
    document.body.appendChild(script);
  });

export interface ClassroomAuthOptions {
  groupId?: number | null;
  weekStart?: string;
  onSuccess?: (res: any, usedCode: boolean) => void;
  onError?: (err: Error) => void;
}

export async function requestClassroomAuth(options: ClassroomAuthOptions = {}): Promise<any> {
  if (!GOOGLE_CLIENT_ID) {
    throw new Error("Додайте NEXT_PUBLIC_GOOGLE_CLIENT_ID у .env");
  }

  await loadGsiScript();
  const statusData = await api.classroom.status().catch(() => null);
  const hasClientSecret = Boolean(statusData?.has_client_secret);

  return new Promise<any>((resolve, reject) => {
    let resolved = false;

    const handleSuccess = (res: any, usedCode: boolean, fallbackAccessToken?: string | null) => {
      if (resolved) return;
      resolved = true;

      invalidateScheduleCache();
      const personalTeachers = [
        ...(res.synced_teacher_names || []),
        ...(res.synced_teacher_tokens || []),
      ];
      const targetGroupId = res.group_id ?? options.groupId ?? null;

      saveClassroomSyncData(
        res.user_email,
        res.personal_tasks ?? res.tasks,
        res.access_token ?? fallbackAccessToken ?? null,
        res.refresh_token ?? null,
        res.google_user_id ?? null,
        targetGroupId,
        personalTeachers,
        res.synced_subgroups ?? null
      );

      if (res.group_id && typeof window !== "undefined") {
        try {
          if (!localStorage.getItem("schedule:groupId")) {
            localStorage.setItem("schedule:groupId", String(res.group_id));
          }
        } catch {}
      }

      window.dispatchEvent(new CustomEvent("classroom-synced", { detail: res }));
      options.onSuccess?.(res, usedCode);
      resolve(res);
    };

    const handleError = (err: any) => {
      if (resolved) return;
      resolved = true;
      const errorObj = err instanceof Error ? err : new Error(String(err || "Помилка авторизації Google"));
      options.onError?.(errorObj);
      reject(errorObj);
    };

    const syncWithToken = () => {
      try {
        const tokenClient = (window as any).google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: CLASSROOM_SCOPES,
          callback: async (resp: any) => {
            if (resp.error || !resp.access_token) {
              handleError(new Error(resp.error || "Авторизацію скасовано"));
              return;
            }
            try {
              const res = await api.classroom.sync({
                access_token: resp.access_token,
                group_id: options.groupId ?? undefined,
                week_start: options.weekStart,
              });
              handleSuccess(res, false, resp.access_token);
            } catch (err) {
              handleError(err);
            }
          },
        });
        tokenClient.requestAccessToken();
      } catch (err) {
        handleError(err);
      }
    };

    const syncWithCode = () => {
      try {
        const codeClient = (window as any).google.accounts.oauth2.initCodeClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: CLASSROOM_SCOPES,
          ux_mode: "popup",
          callback: async (resp: any) => {
            if (resp.error || !resp.code) {
              handleError(new Error(resp.error || "Авторизацію скасовано"));
              return;
            }
            try {
              const res = await api.classroom.sync({
                code: resp.code,
                group_id: options.groupId ?? undefined,
                week_start: options.weekStart,
              });
              handleSuccess(res, true);
            } catch (err: any) {
              const errMsg = err instanceof Error ? err.message : String(err || "");
              if (errMsg.includes("GOOGLE_CLIENT_SECRET")) {
                syncWithToken();
                return;
              }
              handleError(err);
            }
          },
        });
        codeClient.requestCode();
      } catch (err) {
        handleError(err);
      }
    };

    if (hasClientSecret) {
      syncWithCode();
    } else {
      syncWithToken();
    }
  });
}
