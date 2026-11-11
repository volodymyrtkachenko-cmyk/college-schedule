"use client";

import { useState, useEffect } from "react";
import { useClassroomSubmissions } from "../lib/useClassroomSubmissions";
import { requestClassroomAuth } from "../lib/classroomAuth";
import { useToast } from "./ToastProvider";

export function ClassroomRelinkBanner({ className = "" }: { className?: string }) {
  const { isLinked, needsRelink, relinkReason, linkedEmail, linkedGroupId } = useClassroomSubmissions();
  const [dismissed, setDismissed] = useState(false);
  const [isRelinking, setIsRelinking] = useState(false);
  const { showToast } = useToast();

  useEffect(() => {
    try {
      if (sessionStorage.getItem("schedule:relink_banner_dismissed") === "true") {
        setDismissed(true);
      }
    } catch {}
  }, []);

  if (!isLinked || !needsRelink || dismissed) {
    return null;
  }

  const handleDismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem("schedule:relink_banner_dismissed", "true");
    } catch {}
  };

  const handleRelink = async () => {
    if (isRelinking) return;
    setIsRelinking(true);
    try {
      await requestClassroomAuth({
        groupId: linkedGroupId ?? undefined,
        hint: linkedEmail && linkedEmail.includes("@") ? linkedEmail : undefined,
        forceConsentReset: true,
        onSuccess: (res) => {
          showToast(`Classroom успішно підключено (${res.group_name || ""})!`, "success");
        },
        onError: (err) => {
          showToast(err.message || "Не вдалося оновити підключення", "error");
        },
      });
    } catch (err: any) {
      showToast(err?.message || "Помилка авторизації Google", "error");
    } finally {
      setIsRelinking(false);
    }
  };

  const reasonText =
    relinkReason === "key_changed"
      ? "Ключ шифрування оновлено адміністратором."
      : relinkReason === "missing_scopes"
      ? "Потрібно надати всі дозволи Google Classroom."
      : relinkReason === "revoked"
      ? "Доступ відкликано у Google акаунті."
      : "Для автоматичного оновлення завдань та онлайн-посилань у фоні.";

  return (
    <aside
      role="alert"
      aria-live="polite"
      className={`relative flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-amber-500/35 bg-amber-500/10 p-3.5 sm:px-4 sm:py-3 text-xs text-amber-900 dark:text-amber-100 shadow-xs mb-4 ${className}`}
    >
      <div className="flex items-start sm:items-center gap-2.5 min-w-0 pr-6 sm:pr-0">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-amber-500/20 text-amber-600 dark:text-amber-400 text-sm">
          ⚠️
        </span>
        <div className="min-w-0">
          <p className="font-semibold text-amber-950 dark:text-amber-200">
            Потрібне повторне підключення до Google Classroom
          </p>
          <p className="text-[11px] text-amber-800/90 dark:text-amber-300/80 mt-0.5 leading-relaxed">
            {reasonText} Натисніть «Підключити знову», щоб відновити фонову синхронізацію.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
        <button
          type="button"
          onClick={handleRelink}
          disabled={isRelinking}
          className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-amber-600 dark:bg-amber-500 px-3 text-xs font-bold text-white shadow-xs hover:bg-amber-700 dark:hover:bg-amber-600 active:scale-95 transition-all cursor-pointer disabled:opacity-50"
        >
          {isRelinking ? (
            <span>Підключення...</span>
          ) : (
            <>
              <span>Підключити знову</span>
              <span>→</span>
            </>
          )}
        </button>

        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Закрити сповіщення"
          className="flex h-8 w-8 items-center justify-center rounded-xl text-amber-800/70 hover:bg-amber-500/15 hover:text-amber-950 dark:text-amber-300/70 dark:hover:text-amber-100 transition-colors cursor-pointer"
        >
          ✕
        </button>
      </div>
    </aside>
  );
}
