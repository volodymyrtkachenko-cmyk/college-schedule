"use client";

import { useState } from "react";
import type { ReferenceRecord, ScheduleResponse } from "../../lib/api";
import { formatWeekShareText } from "../../lib/schedule";
import { PeriodIcon, type getPeriodMeta } from "../SchedulePeriodCard";

type PeriodBadgeMeta = ReturnType<typeof getPeriodMeta>;

interface DesktopWeekHeaderBarProps {
  week: ScheduleResponse[];
  mode: "student" | "teacher";
  groupId: number | null;
  teacherId: number | null;
  groups: ReferenceRecord[];
  teachers: ReferenceRecord[];
  weekRange: string;
  currentWeekNumber: number | null;
  weekType: string;
  activeWeekPeriodMeta: PeriodBadgeMeta | null;
  resolvedTheme: "light" | "dark";
  setToast: (msg: string, type?: "success" | "error" | "info") => void;
}

export function DesktopWeekHeaderBar({
  week,
  mode,
  groupId,
  teacherId,
  groups,
  teachers,
  weekRange,
  currentWeekNumber,
  weekType,
  activeWeekPeriodMeta,
  resolvedTheme,
  setToast,
}: DesktopWeekHeaderBarProps) {
  const [sharingWeekImage, setSharingWeekImage] = useState(false);

  const handleShareWeek = async () => {
    if (!week || week.length === 0) return;
    const text = formatWeekShareText({
      week,
      mode,
      groupId,
      teacherId,
      groups,
      teachers,
      weekRange,
      currentWeekNumber,
      weekType,
    });
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        setToast("Розклад усього тижня скопійовано!", "success");
      }
    } catch {
      setToast("Не вдалося скопіювати розклад", "error");
    }
  };

  const handleShareWeekImage = async () => {
    if (!week || week.length === 0 || sharingWeekImage) return;
    setSharingWeekImage(true);
    try {
      const ownerLabel =
        mode === "student"
          ? groups.find((g) => g.id === groupId)?.name
            ? `Група ${groups.find((g) => g.id === groupId)?.name}`
            : "Розклад занять"
          : teachers.find((t) => t.id === teacherId)?.name || "Розклад викладача";

      const { shareWeekScheduleAsImage } = await import("../../lib/shareImage");
      const result = await shareWeekScheduleAsImage(
        week,
        mode,
        ownerLabel,
        weekRange,
        currentWeekNumber,
        resolvedTheme
      );
      if (result === "copied") {
        setToast("Картинку тижня скопійовано!", "success");
      } else if (result === "downloaded") {
        setToast("Картинку розкладу тижня завантажено", "success");
      }
    } catch (err) {
      if (err instanceof Error && err.name !== "AbortError") {
        setToast("Не вдалося створити картинку розкладу тижня", "error");
      }
    } finally {
      setSharingWeekImage(false);
    }
  };

  return (
    <div className="mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl bg-sys-card p-3 sm:px-4 sm:py-3 border border-sys-border shadow-xs">
      <div className="text-[13px] sm:text-sm font-medium text-sys-text-primary flex flex-wrap items-center gap-2">
        {currentWeekNumber ? (
          <>
            <span className="font-bold text-sys-text-primary">
              {currentWeekNumber}-й навчальний тиждень
            </span>
            {weekType !== "both" && (
              <span
                title={
                  weekType === "numerator"
                    ? "Чисельник — непарний тиждень навчального графіка"
                    : "Знаменник — парний тиждень навчального графіка"
                }
                className="inline-flex items-center rounded-md border border-sys-border bg-sys-bg px-2 py-0.5 text-xs font-semibold text-sys-text-secondary cursor-help"
              >
                {weekType === "numerator" ? "Чисельник" : "Знаменник"}
              </span>
            )}
            <span className="text-sys-text-muted">•</span>
            <span className="text-sys-text-secondary font-medium">{weekRange}</span>
          </>
        ) : (
          <>
            <span className="font-bold text-sys-text-primary">{weekRange}</span>
            {weekType !== "both" && (
              <span
                title={
                  weekType === "numerator"
                    ? "Чисельник — непарний тиждень навчального графіка"
                    : "Знаменник — парний тиждень навчального графіка"
                }
                className="inline-flex items-center rounded-md border border-sys-border bg-sys-bg px-2 py-0.5 text-xs font-semibold text-sys-text-secondary cursor-help"
              >
                {weekType === "numerator" ? "Чисельник" : "Знаменник"}
              </span>
            )}
          </>
        )}
        {activeWeekPeriodMeta && (
          <>
            <span className="text-sys-text-muted">•</span>
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border shadow-xs ${activeWeekPeriodMeta.badgeTone}`}>
              <PeriodIcon periodType={activeWeekPeriodMeta.periodType} className="w-3.5 h-3.5 shrink-0" />
              <span>{activeWeekPeriodMeta.title}</span>
            </span>
          </>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={() => void handleShareWeekImage()}
          disabled={sharingWeekImage}
          title="Скопіювати або зберегти розклад тижня як PNG-картинку"
          aria-label="Поділитися картинкою розкладу тижня"
          className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-sys-border bg-sys-card px-3 text-xs font-semibold text-sys-text-secondary hover:border-sky-500/50 hover:text-sky-700 dark:hover:text-sky-300 hover:bg-sky-50 dark:hover:bg-sky-500/10 active:scale-95 transition-colors duration-fast ease-smooth disabled:opacity-50"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-sky-500 dark:text-sky-400 shrink-0">
            <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
            <circle cx="9" cy="9" r="2" />
            <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
          </svg>
          <span>Зберегти картинку</span>
        </button>
        <button
          type="button"
          onClick={handleShareWeek}
          title="Скопіювати розклад усього тижня"
          aria-label="Поділитися розкладом на тиждень"
          className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-sys-border bg-sys-card px-3 text-xs font-semibold text-sys-text-secondary hover:border-emerald-500/50 hover:text-emerald-700 dark:hover:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 active:scale-95 transition-colors duration-fast ease-smooth"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-500 dark:text-emerald-400 shrink-0">
            <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
            <polyline points="16 6 12 2 8 6" />
            <line x1="12" y1="2" x2="12" y2="15" />
          </svg>
          <span>Поділитися</span>
        </button>
      </div>
    </div>
  );
}
