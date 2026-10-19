"use client";

import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { invalidateScheduleCache } from "../lib/hooks";
import { useToast } from "./ToastProvider";

const GOOGLE_CLIENT_ID =
  process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ||
  "1079868158360-ok75uv5l93pcql2iktfcple97sdu180b.apps.googleusercontent.com";
const SCOPES = [
  "https://www.googleapis.com/auth/classroom.courses.readonly",
  "https://www.googleapis.com/auth/classroom.announcements.readonly",
  "https://www.googleapis.com/auth/classroom.rosters.readonly",
  "https://www.googleapis.com/auth/classroom.coursework.me.readonly",
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
  onSynced: (detectedGroupId: number) => void;
}) {
  const [syncing, setSyncing] = useState(false);
  const [hasClientSecret, setHasClientSecret] = useState<boolean>(false);
  const { showToast } = useToast();

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
      return;
    }
    api.classroom
      .groupStatus(currentGroupId)
      .then((data) => {
        if (data?.last_synced_at) setLastSyncedAt(data.last_synced_at);
        if (data && typeof data.has_client_secret === "boolean") {
          setHasClientSecret(data.has_client_secret);
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

  const handleSyncSuccess = (res: any, usedCode: boolean) => {
    invalidateScheduleCache();
    const switchedGroup = currentGroupId !== null && currentGroupId !== res.group_id;
    onSynced(res.group_id);
    const parts = [`підтягнуто ${res.synced_links} онлайн-пар`];
    if (res.synced_tasks > 0) parts.push(`${res.synced_tasks} завдань`);
    if (res.synced_students > 0) parts.push(`${res.synced_students} студентів`);
    const prefix = switchedGroup
      ? `Перемкнуто на вашу групу ${res.group_name}`
      : `Група ${res.group_name}`;
    const autoNote = usedCode ? " (фонове автооновлення активне)" : "";
    showToast(
      `${prefix}: ${parts.join(", ")}${autoNote}!`,
      "success"
    );
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
            handleSyncSuccess(res, false);
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
            handleSyncSuccess(res, true);
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

  const handleSync = async () => {
    if (!GOOGLE_CLIENT_ID) {
      showToast("Додайте NEXT_PUBLIC_GOOGLE_CLIENT_ID у .env", "error");
      return;
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

  return (
    <button
      type="button"
      onClick={() => void handleSync()}
      disabled={syncing}
      title={
        syncFreshness
          ? `${syncFreshness.text} — натисніть для синхронізації з Google Classroom`
          : "Підтягнути групу та посилання на пари з Google Classroom"
      }
      className="inline-flex h-8 sm:h-9 items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 sm:px-3 text-xs font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
    >
      <span>🎓</span>
      <span className="hidden sm:inline">{syncing ? "Синхронізація..." : "Classroom"}</span>
      {syncFreshness && !syncing && (
        <span className={`h-2 w-2 rounded-full ${syncFreshness.dot}`} />
      )}
    </button>
  );
}
