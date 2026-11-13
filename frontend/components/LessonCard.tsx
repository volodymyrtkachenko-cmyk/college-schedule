"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Lesson } from "../lib/api";
import { formatRoom, formatRoomsList, extractOnlineMeetings, MeetingInfo, copyTextToClipboard } from "../lib/format";
import { useOptionalToast } from "./ToastProvider";
import { extractClassroomTaskKey, isOwnTask, useClassroomSubmissions } from "../lib/useClassroomSubmissions";
import { useTeacherAccess } from "../lib/useTeacherAccess";
import { useUserSettings } from "../lib/useUserSettings";
import { QuickJumpTarget, parseLessonTeachers, parseLessonGroups } from "../lib/quickJump";
import type { SubjectHubTarget } from "../lib/schedule";
import { DEFAULT_LESSON_TIMES } from "../lib/constants/lessons";
import { useViewportTier } from "../lib/useViewportTier";
import {
  type ClassroomTaskItem,
  type KyivNowSnapshot,
  type TaskDeadline,
  UKR_MONTHS_SHORT,
  ensureSharedKyivNowSnapshot,
  extractClassroomTasks,
  extractOnlineMeetingInfo,
  formatTaskCount,
  getKyivNow,
  getSharedKyivNowSnapshot,
  getTaskDeadlineDotColor,
  getTaskDeadlineTextColor,
  getTaskStatusText,
  getVisibleUserNote,
  groupDualTeacherTasks,
  hasAllTasksCompleted,
  parseMinutes,
  parseTaskDeadline,
  pluralDays,
  resolveTeacherMeetings,
  sortTasksByDeadline,
  subscribeKyivNow,
  vibrateTap,
} from "../lib/lesson-card";
import { LockedMeetingBadge, MeetingActionBadge } from "./lesson-card/LessonCardMeetingControls";
import { LessonStatusBadge, TemplateWeekBadge, getEventBadge } from "./lesson-card/LessonCardStatusBadges";
import { LessonCardActions } from "./lesson-card/LessonCardActions";
import { SubgroupTeacherBlock } from "./lesson-card/SubgroupTeacherBlock";
import { DayTasksSection, WeekTasksPopover, WeekTasksTrigger } from "./lesson-card/LessonTasksPanel";

const LessonNoteModal = dynamic(() => import("./LessonNote").then((m) => m.LessonNoteModal), { ssr: false });

export type { QuickJumpTarget, MeetingInfo, TaskDeadline, ClassroomTaskItem, KyivNowSnapshot };
export {
  extractOnlineMeetings,
  extractOnlineMeetingInfo,
  getKyivNow,
  subscribeKyivNow,
  UKR_MONTHS_SHORT,
  pluralDays,
  getTaskStatusText,
  parseTaskDeadline,
  formatTaskCount,
  getTaskDeadlineTextColor,
  getTaskDeadlineDotColor,
  sortTasksByDeadline,
  hasAllTasksCompleted,
  extractClassroomTasks,
  getVisibleUserNote,
};

export interface LessonCardProps {
  lesson: Lesson;
  learningMode?: "offline" | "online" | null;
  targetDate: string;
  mode: "today" | "week" | "day";
  scheduleMode: "student" | "teacher" | "admin";
  canEdit: boolean;
  hideTimeColumn?: boolean;
  onEdit?: (lesson: Lesson) => void;
  movingLesson?: Lesson | null;
  onMoveSelect?: (lesson: Lesson | null) => void;
  onCopySelect?: (lesson: Lesson) => void;
  onCancelDated?: (lesson: Lesson, date: string) => void;
  onRestoreDated?: (lesson: Lesson, date: string) => void;
  onRemoveReplacement?: (lesson: Lesson, date: string) => void;
  onQuickJump?: (target: QuickJumpTarget) => void;
  isSelectMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (lesson: Lesson) => void;
  onSwapSelect?: (lesson: Lesson) => void;
  onSelectMultiple?: (lesson: Lesson) => void;
  isSwapSource?: boolean;
  onOpenPermanentSchedule?: (lesson: Lesson) => void;
  isTemplateMode?: boolean;
  onDeleteTemplate?: (lesson: Lesson) => void;
  currentTeacherId?: number | null;
  currentTeacherName?: string | null;
  onOpenSubjectHub?: (target: SubjectHubTarget) => void;
}

export const LessonCard = memo(function LessonCard({
  lesson,
  targetDate,
  mode,
  scheduleMode,
  canEdit,
  hideTimeColumn = false,
  onEdit,
  movingLesson,
  onMoveSelect,
  onCopySelect,
  onCancelDated,
  onRestoreDated,
  onQuickJump,
  isSelected = false,
  onSwapSelect,
  isSwapSource = false,
  onOpenPermanentSchedule,
  isTemplateMode = false,
  onDeleteTemplate,
  onRemoveReplacement,
  learningMode = null,
  currentTeacherId = null,
  currentTeacherName = null,
  onOpenSubjectHub,
}: LessonCardProps) {
  const { isMounted, isMobile } = useViewportTier();
  const showSmPlus = !isMounted || !isMobile;
  const showMobile = !isMounted || isMobile;
  const isSelectedForMove = movingLesson?.id === lesson.id;
  const isDay = mode !== "week";
  const isEvent = Boolean(lesson.event_type || lesson.event_id);
  const canEditAction = canEdit && !lesson.is_cancelled;
  const canMove = canEditAction && !!onMoveSelect;
  const canOpenSubjectHub = Boolean(
    onOpenSubjectHub && !canMove && !isSelected && !onSwapSelect && lesson.subject_name
  );
  const handleSubjectClick = useCallback(
    (e: React.MouseEvent) => {
      if (!onOpenSubjectHub || !lesson.subject_name) return;
      e.stopPropagation();
      vibrateTap(8);
      onOpenSubjectHub({
        subjectId: lesson.subject_id > 0 ? lesson.subject_id : null,
        subjectName: lesson.subject_name,
        groupId: lesson.group_id ?? null,
        groupName: lesson.group_name ?? null,
        teacherId: scheduleMode === "teacher" ? currentTeacherId : null,
        teacherName: scheduleMode === "teacher" ? currentTeacherName : null,
        sourceLesson: lesson,
      });
    },
    [onOpenSubjectHub, lesson, scheduleMode, currentTeacherId]
  );
  const renderSubjectTitle = (sizeClasses: string, titleAttr?: string) => (
    <h3
      title={titleAttr}
      className={`${sizeClasses} break-words ${
        lesson.is_cancelled ? "line-through text-sys-text-muted" : "text-sys-text-subject"
      }`}
    >
      {canOpenSubjectHub ? (
        <button
          type="button"
          onClick={handleSubjectClick}
          aria-haspopup="dialog"
          className="text-left cursor-pointer hover:text-sys-accent hover:underline decoration-sys-accent/45 underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sys-accent/70 rounded-sm transition-colors"
        >
          {lesson.subject_name}
        </button>
      ) : (
        lesson.subject_name
      )}
    </h3>
  );
  const [startT, endT] = lesson.time.split("-");

  const [isHwOpen, setIsHwOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [noteModalMode, setNoteModalMode] = useState<"edit" | "history" | null>(null);
  const { settings, updateSetting } = useUserSettings();
  const showHw = settings.showHomeworkBadges;
  const selectedSubgroup = settings.defaultSubgroup;

  const toggleHw = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    vibrateTap(10);
    setIsHwOpen((prev) => !prev);
  };

  const [nowState, setNowState] = useState<KyivNowSnapshot | null>(() => getSharedKyivNowSnapshot());

  useEffect(() => {
    setNowState(ensureSharedKyivNowSnapshot());
    return subscribeKyivNow(setNowState);
  }, []);

  const { isLinked, isLinkedToGroup, submissions, personalTeachers, personalSubgroup } = useClassroomSubmissions();
  const { isTeacherUnlocked } = useTeacherAccess();

  const isTeacherView = scheduleMode === "teacher";
  const hasGroupAccess = useMemo(() => {
    if (canEdit || scheduleMode === "admin" || (isTeacherView && isTeacherUnlocked)) return true;
    if (!lesson.group_id) return true;
    return isLinkedToGroup(lesson.group_id);
  }, [canEdit, scheduleMode, isTeacherView, isTeacherUnlocked, lesson.group_id, isLinkedToGroup]);

  const handleLockedMeetingClick = useCallback((e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    vibrateTap(12);
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("prompt-classroom-link", {
          detail: {
            groupId: lesson.group_id,
            groupName: lesson.group_name,
            isTeacherView,
            message: isTeacherView
              ? `Для переходу на пару групи ${lesson.group_name || ""} прив'яжіть Google Classroom цієї групи або введіть PIN-код викладача.`
              : "Для переходу на онлайн-дзвінок необхідно прив'язати студентський Google Classroom цієї групи.",
          },
        })
      );
    }
  }, [lesson.group_id, lesson.group_name, isTeacherView]);

  const toast = useOptionalToast();

  const handleMeetingLinkClick = useCallback((e: React.MouseEvent<HTMLAnchorElement>, meeting: MeetingInfo) => {
    e.stopPropagation();
    vibrateTap(12);
    if (meeting.passcode) {
      copyTextToClipboard(meeting.passcode);
      toast?.showToast(`Код доступу Zoom (${meeting.passcode}) скопійовано!`, "success");
    }
  }, [toast]);

  const hasMultipleTeachers = Boolean(
    lesson.second_teacher_id ||
    (lesson.teacher_name && /[,/]/.test(lesson.teacher_name)) ||
    (lesson.teacher_room && lesson.second_teacher_room)
  );

  const activeTeacherIdx = useMemo(() => {
    if (!isTeacherView || !hasMultipleTeachers) return null;
    if (currentTeacherId != null) {
      if (lesson.second_teacher_id && lesson.second_teacher_id === currentTeacherId) return 1;
      if (lesson.teacher_id && lesson.teacher_id === currentTeacherId) return 0;
    }
    if (currentTeacherName && lesson.teacher_name) {
      const parts = lesson.teacher_name.split(/\s*[,/]\s*/).map((p) => p.trim().toLowerCase());
      const curLastName = currentTeacherName.trim().toLowerCase().split(/[\s.]+/)[0];
      if (parts[1] && (parts[1].includes(curLastName) || curLastName.includes(parts[1].split(/[\s.]+/)[0]))) return 1;
      if (parts[0] && (parts[0].includes(curLastName) || curLastName.includes(parts[0].split(/[\s.]+/)[0]))) return 0;
    }
    return 0;
  }, [isTeacherView, hasMultipleTeachers, currentTeacherId, lesson.second_teacher_id, lesson.teacher_id, currentTeacherName, lesson.teacher_name]);

  const secondaryItems = useMemo(() => {
    if (isTeacherView) {
      const groups = parseLessonGroups(lesson);
      if (hasMultipleTeachers && activeTeacherIdx !== null) {
        return groups.map((g) => ({
          ...g,
          displayName: `${g.displayName} · ${activeTeacherIdx + 1} підгр.`,
        }));
      }
      return groups;
    }
    return parseLessonTeachers(lesson);
  }, [isTeacherView, lesson, hasMultipleTeachers, activeTeacherIdx]);

  const isDualTeachers = !isTeacherView && secondaryItems.length === 2;
  const isDualTeachersOrSplit = isDualTeachers || (isTeacherView && hasMultipleTeachers);

  const effectiveSubgroup = useMemo(() => {
    if (selectedSubgroup === 1 || selectedSubgroup === 2) return selectedSubgroup;
    if (selectedSubgroup === "all") return null;
    if (!isDualTeachers || !isLinked) return null;
    if (personalSubgroup === 1 || personalSubgroup === 2) return personalSubgroup;

    const s0 = secondaryItems[0]?.name ? secondaryItems[0].name.split(/[\s.]+/)[0].toLowerCase() : "";
    const s1 = secondaryItems[1]?.name ? secondaryItems[1].name.split(/[\s.]+/)[0].toLowerCase() : "";

    const matches0 = s0 ? personalTeachers.some((pt) => pt.toLowerCase().includes(s0) || s0.includes(pt.toLowerCase())) : false;
    const matches1 = s1 ? personalTeachers.some((pt) => pt.toLowerCase().includes(s1) || s1.includes(pt.toLowerCase())) : false;

    if (matches0 && !matches1) return 1;
    if (matches1 && !matches0) return 2;
    return null;
  }, [selectedSubgroup, isDualTeachers, isLinked, personalSubgroup, secondaryItems, personalTeachers]);

  const handleSubgroupToggle = (target: 1 | 2 | "all") => {
    vibrateTap(10);
    if (target === "all" || effectiveSubgroup === target) {
      updateSetting("defaultSubgroup", "all");
    } else {
      updateSetting("defaultSubgroup", target);
    }
  };

  const startMin = parseMinutes(startT);
  const endMin = parseMinutes(endT);
  const isTodayTarget = nowState?.dateIso === targetDate;

  const isLive = Boolean(
    isTodayTarget && startMin !== null && endMin !== null && nowState && nowState.minutes >= startMin && nowState.minutes < endMin
  );
  const isUpcomingSoon = Boolean(
    isTodayTarget && startMin !== null && nowState && nowState.minutes >= startMin - 15 && nowState.minutes < startMin
  );
  const isMeetingLiveOrSoon = isLive || isUpcomingSoon;

  const progressPercent =
    isLive && startMin !== null && endMin !== null && nowState
      ? Math.min(100, Math.max(0, Math.round(((nowState.minutes - startMin) / (endMin - startMin)) * 100)))
      : 0;
  const remainingMin = isLive && endMin !== null && nowState ? Math.max(1, endMin - nowState.minutes) : 0;

  const rawTasks = useMemo(
    () => (isTeacherView || canEdit || scheduleMode === "admin" || !hasGroupAccess ? [] : extractClassroomTasks(lesson.note)),
    [isTeacherView, canEdit, scheduleMode, hasGroupAccess, lesson.note]
  );

  const tasks = useMemo(() => {
    const sorted = sortTasksByDeadline(rawTasks);
    return sorted.filter((t) => {
      if (!isOwnTask(isLinked, submissions, t.url, t.teacher, personalTeachers, t.title, effectiveSubgroup)) {
        return false;
      }
      const key = extractClassroomTaskKey(t.url);
      const sub = submissions[t.url] || (key ? submissions[key] : null);
      return !(isLinked && sub && (sub.state === "TURNED_IN" || sub.state === "RETURNED"));
    });
  }, [rawTasks, isLinked, submissions, personalTeachers, effectiveSubgroup]);

  const allOwnTasks = useMemo(
    () => rawTasks.filter((t) => isOwnTask(isLinked, submissions, t.url, t.teacher, personalTeachers, t.title, effectiveSubgroup)),
    [rawTasks, isLinked, submissions, personalTeachers, effectiveSubgroup]
  );

  const completedTasks = useMemo(() => {
    if (!isLinked) return [];
    return allOwnTasks.filter((t) => {
      const key = extractClassroomTaskKey(t.url);
      const sub = submissions[t.url] || (key ? submissions[key] : null);
      return sub && (sub.state === "TURNED_IN" || sub.state === "RETURNED");
    });
  }, [isLinked, allOwnTasks, submissions]);

  const nearestDated = useMemo(
    () => tasks.find((t) => t.deadline.formattedDate || (t.deadline.day && t.deadline.month)) || null,
    [tasks]
  );
  const highlightTask = nearestDated || tasks[0] || null;

  const meetings = useMemo(
    () =>
      extractOnlineMeetings(
        lesson.note,
        lesson.room,
        lesson.teacher_name,
        lesson.subject_name,
        lesson.teacher_room,
        lesson.second_teacher_room
      ),
    [lesson.note, lesson.room, lesson.teacher_name, lesson.subject_name, lesson.teacher_room, lesson.second_teacher_room]
  );
  const visibleNoteText = useMemo(() => getVisibleUserNote(lesson.note), [lesson.note]);
  const hasMeeting = meetings.length > 0;

  const rawRooms = useMemo(() => {
    if (!lesson.room) return [];
    return lesson.room.split(/\s*[,/;]\s*/).map((r) => r.trim()).filter(Boolean);
  }, [lesson.room]);

  const rooms = useMemo(() => {
    if (rawRooms.length === 0) return [];
    if (!isDualTeachers && learningMode === "online" && meetings.length > 0) return [];
    return rawRooms;
  }, [rawRooms, isDualTeachers, learningMode, meetings.length]);

  const teacherMeetings = useMemo(() => {
    if (!isDualTeachersOrSplit || meetings.length === 0) return [null, null] as [MeetingInfo | null, MeetingInfo | null];
    const teacherNames = isTeacherView
      ? (lesson.teacher_name ? lesson.teacher_name.split(/\s*[,/]\s*/).map((s) => s.trim()) : [])
      : [secondaryItems[0]?.name || "", secondaryItems[1]?.name || ""];
    return resolveTeacherMeetings(meetings, teacherNames);
  }, [isDualTeachersOrSplit, isTeacherView, lesson.teacher_name, secondaryItems, meetings]);

  const teacherSpecificRoom = useMemo(() => {
    if (!isTeacherView || !hasMultipleTeachers || activeTeacherIdx === null) return null;
    const r =
      activeTeacherIdx === 1
        ? lesson.second_teacher_room || (rawRooms.length > 1 ? rawRooms[1] : null)
        : lesson.teacher_room || (rawRooms.length > 0 ? rawRooms[0] : null);
    return r ? r.replace(/^ауд\.?\s*/i, "") : null;
  }, [isTeacherView, hasMultipleTeachers, activeTeacherIdx, lesson.second_teacher_room, lesson.teacher_room, rawRooms]);

  const teacherSpecificMeeting = useMemo(() => {
    if (!isTeacherView || !hasMultipleTeachers || activeTeacherIdx === null) return null;
    const own = teacherMeetings[activeTeacherIdx];
    if (own) return own;
    const otherIdx = activeTeacherIdx === 0 ? 1 : 0;
    if (meetings.length === 1 && !teacherMeetings[otherIdx]) return meetings[0];
    return null;
  }, [isTeacherView, hasMultipleTeachers, activeTeacherIdx, teacherMeetings, meetings]);

  const isTeacherSubgroupShown = isTeacherView && hasMultipleTeachers && activeTeacherIdx !== null;

  const singleSubgroupIdx = useMemo(() => {
    if (!isDualTeachers || effectiveSubgroup === null) return null;
    const idx = effectiveSubgroup - 1;
    return idx >= 0 && idx < secondaryItems.length ? idx : null;
  }, [isDualTeachers, effectiveSubgroup, secondaryItems.length]);

  const isSingleSubgroupShown = singleSubgroupIdx !== null;

  const singleSubgroupMeeting = useMemo(() => {
    if (singleSubgroupIdx === null) return null;
    const own = teacherMeetings[singleSubgroupIdx];
    if (own) return own;
    const otherIdx = singleSubgroupIdx === 0 ? 1 : 0;
    if (meetings.length === 1 && !teacherMeetings[otherIdx]) {
      const otherSurname = (secondaryItems[otherIdx]?.name || "").split(/[\s.]+/)[0].toLowerCase();
      const mLabel = (meetings[0].label || "").toLowerCase();
      if (!otherSurname || !mLabel.includes(otherSurname)) return meetings[0];
    }
    return null;
  }, [singleSubgroupIdx, teacherMeetings, meetings, secondaryItems]);

  const singleSubgroupRoom = useMemo(() => {
    if (singleSubgroupIdx === null) return null;
    const r =
      singleSubgroupIdx === 0
        ? lesson.teacher_room || (rawRooms.length > 0 ? rawRooms[0] : null)
        : lesson.second_teacher_room || (rawRooms.length > 1 ? rawRooms[1] : null);
    return r ? r.replace(/^ауд\.?\s*/i, "") : null;
  }, [singleSubgroupIdx, lesson.teacher_room, lesson.second_teacher_room, rawRooms]);

  const row3Meetings = useMemo(() => {
    if (!isDualTeachers) return meetings;
    return meetings.filter((m) => m !== teacherMeetings[0] && m !== teacherMeetings[1]);
  }, [isDualTeachers, meetings, teacherMeetings]);

  const primaryMeeting = isTeacherSubgroupShown
    ? teacherSpecificMeeting
    : (isDualTeachers ? (isSingleSubgroupShown ? singleSubgroupMeeting : row3Meetings[0]) : meetings[0]) ?? null;
  const hasMobileMeeting = Boolean(primaryMeeting);

  const displayRooms = useMemo(() => {
    if (isTeacherSubgroupShown) {
      if (!teacherSpecificRoom || teacherSpecificMeeting) return [];
      return [teacherSpecificRoom];
    }
    if (isSingleSubgroupShown) {
      if (!singleSubgroupRoom || singleSubgroupMeeting) return [];
      return [singleSubgroupRoom];
    }
    return rooms;
  }, [isTeacherSubgroupShown, teacherSpecificRoom, teacherSpecificMeeting, isSingleSubgroupShown, singleSubgroupRoom, singleSubgroupMeeting, rooms]);

  const roomsLabel = useMemo(() => formatRoomsList(displayRooms), [displayRooms]);
  const effectiveHasMobileMeeting = hasMobileMeeting || (!hasGroupAccess && Boolean(lesson.has_protected_link || (lesson.is_online && displayRooms.length === 0)));
  const effectiveHasMeeting = hasMeeting || (!hasGroupAccess && Boolean(lesson.has_protected_link || lesson.is_online));
  const hasBothRoomAndMeet = displayRooms.length > 0 && (isTeacherSubgroupShown ? Boolean(teacherSpecificMeeting) : isSingleSubgroupShown ? effectiveHasMobileMeeting : effectiveHasMeeting);

  const weekGridMeetings = useMemo(() => {
    if (isTeacherSubgroupShown) return teacherSpecificMeeting ? [teacherSpecificMeeting] : [];
    if (!isDualTeachers) return meetings;
    if (isSingleSubgroupShown) return singleSubgroupMeeting ? [singleSubgroupMeeting] : [];
    return row3Meetings;
  }, [isTeacherSubgroupShown, teacherSpecificMeeting, isDualTeachers, isSingleSubgroupShown, singleSubgroupMeeting, row3Meetings, meetings]);

  const groupedTasks = useMemo(() => {
    if (!isDualTeachers || tasks.length === 0) return [{ teacher: null, items: tasks }];
    return groupDualTeacherTasks(tasks, secondaryItems, effectiveSubgroup);
  }, [isDualTeachers, tasks, secondaryItems, effectiveSubgroup]);

  const groupedCompletedTasks = useMemo(() => {
    if (!isDualTeachers || completedTasks.length === 0) return [{ teacher: null, items: completedTasks }];
    return groupDualTeacherTasks(completedTasks, secondaryItems, effectiveSubgroup);
  }, [isDualTeachers, completedTasks, secondaryItems, effectiveSubgroup]);

  const eventBadge = useMemo(
    () => getEventBadge(lesson.event_type, lesson.event_title),
    [lesson.event_type, lesson.event_title]
  );

  const stateClass = isSwapSource
    ? "border-amber-400 ring-2 ring-amber-400/80 bg-amber-400/10 shadow-[0_0_15px_rgba(251,191,36,0.2)]"
    : isSelected
      ? "border-sys-accent ring-2 ring-sys-accent/60 bg-sys-accent/10"
      : lesson.is_cancelled
        ? "border-rose-500/40 border-dashed bg-rose-500/[0.04] opacity-80"
        : isLive
          ? "border-sys-accent/60 ring-1 ring-sys-accent/50 bg-gradient-to-r from-sys-accent/[0.12] via-sys-card to-sys-card shadow-[0_0_22px_rgb(var(--sys-accent)/0.18)]"
          : eventBadge
            ? eventBadge.cardClass
            : lesson.is_replacement
              ? "border-sys-warning/40 ring-1 ring-sys-warning/60 bg-sys-warning/[0.03]"
              : isSelectedForMove
                ? "border-emerald-400 ring-1 ring-emerald-400/70"
                : !isDay && isTodayTarget
                  ? "border-sys-accent/40 bg-sys-accent/[0.05] shadow-[0_0_14px_rgb(var(--sys-accent)/0.1)] hover:border-sys-accent/60"
                  : "border-sys-border hover:border-sys-elevatedBorder";

  const sharedActionProps = {
    lesson,
    targetDate,
    isEvent,
    canEditAction,
    canMove,
    isTemplateMode,
    movingLesson,
    visibleNoteText,
    moreOpen,
    onToggleMore: () => setMoreOpen((prev) => !prev),
    onCloseMore: () => setMoreOpen(false),
    onEdit,
    onRestoreDated,
    onRemoveReplacement,
    onCopySelect,
    onMoveSelect,
    onSwapSelect,
    onDeleteTemplate,
    onCancelDated,
    onOpenPermanentSchedule,
    onOpenNoteModal: (modeValue: "edit" | "history") => setNoteModalMode(modeValue),
  };

  const sharedSubgroupProps = {
    lesson,
    isTeacherView,
    isDualTeachers,
    isSingleSubgroupShown,
    singleSubgroupIdx,
    effectiveSubgroup,
    selectedSubgroup,
    secondaryItems,
    teacherMeetings,
    row3Meetings,
    rawRooms,
    hasGroupAccess,
    isLive,
    isMeetingLiveOrSoon,
    onSubgroupToggle: handleSubgroupToggle,
    onQuickJump,
    onLockedClick: handleLockedMeetingClick,
    onMeetingLinkClick: handleMeetingLinkClick,
  };

  return (
    <article
      data-live={isLive ? "true" : undefined}
      data-open={isHwOpen || moreOpen ? "true" : undefined}
      draggable={canMove}
      onDragStart={(event) => {
        if (!canMove) {
          event.preventDefault();
          return;
        }
        event.dataTransfer.setData("text/plain", String(lesson.id));
        event.dataTransfer.effectAllowed = event.altKey ? "copy" : "move";
        if (event.altKey && onCopySelect) {
          onCopySelect(lesson);
        } else {
          onMoveSelect?.(lesson);
        }
      }}
      className={`interactive-surface group relative flex min-w-0 flex-col rounded-2xl border bg-sys-card shadow-sm transition-[transform,border-color,background-color] duration-150 ease-out hover:border-sys-border/90 active:scale-[0.99] ${
        isHwOpen || moreOpen ? "z-40 !translate-y-0" : ""
      } ${
        isDay
          ? "lesson-card-day"
          : "lesson-card-week rounded-xl h-full flex flex-col justify-between"
      } ${stateClass} ${!lesson.is_relevant_this_week ? "opacity-60" : ""} ${
        canMove ? "cursor-grab active:cursor-grabbing" : ""
      }`}
    >
      {/* Desktop/Tablet 3-Zone Horizontal Layout (for Day mode on screens >= sm) */}
      {isDay && showSmPlus && (
        <div className="hidden sm:flex sm:items-stretch gap-4 w-full flex-1">
          {!hideTimeColumn && (
            <div className="w-24 sm:w-28 shrink-0 self-start flex flex-col items-start pr-4 border-r border-sys-border/50 text-left pt-1">
              <span className={`ui-mono-slot text-2xl sm:text-[26px] font-black leading-none transition-colors ${isLive ? "text-sys-accent" : "text-sys-text-primary group-hover:text-sys-accent"}`}>
                {lesson.lesson_number}
              </span>
              <div className="ui-mono-slot mt-1.5 flex flex-col leading-tight whitespace-nowrap">
                <span className="text-sm sm:text-[15px] font-bold text-sys-text-primary">{startT}</span>
                <span className="text-xs text-sys-text-muted mt-0.5">
                  {endT || DEFAULT_LESSON_TIMES[lesson.lesson_number]?.split("-")[1] || ""}
                </span>
              </div>
              {isLive && (
                <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-sys-accent/15 border border-sys-accent/30 px-2.5 py-0.5 text-xs font-bold text-sys-accent whitespace-nowrap">
                  <span className="h-2 w-2 rounded-full bg-sys-accent shrink-0" />
                  <span>ще {remainingMin} хв</span>
                </div>
              )}
            </div>
          )}

          <div className="flex-1 min-w-0 flex flex-col justify-between gap-2.5 pl-1 sm:pl-2">
            <div className="flex items-start justify-between gap-4 w-full">
              <div className="flex-1 min-w-0 flex flex-col justify-center gap-1">
                {renderSubjectTitle("font-bold leading-snug text-base sm:text-[18px] lg:text-[19px]")}
                {lesson.event_title && lesson.event_title !== lesson.subject_name && (
                  <span className="text-xs sm:text-sm font-semibold text-sys-text-secondary">
                    {lesson.event_title}
                  </span>
                )}
                <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm text-sys-text-secondary mt-0.5">
                  <SubgroupTeacherBlock variant="desktop-day" {...sharedSubgroupProps} />
                </div>
              </div>

              <div className="shrink-0 flex flex-col items-end justify-start gap-2 pt-0.5">
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {(!isDualTeachers || isSingleSubgroupShown) && displayRooms.length > 0 && (
                    <div className="ui-mono-slot inline-flex h-8 px-3 items-center gap-1.5 rounded-lg border border-sys-border bg-sys-bg text-sys-text-secondary font-medium text-xs shadow-xs whitespace-nowrap">
                      <span>{roomsLabel}</span>
                    </div>
                  )}
                  {primaryMeeting ? (
                    <MeetingActionBadge
                      meeting={primaryMeeting}
                      variant="desktop-day"
                      hasGroupAccess={hasGroupAccess}
                      isLiveOrSoon={isMeetingLiveOrSoon}
                      onLockedClick={handleLockedMeetingClick}
                      onLinkClick={handleMeetingLinkClick}
                    />
                  ) : (!isDualTeachers || isSingleSubgroupShown) && !hasGroupAccess && (lesson.has_protected_link || (lesson.is_online && displayRooms.length === 0)) ? (
                    <LockedMeetingBadge platform={meetings[0]?.platform} size="normal" onClick={handleLockedMeetingClick} />
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center justify-end gap-1.5">
                  <TemplateWeekBadge isTemplateMode={isTemplateMode} weekType={lesson.week_type} />
                  <LessonStatusBadge lesson={lesson} eventBadge={eventBadge} />
                  {canEdit && <LessonCardActions variant="desktop-day" {...sharedActionProps} />}
                </div>
              </div>
            </div>

            {showHw && (
              <DayTasksSection
                variant="desktop"
                lesson={lesson}
                tasks={tasks}
                highlightTask={highlightTask}
                groupedTasks={groupedTasks}
                completedTasksCount={completedTasks.length}
                groupedCompletedTasks={groupedCompletedTasks}
                submissions={submissions}
                isDualTeachers={isDualTeachers}
                isLinked={isLinked}
                isHwOpen={isHwOpen}
                onToggleHw={toggleHw}
              />
            )}

            {visibleNoteText && (
              <p title={visibleNoteText} className="flex items-center gap-1.5 text-xs text-sys-text-secondary/60 italic min-w-0">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-sys-text-muted">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                <span className="truncate">{visibleNoteText}</span>
              </p>
            )}
          </div>
        </div>
      )}

      {/* Mobile Day Mode (< sm) */}
      {isDay && showMobile && (
        <div className="flex sm:hidden flex-col gap-2 w-full">
          {(!hideTimeColumn || canEdit || isLive || lesson.is_cancelled || eventBadge || lesson.is_replacement || (isTemplateMode && lesson.week_type !== "both") || (!hasBothRoomAndMeet && !isDualTeachers && (rooms.length > 0 || effectiveHasMeeting))) && (
            <div className="flex flex-wrap items-center justify-between gap-2 w-full min-h-[34px]">
              <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                {!hideTimeColumn && (
                  <div className="ui-mono-slot flex items-center gap-2 whitespace-nowrap">
                    <span className={`text-base font-black leading-none transition-colors ${isLive ? "text-sys-accent" : "text-sys-text-primary group-hover:text-sys-accent"}`}>
                      {lesson.lesson_number}
                    </span>
                    <span className="text-sys-text-muted font-bold text-xs">·</span>
                    <span className="text-xs font-semibold text-sys-text-secondary tracking-tight whitespace-nowrap">
                      {startT}–{endT || DEFAULT_LESSON_TIMES[lesson.lesson_number]?.split("-")[1] || ""}
                    </span>
                  </div>
                )}
                <TemplateWeekBadge isTemplateMode={isTemplateMode} weekType={lesson.week_type} />
                <LessonStatusBadge lesson={lesson} eventBadge={eventBadge} compact />
                {canEdit && !isDualTeachers && rooms.length > 0 && (
                  <span className="ui-mono-slot inline-flex h-6 px-2 items-center rounded-md border border-sys-border bg-sys-bg text-sys-text-secondary font-medium text-xs whitespace-nowrap">
                    {roomsLabel}
                  </span>
                )}
              </div>

              {canEdit ? (
                <LessonCardActions variant="mobile-day" {...sharedActionProps} />
              ) : isLive ? (
                <div className="ui-mono-slot shrink-0 flex items-center gap-1.5 rounded-full bg-sys-accent/15 border border-sys-accent/30 px-2.5 py-0.5 text-xs font-bold text-sys-accent whitespace-nowrap ml-auto">
                  <span className="h-2 w-2 rounded-full bg-sys-accent shrink-0" />
                  <span>ще {remainingMin} хв</span>
                </div>
              ) : !hasBothRoomAndMeet && (!isDualTeachers || isSingleSubgroupShown) ? (
                <div className="shrink-0 flex items-center gap-2 ml-auto">
                  {displayRooms.length > 0 && (
                    <div
                      title={roomsLabel}
                      className="ui-mono-slot inline-flex h-8 px-2.5 items-center gap-1 rounded-lg border border-sys-border bg-sys-bg text-sys-text-secondary font-medium text-xs shadow-xs max-w-[160px] truncate whitespace-nowrap"
                    >
                      <span className="truncate">{roomsLabel}</span>
                    </div>
                  )}
                  {primaryMeeting ? (
                    <MeetingActionBadge
                      meeting={primaryMeeting}
                      variant="mobile-header"
                      hasGroupAccess={hasGroupAccess}
                      isLiveOrSoon={isMeetingLiveOrSoon}
                      onLockedClick={handleLockedMeetingClick}
                      onLinkClick={handleMeetingLinkClick}
                    />
                  ) : !hasGroupAccess && (lesson.has_protected_link || (lesson.is_online && displayRooms.length === 0)) ? (
                    <LockedMeetingBadge platform={meetings[0]?.platform} size="normal" onClick={handleLockedMeetingClick} />
                  ) : null}
                </div>
              ) : null}
            </div>
          )}

          <div>
            {renderSubjectTitle("font-semibold leading-snug text-base")}
            {lesson.event_title && lesson.event_title !== lesson.subject_name && (
              <span className="text-xs font-medium text-sys-text-secondary mt-0.5 block">
                {lesson.event_title}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm text-sys-text-secondary">
            <SubgroupTeacherBlock variant="mobile-day" {...sharedSubgroupProps} />
          </div>

          {(!isDualTeachers || isSingleSubgroupShown) &&
            ((isLive && (displayRooms.length > 0 || hasMobileMeeting || (!hasGroupAccess && (lesson.is_online || lesson.has_protected_link)))) ||
              hasBothRoomAndMeet ||
              (canEdit && (hasMobileMeeting || (!hasGroupAccess && lesson.has_protected_link)))) && (
              <div className="flex flex-wrap items-center gap-2 w-full mt-0.5">
                {!canEdit && displayRooms.length > 0 && (
                  <div
                    title={roomsLabel}
                    className="ui-mono-slot inline-flex min-h-[38px] px-3 items-center rounded-xl border border-[#3f3f46] bg-sys-bg text-sys-text-secondary font-medium text-xs shadow-xs max-w-[55%] truncate"
                  >
                    <span className="truncate">{roomsLabel}</span>
                  </div>
                )}
                {primaryMeeting ? (
                  <MeetingActionBadge
                    meeting={primaryMeeting}
                    variant="mobile-row"
                    hasGroupAccess={hasGroupAccess}
                    isLiveOrSoon={isMeetingLiveOrSoon}
                    onLockedClick={handleLockedMeetingClick}
                    onLinkClick={handleMeetingLinkClick}
                  />
                ) : !hasGroupAccess && (lesson.has_protected_link || (lesson.is_online && displayRooms.length === 0)) ? (
                  <LockedMeetingBadge platform={meetings[0]?.platform} size="normal" onClick={handleLockedMeetingClick} />
                ) : null}
              </div>
            )}

          {showHw && (
            <DayTasksSection
              variant="mobile"
              lesson={lesson}
              tasks={tasks}
              highlightTask={highlightTask}
              groupedTasks={groupedTasks}
              completedTasksCount={completedTasks.length}
              groupedCompletedTasks={groupedCompletedTasks}
              submissions={submissions}
              isDualTeachers={isDualTeachers}
              isLinked={isLinked}
              isHwOpen={isHwOpen}
              onToggleHw={toggleHw}
            />
          )}

          {visibleNoteText && (
            <p className="flex items-center gap-1.5 text-xs text-sys-text-secondary/80 italic mt-1">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-sys-text-muted">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <span>{visibleNoteText}</span>
            </p>
          )}
        </div>
      )}

      {/* Week Mode Layout */}
      {!isDay && (
        <div className="flex items-start gap-2.5 sm:gap-3 h-full">
          {!hideTimeColumn && (
            <div className="ui-mono-slot flex w-11 sm:w-12 shrink-0 flex-col text-left">
              <span className={`text-lg sm:text-xl font-bold leading-none transition-colors ${isLive ? "text-sys-accent font-black" : "text-sys-text-primary"}`}>
                {lesson.lesson_number}
              </span>
              <span className="text-xs sm:text-xs font-semibold text-sys-text-secondary mt-1 whitespace-nowrap">
                {startT}
              </span>
              {isLive && (
                <span className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-sys-accent whitespace-nowrap">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-sys-accent" />
                  <span>{remainingMin}хв</span>
                </span>
              )}
            </div>
          )}

          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="min-w-0">
              {renderSubjectTitle("font-semibold leading-snug text-sm sm:text-[15px]", lesson.subject_name)}
              {lesson.event_title && lesson.event_title !== lesson.subject_name && (
                <span className="mt-0.5 block text-xs font-medium text-sys-text-secondary">
                  {lesson.event_title}
                </span>
              )}
            </div>

            <SubgroupTeacherBlock variant="week" {...sharedSubgroupProps} />

            <div
              className="mt-auto flex flex-wrap items-end gap-x-2 gap-y-1.5 pt-2 w-full"
              style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: "6px 8px" }}
            >
              <div
                className="flex flex-wrap items-center gap-1.5 min-w-0 flex-1"
                style={{ display: "flex", flexWrap: "wrap", gap: "6px", flex: "1 1 auto", minWidth: 0 }}
              >
                {(!isDualTeachers || isSingleSubgroupShown) &&
                  displayRooms.length > 0 &&
                  displayRooms.map((rm, idx) => (
                    <span
                      key={`${rm}-${idx}`}
                      title={formatRoom(rm)}
                      className="ui-mono-slot inline-flex max-w-full items-center rounded-md border border-sys-border bg-sys-tabActive px-2 py-0.5 text-xs font-medium text-sys-text-primary whitespace-nowrap"
                    >
                      <span>{formatRoom(rm)}</span>
                    </span>
                  ))}

                {weekGridMeetings.map((m, idx) => (
                  <MeetingActionBadge
                    key={`${m.url}-${idx}`}
                    meeting={m}
                    variant="week"
                    hasGroupAccess={hasGroupAccess}
                    isLiveOrSoon={isLive && isMeetingLiveOrSoon}
                    onLockedClick={handleLockedMeetingClick}
                    onLinkClick={handleMeetingLinkClick}
                  />
                ))}

                {showHw && (
                  <WeekTasksTrigger
                    lesson={lesson}
                    tasks={tasks}
                    isLinked={isLinked}
                    isHwOpen={isHwOpen}
                    onToggleHw={toggleHw}
                  />
                )}

                <TemplateWeekBadge isTemplateMode={isTemplateMode} weekType={lesson.week_type} />
                <LessonStatusBadge lesson={lesson} eventBadge={eventBadge} compact />
              </div>

              {canEdit && <LessonCardActions variant="week" {...sharedActionProps} />}
            </div>

            <WeekTasksPopover
              show={showHw && tasks.length > 0 && isHwOpen}
              lesson={lesson}
              tasks={tasks}
              nearestDated={nearestDated}
              groupedTasks={groupedTasks}
              completedTasksCount={completedTasks.length}
              groupedCompletedTasks={groupedCompletedTasks}
              submissions={submissions}
              isLinked={isLinked}
              onClose={() => setIsHwOpen(false)}
              onToggleHw={toggleHw}
            />

            {visibleNoteText && (
              <p className="mt-1 flex items-center gap-1.5 text-xs text-sys-text-secondary/90 [overflow-wrap:anywhere] italic border-t border-sys-border/20 pt-1">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-sys-text-muted">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                <span>{visibleNoteText}</span>
              </p>
            )}
          </div>
        </div>
      )}

      {noteModalMode && (
        <LessonNoteModal
          lesson={lesson}
          date={targetDate}
          initialMode={noteModalMode}
          onClose={() => setNoteModalMode(null)}
        />
      )}

      {isLive && (
        <div className="absolute left-4 right-4 bottom-2.5 h-[3px] rounded-full overflow-hidden bg-blue-500/20">
          <div
            className="h-full rounded-full bg-sys-accent transition-[width] duration-300 ease-out"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      )}
    </article>
  );
});
