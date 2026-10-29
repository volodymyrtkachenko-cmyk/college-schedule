"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ScheduleResponse, Lesson } from "../lib/api";
import { buildTelegramShareText } from "../lib/format";
import { useToast } from "./ToastProvider";
import { LessonCard, QuickJumpTarget, getKyivNow, subscribeKyivNow } from "./LessonCard";
import { SchedulePeriodCard, CompactSchedulePeriodCard } from "./SchedulePeriodCard";
import { useTheme } from "../lib/useTheme";

const fmt = (value: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("uk-UA", options).format(new Date(`${value}T12:00:00`));

function parseMin(t?: string): number | null {
  if (!t) return null;
  const [h, m] = t.trim().split(":").map(Number);
  return Number.isNaN(h) || Number.isNaN(m) ? null : h * 60 + m;
}

/** Read-only or editable list of one day's lessons, with Telegram sharing, live break indicator, and cascade motion. */
export function ScheduleDay({
  schedule,
  isToday = false,
  mode = "day",
  scheduleMode = "student",
  canEdit = false,
  onEdit,
  movingLesson,
  onMoveSelect,
  onCopySelect,
  onCancelDated,
  onRestoreDated,
  onQuickJump,
  hideHeaderOnMobile = false,
  weekNumber,
  hideDayTitle = false,
  currentTeacherId,
  currentTeacherName,
  compactPeriod = false,
}: {
  schedule: ScheduleResponse;
  isToday?: boolean;
  mode?: "day" | "week";
  scheduleMode?: "student" | "teacher" | "admin";
  canEdit?: boolean;
  onEdit?: (lesson: Lesson) => void;
  movingLesson?: Lesson | null;
  onMoveSelect?: (lesson: Lesson | null) => void;
  onCopySelect?: (lesson: Lesson) => void;
  onCancelDated?: (lesson: Lesson, date: string) => void;
  onRestoreDated?: (lesson: Lesson, date: string) => void;
  onQuickJump?: (target: QuickJumpTarget) => void;
  hideHeaderOnMobile?: boolean;
  weekNumber?: number | null;
  hideDayTitle?: boolean;
  currentTeacherId?: number | null;
  currentTeacherName?: string | null;
  compactPeriod?: boolean;
}) {
  const { showToast } = useToast();
  const { resolvedTheme } = useTheme();
  const [kyivNow, setKyivNow] = useState<{ dateIso: string; minutes: number } | null>(null);

  useEffect(() => {
    setKyivNow(getKyivNow());
    return subscribeKyivNow(setKyivNow);
  }, []);

  const handleShareDay = async () => {
    const text = buildTelegramShareText(schedule, scheduleMode, weekNumber);
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        showToast("Розклад скопійовано!", "success");
      } else if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ text });
      }
    } catch {
      if (typeof navigator !== "undefined" && navigator.share) {
        try {
          await navigator.share({ text });
        } catch {
          // ignore share dismiss
        }
      }
    }
  };

  const [sharingImage, setSharingImage] = useState(false);

  const handleShareImage = async () => {
    if (sharingImage) return;
    setSharingImage(true);
    try {
      const firstLesson = schedule.lessons[0];
      const ownerLabel =
        scheduleMode === "teacher"
          ? firstLesson?.teacher_name || "Розклад викладача"
          : firstLesson?.group_name
            ? `Група ${firstLesson.group_name}`
            : "Розклад занять";

      const { shareScheduleAsImage } = await import("../lib/shareImage");
      const result = await shareScheduleAsImage(schedule, scheduleMode, ownerLabel, weekNumber, resolvedTheme);
      if (result === "copied") {
        showToast("Картинку скопійовано!", "success");
      } else if (result === "downloaded") {
        showToast("Картинку розкладу завантажено", "success");
      }
    } catch (err) {
      if (err instanceof Error && err.name !== "AbortError") {
        showToast("Не вдалося створити картинку розкладу", "error");
      }
    } finally {
      setSharingImage(false);
    }
  };


  const orderedLessons = [...schedule.lessons].sort(
    (left, right) => left.lesson_number - right.lesson_number || left.id - right.id,
  );

  const firstStart = orderedLessons.length > 0 ? parseMin(orderedLessons[0].time.split(/[-–—]/)[0]) : null;
  const isBeforeDayStart = Boolean(
    kyivNow &&
    kyivNow.dateIso === schedule.date &&
    firstStart !== null &&
    kyivNow.minutes < firstStart &&
    kyivNow.minutes >= firstStart - 120
  );
  const timeToStart = isBeforeDayStart && firstStart !== null && kyivNow ? firstStart - kyivNow.minutes : 0;

  return (
    <section className="min-w-0">
      {(!hideDayTitle || (mode === "day" && orderedLessons.length > 0)) && (
        <header
          className={`mb-3.5 flex items-center ${
            hideDayTitle ? "justify-end" : "justify-between"
          } gap-2 px-0 ${mode === "week" ? "min-h-[56px]" : "pt-1"} ${
            hideHeaderOnMobile ? "hidden sm:flex" : ""
          }`}
        >
          {!hideDayTitle && (
            mode === "day" ? (
              <div className="flex flex-wrap items-center gap-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl sm:text-2xl lg:text-[26px] font-bold capitalize tracking-tight text-sys-text-primary">
                    {fmt(schedule.date, { weekday: "long" })}<span className="font-normal text-sys-text-secondary">,</span>
                  </h2>
                  <span className="text-sm sm:text-base lg:text-lg font-medium text-sys-text-secondary">
                    {fmt(schedule.date, { day: "numeric", month: "long" })}
                  </span>
                  {schedule.is_shortened_day && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/10 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/30 shadow-xs">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                      </svg>
                      <span>Скорочений день (пари по 50 хв)</span>
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex flex-col justify-center min-h-[56px] min-w-0 flex-1">
                <div className="flex items-center justify-between gap-1">
                  <h2 className="text-base sm:text-lg font-bold capitalize tracking-tight truncate text-sys-text-primary">
                    {fmt(schedule.date, { weekday: "long" })}
                  </h2>
                </div>
                <div className="flex items-center justify-between gap-2 mt-0.5">
                  <span className="text-xs font-medium text-sys-text-secondary">
                    {fmt(schedule.date, { day: "numeric", month: "short" })}
                  </span>
                  {schedule.is_shortened_day && (
                    <span className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold bg-amber-500/10 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/30">
                      ⏱ 50 хв
                    </span>
                  )}
                </div>
              </div>
            )
          )}

        {mode === "day" && orderedLessons.length > 0 && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleShareImage()}
              disabled={sharingImage}
              title="Скопіювати або зберегти розклад як PNG-картинку"
              aria-label="Поділитися картинкою розкладу"
              className="h-9 px-3 gap-1.5 flex items-center justify-center rounded-xl border border-sys-border bg-sys-card text-xs font-semibold text-sys-text-secondary transition-colors duration-fast ease-smooth hover:border-sky-500/50 hover:text-sky-700 dark:hover:text-sky-300 hover:bg-sky-50 dark:hover:bg-sky-500/10 active:scale-95 disabled:opacity-50"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-sky-500 dark:text-sky-400 shrink-0">
                <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
                <circle cx="9" cy="9" r="2" />
                <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
              </svg>
              <span className="hidden sm:inline">Зберегти картинку</span>
            </button>
            <button
              type="button"
              onClick={handleShareDay}
              title="Скопіювати розклад"
              aria-label="Скопіювати розклад дня"
              className="h-9 px-3 gap-1.5 flex items-center justify-center rounded-xl border border-sys-border bg-sys-card text-xs font-semibold text-sys-text-secondary transition-colors duration-fast ease-smooth hover:border-emerald-500/50 hover:text-emerald-700 dark:hover:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 active:scale-95"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-500 dark:text-emerald-400 shrink-0">
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                <polyline points="16 6 12 2 8 6" />
                <line x1="12" y1="2" x2="12" y2="15" />
              </svg>
              <span className="hidden sm:inline">Поділитися</span>
            </button>
          </div>
        )}
      </header>
      )}

      {/* Оголошення про виняток режиму навчання */}
      {schedule.learning_mode_override && (
        <div
          className={`mb-3 flex items-start gap-3 rounded-2xl border px-3.5 py-3 text-xs sm:text-sm shadow-xs ${
            schedule.learning_mode_override.mode === "offline"
              ? "border-sys-accent/35 bg-sys-accent/10 text-sys-text-primary"
              : "border-sys-warning/35 bg-sys-warning/10 text-sys-text-primary"
          }`}
        >
          <span
            className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
              schedule.learning_mode_override.mode === "offline"
                ? "bg-sys-accent/20 text-sys-accent"
                : "bg-sys-warning/20 text-sys-warning"
            }`}
          >
            !
          </span>
          <div className="min-w-0 flex-1 whitespace-normal break-words leading-relaxed">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span
                className={`font-bold ${
                  schedule.learning_mode_override.mode === "offline"
                    ? "text-sys-accent"
                    : "text-sys-warning"
                }`}
              >
                {schedule.learning_mode_override.mode === "offline"
                  ? "Очне навчання"
                  : "Дистанційне навчання"}
              </span>
              <span className="text-xs text-sys-text-secondary">
                {schedule.learning_mode_override.start === schedule.learning_mode_override.end
                  ? fmt(schedule.learning_mode_override.start, { day: "numeric", month: "long" })
                  : `${fmt(schedule.learning_mode_override.start, { day: "numeric", month: "short" })} – ${fmt(schedule.learning_mode_override.end, { day: "numeric", month: "short" })}`}
              </span>
            </div>
            {schedule.learning_mode_override.reason && (
              <p className="mt-1 text-xs sm:text-[13px] text-sys-text-secondary whitespace-normal break-words">
                {schedule.learning_mode_override.reason}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Morning pre-lesson indicator */}
      {isBeforeDayStart && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-sys-border bg-sys-card px-4 py-2.5 text-xs text-sys-text-secondary shadow-xs mb-3">
          <div className="flex items-center gap-2">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-sys-accent"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            <span>До початку занять</span>
          </div>
          <div className="flex items-center gap-1.5 text-sys-text-primary font-medium">
            <span>
              {orderedLessons[0].lesson_number}-а пара о {orderedLessons[0].time.split(/[-–—]/)[0]} (через {timeToStart >= 60 ? `${Math.floor(timeToStart / 60)} год${timeToStart % 60 > 0 ? ` ${timeToStart % 60} хв` : ""}` : `${timeToStart} хв`})
            </span>
          </div>
        </div>
      )}

      {orderedLessons.length ? (
        <motion.div
          key={schedule.date}
          initial="hidden"
          animate="visible"
          variants={{
            hidden: {},
            visible: { transition: { staggerChildren: 0.02 } },
          }}
          className="flex flex-col gap-3"
        >
          {orderedLessons.map((lesson, idx) => {
            const lessonKey = `${lesson.id}-${lesson.lesson_number}`;
            const prev = idx > 0 ? orderedLessons[idx - 1] : null;
            const prevEnd = prev ? parseMin(prev.time.split(/[-–—]/)[1]) : null;
            const currStart = parseMin(lesson.time.split(/[-–—]/)[0]);
            const isBreakNow = Boolean(
              kyivNow &&
              kyivNow.dateIso === schedule.date &&
              prev &&
              prev.lesson_number !== lesson.lesson_number &&
              prevEnd !== null &&
              currStart !== null &&
              kyivNow.minutes >= prevEnd &&
              kyivNow.minutes < currStart
            );
            const breakDuration = prevEnd !== null && currStart !== null ? currStart - prevEnd : 0;
            const breakLeft = isBreakNow && currStart !== null && kyivNow ? currStart - kyivNow.minutes : 0;

            return (
              <motion.div
                key={lessonKey}
                variants={{
                  hidden: { opacity: 0 },
                  visible: { opacity: 1, transition: { duration: 0.12, ease: [0.2, 0, 0, 1] } },
                }}
                className="flex flex-col gap-2.5"
              >
                {isBreakNow && (
                  <div className="flex items-center justify-center gap-2 rounded-xl border border-sys-border bg-sys-card/60 px-3 py-1.5 text-xs font-semibold text-sys-text-secondary">
                    <span>☕ Перерва{breakDuration > 0 ? ` ${breakDuration} хв` : ""}</span>
                    <span>•</span>
                    <span>до {lesson.lesson_number}-ї пари залишилось {breakLeft} хв</span>
                  </div>
                )}
                <LessonCard
                  lesson={lesson}
                  targetDate={schedule.date}
                  mode={mode}
                  learningMode={mode === "day" ? (schedule.learning_mode ?? null) : null}
                  scheduleMode={scheduleMode}
                  canEdit={canEdit}
                  onEdit={onEdit}
                  movingLesson={movingLesson}
                  onMoveSelect={onMoveSelect}
                  onCopySelect={onCopySelect}
                  onCancelDated={onCancelDated}
                  onRestoreDated={onRestoreDated}
                  onQuickJump={onQuickJump}
                  currentTeacherId={currentTeacherId}
                  currentTeacherName={currentTeacherName}
                />
              </motion.div>
            );
          })}
        </motion.div>
      ) : schedule.period_info ? (
        compactPeriod ? (
          <CompactSchedulePeriodCard period={schedule.period_info} />
        ) : (
          <SchedulePeriodCard period={schedule.period_info} isToday={isToday} />
        )
      ) : (
        <div className="flex min-h-[200px] flex-col items-center justify-center rounded-2xl border border-dashed border-sys-border bg-sys-card/30 px-6 py-12 text-center text-sys-text-muted">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-sys-bg border border-sys-border text-sys-accent shadow-xs">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" />
              <path d="m9 16 2 2 4-4" />
            </svg>
          </div>
          <p className="text-base font-semibold text-sys-text-primary">Пар немає</p>
          <p className="text-xs text-sys-text-secondary mt-1">Розклад на цей день вільний</p>
        </div>
      )}
    </section>
  );
}
