"use client";

import React, { useCallback, useEffect, useId, useMemo, useState } from "react";
import { AnimatePresence, m } from "framer-motion";
import {
  api,
  type AcademicEvent,
  type Lesson,
  type ScheduleResponse,
  type StatisticsResponse,
} from "../../lib/api";
import {
  KYIV_DATE_FMT,
  UKR_DAY_MONTH_SHORT_FMT,
  UKR_WEEKDAY_LONG_FMT,
  getKyivInitialWeekAnchor,
} from "../../lib/date";
import { copyTextToClipboard, isSubjectMatch, type MeetingInfo } from "../../lib/format";
import {
  getKyivNow,
  getTaskDeadlineDotColor,
  getTaskDeadlineTextColor,
  getTaskStatusText,
  subscribeKyivNow,
  vibrateTap,
  type KyivNowSnapshot,
} from "../../lib/lesson-card";
import type { QuickJumpTarget, SecondaryEntityItem } from "../../lib/quickJump";
import {
  collectRecurringSubjectSlots,
  filterAndMergeWeekDays,
  filterEventsForSubject,
  findNextSubjectOccurrence,
  findSubjectStatistics,
  formatBriefChipLabel,
  formatTaskWeightBadge,
  getNavigatorTaskKey,
  hasExpandableBrief,
  partitionSubjectTasks,
  resolveEffectiveTaskBrief,
  resolveSubjectLessonDetails,
  type SubjectHubTarget,
} from "../../lib/schedule";
import { setTaskManualDone, useClassroomSubmissions } from "../../lib/useClassroomSubmissions";
import { formatTaskGradeDisplay, useGradesSummary, type GradeItem } from "../../lib/useGradesSummary";
import { useTeacherAccess } from "../../lib/useTeacherAccess";
import { useUserSettings } from "../../lib/useUserSettings";
import { useDesktopMotionEnabled } from "../../lib/useViewportTier";
import { LockedMeetingBadge, MeetingActionBadge } from "../lesson-card/LessonCardMeetingControls";
import { getEventBadge } from "../lesson-card/LessonCardStatusBadges";
import type { FullTaskItem } from "../TaskCardItem";
import { TaskChecklistSection } from "../TaskChecklistSection";
import { useOptionalToast } from "../ToastProvider";
import { AppDialog } from "../ui/AppDialog";
import {
  BarChartIcon,
  CalendarIcon,
  CheckCircleIcon,
  CheckIcon,
  ClipboardListIcon,
  ClockIcon,
  CloseIcon,
  DoorOpenIcon,
  LockIcon,
  UserCheckIcon,
} from "../ui/Icons";

interface SubjectHubAsyncSnapshot {
  fetchedAt: number;
  cycleWeeks: ScheduleResponse[][];
  stats: StatisticsResponse | null;
  events: AcademicEvent[];
}

const HUB_CACHE_TTL_MS = 120_000;
const subjectHubFetchCache = new Map<string, SubjectHubAsyncSnapshot>();

if (typeof window !== "undefined") {
  window.addEventListener("schedule:refresh", () => {
    subjectHubFetchCache.clear();
  });
}

function formatDateLabel(dateIso: string): string {
  const d = new Date(`${dateIso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateIso;
  const weekday = UKR_WEEKDAY_LONG_FMT.format(d);
  const capitalized = weekday.charAt(0).toUpperCase() + weekday.slice(1);
  return `${capitalized}, ${UKR_DAY_MONTH_SHORT_FMT.format(d)}`;
}

function formatShortDateOnly(dateIso: string): string {
  const d = new Date(`${dateIso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateIso;
  return UKR_DAY_MONTH_SHORT_FMT.format(d);
}

function formatMinutesCountdown(minutes: number): string {
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h} год ${m} хв` : `${h} год`;
  }
  return `${minutes} хв`;
}

function getGradeChipTone(grade5: number): string {
  if (grade5 === 5) return "border-emerald-500/35 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300";
  if (grade5 === 4) return "border-blue-500/35 bg-blue-500/12 text-blue-700 dark:text-blue-300";
  if (grade5 === 3) return "border-amber-500/35 bg-amber-500/12 text-amber-800 dark:text-amber-300";
  return "border-rose-500/35 bg-rose-500/12 text-rose-700 dark:text-rose-300";
}

const UKR_WEEKDAY_SHORT: Record<number, string> = {
  1: "Пн",
  2: "Вт",
  3: "Ср",
  4: "Чт",
  5: "Пт",
  6: "Сб",
  7: "Нд",
};

function getFrequencyBadge(freq: string): { label: string; shortLabel: string; tone: string } {
  if (freq === "numerator") {
    return {
      label: "Чисельник",
      shortLabel: "Чис.",
      tone: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
    };
  }
  if (freq === "denominator") {
    return {
      label: "Знаменник",
      shortLabel: "Знам.",
      tone: "border-purple-500/30 bg-purple-500/10 text-purple-700 dark:text-purple-300",
    };
  }
  return {
    label: "Щотижня",
    shortLabel: "Щотижня",
    tone: "border-sys-border bg-sys-bg text-sys-text-secondary",
  };
}

export interface SubjectHubModalProps {
  isOpen: boolean;
  target: SubjectHubTarget | null;
  mode: "student" | "teacher";
  groupName?: string | null;
  teacherName?: string | null;
  currentWeek: ScheduleResponse[];
  allTasks: FullTaskItem[];
  onClose: () => void;
  onQuickJump?: (target: QuickJumpTarget) => void;
}

export function SubjectHubModal({
  isOpen,
  target,
  mode,
  groupName = null,
  teacherName = null,
  currentWeek,
  allTasks,
  onClose,
  onQuickJump,
}: SubjectHubModalProps) {
  const titleId = useId();
  const toast = useOptionalToast();
  const { settings } = useUserSettings();
  const desktopMotion = useDesktopMotionEnabled();
  const [expandedTaskKeys, setExpandedTaskKeys] = useState<Record<string, boolean>>({});
  const { isTeacherUnlocked } = useTeacherAccess();
  const {
    isLinked,
    isLinkedToGroup,
    personalSubgroup,
    personalTeachers,
  } = useClassroomSubmissions();
  const effectivePersonalSubgroup: 1 | 2 | null =
    personalSubgroup === 1 || personalSubgroup === 2 ? personalSubgroup : null;

  const [kyivNow, setKyivNow] = useState<KyivNowSnapshot>(() => getKyivNow());
  useEffect(() => {
    if (!isOpen) return;
    setKyivNow(getKyivNow());
    return subscribeKyivNow(setKyivNow);
  }, [isOpen]);

  const [asyncData, setAsyncData] = useState<{
    cycleWeeks: ScheduleResponse[][];
    stats: StatisticsResponse | null;
    events: AcademicEvent[];
  }>({ cycleWeeks: [], stats: null, events: [] });
  const [enriching, setEnriching] = useState(false);
  const [taskTab, setTaskTab] = useState<"pending" | "overdue" | "done">("pending");
  const [userPickedTaskTab, setUserPickedTaskTab] = useState(false);
  const [hasSwitchedTaskTab, setHasSwitchedTaskTab] = useState(false);
  const [taskSlideDir, setTaskSlideDir] = useState<"next" | "prev">("next");

  const isTeacherView = mode === "teacher";
  const effectiveGroupId = target?.groupId ?? null;
  const effectiveTeacherId = isTeacherView ? (target?.teacherId ?? null) : null;

  const hasGroupAccess = useMemo(() => {
    if (isTeacherView && isTeacherUnlocked) return true;
    if (!effectiveGroupId) return true;
    return isLinkedToGroup(effectiveGroupId);
  }, [isTeacherView, isTeacherUnlocked, effectiveGroupId, isLinkedToGroup]);

  useEffect(() => {
    setUserPickedTaskTab(false);
    setHasSwitchedTaskTab(false);
    setTaskTab("pending");
  }, [isOpen, target?.subjectName, target?.subjectId]);

  useEffect(() => {
    if (!isOpen || !target) return;
    if (effectiveGroupId == null && effectiveTeacherId == null) {
      setAsyncData({ cycleWeeks: [], stats: null, events: [] });
      setEnriching(false);
      return;
    }

    const cacheKey = `${effectiveTeacherId != null ? `t:${effectiveTeacherId}` : `g:${effectiveGroupId}`}:${isLinked ? 1 : 0}:${isTeacherUnlocked ? 1 : 0}`;
    const cached = subjectHubFetchCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < HUB_CACHE_TTL_MS) {
      setAsyncData({
        cycleWeeks: cached.cycleWeeks,
        stats: cached.stats,
        events: cached.events,
      });
      setEnriching(false);
      return;
    }

    let cancelled = false;
    setEnriching(true);

    const anchor1 = getKyivInitialWeekAnchor();
    const anchor2 = new Date(anchor1);
    anchor2.setDate(anchor2.getDate() + 7);
    const todayIso = KYIV_DATE_FMT.format(new Date());

    const gidParam = effectiveTeacherId == null ? (effectiveGroupId ?? undefined) : undefined;
    const tidParam = effectiveTeacherId ?? undefined;

    Promise.allSettled([
      api.week(gidParam, tidParam, anchor1),
      api.week(gidParam, tidParam, anchor2),
      api.statistics(effectiveTeacherId != null ? { teacherId: effectiveTeacherId } : { groupId: effectiveGroupId! }),
      api.events.list({
        group_id: gidParam,
        teacher_id: tidParam,
        from_date: todayIso,
      }),
    ]).then(([w1Res, w2Res, statsRes, eventsRes]) => {
      if (cancelled) return;
      const cycleWeeks: ScheduleResponse[][] = [];
      if (w1Res.status === "fulfilled" && Array.isArray(w1Res.value)) {
        cycleWeeks.push(w1Res.value);
      }
      if (w2Res.status === "fulfilled" && Array.isArray(w2Res.value)) {
        cycleWeeks.push(w2Res.value);
      }
      const stats = statsRes.status === "fulfilled" ? statsRes.value : null;
      const events =
        eventsRes.status === "fulfilled" && Array.isArray(eventsRes.value)
          ? eventsRes.value
          : [];

      const snapshot: SubjectHubAsyncSnapshot = {
        fetchedAt: Date.now(),
        cycleWeeks,
        stats,
        events,
      };
      subjectHubFetchCache.set(cacheKey, snapshot);
      setAsyncData({ cycleWeeks, stats, events });
      setEnriching(false);
    });

    return () => {
      cancelled = true;
    };
  }, [isOpen, target, effectiveGroupId, effectiveTeacherId, isLinked, isTeacherUnlocked]);

  const cycleAnchorIso = useMemo(
    () => KYIV_DATE_FMT.format(getKyivInitialWeekAnchor()),
    []
  );

  const mergedDays = useMemo(
    () => filterAndMergeWeekDays([...asyncData.cycleWeeks, currentWeek]),
    [asyncData.cycleWeeks, currentWeek]
  );

  const nextOccurrence = useMemo(() => {
    if (!target) return null;
    return findNextSubjectOccurrence(
      mergedDays,
      target.subjectId,
      target.subjectName,
      kyivNow
    );
  }, [mergedDays, target, kyivNow]);

  const recurringSlots = useMemo(() => {
    if (!target) return [];
    const baseDays =
      asyncData.cycleWeeks.length > 0
        ? filterAndMergeWeekDays(asyncData.cycleWeeks)
        : mergedDays;
    return collectRecurringSubjectSlots(
      baseDays,
      target.subjectId,
      target.subjectName,
      cycleAnchorIso
    );
  }, [target, asyncData.cycleWeeks, mergedDays, cycleAnchorIso]);

  const referenceLesson: Lesson | null = useMemo(() => {
    return (
      nextOccurrence?.lesson ??
      recurringSlots[0]?.sampleLesson ??
      target?.sourceLesson ??
      null
    );
  }, [nextOccurrence, recurringSlots, target]);

  const lessonDetails = useMemo(() => {
    if (!referenceLesson) return null;
    return resolveSubjectLessonDetails(referenceLesson, {
      defaultSubgroup: settings.defaultSubgroup,
      isLinked,
      personalSubgroup: effectivePersonalSubgroup,
      personalTeachers,
      hasGroupAccess,
    });
  }, [referenceLesson, settings.defaultSubgroup, isLinked, effectivePersonalSubgroup, personalTeachers, hasGroupAccess]);

  const nextDetails = useMemo(() => {
    if (!nextOccurrence) return null;
    return resolveSubjectLessonDetails(nextOccurrence.lesson, {
      defaultSubgroup: settings.defaultSubgroup,
      isLinked,
      personalSubgroup: effectivePersonalSubgroup,
      personalTeachers,
      hasGroupAccess,
    });
  }, [nextOccurrence, settings.defaultSubgroup, isLinked, effectivePersonalSubgroup, personalTeachers, hasGroupAccess]);

  const subjectStat = useMemo(() => {
    if (!target) return null;
    return findSubjectStatistics(asyncData.stats, target.subjectId, target.subjectName);
  }, [asyncData.stats, target]);

  const subjectEvents = useMemo(() => {
    if (!target) return [];
    return filterEventsForSubject(
      asyncData.events,
      target.subjectId,
      target.subjectName,
      kyivNow.dateIso
    );
  }, [asyncData.events, target, kyivNow.dateIso]);

  const gradesSummary = useGradesSummary(allTasks, effectiveGroupId);

  const subjectGradeSummary = useMemo(() => {
    if (!target?.subjectName) return null;
    return (
      gradesSummary.subjects.find(
        (s) =>
          isSubjectMatch(s.subject, target.subjectName) ||
          isSubjectMatch(target.subjectName, s.subject)
      ) ?? null
    );
  }, [gradesSummary.subjects, target]);

  const subjectTasks = useMemo(() => {
    if (!target?.subjectName) {
      return { all: [], overdue: [], activeDated: [], activeNoDate: [], active: [], completed: [] };
    }
    return partitionSubjectTasks(allTasks, target.subjectName, isLinked);
  }, [allTasks, target, isLinked]);

  const effectiveTaskTab: "pending" | "overdue" | "done" = useMemo(() => {
    if (userPickedTaskTab) {
      if (taskTab === "done" && !isLinked) return "pending";
      return taskTab;
    }
    if (subjectTasks.active.length > 0) return "pending";
    if (subjectTasks.overdue.length > 0) return "overdue";
    if (isLinked && subjectTasks.completed.length > 0) return "done";
    return "pending";
  }, [
    userPickedTaskTab,
    taskTab,
    isLinked,
    subjectTasks.active.length,
    subjectTasks.overdue.length,
    subjectTasks.completed.length,
  ]);

  const handleLockedMeetingClick = useCallback(
    (e?: React.MouseEvent) => {
      if (e) e.stopPropagation();
      vibrateTap(12);
      onClose();
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("prompt-classroom-link", {
            detail: {
              groupId: effectiveGroupId,
              groupName: target?.groupName ?? groupName,
              isTeacherView,
              message: isTeacherView
                ? `Для переходу на пару групи ${target?.groupName || groupName || ""} прив'яжіть Google Classroom цієї групи або введіть PIN-код викладача.`
                : "Для переходу на онлайн-дзвінок необхідно прив'язати студентський Google Classroom цієї групи.",
            },
          })
        );
      }
    },
    [onClose, effectiveGroupId, target?.groupName, groupName, isTeacherView]
  );

  const handleMeetingLinkClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>, meeting: MeetingInfo) => {
      e.stopPropagation();
      vibrateTap(12);
      if (meeting.passcode) {
        copyTextToClipboard(meeting.passcode);
        toast?.showToast(`Код доступу Zoom (${meeting.passcode}) скопійовано!`, "success");
      }
    },
    [toast]
  );

  const handleTriggerClassroomSync = useCallback(() => {
    vibrateTap(10);
    onClose();
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("trigger-classroom-sync"));
    }
  }, [onClose]);

  const handleTeacherJump = useCallback(
    (jumpTarget: QuickJumpTarget) => {
      vibrateTap(10);
      onClose();
      onQuickJump?.(jumpTarget);
    },
    [onClose, onQuickJump]
  );

  const teachersToDisplay = useMemo<SecondaryEntityItem[]>(() => {
    if (!target) return [];
    if (lessonDetails && lessonDetails.teachers.length > 0) {
      if (lessonDetails.isDualTeachers && lessonDetails.effectiveSubgroup) {
        const idx = lessonDetails.effectiveSubgroup - 1;
        const single = lessonDetails.teachers[idx];
        return single ? [single] : lessonDetails.teachers;
      }
      return lessonDetails.teachers;
    }
    if (target.teacherName) {
      return [
        {
          id: target.teacherId ?? undefined,
          name: target.teacherName,
          displayName: target.teacherName,
          target: {
            mode: "teacher",
            id: target.teacherId ?? undefined,
            name: target.teacherName,
            label: target.teacherName,
          },
        },
      ];
    }
    return [];
  }, [target, lessonDetails]);

  if (!target) return null;

  const ownerLabel = isTeacherView
    ? teacherName || target.teacherName || "Розклад викладача"
    : target.groupName || groupName
      ? `Група ${target.groupName || groupName}`
      : "Предмет";

  const progressPct =
    subjectStat?.progress_percent != null
      ? Math.min(100, Math.max(0, Math.round(subjectStat.progress_percent)))
      : subjectStat && subjectStat.planned_hours && subjectStat.planned_hours > 0
        ? Math.min(100, Math.round((subjectStat.completed_hours / subjectStat.planned_hours) * 100))
        : null;

  const canShowStudentClassroom = !isTeacherView && effectiveGroupId != null;
  const hasStudentGrades = Boolean(
    canShowStudentClassroom && hasGroupAccess && subjectGradeSummary && subjectGradeSummary.grades.length > 0
  );
  const matchingNextRecurringSlot = nextOccurrence
    ? recurringSlots.find(
        (s) =>
          s.dayOfWeek === nextOccurrence.dayOfWeek &&
          s.lessonNumber === nextOccurrence.lesson.lesson_number
      ) ?? null
    : null;
  const showRecurringStrip =
    recurringSlots.length > 0 &&
    (recurringSlots.length > 1 ||
      !nextOccurrence ||
      !matchingNextRecurringSlot ||
      recurringSlots[0].frequency !== "both");

  const slotLocationHints = recurringSlots.map((slot) => {
    const slotDetails = resolveSubjectLessonDetails(slot.sampleLesson, {
      defaultSubgroup: settings.defaultSubgroup,
      isLinked,
      personalSubgroup: effectivePersonalSubgroup,
      personalTeachers,
      hasGroupAccess,
    });
    return slotDetails.primaryMeeting
      ? slotDetails.primaryMeeting.platform === "zoom"
        ? "Zoom"
        : slotDetails.primaryMeeting.platform === "meet"
          ? "Meet"
          : "Онлайн"
      : slotDetails.hasProtectedOnline
        ? "Онлайн"
        : slotDetails.roomsLabel || "";
  });
  const uniqueSlotLocations = new Set(slotLocationHints.filter(Boolean));
  const hasMixedSlotLocations = uniqueSlotLocations.size > 1;

  return (
    <AppDialog
      isOpen={isOpen}
      onClose={onClose}
      variant="sheet"
      maxWidth="36rem"
      maxHeight="88dvh"
      labelledBy={titleId}
    >
      <div className="w-full max-h-[88dvh] flex flex-col rounded-t-2xl sm:rounded-2xl border border-sys-border bg-sys-card text-sys-text-primary shadow-2xl overflow-hidden pb-safe">
        {/* Header */}
        <div className="bg-sys-surface border-b border-sys-border px-4 sm:px-5 pt-2.5 sm:pt-3.5 pb-3.5 shrink-0">
          <div className="mx-auto mb-2.5 h-1 w-9 rounded-full bg-sys-border/80 sm:hidden" aria-hidden="true" />
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                <span className="inline-flex items-center rounded-md border border-sys-accent/25 bg-sys-accent/10 px-2 py-0.5 text-[11px] font-bold text-sys-accent">
                  {ownerLabel}
                </span>
                {lessonDetails?.effectiveSubgroup && (
                  <span className="inline-flex items-center rounded-md border border-sys-border bg-sys-bg px-2 py-0.5 text-[11px] font-semibold text-sys-text-secondary">
                    {lessonDetails.effectiveSubgroup} підгрупа
                  </span>
                )}
              </div>

              <h2
                id={titleId}
                className="text-lg sm:text-xl font-bold text-sys-text-primary leading-snug break-words"
              >
                {target.subjectName}
              </h2>

              {teachersToDisplay.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {teachersToDisplay.map((t, idx) => {
                    const canJump = Boolean(
                      onQuickJump && (!isTeacherView || (effectiveTeacherId != null && t.id !== effectiveTeacherId))
                    );
                    if (canJump) {
                      return (
                        <button
                          key={`${t.name}-${idx}`}
                          type="button"
                          onClick={() => handleTeacherJump(t.target)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-sys-border bg-sys-card px-2.5 py-1 text-xs font-medium text-sys-text-secondary hover:text-sys-accent hover:border-sys-accent/40 transition-colors cursor-pointer"
                          title={`Відкрити розклад: ${t.displayName}`}
                        >
                          <UserCheckIcon className="w-3.5 h-3.5 text-sys-text-muted" />
                          <span>{t.displayName}</span>
                          <span aria-hidden="true" className="text-[11px] opacity-70">→</span>
                        </button>
                      );
                    }
                    return (
                      <span
                        key={`${t.name}-${idx}`}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-sys-border bg-sys-card px-2.5 py-1 text-xs font-medium text-sys-text-secondary"
                      >
                        <UserCheckIcon className="w-3.5 h-3.5 text-sys-text-muted" />
                        <span>{t.displayName}</span>
                      </span>
                    );
                  })}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="Закрити картку предмета"
              className="relative after:absolute after:-inset-1 after:content-[''] flex h-9 w-9 items-center justify-center rounded-xl border border-sys-border bg-sys-card text-sys-text-secondary hover:bg-sys-bg hover:text-sys-text-primary transition-colors cursor-pointer shrink-0"
            >
              <CloseIcon className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable Content (solid opaque sheet bands divided by hairline borders — zero gaps) */}
        <div className="flex-1 overflow-y-auto overscroll-contain bg-sys-card divide-y divide-sys-border/75 custom-scrollbar">
          {/* 1. Schedule Overview: Next Lesson + Weekly Cycle */}
          <section className="px-4 sm:px-5 py-3.5">
            <div className="flex items-center justify-between gap-2 mb-2.5">
              <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-sys-text-secondary">
                <ClockIcon className="w-3.5 h-3.5 text-sys-accent" />
                <span>Розклад предмета</span>
              </h3>
              {nextOccurrence?.isShortenedDay && (
                <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:text-amber-300">
                  <ClockIcon className="w-3 h-3 shrink-0" />
                  <span>50 хв</span>
                </span>
              )}
            </div>

            {nextOccurrence && nextDetails ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2.5">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {nextOccurrence.isLive ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-sys-accent/35 bg-sys-accent/15 px-2.5 py-0.5 text-xs font-bold text-sys-accent">
                          <span className="h-2 w-2 rounded-full bg-sys-accent shrink-0" />
                          <span>Зараз триває · ще {nextOccurrence.remainingMinutes} хв</span>
                        </span>
                      ) : nextOccurrence.isToday ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-sys-accent/30 bg-sys-accent/10 px-2.5 py-0.5 text-xs font-bold text-sys-accent">
                          <span>Сьогодні</span>
                          {nextOccurrence.minutesUntilStart !== null && (
                            <span>· через {formatMinutesCountdown(nextOccurrence.minutesUntilStart)}</span>
                          )}
                        </span>
                      ) : (
                        <span className="text-sm sm:text-base font-bold text-sys-text-primary">
                          {formatDateLabel(nextOccurrence.date)}
                        </span>
                      )}

                      {nextOccurrence.lesson.is_replacement && (
                        <span className="inline-flex items-center rounded-md bg-sys-warning px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-sys-warningText">
                          Заміна
                        </span>
                      )}
                    </div>

                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs sm:text-sm text-sys-text-secondary">
                      <span className="font-semibold text-sys-text-primary">
                        {nextOccurrence.lesson.lesson_number} пара
                      </span>
                      <span>·</span>
                      <span>{nextOccurrence.lesson.time}</span>
                      {(() => {
                        const effectiveFreq =
                          matchingNextRecurringSlot?.frequency ??
                          (nextOccurrence.weekType !== "both" ? nextOccurrence.weekType : null);
                        if (!effectiveFreq) return null;
                        const badge = getFrequencyBadge(effectiveFreq);
                        return (
                          <>
                            <span>·</span>
                            <span className="text-sys-text-muted">{badge.label}</span>
                          </>
                        );
                      })()}
                    </div>
                  </div>

                  {/* Location or Online link */}
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {nextDetails.isDualTeachers && nextDetails.effectiveSubgroup === null ? (
                      <div className="flex flex-col items-end gap-1.5">
                        {[0, 1].map((idx) => {
                          const subMeeting = nextDetails.subgroupMeetings[idx];
                          const subRoom = nextDetails.subgroupRooms[idx];
                          const teacherLabel = nextDetails.teachers[idx]?.displayName || `${idx + 1} підгр.`;
                          if (!subMeeting && !subRoom) return null;
                          return (
                            <div key={idx} className="flex items-start justify-end gap-1.5 text-xs">
                              <span className="text-[11px] text-sys-text-muted break-words text-right max-w-[180px] sm:max-w-[220px] leading-tight mt-0.5">
                                {idx + 1} підгр. ({teacherLabel})
                              </span>
                              {subMeeting ? (
                                <MeetingActionBadge
                                  meeting={subMeeting}
                                  variant="desktop-day"
                                  hasGroupAccess={hasGroupAccess}
                                  isLiveOrSoon={nextOccurrence.isLive || (nextOccurrence.minutesUntilStart !== null && nextOccurrence.minutesUntilStart <= 15)}
                                  onLockedClick={handleLockedMeetingClick}
                                  onLinkClick={handleMeetingLinkClick}
                                />
                              ) : subRoom ? (
                                <span className="inline-flex items-center gap-1 rounded-lg border border-sys-border bg-sys-bg px-2 py-1 text-xs font-medium text-sys-text-secondary">
                                  <DoorOpenIcon className="w-3 h-3 shrink-0" />
                                  <span>{subRoom}</span>
                                </span>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <>
                        {nextDetails.primaryMeeting ? (
                          <MeetingActionBadge
                            meeting={nextDetails.primaryMeeting}
                            variant="desktop-day"
                            hasGroupAccess={hasGroupAccess}
                            isLiveOrSoon={nextOccurrence.isLive || (nextOccurrence.minutesUntilStart !== null && nextOccurrence.minutesUntilStart <= 15)}
                            onLockedClick={handleLockedMeetingClick}
                            onLinkClick={handleMeetingLinkClick}
                          />
                        ) : nextDetails.hasProtectedOnline ? (
                          <LockedMeetingBadge
                            platform={nextDetails.meetings[0]?.platform}
                            size="normal"
                            onClick={handleLockedMeetingClick}
                          />
                        ) : nextDetails.roomsLabel ? (
                          <span className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-sys-border bg-sys-bg px-3 text-xs font-medium text-sys-text-secondary whitespace-nowrap">
                            <DoorOpenIcon className="w-3.5 h-3.5 shrink-0 text-sys-text-muted" />
                            <span>{nextDetails.roomsLabel}</span>
                          </span>
                        ) : null}
                      </>
                    )}
                  </div>
                </div>
              </div>
            ) : enriching ? (
              <div className="space-y-2 animate-pulse" aria-busy="true">
                <div className="h-4 w-44 rounded-md bg-sys-border/60" />
                <div className="h-3.5 w-32 rounded-md bg-sys-border/45" />
              </div>
            ) : (
              <p className="text-xs sm:text-sm text-sys-text-secondary">
                У найближчі 2 тижні пар за розкладом немає.
              </p>
            )}

            {/* Compact Weekly Cycle Chips (shown only when adding non-redundant schedule context) */}
            {showRecurringStrip && (
              <div className="mt-3 pt-3 border-t border-sys-border/60 space-y-2">
                <div className="flex items-center justify-between gap-2 text-[11px] font-semibold text-sys-text-muted">
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarIcon className="w-3.5 h-3.5 text-sys-text-muted shrink-0" />
                    <span>Графік у циклі тижнів</span>
                  </span>
                  <span>
                    {recurringSlots.length}{" "}
                    {recurringSlots.length === 1 ? "пара" : recurringSlots.length <= 4 ? "пари" : "пар"}
                  </span>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {recurringSlots.map((slot, idx) => {
                    const freq = getFrequencyBadge(slot.frequency);
                    const dayShort = UKR_WEEKDAY_SHORT[slot.dayOfWeek] || slot.dayName;
                    const locationHint = slotLocationHints[idx];

                    return (
                      <div
                        key={`${slot.dayOfWeek}-${slot.lessonNumber}`}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-sys-border/75 bg-sys-bg px-2.5 py-1.5 text-xs"
                      >
                        <span className="font-bold text-sys-text-primary">{dayShort}</span>
                        <span className="text-sys-text-muted">·</span>
                        <span className="font-medium text-sys-text-secondary">
                          {slot.lessonNumber} пара ({slot.time})
                        </span>
                        {hasMixedSlotLocations && locationHint && (
                          <>
                            <span className="text-sys-text-muted">·</span>
                            <span className="text-sys-text-muted">{locationHint}</span>
                          </>
                        )}
                        {slot.frequency !== "both" && (
                          <span
                            className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-bold leading-none ${freq.tone}`}
                            title={freq.label}
                          >
                            {freq.shortLabel}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>

          {/* 2. Course Hours Progress & Student Grades */}
          {(subjectStat || enriching || hasStudentGrades) && (
            <section className="px-4 sm:px-5 py-3.5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-sys-text-secondary">
                  <BarChartIcon className="w-3.5 h-3.5 text-sys-accent" />
                  <span>
                    {hasStudentGrades && (subjectStat || enriching)
                      ? "Курс та оцінки"
                      : hasStudentGrades
                        ? "Успішність"
                        : "Виконання курсу"}
                  </span>
                </h3>
                {progressPct !== null && (
                  <span className="text-xs font-bold text-sys-accent">{progressPct}%</span>
                )}
              </div>

              {(subjectStat || enriching) && (
                subjectStat ? (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-xl font-black text-sys-text-primary leading-none">
                          {subjectStat.completed_hours}
                        </span>
                        <span className="text-xs font-semibold text-sys-text-secondary">
                          {subjectStat.planned_hours != null
                            ? `/ ${subjectStat.planned_hours} год`
                            : "год проведено"}
                        </span>
                      </div>

                      {typeof subjectStat.lessons_count === "number" && (
                        <span className="text-[11px] font-medium text-sys-text-muted">
                          Проведено пар: {subjectStat.lessons_count}
                        </span>
                      )}
                    </div>

                    {progressPct !== null && (
                      <div
                        role="progressbar"
                        aria-label="Виконання навчальних годин"
                        aria-valuenow={progressPct}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        className="h-2 w-full rounded-full bg-sys-bg border border-sys-border/70 overflow-hidden"
                      >
                        <div
                          className="h-full rounded-full bg-sys-accentSolid transition-[width] duration-300 ease-out"
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2 animate-pulse" aria-busy="true">
                    <div className="flex items-center justify-between gap-2">
                      <div className="h-4 w-28 rounded-md bg-sys-border/60" />
                      <span className="text-[11px] font-medium text-sys-text-muted">Завантаження...</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-sys-border/45" />
                  </div>
                )
              )}

              {hasStudentGrades && subjectGradeSummary && (
                <div className="rounded-xl border border-sys-border/70 bg-sys-bg px-3 py-2.5 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-baseline gap-2">
                      <span className="text-xs font-medium text-sys-text-secondary">Середній бал:</span>
                      <span className="text-base font-black text-sys-text-primary">
                        {subjectGradeSummary.average5.toFixed(2)}
                        <span className="text-xs font-semibold text-sys-text-secondary"> / 5</span>
                      </span>
                      {subjectGradeSummary.has12Scale && subjectGradeSummary.average12 !== null && (
                        <span className="text-xs font-bold text-sys-accent">
                          ({subjectGradeSummary.average12.toFixed(1)} / 12 б.)
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] text-sys-text-muted">
                      Оцінок: {subjectGradeSummary.grades.length}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {subjectGradeSummary.grades.slice(0, 8).map((g: GradeItem) => {
                      const chipText =
                        g.maxPoints > 5 && g.maxPoints <= 12
                          ? `${g.rawGrade} б.`
                          : g.maxPoints <= 5
                            ? `${g.rawGrade}`
                            : g.grade5;
                      const cls = `inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-bold ${getGradeChipTone(g.grade5)}`;
                      return g.url ? (
                        <a
                          key={g.id}
                          href={g.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={`${g.title}: ${g.rawGrade}/${g.maxPoints} (${g.percentage}%)`}
                          className={`${cls} hover:opacity-85 transition-opacity`}
                        >
                          {chipText}
                        </a>
                      ) : (
                        <span
                          key={g.id}
                          title={`${g.title}: ${g.rawGrade}/${g.maxPoints} (${g.percentage}%)`}
                          className={cls}
                        >
                          {chipText}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* 3. Upcoming Academic Events (Exams / Credits / Consultations) */}
          {subjectEvents.length > 0 && (
            <section className="px-4 sm:px-5 py-3.5">
              <div className="flex items-center justify-between gap-2 mb-2">
                <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-sys-text-secondary">
                  <CheckCircleIcon className="w-3.5 h-3.5 text-sys-accent" />
                  <span>Найближчі події ({subjectEvents.length})</span>
                </h3>
              </div>

              <ul className="rounded-xl border border-sys-border/70 bg-sys-bg divide-y divide-sys-border/60 overflow-hidden">
                {subjectEvents.map((ev) => {
                  const badge = getEventBadge(ev.event_type, ev.title);
                  return (
                    <li
                      key={ev.id}
                      className="px-3 py-2.5 text-xs space-y-1"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                          {badge && (
                            <span
                              className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider ${badge.badgeClass}`}
                            >
                              {badge.label}
                            </span>
                          )}
                          {ev.title && ev.title !== target.subjectName && (
                            <span className="font-semibold text-sys-text-primary break-words">
                              {ev.title}
                            </span>
                          )}
                        </div>
                        <span className="font-semibold text-sys-text-primary shrink-0">
                          {formatShortDateOnly(ev.event_date)} · {ev.start_time}
                          {ev.end_time ? `–${ev.end_time}` : ""}
                        </span>
                      </div>

                      {(ev.room || ev.note) && (
                        <div className="text-sys-text-secondary flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          {ev.room && <span>{ev.room}</span>}
                          {ev.room && ev.note && <span>·</span>}
                          {ev.note && <span className="italic">{ev.note}</span>}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {/* 4. Google Classroom Tasks (Student Mode) */}
          {canShowStudentClassroom && (!hasGroupAccess || subjectTasks.all.length > 0 || !isLinked) && (() => {
            const pendingTasksSum = [...subjectTasks.active, ...subjectTasks.overdue].reduce(
              (acc, t) => acc + (typeof t.maxPoints === "number" && Number.isFinite(t.maxPoints) ? t.maxPoints : 0),
              0
            );
            const toggleHubTaskExpand = (taskKey: string) => {
              setExpandedTaskKeys((prev) => ({ ...prev, [taskKey]: !prev[taskKey] }));
            };
            const renderHubTaskRow = (
              task: FullTaskItem,
              rowKey: string,
              withDot: boolean,
              allowManualDone = false
            ) => {
              const statusText = getTaskStatusText(task.deadline, isLinked);
              const dotCls = getTaskDeadlineDotColor(task.deadline.badgeTone, isLinked);
              const statusCls = getTaskDeadlineTextColor(task.deadline.badgeTone, isLinked);
              const taskKey = getNavigatorTaskKey(task);
              const brief = resolveEffectiveTaskBrief(task);
              const canExpandBrief = hasExpandableBrief(brief);
              const isExpanded = canExpandBrief && Boolean(expandedTaskKeys[taskKey]);
              const briefChip = formatBriefChipLabel(brief);
              const weightBadge = formatTaskWeightBadge(task.maxPoints ?? null);

              return (
                <li key={rowKey} className="px-3 py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <a
                      href={task.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group min-w-0 flex-1 space-y-0.5 hover:opacity-90 transition-opacity"
                    >
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-xs sm:text-[13px] font-semibold text-sys-text-primary group-hover:text-sys-accent transition-colors break-words">
                          {task.title}
                        </span>
                        <span aria-hidden="true" className="shrink-0 text-xs text-sys-text-muted group-hover:text-sys-accent transition-colors">
                          ↗
                        </span>
                      </div>
                      {statusText && (
                        <div className={`flex items-center gap-1.5 text-[11px] ${withDot ? statusCls : "text-sys-text-muted"}`}>
                          {withDot && <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dotCls}`} />}
                          <span>{statusText}</span>
                        </div>
                      )}
                    </a>

                    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                      {allowManualDone && isLinked && (
                        <button
                          type="button"
                          onClick={() => {
                            setTaskManualDone({ url: task.url, id: task.id }, true);
                            toast?.showToast("Перенесено у «Здано» (відмічено вручну)", "success");
                          }}
                          aria-label={`Позначити завдання «${task.title}» як здане`}
                          title="Прибрати з боргів і перенести у «Здано»"
                          className="inline-flex items-center gap-1 min-h-[26px] rounded-md border border-emerald-500/35 bg-emerald-500/10 hover:bg-emerald-500/20 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:text-emerald-300 transition-colors cursor-pointer active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                        >
                          <CheckIcon className="h-3 w-3 shrink-0" />
                          <span>Позначити зданим</span>
                        </button>
                      )}

                      {canExpandBrief ? (
                        <button
                          type="button"
                          aria-expanded={isExpanded}
                          onClick={() => toggleHubTaskExpand(taskKey)}
                          className={`shrink-0 inline-flex items-center gap-1 min-h-[26px] rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors cursor-pointer active:scale-95 ${
                            isExpanded
                              ? "border-sys-accent/45 bg-sys-hover text-sys-text-primary"
                              : "border-sys-border/70 bg-sys-bg/80 text-sys-text-secondary hover:text-sys-text-primary hover:border-sys-accent/40 hover:bg-sys-hover"
                          }`}
                        >
                          <span>{briefChip || "Міні-бриф"}</span>
                          <svg
                            aria-hidden="true"
                            width="11"
                            height="11"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.4"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className={`transition-transform duration-200 shrink-0 ${isExpanded ? "rotate-180" : ""}`}
                          >
                            <path d="m6 9 6 6 6-6" />
                          </svg>
                        </button>
                      ) : weightBadge ? (
                        <span className="shrink-0 text-[11px] font-medium text-sys-text-muted pt-0.5">
                          {weightBadge.label}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  {desktopMotion ? (
                    <AnimatePresence initial={false}>
                      {isExpanded && (
                        <m.div
                          initial={{ opacity: 0, height: 0, y: -6 }}
                          animate={{
                            opacity: 1,
                            height: "auto",
                            y: 0,
                            transition: {
                              height: { type: "spring", stiffness: 380, damping: 30 },
                              y: { type: "spring", stiffness: 380, damping: 30 },
                              opacity: { duration: 0.18, ease: [0.22, 1, 0.36, 1] },
                            },
                          }}
                          exit={{
                            opacity: 0,
                            height: 0,
                            y: -4,
                            transition: {
                              height: { duration: 0.18, ease: [0.32, 0, 0.24, 1] },
                              y: { duration: 0.16, ease: [0.32, 0, 0.24, 1] },
                              opacity: { duration: 0.13, ease: [0.22, 1, 0.36, 1] },
                            },
                          }}
                          className="overflow-hidden"
                        >
                          <TaskChecklistSection
                            taskKey={taskKey}
                            brief={brief}
                            maxPoints={task.maxPoints}
                            compact
                          />
                        </m.div>
                      )}
                    </AnimatePresence>
                  ) : (
                    <div
                      data-open={isExpanded ? "true" : undefined}
                      className="grid-accordion"
                    >
                      <div className="grid-accordion-inner">
                        <TaskChecklistSection
                          taskKey={taskKey}
                          brief={brief}
                          maxPoints={task.maxPoints}
                          compact
                        />
                      </div>
                    </div>
                  )}
                </li>
              );
            };

            return (
            <section className="px-4 sm:px-5 py-3.5 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-sys-text-secondary">
                  <ClipboardListIcon className="w-3.5 h-3.5 text-sys-accent" />
                  <span>Завдання Classroom</span>
                </h3>
                {hasGroupAccess && pendingTasksSum > 0 && (
                  <span className="text-[11px] font-medium text-sys-text-muted">
                    до здачі: {Number.isInteger(pendingTasksSum) ? pendingTasksSum : pendingTasksSum.toFixed(1)} б.
                  </span>
                )}
              </div>

              {!hasGroupAccess ? (
                <div className="rounded-xl border border-sky-500/25 bg-sky-500/10 p-3.5 text-center space-y-2.5">
                  <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl border border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-300">
                    <LockIcon className="w-5 h-5" />
                  </div>
                  <p className="text-xs text-sys-text-secondary leading-relaxed">
                    Завдання та оцінки з Google Classroom доступні після прив&apos;язки студентського акаунта{" "}
                    <span className="font-semibold text-sys-text-primary">@kre.dp.ua</span> цієї групи.
                  </p>
                  <button
                    type="button"
                    onClick={handleTriggerClassroomSync}
                    className="inline-flex min-h-[38px] items-center justify-center rounded-xl bg-sky-700 hover:bg-sky-800 px-4 py-2 text-xs font-semibold text-white transition-colors cursor-pointer active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:ring-offset-sys-card"
                  >
                    Прив&apos;язати Google Classroom
                  </button>
                </div>
              ) : (
                <>
                  {/* Tasks Switcher matching ordinary Tasks tab: До здачі | Борги | Здано */}
                  {subjectTasks.all.length > 0 && (() => {
                    const tabOrder: Array<"pending" | "overdue" | "done"> = isLinked
                      ? ["pending", "overdue", "done"]
                      : ["pending", "overdue"];
                    const activeTaskIdx = Math.max(0, tabOrder.indexOf(effectiveTaskTab));
                    const selectHubTaskTab = (next: "pending" | "overdue" | "done") => {
                      const prevIdx = tabOrder.indexOf(effectiveTaskTab);
                      const nextIdx = tabOrder.indexOf(next);
                      if (next !== effectiveTaskTab) {
                        setTaskSlideDir(nextIdx >= prevIdx ? "next" : "prev");
                        setHasSwitchedTaskTab(true);
                      }
                      setUserPickedTaskTab(true);
                      setTaskTab(next);
                    };

                    return (
                    <div className="space-y-2.5">
                      <div
                        role="tablist"
                        aria-label="Категорії завдань предмета"
                        style={
                          {
                            "--seg-cols": tabOrder.length,
                            "--seg-index": activeTaskIdx,
                          } as React.CSSProperties
                        }
                        className={`ui-seg-xl ui-seg-pad-4 relative grid items-stretch ${isLinked ? "grid-cols-3" : "grid-cols-2"} rounded-xl border border-sys-border/70 bg-sys-bg text-[11px] font-semibold isolate select-none`}
                      >
                        {!desktopMotion && (
                          <div
                            aria-hidden="true"
                            className="ui-seg-slider pointer-events-none z-0 bg-sys-card border border-sys-border shadow-2xs transform-gpu transition-transform duration-base [transition-timing-function:var(--ease-spring-snappy)]"
                          />
                        )}

                        <button
                          type="button"
                          role="tab"
                          aria-selected={effectiveTaskTab === "pending"}
                          onClick={() => selectHubTaskTab("pending")}
                          className={`ui-seg-pill relative z-10 flex min-w-0 items-center justify-center gap-1 sm:gap-1.5 py-1.5 px-1.5 sm:px-2 transition-colors duration-fast cursor-pointer ${
                            effectiveTaskTab === "pending"
                              ? "text-sys-text-primary font-bold"
                              : "text-sys-text-secondary hover:text-sys-text-primary"
                          }`}
                        >
                          {desktopMotion && effectiveTaskTab === "pending" && (
                            <m.div
                              layoutId="subject-hub-task-pill"
                              transition={{ type: "spring", stiffness: 460, damping: 32 }}
                              aria-hidden="true"
                              className="ui-seg-pill pointer-events-none absolute inset-0 bg-sys-card border border-sys-border shadow-2xs"
                            />
                          )}
                          <span className="relative z-10 truncate">До здачі</span>
                          <span className="relative z-10 shrink-0 rounded-full bg-sys-surface px-1.5 py-0.5 text-[10px] font-bold text-sys-text-secondary">
                            {subjectTasks.active.length}
                          </span>
                        </button>

                        <button
                          type="button"
                          role="tab"
                          aria-selected={effectiveTaskTab === "overdue"}
                          onClick={() => selectHubTaskTab("overdue")}
                          className={`ui-seg-pill relative z-10 flex min-w-0 items-center justify-center gap-1 sm:gap-1.5 py-1.5 px-1.5 sm:px-2 transition-colors duration-fast cursor-pointer ${
                            effectiveTaskTab === "overdue"
                              ? "text-rose-700 dark:text-rose-300 font-bold"
                              : subjectTasks.overdue.length > 0 && isLinked
                                ? "text-rose-700 dark:text-rose-300"
                                : "text-sys-text-secondary hover:text-sys-text-primary"
                          }`}
                        >
                          {desktopMotion && effectiveTaskTab === "overdue" && (
                            <m.div
                              layoutId="subject-hub-task-pill"
                              transition={{ type: "spring", stiffness: 460, damping: 32 }}
                              aria-hidden="true"
                              className="ui-seg-pill pointer-events-none absolute inset-0 bg-sys-card border border-sys-border shadow-2xs"
                            />
                          )}
                          <span className="relative z-10 truncate">{isLinked ? "Борги" : "Минув час"}</span>
                          <span className="relative z-10 shrink-0 rounded-full bg-sys-surface px-1.5 py-0.5 text-[10px] font-bold">
                            {subjectTasks.overdue.length}
                          </span>
                        </button>

                        {isLinked && (
                          <button
                            type="button"
                            role="tab"
                            aria-selected={effectiveTaskTab === "done"}
                            onClick={() => selectHubTaskTab("done")}
                            className={`ui-seg-pill relative z-10 flex min-w-0 items-center justify-center gap-1 sm:gap-1.5 py-1.5 px-1.5 sm:px-2 transition-colors duration-fast cursor-pointer ${
                              effectiveTaskTab === "done"
                                ? "text-emerald-700 dark:text-emerald-300 font-bold"
                                : "text-sys-text-secondary hover:text-sys-text-primary"
                            }`}
                          >
                            {desktopMotion && effectiveTaskTab === "done" && (
                              <m.div
                                layoutId="subject-hub-task-pill"
                                transition={{ type: "spring", stiffness: 460, damping: 32 }}
                                aria-hidden="true"
                                className="ui-seg-pill pointer-events-none absolute inset-0 bg-sys-card border border-sys-border shadow-2xs"
                              />
                            )}
                            <span className="relative z-10 truncate">Здано</span>
                            <span className="relative z-10 shrink-0 rounded-full bg-sys-surface px-1.5 py-0.5 text-[10px] font-bold">
                              {subjectTasks.completed.length}
                            </span>
                          </button>
                        )}
                      </div>

                      <div
                        key={effectiveTaskTab}
                        data-slide-dir={hasSwitchedTaskTab ? taskSlideDir : undefined}
                        className={hasSwitchedTaskTab ? "guide-step-slide" : undefined}
                      >
                      {effectiveTaskTab === "pending" && (
                        subjectTasks.active.length > 0 ? (
                          <div className="space-y-2">
                            {subjectTasks.activeDated.length > 0 && (
                              <div>
                                {subjectTasks.activeNoDate.length > 0 && (
                                  <div className="text-[10px] font-bold uppercase tracking-wider text-sys-text-muted px-0.5 mb-1">
                                    З терміном здачі
                                  </div>
                                )}
                                <ul className="rounded-xl border border-sys-border/70 bg-sys-bg divide-y divide-sys-border/60 overflow-hidden">
                                  {subjectTasks.activeDated.map((task, idx) =>
                                    renderHubTaskRow(task, task.id || task.url || `act-d-${idx}`, true)
                                  )}
                                </ul>
                              </div>
                            )}

                            {subjectTasks.activeNoDate.length > 0 && (
                              <div>
                                {subjectTasks.activeDated.length > 0 && (
                                  <div className="text-[10px] font-bold uppercase tracking-wider text-sys-text-muted px-0.5 mb-1">
                                    Без терміну здачі
                                  </div>
                                )}
                                <ul className="rounded-xl border border-sys-border/70 bg-sys-bg divide-y divide-sys-border/60 overflow-hidden">
                                  {subjectTasks.activeNoDate.map((task, idx) =>
                                    renderHubTaskRow(task, task.id || task.url || `act-nd-${idx}`, false)
                                  )}
                                </ul>
                              </div>
                            )}
                          </div>
                        ) : (
                          <p className="text-xs text-sys-text-secondary py-1">
                            Активних завдань до здачі немає.
                          </p>
                        )
                      )}

                      {effectiveTaskTab === "overdue" && (
                        subjectTasks.overdue.length > 0 ? (
                          <ul className="rounded-xl border border-sys-border/70 bg-sys-bg divide-y divide-sys-border/60 overflow-hidden">
                            {subjectTasks.overdue.map((task, idx) =>
                              renderHubTaskRow(task, task.id || task.url || `ovr-${idx}`, true, true)
                            )}
                          </ul>
                        ) : (
                          <p className="text-xs text-sys-text-secondary py-1">
                            Прострочених завдань із цього предмета немає.
                          </p>
                        )
                      )}

                      {effectiveTaskTab === "done" && isLinked && (
                        subjectTasks.completed.length > 0 ? (
                          <ul className="rounded-xl border border-sys-border/70 bg-sys-bg divide-y divide-sys-border/60 overflow-hidden">
                            {subjectTasks.completed.map((task, idx) => {
                              const gradeInfo =
                                task.state === "RETURNED"
                                  ? formatTaskGradeDisplay(task.assignedGrade, task.maxPoints, task.subject)
                                  : null;
                              const isManualDone = task.state === "MANUAL_DONE";
                              return (
                                <li
                                  key={task.id || task.url || `done-${idx}`}
                                  className="flex items-center justify-between gap-2.5 px-3 py-2.5 text-xs hover:bg-sys-card/70 transition-colors"
                                >
                                  <a
                                    href={task.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="group flex items-center justify-between gap-2.5 min-w-0 flex-1"
                                  >
                                    <span className="font-medium text-sys-text-primary break-words group-hover:text-sys-accent transition-colors min-w-0 flex-1">
                                      {task.title}
                                    </span>
                                    <span className="shrink-0 font-semibold text-emerald-700 dark:text-emerald-300">
                                      {gradeInfo
                                        ? gradeInfo.text
                                        : isManualDone
                                        ? "Відмічено вручну"
                                        : "Здано"}{" "}
                                      ↗
                                    </span>
                                  </a>

                                  {isManualDone && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setTaskManualDone({ url: task.url, id: task.id }, false);
                                        toast?.showToast("Позначку здачі скасовано", "info");
                                      }}
                                      aria-label={`Скасувати ручну позначку здачі для «${task.title}»`}
                                      title="Повернути завдання у невиконані"
                                      className="shrink-0 inline-flex items-center gap-1 min-h-[24px] rounded-md border border-sys-border/80 bg-sys-card hover:border-rose-500/40 hover:bg-rose-500/10 px-2 py-0.5 text-[11px] font-medium text-sys-text-secondary hover:text-rose-700 dark:hover:text-rose-300 transition-colors cursor-pointer active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sys-accent"
                                    >
                                      <span>Скасувати</span>
                                    </button>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        ) : (
                          <p className="text-xs text-sys-text-secondary py-1">
                            Зданих завдань із цього предмета поки немає.
                          </p>
                        )
                      )}
                      </div>
                    </div>
                    );
                  })()}

                  {!isLinked && (
                    <button
                      type="button"
                      onClick={handleTriggerClassroomSync}
                      className="w-full flex items-center justify-between gap-2 rounded-xl border border-sys-accent/25 bg-sys-accent/10 px-3 py-2 text-left text-[11px] font-bold text-sys-accent hover:bg-sys-accent/15 transition-colors cursor-pointer"
                    >
                      <span>
                        {subjectTasks.all.length > 0
                          ? "Прив'язати акаунт @kre.dp.ua для перегляду оцінок і статусів здачі"
                          : "Підключити Google Classroom (@kre.dp.ua) для завдань та оцінок"}
                      </span>
                      <span aria-hidden="true" className="shrink-0">→</span>
                    </button>
                  )}
                </>
              )}
            </section>
            );
          })()}
        </div>
      </div>
    </AppDialog>
  );
}
