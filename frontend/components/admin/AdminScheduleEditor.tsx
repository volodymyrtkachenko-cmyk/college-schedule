"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import dynamic from "next/dynamic";
import { ScheduleWeekGrid } from "../ScheduleWeekGrid";
import { WeekTypeBadge } from "../WeekTypeBadge";
const LessonEditor = dynamic(() => import("../LessonEditor").then((m) => m.LessonEditor), { ssr: false });
import { Lesson, LessonMutation, AcademicEvent, AcademicEventType, api } from "../../lib/api";
import { invalidateScheduleCache, useSchedule } from "../../lib/hooks";
import { getMondayOf } from "../../lib/date";
import { formatFullWeekRange } from "../../lib/format";
import { SearchableSelect } from "../SearchableSelect";
import { useToast } from "../ToastProvider";
import { QuickJumpTarget, findGroupIdByName, findTeacherIdByName } from "../../lib/quickJump";
const OfficialPrintModal = dynamic(() => import("./OfficialPrintSheet").then((m) => m.OfficialPrintModal), { ssr: false });
const EventsModal = dynamic(() => import("./EventsModal").then((m) => m.EventsModal), { ssr: false });
import { DEFAULT_LESSON_TIMES, SHORTENED_LESSON_TIMES } from "../../lib/constants/lessons";
import { PageHeader } from "./PageHeader";
import { MobileWeekBar } from "../MobileWeekBar";
import { MobileWeekDaysStrip } from "../MobileWeekDaysStrip";
import { LessonCard } from "../LessonCard";
import { isSlotInPast } from "../ScheduleEditGrid";
import { useAuth } from "../../lib/auth";

function GraduationIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
      <path d="M6 12v5c3 3 9 3 12 0v-5" />
    </svg>
  );
}

function CalendarEventIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="18" height="18" x="3" y="4" rx="2" ry="2" />
      <line x1="16" x2="16" y1="2" y2="6" />
      <line x1="8" x2="8" y1="2" y2="6" />
      <line x1="3" x2="21" y1="10" y2="10" />
    </svg>
  );
}

function PrinterIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 6 2 18 2 18 9" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect width="12" height="8" x="6" y="14" />
    </svg>
  );
}

const MAX_ONE_OFF_WEEKS_AHEAD = 2;

export type ScheduleBuffer =
  | { type: "single"; mode: "move" | "copy"; lesson: Lesson; sourceDate: string }
  | { type: "day"; mode: "move" | "copy"; sourceDate: string; lessons: Lesson[] }
  | null;

export interface SwapState {
  lesson: Lesson;
  date: string;
}

const BUFFER_STORAGE_KEY = "college_schedule_editor_buffer";

export function AdminScheduleEditor() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [weekAnchorDate, setWeekAnchorDate] = useState(() => {
    const date = new Date();
    const day = date.getDay();
    if (day === 0 || day === 6) {
        date.setDate(date.getDate() + (day === 0 ? 1 : 2));
    }
    return getMondayOf(date);
  });

  const todayAnchor = useMemo(() => getMondayOf(new Date()), []);
  const isCurrentWeek = useMemo(() => {
    return Math.abs(weekAnchorDate.getTime() - todayAnchor.getTime()) < 1000 * 60 * 60 * 24;
  }, [weekAnchorDate, todayAnchor]);

  const diffWeeks = useMemo(() => {
    return Math.round((weekAnchorDate.getTime() - todayAnchor.getTime()) / (7 * 24 * 60 * 60 * 1000));
  }, [weekAnchorDate, todayAnchor]);

  const { mode, toggleMode, teachers, teacherId, setTeacherId, groups, groupId, setGroupId, today, week, loading, error, setToday, setWeek, updateLesson, removeLesson, addLesson } = useSchedule(weekAnchorDate, true);
  const [availabilityWeek, setAvailabilityWeek] = useState<Awaited<ReturnType<typeof api.week>> | null>(null);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [editor, setEditor] = useState<{ lesson?: Lesson; date: string } | null>(null);

  // Unified Buffer State (persists across week changes in sessionStorage)
  const [buffer, setBufferState] = useState<ScheduleBuffer>(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = sessionStorage.getItem(BUFFER_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  const setBuffer = (newBuf: ScheduleBuffer | ((prev: ScheduleBuffer) => ScheduleBuffer)) => {
    setBufferState((prev) => {
      const val = typeof newBuf === "function" ? newBuf(prev) : newBuf;
      if (typeof window !== "undefined") {
        try {
          if (val) sessionStorage.setItem(BUFFER_STORAGE_KEY, JSON.stringify(val));
          else sessionStorage.removeItem(BUFFER_STORAGE_KEY);
        } catch {}
      }
      return val;
    });
  };

  // Swap State
  const [swapSource, setSwapSource] = useState<SwapState | null>(null);

  const isRestrictedMode = Boolean(buffer || swapSource);
  const canGoPrev = !isRestrictedMode || diffWeeks > 0;
  const canGoNext = !isRestrictedMode || diffWeeks < MAX_ONE_OFF_WEEKS_AHEAD;

  const { showToast: setToast } = useToast();

  const handlePrevWeek = () => {
    if (!canGoPrev) {
      setToast("Далі змінювати не можна", "info");
      return;
    }
    const prev = new Date(weekAnchorDate);
    prev.setDate(prev.getDate() - 7);
    setWeekAnchorDate(prev);
  };

  const handleNextWeek = () => {
    if (!canGoNext) {
      setToast("Далі змінювати не можна", "info");
      return;
    }
    const next = new Date(weekAnchorDate);
    next.setDate(next.getDate() + 7);
    setWeekAnchorDate(next);
  };

  // Derived single moving lesson for compatibility
  const movingLesson = buffer?.type === "single" ? buffer.lesson : null;
  const isCopyMode = false;

  const [returnTarget, setReturnTarget] = useState<{ mode: "student" | "teacher"; id: number; label: string } | null>(null);
  const [moving, setMoving] = useState(false);
  const [versions, setVersions] = useState<import("../../lib/api").ScheduleVersion[]>([]);
  const activeVersion = useMemo(() => versions.find((v) => v.is_active) || versions[0] || null, [versions]);
  const weekType = (week?.[0]?.week_type) ?? today?.week_type ?? "both";
  const [curatorModalOpen, setCuratorModalOpen] = useState(false);
  const [curatorDay, setCuratorDay] = useState(4);
  const [curatorLesson, setCuratorLesson] = useState(4);
  const [curatorWeek, setCuratorWeek] = useState<"both" | "numerator" | "denominator">("both");
  const [curatorLoading, setCuratorLoading] = useState(false);
  const [printModalOpen, setPrintModalOpen] = useState(false);
  const [eventsModalOpen, setEventsModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<AcademicEvent | null>(null);

  const mobileScheduleRef = useRef<HTMLDivElement>(null);
  const scrollToMobileSchedule = useCallback(() => {
    if (typeof window !== "undefined" && window.innerWidth < 640 && mobileScheduleRef.current) {
      mobileScheduleRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  // Auto-scroll down on mobile when schedule is loaded with a selected group or teacher
  const hasAutoScrolled = useRef(false);
  useEffect(() => {
    if (!loading && week && (groupId || teacherId) && !hasAutoScrolled.current) {
      hasAutoScrolled.current = true;
      const timer = setTimeout(scrollToMobileSchedule, 300);
      return () => clearTimeout(timer);
    }
  }, [loading, week, groupId, teacherId, scrollToMobileSchedule]);

  // Close swap when mode/group changes, but preserve buffer across weeks!
  useEffect(() => {
    setSwapSource(null);
  }, [mode, groupId, teacherId]);

  // Esc key clears buffer and swap
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (swapSource) setSwapSource(null);
        else if (buffer) setBuffer(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [swapSource, buffer]);

  useEffect(() => {
    api.scheduleVersions.list()
      .then(setVersions)
      .catch((e) => console.error("Failed to load versions", e));
  }, []);

  // Очищуємо кеш доступності при зміні тижня
  useEffect(() => {
    setAvailabilityWeek(null);
    setAvailabilityError(null);
  }, [weekAnchorDate]);

  // Завантажуємо розклад усього коледжу коли адмін почав дію з буфером, обміном чи редагуванням
  const needsAvailability = Boolean(movingLesson || buffer || swapSource || editor);

  useEffect(() => {
    if (!needsAvailability || availabilityWeek !== null) return;
    let active = true;
    setAvailabilityError(null);
    const otherWeekAnchor = new Date(weekAnchorDate);
    otherWeekAnchor.setDate(otherWeekAnchor.getDate() + 7);
    Promise.all([
      api.week(undefined, undefined, weekAnchorDate),
      api.week(undefined, undefined, otherWeekAnchor),
    ])
      .then(([currentWeek, otherWeek]) => {
        if (active) setAvailabilityWeek([...currentWeek, ...otherWeek]);
      })
      .catch((cause) => {
        if (active)
          setAvailabilityError(
            cause instanceof Error ? cause.message : "Не вдалося перевірити вільні місця."
          );
      });
    return () => {
      active = false;
    };
  }, [needsAvailability, availabilityWeek, weekAnchorDate]);

  const weekRange = useMemo(() => {
    return formatFullWeekRange(weekAnchorDate);
  }, [weekAnchorDate]);

  const resetWeek = () => setWeekAnchorDate(getMondayOf(new Date()));
  const LESSON_TIMES: Record<number, string> = { 1: "09:00–10:20", 2: "10:40–12:00", 3: "12:30–13:50", 4: "14:00–15:20" };

  const edit = async (lesson: Lesson, date: string, payload: LessonMutation) => {
    try {
      const gid = payload.group_id ?? lesson.group_id ?? (groupId ?? 0);
      const isPermanentEdit = payload.is_replacement === false;
      if (isPermanentEdit) {
        if (!lesson.is_replacement && lesson.id > 0) {
          await api.template.updateLesson(lesson.id, {
            subject_id: payload.subject_id,
            teacher_id: payload.teacher_id,
            second_teacher_id: payload.second_teacher_id,
            day_of_week: lesson.day_of_week,
            lesson_number: payload.lesson_number,
            week_type: lesson.week_type || payload.week_type || "both",
            room: payload.room || "",
          });
        } else if (activeVersion?.id && gid && payload.subject_id) {
          const day = new Date(`${date}T12:00:00`).getDay() || 7;
          await api.template.createLesson({
            version_id: activeVersion.id,
            group_id: gid,
            subject_id: payload.subject_id,
            teacher_id: payload.teacher_id,
            second_teacher_id: payload.second_teacher_id,
            day_of_week: lesson.day_of_week || (day >= 1 && day <= 5 ? day : 1),
            lesson_number: payload.lesson_number,
            week_type: payload.week_type || lesson.week_type || "both",
            room: payload.room || "",
            date,
          });
          if (lesson.is_replacement) {
            try {
              await api.dated.restore({
                group_id: gid,
                date,
                lesson_number: payload.lesson_number,
              });
            } catch {
              // Ignore restore failure if no dated override existed
            }
          }
        } else {
          await api.dated.replace({
            group_id: gid,
            date,
            lesson_number: payload.lesson_number,
            subject_id: payload.subject_id ?? null,
            teacher_id: payload.teacher_id ?? null,
            second_teacher_id: payload.second_teacher_id ?? null,
            room: payload.room ?? null,
          });
        }
      } else {
        await api.dated.replace({
          group_id: gid,
          date,
          lesson_number: payload.lesson_number,
          subject_id: payload.subject_id ?? null,
          teacher_id: payload.teacher_id ?? null,
          second_teacher_id: payload.second_teacher_id ?? null,
          room: payload.room ?? null,
        });
      }
      invalidateScheduleCache();
      const refreshed = await api.week(
        mode === "student" ? (groupId ?? undefined) : undefined,
        mode === "teacher" ? (teacherId ?? undefined) : undefined,
        weekAnchorDate
      );
      setWeek(refreshed);
      setToast(isPermanentEdit ? "Постійний розклад оновлено." : "Разову зміну збережено.", "success");
    } catch (e: any) {
      setToast(e?.message || "Не вдалося зберегти зміну.", "error");
      throw e;
    }
  };

  const handleMoveSelect = (lesson: Lesson | null) => {
    if (lesson) {
      const srcDate = week?.find((d) => d.lessons.some((l) => l.id === lesson.id))?.date || week?.[0]?.date || "";
      setBuffer({ type: "single", mode: "move", lesson, sourceDate: srcDate });
    } else {
      setBuffer(null);
    }
  };

  const handleOpenPermanentSchedule = (lesson: Lesson) => {
    const vId = activeVersion ? activeVersion.id : "";
    const weekTypeParam = lesson.week_type === "denominator" ? "denominator" : "numerator";
    const highlightParam = `${lesson.day_of_week}-${lesson.lesson_number}`;
    const groupParam = lesson.group_id ? `&group_id=${lesson.group_id}` : (groupId ? `&group_id=${groupId}` : "");
    const teacherParam = lesson.teacher_id ? `&teacher_id=${lesson.teacher_id}` : (teacherId ? `&teacher_id=${teacherId}` : "");
    const modeParam = `&mode=${mode}`;
    window.location.href = `/admin?resource=permanent-schedule&version_id=${vId}&week_type=${weekTypeParam}&highlight=${highlightParam}${modeParam}${groupParam}${teacherParam}`;
  };

  const cancelOnDate = async (lesson: Lesson, date: string) => {
    if (!lesson.group_id) {
      setToast("Неможливо скасувати заняття без визначеної групи", "error");
      return;
    }
    try {
      await api.dated.cancel({
        group_id: lesson.group_id,
        date,
        lesson_number: lesson.lesson_number,
      });
      setToast("Заняття на дату скасовано.", "success");
      invalidateScheduleCache();
      const updatedWeek = await (mode === "student" && groupId ? api.week(groupId, undefined, weekAnchorDate, true) : teacherId ? api.week(undefined, teacherId, weekAnchorDate, true) : null);
      if (updatedWeek) setWeek(updatedWeek);
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Не вдалося скасувати заняття на дату", "error");
    }
  };

  const restoreOnDate = async (lesson: Lesson, date: string) => {
    if (!lesson.group_id) {
      setToast("Неможливо відновити заняття без визначеної групи", "error");
      return;
    }
    try {
      await api.dated.restore({
        group_id: lesson.group_id,
        date,
        lesson_number: lesson.lesson_number,
      });
      setToast("Заняття відновлено!", "success");
      invalidateScheduleCache();
      const updatedWeek = await (mode === "student" && groupId ? api.week(groupId, undefined, weekAnchorDate, true) : teacherId ? api.week(undefined, teacherId, weekAnchorDate, true) : null);
      if (updatedWeek) setWeek(updatedWeek);
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Не вдалося відновити заняття", "error");
    }
  };

  const removeReplacementOnDate = async (lesson: Lesson, date: string) => {
    if (!lesson.group_id) {
      setToast("Неможливо прибрати заміну без визначеної групи", "error");
      return;
    }
    try {
      await api.dated.removeReplacement({
        group_id: lesson.group_id,
        date,
        lesson_number: lesson.lesson_number,
      });
      setToast("Заміну прибрано, розклад відновлено.", "success");
      invalidateScheduleCache();
      const updatedWeek = await (mode === "student" && groupId ? api.week(groupId, undefined, weekAnchorDate, true) : teacherId ? api.week(undefined, teacherId, weekAnchorDate, true) : null);
      if (updatedWeek) setWeek(updatedWeek);
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Не вдалося прибрати заміну", "error");
    }
  };

  const handleQuickJump = (target: QuickJumpTarget) => {
    let targetId = target.id;
    if (!targetId && target.name) {
      if (target.mode === "student") {
        targetId = findGroupIdByName(target.name, groups);
      } else {
        targetId = findTeacherIdByName(target.name, teachers);
      }
    }

    if (!targetId) {
      const typeLabel = target.mode === "student" ? "групу" : "викладача";
      setToast(`Не вдалося знайти ${typeLabel} "${target.label || target.name}"`, "error");
      return;
    }

    const currentLabel =
      mode === "student"
        ? groups.find((g) => g.id === groupId)?.name || "групи"
        : teachers.find((t) => t.id === teacherId)?.name || "викладача";

    setReturnTarget({ mode, id: mode === "student" ? (groupId || 0) : (teacherId || 0), label: currentLabel });

    startTransition(() => {
      toggleMode(target.mode);
      if (target.mode === "student") {
        setGroupId(targetId);
      } else {
        setTeacherId(targetId);
      }
    });
  };

  const handleReturnBack = () => {
    if (!returnTarget) return;
    const target = returnTarget;
    setReturnTarget(null);
    startTransition(() => {
      toggleMode(target.mode);
      if (target.mode === "student") {
        setGroupId(target.id);
      } else {
        setTeacherId(target.id);
      }
    });
  };

  const moveLesson = async (lesson: Lesson, date: string, lessonNumber: number) => {
    const isEvent = Boolean(lesson.event_type || lesson.event_id);
    if (moving || (lesson.is_replacement && !isEvent)) return;
    const previousToday = today;
    const previousWeek = week;
    const targetDate = new Date(`${date}T12:00:00`).getDay() || 7;
    setMoving(true);
    try {
      if (isEvent) {
        const evId = lesson.event_id ?? (lesson.id < 0 ? -lesson.id : lesson.id);
        const startTime = DEFAULT_LESSON_TIMES[lessonNumber]?.split(/[-–]/)[0]?.trim() || "09:00";
        if (isCopyMode) {
          await api.events.create({
            group_id: lesson.group_id ?? groupId ?? 0,
            subject_id: lesson.subject_id ?? null,
            custom_subject: lesson.custom_subject || lesson.subject_name || null,
            teacher_id: lesson.teacher_id ?? null,
            title: lesson.event_title || lesson.custom_subject || lesson.subject_name || "",
            event_type: (lesson.event_type as AcademicEventType) || "exam",
            event_date: date,
            lesson_number: lessonNumber,
            start_time: startTime,
            room: lesson.room || lesson.room_override || null,
            note: lesson.note || null,
          });
          invalidateScheduleCache();
          const refreshed = await api.week(
            mode === "student" ? (groupId ?? undefined) : undefined,
            mode === "teacher" ? (teacherId ?? undefined) : undefined,
            weekAnchorDate
          );
          setWeek(refreshed);
          setToast("Подію сесії скопійовано.", "success");
          return;
        }

        await api.events.update(evId, {
          event_date: date,
          lesson_number: lessonNumber,
          start_time: startTime,
        });
        setBuffer(null);
        invalidateScheduleCache();
        const refreshed = await api.week(
          mode === "student" ? (groupId ?? undefined) : undefined,
          mode === "teacher" ? (teacherId ?? undefined) : undefined,
          weekAnchorDate
        );
        setWeek(refreshed);
        setToast("Подію сесії переміщено.", "success");
        return;
      }

      const sourceDate = buffer?.type === "single" ? buffer.sourceDate : (week?.find((d) => d.lessons.some((l) => l.id === lesson.id))?.date || "");
      await api.dated.move({
        source_group_id: lesson.group_id ?? groupId ?? 0,
        source_date: sourceDate,
        source_lesson_number: lesson.lesson_number,
        target_group_id: lesson.group_id ?? groupId ?? 0,
        target_date: date,
        target_lesson_number: lessonNumber,
      });
      setBuffer(null);
      invalidateScheduleCache();
      const refreshed = await api.week(
        mode === "student" ? (groupId ?? undefined) : undefined,
        mode === "teacher" ? (teacherId ?? undefined) : undefined,
        weekAnchorDate
      );
      setWeek(refreshed);
      setToast("Заняття перенесено (разова зміна).", "success");
    } catch (cause) {
      setWeek(previousWeek);
      setToday(previousToday);
      setToast(cause instanceof Error ? cause.message : "Не вдалося перемістити заняття.", "error");
    } finally {
      setMoving(false);
    }
  };
  
  const create = async (payload: LessonMutation) => {
    try {
      const targetDate = payload.date ?? new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(new Date());
      const gid = payload.group_id ?? (groupId ?? 0);
      await api.dated.replace({
        group_id: gid,
        date: targetDate,
        lesson_number: payload.lesson_number,
        subject_id: payload.subject_id ?? null,
        teacher_id: payload.teacher_id ?? null,
        second_teacher_id: payload.second_teacher_id ?? null,
        room: payload.room ?? null,
      });
      invalidateScheduleCache();
      const refreshed = await api.week(
        mode === "student" ? (groupId ?? undefined) : undefined,
        mode === "teacher" ? (teacherId ?? undefined) : undefined,
        weekAnchorDate
      );
      setWeek(refreshed);
      setToast("Разову пару додано.", "success");
    } catch (e: any) {
      setToast(e instanceof Error ? e.message : "Не вдалося додати пару", "error");
      throw e;
    }
  };
  
  const remove = async (lesson: Lesson, targetDate?: string) => {
    const dateToCancel = targetDate || week?.find((day) => day.lessons.some((item) => item.id === lesson.id))?.date || (today?.date || week?.[0]?.date) || "";
    if (lesson.is_replacement) {
      await removeReplacementOnDate(lesson, dateToCancel);
    } else {
      await cancelOnDate(lesson, dateToCancel);
    }
  };

  const handleSwapSelect = async (targetLesson: Lesson, targetDate: string) => {
    if (!swapSource) {
      setSwapSource({ lesson: targetLesson, date: targetDate });
      setToast(`Пару «${targetLesson.subject_name}» вибрано для обміну. Оберіть іншу пару або вільний слот.`, "info");
      return;
    }

    if (swapSource.lesson.id === targetLesson.id && swapSource.date === targetDate) {
      setSwapSource(null);
      return;
    }

    try {
      await api.dated.swap({
        first_group_id: swapSource.lesson.group_id ?? groupId ?? 0,
        first_date: swapSource.date,
        first_lesson_number: swapSource.lesson.lesson_number,
        second_group_id: targetLesson.group_id ?? groupId ?? 0,
        second_date: targetDate,
        second_lesson_number: targetLesson.lesson_number,
      });
      setToast("Пари успішно обміняно місцями!", "success");
      setSwapSource(null);
      invalidateScheduleCache();
      const refreshed = await api.week(
        mode === "student" ? (groupId ?? undefined) : undefined,
        mode === "teacher" ? (teacherId ?? undefined) : undefined,
        weekAnchorDate
      );
      setWeek(refreshed);
    } catch (err: any) {
      setToast(err?.message || "Не вдалося виконати обмін парами", "error");
    }
  };

  const handleSwapMoveToEmpty = async (targetDate: string, lessonNumber: number) => {
    if (!swapSource) return;
    await moveLesson(swapSource.lesson, targetDate, lessonNumber);
    setSwapSource(null);
  };

  const handlePasteToSlot = async (targetDate: string, lessonNumber: number) => {
    if (!buffer) return;

    if (buffer.type === "single" && buffer.mode === "move") {
      const srcGroupId = buffer.lesson.group_id ?? groupId ?? 0;
      const tgtGroupId = groupId ?? srcGroupId;
      try {
        await api.dated.move({
          source_group_id: srcGroupId,
          source_date: buffer.sourceDate,
          source_lesson_number: buffer.lesson.lesson_number,
          target_group_id: tgtGroupId,
          target_date: targetDate,
          target_lesson_number: lessonNumber,
        });
        setToast("Заняття перенесено (разова зміна).", "success");
        setBuffer(null);
        invalidateScheduleCache();
        const refreshed = await api.week(
          mode === "student" ? (groupId ?? undefined) : undefined,
          mode === "teacher" ? (teacherId ?? undefined) : undefined,
          weekAnchorDate
        );
        setWeek(refreshed);
      } catch (err: any) {
        setToast(err?.message || "Помилка перенесення заняття", "error");
      }
      return;
    }
  };

  const handleMoveDay = (sourceDate: string) => {
    const dayLessons = week.find((d) => d.date === sourceDate)?.lessons || [];
    if (!dayLessons.length) {
      setToast("У цей день немає пар для перенесення", "info");
      return;
    }
    setBuffer({ type: "day", mode: "move", sourceDate, lessons: dayLessons });
    setToast(`Перенесення ${dayLessons.length} пар дня. Оберіть день для вставки у меню «⋮».`, "info");
  };

  const handleCopyDay = (sourceDate: string) => {
    const dayLessons = week.find((d) => d.date === sourceDate)?.lessons || [];
    if (!dayLessons.length) {
      setToast("У цей день немає пар для копіювання", "info");
      return;
    }
    setBuffer({ type: "day", mode: "copy", sourceDate, lessons: dayLessons });
    setToast(`Скопійовано ${dayLessons.length} пар дня. Оберіть день для вставки у меню «⋮».`, "info");
  };

  const handlePasteDay = async (targetDate: string) => {
    if (buffer?.type !== "day") return;
    const action = buffer.mode === "copy" ? "copy" : "move";
    const items = buffer.lessons.map((l) => ({
      source_group_id: l.group_id ?? groupId ?? 0,
      source_date: buffer.sourceDate,
      source_lesson_number: l.lesson_number,
      target_group_id: l.group_id ?? groupId ?? 0,
      target_date: targetDate,
      target_lesson_number: l.lesson_number,
    }));
    try {
      const res = await api.dated.batch({
        action,
        items,
        skip_conflicts: true,
      });
      setToast(
        action === "copy"
          ? `Скопійовано ${res.succeeded} з ${res.total} пар дня.`
          : `Перенесено ${res.succeeded} з ${res.total} пар дня.`,
        "success"
      );
      setBuffer(null);
      invalidateScheduleCache();
      const refreshed = await api.week(
        mode === "student" ? (groupId ?? undefined) : undefined,
        mode === "teacher" ? (teacherId ?? undefined) : undefined,
        weekAnchorDate
      );
      setWeek(refreshed);
    } catch (err: any) {
      setToast(err?.message || (action === "copy" ? "Помилка копіювання дня" : "Помилка перенесення дня"), "error");
    }
  };

  const handleToggleShortenedDay = async (targetDate: string) => {
    try {
      const session = await api.auth.ensureAuthenticated();
      const res = await api.settings.shortenedDays.toggle(targetDate, session.access_token);
      invalidateScheduleCache();
      const refreshed = await api.week(
        mode === "student" ? (groupId ?? undefined) : undefined,
        mode === "teacher" ? (teacherId ?? undefined) : undefined,
        weekAnchorDate
      );
      setWeek(refreshed);
      setToast(
        res.is_shortened
          ? "Встановлено скорочений день (пари по 50 хв, перерви 10 хв)"
          : "Повернуто звичайний розклад дзвінків (80 хв)",
        "success"
      );
    } catch (err: any) {
      setToast(err?.message || "Помилка зміни формату дня", "error");
    }
  };

  const runBulkCurator = async (action: "create" | "delete") => {
    setCuratorLoading(true);
    try {
      const res = await api.lessons.bulkCurator({
        day_of_week: curatorDay,
        lesson_number: curatorLesson,
        week_type: curatorWeek,
        group_ids: [],
        action,
      });
      invalidateScheduleCache();
      setToast(
        action === "create"
          ? `Виховні години створено: ${res.created} (пропущено: ${res.skipped})`
          : `Виховні години видалено: ${res.deleted}`,
        "success"
      );
      setCuratorModalOpen(false);
      // Оновлюємо поточний тиждень
      const refreshed = await api.week(
        mode === "student" ? (groupId ?? undefined) : undefined,
        mode === "teacher" ? (teacherId ?? undefined) : undefined,
        weekAnchorDate
      );
      setWeek(refreshed);
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Помилка операції з виховними годинами", "error");
    } finally {
      setCuratorLoading(false);
    }
  };

  const shouldReduceMotion = useReducedMotion();
  const [daySlideDir, setDaySlideDir] = useState(0);
  const [selectedDayIndex, setSelectedDayIndex] = useState(() => {
    const d = new Date().getDay();
    return d >= 1 && d <= 5 ? d - 1 : 0;
  });
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);

  const todayIso = useMemo(() => {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(new Date());
  }, []);

  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const diffX = touchStartX.current - e.touches[0].clientX;
    const diffY = touchStartY.current - e.touches[0].clientY;

    if (Math.abs(diffX) > 40 && Math.abs(diffX) > Math.abs(diffY) * 1.5) {
      if (diffX > 0) {
        setDaySlideDir(1);
        if (selectedDayIndex < 4) {
          setSelectedDayIndex((prev) => prev + 1);
        } else {
          if (!canGoNext) {
            setToast("Далі змінювати не можна", "info");
          } else {
            const next = new Date(weekAnchorDate);
            next.setDate(next.getDate() + 7);
            setWeekAnchorDate(next);
            setSelectedDayIndex(0);
          }
        }
      } else {
        setDaySlideDir(-1);
        if (selectedDayIndex > 0) {
          setSelectedDayIndex((prev) => prev - 1);
        } else {
          if (!canGoPrev) {
            setToast("Далі змінювати не можна", "info");
          } else {
            const prev = new Date(weekAnchorDate);
            prev.setDate(prev.getDate() - 7);
            setWeekAnchorDate(prev);
            setSelectedDayIndex(4);
          }
        }
      }
      touchStartX.current = null;
      touchStartY.current = null;
    }
  };

  const handleTouchEnd = () => {
    touchStartX.current = null;
    touchStartY.current = null;
  };

  const handleEditLesson = (lesson: Lesson, fallbackDate?: string) => {
    if (lesson.event_type || lesson.event_id) {
      const evId = lesson.event_id ?? (lesson.id < 0 ? -lesson.id : lesson.id);
      const targetDate = week?.find((day) => day.lessons.some((item) => item.id === lesson.id))?.date ?? fallbackDate ?? (today?.date || week?.[0]?.date) ?? "";
      const cleanSubject = lesson.custom_subject || lesson.subject_name;
      setEditingEvent({
        id: evId,
        group_id: lesson.group_id ?? groupId ?? 0,
        group_name: lesson.group_name ?? null,
        subject_id: lesson.subject_id ?? null,
        subject_name: lesson.subject_name ?? null,
        custom_subject: lesson.custom_subject ?? null,
        teacher_id: lesson.teacher_id ?? null,
        teacher_name: lesson.teacher_name ?? null,
        title: lesson.event_title || cleanSubject || "",
        event_type: (lesson.event_type as AcademicEventType) || "exam",
        event_date: targetDate,
        lesson_number: lesson.lesson_number,
        start_time: (lesson.time && lesson.time.split(/[-–]/)[0]?.trim()) || "09:00",
        room: lesson.room || lesson.room_override || null,
        note: lesson.note || null,
      });
      return;
    }
    const date = week?.find((day) => day.lessons.some((item) => item.id === lesson.id))?.date ?? fallbackDate ?? (today?.date || week?.[0]?.date);
    setEditor({ lesson, date });
  };

  return (
    <div className="w-full space-y-4">
      <PageHeader
        eyebrow="КЕРУВАННЯ"
        title="Розклад занять"
        description="Перегляд, планування та редагування тижневого розкладу пар"
      />

      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center justify-between gap-3">
        {/* Mobile Filter Row (<640px): 1 single horizontal row h-11 */}
        <div className="sm:hidden flex items-center gap-2 w-full">
          {teachers.length > 0 && (
            <button
              type="button"
              onClick={() => startTransition(() => toggleMode(mode === "student" ? "teacher" : "student"))}
              className="h-11 px-3 rounded-xl border border-sys-border bg-sys-card text-xs font-semibold text-sys-text-primary shrink-0 flex items-center gap-1.5 focus:outline-none focus:ring-2 focus:ring-sys-accent"
              aria-label="Перемкнути режим Група / Викладач"
            >
              <span>{mode === "student" ? "Група" : "Викладач"}</span>
              <span className="text-[10px] text-sys-text-muted">⇅</span>
            </button>
          )}
          <div className="flex-1 min-w-0">
            {mode === 'student' && groups.length > 0 && (
              <SearchableSelect
                value={groupId ?? null}
                onChange={(val) => {
                  startTransition(() => setGroupId(val ? Number(val) : null));
                  if (val) setTimeout(scrollToMobileSchedule, 100);
                }}
                options={groups}
                placeholder="Оберіть групу"
                disabled={isPending}
                ariaLabel="Оберіть групу для перегляду розкладу"
              />
            )}
            {mode === 'teacher' && teachers.length > 0 && (
              <SearchableSelect
                value={teacherId ?? null}
                onChange={(val) => {
                  startTransition(() => setTeacherId(val ? Number(val) : null));
                  if (val) setTimeout(scrollToMobileSchedule, 100);
                }}
                options={teachers}
                placeholder="Оберіть викладача"
                disabled={isPending}
                ariaLabel="Оберіть викладача для перегляду розкладу"
              />
            )}
          </div>
        </div>

        {/* Desktop Filter Panel (>=640px) */}
        <div className="hidden sm:flex flex-row flex-wrap items-center gap-2.5 w-full lg:w-auto">
          {teachers.length > 0 && (
          <div role="tablist" aria-label="Режим перегляду" className="flex w-full sm:w-auto rounded-lg border border-sys-border bg-sys-card p-1 text-sm relative">
            <div className="absolute top-1 bottom-1 w-[calc(50%-4px)] bg-sys-accent rounded-md shadow-sm transition-all duration-300 ease-out z-0" style={{ left: mode === 'student' ? '4px' : '50%' }}></div>
            <button role="tab" aria-selected={mode === 'student'} type="button" onClick={() => startTransition(() => toggleMode('student'))} className={`relative z-10 flex-1 sm:flex-none sm:w-28 text-center rounded-md px-3 py-2 sm:py-1.5 transition-colors ${mode === 'student' ? 'text-white font-semibold' : 'text-sys-text-secondary hover:text-sys-text-primary'}`}>Група</button>
            <button role="tab" aria-selected={mode === 'teacher'} type="button" onClick={() => startTransition(() => toggleMode('teacher'))} className={`relative z-10 flex-1 sm:flex-none sm:w-28 text-center rounded-md px-3 py-2 sm:py-1.5 transition-colors ${mode === 'teacher' ? 'text-white font-semibold' : 'text-sys-text-secondary hover:text-sys-text-primary'}`}>Викладач</button>
          </div>
          )}
          {mode === 'student' && groups.length > 0 && (
            <div className="w-full sm:w-64 text-sys-text-primary">
              <SearchableSelect
                 value={groupId ?? null}
                 onChange={(val) => {
                   startTransition(() => setGroupId(val ? Number(val) : null));
                   if (val) setTimeout(scrollToMobileSchedule, 100);
                 }}
                 options={groups}
                 placeholder="Оберіть групу"
                 disabled={isPending}
                 ariaLabel="Оберіть групу для перегляду розкладу"
              />
            </div>
          )}
          {mode === 'teacher' && teachers.length > 0 && (
            <div className="w-full sm:w-64 text-sys-text-primary">
              <SearchableSelect
                 value={teacherId ?? null}
                 onChange={(val) => {
                   startTransition(() => setTeacherId(val ? Number(val) : null));
                   if (val) setTimeout(scrollToMobileSchedule, 100);
                 }}
                 options={teachers}
                 placeholder="Оберіть викладача"
                 disabled={isPending}
                 ariaLabel="Оберіть викладача для перегляду розкладу"
              />
            </div>
          )}
        </div>
      </div>

      {returnTarget && (
        <div className="mb-4 flex items-center justify-between rounded-xl border border-sys-accent/30 bg-sys-accent/10 px-4 py-2.5 text-sm">
          <span className="text-sys-text-secondary">
            Редагування розкладу:{" "}
            <strong className="text-sys-text-primary">
              {mode === "student"
                ? groups.find((g) => g.id === groupId)?.name
                : teachers.find((t) => t.id === teacherId)?.name}
            </strong>
          </span>
          <button
            type="button"
            onClick={handleReturnBack}
            className="rounded-lg bg-sys-accent px-3 py-1 text-xs font-semibold text-white shadow-xs hover:opacity-95 transition-opacity"
          >
            ← Повернутися до {returnTarget.label}
          </button>
        </div>
      )}

      {loading ? (
        <div className="rounded-2xl border border-sys-border bg-sys-card/50 p-12 text-center text-sys-text-secondary">Завантаження розкладу…</div>
      ) : error ? (
        <div className="rounded-2xl border border-rose-400/20 bg-rose-400/5 p-8 text-center text-rose-200">{error}</div>
      ) : week ? (
        <div className="w-full min-w-0">

          {/* Desktop Week Navigation & Actions (>= 640px) */}
          <div className="hidden sm:flex mb-4 mt-2 flex-wrap items-center justify-between gap-3 rounded-xl bg-sys-card/50 p-3 border border-sys-border">
            <div className="text-[13px] font-medium text-sys-text-primary flex shrink-0 items-center gap-2 whitespace-nowrap">
              <svg width="1.2em" height="1.2em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-sys-accent shrink-0"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
              <span className="shrink-0 whitespace-nowrap font-semibold">{weekRange}</span>
              <div className="shrink-0 whitespace-nowrap"><WeekTypeBadge weekType={weekType} /></div>
              <span className="shrink-0 inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30 whitespace-nowrap">
                Разова зміна
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <div className="flex items-center gap-1 rounded-lg border border-sys-border bg-sys-card p-1 text-sm">
                <button
                  type="button"
                  aria-label="Попередній тиждень"
                  aria-disabled={!canGoPrev}
                  title={!canGoPrev ? "Далі змінювати не можна" : undefined}
                  onClick={handlePrevWeek}
                  className={`relative z-10 flex min-h-[38px] min-w-[38px] items-center justify-center rounded-md p-1.5 px-3 transition-colors ${
                    !canGoPrev
                      ? "opacity-40 cursor-not-allowed text-sys-text-muted"
                      : "text-sys-text-secondary hover:bg-sys-bg hover:text-sys-text-primary focus:ring-2 focus:ring-sys-accent focus:outline-none"
                  }`}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
                </button>
                
                <button
                  type="button"
                  onClick={resetWeek}
                  className={`relative z-10 text-center min-h-[38px] rounded-md px-3 py-1.5 font-medium transition-colors ${isCurrentWeek ? 'text-sys-accent bg-sys-accent/10' : 'text-sys-text-secondary hover:bg-sys-bg hover:text-sys-text-primary'}`}
                >
                  Сьогодні
                </button>
                
                <button
                  type="button"
                  aria-label="Наступний тиждень"
                  aria-disabled={!canGoNext}
                  title={!canGoNext ? "Далі змінювати не можна" : undefined}
                  onClick={handleNextWeek}
                  className={`relative z-10 flex min-h-[38px] min-w-[38px] items-center justify-center rounded-md p-1.5 px-3 transition-colors ${
                    !canGoNext
                      ? "opacity-40 cursor-not-allowed text-sys-text-muted"
                      : "text-sys-text-secondary hover:bg-sys-bg hover:text-sys-text-primary focus:ring-2 focus:ring-sys-accent focus:outline-none"
                  }`}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
                </button>
              </div>

              {isAdmin && (
                <a
                  href={`/admin?resource=permanent-schedule${activeVersion ? `&version_id=${activeVersion.id}` : ""}`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-1.5 text-xs font-semibold text-indigo-600 dark:text-indigo-300 hover:bg-indigo-500/20 transition-colors whitespace-nowrap"
                  title="Редагувати постійний розклад версії"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect width="18" height="18" x="3" y="4" rx="2" ry="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                  <span className="whitespace-nowrap">Постійний розклад</span>
                </a>
              )}

              {isAdmin && (
                <button
                  type="button"
                  onClick={() => setCuratorModalOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-sys-border bg-sys-card px-3 py-1.5 text-xs font-semibold text-sys-text-primary hover:bg-slate-100 dark:hover:bg-white/5 whitespace-nowrap"
                >
                  <GraduationIcon />
                  <span className="whitespace-nowrap">Виховна година</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setEventsModalOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-sys-border bg-sys-card px-3 py-1.5 text-xs font-semibold text-sys-text-primary hover:bg-slate-100 dark:hover:bg-white/5 whitespace-nowrap"
              >
                <CalendarEventIcon />
                <span className="whitespace-nowrap">Сесія / Події</span>
              </button>

              <button
                type="button"
                onClick={() => setPrintModalOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-sys-border bg-sys-card px-3 py-1.5 text-xs font-semibold text-sys-text-primary hover:bg-slate-100 dark:hover:bg-white/5 whitespace-nowrap"
              >
                <PrinterIcon />
                <span className="whitespace-nowrap">Друк</span>
              </button>
            </div>
          </div>

          {/* Buffer / Swap Active Banner */}
          <AnimatePresence>
            {swapSource ? (
              <motion.div
                key="swap-banner"
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: shouldReduceMotion ? 0 : 0.2, ease: [0.2, 0, 0, 1] }}
                className="sticky top-2 z-40 mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sys-accent/40 bg-sys-card p-3 shadow-xl backdrop-blur-md"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="text-lg shrink-0">⇄</span>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-sys-text-primary">
                      Обмін парами: «{swapSource.lesson.subject_name}» ({swapSource.lesson.lesson_number}-та пара)
                    </p>
                    <p className="text-[11px] text-sys-text-secondary break-words">
                      Разова зміна · {weekRange} · {weekType === "numerator" ? "Чисельник" : weekType === "denominator" ? "Знаменник" : "Обидва"} — діє лише на цей тиждень. Оберіть іншу пару для взаємного обміну або вільний слот для перенесення.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSwapSource(null)}
                  className="shrink-0 rounded-lg border border-sys-border bg-white/5 px-3 py-1.5 text-xs font-semibold text-sys-text-secondary hover:text-sys-text-primary hover:bg-white/10"
                >
                  ✕ Скасувати
                </button>
              </motion.div>
            ) : buffer ? (
              <motion.div
                key="buffer-banner"
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: shouldReduceMotion ? 0 : 0.2, ease: [0.2, 0, 0, 1] }}
                className="sticky top-2 z-40 mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-500/40 bg-sys-card p-3 shadow-xl backdrop-blur-md"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="text-lg shrink-0">{buffer.mode === "copy" ? "📋" : "✂️"}</span>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-sys-text-primary">
                      {buffer.type === "single"
                        ? buffer.mode === "copy"
                          ? `Копіювання пари: «${buffer.lesson.subject_name}»`
                          : `Перенесення пари: «${buffer.lesson.subject_name}»`
                        : buffer.mode === "copy"
                          ? `Копіювання дня (${buffer.lessons.length} пар)`
                          : `Перенесення дня (${buffer.lessons.length} пар)`}
                    </p>
                    <p className="text-[11px] text-sys-text-secondary break-words">
                      Разова зміна · {weekRange} · {weekType === "numerator" ? "Чисельник" : weekType === "denominator" ? "Знаменник" : "Обидва"} — діє лише на цей тиждень. {buffer.type === "day" ? "Оберіть день і в меню дня (⋮) натисніть «Вставити день сюди»." : "Натисніть «Вставити сюди» у будь-якому вільному слоті."}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setBuffer(null)}
                    className="rounded-lg border border-sys-border bg-white/5 px-3 py-1.5 text-xs font-semibold text-sys-text-secondary hover:text-sys-text-primary"
                  >
                    ✕ Скасувати
                  </button>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>

          {/* Desktop Schedule Grid (hidden on mobile <640px) */}
          <div className="hidden sm:block">
            <ScheduleWeekGrid
              week={week}
              availabilityWeek={availabilityWeek}
              availabilityError={availabilityError}
              scheduleMode={mode}
              canEdit={true}
              movingLesson={movingLesson}
              onMoveSelect={handleMoveSelect}
              onCancelDated={cancelOnDate}
              onRestoreDated={restoreOnDate}
              onRemoveReplacement={removeReplacementOnDate}
              onQuickJump={handleQuickJump}
              onMove={(lesson, date, lessonNumber) => void moveLesson(lesson, date, lessonNumber)}
              onEdit={(lesson) => handleEditLesson(lesson)}
              onCreate={(date, lessonNumber) => setEditor({ date, lesson: lessonNumber ? { lesson_number: lessonNumber } as any : undefined })}
              swapSourceLesson={swapSource?.lesson}
              swapSourceDate={swapSource?.date}
              onSwapSelectLesson={handleSwapSelect}
              hasBufferContent={Boolean(buffer)}
              onPasteToSlot={handlePasteToSlot}
              onCopyDay={handleCopyDay}
              onMoveDay={handleMoveDay}
              onPasteDay={handlePasteDay}
              canPasteDay={buffer?.type === "day"}
              onToggleShortenedDay={handleToggleShortenedDay}
              onOpenPermanentSchedule={isAdmin ? handleOpenPermanentSchedule : undefined}
            />
          </div>

          {/* Mobile Schedule Day View (<640px) */}
          <div ref={mobileScheduleRef} id="admin-mobile-schedule" className="sm:hidden -mx-4 -mt-2 space-y-2">
            <MobileWeekBar
              weekRange={weekRange}
              weekType={weekType}
              isCurrentWeek={isCurrentWeek}
              onPrevWeek={() => {
                setDaySlideDir(-1);
                handlePrevWeek();
                scrollToMobileSchedule();
              }}
              onNextWeek={() => {
                setDaySlideDir(1);
                handleNextWeek();
                scrollToMobileSchedule();
              }}
              onResetWeek={() => {
                setDaySlideDir(0);
                resetWeek();
                scrollToMobileSchedule();
              }}
            />
            <MobileWeekDaysStrip
              weekAnchorDate={weekAnchorDate}
              selectedDayIndex={selectedDayIndex}
              onSelectDay={(idx) => {
                setDaySlideDir(idx > selectedDayIndex ? 1 : -1);
                setSelectedDayIndex(idx);
                scrollToMobileSchedule();
              }}
              isCurrentWeek={isCurrentWeek}
              todayIso={todayIso}
            />

            {/* Mobile day content with touch gestures */}
            <div
              className="px-4 py-2 space-y-3 touch-pan-y min-h-[300px]"
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
            >
              <AnimatePresence initial={false} custom={daySlideDir} mode="wait">
                {(() => {
                  const currentDay = week[selectedDayIndex];
                  if (!currentDay) {
                    return (
                      <motion.div
                        key="empty-day"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="p-8 text-center text-sys-text-secondary text-sm"
                      >
                        Немає даних для цього дня
                      </motion.div>
                    );
                  }

                  const dayLabel = new Intl.DateTimeFormat("uk-UA", {
                    weekday: "long",
                    day: "numeric",
                    month: "short",
                  }).format(new Date(`${currentDay.date}T12:00:00`));

                  return (
                    <motion.div
                      key={currentDay.date}
                      custom={daySlideDir}
                      variants={{
                        enter: (dir: number) => ({
                          x: dir > 0 ? 12 : dir < 0 ? -12 : 0,
                          opacity: 0,
                        }),
                        center: {
                          x: 0,
                          opacity: 1,
                        },
                        exit: (dir: number) => ({
                          x: dir > 0 ? -12 : dir < 0 ? 12 : 0,
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
                      className="space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className="text-sm font-semibold capitalize text-sys-text-primary">
                            {dayLabel}
                          </div>
                          {currentDay.is_shortened_day && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/30">
                              ⏱ 50 хв
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setMobileActionsOpen(true)}
                            className="min-h-[40px] px-3 rounded-lg border border-sys-border bg-sys-card text-xs font-semibold text-sys-text-secondary hover:text-sys-text-primary"
                          >
                            ⋯ Дії
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditor({ date: currentDay.date })}
                            className="min-h-[40px] px-3.5 rounded-lg bg-sys-accent text-xs font-semibold text-white shadow-xs hover:opacity-95 active:scale-95 transition-all"
                          >
                            + Додати
                          </button>
                        </div>
                      </div>

                    {/* 4 slots (1-4) on mobile including empty slots */}
                    <div className="space-y-3">
                      {[1, 2, 3, 4].map((slotNum) => {
                        const slotLessons = currentDay.lessons.filter((l) => l.lesson_number === slotNum);
                        const hasSlotContent = slotLessons.length > 0;
                        const isBufferActive = Boolean(buffer);
                        const isSwapActive = Boolean(swapSource);
                        const isPast = isSlotInPast(currentDay.date, slotNum);

                        return (
                          <div key={slotNum} className="rounded-xl border border-sys-border bg-sys-card/40">
                            <div className="flex items-center justify-between px-3 py-1.5 rounded-t-xl border-b border-sys-border/40 bg-sys-bg/30 text-xs">
                              <span className="font-bold text-sys-text-primary">
                                {slotNum}-та пара
                              </span>
                              <span className="text-[11px] text-sys-text-muted">
                                {currentDay.is_shortened_day
                                  ? (SHORTENED_LESSON_TIMES[slotNum] || DEFAULT_LESSON_TIMES[slotNum])
                                  : DEFAULT_LESSON_TIMES[slotNum]}
                              </span>
                            </div>

                            {hasSlotContent ? (
                              <div className="p-1.5 space-y-1.5">
                                {slotLessons.map((lesson) => (
                                  <LessonCard
                                    key={lesson.id}
                                    lesson={lesson}
                                    targetDate={currentDay.date}
                                    mode="day"
                                    scheduleMode={mode}
                                    canEdit={true}
                                    onEdit={(l) => handleEditLesson(l, currentDay.date)}
                                    onMoveSelect={(l) => {
                                      if (l) setBuffer({ type: "single", mode: "move", lesson: l, sourceDate: currentDay.date });
                                      else setBuffer(null);
                                    }}
                                    onCancelDated={cancelOnDate}
                                    onRestoreDated={restoreOnDate}
                                    onRemoveReplacement={removeReplacementOnDate}
                                    onQuickJump={handleQuickJump}
                                    hideTimeColumn={true}
                                    onSwapSelect={() => handleSwapSelect(lesson, currentDay.date)}
                                    isSwapSource={swapSource?.lesson.id === lesson.id && swapSource.date === currentDay.date}
                                    onOpenPermanentSchedule={isAdmin ? handleOpenPermanentSchedule : undefined}
                                  />
                                ))}
                              </div>
                            ) : (
                              <div className="flex flex-col sm:flex-row items-center justify-between gap-2 p-2.5">
                                <span className="text-xs text-sys-text-muted/60">Пари немає</span>
                                <div className="flex items-center gap-2 w-full sm:w-auto">
                                  {isPast ? (
                                    <span className="text-xs text-sys-text-muted/60">Час минув</span>
                                  ) : isSwapActive ? (
                                    <button
                                      type="button"
                                      onClick={() => handleSwapMoveToEmpty(currentDay.date, slotNum)}
                                      className="flex-1 sm:flex-none min-h-[38px] px-3 rounded-lg border border-sys-accent/40 bg-sys-accent/10 text-xs font-semibold text-sys-accent hover:bg-sys-accent/20 transition-colors"
                                    >
                                      ⇄ Перемістити сюди
                                    </button>
                                  ) : isBufferActive ? (
                                    <button
                                      type="button"
                                      onClick={() => handlePasteToSlot(currentDay.date, slotNum)}
                                      className="flex-1 sm:flex-none min-h-[38px] px-3 rounded-lg border border-dashed border-sys-accent/40 bg-sys-accent/10 text-xs font-semibold text-sys-accent hover:bg-sys-accent/20 transition-colors"
                                    >
                                      📥 Перемістити сюди
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => setEditor({ date: currentDay.date, lesson: { lesson_number: slotNum } as any })}
                                      className="flex-1 sm:flex-none min-h-[38px] px-3 rounded-lg border border-dashed border-sys-border bg-white/5 text-xs font-medium text-sys-text-secondary hover:text-sys-text-primary hover:border-sys-accent transition-colors"
                                    >
                                      + Додати пару
                                    </button>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </motion.div>
                );
              })()}
              </AnimatePresence>
            </div>
          </div>
        </div>
      ) : null}

      {!loading && !error && (!groups.length || (!groupId && mode === "student") || (!teacherId && mode === "teacher")) && (
        <div className="rounded-2xl border border-dashed border-sys-border p-12 text-center text-sys-text-secondary">Оберіть ціль розкладу для перегляду та редагування.</div>
      )}

      {editor && (
        <LessonEditor
          key={editor.lesson?.id ?? editor.date + "-" + (editor.lesson?.lesson_number ?? "new")}
          initialWeekType={weekType}
          lesson={editor.lesson}
          date={editor.date}
          scheduleMode={mode}
          defaultGroupId={groupId}
          defaultTeacherId={teacherId}
          groups={groups}
          availabilityWeek={availabilityWeek}
          onClose={() => setEditor(null)}
          onSave={(payload) => editor.lesson ? edit(editor.lesson, editor.date, payload) : create(payload)}
          onDelete={editor.lesson ? () => remove(editor.lesson!, editor.date) : undefined}
          isOneOff={true}
          weekRangeText={weekRange}
        />
      )}
      {curatorModalOpen && (
        <div
          className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setCuratorModalOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Масова виховна година"
            className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl border border-sys-border bg-sys-card p-5 sm:p-6 shadow-2xl space-y-4 max-h-[92dvh] overflow-y-auto pb-safe animate-in slide-in-from-bottom-6 sm:slide-in-from-bottom-2 duration-200"
          >
            <div className="flex items-center justify-between border-b border-sys-border/50 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-xl">🎓</span>
                <h3 className="text-base sm:text-lg font-bold text-sys-text-primary">Масова виховна година</h3>
              </div>
              <button
                type="button"
                onClick={() => setCuratorModalOpen(false)}
                aria-label="Закрити"
                className="w-8 h-8 flex items-center justify-center rounded-lg text-sys-text-secondary hover:bg-slate-100 dark:hover:bg-white/5 hover:text-sys-text-primary text-base"
              >
                ✕
              </button>
            </div>
            <p className="text-xs text-sys-text-secondary leading-relaxed">
              Автоматично призначає предмет «Виховна година» всім активним групам, у яких вказаний куратор і немає накладки у цей час.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="space-y-1">
                <span className="text-xs font-medium text-sys-text-secondary">День</span>
                <select value={curatorDay} onChange={(e) => setCuratorDay(Number(e.target.value))} className="form-control w-full text-sm">
                  <option value={1}>Понеділок</option>
                  <option value={2}>Вівторок</option>
                  <option value={3}>Середа</option>
                  <option value={4}>Четвер</option>
                  <option value={5}>П’ятниця</option>
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium text-sys-text-secondary">Пара</span>
                <select value={curatorLesson} onChange={(e) => setCuratorLesson(Number(e.target.value))} className="form-control w-full text-sm">
                  {[1, 2, 3, 4].map((n) => (
                    <option key={n} value={n}>{n}-та пара</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium text-sys-text-secondary">Тиждень</span>
                <select value={curatorWeek} onChange={(e) => setCuratorWeek(e.target.value as any)} className="form-control w-full text-sm">
                  <option value="both">Обидва</option>
                  <option value="numerator">Чисельник</option>
                  <option value="denominator">Знаменник</option>
                </select>
              </label>
            </div>
            <div className="flex flex-col-reverse sm:flex-row justify-between gap-2.5 pt-3 border-t border-sys-border/50">
              <button
                type="button"
                disabled={curatorLoading}
                onClick={() => void runBulkCurator("delete")}
                className="w-full sm:w-auto min-h-[44px] sm:min-h-[40px] rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-xs sm:text-sm font-semibold text-rose-600 dark:text-rose-300 hover:bg-rose-500/20 active:scale-[0.98] transition-all disabled:opacity-50"
              >
                Очистити слот
              </button>
              <button
                type="button"
                disabled={curatorLoading}
                onClick={() => void runBulkCurator("create")}
                className="w-full sm:w-auto min-h-[44px] sm:min-h-[40px] rounded-lg bg-sys-accent px-5 py-2 text-xs sm:text-sm font-semibold text-white shadow-xs hover:opacity-95 active:scale-[0.98] transition-all disabled:opacity-50"
              >
                {curatorLoading ? "Виконуємо..." : "Проставити всім групам"}
              </button>
            </div>
          </div>
        </div>
      )}

      {printModalOpen && (
        <OfficialPrintModal
          groups={groups}
          defaultDate={week?.[0]?.date || new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(new Date())}
          onClose={() => setPrintModalOpen(false)}
        />
      )}

      {eventsModalOpen && (
        <EventsModal
          defaultGroupId={groupId}
          groups={groups}
          teachers={teachers}
          onClose={() => setEventsModalOpen(false)}
          setToast={setToast}
          onEventsChanged={async () => {
            invalidateScheduleCache();
            const refreshed = await api.week(
              mode === "student" ? (groupId ?? undefined) : undefined,
              mode === "teacher" ? (teacherId ?? undefined) : undefined,
              weekAnchorDate
            );
            setWeek(refreshed);
          }}
        />
      )}

      {editingEvent && (
        <EventsModal
          defaultGroupId={editingEvent.group_id || groupId}
          groups={groups}
          teachers={teachers}
          eventToEdit={editingEvent}
          onClose={() => setEditingEvent(null)}
          setToast={setToast}
          onEventsChanged={async () => {
            invalidateScheduleCache();
            const refreshed = await api.week(
              mode === "student" ? (groupId ?? undefined) : undefined,
              mode === "teacher" ? (teacherId ?? undefined) : undefined,
              weekAnchorDate
            );
            setWeek(refreshed);
          }}
        />
      )}

      {/* Mobile Actions Bottom Sheet */}
      <AnimatePresence>
        {mobileActionsOpen && (
          <div
            onClick={(e) => {
              if (e.target === e.currentTarget) setMobileActionsOpen(false);
            }}
            className="fixed inset-0 z-50 flex items-end sm:hidden"
          >
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: shouldReduceMotion ? 0 : 0.18 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-xs"
              onClick={() => setMobileActionsOpen(false)}
            />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{
                duration: shouldReduceMotion ? 0 : 0.22,
                ease: [0.2, 0, 0, 1],
              }}
              className="relative z-10 w-full rounded-t-2xl border-t border-sys-border bg-sys-card p-5 space-y-4 shadow-xl pb-safe"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-sys-text-primary">Швидкі дії</span>
                <button
                  type="button"
                  onClick={() => setMobileActionsOpen(false)}
                  className="h-8 w-8 rounded-lg flex items-center justify-center text-sys-text-secondary hover:text-sys-text-primary"
                >
                  ✕
                </button>
              </div>
              <div className="grid grid-cols-1 gap-2 pt-1">
                {isAdmin && (
                  <a
                    href={`/admin?resource=permanent-schedule${activeVersion ? `&version_id=${activeVersion.id}` : ""}`}
                    className="flex items-center gap-3 w-full rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-3 text-left text-sm font-semibold text-indigo-300 hover:bg-indigo-500/20"
                  >
                    <span className="text-base">📅</span>
                    <span>Постійний розклад</span>
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setMobileActionsOpen(false);
                    const currentDay = week[selectedDayIndex];
                    if (currentDay) handleCopyDay(currentDay.date);
                  }}
                  className="flex items-center gap-3 w-full rounded-xl border border-sys-border bg-sys-bg/60 p-3 text-left text-sm font-medium text-sys-text-primary hover:bg-sys-bg"
                >
                  <span className="text-base">📋</span>
                  <span>Скопіювати цей день</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMobileActionsOpen(false);
                    const currentDay = week[selectedDayIndex];
                    if (currentDay) handleMoveDay(currentDay.date);
                  }}
                  className="flex items-center gap-3 w-full rounded-xl border border-sys-border bg-sys-bg/60 p-3 text-left text-sm font-medium text-sys-text-primary hover:bg-sys-bg"
                >
                  <span className="text-base">✂️</span>
                  <span>Перемістити цей день</span>
                </button>
                {buffer?.type === "day" && (
                  <button
                    type="button"
                    onClick={() => {
                      setMobileActionsOpen(false);
                      const currentDay = week[selectedDayIndex];
                      if (currentDay) handlePasteDay(currentDay.date);
                    }}
                    className="flex items-center gap-3 w-full rounded-xl border border-sys-accent/40 bg-sys-accent/15 p-3 text-left text-sm font-bold text-sys-accent hover:bg-sys-accent/25"
                  >
                    <span className="text-base">📥</span>
                    <span>Вставити день у цей день</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setMobileActionsOpen(false);
                    const currentDay = week[selectedDayIndex];
                    if (currentDay) handleToggleShortenedDay(currentDay.date);
                  }}
                  className="flex items-center gap-3 w-full rounded-xl border border-sys-border bg-sys-bg/60 p-3 text-left text-sm font-medium text-sys-text-primary hover:bg-sys-bg"
                >
                  <span className="text-base">⏱</span>
                  <span>
                    {week[selectedDayIndex]?.is_shortened_day
                      ? "Звичайні пари (80 хв)"
                      : "Скорочений день (пари по 50 хв)"}
                  </span>
                </button>
                <div className="my-1 border-t border-sys-border/40" />
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => {
                      setMobileActionsOpen(false);
                      setCuratorModalOpen(true);
                    }}
                    className="flex items-center gap-3 w-full rounded-xl border border-sys-border bg-sys-bg/60 p-3 text-left text-sm font-medium text-sys-text-primary hover:bg-sys-bg"
                  >
                    <GraduationIcon />
                    <span>Виховна година (кураторська)</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setMobileActionsOpen(false);
                    setEventsModalOpen(true);
                  }}
                  className="flex items-center gap-3 w-full rounded-xl border border-sys-border bg-sys-bg/60 p-3 text-left text-sm font-medium text-sys-text-primary hover:bg-sys-bg"
                >
                  <CalendarEventIcon />
                  <span>Сесія / Академічні події</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMobileActionsOpen(false);
                    setPrintModalOpen(true);
                  }}
                  className="flex items-center gap-3 w-full rounded-xl border border-sys-border bg-sys-bg/60 p-3 text-left text-sm font-medium text-sys-text-primary hover:bg-sys-bg"
                >
                  <PrinterIcon />
                  <span>Друк розкладу</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
