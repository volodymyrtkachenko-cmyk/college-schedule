"use client";

import { startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { ReferenceRecord, ScheduleResponse } from "../../lib/api";
import { startTypedViewTransition } from "../../lib/viewTransition";
import {
  KYIV_DATE_FMT,
  formatKyivDateIso,
  getKyivInitialWeekAnchor,
  getKyivMaxPublicDateIso,
  getKyivTomorrowDateIso,
  getSyncedNow,
} from "../../lib/date";
import {
  addDaysToCalendarIso,
  calendarDateIsoToUtcDate,
  diffCalendarDays,
  getCalendarWeekdayMon0,
  getMondayCalendarIso,
} from "../../lib/calendarDate";
import { formatFullWeekRange } from "../../lib/format";
import { QuickJumpTarget, findGroupIdByName, findTeacherIdByName } from "../../lib/quickJump";
import {
  buildWeekDaysMini,
  canNavigateNextDayDate,
  canNavigateNextWeekDate,
  canNavigatePrevDayDate,
  canNavigatePrevWeekDate,
  computeCurrentWeekNumber,
  computeHeaderLearningMode,
  formatCompactWeekRange,
  getActualTodayIndex,
  getEveningSelectedDayIndex,
  getKyivWeekday,
  isEveningAfterLessonsTime,
  resolveDisplayDaySchedule,
  resolveWeekType,
} from "../../lib/schedule";
import { toTeacherSlug } from "../../lib/slug";
import { useMobileNav } from "../../lib/useMobileNav";
import { useRecentSelections } from "../../lib/useRecentSelections";
import { getPeriodMeta } from "../SchedulePeriodCard";

const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

const DESKTOP_MORPH_MQ =
  "(min-width: 1024px) and (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)";

function canUseDesktopMorphTransition(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof document !== "undefined" &&
    "startViewTransition" in document &&
    window.matchMedia(DESKTOP_MORPH_MQ).matches
  );
}

function clearDayDeckMarkers() {
  if (typeof document === "undefined") return;
  document.querySelectorAll<HTMLElement>(".vt-day-deck-card, .vt-day-deck-header, .vt-day-fallback-stage").forEach((el) => {
    el.classList.remove("vt-day-deck-card", "vt-day-deck-header", "vt-day-fallback-stage");
    el.style.removeProperty("view-transition-name");
  });
}

function tagActiveDayDeck(): number {
  const stage = document.querySelector<HTMLElement>(".vt-schedule-day-stage");
  if (!stage) return 0;

  const header = stage.querySelector<HTMLElement>("[data-day-vt-header='1']");
  if (header) {
    header.style.viewTransitionName = "day-header";
    header.classList.add("vt-day-deck-header");
  }

  const cards = Array.from(stage.querySelectorAll<HTMLElement>("article")).slice(0, 7);
  if (cards.length === 0) {
    stage.style.viewTransitionName = "schedule-day-stage";
    stage.classList.add("vt-day-fallback-stage");
    return 0;
  }

  cards.forEach((card, idx) => {
    card.style.viewTransitionName = `day-slot-${idx}`;
    card.classList.add("vt-day-deck-card");
  });
  return cards.length;
}

function markVtRevealedNodes() {
  if (typeof document === "undefined") return;
  document
    .querySelectorAll(".vt-main-content :is(.desktop-view-enter, .desktop-day-slide, .desktop-stagger-card, .week-grid-enter)")
    .forEach((el) => {
      (el as HTMLElement).dataset.vtRevealed = "1";
    });
}

let daySlideSeq = 0;

function runDesktopDayTransition(
  currentView: "today" | "week",
  direction: "next" | "prev",
  commitUpdate: () => void,
) {
  if (
    currentView !== "today" ||
    !canUseDesktopMorphTransition() ||
    !document.querySelector(".vt-schedule-day-stage")
  ) {
    commitUpdate();
    return;
  }

  clearDayDeckMarkers();
  const seq = ++daySlideSeq;
  let cleanupTimer: number | null = null;
  document.documentElement.dataset.vtDayDir = direction;

  const finishCleanup = () => {
    if (cleanupTimer !== null) {
      window.clearTimeout(cleanupTimer);
      cleanupTimer = null;
    }
    if (daySlideSeq === seq) {
      delete document.documentElement.dataset.vtDayDir;
      clearDayDeckMarkers();
    }
  };

  tagActiveDayDeck();
  cleanupTimer = window.setTimeout(finishCleanup, 600);

  startTypedViewTransition(
    [direction === "next" ? "day-next" : "day-prev"],
    () => {
      flushSync(commitUpdate);
      tagActiveDayDeck();
      markVtRevealedNodes();
    },
    {
      kind: "day-slide",
      onFinish: finishCleanup,
    },
  );
}

function resolveClockDate(ssrNowIso?: string): Date {
  if (ssrNowIso) {
    const parsed = new Date(ssrNowIso);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return getSyncedNow();
}

export interface ReturnTarget {
  mode: "student" | "teacher";
  id: number;
  label: string;
}

export function useWeekAnchor(ssrNowIso?: string) {
  const [nowRefDate, setNowRefDate] = useState<Date>(() => resolveClockDate(ssrNowIso));
  const [weekAnchorDate, setWeekAnchorDate] = useState<Date>(() =>
    getKyivInitialWeekAnchor(resolveClockDate(ssrNowIso))
  );
  const lastActiveDateRef = useRef<string>(KYIV_DATE_FMT.format(resolveClockDate(ssrNowIso)));

  useIsomorphicLayoutEffect(() => {
    const liveNow = getSyncedNow();
    const liveIso = KYIV_DATE_FMT.format(liveNow);
    const liveAnchor = getKyivInitialWeekAnchor(liveNow);
    setNowRefDate(liveNow);
    if (liveIso !== lastActiveDateRef.current) {
      const ssrAnchor = getKyivInitialWeekAnchor(resolveClockDate(ssrNowIso));
      lastActiveDateRef.current = liveIso;
      setWeekAnchorDate((prev) =>
        Math.abs(prev.getTime() - ssrAnchor.getTime()) < 1000 * 60 * 60 * 24 ? liveAnchor : prev
      );
    }
  }, [ssrNowIso]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        const liveNow = getSyncedNow();
        const todayStr = KYIV_DATE_FMT.format(liveNow);
        if (todayStr !== lastActiveDateRef.current) {
          lastActiveDateRef.current = todayStr;
          setNowRefDate(liveNow);
          setWeekAnchorDate((prev) => {
            const currentAnchor = getKyivInitialWeekAnchor(liveNow);
            const wasCurrentWeek = Math.abs(prev.getTime() - currentAnchor.getTime()) < 1000 * 60 * 60 * 24 * 7;
            return wasCurrentWeek ? currentAnchor : prev;
          });
        }
      }
    };
    window.addEventListener("visibilitychange", handleVisibility);
    return () => window.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  const isCurrentWeek = useMemo(() => {
    const currentAnchor = getKyivInitialWeekAnchor(nowRefDate);
    return formatKyivDateIso(weekAnchorDate) === formatKyivDateIso(currentAnchor);
  }, [weekAnchorDate, nowRefDate]);

  const weekStartStr = useMemo(
    () => formatKyivDateIso(weekAnchorDate),
    [weekAnchorDate]
  );

  return { weekAnchorDate, setWeekAnchorDate, isCurrentWeek, weekStartStr };
}

interface UseScheduleSelectionParams {
  weekAnchorDate: Date;
  setWeekAnchorDate: React.Dispatch<React.SetStateAction<Date>>;
  isCurrentWeek: boolean;
  mode: "student" | "teacher";
  toggleMode: (target: "student" | "teacher") => void;
  groups: ReferenceRecord[];
  groupId: number | null;
  setGroupId: (id: number) => void;
  teachers: ReferenceRecord[];
  teacherId: number | null;
  setTeacherId: (id: number) => void;
  today: ScheduleResponse | null;
  week: ScheduleResponse[];
  semesterStart: string | null;
  loading: boolean;
  completeSetup: () => void;
  isSetupComplete?: boolean;
  isPrivilegedUser: boolean;
  setToast: (msg: string, type?: "success" | "error" | "info") => void;
  ssrNowIso?: string;
  initialGroupId?: number;
  initialTeacherId?: number;
  initialMode?: "student" | "teacher";
}

export function useScheduleSelection({
  weekAnchorDate,
  setWeekAnchorDate,
  isCurrentWeek,
  mode,
  toggleMode,
  groups,
  groupId,
  setGroupId,
  teachers,
  teacherId,
  setTeacherId,
  today,
  week,
  semesterStart,
  loading,
  completeSetup,
  isSetupComplete = false,
  isPrivilegedUser,
  setToast,
  ssrNowIso,
  initialGroupId,
  initialTeacherId,
  initialMode,
}: UseScheduleSelectionParams) {
  const [daySlideDir, setDaySlideDir] = useState<number>(0);
  const [weekSlideDir, setWeekSlideDir] = useState<number>(0);
  const [clockNow, setClockNow] = useState<Date>(() => resolveClockDate(ssrNowIso));
  const selectedTeacher = useMemo(
    () => teachers.find((t) => t.id === teacherId) || null,
    [teachers, teacherId]
  );

  const minDateIso = isPrivilegedUser ? null : (semesterStart ?? null);
  const maxDateIso = useMemo(
    () => (isPrivilegedUser ? null : getKyivMaxPublicDateIso(clockNow)),
    [isPrivilegedUser, clockNow]
  );

  const canNavigatePrevWeek = useMemo(
    () => canNavigatePrevWeekDate(weekAnchorDate, minDateIso),
    [weekAnchorDate, minDateIso]
  );
  const canNavigateNextWeek = useMemo(
    () => canNavigateNextWeekDate(weekAnchorDate, maxDateIso),
    [weekAnchorDate, maxDateIso]
  );

  const shiftWeek = useCallback(
    (offset: number) => {
      if (offset < 0 && !canNavigatePrevWeek) return;
      if (offset > 0 && !canNavigateNextWeek) return;
      setWeekSlideDir(offset > 0 ? 1 : -1);
      startTransition(() => {
        setWeekAnchorDate((date) => {
          const next = new Date(date);
          next.setDate(next.getDate() + offset * 7);
          return next;
        });
      });
    },
    [canNavigatePrevWeek, canNavigateNextWeek, setWeekAnchorDate]
  );

  const [view, setView] = useState<"today" | "week">("today");
  const [isFocusMode, setIsFocusMode] = useState<boolean>(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("desktop_focus_mode");
      if (saved !== null) {
        setIsFocusMode(saved === "true");
      }
      if (window.innerWidth >= 1024) {
        const defaultDesktop = (localStorage.getItem("schedule:default_view_desktop") as "week" | "today") || "today";
        setView(defaultDesktop);
      } else {
        setView("today");
      }
    } catch {}

    const handleSettingsChange = (e: Event) => {
      try {
        const customEvt = e as CustomEvent<{ key?: string; value?: unknown }>;
        if (!customEvt?.detail || customEvt.detail.key !== "defaultViewDesktop") return;
        if (window.innerWidth >= 1024) {
          const defaultDesktop = (customEvt.detail.value as "week" | "today") || "today";
          setView(defaultDesktop);
        }
      } catch {}
    };

    window.addEventListener("schedule-settings-change", handleSettingsChange);
    return () => window.removeEventListener("schedule-settings-change", handleSettingsChange);
  }, []);

  const toggleFocusMode = useCallback(() => {
    setIsFocusMode((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("desktop_focus_mode", String(next));
      } catch {}
      return next;
    });
  }, []);

  const exitFocusMode = useCallback(() => {
    setIsFocusMode(false);
    try {
      localStorage.setItem("desktop_focus_mode", "false");
    } catch {}
  }, []);

  const {
    homeTab: mobileTab,
    setHomeTab: setMobileTab,
    setOverdueCount,
    setHideTasksTab,
    setScheduleMode,
    urlSearch,
  } = useMobileNav();
  const isFocusEffective = isFocusMode || mode === "teacher";

  const [tasksTabMounted, setTasksTabMounted] = useState(() => mobileTab === "tasks");
  if (mobileTab === "tasks" && !tasksTabMounted) {
    setTasksTabMounted(true);
  }

  useEffect(() => {
    setHideTasksTab(mode === "teacher");
  }, [mode, setHideTasksTab]);

  useEffect(() => {
    setScheduleMode(mode);
  }, [mode, setScheduleMode]);

  useEffect(() => {
    const pendingStudentOverride =
      new URLSearchParams(urlSearch).get("mode") === "student";
    if (mode === "teacher" && mobileTab === "tasks" && !pendingStudentOverride) {
      setMobileTab("schedule");
    }
  }, [mode, mobileTab, setMobileTab, urlSearch]);

  const lastSyncedSearchRef = useRef<string | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const rawSearch = urlSearch || window.location.search.replace(/^\?/, "");
    if (lastSyncedSearchRef.current === rawSearch) return;
    lastSyncedSearchRef.current = rawSearch;
    if (!rawSearch) return;
    try {
      const params = new URLSearchParams(rawSearch);
      const urlMode = params.get("mode");
      const urlTab = params.get("tab");
      if (urlMode === "teacher" || urlMode === "student") {
        toggleMode(urlMode);
      }
      if (urlTab === "tasks" || urlTab === "schedule") {
        setMobileTab(urlTab);
      }
    } catch {}
  }, [urlSearch, toggleMode, setMobileTab]);

  const { recentGroupIds, recentTeacherIds, recordRecentGroup, recordRecentTeacher } = useRecentSelections();

  useEffect(() => {
    if (groupId) recordRecentGroup(groupId);
  }, [groupId, recordRecentGroup]);

  useEffect(() => {
    if (teacherId) recordRecentTeacher(teacherId);
  }, [teacherId, recordRecentTeacher]);

  // Auto-scroll to live card on mobile after schedule finishes loading
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

  const syncBrowserUrl = useCallback(
    (targetMode: "student" | "teacher", id: number) => {
      if (typeof window === "undefined") return;
      if (targetMode === "student") {
        const g = groups.find((item) => item.id === id);
        if (g) {
          window.history.pushState(null, "", `/group/${encodeURIComponent(g.name)}`);
          document.title = `Розклад групи ${g.name} ДФКР | Розклад ДФКР`;
        }
      } else {
        const t = teachers.find((item) => item.id === id);
        if (t) {
          window.history.pushState(null, "", `/teacher/${toTeacherSlug(t.name)}`);
          document.title = `Розклад викладача ${t.name} — ДФКР | Розклад ДФКР`;
        }
      }
    },
    [groups, teachers]
  );

  // Sync slug URL & document.title for returning users on "/" and on /group/... or /teacher/... routes;
  // leave "/" and its SSR title untouched before onboarding so Googlebot indexes the canonical homepage.
  useEffect(() => {
    if (typeof document === "undefined" || typeof window === "undefined") return;

    const currentPath = window.location.pathname;
    if (currentPath === "/") {
      let setupStored = false;
      try {
        setupStored = window.localStorage.getItem("schedule:setupComplete") === "1";
      } catch {}
      if (!isSetupComplete || !setupStored) return;
    }

    let targetPath: string | null = null;
    let targetTitle: string | null = null;

    if (mode === "student") {
      const g = groups.find((item) => item.id === groupId);
      if (g) {
        targetPath = `/group/${encodeURIComponent(g.name)}`;
        targetTitle = `Розклад групи ${g.name} ДФКР | Розклад ДФКР`;
      }
    } else {
      const t = teachers.find((item) => item.id === teacherId);
      if (t) {
        targetPath = `/teacher/${toTeacherSlug(t.name)}`;
        targetTitle = `Розклад викладача ${t.name} — ДФКР | Розклад ДФКР`;
      }
    }

    if (!targetPath || !targetTitle) return;

    const nextUrl = `${targetPath}${window.location.search}${window.location.hash}`;

    if (currentPath === "/") {
      window.history.replaceState(null, "", nextUrl);
      document.title = targetTitle;
      return;
    }

    if (currentPath === targetPath) {
      document.title = targetTitle;
      return;
    }

    const onGroupRoute = currentPath.startsWith("/group/");
    const onTeacherRoute = currentPath.startsWith("/teacher/");
    const modeMatchesRoute =
      (mode === "student" && onGroupRoute) || (mode === "teacher" && onTeacherRoute);

    if (!modeMatchesRoute) {
      const searchMode = new URLSearchParams(window.location.search).get("mode");
      if (searchMode === mode) {
        window.history.replaceState(null, "", nextUrl);
        document.title = targetTitle;
      }
      return;
    }

    if (onGroupRoute) {
      const seg = currentPath.slice("/group/".length).split("/")[0] || "";
      let decoded = seg;
      try {
        decoded = decodeURIComponent(seg);
      } catch {}
      if (groups.some((g) => g.name.toLowerCase() === decoded.toLowerCase())) {
        window.history.replaceState(null, "", nextUrl);
      }
    } else if (onTeacherRoute) {
      const seg = currentPath.slice("/teacher/".length).split("/")[0] || "";
      let decoded = seg;
      try {
        decoded = decodeURIComponent(seg);
      } catch {}
      if (teachers.some((t) => toTeacherSlug(t.name) === decoded.toLowerCase())) {
        window.history.replaceState(null, "", nextUrl);
      }
    }

    document.title = targetTitle;
  }, [isSetupComplete, mode, groupId, teacherId, groups, teachers]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handlePopState = () => {
      const path = window.location.pathname;
      if (path === "/") {
        document.title = "Розклад ДФКР";
        return;
      }
      const groupMatch = path.match(/^\/group\/([^/]+)/);
      if (groupMatch) {
        const raw = decodeURIComponent(groupMatch[1]);
        const matched = groups.find((g) => g.name.toLowerCase() === raw.toLowerCase());
        if (matched && matched.id !== groupId) {
          toggleMode("student");
          setGroupId(matched.id);
        }
        return;
      }
      const teacherMatch = path.match(/^\/teacher\/([^/]+)/);
      if (teacherMatch) {
        const rawSlug = decodeURIComponent(teacherMatch[1]);
        const matched = teachers.find((t) => toTeacherSlug(t.name) === rawSlug);
        if (matched && matched.id !== teacherId) {
          toggleMode("teacher");
          setTeacherId(matched.id);
        }
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [groups, teachers, groupId, teacherId, toggleMode, setGroupId, setTeacherId]);

  const handleSelectContextOption = useCallback(
    (tab: "student" | "teacher", id: number) => {
      toggleMode(tab);
      if (tab === "student") {
        setGroupId(id);
        recordRecentGroup(id);
      } else {
        setTeacherId(id);
        recordRecentTeacher(id);
      }
      syncBrowserUrl(tab, id);
    },
    [toggleMode, setGroupId, setTeacherId, recordRecentGroup, recordRecentTeacher, syncBrowserUrl]
  );

  const handleCompleteWelcome = useCallback(
    (selectedMode: "student" | "teacher", id: number) => {
      handleSelectContextOption(selectedMode, id);
      completeSetup();
    },
    [handleSelectContextOption, completeSetup]
  );

  const [returnTarget, setReturnTarget] = useState<ReturnTarget | null>(null);
  const initialReturnCheckedRef = useRef(false);

  // When deep-linking to another group/teacher route (e.g. from Atlas), show a one-tap return banner
  // back to the user's saved home schedule without overwriting localStorage.
  useEffect(() => {
    if (initialReturnCheckedRef.current) return;
    if (!initialGroupId && !initialTeacherId) {
      initialReturnCheckedRef.current = true;
      return;
    }
    if (typeof window === "undefined") return;
    if (groups.length === 0 && teachers.length === 0) return;

    try {
      const setupComplete = window.localStorage.getItem("schedule:setupComplete") === "1";
      const storedModeRaw = window.localStorage.getItem("schedule:mode");
      const savedGroupId = Number(window.localStorage.getItem("schedule:groupId")) || null;
      const savedTeacherId = Number(window.localStorage.getItem("schedule:teacherId")) || null;
      if (!setupComplete) {
        initialReturnCheckedRef.current = true;
        return;
      }

      const savedMode: "student" | "teacher" = storedModeRaw === "teacher" ? "teacher" : "student";
      const savedId = savedMode === "teacher" ? savedTeacherId : savedGroupId;
      if (!savedId) return;

      const list = savedMode === "teacher" ? teachers : groups;
      if (list.length === 0) return;

      const savedEntity = list.find((item) => item.id === savedId);
      initialReturnCheckedRef.current = true;
      if (!savedEntity) return;

      const activeMode = initialMode ?? mode;
      const activeId =
        activeMode === "teacher" ? (initialTeacherId ?? teacherId) : (initialGroupId ?? groupId);
      if (savedMode !== activeMode || savedId !== activeId) {
        setReturnTarget({
          mode: savedMode,
          id: savedId,
          label: savedEntity.name,
        });
      }
    } catch {
      initialReturnCheckedRef.current = true;
    }
  }, [initialGroupId, initialTeacherId, initialMode, mode, groupId, teacherId, groups, teachers]);

  const handleQuickJump = useCallback(
    (target: QuickJumpTarget) => {
      let targetId = target.id;
      if (!targetId && target.name) {
        targetId =
          target.mode === "student"
            ? findGroupIdByName(target.name, groups)
            : findTeacherIdByName(target.name, teachers);
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
      handleSelectContextOption(target.mode, targetId);
    },
    [groups, teachers, mode, groupId, teacherId, setToast, handleSelectContextOption]
  );

  const handleReturnBack = useCallback(() => {
    if (!returnTarget) return;
    handleSelectContextOption(returnTarget.mode, returnTarget.id);
    setReturnTarget(null);
  }, [returnTarget, handleSelectContextOption]);

  const currentName =
    mode === "student"
      ? groups.find((g) => g.id === groupId)?.name
      : teachers.find((t) => t.id === teacherId)?.name;

  const currentWeekNumber = useMemo(
    () => computeCurrentWeekNumber(semesterStart, weekAnchorDate),
    [semesterStart, weekAnchorDate]
  );

  const weekType = useMemo(
    () => resolveWeekType(week, currentWeekNumber, isCurrentWeek, today?.week_type),
    [week, currentWeekNumber, isCurrentWeek, today?.week_type]
  );

  const { displayDaySchedule } = useMemo(
    () => resolveDisplayDaySchedule(today, week),
    [today, week]
  );

  // SSR uses injected Kyiv reference clock; live clock and post-15:20 evening advance sync on client
  const [selectedDayIndex, setSelectedDayIndex] = useState<number>(() =>
    getActualTodayIndex(resolveClockDate(ssrNowIso))
  );

  useIsomorphicLayoutEffect(() => {
    const syncLiveClock = () => {
      const liveNow = getSyncedNow();
      setClockNow(liveNow);
      if (ssrNowIso) {
        const ssrDate = resolveClockDate(ssrNowIso);
        if (KYIV_DATE_FMT.format(ssrDate) !== KYIV_DATE_FMT.format(liveNow)) {
          const ssrIdx = getActualTodayIndex(ssrDate);
          const liveIdx = getActualTodayIndex(liveNow);
          setSelectedDayIndex((prev) => (prev === ssrIdx ? liveIdx : prev));
        }
      }
    };
    syncLiveClock();
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        setClockNow(getSyncedNow());
      }
    };
    window.addEventListener("visibilitychange", onVisible);
    return () => window.removeEventListener("visibilitychange", onVisible);
  }, [ssrNowIso]);

  useEffect(() => {
    const eveningIdx = getEveningSelectedDayIndex(getSyncedNow());
    if (eveningIdx !== null) {
      setSelectedDayIndex(eveningIdx);
    }
  }, []);

  const activeDayDate = useMemo(
    () => addDaysToCalendarIso(formatKyivDateIso(weekAnchorDate), selectedDayIndex),
    [weekAnchorDate, selectedDayIndex]
  );

  const todayActualIso = useMemo(() => KYIV_DATE_FMT.format(clockNow), [clockNow]);
  const tomorrowActualIso = useMemo(() => getKyivTomorrowDateIso(clockNow), [clockNow]);
  const isEveningAfterLessons = useMemo(() => isEveningAfterLessonsTime(clockNow), [clockNow]);

  const resetScroll = useCallback(() => {
    if (typeof window !== "undefined" && window.scrollY > 0) {
      window.scrollTo({ top: 0, behavior: "instant" });
    }
  }, []);

  const handleSelectDayIndex = useCallback(
    (idx: number) => {
      if (idx === selectedDayIndex) return;
      const targetIso = addDaysToCalendarIso(formatKyivDateIso(weekAnchorDate), idx);
      if ((minDateIso && targetIso < minDateIso) || (maxDateIso && targetIso > maxDateIso)) return;
      const dir = idx > selectedDayIndex ? "next" : "prev";
      runDesktopDayTransition(view, dir, () => {
        setDaySlideDir(dir === "next" ? 1 : -1);
        setSelectedDayIndex(idx);
      });
      resetScroll();
    },
    [view, selectedDayIndex, weekAnchorDate, minDateIso, maxDateIso, resetScroll]
  );

  const canNavigatePrevDay = useMemo(
    () => canNavigatePrevDayDate(weekAnchorDate, selectedDayIndex, minDateIso),
    [weekAnchorDate, selectedDayIndex, minDateIso]
  );
  const canNavigateNextDay = useMemo(
    () => canNavigateNextDayDate(weekAnchorDate, selectedDayIndex, maxDateIso),
    [weekAnchorDate, selectedDayIndex, maxDateIso]
  );

  const goToPrevDay = useCallback(() => {
    if (!canNavigatePrevDay) return;
    runDesktopDayTransition(view, "prev", () => {
      if (selectedDayIndex > 0) {
        setDaySlideDir(-1);
        setSelectedDayIndex((prev) => prev - 1);
      } else {
        setDaySlideDir(-1);
        setWeekSlideDir(-1);
        setWeekAnchorDate((prev) =>
          calendarDateIsoToUtcDate(addDaysToCalendarIso(formatKyivDateIso(prev), -7))
        );
        setSelectedDayIndex(4);
      }
    });
    resetScroll();
  }, [view, canNavigatePrevDay, selectedDayIndex, setWeekAnchorDate, resetScroll]);

  const goToNextDay = useCallback(() => {
    if (!canNavigateNextDay) return;
    runDesktopDayTransition(view, "next", () => {
      if (selectedDayIndex < 4) {
        setDaySlideDir(1);
        setSelectedDayIndex((prev) => prev + 1);
      } else {
        setDaySlideDir(1);
        setWeekSlideDir(1);
        setWeekAnchorDate((prev) =>
          calendarDateIsoToUtcDate(addDaysToCalendarIso(formatKyivDateIso(prev), 7))
        );
        setSelectedDayIndex(0);
      }
    });
    resetScroll();
  }, [view, canNavigateNextDay, selectedDayIndex, setWeekAnchorDate, resetScroll]);

  const shiftWeekPreservingDay = useCallback(
    (offset: number) => {
      if (offset < 0 && !canNavigatePrevWeek) return;
      if (offset > 0 && !canNavigateNextWeek) return;
      const dir = offset > 0 ? "next" : "prev";
      const commit = () => {
        setWeekSlideDir(offset > 0 ? 1 : -1);
        setDaySlideDir(offset > 0 ? 1 : -1);
        setWeekAnchorDate((prev) =>
          calendarDateIsoToUtcDate(addDaysToCalendarIso(formatKyivDateIso(prev), offset * 7))
        );
      };
      if (view === "today" && offset !== 0) {
        runDesktopDayTransition(view, dir, commit);
      } else {
        startTransition(commit);
      }
      resetScroll();
    },
    [view, canNavigatePrevWeek, canNavigateNextWeek, setWeekAnchorDate, resetScroll]
  );

  const resetWeekPreservingDay = useCallback(() => {
    const currentAnchor = getKyivInitialWeekAnchor(getSyncedNow());
    const diffDays = diffCalendarDays(formatKyivDateIso(currentAnchor), formatKyivDateIso(weekAnchorDate));
    const commit = () => {
      setWeekSlideDir(diffDays === 0 ? 0 : diffDays > 0 ? 1 : -1);
      setWeekAnchorDate(currentAnchor);
    };
    if (view === "today" && diffDays !== 0) {
      runDesktopDayTransition(view, diffDays > 0 ? "next" : "prev", commit);
    } else {
      startTransition(commit);
    }
    resetScroll();
  }, [view, weekAnchorDate, setWeekAnchorDate, resetScroll]);

  const handleJumpToToday = useCallback(() => {
    const liveNow = getSyncedNow();
    const currentAnchor = getKyivInitialWeekAnchor(liveNow);
    const nextIdx = getActualTodayIndex(liveNow);
    const targetIso = addDaysToCalendarIso(formatKyivDateIso(currentAnchor), nextIdx);
    const diffDays = diffCalendarDays(formatKyivDateIso(currentAnchor), formatKyivDateIso(weekAnchorDate));
    const commit = () => {
      setWeekSlideDir(diffDays === 0 ? 0 : diffDays > 0 ? 1 : -1);
      setWeekAnchorDate(currentAnchor);
      setSelectedDayIndex(nextIdx);
      setDaySlideDir(0);
    };
    if (view === "today" && targetIso !== activeDayDate) {
      runDesktopDayTransition(view, targetIso > activeDayDate ? "next" : "prev", commit);
    } else {
      startTransition(commit);
    }
    resetScroll();
  }, [view, activeDayDate, weekAnchorDate, setWeekAnchorDate, resetScroll]);

  const handleJumpToTomorrow = useCallback(() => {
    const liveNow = getSyncedNow();
    const currentAnchor = getKyivInitialWeekAnchor(liveNow);
    const dow = getKyivWeekday(liveNow);
    const nextIdx = dow >= 1 && dow <= 4 ? dow : selectedDayIndex;
    const targetIso = addDaysToCalendarIso(formatKyivDateIso(currentAnchor), nextIdx);
    const diffDays = diffCalendarDays(formatKyivDateIso(currentAnchor), formatKyivDateIso(weekAnchorDate));
    const commit = () => {
      setWeekSlideDir(diffDays === 0 ? 0 : diffDays > 0 ? 1 : -1);
      setWeekAnchorDate(currentAnchor);
      if (dow >= 1 && dow <= 4) {
        setSelectedDayIndex(dow);
      }
      setDaySlideDir(0);
    };
    if (view === "today" && targetIso !== activeDayDate) {
      runDesktopDayTransition(view, targetIso > activeDayDate ? "next" : "prev", commit);
    } else {
      startTransition(commit);
    }
    resetScroll();
  }, [view, activeDayDate, selectedDayIndex, weekAnchorDate, setWeekAnchorDate, resetScroll]);

  const handleDatePickerSelect = useCallback(
    (target: string | Date) => {
      const targetIso = typeof target === "string" ? target : formatKyivDateIso(target);
      if ((minDateIso && targetIso < minDateIso) || (maxDateIso && targetIso > maxDateIso)) return;
      const newAnchorIso = getMondayCalendarIso(targetIso);
      const newAnchor = calendarDateIsoToUtcDate(newAnchorIso);
      const kyivDowMon0 = getCalendarWeekdayMon0(targetIso);
      const nextIdx = kyivDowMon0 < 5 ? kyivDowMon0 : 0;
      const effectiveTargetIso = addDaysToCalendarIso(newAnchorIso, nextIdx);
      const diffDays = diffCalendarDays(newAnchorIso, formatKyivDateIso(weekAnchorDate));
      const commit = () => {
        setWeekSlideDir(diffDays === 0 ? 0 : diffDays > 0 ? 1 : -1);
        setWeekAnchorDate(newAnchor);
        setSelectedDayIndex(nextIdx);
        setDaySlideDir(0);
      };
      if (view === "today" && effectiveTargetIso !== activeDayDate) {
        runDesktopDayTransition(view, effectiveTargetIso > activeDayDate ? "next" : "prev", commit);
      } else {
        startTransition(commit);
      }
      resetScroll();
    },
    [view, activeDayDate, minDateIso, maxDateIso, weekAnchorDate, setWeekAnchorDate, resetScroll]
  );

  const handleViewChange = useCallback(
    (nextView: "today" | "week") => {
      try {
        sessionStorage.setItem("schedule:view", nextView);
        localStorage.setItem("schedule:view", nextView);
      } catch {}
      if (nextView === view) return;
      setView(nextView);
      resetScroll();
    },
    [view, resetScroll]
  );

  const handleSelectDayFromWeek = useCallback(
    (_targetDate: string, dayIdx: number) => {
      try {
        sessionStorage.setItem("schedule:view", "today");
        localStorage.setItem("schedule:view", "today");
      } catch {}
      setDaySlideDir(0);
      setSelectedDayIndex(dayIdx);
      setView("today");
      resetScroll();
    },
    [resetScroll]
  );

  const resetWeek = useCallback(() => {
    const currentAnchor = getKyivInitialWeekAnchor(getSyncedNow());
    const diffDays = diffCalendarDays(formatKyivDateIso(currentAnchor), formatKyivDateIso(weekAnchorDate));
    setWeekSlideDir(diffDays === 0 ? 0 : diffDays > 0 ? 1 : -1);
    startTransition(() => setWeekAnchorDate(currentAnchor));
  }, [weekAnchorDate, setWeekAnchorDate]);

  const activeWeekPeriodMeta = useMemo(() => {
    const p = week?.find((d) => d.period_info)?.period_info;
    return p ? getPeriodMeta(p) : null;
  }, [week]);

  const isWeekend = [0, 6].includes(getKyivWeekday(clockNow));
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

  const weekRange = useMemo(() => formatFullWeekRange(weekAnchorDate), [weekAnchorDate]);
  const compactWeekRange = useMemo(() => formatCompactWeekRange(weekAnchorDate), [weekAnchorDate]);
  const weekDaysMini = useMemo(() => buildWeekDaysMini(weekAnchorDate), [weekAnchorDate]);
  const headerLearningModeData = useMemo(
    () =>
      computeHeaderLearningMode({
        view,
        week,
        selectedDaySchedule,
        todayActualIso,
      }),
    [view, week, selectedDaySchedule, todayActualIso]
  );

  return {
    daySlideDir,
    weekSlideDir,
    selectedTeacher,
    minDateIso,
    maxDateIso,
    canNavigatePrevWeek,
    canNavigateNextWeek,
    canNavigatePrevDay,
    canNavigateNextDay,
    shiftWeek,
    view,
    handleViewChange,
    isFocusMode,
    toggleFocusMode,
    exitFocusMode,
    isFocusEffective,
    mobileTab,
    setOverdueCount,
    tasksTabMounted,
    recentGroupIds,
    recentTeacherIds,
    returnTarget,
    handleSelectContextOption,
    handleCompleteWelcome,
    handleQuickJump,
    handleReturnBack,
    currentName,
    currentWeekNumber,
    weekType,
    selectedDayIndex,
    handleSelectDayIndex,
    activeDayDate,
    todayActualIso,
    tomorrowActualIso,
    isEveningAfterLessons,
    isWeekend,
    isAutoSelectedWeekendDay,
    selectedDaySchedule,
    activeWeekPeriodMeta,
    headerLearningModeData,
    weekRange,
    compactWeekRange,
    weekDaysMini,
    goToPrevDay,
    goToNextDay,
    shiftWeekPreservingDay,
    resetWeekPreservingDay,
    handleJumpToToday,
    handleJumpToTomorrow,
    handleDatePickerSelect,
    handleSelectDayFromWeek,
    resetWeek,
  };
}
