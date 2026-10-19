"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { OfflineIndicator } from "../components/OfflineIndicator";
import { InstallPrompt } from "../components/InstallPrompt";
import { ScheduleDay } from "../components/ScheduleDay";
import { ScheduleWeekGrid } from "../components/ScheduleWeekGrid";
import { DayPager } from "../components/DayPager";
import { MobileWeekBar } from "../components/MobileWeekBar";
import { MobileWeekDaysStrip } from "../components/MobileWeekDaysStrip";
import { WeekTypeBadge } from "../components/WeekTypeBadge";
import { ScheduleResponse, api } from "../lib/api";
import { useSchedule, useIsStandalonePwa, downloadForOffline, invalidateScheduleCache } from "../lib/hooks";
import { useAuth, canAccessAdmin } from "../lib/auth";
import { getMondayOf } from "../lib/date";
import dynamic from "next/dynamic";
const WelcomeScreen = dynamic(() => import("../components/WelcomeScreen").then((m) => m.WelcomeScreen), { ssr: false });
import { BottomNav, MobileTab } from "../components/BottomNav";
import { MobileTasksView, FullTaskItem, renderTaskCard } from "../components/MobileTasksView";
import { SearchableSelect } from "../components/SearchableSelect";
import { ClassroomSyncButton } from "../components/ClassroomSyncButton";
import { extractClassroomTasks, sortTasksByDeadline, TaskDeadline, UKR_MONTHS_SHORT, pluralDays } from "../components/LessonCard";
import { useToast } from "../components/ToastProvider";
import { QuickJumpTarget, findGroupIdByName, findTeacherIdByName } from "../lib/quickJump";
import { useClassroomSubmissions } from "../lib/useClassroomSubmissions";

const UK_SHORT_WEEKDAY_FMT = new Intl.DateTimeFormat("uk-UA", { weekday: "short" });

interface PinnedTarget {
  mode: "student" | "teacher";
  id: number;
  name: string;
}

const MAX_PINS = 3;

function isTaskUrgent(label: string): boolean {
  const m = label.match(/(\d{2})\.(\d{2})/);
  if (!m) return false;
  const day = Number(m[1]);
  const month = Number(m[2]) - 1;
  const now = new Date();
  const deadlineDate = new Date(now.getFullYear(), month, day, 23, 59, 59);
  const diffHours = (deadlineDate.getTime() - now.getTime()) / (1000 * 60 * 60);
  return diffHours <= 24;
}

export default function HomePage() {
  const getInitialAnchor = () => {
    const date = new Date();
    const day = date.getDay();
    if (day === 0 || day === 6) {
        date.setDate(date.getDate() + (day === 0 ? 1 : 2));
    }
    return getMondayOf(date);
  };
  const [weekAnchorDate, setWeekAnchorDate] = useState(getInitialAnchor());

  useEffect(() => {
    const handleVisibility = () => {
        if (document.visibilityState === "visible") {
            const nextAnchor = getInitialAnchor();
            setWeekAnchorDate(prev => prev.getTime() !== nextAnchor.getTime() ? nextAnchor : prev);
        }
    };
    window.addEventListener("visibilitychange", handleVisibility);
    return () => window.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  const shouldReduceMotion = useReducedMotion();
  const [weekShiftDir, setWeekShiftDir] = useState<number>(0);
  const [daySlideDir, setDaySlideDir] = useState<number>(0);

  const isCurrentWeek = useMemo(() => {
    const currentAnchor = getInitialAnchor();
    return Math.abs(weekAnchorDate.getTime() - currentAnchor.getTime()) < 1000 * 60 * 60 * 24;
  }, [weekAnchorDate]);

  const weekStartStr = useMemo(() => {
    return `${weekAnchorDate.getFullYear()}-${String(weekAnchorDate.getMonth() + 1).padStart(2, "0")}-${String(weekAnchorDate.getDate()).padStart(2, "0")}`;
  }, [weekAnchorDate]);

  const shiftWeek = (offset: number) => {
    setWeekShiftDir(offset);
    setWeekAnchorDate((date) => {
      const next = new Date(date);
      next.setDate(next.getDate() + offset * 7);
      return next;
    });
  };

  const { isSetupComplete, completeSetup, mode, toggleMode, teachers, teacherId, setTeacherId, groups, groupId, setGroupId, today, week, semesterStart, loading, error } = useSchedule(weekAnchorDate);
  const { user, loading: authLoading, logout } = useAuth();
  
  const isStandalone = useIsStandalonePwa();
  const [isDownloading, setIsDownloading] = useState(false);
  const [isDownloaded, setIsDownloaded] = useState(false);

  useEffect(() => {
    const targetKey = mode === "student" ? `groupId:${groupId}` : `teacherId:${teacherId}`;
    if (typeof window !== "undefined") {
      setIsDownloaded(!!localStorage.getItem(`offline_marker:${targetKey}`));
    }
  }, [mode, groupId, teacherId]);
  const { showToast: setToast } = useToast();

  const handleDownloadOffline = async () => {
    setIsDownloading(true);
    try {
      const target = mode === "student" ? { groupId: groupId ?? undefined } : { teacherId: teacherId ?? undefined };
      await downloadForOffline(target, weekAnchorDate);
      setIsDownloaded(true);
      setToast("Розклад збережено на пристрій.", "success");
    } catch (e) {
      console.error(e);
      setToast("Не вдалося зберегти розклад на пристрій. Перевірте підключення та спробуйте ще раз.", "error");
    } finally {
      setIsDownloading(false);
    }
  };

  const [view, setView] = useState<"today" | "week">("today");
  const [mobileTab, setMobileTab] = useState<MobileTab>("schedule");
  const [weekTypeSheetOpen, setWeekTypeSheetOpen] = useState(false);
  const [classroomTasks, setClassroomTasks] = useState<Array<{
    id: string;
    title: string;
    alternate_link: string;
    due_date: string | null;
    due_time: string | null;
    creation_time: string | null;
    course_name: string;
    state: string;
    assigned_grade?: number | null;
    max_points?: number | null;
  }>>([]);
  const [classroomLastSyncedAt, setClassroomLastSyncedAt] = useState<string | null>(null);
  const [sidebarTurnedInOpen, setSidebarTurnedInOpen] = useState(false);
  const { linkedEmail, isLinked, submissions, unlink: unlinkClassroom } = useClassroomSubmissions();

  const fetchClassroomTasks = useCallback(async (gid: number) => {
    try {
      const res = await api.classroom.groupStatus(gid);
      if (res?.tasks) {
        setClassroomTasks(res.tasks);
      }
      if (res?.last_synced_at) {
        setClassroomLastSyncedAt(res.last_synced_at);
      }
    } catch {
      // Ignore background fetch error
    }
  }, []);

  useEffect(() => {
    if (groupId) {
      void fetchClassroomTasks(groupId);
    } else {
      setClassroomTasks([]);
      setClassroomLastSyncedAt(null);
    }
  }, [groupId, fetchClassroomTasks]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        if (groupId) {
          void fetchClassroomTasks(groupId);
        }
        invalidateScheduleCache();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [groupId, fetchClassroomTasks]);

  useEffect(() => {
    try {
      const sessionSaved = sessionStorage.getItem("schedule:view");
      if (sessionSaved === "today" || sessionSaved === "week") {
        setView(sessionSaved);
        return;
      }
      const localSaved = localStorage.getItem("schedule:view");
      if (localSaved === "today") {
        setView("today");
      } else {
        setView("today");
        localStorage.setItem("schedule:view", "today");
      }
    } catch {}
  }, []);

  // Context search modal state
  const [contextModalOpen, setContextModalOpen] = useState(false);
  const [modalTab, setModalTab] = useState<"student" | "teacher">(mode);
  const [modalSearch, setModalSearch] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (contextModalOpen) {
      setModalTab(mode);
      setModalSearch("");
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
  }, [contextModalOpen, mode]);

  const filteredModalOptions = useMemo(() => {
    const list = modalTab === "student" ? groups : teachers;
    if (!modalSearch.trim()) return list;
    const q = modalSearch.toLowerCase();
    return list.filter((item) => item.name.toLowerCase().includes(q));
  }, [modalTab, groups, teachers, modalSearch]);

  // Автоскрол до поточної пари
  useEffect(() => {
    if (loading) return;
    const timer = setTimeout(() => {
      const liveCard = document.querySelector('[data-live="true"]');
      if (liveCard && window.innerWidth < 768) {
        liveCard.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [loading, view, groupId, teacherId]);
  const [returnTarget, setReturnTarget] = useState<{
    mode: "student" | "teacher";
    id: number;
    label: string;
  } | null>(null);

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

    const currentId = mode === "student" ? groupId : teacherId;
    const currentLabel =
      mode === "student"
        ? groups.find((g) => g.id === groupId)?.name || "Моєї групи"
        : teachers.find((t) => t.id === teacherId)?.name || "Мого розкладу";
    if (currentId) {
      setReturnTarget({ mode, id: currentId, label: currentLabel });
    }
    toggleMode(target.mode);
    if (target.mode === "student") setGroupId(targetId);
    else setTeacherId(targetId);
  };

  const handleReturnBack = () => {
    if (!returnTarget) return;
    toggleMode(returnTarget.mode);
    if (returnTarget.mode === "student") setGroupId(returnTarget.id);
    else setTeacherId(returnTarget.id);
    setReturnTarget(null);
  };

  const [pins, setPins] = useState<PinnedTarget[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("schedule:pins");
      if (raw) setPins(JSON.parse(raw).slice(0, MAX_PINS));
    } catch {}
  }, []);

  const currentId = mode === "student" ? groupId : teacherId;
  const currentName =
    mode === "student"
      ? groups.find((g) => g.id === groupId)?.name
      : teachers.find((t) => t.id === teacherId)?.name;

  const isCurrentPinned = Boolean(
    currentId && pins.some((p) => p.mode === mode && p.id === currentId)
  );

  const togglePinCurrent = () => {
    if (!currentId || !currentName) return;
    setPins((prev) => {
      const exists = prev.some((p) => p.mode === mode && p.id === currentId);
      const next = exists
        ? prev.filter((p) => !(p.mode === mode && p.id === currentId))
        : [{ mode, id: currentId, name: currentName }, ...prev].slice(0, MAX_PINS);
      try {
        localStorage.setItem("schedule:pins", JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  const weekType = view === "week" ? ((week?.[0]?.week_type) ?? "both") : (today?.week_type ?? "both");

  const { displayDaySchedule, isShowingTomorrow } = useMemo(() => {
    if (!today) return { displayDaySchedule: null, isShowingTomorrow: false };
    const now = new Date();
    const kyivHour = Number(
      new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Kyiv", hour: "2-digit", hour12: false }).format(now)
    );
    const kyivMin = Number(
      new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Kyiv", minute: "2-digit" }).format(now)
    );
    const totalMins = kyivHour * 60 + kyivMin;
    const dow = now.getDay();

    if (dow >= 1 && dow <= 4 && totalMins >= 15 * 60 + 25 && week.length > 0) {
      const tomorrow = new Date(now);
      tomorrow.setDate(now.getDate() + 1);
      const tomorrowIso = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(tomorrow);
      const foundTomorrow = week.find((d) => d.date === tomorrowIso);
      if (foundTomorrow) {
        return { displayDaySchedule: foundTomorrow, isShowingTomorrow: true };
      }
    }
    return { displayDaySchedule: today, isShowingTomorrow: false };
  }, [today, week]);

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setMobileMenuOpen(false);
        menuButtonRef.current?.focus();
        return;
      }
      if (e.key === "Tab" && menuRef.current) {
        const focusable = menuRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileMenuOpen]);

  const getInitialDayIndex = (): number => {
    const now = new Date();
    const dow = now.getDay();
    if (dow === 0 || dow === 6) return 0;
    const kyivHour = Number(
      new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Kyiv", hour: "2-digit", hour12: false }).format(now)
    );
    const kyivMin = Number(
      new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Kyiv", minute: "2-digit" }).format(now)
    );
    const totalMins = kyivHour * 60 + kyivMin;
    if (dow >= 1 && dow <= 4 && totalMins >= 15 * 60 + 25) {
      return dow;
    }
    return dow - 1;
  };

  const [selectedDayIndex, setSelectedDayIndex] = useState<number>(getInitialDayIndex);
  const [showAllDayTasks, setShowAllDayTasks] = useState(false);

  const activeDayDate = useMemo(() => {
    const d = new Date(weekAnchorDate);
    d.setDate(weekAnchorDate.getDate() + selectedDayIndex);
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(d);
  }, [weekAnchorDate, selectedDayIndex]);

  const todayActualIso = useMemo(() => {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(new Date());
  }, []);

  const resetScroll = () => {
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "instant" });
    }
  };

  const handleSelectDayIndex = (idx: number) => {
    if (idx === selectedDayIndex) return;
    setDaySlideDir(idx > selectedDayIndex ? 1 : -1);
    setSelectedDayIndex(idx);
    resetScroll();
  };

  const goToPrevDay = () => {
    if (selectedDayIndex > 0) {
      setDaySlideDir(-1);
      setSelectedDayIndex((prev) => prev - 1);
      resetScroll();
    } else {
      setWeekShiftDir(-1);
      setDaySlideDir(-1);
      setWeekAnchorDate((prev) => {
        const prevAnchor = new Date(prev);
        prevAnchor.setDate(prevAnchor.getDate() - 7);
        return prevAnchor;
      });
      setSelectedDayIndex(4);
      resetScroll();
    }
  };

  const goToNextDay = () => {
    if (selectedDayIndex < 4) {
      setDaySlideDir(1);
      setSelectedDayIndex((prev) => prev + 1);
      resetScroll();
    } else {
      setWeekShiftDir(1);
      setDaySlideDir(1);
      setWeekAnchorDate((prev) => {
        const nextAnchor = new Date(prev);
        nextAnchor.setDate(nextAnchor.getDate() + 7);
        return nextAnchor;
      });
      setSelectedDayIndex(0);
      resetScroll();
    }
  };

  const shiftWeekPreservingDay = (offset: number) => {
    setWeekShiftDir(offset);
    setDaySlideDir(offset > 0 ? 1 : -1);
    setWeekAnchorDate((prev) => {
      const nextAnchor = new Date(prev);
      nextAnchor.setDate(nextAnchor.getDate() + offset * 7);
      return nextAnchor;
    });
    resetScroll();
  };

  const resetWeekPreservingDay = () => {
    const currentAnchor = getInitialAnchor();
    setWeekShiftDir(0);
    setWeekAnchorDate(currentAnchor);
    resetScroll();
  };

  const handleJumpToToday = () => {
    const currentAnchor = getInitialAnchor();
    setWeekAnchorDate(currentAnchor);
    setSelectedDayIndex(getInitialDayIndex());
    setDaySlideDir(0);
    resetScroll();
  };

  const handleViewChange = (nextView: "today" | "week") => {
    setView(nextView);
    try {
      sessionStorage.setItem("schedule:view", nextView);
      localStorage.setItem("schedule:view", nextView);
    } catch {}
    if (nextView === "today") {
      handleJumpToToday();
    }
    resetScroll();
  };

  const isWeekend = [0, 6].includes(new Date().getDay());
  const isAutoSelectedWeekendDay = isWeekend && isCurrentWeek && selectedDayIndex === 0;

  const selectedDaySchedule: ScheduleResponse = useMemo(() => {
    if (week && week.length > 0) {
      const found = week.find((d) => d.date === activeDayDate);
      if (found) return found;
    }
    if (displayDaySchedule && displayDaySchedule.date === activeDayDate) {
      return displayDaySchedule;
    }
    if (today && today.date === activeDayDate) {
      return today;
    }
    return {
      date: activeDayDate,
      week_type: weekType,
      lessons: [],
    };
  }, [week, activeDayDate, weekType, displayDaySchedule, today]);

  const weekRange = useMemo(() => {
    const end = new Date(weekAnchorDate);
    end.setDate(end.getDate() + 6);
    const startOpts: Intl.DateTimeFormatOptions = { day: "numeric", month: "long" };
    if (weekAnchorDate.getFullYear() !== end.getFullYear()) startOpts.year = "numeric";
    return `${new Intl.DateTimeFormat("uk-UA", startOpts).format(weekAnchorDate)} – ${new Intl.DateTimeFormat("uk-UA", { day: "numeric", month: "long", year: "numeric" }).format(end)}`;
  }, [weekAnchorDate]);

  const resetWeek = () => setWeekAnchorDate(getInitialAnchor());

  const currentWeekNumber = useMemo(() => {
    if (!semesterStart) return null;
    const start = new Date(semesterStart);
    const diffTime = weekAnchorDate.getTime() - getMondayOf(start).getTime();
    const diffWeeks = Math.floor(diffTime / (7 * 24 * 60 * 60 * 1000)) + 1;
    return diffWeeks > 0 ? diffWeeks : null;
  }, [semesterStart, weekAnchorDate]);

  const weekDaysMini = useMemo(() => {
    const days: { index: number; name: string; dateStr: string; iso: string }[] = [];
    const dayNames = ["Пн", "Вт", "Ср", "Чт", "Пт"];
    for (let i = 0; i < 5; i++) {
      const d = new Date(weekAnchorDate);
      d.setDate(weekAnchorDate.getDate() + i);
      const iso = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(d);
      days.push({
        index: i,
        name: dayNames[i],
        dateStr: `${d.getDate()}`,
        iso,
      });
    }
    return days;
  }, [weekAnchorDate]);

  const handleShareWeek = async () => {
    if (!week || week.length === 0) return;
    const groupOrTeacher =
      mode === "student"
        ? groups.find((g) => g.id === groupId)?.name
          ? `Група ${groups.find((g) => g.id === groupId)?.name}`
          : "Розклад"
        : teachers.find((t) => t.id === teacherId)?.name
          ? `Викладач ${teachers.find((t) => t.id === teacherId)?.name}`
          : "Розклад";

    const header = `📅 ${groupOrTeacher}\n🗓 ${weekRange}${currentWeekNumber ? ` (${currentWeekNumber} тиждень` : ""}${
      weekType === "numerator"
        ? ", чисельник"
        : weekType === "denominator"
        ? ", знаменник"
        : ""
    }${currentWeekNumber ? ")" : ""}\n`;

    const dayBlocks = week
      .map((d) => {
        const dayName = new Intl.DateTimeFormat("uk-UA", { weekday: "long" }).format(
          new Date(`${d.date}T12:00:00`)
        );
        const dayDate = new Intl.DateTimeFormat("uk-UA", { day: "numeric", month: "short" }).format(
          new Date(`${d.date}T12:00:00`)
        );
        if (!d.lessons || d.lessons.length === 0) {
          return `▫️ ${dayName.toUpperCase()} (${dayDate}): пар немає`;
        }
        const lessons = [...d.lessons]
          .sort((a, b) => a.lesson_number - b.lesson_number)
          .map((l) => {
            const room = l.room ? ` [${l.room}]` : "";
            const teacher = mode === "student" && l.teacher_name ? ` (${l.teacher_name})` : "";
            return `  ${l.lesson_number}. ${l.time} ${l.subject_name}${room}${teacher}`;
          })
          .join("\n");
        return `▫️ ${dayName.toUpperCase()} (${dayDate}):\n${lessons}`;
      })
      .join("\n\n");

    const text = `${header}\n${dayBlocks}`;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        setToast("Розклад усього тижня скопійовано для Telegram!", "success");
      }
    } catch {
      setToast("Не вдалося скопіювати розклад", "error");
    }
  };

  const dayTasks = useMemo(() => {
    if (!selectedDaySchedule?.lessons) return [];
    const tasks: { title: string; subject: string; teacher?: string | null; label: string; url: string; deadline: TaskDeadline }[] = [];
    for (const l of selectedDaySchedule.lessons) {
      const extracted = extractClassroomTasks(l.note);
      for (const t of extracted) {
        tasks.push({
          title: t.title || "Домашнє завдання",
          subject: l.subject_name || l.subject,
          teacher: t.teacher || l.teacher_name || l.teacher,
          label: t.label,
          url: t.url,
          deadline: t.deadline,
        });
      }
    }
    return sortTasksByDeadline(tasks);
  }, [selectedDaySchedule]);

  const allWeekTasks = useMemo<FullTaskItem[]>(() => {
    if (classroomTasks.length > 0) {
      return classroomTasks.map((t) => {
        const taskUrl = t.alternate_link || (t as any).url;
        const personalSub = isLinked ? submissions[taskUrl] : null;
        const effectiveState = personalSub ? personalSub.state : (isLinked ? (t.state || "NEW") : "NEW");
        const effectiveGrade = personalSub ? (personalSub.grade ?? null) : (isLinked ? (t.assigned_grade ?? null) : null);
        const effectiveMaxPoints = personalSub ? (personalSub.maxPoints ?? null) : (isLinked ? (t.max_points ?? null) : null);

        const isDone = isLinked && (effectiveState === "TURNED_IN" || effectiveState === "RETURNED");
        const isUnknown = isLinked && effectiveState === "UNKNOWN";

        let deadline: TaskDeadline;
        if (t.due_date) {
          const parts = t.due_date.split("-").map(Number);
          const dYear = parts[0];
          const dMonth = parts[1];
          const dDay = parts[2];
          const targetDate = new Date(dYear, dMonth - 1, dDay);
          const now = new Date();
          const kyivNowStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(now);
          const [nowYear, nowMonth, nowDay] = kyivNowStr.split("-").map(Number);
          const todayDate = new Date(nowYear, nowMonth - 1, nowDay);
          const diffMs = targetDate.getTime() - todayDate.getTime();
          const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
          const monthName = UKR_MONTHS_SHORT[dMonth - 1] || "";
          const formattedDate = `${dDay} ${monthName}`;

          if (isDone) {
            deadline = {
              day: dDay,
              month: dMonth,
              year: dYear,
              date: targetDate,
              formattedDate,
              isOverdue: false,
              overdueDays: 0,
              isUrgent: false,
              statusText: effectiveState === "RETURNED" && effectiveGrade != null ? `Оцінка: ${effectiveGrade}/${effectiveMaxPoints || 100}` : "Здано",
              badgeTone: "normal",
            };
          } else if (isUnknown) {
            deadline = {
              day: dDay,
              month: dMonth,
              year: dYear,
              date: targetDate,
              formattedDate,
              isOverdue: false,
              overdueDays: 0,
              isUrgent: false,
              statusText: "статус невідомий",
              badgeTone: "normal",
            };
          } else if (diffDays < 0) {
            const overdueDays = Math.abs(diffDays);
            deadline = {
              day: dDay,
              month: dMonth,
              year: dYear,
              date: targetDate,
              formattedDate,
              isOverdue: true,
              overdueDays,
              isUrgent: false,
              statusText: `${formattedDate} · прострочено ${overdueDays} ${pluralDays(overdueDays)}`,
              badgeTone: "overdue",
            };
          } else if (diffDays === 0) {
            deadline = {
              day: dDay,
              month: dMonth,
              year: dYear,
              date: targetDate,
              formattedDate,
              isOverdue: false,
              overdueDays: 0,
              isUrgent: true,
              statusText: `Сьогодні (до ${formattedDate})`,
              badgeTone: "urgent",
            };
          } else if (diffDays === 1) {
            deadline = {
              day: dDay,
              month: dMonth,
              year: dYear,
              date: targetDate,
              formattedDate,
              isOverdue: false,
              overdueDays: 0,
              isUrgent: true,
              statusText: `Завтра (до ${formattedDate})`,
              badgeTone: "urgent",
            };
          } else {
            deadline = {
              day: dDay,
              month: dMonth,
              year: dYear,
              date: targetDate,
              formattedDate,
              isOverdue: false,
              overdueDays: 0,
              isUrgent: false,
              statusText: `до ${formattedDate}`,
              badgeTone: "normal",
            };
          }
        } else {
          deadline = {
            day: null,
            month: null,
            year: null,
            date: null,
            formattedDate: "",
            isOverdue: false,
            overdueDays: 0,
            isUrgent: false,
            statusText: isDone ? (effectiveState === "RETURNED" && effectiveGrade != null ? `Оцінка: ${effectiveGrade}/${effectiveMaxPoints || 100}` : "Здано") : isUnknown ? "статус невідомий" : "",
            badgeTone: "normal",
          };
        }

        return {
          id: t.id,
          title: t.title || "Завдання",
          subject: t.course_name,
          label: t.due_date ? `до ${t.due_date}` : "",
          url: taskUrl,
          deadline,
          state: effectiveState,
          assignedGrade: effectiveGrade,
          maxPoints: effectiveMaxPoints,
        };
      });
    }

    if (!week || week.length === 0) return [];
    const tasks: FullTaskItem[] = [];
    const seenKeys = new Set<string>();

    for (const d of week) {
      if (!d.lessons) continue;
      for (const l of d.lessons) {
        const extracted = extractClassroomTasks(l.note);
        for (const t of extracted) {
          const key = `${t.url || t.title}-${t.deadline?.formattedDate || ""}-${t.label || ""}`;
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            tasks.push({
              title: t.title || "Завдання",
              subject: l.subject_name || l.subject,
              teacher: t.teacher || l.teacher_name || l.teacher,
              label: t.label,
              url: t.url,
              deadline: t.deadline,
              state: "NEW",
            });
          }
        }
      }
    }
    return sortTasksByDeadline(tasks);
  }, [classroomTasks, week, isLinked, submissions]);

  const overdueCount = useMemo(() => {
    return allWeekTasks.filter(
      (t) =>
        t.deadline.isOverdue &&
        t.state !== "TURNED_IN" &&
        t.state !== "RETURNED" &&
        t.state !== "UNKNOWN"
    ).length;
  }, [allWeekTasks]);

  const overdueTasks = useMemo(() => {
    return allWeekTasks.filter(
      (t) =>
        t.deadline.isOverdue &&
        t.state !== "TURNED_IN" &&
        t.state !== "RETURNED" &&
        t.state !== "UNKNOWN"
    );
  }, [allWeekTasks]);

  const activeTasks = useMemo(() => {
    return allWeekTasks.filter(
      (t) =>
        !t.deadline.isOverdue &&
        Boolean(t.deadline.date) &&
        t.state !== "TURNED_IN" &&
        t.state !== "RETURNED"
    );
  }, [allWeekTasks]);

  const noDateTasks = useMemo(() => {
    return allWeekTasks.filter(
      (t) =>
        !t.deadline.date &&
        t.state !== "TURNED_IN" &&
        t.state !== "RETURNED"
    );
  }, [allWeekTasks]);

  const turnedInTasks = useMemo(() => {
    return allWeekTasks.filter(
      (t) => t.state === "TURNED_IN" || t.state === "RETURNED"
    );
  }, [allWeekTasks]);

  const UserControls = () => (
    <div className="flex items-center gap-2">
      {user ? (
        <>
          {canAccessAdmin(user) && (
            <a href="/admin" className="rounded-lg bg-sys-accent px-3 py-1.5 text-xs font-medium text-white whitespace-nowrap shadow-sm hover:opacity-90 transition-opacity">
              Для працівників
            </a>
          )}
          <button onClick={logout} className="rounded-lg bg-transparent border border-sys-border px-3 py-1.5 text-xs font-medium text-sys-text-secondary whitespace-nowrap hover:text-white hover:bg-sys-bg transition-colors">
            Вийти
          </button>
        </>
      ) : (
        <a href="/login" className="text-xs font-medium text-sys-text-secondary hover:text-white transition-colors underline-offset-4 hover:underline whitespace-nowrap">
          Для працівників
        </a>
      )}
    </div>
  );

  if (!loading && !isSetupComplete) {
    return <WelcomeScreen groups={groups} teachers={teachers} initialMode={mode} onComplete={(m, id) => {
        toggleMode(m);
        if (m === "student") setGroupId(id);
        else setTeacherId(id);
        completeSetup();
    }} />;
  }

  return (
    <main className="min-h-screen bg-sys-bg pb-6 text-sys-text-primary md:pb-8">
      <OfflineIndicator />
      <InstallPrompt />

      {/* Desktop Toolbar (>= 1024px) */}
      <header className="sticky top-0 z-40 hidden lg:block h-14 border-b border-sys-border bg-sys-card/95 backdrop-blur-md">
        <div className="mx-auto grid grid-cols-[1fr_auto_1fr] h-full max-w-[1800px] items-center px-6">
          {/* Left Zone: Brand + Context Selector */}
          <div className="flex items-center gap-3 min-w-0 justify-self-start">
            <a
              href="https://kre.dp.ua/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 shrink-0 hover:opacity-85 transition-opacity"
              title="Дніпровський фаховий коледж радіоелектроніки"
            >
              <span className="rounded bg-sys-accent/15 px-2 py-0.5 text-xs font-black uppercase tracking-wider text-sys-accent border border-sys-accent/20">
                ДФКР
              </span>
              <span className="text-sm font-bold tracking-tight text-sys-text-primary">
                Розклад
              </span>
            </a>

            {/* Context Selector Trigger Button */}
            <button
              type="button"
              onClick={() => setContextModalOpen(true)}
              aria-label="Обрати групу або викладача"
              className="flex h-10 items-center gap-2 rounded-xl border border-sys-border bg-sys-bg/80 px-3 text-sm font-medium text-sys-text-primary hover:border-sys-accent/60 hover:bg-sys-bg transition-all truncate max-w-[260px] focus:outline-none focus:ring-2 focus:ring-sys-accent"
            >
              <span className="text-sys-text-muted shrink-0">
                {mode === "student" ? "Група:" : "Викладач:"}
              </span>
              <span className="truncate font-semibold text-sys-text-primary">
                {currentName || (mode === "student" ? "Оберіть групу" : "Оберіть викладача")}
              </span>
              <span className="text-sys-text-muted text-[10px] ml-auto shrink-0">▼</span>
            </button>
          </div>

          {/* Center Zone: Date Navigator + View Mode */}
          <div className="flex items-center gap-3 justify-self-center">
            {/* Date Navigator: < [Сьогодні] > */}
            <div className="flex items-center rounded-xl border border-sys-border bg-sys-bg p-0.5 text-xs">
              <button
                type="button"
                onClick={view === "today" ? goToPrevDay : () => shiftWeek(-1)}
                aria-label="Попередній період"
                title="Попередній період"
                className="flex h-10 w-10 items-center justify-center rounded-lg text-sys-text-secondary hover:bg-sys-card hover:text-white transition-colors"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m15 18-6-6 6-6" />
                </svg>
              </button>
              <button
                type="button"
                onClick={view === "today" ? handleJumpToToday : resetWeek}
                disabled={
                  (view === "today" && selectedDaySchedule?.date === todayActualIso) ||
                  (view === "week" && isCurrentWeek)
                }
                aria-label="Перейти на сьогодні"
                title="Перейти на сьогодні"
                className={`px-3.5 h-10 rounded-lg font-medium transition-colors ${
                  (view === "today" && selectedDaySchedule?.date === todayActualIso) ||
                  (view === "week" && isCurrentWeek)
                    ? "text-sys-text-muted cursor-default bg-transparent opacity-50"
                    : "text-sys-text-secondary hover:text-white hover:bg-sys-card active:scale-95"
                }`}
              >
                Сьогодні
              </button>
              <button
                type="button"
                onClick={view === "today" ? goToNextDay : () => shiftWeek(1)}
                aria-label="Наступний період"
                title="Наступний період"
                className="flex h-10 w-10 items-center justify-center rounded-lg text-sys-text-secondary hover:bg-sys-card hover:text-white transition-colors"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m9 18 6-6-6-6" />
                </svg>
              </button>
            </div>

            {/* Segmented Switcher: [ День | Тиждень ] */}
            <div role="group" aria-label="Режим відображення" className="flex rounded-xl border border-sys-border bg-sys-bg p-1 text-xs">
              <button
                type="button"
                onClick={() => handleViewChange("today")}
                className={`h-8 px-3.5 rounded-lg font-semibold transition-all ${
                  view === "today"
                    ? "bg-sys-accent text-white shadow-xs"
                    : "text-sys-text-secondary hover:text-white"
                }`}
              >
                День
              </button>
              <button
                type="button"
                onClick={() => handleViewChange("week")}
                className={`h-8 px-3.5 rounded-lg font-semibold transition-all ${
                  view === "week"
                    ? "bg-sys-accent text-white shadow-xs"
                    : "text-sys-text-secondary hover:text-white"
                }`}
              >
                Тиждень
              </button>
            </div>
          </div>

          {/* Right Zone: Favorites, Classroom, Action menu */}
          <div className="flex items-center gap-2 justify-self-end">
            {/* Classroom button */}
            {mode === "student" && groupId && (
              <ClassroomSyncButton
                currentGroupId={groupId}
                weekStart={weekStartStr}
                onSynced={(detectedId) => {
                  if (detectedId && detectedId !== groupId) {
                    setGroupId(detectedId);
                  }
                }}
              />
            )}

            {/* Star Pin */}
            {currentId && (
              <button
                type="button"
                onClick={togglePinCurrent}
                title={isCurrentPinned ? "Прибрати із закріплених" : "Закріпити розклад"}
                aria-label={isCurrentPinned ? "Відкріпити розклад" : "Закріпити розклад"}
                aria-pressed={isCurrentPinned}
                className={`flex h-10 w-10 items-center justify-center rounded-xl border text-base transition-colors ${
                  isCurrentPinned
                    ? "border-amber-400/40 bg-amber-400/10 text-amber-300"
                    : "border-sys-border bg-sys-bg text-sys-text-muted hover:text-sys-text-primary hover:border-sys-border-elevated"
                }`}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill={isCurrentPinned ? "currentColor" : "none"}
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={isCurrentPinned ? "text-amber-400" : "text-slate-400 hover:text-amber-300"}
                >
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
              </button>
            )}

            {/* Action Menu Trigger ⋯ */}
            <button
              ref={menuButtonRef}
              type="button"
              onClick={() => setMobileMenuOpen((prev) => !prev)}
              aria-label="Меню налаштувань та швидких посилань"
              title="Меню розкладу"
              aria-expanded={mobileMenuOpen}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-sys-border bg-sys-bg text-sys-text-secondary hover:text-white hover:border-sys-border-elevated transition-colors focus:outline-none focus:ring-2 focus:ring-sys-accent"
            >
              ⋯
            </button>
          </div>
        </div>
      </header>

      {/* Mobile 2-Tier Header (< 1024px) */}
      <header className="sticky top-0 z-40 border-b border-sys-border bg-sys-card/95 backdrop-blur-md pt-[env(safe-area-inset-top)] lg:hidden">
        {/* Tier 1 (h-14): [85 ▾]   ‹ 19–25 жовт. ›   [⋯] */}
        <div className="flex h-14 items-center justify-between px-3 gap-2">
          {/* Left: Context Selector */}
          <button
            type="button"
            onClick={() => setContextModalOpen(true)}
            aria-label="Обрати групу або викладача"
            className="flex h-10 items-center gap-1.5 rounded-xl border border-sys-border bg-sys-bg/90 px-3 text-xs font-semibold text-sys-text-primary hover:border-sys-accent/60 active:scale-95 transition-all truncate max-w-[130px] sm:max-w-[160px]"
          >
            <span className="truncate">
              {currentName || (mode === "student" ? "Група" : "Викладач")}
            </span>
            <span className="text-sys-text-muted text-[10px] shrink-0">▼</span>
          </button>

          {/* Center: Week Navigator & week type info */}
          {mobileTab === "tasks" ? (
            <div className="flex flex-col items-center justify-center flex-1 min-w-0">
              <span className="text-sm font-bold text-sys-text-primary">Завдання</span>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center flex-1 min-w-0">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => shiftWeekPreservingDay(-1)}
                  aria-label="Попередній тиждень"
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-sys-text-secondary hover:text-white active:scale-90 transition-transform"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m15 18-6-6 6-6" />
                  </svg>
                </button>

                <button
                  type="button"
                  onClick={resetWeekPreservingDay}
                  title={isCurrentWeek ? "Поточний тиждень" : "Повернутися на поточний тиждень"}
                  className="px-1 text-center truncate max-w-[150px] sm:max-w-[200px]"
                >
                  <span className="text-xs sm:text-[13px] font-bold text-sys-text-primary block truncate leading-tight">
                    {weekRange.split("–")[0]?.trim()} – {weekRange.split("–")[1]?.trim()?.split(" ")?.slice(0, 2)?.join(" ") || ""}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => shiftWeekPreservingDay(1)}
                  aria-label="Наступний тиждень"
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-sys-text-secondary hover:text-white active:scale-90 transition-transform"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                </button>
              </div>

              <button
                type="button"
                onClick={() => setWeekTypeSheetOpen(true)}
                className="flex items-center gap-1 text-[11px] text-sys-text-muted hover:text-sys-text-secondary -mt-0.5 leading-none py-0.5"
              >
                <span>{currentWeekNumber ? `${currentWeekNumber} тиждень` : ""}</span>
                {weekType !== "both" && (
                  <>
                    <span>·</span>
                    <span className="underline decoration-dotted underline-offset-2">
                      {weekType === "numerator" ? "чисельник" : "знаменник"}
                    </span>
                    <span className="text-[10px]">ⓘ</span>
                  </>
                )}
              </button>
            </div>
          )}

          {/* Right: Action menu trigger ⋯ */}
          <button
            ref={menuButtonRef}
            type="button"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            aria-label="Меню налаштувань та швидких дій"
            title="Меню дій"
            aria-expanded={mobileMenuOpen}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-sys-border bg-sys-bg text-sys-text-secondary hover:text-white active:scale-95 transition-all"
          >
            ⋯
          </button>
        </div>

        {/* Tier 2 (h-11): Sticky Day tabs Пн• Вт Ср Чт Пт */}
        {mobileTab === "schedule" && view === "today" && (
          <MobileWeekDaysStrip
            weekAnchorDate={weekAnchorDate}
            selectedDayIndex={selectedDayIndex}
            onSelectDay={handleSelectDayIndex}
            isCurrentWeek={isCurrentWeek}
            todayIso={todayActualIso}
          />
        )}
      </header>

      {/* Context Selection Modal */}
      <AnimatePresence>
        {contextModalOpen && (
          <motion.div
            key="contextModalBackdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4"
            onClick={() => setContextModalOpen(false)}
          >
            <motion.div
              key="contextModalBox"
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.15 }}
              className="w-full max-w-md rounded-2xl border border-sys-border bg-sys-card p-4 sm:p-5 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header with tabs */}
              <div className="flex items-center justify-between gap-2 pb-3 border-b border-sys-border/60">
                <div className="flex rounded-xl border border-sys-border bg-sys-bg p-1 flex-1">
                  <button
                    type="button"
                    onClick={() => { setModalTab("student"); setModalSearch(""); }}
                    className={`flex-1 h-9 rounded-lg text-xs font-semibold transition-all ${
                      modalTab === "student" ? "bg-sys-accent text-white shadow-xs" : "text-sys-text-secondary hover:text-white"
                    }`}
                  >
                    Групи ({groups.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => { setModalTab("teacher"); setModalSearch(""); }}
                    className={`flex-1 h-9 rounded-lg text-xs font-semibold transition-all ${
                      modalTab === "teacher" ? "bg-sys-accent text-white shadow-xs" : "text-sys-text-secondary hover:text-white"
                    }`}
                  >
                    Викладачі ({teachers.length})
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setContextModalOpen(false)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-sys-border text-sys-text-secondary hover:text-white hover:bg-sys-bg transition-colors"
                >
                  ✕
                </button>
              </div>

              {/* Search Input */}
              <div className="mt-3 relative">
                <input
                  ref={searchInputRef}
                  type="text"
                  value={modalSearch}
                  onChange={(e) => setModalSearch(e.target.value)}
                  placeholder={modalTab === "student" ? "Пошук групи (наприклад 85)..." : "Пошук викладача..."}
                  className="w-full h-10 rounded-xl border border-sys-border bg-sys-bg px-3.5 text-sm text-sys-text-primary placeholder:text-sys-text-muted focus:border-sys-accent focus:ring-2 focus:ring-sys-accent focus:outline-none"
                />
              </div>

              {/* List of items */}
              <div className="mt-3 max-h-72 overflow-y-auto space-y-1 pr-1">
                {filteredModalOptions.map((opt) => {
                  const isSelected = modalTab === "student" ? opt.id === groupId : opt.id === teacherId;
                  return (
                    <button
                      key={`${modalTab}-${opt.id}`}
                      type="button"
                      onClick={() => {
                        toggleMode(modalTab);
                        if (modalTab === "student") setGroupId(opt.id);
                        else setTeacherId(opt.id);
                        setContextModalOpen(false);
                      }}
                      className={`w-full text-left px-3.5 py-2.5 rounded-xl text-sm transition-colors flex items-center justify-between ${
                        isSelected
                          ? "bg-sys-accent/15 text-sys-accent font-semibold border border-sys-accent/30"
                          : "text-sys-text-primary hover:bg-sys-bg"
                      }`}
                    >
                      <span>{opt.name}</span>
                      {isSelected && <span className="text-xs">✓</span>}
                    </button>
                  );
                })}
                {filteredModalOptions.length === 0 && (
                  <p className="text-center py-6 text-xs text-sys-text-muted">Нічого не знайдено</p>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Action Menu (⋯ Dropdown / Drawer) */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <>
            <motion.div
              key="mobileMenuBackdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: shouldReduceMotion ? 0 : 0.15 }}
              className="fixed inset-0 z-40 bg-black/50 backdrop-blur-xs"
              onClick={() => setMobileMenuOpen(false)}
              aria-hidden="true"
            />
            <motion.div
              key="mobileMenuDropdown"
              id="mobile-dropdown-menu"
              ref={menuRef}
              role="menu"
              initial={{ opacity: 0, scale: 0.95, y: -6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -6 }}
              transition={{ duration: shouldReduceMotion ? 0 : 0.15 }}
              className="fixed top-14 right-3 z-50 w-72 max-w-[calc(100vw-1.5rem)] rounded-2xl border border-sys-border bg-sys-card p-3 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between pb-2 border-b border-sys-border/50">
                <span className="text-xs font-bold uppercase tracking-wider text-sys-text-muted">Меню розкладу</span>
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex h-6 w-6 items-center justify-center rounded-md border border-sys-border text-xs text-sys-text-secondary hover:text-white"
                >
                  ✕
                </button>
              </div>

              {/* Mode switch */}
              {teachers.length > 0 && (
                <div className="mt-2.5">
                  <span className="mb-1 block text-[11px] font-semibold text-sys-text-secondary">Режим перегляду</span>
                  <div role="group" aria-label="Тип розкладу" className="flex rounded-lg border border-sys-border bg-sys-bg p-1 relative w-full">
                    <button
                      type="button"
                      role="menuitem"
                      aria-pressed={mode === "student"}
                      onClick={() => {
                        toggleMode("student");
                        setMobileMenuOpen(false);
                      }}
                      className={`flex-1 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                        mode === "student" ? "bg-sys-accent text-white shadow-xs" : "text-sys-text-secondary hover:text-white"
                      }`}
                    >
                      Для групи
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      aria-pressed={mode === "teacher"}
                      onClick={() => {
                        toggleMode("teacher");
                        setMobileMenuOpen(false);
                      }}
                      className={`flex-1 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                        mode === "teacher" ? "bg-sys-accent text-white shadow-xs" : "text-sys-text-secondary hover:text-white"
                      }`}
                    >
                      Для викладача
                    </button>
                  </div>
                </div>
              )}

              {/* Pinned shortcuts */}
              {pins.length > 0 && (
                <div className="mt-2.5">
                  <span className="mb-1 block text-[11px] font-semibold text-sys-text-secondary">Закріплені</span>
                  <div className="flex flex-wrap gap-1">
                    {pins.map((pin) => (
                      <button
                        key={`menu-pin-${pin.mode}-${pin.id}`}
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          toggleMode(pin.mode);
                          if (pin.mode === "student") setGroupId(pin.id);
                          else setTeacherId(pin.id);
                          setMobileMenuOpen(false);
                        }}
                        className="rounded-full border border-sys-border bg-sys-bg px-2.5 py-0.5 text-xs font-medium text-sys-text-secondary hover:text-white"
                      >
                        ★ {pin.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Secondary Links & Controls */}
              <div className="mt-3 flex flex-col gap-1.5 border-t border-sys-border/50 pt-2.5">
                {/* View format switcher (Day / Week) on mobile */}
                <div className="mb-1 lg:hidden">
                  <span className="mb-1 block text-[11px] font-semibold text-sys-text-secondary">Формат розкладу</span>
                  <div role="group" aria-label="Формат розкладу" className="flex rounded-lg border border-sys-border bg-sys-bg p-1 relative w-full">
                    <button
                      type="button"
                      role="menuitem"
                      aria-pressed={view === "today"}
                      onClick={() => {
                        handleViewChange("today");
                        setMobileTab("schedule");
                        setMobileMenuOpen(false);
                      }}
                      className={`flex-1 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                        view === "today" ? "bg-sys-accent text-white shadow-xs" : "text-sys-text-secondary hover:text-white"
                      }`}
                    >
                      День
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      aria-pressed={view === "week"}
                      onClick={() => {
                        handleViewChange("week");
                        setMobileTab("schedule");
                        setMobileMenuOpen(false);
                      }}
                      className={`flex-1 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                        view === "week" ? "bg-sys-accent text-white shadow-xs" : "text-sys-text-secondary hover:text-white"
                      }`}
                    >
                      Тиждень
                    </button>
                  </div>
                </div>

                {/* Save group in favorites */}
                {currentId && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      togglePinCurrent();
                      setMobileMenuOpen(false);
                    }}
                    className="flex items-center justify-between rounded-xl border border-sys-border/60 bg-sys-bg/60 px-3 py-2 text-xs font-semibold text-sys-text-primary hover:border-sys-accent/40"
                  >
                    <span className="flex items-center gap-2">
                      <svg
                        width="15"
                        height="15"
                        viewBox="0 0 24 24"
                        fill={isCurrentPinned ? "currentColor" : "none"}
                        stroke="currentColor"
                        strokeWidth="1.75"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className={isCurrentPinned ? "text-amber-400" : "text-slate-400"}
                      >
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                      </svg>
                      <span>{isCurrentPinned ? "Відкріпити розклад" : "Зберегти розклад у обрані"}</span>
                    </span>
                    {isCurrentPinned && <span className="text-[10px] text-amber-400 font-bold">Збережено</span>}
                  </button>
                )}

                {/* Share week */}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    void handleShareWeek();
                  }}
                  className="flex items-center justify-between rounded-xl border border-sys-border/60 bg-sys-bg/60 px-3 py-2 text-xs font-semibold text-sys-text-primary hover:border-sys-accent/40"
                >
                  <span className="flex items-center gap-2">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400">
                      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                      <polyline points="16 6 12 2 8 6" />
                      <line x1="12" y1="2" x2="12" y2="15" />
                    </svg>
                    <span>Поділитися розкладом тижня</span>
                  </span>
                  <span className="text-sys-text-muted">↗</span>
                </button>

                {mode === "student" && groupId && (
                  <div className="flex items-center justify-between rounded-xl border border-sys-border/60 bg-sys-bg/60 px-3 py-2 sm:hidden">
                    <span className="text-xs font-semibold text-sys-text-primary">Google Classroom</span>
                    <ClassroomSyncButton
                      currentGroupId={groupId}
                      weekStart={weekStartStr}
                      onSynced={(detectedId) => {
                        if (detectedId && detectedId !== groupId) {
                          setGroupId(detectedId);
                        }
                        setMobileMenuOpen(false);
                      }}
                    />
                  </div>
                )}
                <a
                  href="/statistics"
                  role="menuitem"
                  className="flex items-center justify-between rounded-xl border border-sys-border/60 bg-sys-bg/60 px-3 py-2 text-xs font-semibold text-sys-text-primary hover:border-sys-accent/40"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <span className="flex items-center gap-2">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
                    <span>Статистика</span>
                  </span>
                  <span className="text-sys-text-muted">↗</span>
                </a>
                <a
                  href="/educational-process"
                  role="menuitem"
                  className="flex items-center justify-between rounded-xl border border-sys-border/60 bg-sys-bg/60 px-3 py-2 text-xs font-semibold text-sys-text-primary hover:border-sys-accent/40"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <span className="flex items-center gap-2">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                    <span>Графік процесу</span>
                  </span>
                  <span className="text-sys-text-muted">↗</span>
                </a>
                {isStandalone && !isDownloaded && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMobileMenuOpen(false);
                      void handleDownloadOffline();
                    }}
                    disabled={isDownloading}
                    className="flex items-center justify-between rounded-xl border border-sys-border/60 bg-sys-bg/60 px-3 py-2 text-xs font-semibold text-sys-text-primary disabled:opacity-50"
                  >
                    <span className="flex items-center gap-2">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                      <span>{isDownloading ? "Зберігаємо…" : "Зберегти на пристрій"}</span>
                    </span>
                  </button>
                )}
                <div className="pt-1.5">
                  <UserControls />
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Mobile Main Content (<1024px) */}
      <div className="lg:hidden pb-24">
        {returnTarget && (
          <div className="m-3 flex items-center justify-between rounded-xl border border-sys-accent/30 bg-sys-accent/10 px-3 py-2 text-xs">
            <span className="text-sys-text-secondary truncate mr-2">
              Розклад: <strong className="text-sys-text-primary">{mode === "student" ? groups.find((g) => g.id === groupId)?.name : teachers.find((t) => t.id === teacherId)?.name}</strong>
            </span>
            <button
              type="button"
              onClick={handleReturnBack}
              className="shrink-0 rounded-lg bg-sys-accent px-2.5 py-1 text-[11px] font-semibold text-[#0b1120] active:scale-[0.98]"
            >
              ← До {returnTarget.label}
            </button>
          </div>
        )}

        {mobileTab === "tasks" ? (
          <MobileTasksView
            tasks={allWeekTasks}
            groupId={groupId}
            weekStart={weekStartStr}
            lastSyncedAt={classroomLastSyncedAt}
            onSynced={(detectedId) => {
              if (detectedId && detectedId !== groupId) setGroupId(detectedId);
            }}
          />
        ) : (
          <div className="px-3 py-3">
            {loading ? (
              <div className="space-y-3" aria-busy="true" aria-label="Завантаження розкладу">
                {[1, 2, 3].map((num) => (
                  <div
                    key={num}
                    className="flex items-start gap-4 rounded-xl border border-sys-border/60 bg-sys-card/70 p-4 animate-pulse"
                  >
                    <div className="flex w-12 shrink-0 flex-col gap-1.5">
                      <div className="h-5 w-6 rounded bg-slate-700/70" />
                      <div className="h-3 w-10 rounded bg-slate-800" />
                    </div>
                    <div className="flex flex-1 flex-col gap-2.5">
                      <div className="h-4 w-3/5 rounded bg-slate-700/70" />
                      <div className="h-3.5 w-2/5 rounded bg-slate-800" />
                    </div>
                  </div>
                ))}
              </div>
            ) : error ? (
              <div className="rounded-2xl border border-rose-400/20 bg-rose-400/5 p-6 text-center text-sm text-rose-200">
                {error}
              </div>
            ) : view === "today" ? (
              <DayPager
                schedule={selectedDaySchedule}
                todayDate={todayActualIso}
                scheduleMode={mode}
                canEdit={false}
                onQuickJump={handleQuickJump}
                onNextDay={goToNextDay}
                onPrevDay={goToPrevDay}
                onJumpToToday={handleJumpToToday}
                daySlideDir={daySlideDir}
                shouldReduceMotion={shouldReduceMotion ?? false}
                isWeekend={isAutoSelectedWeekendDay}
                isShowingTomorrow={isShowingTomorrow && !isWeekend}
              />
            ) : (
              <ScheduleWeekGrid
                week={week}
                scheduleMode={mode}
                canEdit={false}
                onQuickJump={handleQuickJump}
              />
            )}

            {!loading && !error && ((mode === "student" && !groups.length) || (mode === "teacher" && !teachers.length)) && (
              <div className="mt-4 rounded-2xl border border-dashed border-sys-border p-8 text-center text-xs text-sys-text-secondary">
                {mode === "student" ? "Список груп поки порожній." : "Список викладачів поки порожній."}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Desktop Main Content (>= 1024px) */}
      <div className="hidden lg:block mx-auto max-w-[1600px] px-[27px] py-6">
        {returnTarget && (
          <div className="mb-4 flex items-center justify-between rounded-xl border border-sys-accent/30 bg-sys-accent/10 px-4 py-2.5 text-sm">
            <span className="text-sys-text-secondary">
              Перегляд розкладу:{" "}
              <strong className="text-sys-text-primary">
                {mode === "student"
                  ? groups.find((g) => g.id === groupId)?.name
                  : teachers.find((t) => t.id === teacherId)?.name}
              </strong>
            </span>
            <button
              type="button"
              onClick={handleReturnBack}
              className="rounded-lg bg-sys-accent px-3 py-1 text-xs font-semibold text-[#0b1120] transition-opacity hover:opacity-90 active:scale-[0.98]"
            >
              ← Повернутися до {returnTarget.label}
            </button>
          </div>
        )}

        {loading ? (
          <div className="space-y-3" aria-busy="true" aria-label="Завантаження розкладу">
            {[1, 2, 3, 4].map((num) => (
              <div
                key={num}
                className="flex items-start gap-4 rounded-xl border border-sys-border/60 bg-sys-card/70 p-4 animate-pulse"
              >
                <div className="flex w-12 shrink-0 flex-col gap-1.5">
                  <div className="h-5 w-6 rounded bg-slate-700/70" />
                  <div className="h-3 w-10 rounded bg-slate-800" />
                </div>
                <div className="flex flex-1 flex-col gap-2.5">
                  <div className="h-4 w-3/5 rounded bg-slate-700/70" />
                  <div className="h-3.5 w-2/5 rounded bg-slate-800" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-rose-400/20 bg-rose-400/5 p-8 text-center text-rose-200">{error}</div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div
              key={view}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: shouldReduceMotion ? 0 : 0.15 }}
            >
              {view === "today" ? (
                /* Desktop Day Mode: 2-column Dashboard */
                <div className="w-full min-w-0">
                  <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-8 items-start w-full">
                    {/* Left Column: Schedule (minmax(0, 1fr)) */}
                    <div className="w-full min-w-0">
                      {isWeekend && (
                        <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-slate-700/60 bg-slate-800/50 px-5 py-4 text-[15px] shadow-sm">
                          <div className="flex items-center gap-3 min-w-0">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-amber-300">
                              <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                              <polyline points="9 22 9 12 15 12 15 22" />
                            </svg>
                            <div className="flex flex-col min-w-0">
                              <span className="font-semibold text-sys-text-primary text-base">Сьогодні вихідний</span>
                              <span className="text-sys-text-secondary text-xs sm:text-[13px]">Показано найближчий навчальний день</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <WeekTypeBadge weekType={today?.week_type ?? "both"} />
                          </div>
                        </div>
                      )}

                      {isShowingTomorrow && selectedDaySchedule?.date !== todayActualIso && !isWeekend && (
                        <div className="mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 rounded-xl border border-sys-accent/30 bg-sys-accent/10 px-4 py-2 text-xs sm:text-[13px] text-sys-text-primary shadow-xs">
                          <div className="flex items-center gap-2">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-sys-accent">
                              <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
                            </svg>
                            <span>Пари на сьогодні завершено — показано <strong>розклад на завтра</strong></span>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              const todayIdx = weekDaysMini.findIndex((d) => d.iso === todayActualIso);
                              if (todayIdx >= 0) handleSelectDayIndex(todayIdx);
                            }}
                            className="shrink-0 rounded-lg bg-[#1e293b] border border-sys-accent/40 px-3 py-1 text-xs font-semibold text-[#93c5fd] hover:bg-[#334155] transition-colors"
                          >
                            Повернутися на сьогодні
                          </button>
                        </div>
                      )}

                      <ScheduleDay
                        schedule={selectedDaySchedule ?? today!}
                        isToday={selectedDaySchedule?.date === todayActualIso && !isWeekend}
                        scheduleMode={mode}
                        onQuickJump={handleQuickJump}
                        hideHeaderOnMobile={false}
                      />
                    </div>

                    {/* Right Column: Week Info & Classroom Widget (360px) */}
                    <div className="w-full lg:w-[360px] shrink-0 min-w-0 flex flex-col gap-6 sticky top-[72px]">
                      {/* Week & Navigator Card */}
                      <div className="rounded-2xl border border-sys-border bg-sys-card p-5 shadow-sm">
                        <div className="pb-3.5 border-b border-sys-border/50">
                          <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-sys-text-muted">
                            <span>{currentWeekNumber ? `${currentWeekNumber} ТИЖДЕНЬ` : "РОЗКЛАД"}</span>
                            {weekType !== "both" && (
                              <>
                                <span>•</span>
                                <span
                                  title={
                                    weekType === "numerator"
                                      ? "Чисельник — непарний тиждень навчального графіка"
                                      : "Знаменник — парний тиждень навчального графіка"
                                  }
                                  className="lowercase font-medium text-sys-text-secondary cursor-help underline decoration-dotted underline-offset-2"
                                >
                                  {weekType === "numerator" ? "чисельник" : "знаменник"}
                                </span>
                              </>
                            )}
                          </div>
                          <h3 className="text-base sm:text-lg font-semibold text-sys-text-primary mt-1 truncate">
                            {weekRange}
                          </h3>
                        </div>

                        {/* 5-Day Quick Switcher */}
                        <div className="mt-4">
                          <div className="grid grid-cols-5 gap-2">
                            {weekDaysMini.map((d) => {
                              const isActive = d.index === selectedDayIndex;
                              const isToday = d.iso === todayActualIso;
                              return (
                                <button
                                  key={d.iso}
                                  type="button"
                                  onClick={() => handleSelectDayIndex(d.index)}
                                  className={`flex flex-col items-center justify-center h-16 rounded-xl transition-all relative ${
                                    isActive
                                      ? "bg-sys-accent text-[#0b1120] font-black shadow-md ring-2 ring-sys-accent/60"
                                      : "border border-sys-border bg-sys-bg text-sys-text-secondary hover:text-white hover:border-sys-border-elevated font-medium"
                                  }`}
                                >
                                  <span className={`text-xs uppercase font-semibold ${isActive ? "text-[#0b1120]/80" : ""}`}>{d.name}</span>
                                  <span className="text-xl font-bold mt-0.5 leading-none">{d.dateStr}</span>
                                  {isToday && (
                                    <span
                                      title="Сьогодні"
                                      className={`h-1.5 w-1.5 rounded-full absolute bottom-1.5 left-1/2 -translate-x-1/2 ${isActive ? "bg-[#0b1120]" : "bg-sys-accent"}`}
                                    />
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>

                      {/* Google Classroom Deadlines Widget */}
                      <div className="rounded-2xl border border-sys-border bg-sys-card p-5 shadow-sm">
                        <div className="flex items-center justify-between pb-3.5 border-b border-sys-border/50">
                          <div className="flex items-center gap-2">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-purple-400">
                              <path d="M16 4h2a2 2 0 0 1 2 2v14l-8-4-8 4V6a2 2 0 0 1 2-2h2" />
                              <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
                            </svg>
                            <span className="text-sm font-bold uppercase tracking-wider text-sys-text-primary">
                              {overdueCount > 0 ? `Прострочено · ${overdueCount}` : `Завдання · ${activeTasks.length + noDateTasks.length}`}
                            </span>
                          </div>
                          {overdueCount > 0 ? (
                            <span className="rounded-full bg-rose-500/15 border border-rose-500/30 px-2.5 py-0.5 text-xs font-bold text-rose-300">
                              горять
                            </span>
                          ) : (
                            <span className="rounded-full bg-purple-500/15 border border-purple-500/30 px-2.5 py-0.5 text-xs font-bold text-purple-200">
                              активні
                            </span>
                          )}
                        </div>

                        {/* Linked Email Status for Desktop Widget */}
                        {isLinked && linkedEmail ? (
                          <div className="mt-2.5 flex items-center justify-between text-xs text-sys-text-secondary bg-sys-bg/60 border border-sys-border/50 px-3 py-1.5 rounded-xl">
                            <span className="truncate">✓ Прив'язано: <strong className="text-sys-text-primary">{linkedEmail}</strong></span>
                            <button
                              type="button"
                              onClick={unlinkClassroom}
                              className="text-rose-400 hover:text-rose-300 font-medium ml-2 shrink-0 underline decoration-dotted text-[11px]"
                            >
                              від'єднати
                            </button>
                          </div>
                        ) : (
                          <div className="mt-2 text-xs text-sys-text-muted">
                            Всі завдання групи (пошта не прив'язана)
                          </div>
                        )}

                        <div className="mt-4 space-y-4">
                          {allWeekTasks.length > 0 ? (
                            <>
                              {/* Group 1: Overdue */}
                              {overdueTasks.length > 0 && (
                                <section>
                                  <div className="mb-2 flex items-center gap-2">
                                    <span className="h-2 w-2 rounded-full bg-rose-500 shadow-xs" />
                                    <h4 className="text-xs font-bold uppercase tracking-wider text-rose-400">
                                      Прострочено ({overdueTasks.length})
                                    </h4>
                                  </div>
                                  <div className="space-y-2">
                                    {overdueTasks.map((t, idx) => renderTaskCard(t, `sb-overdue-${idx}`))}
                                  </div>
                                </section>
                              )}

                              {/* Group 2: Active */}
                              {activeTasks.length > 0 && (
                                <section>
                                  <div className="mb-2 flex items-center gap-2">
                                    <span className="h-2 w-2 rounded-full bg-sys-accent shadow-xs" />
                                    <h4 className="text-xs font-bold uppercase tracking-wider text-sys-text-secondary">
                                      Активні ({activeTasks.length})
                                    </h4>
                                  </div>
                                  <div className="space-y-2">
                                    {activeTasks.map((t, idx) => renderTaskCard(t, `sb-active-${idx}`))}
                                  </div>
                                </section>
                              )}

                              {/* Group 3: No due date */}
                              {noDateTasks.length > 0 && (
                                <section>
                                  <div className="mb-2 flex items-center gap-2">
                                    <span className="h-2 w-2 rounded-full bg-slate-400 shadow-xs" />
                                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                                      Без терміну ({noDateTasks.length})
                                    </h4>
                                  </div>
                                  <div className="space-y-2">
                                    {noDateTasks.map((t, idx) => renderTaskCard(t, `sb-nodate-${idx}`))}
                                  </div>
                                </section>
                              )}

                              {/* Group 4: Turned In / Returned */}
                              {turnedInTasks.length > 0 && (
                                <section className="pt-1">
                                  <button
                                    type="button"
                                    onClick={() => setSidebarTurnedInOpen(!sidebarTurnedInOpen)}
                                    className="mb-2 flex w-full items-center justify-between text-left select-none p-1 rounded-lg hover:bg-white/5 transition-colors"
                                  >
                                    <div className="flex items-center gap-2">
                                      <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-xs" />
                                      <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                                        Здано ({turnedInTasks.length})
                                      </h4>
                                    </div>
                                    <span className="text-xs text-sys-text-muted">
                                      {sidebarTurnedInOpen ? "Згорнути ▴" : "Показати ▾"}
                                    </span>
                                  </button>
                                  {sidebarTurnedInOpen && (
                                    <div className="space-y-2 animate-in fade-in duration-150">
                                      {turnedInTasks.map((t, idx) => renderTaskCard(t, `sb-done-${idx}`))}
                                    </div>
                                  )}
                                </section>
                              )}
                            </>
                          ) : (
                            <div className="py-6 text-center">
                              <p className="text-sm text-sys-text-muted">
                                Немає активних завдань ✓
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                /* Desktop Week Mode: Full Grid (ScheduleWeekGrid) */
                <div className="w-full min-w-0">
                  <div className="mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl bg-sys-card p-3 sm:px-4 sm:py-3 border border-sys-border shadow-xs">
                    <div className="text-[13px] sm:text-sm font-medium text-sys-text-primary flex flex-wrap items-center gap-2">
                      <svg width="1.2em" height="1.2em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-sys-accent shrink-0"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                      <span className="font-bold text-sys-text-primary">{weekRange}</span>
                      {currentWeekNumber && (
                        <>
                          <span className="text-sys-text-muted">•</span>
                          <span className="text-sys-text-secondary font-medium">{currentWeekNumber} тиждень</span>
                        </>
                      )}
                      {weekType !== "both" && (
                        <>
                          <span className="text-sys-text-muted">•</span>
                          <span
                            title={
                              weekType === "numerator"
                                ? "Чисельник — непарний тиждень навчального графіка"
                                : "Знаменник — парний тиждень навчального графіка"
                            }
                            className="text-sys-text-secondary font-medium lowercase cursor-help underline decoration-dotted underline-offset-2"
                          >
                            {weekType === "numerator" ? "чисельник" : "знаменник"}
                          </span>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-2.5 shrink-0">
                      <button
                        type="button"
                        onClick={handleShareWeek}
                        title="Скопіювати розклад усього тижня для Telegram"
                        aria-label="Поділитися розкладом на тиждень"
                        className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-sys-border bg-sys-bg px-3 text-xs font-semibold text-sys-text-secondary hover:text-sys-accent hover:border-sys-accent/40 hover:bg-sys-accent/5 active:scale-95 transition-all"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                          <polyline points="16 6 12 2 8 6" />
                          <line x1="12" y1="2" x2="12" y2="15" />
                        </svg>
                        <span>Поділитися тижнем</span>
                      </button>
                    </div>
                  </div>
                  <motion.div
                    key={weekAnchorDate.toISOString()}
                    initial={{ opacity: 0, x: weekShiftDir > 0 ? 8 : weekShiftDir < 0 ? -8 : 0 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{
                      duration: shouldReduceMotion ? 0 : 0.18,
                      ease: [0.2, 0, 0, 1],
                    }}
                  >
                    <ScheduleWeekGrid
                      week={week}
                      scheduleMode={mode}
                      canEdit={false}
                      onQuickJump={handleQuickJump}
                    />
                  </motion.div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        )}
      </div>

      {/* Mobile Bottom Navigation */}
      <BottomNav
        activeTab={mobileMenuOpen ? "more" : mobileTab}
        onTabChange={(tab) => {
          if (tab === "more") {
            setMobileMenuOpen(true);
          } else {
            setMobileMenuOpen(false);
            setMobileTab(tab);
          }
        }}
        overdueCount={overdueCount}
      />

      {/* Week Type Bottom Sheet (Чисельник / Знаменник) */}
      <AnimatePresence>
        {weekTypeSheetOpen && (
          <motion.div
            key="weekTypeBackdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
            onClick={() => setWeekTypeSheetOpen(false)}
          >
            <motion.div
              key="weekTypeContent"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 26, stiffness: 300 }}
              className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl border border-sys-border bg-sys-card p-5 sm:p-6 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between pb-3 border-b border-sys-border/60">
                <h3 className="text-base font-bold text-sys-text-primary">
                  Тип тижня за графіком
                </h3>
                <button
                  type="button"
                  onClick={() => setWeekTypeSheetOpen(false)}
                  className="flex h-8 w-8 items-center justify-center rounded-xl border border-sys-border text-sys-text-secondary hover:text-white"
                >
                  ✕
                </button>
              </div>
              <div className="mt-4 space-y-3 text-sm text-sys-text-secondary leading-relaxed">
                <div className="rounded-xl border border-sys-border/60 bg-sys-bg/60 p-3.5">
                  <span className="font-bold text-sys-text-primary block mb-1">
                    {weekType === "numerator" ? "📘 Чисельник (непарний)" : "📙 Знаменник (парний)"}
                  </span>
                  <p className="text-xs text-sys-text-secondary">
                    {weekType === "numerator"
                      ? "Чисельник — це непарні тижні навчального семестру (1, 3, 5, 7…). Заняття чергуються за графіком коледжу."
                      : "Знаменник — це парні тижні навчального семестру (2, 4, 6, 8…). Заняття чергуються за графіком коледжу."}
                  </p>
                </div>
                {currentWeekNumber && (
                  <p className="text-xs text-sys-text-muted">
                    Поточний навчальний тиждень: <strong>{currentWeekNumber}-й тиждень</strong>.
                  </p>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
