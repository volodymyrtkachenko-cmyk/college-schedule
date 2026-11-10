"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "../lib/api";
import { invalidateScheduleCache } from "../lib/hooks";
import { useToast } from "./ToastProvider";
import {
  clearClassroomAccessToken,
  getClassroomSilentAuth,
  saveClassroomSyncData,
  setClassroomNeedsRelink,
  syncPersonalSubmissions,
  useClassroomSubmissions,
} from "../lib/useClassroomSubmissions";
import { requestClassroomAuth } from "../lib/classroomAuth";

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
  const { showToast } = useToast();
  const { linkedEmail, linkedGroupId } = useClassroomSubmissions();

  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  useEffect(() => {
    if (!currentGroupId) {
      setLastSyncedAt(null);
      return;
    }
    api.classroom
      .groupStatus(currentGroupId)
      .then((data) => {
        if (data?.last_synced_at) setLastSyncedAt(data.last_synced_at);
      })
      .catch(() => {});
  }, [currentGroupId, syncing]);

  const handleSyncSuccess = useCallback(
    (
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
      const targetGroupId = res.group_id ?? linkedGroupId ?? currentGroupId ?? null;

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
      const switchedGroup = currentGroupId !== null && currentGroupId !== res.group_id;
      if (res?.last_synced_at) {
        setLastSyncedAt(res.last_synced_at);
      }
      // On silent background sync, NEVER switch the viewed group
      onSynced(isSilent ? (currentGroupId ?? res.group_id) : res.group_id, res.tasks, res.last_synced_at, isSilent);
      window.dispatchEvent(new CustomEvent("classroom-synced", { detail: { ...res, is_silent: isSilent } }));

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
    },
    [currentGroupId, linkedGroupId, onSynced, showToast]
  );

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
        if (data?.requires_auth === false) {
          try {
            localStorage.setItem("schedule:classroom_linked_group_id", String(currentGroupId));
            window.dispatchEvent(new Event("classroom-linked-change"));
            window.dispatchEvent(new Event("classroom-access-changed"));
          } catch {}
        }
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

    // 1. Спочатку пробуємо тихо оновити персональні здачі студента через легкий endpoint (без спливаючих вікон)
    try {
      const personalOk = await syncPersonalSubmissions(currentGroupId);
      if (personalOk) {
        const data = await api.classroom.groupStatus(currentGroupId);
        if (data?.last_synced_at) setLastSyncedAt(data.last_synced_at);
        if (data?.tasks && Array.isArray(data.tasks) && data.tasks.length > 0) {
          onSynced(currentGroupId, data.tasks, data.last_synced_at ?? null, true);
        }
        return;
      }
    } catch {}

    // 2. Якщо є збережений короткоживучий access_token або серверний google_user_id, пробуємо тиху синхронізацію Classroom
    const { accessToken, googleUserId } = getClassroomSilentAuth();
    if (accessToken || googleUserId) {
      try {
        const res = await api.classroom.sync({
          access_token: accessToken ?? undefined,
          google_user_id: googleUserId ?? undefined,
          email: linkedEmail && linkedEmail.includes("@") ? linkedEmail : undefined,
          group_id: currentGroupId ?? undefined,
          week_start: weekStart,
        });
        if ((res as any)?.needs_relink) {
          setClassroomNeedsRelink(true, (res as any).reason_code || (res as any).error);
          return;
        }
        setClassroomNeedsRelink(false);
        handleSyncSuccess(res, true, true, accessToken);
        return;
      } catch (err: any) {
        clearClassroomAccessToken();
        if (err?.status === 400 || err?.status === 401) {
          setClassroomNeedsRelink(true);
        }
      }
    }

    // Фолбек: тихо оновлюємо публічний статус та завдання групи з бекенду без жодних вікон Google
    try {
      const data = await api.classroom.groupStatus(currentGroupId);
      if (data?.last_synced_at) setLastSyncedAt(data.last_synced_at);
      if ((data as any)?.needs_relink && linkedGroupId === currentGroupId) {
        setClassroomNeedsRelink(true, (data as any).reason_code || (data as any).error);
      }
      if (data?.tasks && Array.isArray(data.tasks)) {
        onSynced(currentGroupId, data.tasks, data.last_synced_at ?? null, true);
      }
    } catch {
      // Silently ignore background network errors
    }
  }, [currentGroupId, weekStart, syncing, linkedEmail, linkedGroupId, onSynced, handleSyncSuccess]);

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

  const handleSync = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      await requestClassroomAuth({
        groupId: currentGroupId,
        weekStart,
        hint: linkedEmail && linkedEmail.includes("@") ? linkedEmail : undefined,
        onSuccess: (res, usedCode) => {
          handleSyncSuccess(res, usedCode, false);
        },
        onError: (err) => {
          showToast(err.message || "Помилка синхронізації", "error");
        },
      });
    } catch {
      // Помилка вже оброблена у колбеку onError
    } finally {
      setSyncing(false);
    }
  }, [syncing, currentGroupId, weekStart, linkedEmail, handleSyncSuccess, showToast]);

  useEffect(() => {
    const handleTrigger = () => {
      void handleSync();
    };
    window.addEventListener("trigger-classroom-sync", handleTrigger);
    return () => window.removeEventListener("trigger-classroom-sync", handleTrigger);
  }, [handleSync]);

  const isLinked = Boolean(linkedEmail);

  return (
    <button
      type="button"
      onClick={() => void handleSync()}
      disabled={syncing}
      aria-label={isLinked ? "Classroom прив'язано" : "Прив'язати Classroom"}
      title={
        isLinked
          ? `Classroom (прив'язано ${linkedEmail}) — натисніть для синхронізації`
          : "Прив'язати Google Classroom. Сервер лише читає ваші завдання з Classroom і нічого не змінює"
      }
      className={
        isLinked
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
          : isLinked
            ? "Classroom"
            : "Прив'язати Classroom"}
      </span>
      {isLinked && !syncing ? (
        <span
          title={`Classroom прив'язано (${linkedEmail})`}
          className="h-2 w-2 rounded-full shrink-0 bg-emerald-400"
        />
      ) : null}
    </button>
  );
}
