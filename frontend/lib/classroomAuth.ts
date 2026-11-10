"use client";

import { api } from "./api";
import { invalidateScheduleCache } from "./hooks";
import { SITE_HOST, SITE_URL } from "./site";
import { saveClassroomSyncData, setClassroomNeedsRelink } from "./useClassroomSubmissions";

export const GOOGLE_CLIENT_ID =
  process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ||
  "1079868158360-ok75uv5l93pcql2iktfcple97sdu180b.apps.googleusercontent.com";

export const CLASSROOM_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/classroom.courses.readonly",
  "https://www.googleapis.com/auth/classroom.announcements.readonly",
  "https://www.googleapis.com/auth/classroom.rosters.readonly",
  "https://www.googleapis.com/auth/classroom.profile.emails",
  "https://www.googleapis.com/auth/classroom.profile.photos",
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
  hint?: string | null;
  onSuccess?: (res: any, usedCode: boolean) => void;
  onError?: (err: Error) => void;
}

export async function requestClassroomAuth(options: ClassroomAuthOptions = {}): Promise<any> {
  if (!GOOGLE_CLIENT_ID) {
    throw new Error("Додайте NEXT_PUBLIC_GOOGLE_CLIENT_ID у .env");
  }

  // Friendly alert if user is trying to auth from an arbitrary temporary Vercel preview deployment
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    const isVercelPreview = host.endsWith(".vercel.app") && host !== SITE_HOST && !host.startsWith("college-schedule-flame");
    if (isVercelPreview) {
      const prodUrl = `${SITE_URL}/settings?mode=student`;
      const err = new Error(
        `Вхід через Google працює лише на основному сайті: ${SITE_HOST} (поточна адреса — тимчасове прев'ю). Перейдіть на: ${prodUrl}`
      );
      options.onError?.(err);
      return Promise.reject(err);
    }
  }

  await loadGsiScript();

  const rawHint =
    options.hint ??
    (typeof window !== "undefined" ? localStorage.getItem("schedule:classroom_linked_email") : null);
  const validHint = rawHint && rawHint.includes("@") ? rawHint.trim() : undefined;

  return new Promise<any>((resolve, reject) => {
    let resolved = false;

    const handleSuccess = (res: any, usedCode: boolean, fallbackAccessToken?: string | null) => {
      if (resolved) return;
      resolved = true;

      invalidateScheduleCache();
      setClassroomNeedsRelink(false);
      const personalTeachers = [
        ...(res.synced_teacher_names || []),
        ...(res.synced_teacher_tokens || []),
      ];
      const targetGroupId = res.group_id ?? options.groupId ?? null;

      saveClassroomSyncData(
        res.user_email,
        res.personal_tasks ?? res.tasks,
        res.access_token ?? fallbackAccessToken ?? null,
        null,
        res.google_user_id ?? null,
        targetGroupId,
        personalTeachers,
        res.synced_subgroups ?? null
      );

      if (res.group_id && typeof window !== "undefined") {
        try {
          localStorage.setItem("schedule:groupId", String(res.group_id));
          localStorage.setItem("schedule:classroom_linked_group_id", String(res.group_id));
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
          ...(validHint ? { hint: validHint } : {}),
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
        tokenClient.requestAccessToken({ prompt: "select_account consent" });
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
          prompt: "select_account consent",
          ...(validHint ? { hint: validHint } : {}),
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
                handleError(new Error("На сервері не налаштовано GOOGLE_CLIENT_SECRET. Зверніться до адміністратора."));
                return;
              }
              handleError(err);
            }
          },
        });
        // Завжди викликаємо з prompt: "select_account consent", щоб студент бачив вибір акаунта
        // і сервер гарантовано отримував refresh_token.
        (codeClient as any).requestCode({
          prompt: "select_account consent",
          ...(validHint ? { hint: validHint } : {}),
        });
      } catch (err) {
        handleError(err);
      }
    };

    // За замовчуванням завжди запускаємо Authorization Code Flow (syncWithCode),
    // і лише якщо сервер явно поверне помилку відсутності GOOGLE_CLIENT_SECRET — робимо фолбек на Token Flow.
    syncWithCode();
  });
}
