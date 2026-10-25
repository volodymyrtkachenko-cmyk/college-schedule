"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "../lib/api";
import { invalidateScheduleCache } from "../lib/hooks";
import { useToast } from "./ToastProvider";
import {
  clearClassroomAccessToken,
  getClassroomSilentAuth,
  saveClassroomSyncData,
  useClassroomSubmissions,
} from "../lib/useClassroomSubmissions";

const GOOGLE_CLIENT_ID =
  process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ||
  "1079868158360-ok75uv5l93pcql2iktfcple97sdu180b.apps.googleusercontent.com";
const SCOPES = [
  "https://www.googleapis.com/auth/classroom.courses.readonly",
  "https://www.googleapis.com/auth/classroom.announcements.readonly",
  "https://www.googleapis.com/auth/classroom.rosters.readonly",
  "https://www.googleapis.com/auth/classroom.coursework.me.readonly",
  "https://www.googleapis.com/auth/classroom.student-submissions.me.readonly",
  "https://www.googleapis.com/auth/classroom.coursework.students.readonly",
  "https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly",
  "https://www.googleapis.com/auth/directory.readonly",
].join(" ");

export function ClassroomSyncButton({
  currentGroupId,
  weekStart,
  onSynced,
}: {
  currentGroupId: number | null;
  weekStart?: string;
  onSynced: (detectedGroupId: number, tasks?: any[], lastSyncedAt?: string | null, isSilent?: boolean) => void;
}) {
  const [syncing, setSyncing] = useState(false);
  const [hasClientSecret, setHasClientSecret] = useState<boolean>(false);
  const [needsReconnect, setNeedsReconnect] = useState<boolean>(false);
  const { showToast } = useToast();
  const { linkedEmail, linkedGroupId } = useClassroomSubmissions();

  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  useEffect(() => {
    api.classroom
      .status()
      .then((data) => {
        if (data && typeof data.has_client_secret === "boolean") {
          setHasClientSecret(data.has_client_secret);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!currentGroupId) {
      setLastSyncedAt(null);
      setNeedsReconnect(false);
      return;
    }
    api.classroom
      .groupStatus(currentGroupId)
      .then((data) => {
        if (data?.last_synced_at) setLastSyncedAt(data.last_synced_at);
        if (data && typeof data.has_client_secret === "boolean") {
          setHasClientSecret(data.has_client_secret);
        }
        if (data && typeof data.needs_reconnect === "boolean") {
          setNeedsReconnect(data.needs_reconnect);
        }
      })
      .catch(() => {});
  }, [currentGroupId, syncing]);

  const syncFreshness = (() => {
    if (!lastSyncedAt) return null;
    const diffMin = Math.floor((Date.now() - new Date(lastSyncedAt).getTime()) / 60000);
    if (diffMin < 60) return { dot: "bg-emerald-400", text: `Оновлено ${Math.max(1, diffMin)} хв тому` };
    if (diffMin < 360) return { dot: "bg-amber-400", text: `Оновлено ${Math.floor(diffMin / 60)} год тому` };
    return { dot: "bg-rose-400", text: "Давно не оновлювалось" };
  })();

  const loadGsiScript = (): Promise<void> =>
    new Promise((resolve, reject) => {
      if ((window as any).google?.accounts?.oauth2) return resolve();
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Не вдалося завантажити Google OAuth"));
      document.body.appendChild(script);
    });

  const handleSyncSuccess = (
    res: any,
    usedCode: boolean,
    isSilent = false,
    fallbackAccessToken?: string | null
  ) => {
    invalidateScheduleCache();
    const personalTeachers = [
      ...(res.synced_teacher_names || []),
      ...(res.synced_teacher_tokens || []),
    ];
    const targetGroupId = isSilent && currentGroupId !== res.group_id
      ? (linkedGroupId ?? res.group_id)
      : (res.group_id ?? currentGroupId ?? null);

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
    const switchedGroup = currentGroupId !== null && currentGroupId !== res.group_id;
    if (res?.last_synced_at) {
      setLastSyncedAt(res.last_synced_at);
    }
    // On silent background sync, NEVER switch the viewed group
    onSynced(isSilent ? (currentGroupId ?? res.group_id) : res.group_id, res.tasks, res.last_synced_at, isSilent);
    window.dispatchEvent(new CustomEvent("classroom-synced", { detail: res }));

    if (typeof res?.needs_reconnect === "boolean") {
      setNeedsReconnect(res.needs_reconnect);
    }
    if (!isSilent) {
      const parts = [`підтягнуто ${res.synced_links} онлайн-пар`];
      if (res.synced_tasks > 0) parts.push(`${res.synced_tasks} завдань`);
      if (res.synced_students > 0) parts.push(`${res.synced_students} студентів`);
      const prefix = switchedGroup
        ? `Перемкнуто на вашу групу ${res.group_name}`
        : `Група ${res.group_name}`;
      const autoNote = usedCode ? " (фонове автооновлення активне)" : "";
      const unmappedNote = res.unmapped_tasks && res.unmapped_tasks.length > 0
        ? ` (${res.unmapped_tasks.length} завдань пропущено через відсутність пар у розкладі)`
        : "";
      showToast(
        `${prefix}: ${parts.join(", ")}${autoNote}${unmappedNote}!`,
        "success"
      );
    }
  };

  const syncWithToken = () => {
    try {
      const tokenClient = (window as any).google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: SCOPES,
        callback: async (resp: any) => {
          if (resp.error || !resp.access_token) {
            setSyncing(false);
            return;
          }
          try {
            const res = await api.classroom.sync({
              access_token: resp.access_token,
              group_id: currentGroupId ?? undefined,
              week_start: weekStart,
            });
            handleSyncSuccess(res, false, false, resp.access_token);
          } catch (err) {
            showToast(err instanceof Error ? err.message : "Помилка синхронізації", "error");
          } finally {
            setSyncing(false);
          }
        },
      });
      tokenClient.requestAccessToken();
    } catch (err) {
      setSyncing(false);
      showToast("Не вдалося відкрити вікно авторизації Google", "error");
    }
  };

  const syncWithCode = () => {
    try {
      const codeClient = (window as any).google.accounts.oauth2.initCodeClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: SCOPES,
        ux_mode: "popup",
        callback: async (resp: any) => {
          if (resp.error || !resp.code) {
            setSyncing(false);
            return;
          }
          try {
            const res = await api.classroom.sync({
              code: resp.code,
              group_id: currentGroupId ?? undefined,
              week_start: weekStart,
            });
            handleSyncSuccess(res, true, false);
          } catch (err: any) {
            const errMsg = err instanceof Error ? err.message : String(err || "");
            if (errMsg.includes("GOOGLE_CLIENT_SECRET")) {
              setHasClientSecret(false);
              showToast("Сервер не має GOOGLE_CLIENT_SECRET. Перемикаємося на пряму синхронізацію...", "info");
              syncWithToken();
              return;
            }
            showToast(errMsg || "Помилка синхронізації", "error");
          } finally {
            setSyncing(false);
          }
        },
      });
      codeClient.requestCode();
    } catch (err) {
      setSyncing(false);
      showToast("Не вдалося відкрити вікно авторизації Google", "error");
    }
  };

  const performSilentSync = useCallback(async () => {
    if (!currentGroupId || syncing) return;
    if (!linkedEmail) return;

    // Якщо користувач переглядає іншу групу (не свою прив'язану), НЕ викликаємо персональний sync!
    // Персональні Google OAuth токени належать курсам своєї групи. Для чужої групи
    // завантажуємо лише її публічні завдання з бекенду.
    if (linkedGroupId && currentGroupId !== linkedGroupId) {
      try {
        const data = await api.classroom.groupStatus(currentGroupId);
        if (data?.last_synced_at) setLastSyncedAt(data.last_synced_at);
        if (data?.tasks && Array.isArray(data.tasks)) {
          onSynced(currentGroupId, data.tasks, data.last_synced_at ?? null, true);
        }
      } catch {}
      return;
    }

    const throttleKey = `schedule:last_silent_sync:${currentGroupId}`;
    const now = Date.now();
    try {
      const lastAttempt = sessionStorage.getItem(throttleKey);
      if (lastAttempt && now - Number(lastAttempt) < 15 * 60 * 1000) {
        return;
      }
    } catch {}

    try {
      sessionStorage.setItem(throttleKey, String(now));
    } catch {}

    // Використовуємо збережений у браузері токен або серверний refresh_token
    // без виклику google.accounts.oauth2.initTokenClient у фоні (щоб не миготіло popup-вікно Google)
    const { accessToken, refreshToken } = getClassroomSilentAuth();
    if (accessToken || refreshToken) {
      try {
        const res = await api.classroom.sync({
          access_token: accessToken ?? undefined,
          refresh_token: refreshToken ?? undefined,
          group_id: currentGroupId ?? undefined,
          week_start: weekStart,
        });
        handleSyncSuccess(res, Boolean(refreshToken), true, accessToken);
        return;
      } catch {
        clearClassroomAccessToken();
      }
    }

    // Фолбек: тихо оновлюємо публічний статус та завдання групи з бекенду без жодних вікон Google
    try {
      const data = await api.classroom.groupStatus(currentGroupId);
      if (data?.last_synced_at) setLastSyncedAt(data.last_synced_at);
      if (data?.tasks && Array.isArray(data.tasks)) {
        onSynced(currentGroupId, data.tasks, data.last_synced_at ?? null, true);
      }
    } catch {
      // Silently ignore background network errors
    }
  }, [currentGroupId, weekStart, syncing, linkedEmail, linkedGroupId, onSynced]);

  // 1. Silent sync on initial load / group switch if account was previously linked
  useEffect(() => {
    if (!currentGroupId || !linkedEmail) return;
    const timer = setTimeout(() => {
      void performSilentSync();
    }, 1500);
    return () => clearTimeout(timer);
  }, [currentGroupId, linkedEmail, performSilentSync]);

  // 2. Silent sync on tab visibility change (e.g. user returns to app after checking Classroom)
  useEffect(() => {
    if (!currentGroupId || !linkedEmail) return;
    const handleVis = () => {
      if (document.visibilityState === "visible") {
        void performSilentSync();
      }
    };
    document.addEventListener("visibilitychange", handleVis);
    return () => document.removeEventListener("visibilitychange", handleVis);
  }, [currentGroupId, linkedEmail, performSilentSync]);

  // 3. Periodic silent sync every 15 minutes while app is open
  useEffect(() => {
    if (!currentGroupId || !linkedEmail) return;
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        void performSilentSync();
      }
    }, 15 * 60 * 1000);
    return () => clearInterval(interval);
  }, [currentGroupId, linkedEmail, performSilentSync]);

  const handleSync = async () => {
    if (!GOOGLE_CLIENT_ID) {
      showToast("Додайте NEXT_PUBLIC_GOOGLE_CLIENT_ID у .env", "error");
      return;
    }

    if (typeof window !== "undefined") {
      const host = window.location.hostname;
      const isVercelPreview = host.endsWith(".vercel.app") && !host.startsWith("college-schedule-flame");
      if (isVercelPreview) {
        showToast(
          "Вхід Google працює лише на основному сайті: college-schedule-flame.vercel.app (поточна адреса — прев'ю)",
          "error"
        );
        return;
      }
    }
    setSyncing(true);
    try {
      await loadGsiScript();
      if (hasClientSecret) {
        syncWithCode();
      } else {
        syncWithToken();
      }
    } catch (err) {
      setSyncing(false);
      showToast("Не вдалося підключитися до Google Classroom", "error");
    }
  };

  useEffect(() => {
    const handleTrigger = () => {
      void handleSync();
    };
    window.addEventListener("trigger-classroom-sync", handleTrigger);
    return () => window.removeEventListener("trigger-classroom-sync", handleTrigger);
  }, [hasClientSecret, currentGroupId, weekStart]);

  const isLinked = Boolean(linkedEmail);

  return (
    <button
      type="button"
      onClick={() => void handleSync()}
      disabled={syncing}
      aria-label={isLinked ? "Classroom прив'язано" : "Прив'язати Classroom"}
      title={
        needsReconnect
          ? "Потрібно надати доступ до завдань — натисніть, щоб перепідключити Classroom. Сервер лише читає ваші завдання з Classroom і нічого не змінює"
          : isLinked
            ? `Classroom (прив'язано ${linkedEmail}) — натисніть для синхронізації`
            : "Прив'язати Google Classroom. Сервер лише читає ваші завдання з Classroom і нічого не змінює"
      }
      className={
        needsReconnect
          ? "inline-flex h-8 sm:h-9 items-center gap-1.5 rounded-lg border border-amber-500/50 bg-amber-50 dark:bg-amber-500/15 px-2.5 sm:px-3 text-xs font-semibold text-amber-800 dark:text-amber-300 transition-colors hover:bg-amber-100 dark:hover:bg-amber-500/25 disabled:opacity-50"
          : isLinked
          ? "inline-flex h-8 sm:h-9 items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-50 dark:bg-emerald-500/10 px-2.5 sm:px-3 text-xs font-semibold text-emerald-800 dark:text-emerald-300 transition-colors hover:bg-emerald-100 dark:hover:bg-emerald-500/20 disabled:opacity-50"
          : "inline-flex h-8 sm:h-9 items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-50 dark:bg-sky-500/10 px-2.5 sm:px-3 text-xs font-semibold text-sky-800 dark:text-sky-300 transition-colors hover:bg-sky-100 dark:hover:bg-sky-500/20 disabled:opacity-50"
      }
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
        <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
        <path d="M6 12v5c3 3 9 3 12 0v-5" />
      </svg>
      <span className="hidden sm:inline">
        {syncing
          ? "Синхронізація..."
          : needsReconnect
            ? "Перепідключити Classroom"
            : isLinked
              ? "Classroom"
              : "Прив'язати Classroom"}
      </span>
      {needsReconnect && !syncing ? (
        <span className="h-2 w-2 rounded-full shrink-0 bg-amber-400 animate-pulse" />
      ) : isLinked && !syncing ? (
        <span
          title={`Classroom прив'язано (${linkedEmail})`}
          className="h-2 w-2 rounded-full shrink-0 bg-emerald-400"
        />
      ) : null}
    </button>
  );
}
