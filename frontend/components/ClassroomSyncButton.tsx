"use client";

import { useState } from "react";
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
  "https://www.googleapis.com/auth/directory.readonly",
].join(" ");

export function ClassroomSyncButton({
  currentGroupId,
  onSynced,
}: {
  currentGroupId: number | null;
  onSynced: (detectedGroupId: number) => void;
}) {
  const [syncing, setSyncing] = useState(false);
  const { showToast } = useToast();

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

  const handleSync = async () => {
    if (!GOOGLE_CLIENT_ID) {
      showToast("Додайте NEXT_PUBLIC_GOOGLE_CLIENT_ID у .env", "error");
      return;
    }
    setSyncing(true);
    try {
      await loadGsiScript();
      const tokenClient = (window as any).google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: SCOPES,
        callback: async (resp: any) => {
          if (resp.error || !resp.access_token) {
            setSyncing(false);
            return;
          }
          try {
            const res = await api.classroom.sync(resp.access_token, currentGroupId ?? undefined);
            invalidateScheduleCache();
            onSynced(res.group_id);
            const parts = [`підтягнуто ${res.synced_links} онлайн-пар`];
            if (res.synced_tasks > 0) parts.push(`${res.synced_tasks} завдань`);
            if (res.synced_students > 0) parts.push(`${res.synced_students} студентів`);
            showToast(
              `Група ${res.group_name}: ${parts.join(", ")} із Classroom!`,
              "success"
            );
          } catch (err) {
            showToast(err instanceof Error ? err.message : "Помилка синхронізації", "error");
          } finally {
            setSyncing(false);
          }
        },
      });
      tokenClient.requestAccessToken({ prompt: "" });
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
      title="Підтягнути групу та посилання на пари з Google Classroom"
      className="inline-flex h-8 sm:h-9 items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 sm:px-3 text-xs font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
    >
      <span>🎓</span>
      <span className="hidden sm:inline">{syncing ? "Синхронізація..." : "Classroom"}</span>
    </button>
  );
}
