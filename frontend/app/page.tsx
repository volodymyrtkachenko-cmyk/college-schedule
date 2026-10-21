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
import { useTaskGroups, formatTaskWord, TaskFilterState, DEFAULT_TASK_FILTERS } from "../lib/useTaskGroups";
import { TaskFilters } from "../components/TaskFilters";
import { SearchableSelect } from "../components/SearchableSelect";
import { ClassroomSyncButton } from "../components/ClassroomSyncButton";
import { extractClassroomTasks, parseTaskDeadline, sortTasksByDeadline, TaskDeadline, UKR_MONTHS_SHORT, pluralDays } from "../components/LessonCard";
import { useToast } from "../components/ToastProvider";
import { QuickJumpTarget, findGroupIdByName, findTeacherIdByName } from "../lib/quickJump";
import { extractClassroomTaskKey, isOwnTask, useClassroomSubmissions } from "../lib/useClassroomSubmissions";
import { shareWeekScheduleAsImage } from "../lib/shareImage";

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
  const [sidebarTaskFilters, setSidebarTaskFilters] = useState<TaskFilterState>(DEFAULT_TASK_FILTERS);
  const [sidebarFiltersOpen, setSidebarFiltersOpen] = useState(false);
  const sidebarFiltersActive = sidebarTaskFilters.status !== "all" || sidebarTaskFilters.subject !== "";
  const [classroomTasks, setClassroomTasks] = useState<Array<{
    id: string;
    title: string;
    alternate_link?: string;
    url?: string;
    due_date: string | null;
    due_time?: string | null;
    creation_time?: string | null;
    created_at?: string | null;
    course_name: string;
    state: string;
    assigned_grade?: number | null;
    max_points?: number | null;
  }>>([]);
  const [classroomLastSyncedAt, setClassroomLastSyncedAt] = useState<string | null>(null);
  const { linkedEmail, isLinked, submissions, personalTeachers, unlink: unlinkClassroom } = useClassroomSubmissions();
  const [tasksScope, setTasksScope] = useState<"week" | "all">("week");
  const [sidebarPastWeekOpen, setSidebarPastWeekOpen] = useState(true);
  const [sidebarUserToggledOverdue, setSidebarUserToggledOverdue] = useState<boolean | null>(null);
  const sidebarOverdueOpen = sidebarUserToggledOverdue !== null ? sidebarUserToggledOverdue : isLinked;
  const [sidebarActiveOpen, setSidebarActiveOpen] = useState(true);
  const [sidebarNoDateOpen, setSidebarNoDateOpen] = useState(false);
  const [sidebarTurnedInOpen, setSidebarTurnedInOpen] = useState(false);

  const formattedSyncTime = useMemo(() => {
    if (!classroomLastSyncedAt) return null;
    try {
      const d = new Date(classroomLastSyncedAt);
      if (isNaN(d.getTime())) return null;
      return new Intl.DateTimeFormat("uk-UA", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/Kyiv",
      }).format(d);
    } catch {
      return null;
    }
  }, [classroomLastSyncedAt]);

  const fetchClassroomTasks = useCallback(async (gid: number) => {
    try {
      const res = await api.classroom.groupStatus(gid);
      if (res?.tasks && res.tasks.length > 0) {
        setClassroomTasks(res.tasks);
        try {
          localStorage.setItem(`schedule:classroom_tasks:${gid}`, JSON.stringify(res.tasks));
        } catch {}
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
      try {
        const cached = localStorage.getItem(`schedule:classroom_tasks:${groupId}`);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed)) setClassroomTasks(parsed);
        }
      } catch {}
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
    const handleClassroomSynced = (e: Event) => {
      const customEvent = e as CustomEvent;
      const detail = customEvent?.detail;
      if (detail?.tasks && Array.isArray(detail.tasks) && detail.tasks.length > 0) {
        setClassroomTasks(detail.tasks);
        try {
          const gid = detail.group_id ?? groupId;
          if (gid) localStorage.setItem(`schedule:classroom_tasks:${gid}`, JSON.stringify(detail.tasks));
        } catch {}
      }
      if (detail?.last_synced_at) {
        setClassroomLastSyncedAt(detail.last_synced_at);
      } else if (groupId) {
        void fetchClassroomTasks(groupId);
      }
    };
    window.addEventListener("classroom-synced", handleClassroomSynced);
    return () => window.removeEventListener("classroom-synced", handleClassroomSynced);
  }, [groupId, fetchClassroomTasks]);

  useEffect(() => {
    try {
      const sessionSaved = sessionStorage.getItem("schedule:view");
      if (sessionSaved === "week" && window.innerWidth >= 1024) {
        setView("week");
        return;
      }
      if (sessionSaved === "today") {
        setView("today");
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

  const currentWeekNumber = useMemo(() => {
    if (!semesterStart) return null;
    const start = new Date(semesterStart);
    const diffTime = weekAnchorDate.getTime() - getMondayOf(start).getTime();
    const diffWeeks = Math.floor(diffTime / (7 * 24 * 60 * 60 * 1000)) + 1;
    return diffWeeks > 0 ? diffWeeks : null;
  }, [semesterStart, weekAnchorDate]);

  const weekType = useMemo(() => {
    if (week && week.length > 0 && week[0]?.week_type && week[0].week_type !== "both") {
      return week[0].week_type;
    }
    if (currentWeekNumber) {
      return currentWeekNumber % 2 === 1 ? "numerator" : "denominator";
    }
    if (isCurrentWeek && today?.week_type && today.week_type !== "both") {
      return today.week_type;
    }
    return today?.week_type ?? "both";
  }, [week, currentWeekNumber, isCurrentWeek, today?.week_type]);

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

  const getKyivWeekday = (d: Date): number => {
    const short = new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/Kyiv",
      weekday: "short",
    }).format(d);
    const map: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };
    return map[short] ?? d.getDay();
  };

  const getActualTodayIndex = (): number => {
    const now = new Date();
    const dow = getKyivWeekday(now);
    if (dow >= 1 && dow <= 5) return dow - 1;
    return 0;
  };

  const getInitialDayIndex = (): number => {
    const now = new Date();
    const dow = getKyivWeekday(now);
    if (dow === 0 || dow === 6) return 0;
    const kyivHour = Number(
      new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Kyiv", hour: "2-digit", hour12: false }).format(now)
    );
    const kyivMin = Number(
      new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Kyiv", minute: "2-digit" }).format(now)
    );
    const totalMins = kyivHour * 60 + kyivMin;
    if (dow >= 1 && dow <= 4 && totalMins >= 15 * 60 + 20) {
      return dow;
    }
    return dow - 1;
  };

  const [selectedDayIndex, setSelectedDayIndex] = useState<number>(getInitialDayIndex);
  const [showAllDayTasks, setShowAllDayTasks] = useState(false);
  const [dismissTomorrowBanner, setDismissTomorrowBanner] = useState(false);
  const [dismissTodayBanner, setDismissTodayBanner] = useState(false);

  const activeDayDate = useMemo(() => {
    const d = new Date(weekAnchorDate);
    d.setDate(weekAnchorDate.getDate() + selectedDayIndex);
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(d);
  }, [weekAnchorDate, selectedDayIndex]);

  const todayActualIso = useMemo(() => {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(new Date());
  }, []);

  const tomorrowActualIso = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(d);
  }, []);

  const isEveningAfterLessons = useMemo(() => {
    const now = new Date();
    const dow = getKyivWeekday(now);
    if (dow < 1 || dow > 4) return false;
    const kyivHour = Number(
      new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Kyiv", hour: "2-digit", hour12: false }).format(now)
    );
    const kyivMin = Number(
      new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Kyiv", minute: "2-digit" }).format(now)
    );
    const totalMins = kyivHour * 60 + kyivMin;
    return totalMins >= 15 * 60 + 20;
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
    setSelectedDayIndex(getActualTodayIndex());
    setDaySlideDir(0);
    resetScroll();
  };

  const handleJumpToTomorrow = () => {
    const currentAnchor = getInitialAnchor();
    setWeekAnchorDate(currentAnchor);
    const now = new Date();
    const dow = now.getDay();
    if (dow >= 1 && dow <= 4) {
      setSelectedDayIndex(dow);
    }
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

  const isViewingTomorrow = isCurrentWeek && selectedDaySchedule?.date === tomorrowActualIso;
  const isViewingToday = isCurrentWeek && selectedDaySchedule?.date === todayActualIso;

  const weekRange = useMemo(() => {
    const end = new Date(weekAnchorDate);
    end.setDate(end.getDate() + 6);
    const startOpts: Intl.DateTimeFormatOptions = { day: "numeric", month: "long" };
    if (weekAnchorDate.getFullYear() !== end.getFullYear()) startOpts.year = "numeric";
    return `${new Intl.DateTimeFormat("uk-UA", startOpts).format(weekAnchorDate)} – ${new Intl.DateTimeFormat("uk-UA", { day: "numeric", month: "long", year: "numeric" }).format(end)}`;
  }, [weekAnchorDate]);

  const resetWeek = () => setWeekAnchorDate(getInitialAnchor());

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
        setToast("Розклад усього тижня скопійовано!", "success");
      }
    } catch {
      setToast("Не вдалося скопіювати розклад", "error");
    }
  };

  const [sharingWeekImage, setSharingWeekImage] = useState(false);

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

      const result = await shareWeekScheduleAsImage(
        week,
        mode,
        ownerLabel,
        weekRange,
        currentWeekNumber
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


  const headerLearningMode = useMemo(() => {
    if (view !== "week") {
      return selectedDaySchedule?.learning_mode ?? null;
    }
    if (!week || week.length === 0) return null;
    const todayInWeek = week.find((d) => d.date === todayActualIso);
    if (todayInWeek?.learning_mode) return todayInWeek.learning_mode;
    if (selectedDaySchedule?.learning_mode) return selectedDaySchedule.learning_mode;
    return week.find((d) => d.learning_mode)?.learning_mode ?? null;
  }, [view, week, selectedDaySchedule, todayActualIso]);

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

  const allTasks = useMemo<FullTaskItem[]>(() => {
    const tasks: FullTaskItem[] = [];
    const seenUrls = new Set<string>();

    const boundUrls = new Set<string>();
    if (week && week.length > 0) {
      for (const d of week) {
        if (!d.lessons) continue;
        for (const l of d.lessons) {
          const extracted = extractClassroomTasks(l.note);
          for (const t of extracted) {
            if (t.url) boundUrls.add(t.url);
          }
        }
      }
    }

    // 1. Спочатку збираємо завдання, прив'язані до пар ЦЬОГО тижня
    if (week && week.length > 0) {
      for (const d of week) {
        if (!d.lessons) continue;
        for (const l of d.lessons) {
          const extracted = extractClassroomTasks(l.note);
          for (const t of extracted) {
            if (!t.url) continue;
            if (isLinked && !isOwnTask(isLinked, submissions, t.url, t.teacher || l.teacher_name, personalTeachers, t.title)) {
              continue;
            }
            if (!seenUrls.has(t.url)) {
              seenUrls.add(t.url);

              const key = extractClassroomTaskKey(t.url);
              const personalSub = isLinked ? (submissions[t.url] || (key ? submissions[key] : null)) : null;
              const effectiveState = personalSub ? personalSub.state : "NEW";
              const effectiveGrade = personalSub ? (personalSub.grade ?? null) : null;
              const effectiveMaxPoints = personalSub ? (personalSub.maxPoints ?? null) : null;
              const isDone = isLinked && (effectiveState === "TURNED_IN" || effectiveState === "RETURNED");

              let deadline = t.deadline;
              if (isDone) {
                deadline = {
                  ...t.deadline,
                  isOverdue: false,
                  statusText: effectiveState === "RETURNED" && effectiveGrade != null ? `Оцінка: ${effectiveGrade}/${effectiveMaxPoints || 100}` : "Здано",
                  badgeTone: "normal",
                };
              }

              const dueIso = t.deadline.date
                ? new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(t.deadline.date)
                : null;

              tasks.push({
                title: t.title || "Завдання",
                subject: l.subject_name || l.subject,
                teacher: t.teacher || l.teacher_name || l.teacher,
                label: t.label,
                url: t.url,
                deadline,
                state: effectiveState,
                assignedGrade: effectiveGrade,
                maxPoints: effectiveMaxPoints,
                dueDateIso: dueIso,
                isBoundToWeek: true,
              });
            }
          }
        }
      }
    }

    // 2. Додаємо завдання з Classroom API (щоб вони ніколи не зникали)
    if (classroomTasks && classroomTasks.length > 0) {
      for (const ct of classroomTasks) {
        const url = ct.alternate_link || (ct as any).url;
        if (!url || seenUrls.has(url)) continue;
        if (isLinked && !isOwnTask(isLinked, submissions, url, (ct as any).teacher, personalTeachers, ct.title)) {
          continue;
        }
        seenUrls.add(url);

        const key = extractClassroomTaskKey(url);
        const personalSub = isLinked ? (submissions[url] || (key ? submissions[key] : null)) : null;
        const effectiveState = personalSub ? personalSub.state : "NEW";
        const effectiveGrade = personalSub ? (personalSub.grade ?? null) : null;
        const effectiveMaxPoints = personalSub ? (personalSub.maxPoints ?? null) : null;
        const isDone = isLinked && (effectiveState === "TURNED_IN" || effectiveState === "RETURNED");

        let deadline: TaskDeadline;
        if (ct.due_date) {
          const parts = ct.due_date.split("-");
          deadline = parseTaskDeadline(`до ${parts[2]}.${parts[1]}`);
          if (isDone) {
            deadline.isOverdue = false;
            deadline.statusText = effectiveState === "RETURNED" && effectiveGrade != null ? `Оцінка: ${effectiveGrade}/${effectiveMaxPoints || 100}` : "Здано";
            deadline.badgeTone = "normal";
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
            statusText: isDone ? (effectiveState === "RETURNED" && effectiveGrade != null ? `Оцінка: ${effectiveGrade}/${effectiveMaxPoints || 100}` : "Здано") : "",
            badgeTone: "normal",
          };
        }

        tasks.push({
          id: ct.id,
          title: ct.title || "Завдання",
          subject: ct.course_name,
          label: ct.due_date ? `до ${ct.due_date}` : "",
          url,
          deadline,
          state: effectiveState,
          assignedGrade: effectiveGrade,
          maxPoints: effectiveMaxPoints,
          dueDateIso: ct.due_date,
          isBoundToWeek: boundUrls.has(url),
        });
      }
    }

    return sortTasksByDeadline(tasks);
  }, [week, classroomTasks, isLinked, submissions]);

  const allWeekTasks = allTasks;

  const sidebarTaskGroups = useTaskGroups(
    allTasks,
    tasksScope,
    weekAnchorDate,
    currentWeekNumber,
    isLinked,
    sidebarTaskFilters
  );

  const overdueCount = useMemo(() => {
    return sidebarTaskGroups.overdueTasks.length + sidebarTaskGroups.pastWeekTasks.length;
  }, [sidebarTaskGroups.overdueTasks, sidebarTaskGroups.pastWeekTasks]);

  const overdueTasks = sidebarTaskGroups.overdueTasks;
  const activeTasks = sidebarTaskGroups.activeTasks;
  const noDateTasks = sidebarTaskGroups.noDateTasks;
  const turnedInTasks = sidebarTaskGroups.turnedInTasks;

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
              <span className="text-sys-text-muted text-xs ml-auto shrink-0">▼</span>
            </button>

            {/* Star Pin */}
            {currentId && (
              <button
                type="button"
                onClick={togglePinCurrent}
                title={isCurrentPinned ? "Прибрати із закріплених" : "Закріпити розклад"}
                aria-label={isCurrentPinned ? "Відкріпити розклад" : "Закріпити розклад"}
                aria-pressed={isCurrentPinned}
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border text-base transition-colors ${
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
                  (view === "today" && isCurrentWeek && (selectedDaySchedule?.date === todayActualIso || (isWeekend && selectedDayIndex === 0))) ||
                  (view === "week" && isCurrentWeek)
                }
                aria-label="Перейти на сьогодні"
                title="Перейти на сьогодні"
                className={`px-3.5 h-10 rounded-lg font-medium transition-colors ${
                  (view === "today" && isCurrentWeek && (selectedDaySchedule?.date === todayActualIso || (isWeekend && selectedDayIndex === 0))) ||
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
            {headerLearningMode && (
              <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-bold ${
                headerLearningMode === "offline"
                  ? "border-sys-accent/30 bg-sys-accent/10 text-sys-accent"
                  : "border-sys-warning/30 bg-sys-warning/10 text-sys-warning"
              }`}>
                {headerLearningMode === "offline" ? "Очно" : "Дистанційно"}
              </span>
            )}
          </div>

          {/* Right Zone: Favorites, Classroom, Action menu */}
          <div className="flex items-center gap-2 justify-self-end">
            {/* Classroom button */}
            {mode === "student" && groupId && (
              <ClassroomSyncButton
                currentGroupId={groupId}
                weekStart={weekStartStr}
                onSynced={(detectedId, tasks, lastSynced) => {
                  if (detectedId && detectedId !== groupId) {
                    setGroupId(detectedId);
                  }
                  if (tasks && Array.isArray(tasks)) {
                    setClassroomTasks(tasks);
                  }
                  if (lastSynced) {
                    setClassroomLastSyncedAt(lastSynced);
                  }
                }}
              />
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
            <span className="text-sys-text-muted text-xs shrink-0">▼</span>
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
                className="flex flex-wrap items-center justify-center gap-1 text-xs text-sys-text-muted hover:text-sys-text-secondary -mt-0.5 leading-none py-0.5"
              >
                {currentWeekNumber ? <span>{currentWeekNumber} тиждень</span> : null}
                {weekType !== "both" && (
                  <>
                    {currentWeekNumber ? <span>·</span> : null}
                    <span className="underline decoration-dotted underline-offset-2">
                      {weekType === "numerator" ? "чисельник" : "знаменник"}
                    </span>
                    <span className="text-xs">ⓘ</span>
                  </>
                )}
                {headerLearningMode && (
                  <>
                    {(currentWeekNumber || weekType !== "both") && <span>·</span>}
                    <span
                      className={`font-bold ${
                        headerLearningMode === "offline" ? "text-sys-accent" : "text-sys-warning"
                      }`}
                    >
                      {headerLearningMode === "offline" ? "Очно" : "Дистанційно"}
                    </span>
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
                  <span className="mb-1 block text-xs font-semibold text-sys-text-secondary">Режим перегляду</span>
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
                  <span className="mb-1 block text-xs font-semibold text-sys-text-secondary">Закріплені</span>
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
                  <span className="mb-1 block text-xs font-semibold text-sys-text-secondary">Формат розкладу</span>
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
                    {isCurrentPinned && <span className="text-xs text-amber-400 font-bold">Збережено</span>}
                  </button>
                )}

                {/* Share week image */}
                <button
                  type="button"
                  role="menuitem"
                  disabled={sharingWeekImage}
                  onClick={() => {
                    setMobileMenuOpen(false);
                    void handleShareWeekImage();
                  }}
                  className="flex items-center justify-between rounded-xl border border-sys-border/60 bg-sys-bg/60 px-3 py-2 text-xs font-semibold text-sys-text-primary hover:border-sys-accent/40 disabled:opacity-50"
                >
                  <span className="flex items-center gap-2">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400">
                      <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
                      <circle cx="9" cy="9" r="2" />
                      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
                    </svg>
                    <span>Зберегти картинку тижня</span>
                  </span>
                  <span className="text-sys-text-muted">PNG</span>
                </button>

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

                {/* Google Account / Classroom Status & Unlink (Section 17.3) */}
                <div className="flex items-center justify-between rounded-xl border border-sys-border/60 bg-sys-bg/60 px-3 py-2 text-xs">
                  <div className="flex flex-col min-w-0 pr-2">
                    <span className="text-xs font-semibold text-sys-text-secondary">Google-акаунт</span>
                    {isLinked && linkedEmail ? (
                      <span className="font-medium text-sys-text-primary truncate">{linkedEmail}</span>
                    ) : (
                      <span className="text-slate-400 text-xs">Не прив&apos;язано</span>
                    )}
                  </div>
                  {isLinked ? (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        unlinkClassroom();
                        setMobileMenuOpen(false);
                      }}
                      className="shrink-0 rounded-lg bg-white/5 hover:bg-white/10 px-2.5 py-1 text-xs font-medium text-rose-300 hover:text-rose-200 transition-colors cursor-pointer"
                    >
                      Від&apos;єднати
                    </button>
                  ) : (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMobileMenuOpen(false);
                        window.dispatchEvent(new CustomEvent("trigger-classroom-sync"));
                      }}
                      className="shrink-0 rounded-lg bg-sky-500/20 hover:bg-sky-500/30 border border-sky-500/40 px-2.5 py-1 text-xs font-semibold text-sky-300 transition-colors cursor-pointer"
                    >
                      Прив&apos;язати
                    </button>
                  )}
                </div>
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
              className="shrink-0 rounded-lg bg-sys-accent px-2.5 py-1 text-xs font-semibold text-[#0b1120] active:scale-[0.98]"
            >
              ← До {returnTarget.label}
            </button>
          </div>
        )}

        {mobileTab === "tasks" ? (
          <MobileTasksView
            tasks={allTasks}
            groupId={groupId}
            weekStart={weekStartStr}
            weekAnchorDate={weekAnchorDate}
            weekNumber={currentWeekNumber}
            onPrevWeek={() => shiftWeekPreservingDay(-1)}
            onNextWeek={() => shiftWeekPreservingDay(1)}
            tasksScope={tasksScope}
            onTasksScopeChange={setTasksScope}
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
                tomorrowDate={tomorrowActualIso}
                scheduleMode={mode}
                canEdit={false}
                onQuickJump={handleQuickJump}
                onNextDay={goToNextDay}
                onPrevDay={goToPrevDay}
                onJumpToToday={handleJumpToToday}
                onJumpToTomorrow={handleJumpToTomorrow}
                daySlideDir={daySlideDir}
                shouldReduceMotion={shouldReduceMotion ?? false}
                isWeekend={isAutoSelectedWeekendDay}
                isShowingTomorrow={isEveningAfterLessons && isCurrentWeek}
                weekNumber={currentWeekNumber}
              />
            ) : (
              <ScheduleWeekGrid
                week={week}
                scheduleMode={mode}
                canEdit={false}
                onQuickJump={handleQuickJump}
                weekNumber={currentWeekNumber}
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


                      <ScheduleDay
                        schedule={selectedDaySchedule ?? today!}
                        isToday={selectedDaySchedule?.date === todayActualIso && !isWeekend}
                        scheduleMode={mode}
                        onQuickJump={handleQuickJump}
                        hideHeaderOnMobile={false}
                        weekNumber={currentWeekNumber}
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
                        <div className="pb-3 border-b border-sys-border/50">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-purple-400">
                                <path d="M16 4h2a2 2 0 0 1 2 2v14l-8-4-8 4V6a2 2 0 0 1 2-2h2" />
                                <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
                              </svg>
                              <span className="text-sm font-bold uppercase tracking-wider text-sys-text-primary">
                                Завдання Classroom
                              </span>
                            </div>
                          </div>

                          <div className="mt-1 flex items-center gap-2">
                            <p className="text-xs text-sys-text-secondary">
                              {tasksScope === "week"
                                ? `${sidebarTaskGroups.totalCount} ${formatTaskWord(sidebarTaskGroups.totalCount)} на цьому тижні`
                                : `${sidebarTaskGroups.totalCount} ${formatTaskWord(sidebarTaskGroups.totalCount)} загалом`}
                            </p>
                            {formattedSyncTime && (
                              <>
                                <span className="text-slate-600 text-xs">•</span>
                                <span className="text-xs text-sys-text-muted">
                                  дані від {formattedSyncTime}
                                </span>
                              </>
                            )}
                          </div>

                          {/* Week Switcher & Scope Segment (Section 22.1) */}
                          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-sys-border/30">
                            <div className={`inline-flex items-center gap-0.5 rounded-xl border border-sys-border bg-sys-bg px-1 py-0.5 text-xs shadow-xs transition-opacity ${tasksScope === "week" ? "" : "opacity-50"}`}>
                              <button
                                type="button"
                                disabled={tasksScope !== "week"}
                                onClick={() => shiftWeekPreservingDay(-1)}
                                aria-label="Попередній тиждень"
                                className="flex h-6 w-6 items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-white/5 active:scale-95 transition-all cursor-pointer disabled:cursor-default disabled:hover:bg-transparent font-bold"
                              >
                                ‹
                              </button>
                              <span className="px-1.5 font-semibold text-sys-text-primary whitespace-nowrap text-xs">
                                {sidebarTaskGroups.weekLabel}
                              </span>
                              <button
                                type="button"
                                disabled={tasksScope !== "week"}
                                onClick={() => shiftWeekPreservingDay(1)}
                                aria-label="Наступний тиждень"
                                className="flex h-6 w-6 items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-white/5 active:scale-95 transition-all cursor-pointer disabled:cursor-default disabled:hover:bg-transparent font-bold"
                              >
                                ›
                              </button>
                            </div>

                            <div className="inline-flex items-center rounded-xl border border-sys-border bg-sys-bg p-0.5 text-xs shadow-xs">
                              <button
                                type="button"
                                onClick={() => setTasksScope("week")}
                                className={`rounded-lg px-2 py-0.5 font-semibold transition-all cursor-pointer ${
                                  tasksScope === "week"
                                    ? "bg-sys-accent text-[#0b1120] shadow-xs"
                                    : "text-sys-text-secondary hover:text-white"
                                }`}
                              >
                                Цей тиждень
                              </button>
                              <button
                                type="button"
                                onClick={() => setTasksScope("all")}
                                className={`rounded-lg px-2 py-0.5 font-semibold transition-all cursor-pointer ${
                                  tasksScope === "all"
                                    ? "bg-sys-accent text-[#0b1120] shadow-xs"
                                    : "text-sys-text-secondary hover:text-white"
                                }`}
                              >
                                Усі
                              </button>
                            </div>
                          </div>
                        </div>

                        {/* Unlinked Prompt Banner (Section 17.2) */}
                        {!isLinked && (
                          <div className="mt-3 rounded-xl border border-sky-500/30 bg-sky-500/10 p-3 text-xs text-sys-text-secondary">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-start gap-1.5 min-w-0">
                                <span className="text-sky-400 font-bold shrink-0">ⓘ</span>
                                <span className="leading-snug text-slate-200">
                                  Це завдання всієї групи. Прив&apos;яжи пошту, щоб бачити, що ти вже здав.
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  window.dispatchEvent(new CustomEvent("trigger-classroom-sync"));
                                }}
                                className="shrink-0 rounded-lg bg-sky-500/25 hover:bg-sky-500/35 border border-sky-500/40 px-2.5 py-1 text-xs font-semibold text-sky-200 transition-colors cursor-pointer"
                              >
                                Прив&apos;язати
                              </button>
                            </div>
                            <p className="text-xs text-slate-400 mt-1 pl-4">
                              Сервер лише читає ваші завдання з Classroom і нічого не змінює.
                            </p>
                          </div>
                        )}

                        {allTasks.length > 0 && (
                          <div className="mt-3">
                            <button
                              type="button"
                              onClick={() => setSidebarFiltersOpen((v) => !v)}
                              aria-expanded={sidebarFiltersOpen || sidebarFiltersActive}
                              className="flex items-center gap-1.5 text-xs font-semibold text-sys-text-secondary hover:text-white cursor-pointer"
                            >
                              Фільтри
                              {sidebarFiltersActive && <span className="h-1.5 w-1.5 rounded-full bg-sys-accent" />}
                              <span>{sidebarFiltersOpen || sidebarFiltersActive ? "▴" : "▾"}</span>
                            </button>
                            {(sidebarFiltersOpen || sidebarFiltersActive) && (
                              <div className="mt-2">
                                <TaskFilters
                                  tasks={allTasks}
                                  value={sidebarTaskFilters}
                                  onChange={setSidebarTaskFilters}
                                  isLinked={isLinked}
                                />
                              </div>
                            )}
                          </div>
                        )}

                        <div className="mt-4 space-y-4">
                          {sidebarTaskGroups.totalCount > 0 ? (
                            <>
                              {/* Group 0: Past weeks uncompleted overdue tasks (Section 22.1) */}
                              {tasksScope === "week" && sidebarTaskGroups.pastWeekTasks.length > 0 && (
                                <section>
                                  <button
                                    type="button"
                                    onClick={() => setSidebarPastWeekOpen(!(sidebarPastWeekOpen || sidebarTaskFilters.status === "overdue"))}
                                    className="mb-2 flex w-full items-center justify-between text-left select-none p-1 rounded-lg hover:bg-white/5 transition-colors cursor-pointer"
                                    aria-expanded={sidebarPastWeekOpen || sidebarTaskFilters.status === "overdue"}
                                  >
                                    <div className="flex items-center gap-2">
                                      <span className={`h-2 w-2 rounded-full shadow-xs ${isLinked ? "bg-rose-500" : "bg-slate-500"}`} />
                                      <h4 className={`text-xs font-bold uppercase tracking-wider ${isLinked ? "text-rose-400" : "text-slate-400"}`}>
                                        З минулих тижнів ({sidebarTaskGroups.pastWeekTasks.length})
                                      </h4>
                                    </div>
                                    <span className="text-xs text-sys-text-muted">
                                      {sidebarPastWeekOpen || sidebarTaskFilters.status === "overdue" ? "Згорнути ▴" : "Показати ▾"}
                                    </span>
                                  </button>
                                  {(sidebarPastWeekOpen || sidebarTaskFilters.status === "overdue") && (
                                    <div className="space-y-2 animate-in fade-in duration-150">
                                      {sidebarTaskGroups.pastWeekTasks.map((t, idx) => renderTaskCard(t, `sb-past-${idx}`, isLinked))}
                                    </div>
                                  )}
                                </section>
                              )}

                              {/* Group 1: Overdue or Past due */}
                              {sidebarTaskGroups.overdueTasks.length > 0 && (
                                <section>
                                  <button
                                    type="button"
                                    onClick={() => setSidebarUserToggledOverdue(!sidebarOverdueOpen)}
                                    className="mb-2 flex w-full items-center justify-between text-left select-none p-1 rounded-lg hover:bg-white/5 transition-colors cursor-pointer"
                                    aria-expanded={sidebarOverdueOpen}
                                  >
                                    <div className="flex items-center gap-2">
                                      <span
                                        className={`h-2 w-2 rounded-full shadow-xs ${
                                          isLinked ? "bg-rose-500" : "bg-slate-500"
                                        }`}
                                      />
                                      <h4
                                        className={`text-xs font-bold uppercase tracking-wider ${
                                          isLinked ? "text-rose-400" : "text-slate-400"
                                        }`}
                                      >
                                        {isLinked
                                          ? `Прострочено (${sidebarTaskGroups.overdueTasks.length})`
                                          : `Термін минув (${sidebarTaskGroups.overdueTasks.length})`}
                                      </h4>
                                    </div>
                                    <span className="text-xs text-sys-text-muted">
                                      {sidebarOverdueOpen ? "Згорнути ▴" : "Показати ▾"}
                                    </span>
                                  </button>
                                  {sidebarOverdueOpen && (
                                    <div className="space-y-2 animate-in fade-in duration-150">
                                      {sidebarTaskGroups.overdueTasks.map((t, idx) => renderTaskCard(t, `sb-overdue-${idx}`, isLinked))}
                                    </div>
                                  )}
                                </section>
                              )}

                              {/* Group 2: Active */}
                              {sidebarTaskGroups.activeTasks.length > 0 && (
                                <section>
                                  <button
                                    type="button"
                                    onClick={() => setSidebarActiveOpen(!sidebarActiveOpen)}
                                    className="mb-2 flex w-full items-center justify-between text-left select-none p-1 rounded-lg hover:bg-white/5 transition-colors cursor-pointer"
                                    aria-expanded={sidebarActiveOpen}
                                  >
                                    <div className="flex items-center gap-2">
                                      <span className="h-2 w-2 rounded-full bg-sys-accent shadow-xs" />
                                      <h4 className="text-xs font-bold uppercase tracking-wider text-sys-text-secondary">
                                        Активні ({sidebarTaskGroups.activeTasks.length})
                                      </h4>
                                    </div>
                                    <span className="text-xs text-sys-text-muted">
                                      {sidebarActiveOpen ? "Згорнути ▴" : "Показати ▾"}
                                    </span>
                                  </button>
                                  {sidebarActiveOpen && (
                                    <div className="space-y-2 animate-in fade-in duration-150">
                                      {sidebarTaskGroups.activeTasks.map((t, idx) => renderTaskCard(t, `sb-active-${idx}`, isLinked))}
                                    </div>
                                  )}
                                </section>
                              )}

                              {/* Group 3: No due date */}
                              {sidebarTaskGroups.noDateTasks.length > 0 && (
                                <section>
                                  <button
                                    type="button"
                                    onClick={() => setSidebarNoDateOpen(!sidebarNoDateOpen)}
                                    className="mb-2 flex w-full items-center justify-between text-left select-none p-1 rounded-lg hover:bg-white/5 transition-colors cursor-pointer"
                                    aria-expanded={sidebarNoDateOpen}
                                  >
                                    <div className="flex items-center gap-2">
                                      <span className="h-2 w-2 rounded-full bg-slate-400 shadow-xs" />
                                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                                        Без терміну ({sidebarTaskGroups.noDateTasks.length})
                                      </h4>
                                    </div>
                                    <span className="text-xs text-sys-text-muted">
                                      {sidebarNoDateOpen ? "Згорнути ▴" : "Показати ▾"}
                                    </span>
                                  </button>
                                  {sidebarNoDateOpen && (
                                    <div className="space-y-2 animate-in fade-in duration-150">
                                      {sidebarTaskGroups.noDateTasks.map((t, idx) => renderTaskCard(t, `sb-nodate-${idx}`, isLinked))}
                                    </div>
                                  )}
                                </section>
                              )}

                              {/* Empty state when only turned-in tasks exist (Section 22.2) */}
                              {sidebarTaskGroups.isOnlyTurnedIn && sidebarTaskFilters.status !== "done" && (
                                <div className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-950/20 px-3.5 py-2.5 text-xs text-emerald-400 font-medium select-none shadow-xs">
                                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-emerald-400">
                                    <polyline points="20 6 9 17 4 12" />
                                  </svg>
                                  <span>Нічого не горить</span>
                                </div>
                              )}

                              {/* Group 4: Turned In / Returned */}
                              {sidebarTaskGroups.turnedInTasks.length > 0 && (
                                <section className="pt-1">
                                  <button
                                    type="button"
                                    onClick={() => setSidebarTurnedInOpen(!(sidebarTurnedInOpen || sidebarTaskFilters.status === "done"))}
                                    className="mb-2 flex w-full items-center justify-between text-left select-none p-1 rounded-lg hover:bg-white/5 transition-colors cursor-pointer"
                                    aria-expanded={sidebarTurnedInOpen || sidebarTaskFilters.status === "done"}
                                  >
                                    <div className="flex items-center gap-2">
                                      <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-xs" />
                                      <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                                        Здано ({sidebarTaskGroups.turnedInTasks.length})
                                      </h4>
                                    </div>
                                    <span className="text-xs text-sys-text-muted">
                                      {sidebarTurnedInOpen || sidebarTaskFilters.status === "done" ? "Згорнути ▴" : "Показати ▾"}
                                    </span>
                                  </button>
                                  {(sidebarTurnedInOpen || sidebarTaskFilters.status === "done") && (
                                    <div className="space-y-2 animate-in fade-in duration-150">
                                      {sidebarTaskGroups.turnedInTasks.map((t, idx) => renderTaskCard(t, `sb-done-${idx}`, isLinked))}
                                    </div>
                                  )}
                                </section>
                              )}
                            </>
                          ) : (
                            <div className="py-8 text-center text-sys-text-muted">
                              <p className="text-sm font-semibold text-sys-text-primary">
                                {tasksScope === "week" ? "На цьому тижні завдань немає" : "Завдань немає"}
                              </p>
                              {tasksScope === "week" && (
                                <button
                                  type="button"
                                  onClick={() => setTasksScope("all")}
                                  className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-sys-accent/15 border border-sys-accent/30 px-3.5 py-1.5 text-xs font-semibold text-sys-accent hover:bg-sys-accent/25 transition-colors cursor-pointer"
                                >
                                  Переглянути всі
                                </button>
                              )}
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
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => void handleShareWeekImage()}
                        disabled={sharingWeekImage}
                        title="Скопіювати або зберегти розклад тижня як PNG-картинку"
                        aria-label="Поділитися картинкою розкладу тижня"
                        className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-sys-border bg-sys-bg px-3 text-xs font-semibold text-sys-text-secondary hover:text-sys-accent hover:border-sys-accent/40 hover:bg-sys-accent/5 active:scale-95 transition-all disabled:opacity-50"
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
                        className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-sys-border bg-sys-bg px-3 text-xs font-semibold text-sys-text-secondary hover:text-sys-accent hover:border-sys-accent/40 hover:bg-sys-accent/5 active:scale-95 transition-all"
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                          <polyline points="16 6 12 2 8 6" />
                          <line x1="12" y1="2" x2="12" y2="15" />
                        </svg>
                        <span>Поділитися</span>
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
        overdueCount={isLinked ? overdueCount : 0}
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
                <div className="pt-2 border-t border-sys-border/40 space-y-2">
                  <button
                    type="button"
                    onClick={() => {
                      shiftWeekPreservingDay(1);
                      setWeekTypeSheetOpen(false);
                    }}
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-sys-tabActive border border-sys-border px-4 py-2.5 text-xs font-semibold text-sys-text-primary hover:border-sys-accent hover:text-sys-accent active:scale-[0.98] transition-all"
                  >
                    <span>Перейти на {weekType === "numerator" ? "знаменник (наступний тиждень)" : "чисельник (наступний тиждень)"}</span>
                    <span>→</span>
                  </button>
                  {!isCurrentWeek && (
                    <button
                      type="button"
                      onClick={() => {
                        resetWeekPreservingDay();
                        setWeekTypeSheetOpen(false);
                      }}
                      className="w-full flex items-center justify-center gap-1.5 rounded-xl border border-transparent py-1.5 text-xs font-medium text-sys-accent hover:underline active:scale-[0.98]"
                    >
                      Повернутися до поточного тижня
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
