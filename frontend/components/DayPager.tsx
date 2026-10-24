"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ScheduleResponse, Lesson } from "../lib/api";
import { buildTelegramShareText } from "../lib/format";
import { useToast } from "./ToastProvider";
import { LessonCard, QuickJumpTarget } from "./LessonCard";
import { KYIV_DATE_FMT, KYIV_TIME_FMT, UKR_WEEKDAY_LONG_FMT, UKR_DAY_MONTH_LONG_FMT } from "../lib/date";

function parseMin(t?: string): number | null {
  if (!t) return null;
  const [h, m] = t.trim().split(":").map(Number);
  return Number.isNaN(h) || Number.isNaN(m) ? null : h * 60 + m;
}

function formatDayParts(dateStr?: string): { weekday: string; dayMonth: string } {
  if (!dateStr) return { weekday: "", dayMonth: "" };
  const d = new Date(`${dateStr}T12:00:00`);
  if (isNaN(d.getTime())) return { weekday: "", dayMonth: "" };
  return {
    weekday: UKR_WEEKDAY_LONG_FMT.format(d),
    dayMonth: UKR_DAY_MONTH_LONG_FMT.format(d),
  };
}

export function DayPager({
  schedule,
  todayDate,
  scheduleMode = "student",
  canEdit = false,
  onEdit,
  movingLesson,
  onMoveSelect,
  onCopySelect,
  onCancelDated,
  onRestoreDated,
  onQuickJump,
  onNextDay,
  onPrevDay,
  onJumpToToday,
  daySlideDir = 0,
  shouldReduceMotion = false,
  isWeekend = false,
  isShowingTomorrow = false,
  tomorrowDate,
  onJumpToTomorrow,
  weekNumber,
  currentTeacherId,
  currentTeacherName,
}: {
  schedule: ScheduleResponse;
  todayDate?: string;
  tomorrowDate?: string;
  scheduleMode?: "student" | "teacher" | "admin";
  canEdit?: boolean;
  onEdit?: (lesson: Lesson) => void;
  movingLesson?: Lesson | null;
  onMoveSelect?: (lesson: Lesson | null) => void;
  onCopySelect?: (lesson: Lesson) => void;
  onCancelDated?: (lesson: Lesson, date: string) => void;
  onRestoreDated?: (lesson: Lesson, date: string) => void;
  onQuickJump?: (target: QuickJumpTarget) => void;
  onNextDay?: () => void;
  onPrevDay?: () => void;
  onJumpToToday?: () => void;
  onJumpToTomorrow?: () => void;
  daySlideDir?: number;
  shouldReduceMotion?: boolean;
  isWeekend?: boolean;
  isShowingTomorrow?: boolean;
  weekNumber?: number | null;
  currentTeacherId?: number | null;
  currentTeacherName?: string | null;
}) {
  const { showToast } = useToast();
  const [kyivNow, setKyivNow] = useState<{ dateIso: string; minutes: number } | null>(null);
  const [sharingImage, setSharingImage] = useState(false);

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
        } catch {}
      }
    }
  };

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

  // Touch swipe handling that respects horizontal overflow elements
  const touchStartRef = useRef<{ x: number; y: number; time: number; isHoriz: boolean } | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    let isHoriz = false;
    let curr = e.target as HTMLElement | null;
    while (curr && curr !== e.currentTarget) {
      const overflowX = window.getComputedStyle(curr).overflowX;
      if ((overflowX === "auto" || overflowX === "scroll") && curr.scrollWidth > curr.clientWidth) {
        isHoriz = true;
        break;
      }
      curr = curr.parentElement;
    }

    touchStartRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
      time: Date.now(),
      isHoriz,
    };
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!touchStartRef.current || touchStartRef.current.isHoriz || e.changedTouches.length === 0) return;
    const start = touchStartRef.current;
    const touch = e.changedTouches[0];
    const diffX = touch.clientX - start.x;
    const diffY = touch.clientY - start.y;
    touchStartRef.current = null;

    if (Math.abs(diffX) > 40 && Math.abs(diffX) > Math.abs(diffY) * 1.5) {
      if (diffX < 0) {
        onNextDay?.();
      } else {
        onPrevDay?.();
      }
    }
  };

  const orderedLessons = useMemo(() => {
    return [...schedule.lessons].sort(
      (left, right) => left.lesson_number - right.lesson_number || left.id - right.id,
    );
  }, [schedule.lessons]);

  const isToday = schedule.date === todayDate;
  const isTomorrow = Boolean(tomorrowDate && schedule.date === tomorrowDate);
  const showTodayChip = !isToday && !!onJumpToToday;
  const dayParts = formatDayParts(schedule.date);
  const learningModeBadge = schedule.learning_mode ? (
    <span
      className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-bold ${
        schedule.learning_mode === "offline"
          ? "border-sys-accent/30 bg-sys-accent/10 text-sys-accent"
          : "border-sys-warning/30 bg-sys-warning/10 text-sys-warning"
      }`}
    >
      {schedule.learning_mode === "offline" ? "Очно" : "Дистанційно"}
    </span>
  ) : null;

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
    <div
      id="day-pager-content"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      className="w-full min-w-0 touch-pan-y flex flex-col flex-1 min-h-[calc(100dvh-10rem)]"
    >
      {/* Top context banners: weekend or tomorrow */}
      <AnimatePresence>
        {isWeekend && (
          <motion.div
            initial={{ opacity: 0, height: 0, marginBottom: 0 }}
            animate={{ opacity: 1, height: "auto", marginBottom: 10 }}
            exit={{ opacity: 0, height: 0, marginBottom: 0 }}
            transition={{
              duration: shouldReduceMotion ? 0 : 0.15,
              ease: [0.2, 0, 0, 1],
            }}
            className="overflow-hidden"
          >
            <div className="flex min-h-[48px] max-h-[64px] items-center gap-3 rounded-xl border border-sys-border bg-sys-card px-3.5 py-2 text-xs">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-sys-warning">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              <div className="flex flex-col min-w-0">
                <span className="font-semibold text-sys-text-primary leading-tight">Сьогодні вихідний</span>
                <span className="text-sys-text-secondary text-xs leading-tight mt-0.5">Показано найближчий навчальний день</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>


      {/* Day header: як на ПК — «Понеділок, 20 жовтня» + кнопки поділитися (44x44px) */}
      <header className="mb-3.5 flex items-center justify-between gap-2 px-0 pt-1">
        <div className="flex flex-wrap items-baseline gap-2 min-w-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <h2 className="text-xl font-bold capitalize tracking-tight truncate text-sys-text-primary">
              {dayParts.weekday}<span className="font-normal text-sys-text-secondary">,</span>
            </h2>
          </div>
          <span className="text-sm font-medium text-sys-text-secondary">{dayParts.dayMonth}</span>
          {learningModeBadge}
          {schedule.is_shortened_day && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/30 shadow-xs">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <span>50 хв</span>
            </span>
          )}
        </div>

        {orderedLessons.length > 0 && (
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void handleShareImage()}
              disabled={sharingImage}
              title="Скопіювати або зберегти розклад як PNG-картинку"
              aria-label="Поділитися картинкою розкладу"
              className="flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-sys-border bg-sys-card text-sys-text-secondary transition-colors duration-fast ease-smooth hover:border-sys-accent/40 hover:text-sys-accent active:scale-95 disabled:opacity-50"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
                <circle cx="9" cy="9" r="2" />
                <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
              </svg>
            </button>
            <button
              type="button"
              onClick={handleShareDay}
              title="Скопіювати розклад дня"
              aria-label="Скопіювати розклад дня"
              className="flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-sys-border bg-sys-card text-sys-text-secondary transition-colors duration-fast ease-smooth hover:border-sys-accent/40 hover:text-sys-accent active:scale-95"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                <polyline points="16 6 12 2 8 6" />
                <line x1="12" y1="2" x2="12" y2="15" />
              </svg>
            </button>
          </div>
        )}
      </header>

      {/* Morning pre-lesson indicator (як на ПК) */}
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

      {/* Animated Day Schedule List */}
      <AnimatePresence initial={false} custom={daySlideDir}>
        <motion.div
          key={schedule.date}
          custom={daySlideDir}
          variants={{
            enter: (dir: number) => ({
              x: dir > 0 ? 10 : dir < 0 ? -10 : 0,
              opacity: 0,
            }),
            center: {
              x: 0,
              opacity: 1,
            },
            exit: (dir: number) => ({
              x: dir > 0 ? -10 : dir < 0 ? 10 : 0,
              opacity: 0,
            }),
          }}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{
            duration: shouldReduceMotion ? 0 : 0.18,
            ease: [0.2, 0, 0, 1],
          }}
          className="flex flex-col flex-1 gap-3"
        >
          {orderedLessons.length > 0 ? (
            orderedLessons.map((lesson, idx) => {
              const lessonKey = `${lesson.id}-${lesson.lesson_number}`;
              const prev = idx > 0 ? orderedLessons[idx - 1] : null;
              const prevEnd = prev ? parseMin(prev.time.split(/[-–—]/)[1]) : null;
              const currStart = parseMin(lesson.time.split(/[-–—]/)[0]);
              const isBreakNow = Boolean(
                kyivNow &&
                kyivNow.dateIso === schedule.date &&
                prevEnd !== null &&
                currStart !== null &&
                kyivNow.minutes >= prevEnd &&
                kyivNow.minutes < currStart
              );
              const breakDuration = prevEnd !== null && currStart !== null ? currStart - prevEnd : 0;
              const breakLeft = isBreakNow && currStart !== null && kyivNow ? currStart - kyivNow.minutes : 0;

              return (
                <div key={lessonKey} className="flex flex-col gap-2.5">
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
                    mode="day"
                    learningMode={schedule.learning_mode ?? null}
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
                </div>
              );
            })
          ) : (
            <div className="flex flex-1 min-h-[300px] flex-col items-center justify-center rounded-2xl border border-dashed border-sys-border bg-sys-card/30 px-6 py-12 text-center text-sys-text-muted my-auto">
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
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
