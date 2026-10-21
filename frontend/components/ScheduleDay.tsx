"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ScheduleResponse, Lesson } from "../lib/api";
import { buildTelegramShareText } from "../lib/format";
import { useToast } from "./ToastProvider";
import { LessonCard, QuickJumpTarget } from "./LessonCard";
import { shareScheduleAsImage } from "../lib/shareImage";
import { ScheduleCompactDay } from "./ScheduleCompactDay";

const KYIV_DATE_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" });
const KYIV_TIME_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Kyiv",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const fmt = (value: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("uk-UA", options).format(new Date(`${value}T12:00:00`));

function parseMin(t?: string): number | null {
  if (!t) return null;
  const [h, m] = t.trim().split(":").map(Number);
  return Number.isNaN(h) || Number.isNaN(m) ? null : h * 60 + m;
}

export function ViewModeSwitcher({
  mode,
  onChange,
}: {
  mode: "compact" | "detailed";
  onChange: (m: "compact" | "detailed") => void;
}) {
  return (
    <div className="hidden lg:inline-flex items-center rounded-xl border border-sys-border bg-sys-surface p-0.5 text-xs">
      <button
        type="button"
        onClick={() => onChange("compact")}
        title="Компактний режим розкладу"
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${
          mode === "compact"
            ? "bg-sys-accent/15 text-sys-accent border border-sys-accent/30 font-semibold"
            : "text-sys-text-secondary hover:text-sys-text-primary border border-transparent"
        }`}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
        <span>Компактний</span>
      </button>
      <button
        type="button"
        onClick={() => onChange("detailed")}
        title="Детальний режим розкладу"
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${
          mode === "detailed"
            ? "bg-sys-accent/15 text-sys-accent border border-sys-accent/30 font-semibold"
            : "text-sys-text-secondary hover:text-sys-text-primary border border-transparent"
        }`}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="3" y1="9" x2="21" y2="9" />
          <line x1="9" y1="21" x2="9" y2="9" />
        </svg>
        <span>Детальний</span>
      </button>
    </div>
  );
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
  desktopViewMode = "detailed",
  onDesktopViewModeChange,
  onOpenTasksDrawer,
  taskCount = 0,
  weekDays,
  selectedDayIndex,
  onSelectDayIndex,
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
  desktopViewMode?: "compact" | "detailed";
  onDesktopViewModeChange?: (mode: "compact" | "detailed") => void;
  onOpenTasksDrawer?: () => void;
  taskCount?: number;
  weekDays?: { index: number; iso: string; name: string; dateStr: string }[];
  selectedDayIndex?: number;
  onSelectDayIndex?: (index: number) => void;
}) {
  const { showToast } = useToast();
  const [kyivNow, setKyivNow] = useState<{ dateIso: string; minutes: number } | null>(null);

  useEffect(() => {
    const update = () => {
      const now = new Date();
      setKyivNow({
        dateIso: KYIV_DATE_FMT.format(now),
        minutes: parseMin(KYIV_TIME_FMT.format(now)) ?? 0,
      });
    };
    update();
    const id = setInterval(update, 30_000);
    return () => clearInterval(id);
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

      const result = await shareScheduleAsImage(schedule, scheduleMode, ownerLabel, weekNumber);
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

  const orderedLessons = useMemo(() => {
    return [...schedule.lessons].sort(
      (left, right) => left.lesson_number - right.lesson_number || left.id - right.id,
    );
  }, [schedule.lessons]);

  const liveLessonId = useMemo(() => {
    if (!isToday || !kyivNow) return null;
    return orderedLessons.find((l) => {
      const [s, e] = l.time.split(/[-–—]/).map(parseMin);
      return s !== null && e !== null && kyivNow.minutes >= s && kyivNow.minutes < e && !l.is_cancelled;
    })?.id ?? null;
  }, [isToday, kyivNow, orderedLessons]);

  const nextLessonId = useMemo(() => {
    if (!isToday || !kyivNow || liveLessonId) return null;
    return orderedLessons.find((l) => {
      const [s] = l.time.split(/[-–—]/).map(parseMin);
      return s !== null && kyivNow.minutes < s && !l.is_cancelled;
    })?.id ?? null;
  }, [isToday, kyivNow, liveLessonId, orderedLessons]);

  const firstStart = orderedLessons.length > 0 ? parseMin(orderedLessons[0].time.split(/[-–—]/)[0]) : null;
  const isBeforeDayStart = Boolean(
    kyivNow &&
    kyivNow.dateIso === schedule.date &&
    firstStart !== null &&
    kyivNow.minutes < firstStart &&
    kyivNow.minutes >= firstStart - 120
  );
  const timeToStart = isBeforeDayStart && firstStart !== null && kyivNow ? firstStart - kyivNow.minutes : 0;

  const renderDetailedCards = () => {
    if (!orderedLessons.length) {
      return (
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
      );
    }

    return (
      <motion.div
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
                hidden: { opacity: 0, y: 8 },
                visible: { opacity: 1, y: 0, transition: { duration: 0.18, ease: [0.2, 0, 0, 1] } },
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
                isNext={lesson.id === nextLessonId}
                scheduleMode={scheduleMode}
                canEdit={canEdit}
                onEdit={onEdit}
                movingLesson={movingLesson}
                onMoveSelect={onMoveSelect}
                onCopySelect={onCopySelect}
                onCancelDated={onCancelDated}
                onRestoreDated={onRestoreDated}
                onQuickJump={onQuickJump}
              />
            </motion.div>
          );
        })}
      </motion.div>
    );
  };

  return (
    <section className="min-w-0">
      <header className={`mb-3.5 flex items-center justify-between gap-2 px-0 ${mode === "week" ? "min-h-[56px]" : "pt-1"} ${hideHeaderOnMobile ? "hidden sm:flex" : ""}`}>
        {mode === "day" ? (
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap items-baseline gap-2">
              <div className="flex items-center gap-2.5">
                <h2 className="text-xl sm:text-2xl lg:text-[26px] font-bold capitalize tracking-tight text-sys-text-primary">
                  {fmt(schedule.date, { weekday: "long" })}<span className="font-normal text-sys-text-secondary">,</span>
                </h2>
                {isToday && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border border-sys-border bg-sys-surface text-sys-text-secondary">
                    <span className="w-1.5 h-1.5 rounded-full bg-sys-accent" />
                    Сьогодні
                  </span>
                )}
              </div>
              <span className="text-sm sm:text-base lg:text-lg font-medium text-sys-text-secondary">
                {fmt(schedule.date, { day: "numeric", month: "long" })}
              </span>
            </div>
          </div>
        ) : (
          <div className="flex flex-col justify-center min-h-[56px] min-w-0 flex-1">
            <div className="flex items-center justify-between gap-1">
              <h2 className="text-base sm:text-lg font-bold capitalize tracking-tight truncate text-sys-text-primary">
                {fmt(schedule.date, { weekday: "long" })}
              </h2>
              {isToday && (
                <span className="shrink-0 px-2 py-0.5 rounded-full border border-sys-border bg-sys-surface text-[11px] font-medium text-sys-text-secondary inline-flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-sys-accent" />
                  Сьогодні
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs font-medium text-sys-text-secondary">
                {fmt(schedule.date, { day: "numeric", month: "short" })}
              </span>
            </div>
          </div>
        )}

        {mode === "day" && (
          <div className="flex items-center gap-2">
            {/* Slide-over Tasks button in compact mode (desktop) */}
            {desktopViewMode === "compact" && onOpenTasksDrawer && (
              <button
                type="button"
                onClick={onOpenTasksDrawer}
                className="hidden lg:inline-flex items-center gap-1.5 px-3 h-9 rounded-xl border border-transparent text-xs font-semibold text-sys-text-secondary hover:text-sys-text-primary hover:bg-sys-surface transition-colors cursor-pointer"
                title="Відкрити список завдань"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M16 4h2a2 2 0 0 1 2 2v14l-8-4-8 4V6a2 2 0 0 1 2-2h2" />
                  <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
                </svg>
                <span>Завдання{taskCount > 0 ? ` · ${taskCount}` : ""}</span>
              </button>
            )}

            {/* Desktop Mode Switcher */}
            {onDesktopViewModeChange && (
              <ViewModeSwitcher
                mode={desktopViewMode}
                onChange={onDesktopViewModeChange}
              />
            )}

            {orderedLessons.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => void handleShareImage()}
                  disabled={sharingImage}
                  title="Скопіювати або зберегти розклад як PNG-картинку"
                  aria-label="Поділитися картинкою розкладу"
                  className="h-9 px-3 gap-1.5 flex items-center justify-center rounded-xl border border-sys-borderStrong bg-sys-surface text-xs font-semibold text-sys-text-primary transition-all hover:bg-sys-surfaceHover active:scale-95 disabled:opacity-50"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
                  className="h-9 px-3 gap-1.5 flex items-center justify-center rounded-xl border border-sys-borderStrong bg-sys-surface text-xs font-semibold text-sys-text-primary transition-all hover:bg-sys-surfaceHover active:scale-95"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                    <polyline points="16 6 12 2 8 6" />
                    <line x1="12" y1="2" x2="12" y2="15" />
                  </svg>
                  <span className="hidden sm:inline">Поділитися</span>
                </button>
              </>
            )}
          </div>
        )}
      </header>

      {/* Оголошення про виняток режиму навчання */}
      {schedule.learning_mode_override && (
        <div className="mb-3 flex items-start gap-2.5 rounded-2xl border border-sys-border bg-sys-surface px-3.5 py-2.5 text-xs sm:text-sm shadow-xs">
          <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-sys-border text-sys-text-secondary text-[11px] font-bold">
            !
          </span>
          <div className="min-w-0 flex-1 leading-relaxed">
            <span className="font-semibold text-sys-text-primary">
              {schedule.learning_mode_override.mode === "offline"
                ? "Очне навчання"
                : "Дистанційне навчання"}
            </span>
            <span className="text-xs text-sys-text-secondary ml-2">
              {schedule.learning_mode_override.start === schedule.learning_mode_override.end
                ? fmt(schedule.learning_mode_override.start, { day: "numeric", month: "long" })
                : `${fmt(schedule.learning_mode_override.start, { day: "numeric", month: "short" })} – ${fmt(schedule.learning_mode_override.end, { day: "numeric", month: "short" })}`}
            </span>
            {schedule.learning_mode_override.reason && (
              <p className="mt-0.5 text-xs text-sys-text-secondary">
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

      {/* Compact vs Detailed Render */}
      {mode === "day" && desktopViewMode === "compact" ? (
        <>
          {/* On desktop (>= 1024px): Horizontal tabs and 52px compact rows */}
          <div className="hidden lg:block">
            {weekDays && onSelectDayIndex && (
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 mb-3.5 border-b border-sys-borderSubtle">
                {weekDays.map((d) => {
                  const isActive = d.index === selectedDayIndex;
                  const isTodayTab = d.iso === kyivNow?.dateIso;
                  return (
                    <button
                      key={d.iso}
                      type="button"
                      onClick={() => onSelectDayIndex(d.index)}
                      className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs transition-all cursor-pointer ${
                        isActive
                          ? "bg-sys-accent/15 text-sys-accent border border-sys-accent/30 font-semibold"
                          : "border border-sys-border bg-sys-surface text-sys-text-secondary hover:text-sys-text-primary hover:border-sys-borderStrong font-medium"
                      }`}
                    >
                      <span>{d.name}, {d.dateStr}</span>
                      {isTodayTab && (
                        <span className="w-1.5 h-1.5 rounded-full bg-sys-accent" title="Сьогодні" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
            <ScheduleCompactDay
              schedule={schedule}
              isToday={isToday}
              scheduleMode={scheduleMode}
              onQuickJump={onQuickJump}
            />
          </div>

          {/* On mobile (< 1024px): Standard cards */}
          <div className="lg:hidden">
            {renderDetailedCards()}
          </div>
        </>
      ) : (
        renderDetailedCards()
      )}
    </section>
  );
}
