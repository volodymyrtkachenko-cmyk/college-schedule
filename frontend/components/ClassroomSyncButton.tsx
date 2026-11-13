"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { api, invalidateGroupStatusCache } from "../lib/api";
import { useToast } from "./ToastProvider";
import {
  clearClassroomAccessToken,
  getClassroomSilentAuth,
  saveClassroomSyncData,
  syncPersonalSubmissions,
  useClassroomSubmissions,
} from "../lib/useClassroomSubmissions";
import { requestClassroomAuth } from "../lib/classroomAuth";

export function ClassroomSyncButton({
  currentGroupId,
  weekStart,
  onSynced,
  compact = false,
  listenGlobalTrigger = true,
}: {
  currentGroupId: number | null;
  weekStart?: string;
  onSynced: (
    detectedGroupId: number,
    tasks?: any[],
    lastSyncedAt?: string | null,
    isSilent?: boolean
  ) => void;
  compact?: boolean;
  listenGlobalTrigger?: boolean;
}) {
  const [syncing, setSyncing] = useState(false);
  const { showToast } = useToast();
  const { linkedEmail, linkedGroupId } = useClassroomSubmissions();
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const checkAndRefreshScheduleIfUpdated = useCallback(
    (gid: number, serverLastSyncedAt?: string | null) => {
      if (!serverLastSyncedAt || typeof window === "undefined") return;
      try {
        const storageKey = `schedule:last_synced_at:${gid}`;
        localStorage.setItem(storageKey, serverLastSyncedAt);
      } catch {}
    },
    []
  );

  const fetchGroupStatusAndSchedulePoll = useCallback(
    async (gid: number, isRetry = false, allowGroupTasksFallback = true) => {
      try {
        if (isRetry) {
          invalidateGroupStatusCache();
        }
        const data = await api.classroom.groupStatus(gid);
        if (!data) return;

        if (data.last_synced_at) {
          setLastSyncedAt(data.last_synced_at);
          checkAndRefreshScheduleIfUpdated(gid, data.last_synced_at);
        }

        // ВАЖЛИВО: Якщо у студента прив'язана власна пошта (linkedEmail), його завдання
        // завантажуються виключно через syncPersonalSubmissions (з його особистих курсів та підгрупи).
        // Загальні data.tasks із groupStatus використовуємо ТІЛЬКИ якщо власна пошта не прив'язана!
        if (allowGroupTasksFallback && !linkedEmail && data.tasks && Array.isArray(data.tasks)) {
          onSynced(gid, data.tasks, data.last_synced_at ?? null, true);
        } else if (data.last_synced_at) {
          onSynced(gid, undefined, data.last_synced_at, true);
        }

        const isStale =
          data.last_synced_at &&
          Date.now() - new Date(data.last_synced_at).getTime() > 10 * 60 * 1000;

        if (!isRetry && ((data as any).sync_in_progress || isStale)) {
          if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
          pollTimerRef.current = setTimeout(() => {
            void fetchGroupStatusAndSchedulePoll(gid, true, allowGroupTasksFallback);
          }, 5500);
        }
      } catch {}
    },
    [checkAndRefreshScheduleIfUpdated, linkedEmail, onSynced]
  );

  useEffect(() => {
    if (!currentGroupId) {
      setLastSyncedAt(null);
      return;
    }
    void fetchGroupStatusAndSchedulePoll(currentGroupId, false, !linkedEmail);
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, [currentGroupId, linkedEmail, fetchGroupStatusAndSchedulePoll]);

  const performSilentSync = useCallback(async () => {
    if (!currentGroupId || syncing) return;

    // Якщо користувач не прив'язав свою пошту або дивиться чужу групу — беремо лише публічний статус
    if (!linkedEmail || (linkedGroupId && currentGroupId !== linkedGroupId)) {
      await fetchGroupStatusAndSchedulePoll(currentGroupId, true, !linkedEmail);
      return;
    }

    const throttleKey = `schedule:last_silent_sync:${currentGroupId}`;
    const now = Date.now();
    try {
      const lastAttempt = sessionStorage.getItem(throttleKey);
      if (lastAttempt && now - Number(lastAttempt) < 5 * 60 * 1000) {
        await fetchGroupStatusAndSchedulePoll(currentGroupId, false, false);
        return;
      }
      sessionStorage.setItem(throttleKey, String(now));
    } catch {}

    // 1. Завантажуємо ОСОБИСТІ завдання та здачі поточного студента за його власним google_user_id / email
    let personalOk = false;
    try {
      personalOk = await syncPersonalSubmissions(currentGroupId);
    } catch {}

    // 2. Перевіряємо, чи оновилися посилання Meet/Zoom у розкладі групи (БЕЗ перезапису особистих завдань!)
    await fetchGroupStatusAndSchedulePoll(currentGroupId, true, !personalOk);
  }, [
    currentGroupId,
    syncing,
    linkedEmail,
    linkedGroupId,
    fetchGroupStatusAndSchedulePoll,
  ]);

  // 1. Тиха синхронізація при завантаженні / зміні групи (відкладена, щоб не конкурувати за процесор смартфона під час старту)
  useEffect(() => {
    if (!currentGroupId) return;
    let cancelled = false;
    let idleId: number | null = null;
    const timer = setTimeout(() => {
      if (typeof window !== "undefined" && "requestIdleCallback" in window) {
        idleId = (window as any).requestIdleCallback(
          () => {
            if (!cancelled) void performSilentSync();
          },
          { timeout: 2500 }
        );
      } else {
        if (!cancelled) void performSilentSync();
      }
    }, 3200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (idleId !== null && typeof window !== "undefined" && "cancelIdleCallback" in window) {
        (window as any).cancelIdleCallback(idleId);
      }
    };
  }, [currentGroupId, linkedEmail, performSilentSync]);


  // 3. Періодична тиха перевірка кожні 10 хвилин, поки вкладка відкрита
  useEffect(() => {
    if (!currentGroupId) return;
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        void performSilentSync();
      }
    }, 10 * 60 * 1000);
    return () => clearInterval(interval);
  }, [currentGroupId, performSilentSync]);

  const handleSync = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      await requestClassroomAuth({
        groupId: currentGroupId,
        weekStart,
        onSuccess: (res, usedCode) => {
          const switchedGroup =
            currentGroupId !== null && res.group_id && currentGroupId !== res.group_id;
          if (res?.last_synced_at) {
            setLastSyncedAt(res.last_synced_at);
          }
          onSynced(res.group_id ?? currentGroupId, res.tasks, res.last_synced_at, false);

          const parts = [`підтягнуто ${res.synced_links ?? 0} онлайн-пар`];
          if (res.synced_tasks > 0) parts.push(`${res.synced_tasks} завдань`);
          if (res.synced_students > 0) parts.push(`${res.synced_students} студентів`);
          const prefix = switchedGroup
            ? `Перемкнуто на вашу групу ${res.group_name}`
            : `Група ${res.group_name}`;
          const autoNote = usedCode ? " (фонове автооновлення активне)" : "";
          showToast(`${prefix}: ${parts.join(", ")}${autoNote}!`, "success");
        },
        onError: (err) => {
          showToast(err.message || "Не вдалося підключитися до Google Classroom", "error");
        },
      });
    } catch {
      // handled in onError
    } finally {
      setSyncing(false);
    }
  }, [syncing, currentGroupId, weekStart, onSynced, showToast]);

  useEffect(() => {
    if (!listenGlobalTrigger) return;
    const handleTrigger = (e: Event) => {
      if (e.defaultPrevented) return;
      e.preventDefault();
      void handleSync();
    };
    window.addEventListener("trigger-classroom-sync", handleTrigger);
    return () => window.removeEventListener("trigger-classroom-sync", handleTrigger);
  }, [handleSync, listenGlobalTrigger]);

  const isLinked = Boolean(linkedEmail);

  const sizeClass = compact
    ? "inline-flex h-7 items-center gap-1.5 rounded-lg border px-2 text-[11px] font-semibold transition-colors cursor-pointer disabled:opacity-50"
    : "inline-flex h-8 sm:h-9 items-center gap-1.5 rounded-lg border px-2.5 sm:px-3 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50";

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
      className={`${sizeClass} ${
        isLinked
          ? "border-emerald-500/40 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-500/20"
          : "border-sky-500/40 bg-sky-50 dark:bg-sky-500/10 text-sky-800 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-500/20"
      }`}
    >
      <svg width={compact ? "13" : "15"} height={compact ? "13" : "15"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
        <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
        <path d="M6 12v5c3 3 9 3 12 0v-5" />
      </svg>
      <span className={compact ? "" : "hidden sm:inline"}>
        {syncing
          ? "Оновлення..."
          : isLinked
            ? compact
              ? "Оновити"
              : "Classroom"
            : compact
              ? "Підключити"
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
