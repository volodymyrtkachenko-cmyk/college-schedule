"use client";

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ScheduleResponse, Lesson } from "../lib/api";
import { buildTelegramShareText } from "../lib/format";
import {
  DESKTOP_DAY_EXIT_CLEANUP_MS,
  DESKTOP_DAY_STAGE_HEIGHT_MS,
  clampStaggerIndex,
  computeDaySwitchChoreography,
} from "../lib/motion";
import { useToast } from "./ToastProvider";
import {
  LessonCard,
  QuickJumpTarget,
  ensureSharedKyivNowSnapshot,
  getSharedKyivNowSnapshot,
  subscribeKyivNow,
} from "./LessonCard";
import type { HeaderLearningModeData, SubjectHubTarget } from "../lib/schedule";
import { LearningModeBadge } from "./schedule/LearningModeBadge";
import { SchedulePeriodCard, CompactSchedulePeriodCard } from "./SchedulePeriodCard";
import { ClockIcon, CoffeeIcon } from "./ui/Icons";
import { useTheme } from "../lib/useTheme";
import {
  UKR_DAY_MONTH_LONG_FMT,
  UKR_DAY_MONTH_SHORT_FMT,
  UKR_WEEKDAY_LONG_FMT,
  calendarDateIsoToUtcDate,
} from "../lib/date";

const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

function parseMin(t?: string): number | null {
  if (!t) return null;
  const [h, m] = t.trim().split(":").map(Number);
  return Number.isNaN(h) || Number.isNaN(m) ? null : h * 60 + m;
}

/** Read-only or editable list of one day’s lessons. */
export const ScheduleDay = memo(function ScheduleDay({
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
  currentGroupName,
  currentTeacherId,
  currentTeacherName,
  compactPeriod = false,
  shouldReduceMotion = false,
  animateOnMount = true,
  daySlideDir = 0,
  dayMotionSeq = 0,
  learningModeBadge = null,
  onOpenSubjectHub,
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
  currentGroupName?: string | null;
  currentTeacherId?: number | null;
  currentTeacherName?: string | null;
  compactPeriod?: boolean;
  shouldReduceMotion?: boolean;
  animateOnMount?: boolean;
  daySlideDir?: number;
  dayMotionSeq?: number;
  learningModeBadge?: HeaderLearningModeData | null;
  onOpenSubjectHub?: (target: SubjectHubTarget) => void;
}) {
  const { showToast } = useToast();
  const { resolvedTheme } = useTheme();
  const [kyivNow, setKyivNow] = useState<{ dateIso: string; minutes: number } | null>(() =>
    getSharedKyivNowSnapshot()
  );

  useEffect(() => {
    const next = ensureSharedKyivNowSnapshot();
    setKyivNow((prev) =>
      prev && prev.dateIso === next.dateIso && prev.minutes === next.minutes ? prev : next
    );
    return subscribeKyivNow(setKyivNow);
  }, []);

  const firstLesson = schedule.lessons[0];
  const ownerLabel =
    scheduleMode === "teacher"
      ? currentTeacherName || firstLesson?.teacher_name || "Розклад викладача"
      : currentGroupName
        ? `Група ${currentGroupName}`
        : firstLesson?.group_name
          ? `Група ${firstLesson.group_name}`
          : "Розклад занять";

  const handleShareDay = async () => {
    const text = buildTelegramShareText(schedule, scheduleMode, weekNumber, ownerLabel);
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


  const { weekdayLabel, dayMonthLabel, dayMonthShortLabel } = useMemo(() => {
    const d = calendarDateIsoToUtcDate(schedule.date);
    return {
      weekdayLabel: UKR_WEEKDAY_LONG_FMT.format(d),
      dayMonthLabel: UKR_DAY_MONTH_LONG_FMT.format(d),
      dayMonthShortLabel: UKR_DAY_MONTH_SHORT_FMT.format(d),
    };
  }, [schedule.date]);

  const titleSlotRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (titleSlotRef.current) {
      titleSlotRef.current.inert = hideDayTitle;
    }
  }, [hideDayTitle]);

  const orderedLessons = useMemo(
    () =>
      [...schedule.lessons].sort(
        (left, right) => left.lesson_number - right.lesson_number || left.id - right.id,
      ),
    [schedule.lessons],
  );

  const currentMotionKey = mode === "day" ? `${schedule.date}-${dayMotionSeq}` : schedule.date;
  const [dayTransition, setDayTransition] = useState<{
    key: string;
    activeSchedule: ScheduleResponse;
    exitingSchedule: ScheduleResponse | null;
    dir: -1 | 1;
    revalidated: boolean;
  }>(() => ({
    key: currentMotionKey,
    activeSchedule: schedule,
    exitingSchedule: null,
    dir: daySlideDir < 0 ? -1 : 1,
    revalidated: false,
  }));

  if (mode !== "day") {
    if (
      dayTransition.key !== currentMotionKey ||
      dayTransition.activeSchedule !== schedule ||
      dayTransition.exitingSchedule !== null
    ) {
      setDayTransition({
        key: currentMotionKey,
        activeSchedule: schedule,
        exitingSchedule: null,
        dir: daySlideDir < 0 ? -1 : 1,
        revalidated: false,
      });
    }
  } else if (currentMotionKey !== dayTransition.key) {
    const resolvedDir: -1 | 1 =
      daySlideDir < 0
        ? -1
        : daySlideDir > 0
          ? 1
          : schedule.date < dayTransition.activeSchedule.date
            ? -1
            : 1;
    const shouldAnimateHandoff =
      animateOnMount &&
      !shouldReduceMotion &&
      schedule.date !== dayTransition.activeSchedule.date;
    setDayTransition({
      key: currentMotionKey,
      activeSchedule: schedule,
      exitingSchedule: shouldAnimateHandoff ? dayTransition.activeSchedule : null,
      dir: resolvedDir,
      revalidated: false,
    });
  } else if (dayTransition.activeSchedule !== schedule) {
    setDayTransition((prev) =>
      prev.activeSchedule === schedule
        ? prev
        : { ...prev, activeSchedule: schedule, revalidated: true }
    );
  }

  const stageRef = useRef<HTMLDivElement | null>(null);
  const activeLayerRef = useRef<HTMLDivElement | null>(null);
  const exitLayerRef = useRef<HTMLDivElement | null>(null);
  const heightAnimRef = useRef<Animation | null>(null);
  const exitTimerRef = useRef<number | null>(null);
  const lastStableHeightRef = useRef<number>(0);

  useEffect(() => {
    if (mode !== "day") return;
    const activeEl = activeLayerRef.current;
    if (!activeEl || typeof ResizeObserver === "undefined") return;
    const updateHeight = () => {
      if (!heightAnimRef.current) {
        const h = activeEl.getBoundingClientRect().height;
        if (h > 0) lastStableHeightRef.current = h;
      }
    };
    updateHeight();
    const ro = new ResizeObserver(updateHeight);
    ro.observe(activeEl);
    return () => ro.disconnect();
  }, [mode, dayTransition.key]);

  useEffect(() => {
    const stageEl = stageRef.current;
    return () => {
      if (exitTimerRef.current !== null) {
        window.clearTimeout(exitTimerRef.current);
        exitTimerRef.current = null;
      }
      if (heightAnimRef.current) {
        heightAnimRef.current.cancel();
        heightAnimRef.current = null;
      }
      if (stageEl) {
        stageEl.style.overflow = "";
      }
    };
  }, []);

  const prevHeightKeyRef = useRef<string>(dayTransition.key);
  const prevActiveScheduleRef = useRef<ScheduleResponse>(dayTransition.activeSchedule);

  useIsomorphicLayoutEffect(() => {
    const prevKey = prevHeightKeyRef.current;
    const prevSchedule = prevActiveScheduleRef.current;
    prevHeightKeyRef.current = dayTransition.key;
    prevActiveScheduleRef.current = dayTransition.activeSchedule;

    if (prevKey !== dayTransition.key || prevSchedule === dayTransition.activeSchedule) {
      return;
    }

    if (mode !== "day") return;
    const stageEl = stageRef.current;
    const activeEl = activeLayerRef.current;
    if (!stageEl || !activeEl) return;

    const toHeight = activeEl.getBoundingClientRect().height;
    if (heightAnimRef.current) {
      const liveHeight = stageEl.getBoundingClientRect().height;
      heightAnimRef.current.cancel();
      heightAnimRef.current = null;

      const prefersReduce =
        shouldReduceMotion ||
        (typeof window !== "undefined" &&
          typeof window.matchMedia === "function" &&
          window.matchMedia("(prefers-reduced-motion: reduce)").matches);
      const isDesktopViewport =
        typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(min-width: 1024px)").matches;

      if (
        !prefersReduce &&
        isDesktopViewport &&
        liveHeight > 0 &&
        toHeight > 0 &&
        Math.abs(liveHeight - toHeight) > 1 &&
        typeof stageEl.animate === "function"
      ) {
        stageEl.style.overflow = "clip";
        const anim = stageEl.animate(
          [{ height: `${liveHeight}px` }, { height: `${toHeight}px` }],
          {
            duration: DESKTOP_DAY_STAGE_HEIGHT_MS,
            easing: "cubic-bezier(0.22, 1, 0.36, 1)",
          }
        );
        heightAnimRef.current = anim;
        const clearStageAnim = () => {
          if (heightAnimRef.current === anim) {
            heightAnimRef.current = null;
            stageEl.style.overflow = "";
          }
        };
        anim.onfinish = clearStageAnim;
        anim.oncancel = clearStageAnim;
      } else {
        stageEl.style.overflow = "";
      }
    }

    if (toHeight > 0) {
      lastStableHeightRef.current = toHeight;
    }
  }, [dayTransition.key, dayTransition.activeSchedule, mode, shouldReduceMotion]);

  useIsomorphicLayoutEffect(() => {
    if (exitTimerRef.current !== null) {
      window.clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }

    if (mode !== "day" || !dayTransition.exitingSchedule) {
      return;
    }

    const activeTransitionKey = dayTransition.key;
    const exitEl = exitLayerRef.current;
    if (exitEl) {
      exitEl.setAttribute("inert", "");
    }

    const stageEl = stageRef.current;
    const activeEl = activeLayerRef.current;
    const prefersReduce =
      shouldReduceMotion ||
      (typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    const isDesktopViewport =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(min-width: 1024px)").matches;

    const choreography = computeDaySwitchChoreography(
      dayTransition.exitingSchedule.lessons.length,
      dayTransition.activeSchedule.lessons.length,
      dayTransition.dir
    );

    if (stageEl && activeEl && !prefersReduce && isDesktopViewport) {
      let fromHeight = 0;
      if (heightAnimRef.current) {
        fromHeight = stageEl.getBoundingClientRect().height;
        heightAnimRef.current.cancel();
        heightAnimRef.current = null;
      } else {
        fromHeight =
          exitEl?.getBoundingClientRect().height || lastStableHeightRef.current;
      }

      const toHeight = activeEl.getBoundingClientRect().height;
      if (toHeight > 0) {
        lastStableHeightRef.current = toHeight;
      }

      if (
        fromHeight > 0 &&
        toHeight > 0 &&
        Math.abs(fromHeight - toHeight) > 1 &&
        typeof stageEl.animate === "function"
      ) {
        stageEl.style.overflow = "clip";
        const anim = stageEl.animate(
          [{ height: `${fromHeight}px` }, { height: `${toHeight}px` }],
          {
            duration: choreography.stageHeightDurationMs || DESKTOP_DAY_STAGE_HEIGHT_MS,
            easing: "cubic-bezier(0.22, 1, 0.36, 1)",
          }
        );
        heightAnimRef.current = anim;
        const clearStageAnim = () => {
          if (heightAnimRef.current === anim) {
            heightAnimRef.current = null;
            stageEl.style.overflow = "";
          }
        };
        anim.onfinish = clearStageAnim;
        anim.oncancel = clearStageAnim;
      } else {
        stageEl.style.overflow = "";
      }
    }

    exitTimerRef.current = window.setTimeout(() => {
      exitTimerRef.current = null;
      setDayTransition((prev) =>
        prev.key === activeTransitionKey && prev.exitingSchedule
          ? { ...prev, exitingSchedule: null }
          : prev
      );
    }, choreography.exitCleanupMs || DESKTOP_DAY_EXIT_CLEANUP_MS);
  }, [dayTransition.key]);

  const isDesktopDayEnter = mode === "day" && animateOnMount && !shouldReduceMotion;
  const effectiveDir = dayTransition.dir;

  const headerClassName = `mb-3.5 flex items-center justify-between gap-2 px-0 ${mode === "week" ? "min-h-[56px]" : "pt-1"} ${
    hideHeaderOnMobile ? "hidden sm:flex" : ""
  }`;

  const headerContent = (
    <>
      {mode === "day" ? (
        <div
          ref={titleSlotRef}
          data-hidden={hideDayTitle ? "true" : "false"}
          aria-hidden={hideDayTitle || undefined}
          className="schedule-day-title-slot flex flex-wrap items-center gap-2.5 min-w-0 flex-1"
        >
          <div
            key={isDesktopDayEnter ? currentMotionKey : undefined}
            className={
              isDesktopDayEnter
                ? "desktop-day-header-enter flex flex-wrap items-center gap-2"
                : "flex flex-wrap items-center gap-2"
            }
            style={
              isDesktopDayEnter
                ? ({ "--lesson-slide-dir": effectiveDir } as React.CSSProperties)
                : undefined
            }
          >
            <h2 className="w-fit text-xl sm:text-2xl lg:text-[26px] font-bold capitalize tracking-tight text-sys-text-primary">
              {weekdayLabel}<span className="font-normal text-sys-text-secondary">,</span>
            </h2>
            <span className="text-sm sm:text-base lg:text-lg font-medium text-sys-text-secondary">
              {dayMonthLabel}
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
            <LearningModeBadge data={learningModeBadge} className="hidden lg:inline-flex" />
          </div>
        </div>
      ) : !hideDayTitle ? (
        <div className="flex flex-col justify-center min-h-[56px] min-w-0 flex-1">
          <div className="flex items-center justify-between gap-1">
            <h2 className="text-base sm:text-lg font-bold capitalize tracking-tight truncate text-sys-text-primary">
              {weekdayLabel}
            </h2>
          </div>
          <div className="flex items-center justify-between gap-2 mt-0.5">
            <span className="text-xs font-medium text-sys-text-secondary">
              {dayMonthShortLabel}
            </span>
            {schedule.is_shortened_day && (
              <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-semibold bg-amber-500/10 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/30">
                <ClockIcon className="w-3 h-3 shrink-0" />
                <span>50 хв</span>
              </span>
            )}
          </div>
        </div>
      ) : null}

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
    </>
  );

  const renderDayBody = (
    targetSchedule: ScheduleResponse,
    phase: "static" | "enter" | "exit",
    dir: -1 | 1,
    counterpartCount: number,
    hasExitingLayer: boolean
  ) => {
    const orderedTargetLessons = [...targetSchedule.lessons].sort(
      (left, right) => left.lesson_number - right.lesson_number || left.id - right.id,
    );
    const firstTargetStart =
      orderedTargetLessons.length > 0
        ? parseMin(orderedTargetLessons[0].time.split(/[-–—]/)[0])
        : null;
    const isTargetBeforeStart = Boolean(
      kyivNow &&
      kyivNow.dateIso === targetSchedule.date &&
      firstTargetStart !== null &&
      kyivNow.minutes < firstTargetStart &&
      kyivNow.minutes >= firstTargetStart - 120
    );
    const targetTimeToStart =
      isTargetBeforeStart && firstTargetStart !== null && kyivNow
        ? firstTargetStart - kyivNow.minutes
        : 0;

    const emptyOrPeriodContent = targetSchedule.period_info ? (
      compactPeriod ? (
        <CompactSchedulePeriodCard period={targetSchedule.period_info} />
      ) : (
        <SchedulePeriodCard period={targetSchedule.period_info} isToday={isToday} />
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
    );

    const motionClass =
      phase === "exit"
        ? " desktop-lesson-exit"
        : phase === "enter"
          ? " desktop-lesson-enter"
          : "";
    const baseDelay = phase === "enter" ? (hasExitingLayer ? "65ms" : "0ms") : undefined;

    return (
      <>
        {isTargetBeforeStart && (
          <div
            className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl border border-sys-border bg-sys-card px-4 py-2.5 text-xs text-sys-text-secondary shadow-xs mb-3${motionClass}`}
            style={
              phase !== "static"
                ? ({
                    "--lesson-index": 0,
                    "--lesson-slide-dir": dir,
                    ...(baseDelay ? { "--lesson-base-delay": baseDelay } : {}),
                  } as React.CSSProperties)
                : undefined
            }
          >
            <div className="flex items-center gap-2 shrink-0">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-sys-accent"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              <span>До початку занять</span>
            </div>
            {orderedTargetLessons[0] && targetTimeToStart !== null && (
              <div className="flex items-center gap-1.5 text-sys-text-primary font-medium min-w-0">
                <span className="leading-snug">
                  <span className="whitespace-nowrap">{orderedTargetLessons[0].lesson_number}-а пара о {orderedTargetLessons[0].time.split(/[-–—]/)[0]}</span>{" "}
                  <span className="whitespace-nowrap">(через {targetTimeToStart >= 60 ? `${Math.floor(targetTimeToStart / 60)} год${targetTimeToStart % 60 > 0 ? ` ${targetTimeToStart % 60} хв` : ""}` : `${targetTimeToStart} хв`})</span>
                </span>
              </div>
            )}
          </div>
        )}

        {orderedTargetLessons.length ? (
          <div className="schedule-day-stack flex flex-col">
            {orderedTargetLessons.map((lesson, idx) => {
              const lessonKey = `${lesson.id}-${lesson.lesson_number}`;
              const prev = idx > 0 ? orderedTargetLessons[idx - 1] : null;
              const prevEnd = prev ? parseMin(prev.time.split(/[-–—]/)[1]) : null;
              const currStart = parseMin(lesson.time.split(/[-–—]/)[0]);
              const isBreakNow = Boolean(
                kyivNow &&
                kyivNow.dateIso === targetSchedule.date &&
                prev &&
                prev.lesson_number !== lesson.lesson_number &&
                prevEnd !== null &&
                currStart !== null &&
                kyivNow.minutes >= prevEnd &&
                kyivNow.minutes < currStart
              );
              const breakDuration = prevEnd !== null && currStart !== null ? currStart - prevEnd : 0;
              const breakLeft = isBreakNow && currStart !== null && kyivNow ? currStart - kyivNow.minutes : 0;

              const rowStyle =
                phase === "exit"
                  ? ({
                      "--lesson-index": clampStaggerIndex(idx),
                      "--lesson-slide-dir": dir,
                      "--lesson-exit-y": counterpartCount > 0 && idx >= counterpartCount ? "-8px" : "0px",
                    } as React.CSSProperties)
                  : phase === "enter"
                    ? ({
                        "--lesson-index": clampStaggerIndex(idx),
                        "--lesson-slide-dir": dir,
                        "--lesson-base-delay": hasExitingLayer ? "65ms" : "0ms",
                        "--lesson-enter-y":
                          hasExitingLayer && counterpartCount > 0 && idx >= counterpartCount
                            ? "-6px"
                            : "0px",
                      } as React.CSSProperties)
                    : undefined;

              const rowKeyPrefix = phase === "exit" ? "exit" : "active";

              return (
                <div
                  key={`${rowKeyPrefix}-${targetSchedule.date}-${lessonKey}`}
                  className={`flex flex-col gap-2.5 relative has-[[data-open]]:z-50${motionClass}`}
                  style={rowStyle}
                >
                  {isBreakNow && (
                    <div className="flex flex-wrap items-center justify-center text-center gap-x-2 gap-y-0.5 rounded-xl border border-sys-border bg-sys-card/60 px-3 py-1.5 text-xs font-semibold text-sys-text-secondary">
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                        <CoffeeIcon className="w-3.5 h-3.5 shrink-0" />
                        <span>Перерва{breakDuration > 0 ? ` ${breakDuration} хв` : ""}</span>
                      </span>
                      <span aria-hidden="true">•</span>
                      <span>до {lesson.lesson_number}-ї пари залишилось <span className="whitespace-nowrap">{breakLeft} хв</span></span>
                    </div>
                  )}
                  <LessonCard
                    lesson={lesson}
                    targetDate={targetSchedule.date}
                    mode={mode}
                    learningMode={mode === "day" ? (targetSchedule.learning_mode ?? null) : null}
                    scheduleMode={scheduleMode}
                    canEdit={canEdit && phase !== "exit"}
                    onEdit={onEdit}
                    movingLesson={movingLesson}
                    onMoveSelect={onMoveSelect}
                    onCopySelect={onCopySelect}
                    onCancelDated={onCancelDated}
                    onRestoreDated={onRestoreDated}
                    onQuickJump={onQuickJump}
                    currentTeacherId={currentTeacherId}
                    currentTeacherName={currentTeacherName}
                    onOpenSubjectHub={onOpenSubjectHub}
                  />
                </div>
              );
            })}
          </div>
        ) : phase !== "static" ? (
          <div
            className={phase === "exit" ? "desktop-day-empty-exit" : "desktop-day-empty-enter"}
            style={
              {
                "--lesson-slide-dir": dir,
                ...(baseDelay ? { "--lesson-base-delay": baseDelay } : {}),
              } as React.CSSProperties
            }
          >
            {emptyOrPeriodContent}
          </div>
        ) : (
          emptyOrPeriodContent
        )}
      </>
    );
  };

  if (mode !== "day") {
    return (
      <section className="min-w-0">
        {(!hideDayTitle || orderedLessons.length > 0) && (
          <header className={headerClassName}>{headerContent}</header>
        )}
        <div>{renderDayBody(schedule, "static", 1, 0, false)}</div>
      </section>
    );
  }

  const activePhase = isDesktopDayEnter && !dayTransition.revalidated ? "enter" : "static";
  const hasExitingLayer = Boolean(dayTransition.exitingSchedule);

  return (
    <section className="relative min-w-0 [contain:layout_style]">
      {(!hideDayTitle || orderedLessons.length > 0) && (
        <header className={headerClassName}>{headerContent}</header>
      )}
      <div
        ref={stageRef}
        className="desktop-day-stage relative -mx-3 px-3 overflow-x-clip"
      >
        {dayTransition.exitingSchedule && (
          <div
            ref={exitLayerRef}
            key={`exit-${dayTransition.exitingSchedule.date}-${dayTransition.key}`}
            aria-hidden="true"
            className="desktop-day-layer-exit px-3"
          >
            {renderDayBody(
              dayTransition.exitingSchedule,
              "exit",
              effectiveDir,
              dayTransition.activeSchedule.lessons.length,
              true
            )}
          </div>
        )}
        <div
          ref={activeLayerRef}
          key={dayTransition.key}
          className="desktop-day-layer-active"
        >
          {renderDayBody(
            dayTransition.activeSchedule,
            activePhase,
            effectiveDir,
            dayTransition.exitingSchedule?.lessons.length ?? 0,
            hasExitingLayer
          )}
        </div>
      </div>
    </section>
  );
});
