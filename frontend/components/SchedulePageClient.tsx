"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;
import dynamic from "next/dynamic";
import { useReducedMotion } from "framer-motion";
import { canAccessAdmin, useAuth } from "../lib/auth";
import { ReferenceRecord } from "../lib/api";
import { invalidateScheduleCache, useSchedule } from "../lib/hooks";
import { resolveScheduleSubtabFromSearch } from "../lib/navigation";
import type { SubjectHubTarget } from "../lib/schedule";
import { useMobileNav } from "../lib/useMobileNav";
import { useTeacherAccess } from "../lib/useTeacherAccess";
import { useTheme } from "../lib/useTheme";
import { useUserSettings } from "../lib/useUserSettings";
import { useViewportTier } from "../lib/useViewportTier";
import { DayPager } from "./DayPager";
import { MobileWeekDaysStrip } from "./MobileWeekDaysStrip";
import { OfflineIndicator } from "./OfflineIndicator";
import { ScheduleDay } from "./ScheduleDay";
import { SplashScreen } from "./SplashScreen";
import { useToast } from "./ToastProvider";
import { WeekTypeBadge } from "./WeekTypeBadge";
import { ContextSelectionModal } from "./schedule/ContextSelectionModal";
import { DesktopFocusDaySwitcher } from "./schedule/DesktopFocusDaySwitcher";
import { DesktopScheduleSidebar } from "./schedule/DesktopScheduleSidebar";
import { DesktopToolbar } from "./schedule/DesktopToolbar";
import { DesktopWeekHeaderBar } from "./schedule/DesktopWeekHeaderBar";
import { MobileChrome } from "./schedule/MobileChrome";
import { ScheduleErrorState, ScheduleLoadingSkeleton } from "./schedule/ScheduleStateCards";
import { WeekTypeBottomSheet } from "./schedule/WeekTypeBottomSheet";
import { useKeyboardScheduleNav } from "./schedule/useKeyboardScheduleNav";
import { useScheduleDataFetch } from "./schedule/useScheduleDataFetch";
import { useScheduleSelection, useWeekAnchor } from "./schedule/useScheduleSelection";

const WelcomeScreen = dynamic(() => import("./WelcomeScreen").then((m) => m.WelcomeScreen), { ssr: false });
const DatePickerModal = dynamic(() => import("./DatePickerModal").then((m) => m.DatePickerModal), { ssr: false });
const TeacherPinModal = dynamic(() => import("./TeacherPinModal").then((m) => m.TeacherPinModal), { ssr: false });
const MobileTasksView = dynamic(() => import("./MobileTasksView").then((m) => m.MobileTasksView), { ssr: false });
const ScheduleWeekGrid = dynamic(() => import("./ScheduleWeekGrid").then((m) => m.ScheduleWeekGrid), { ssr: false });
const GuideHubModal = dynamic(() => import("./GuideHubModal").then((m) => m.GuideHubModal), { ssr: false });
const SubjectHubModal = dynamic(() => import("./schedule/SubjectHubModal").then((m) => m.SubjectHubModal), { ssr: false });
const InstallPrompt = dynamic(() => import("./InstallPrompt").then((m) => m.InstallPrompt), { ssr: false });
const ClassroomRelinkBanner = dynamic(() => import("./ClassroomRelinkBanner").then((m) => m.ClassroomRelinkBanner), { ssr: false });

export interface SchedulePageClientProps {
  initialGroups?: ReferenceRecord[];
  initialTeachers?: ReferenceRecord[];
  initialGroupId?: number;
  initialTeacherId?: number;
  initialMode?: "student" | "teacher";
  ssrNowIso?: string;
}

export function SchedulePageClient({
  initialGroups = [],
  initialTeachers = [],
  initialGroupId,
  initialTeacherId,
  initialMode,
  ssrNowIso,
}: SchedulePageClientProps) {
  const { resolvedTheme, toggleTheme } = useTheme();
  const { isMounted, isDesktop } = useViewportTier();
  const { updateSetting } = useUserSettings();
  const shouldReduceMotion = Boolean(useReducedMotion());
  const { user } = useAuth();
  const { showToast: setToast } = useToast();
  const { isTeacherUnlocked } = useTeacherAccess();

  const showDesktop = !isMounted || isDesktop;
  const showMobile = !isMounted || !isDesktop;
  const isPrivilegedUser = Boolean(user && canAccessAdmin(user));

  const { weekAnchorDate, setWeekAnchorDate, isCurrentWeek, weekStartStr } = useWeekAnchor(ssrNowIso);
  const {
    isSetupComplete,
    completeSetup,
    mode,
    toggleMode,
    teachers,
    teacherId,
    setTeacherId,
    groups,
    groupId,
    setGroupId,
    today,
    week,
    semesterStart,
    loading,
    isSlowNetwork,
    isUsingFallbackCache,
    error,
  } = useSchedule(
    weekAnchorDate,
    false,
    initialGroups,
    initialTeachers,
    initialGroupId,
    initialTeacherId,
    initialMode
  );

  const sel = useScheduleSelection({
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
    isPrivilegedUser,
    setToast,
    ssrNowIso,
  });

  const [contextModalOpen, setContextModalOpen] = useState(false);
  const [weekTypeSheetOpen, setWeekTypeSheetOpen] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [teacherPinModalOpen, setTeacherPinModalOpen] = useState(false);
  const [teacherPinTargetGroup, setTeacherPinTargetGroup] = useState<string | null>(null);
  const [guideHubOpen, setGuideHubOpen] = useState(false);
  const [guideHubMounted, setGuideHubMounted] = useState(false);
  if (guideHubOpen && !guideHubMounted) {
    setGuideHubMounted(true);
  }

  useEffect(() => {
    if (mode !== "student") return;
    let idleId: number | null = null;
    let timerId: number | null = null;
    const preload = () => {
      void import("./MobileTasksView");
      void import("./GradesView");
    };
    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      idleId = window.requestIdleCallback(preload, { timeout: 1500 });
    } else {
      timerId = globalThis.setTimeout(preload, 700) as unknown as number;
    }
    return () => {
      if (idleId !== null && typeof window !== "undefined" && "cancelIdleCallback" in window) {
        window.cancelIdleCallback(idleId);
      }
      if (timerId !== null) globalThis.clearTimeout(timerId);
    };
  }, [mode]);
  const [subjectHubOpen, setSubjectHubOpen] = useState(false);
  const [subjectHubMounted, setSubjectHubMounted] = useState(false);
  const [subjectHubTarget, setSubjectHubTarget] = useState<SubjectHubTarget | null>(null);
  const handleOpenSubjectHub = useCallback(
    (target: SubjectHubTarget) => {
      const effectiveGroupId = target.groupId ?? (mode === "student" ? groupId : null);
      const resolvedGroupName =
        target.groupName ??
        (effectiveGroupId ? groups.find((g) => g.id === effectiveGroupId)?.name ?? null : null);
      setSubjectHubTarget({
        ...target,
        groupId: effectiveGroupId,
        groupName: resolvedGroupName,
      });
      setSubjectHubMounted(true);
      setSubjectHubOpen(true);
    },
    [groups, groupId, mode]
  );
  const [desktopSidebarTab, setDesktopSidebarTab] = useState<"tasks" | "grades">("tasks");
  const { urlSearch } = useMobileNav();
  const tasksPanelRef = useRef<HTMLDivElement | null>(null);
  const schedulePanelRef = useRef<HTMLDivElement | null>(null);

  const [prevMobileTab, setPrevMobileTab] = useState(sel.mobileTab);
  const [mobileTabDir, setMobileTabDir] = useState<"next" | "prev" | null>(null);
  if (sel.mobileTab !== prevMobileTab) {
    setMobileTabDir(sel.mobileTab === "tasks" ? "next" : "prev");
    setPrevMobileTab(sel.mobileTab);
  }

  useIsomorphicLayoutEffect(() => {
    const tasksEl = tasksPanelRef.current;
    if (tasksEl) {
      if (sel.mobileTab !== "tasks") tasksEl.setAttribute("inert", "");
      else tasksEl.removeAttribute("inert");
    }
    const scheduleEl = schedulePanelRef.current;
    if (scheduleEl) {
      if (sel.mobileTab === "tasks") scheduleEl.setAttribute("inert", "");
      else scheduleEl.removeAttribute("inert");
    }
  }, [sel.mobileTab, sel.tasksTabMounted, showMobile]);

  const handleOpenTeacherPinModal = useCallback((groupName: string | null = null) => {
    setTeacherPinTargetGroup(groupName);
    setTeacherPinModalOpen(true);
  }, []);

  const revealTasksPanel = useCallback(
    (subtab: "tasks" | "grades") => {
      setDesktopSidebarTab(subtab);
      if (typeof window !== "undefined" && window.innerWidth >= 1024) {
        if (sel.view !== "today") sel.handleViewChange("today");
        if (sel.isFocusMode) sel.exitFocusMode();
      }
    },
    [sel]
  );

  useEffect(() => {
    const subtab = resolveScheduleSubtabFromSearch(urlSearch);
    if (subtab) {
      revealTasksPanel(subtab);
    }
  }, [urlSearch, revealTasksPanel]);

  useEffect(() => {
    const onOpenTasksPanel = (event: Event) => {
      const detail = (event as CustomEvent<{ subtab?: "tasks" | "grades" }>).detail;
      const subtab = detail?.subtab === "grades" ? "grades" : "tasks";
      revealTasksPanel(subtab);
    };
    window.addEventListener("schedule:open-tasks-panel", onOpenTasksPanel);
    return () => window.removeEventListener("schedule:open-tasks-panel", onOpenTasksPanel);
  }, [revealTasksPanel]);

  const {
    isLinked,
    classroomLastSyncedAt,
    formattedSyncTime,
    hasGroupTaskAccess,
    allTasks,
    sidebarTaskGroups,
    guideTaskGroups,
    handleToolbarClassroomSynced,
  } = useScheduleDataFetch({
    groupId,
    setGroupId,
    mode,
    week,
    weekAnchorDate,
    currentWeekNumber: sel.currentWeekNumber,
    returnTarget: sel.returnTarget,
    setToast,
    setOverdueCount: sel.setOverdueCount,
    onOpenTeacherPinModal: handleOpenTeacherPinModal,
  });

  useKeyboardScheduleNav({
    view: sel.view,
    isAnyModalOpen:
      weekTypeSheetOpen ||
      datePickerOpen ||
      teacherPinModalOpen ||
      guideHubOpen ||
      subjectHubOpen ||
      contextModalOpen,
    onOpenContextModal: () => setContextModalOpen(true),
    onJumpToToday: sel.handleJumpToToday,
    onViewChange: sel.handleViewChange,
    onPrevDay: sel.goToPrevDay,
    onNextDay: sel.goToNextDay,
    onShiftWeek: sel.shiftWeek,
    onSetSubgroup: (sg) => updateSetting("defaultSubgroup", sg),
  });

  const showWelcome = !loading && !isSetupComplete && !initialGroupId && !initialTeacherId;
  const isTodaySelected =
    sel.selectedDaySchedule?.date === sel.todayActualIso ||
    (sel.isWeekend && sel.selectedDayIndex === 0);

  return (
    <div className="min-h-dvh bg-transparent pb-6 text-sys-text-primary md:pb-8">
      {showWelcome ? (
        <WelcomeScreen
          groups={groups}
          teachers={teachers}
          initialMode={mode}
          onComplete={sel.handleCompleteWelcome}
        />
      ) : (
        <>
          <SplashScreen isLoading={loading} />
          <OfflineIndicator isSlowNetwork={isSlowNetwork} isUsingFallbackCache={isUsingFallbackCache} />
          <InstallPrompt />

          {showDesktop && (
            <DesktopToolbar
              mode={mode}
              currentName={sel.currentName}
              view={sel.view}
              canNavigatePrevDay={sel.canNavigatePrevDay}
              canNavigateNextDay={sel.canNavigateNextDay}
              canNavigatePrevWeek={sel.canNavigatePrevWeek}
              canNavigateNextWeek={sel.canNavigateNextWeek}
              isCurrentWeek={isCurrentWeek}
              isTodaySelected={isTodaySelected}
              compactWeekRange={sel.compactWeekRange}
              headerLearningModeData={sel.headerLearningModeData}
              isTeacherUnlocked={isTeacherUnlocked}
              resolvedTheme={resolvedTheme}
              onOpenContextModal={() => setContextModalOpen(true)}
              onPrevPeriod={sel.view === "today" ? sel.goToPrevDay : () => sel.shiftWeek(-1)}
              onNextPeriod={sel.view === "today" ? sel.goToNextDay : () => sel.shiftWeek(1)}
              onResetToday={sel.view === "today" ? sel.handleJumpToToday : sel.resetWeek}
              onOpenDatePicker={() => setDatePickerOpen(true)}
              onViewChange={sel.handleViewChange}
              onOpenTeacherPinModal={() => handleOpenTeacherPinModal(null)}
              onToggleTheme={toggleTheme}
              onOpenGuideHub={() => setGuideHubOpen(true)}
            />
          )}

          {showMobile && (
            <MobileChrome
              mode={mode}
              mobileTab={sel.mobileTab}
              currentName={sel.currentName}
              isTeacherUnlocked={isTeacherUnlocked}
              canNavigatePrevWeek={sel.canNavigatePrevWeek}
              canNavigateNextWeek={sel.canNavigateNextWeek}
              compactWeekRange={sel.compactWeekRange}
              currentWeekNumber={sel.currentWeekNumber}
              weekType={sel.weekType}
              headerLearningModeData={sel.headerLearningModeData}
              activeWeekPeriodMeta={sel.activeWeekPeriodMeta}
              onOpenContextModal={() => setContextModalOpen(true)}
              onOpenTeacherPinModal={() => handleOpenTeacherPinModal(null)}
              onShiftWeekPreservingDay={sel.shiftWeekPreservingDay}
              onOpenDatePicker={() => setDatePickerOpen(true)}
              onOpenWeekTypeSheet={() => setWeekTypeSheetOpen(true)}
              onOpenGuideHub={() => setGuideHubOpen(true)}
            />
          )}

          <ContextSelectionModal
            isOpen={contextModalOpen}
            mode={mode}
            isDesktop={isDesktop}
            groups={groups}
            teachers={teachers}
            groupId={groupId}
            teacherId={teacherId}
            recentGroupIds={sel.recentGroupIds}
            recentTeacherIds={sel.recentTeacherIds}
            onClose={() => setContextModalOpen(false)}
            onSelect={sel.handleSelectContextOption}
          />

          <main id="main-content" tabIndex={-1} className="vt-main-content focus:outline-none">
          {/* Mobile Main Content (< 1024px) */}
          {showMobile && (
            <div className="lg:hidden pb-24 min-w-0 overflow-x-clip">
              <div className="px-3 pt-2">
                <ClassroomRelinkBanner />
              </div>
              {sel.returnTarget && (
                <div className="m-3 flex items-center justify-between rounded-xl border border-sys-accent/30 bg-sys-accent/10 px-3 py-2 text-xs">
                  <span className="text-sys-text-secondary truncate mr-2">
                    Розклад: <strong className="text-sys-text-primary">{sel.currentName}</strong>
                  </span>
                  <button
                    type="button"
                    onClick={sel.handleReturnBack}
                    className="shrink-0 rounded-lg bg-sys-accent px-2.5 py-1 text-xs font-semibold text-white active:scale-[0.98]"
                  >
                    ← До {sel.returnTarget.label}
                  </button>
                </div>
              )}

              <div className="w-full">
                {sel.tasksTabMounted || sel.mobileTab === "tasks" ? (
                  <div
                    ref={tasksPanelRef}
                    data-inactive={sel.mobileTab !== "tasks"}
                    data-slide-dir={mobileTabDir ?? undefined}
                    aria-hidden={sel.mobileTab !== "tasks"}
                    className="spa-tab-panel"
                  >
                    <MobileTasksView
                      tasks={allTasks}
                      summaryTaskGroups={guideTaskGroups}
                      groupId={groupId}
                      weekStart={weekStartStr}
                      weekAnchorDate={weekAnchorDate}
                      weekNumber={sel.currentWeekNumber}
                      lastSyncedAt={classroomLastSyncedAt}
                      onSynced={(detectedId, _tasks, _lastSynced, isSilent) => {
                        if (!isSilent && !sel.returnTarget && detectedId && detectedId !== groupId) {
                          setGroupId(detectedId);
                        }
                      }}
                      onOpenSubjectHub={handleOpenSubjectHub}
                    />
                  </div>
                ) : null}

                <div
                  ref={schedulePanelRef}
                  data-inactive={sel.mobileTab === "tasks"}
                  data-slide-dir={mobileTabDir ?? undefined}
                  aria-hidden={sel.mobileTab === "tasks"}
                  className="spa-tab-panel"
                >
                  {sel.view === "today" && (
                    <div className="sticky top-[calc(3.5rem+1px+env(safe-area-inset-top))] z-30">
                      <MobileWeekDaysStrip
                        weekAnchorDate={weekAnchorDate}
                        selectedDayIndex={sel.selectedDayIndex}
                        onSelectDay={sel.handleSelectDayIndex}
                        isCurrentWeek={isCurrentWeek}
                        todayIso={sel.todayActualIso}
                        week={week}
                      />
                    </div>
                  )}
                  <div className="px-3 py-3">
                  {loading ? (
                    <ScheduleLoadingSkeleton rows={3} />
                  ) : error ? (
                    <ScheduleErrorState
                      error={error}
                      variant="mobile"
                      returnTarget={sel.returnTarget}
                      onRetry={() => invalidateScheduleCache()}
                      onReturnBack={sel.handleReturnBack}
                    />
                  ) : sel.view === "today" ? (
                    <DayPager
                      schedule={sel.selectedDaySchedule}
                      todayDate={sel.todayActualIso}
                      tomorrowDate={sel.tomorrowActualIso}
                      scheduleMode={mode}
                      canEdit={false}
                      onQuickJump={sel.handleQuickJump}
                      onOpenSubjectHub={handleOpenSubjectHub}
                      onNextDay={sel.goToNextDay}
                      onPrevDay={sel.goToPrevDay}
                      onJumpToToday={sel.handleJumpToToday}
                      onJumpToTomorrow={sel.handleJumpToTomorrow}
                      daySlideDir={sel.daySlideDir}
                      shouldReduceMotion={shouldReduceMotion}
                      isWeekend={sel.isAutoSelectedWeekendDay}
                      isShowingTomorrow={sel.isEveningAfterLessons && isCurrentWeek}
                      weekNumber={sel.currentWeekNumber}
                      currentGroupName={mode === "student" ? (sel.currentName ?? null) : null}
                      currentTeacherId={mode === "teacher" ? teacherId : null}
                      currentTeacherName={mode === "teacher" ? (sel.selectedTeacher?.name ?? null) : null}
                      canPrevDay={sel.canNavigatePrevDay}
                      canNextDay={sel.canNavigateNextDay}
                      minDateIso={sel.minDateIso}
                      maxDateIso={sel.maxDateIso}
                    />
                  ) : (
                    <ScheduleWeekGrid
                      week={week}
                      todayDate={sel.todayActualIso}
                      scheduleMode={mode}
                      canEdit={false}
                      onQuickJump={sel.handleQuickJump}
                      onOpenSubjectHub={handleOpenSubjectHub}
                      weekNumber={sel.currentWeekNumber}
                      currentTeacherId={mode === "teacher" ? teacherId : null}
                      currentTeacherName={mode === "teacher" ? (sel.selectedTeacher?.name ?? null) : null}
                      onSelectDay={sel.handleSelectDayFromWeek}
                      weekSlideDir={sel.weekSlideDir}
                    />
                  )}

                  {!loading &&
                    !error &&
                    ((mode === "student" && !groups.length) || (mode === "teacher" && !teachers.length)) && (
                      <div className="mt-4 rounded-2xl border border-dashed border-sys-border p-8 text-center text-xs text-sys-text-secondary">
                        {mode === "student" ? "Список груп поки порожній." : "Список викладачів поки порожній."}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Desktop Main Content (>= 1024px) */}
          {showDesktop && (
            <div className="hidden lg:block mx-auto max-w-[1600px] px-[27px] py-6">
              <ClassroomRelinkBanner />
              {sel.returnTarget && (
                <div className="mb-4 flex items-center justify-between rounded-xl border border-sys-accent/30 bg-sys-accent/10 px-4 py-2.5 text-sm">
                  <span className="text-sys-text-secondary">
                    Перегляд розкладу: <strong className="text-sys-text-primary">{sel.currentName}</strong>
                  </span>
                  <button
                    type="button"
                    onClick={sel.handleReturnBack}
                    className="rounded-lg bg-sys-accent px-3 py-1 text-xs font-semibold text-white transition-opacity hover:opacity-90 active:scale-[0.98]"
                  >
                    ← Повернутися до {sel.returnTarget.label}
                  </button>
                </div>
              )}

              {loading ? (
                <ScheduleLoadingSkeleton rows={4} />
              ) : error ? (
                <ScheduleErrorState
                  error={error}
                  variant="desktop"
                  returnTarget={sel.returnTarget}
                  onRetry={() => invalidateScheduleCache()}
                  onReturnBack={sel.handleReturnBack}
                />
              ) : (
                <div
                  key={sel.view}
                  className={shouldReduceMotion ? "" : "desktop-view-enter"}
                >
                    {sel.view === "today" ? (
                      <div className="w-full min-w-0 flex items-start justify-center overflow-x-clip">
                        <div
                          className={`w-full ${mode === "teacher" ? "max-w-[880px]" : "max-w-[760px]"} min-w-0`}
                        >
                          <DesktopFocusDaySwitcher
                            visible={sel.isFocusEffective}
                            shouldReduceMotion={shouldReduceMotion}
                            mode={mode}
                            currentWeekNumber={sel.currentWeekNumber}
                            weekType={sel.weekType}
                            weekRange={sel.weekRange}
                            weekDaysMini={sel.weekDaysMini}
                            selectedDayIndex={sel.selectedDayIndex}
                            todayActualIso={sel.todayActualIso}
                            onToggleFocusMode={sel.toggleFocusMode}
                            onSelectDayIndex={sel.handleSelectDayIndex}
                          />

                          {sel.isWeekend && (
                            <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-sys-border bg-sys-card px-5 py-4 text-[15px] shadow-sm">
                              <div className="flex items-center gap-3 min-w-0">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-amber-500 dark:text-amber-300">
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

                          <div className="relative w-full">
                              <ScheduleDay
                                schedule={sel.selectedDaySchedule ?? today!}
                                isToday={sel.selectedDaySchedule?.date === sel.todayActualIso && !sel.isWeekend}
                                scheduleMode={mode}
                                onQuickJump={sel.handleQuickJump}
                                onOpenSubjectHub={handleOpenSubjectHub}
                                hideHeaderOnMobile={false}
                                weekNumber={sel.currentWeekNumber}
                                hideDayTitle={sel.isFocusEffective}
                                currentGroupName={mode === "student" ? (sel.currentName ?? null) : null}
                                currentTeacherId={mode === "teacher" ? teacherId : null}
                                currentTeacherName={mode === "teacher" ? (sel.selectedTeacher?.name ?? null) : null}
                                daySlideDir={sel.daySlideDir}
                                shouldReduceMotion={shouldReduceMotion}
                              />
                          </div>
                        </div>

                        <DesktopScheduleSidebar
                          visible={!sel.isFocusEffective}
                          shouldReduceMotion={shouldReduceMotion}
                          mode={mode}
                          groupId={groupId}
                          weekStartStr={weekStartStr}
                          onClassroomSynced={handleToolbarClassroomSynced}
                          currentWeekNumber={sel.currentWeekNumber}
                          weekType={sel.weekType}
                          weekRange={sel.weekRange}
                          weekDaysMini={sel.weekDaysMini}
                          selectedDayIndex={sel.selectedDayIndex}
                          todayActualIso={sel.todayActualIso}
                          desktopSidebarTab={desktopSidebarTab}
                          hasGroupTaskAccess={hasGroupTaskAccess}
                          isLinked={isLinked}
                          sidebarTaskGroups={sidebarTaskGroups}
                          formattedSyncTime={formattedSyncTime}
                          allTasks={allTasks}
                          onToggleFocusMode={sel.toggleFocusMode}
                          onSelectDayIndex={sel.handleSelectDayIndex}
                          onChangeSidebarTab={setDesktopSidebarTab}
                          onOpenSubjectHub={handleOpenSubjectHub}
                        />
                      </div>
                    ) : (
                      <div className="w-full min-w-0">
                        <DesktopWeekHeaderBar
                          week={week}
                          mode={mode}
                          groupId={groupId}
                          teacherId={teacherId}
                          groups={groups}
                          teachers={teachers}
                          weekRange={sel.weekRange}
                          currentWeekNumber={sel.currentWeekNumber}
                          weekType={sel.weekType}
                          activeWeekPeriodMeta={sel.activeWeekPeriodMeta}
                          resolvedTheme={resolvedTheme}
                          setToast={setToast}
                        />
                        <ScheduleWeekGrid
                          week={week}
                          todayDate={sel.todayActualIso}
                          scheduleMode={mode}
                          canEdit={false}
                          onQuickJump={sel.handleQuickJump}
                          onOpenSubjectHub={handleOpenSubjectHub}
                          weekNumber={sel.currentWeekNumber}
                          currentTeacherId={mode === "teacher" ? teacherId : null}
                          currentTeacherName={mode === "teacher" ? (sel.selectedTeacher?.name ?? null) : null}
                          onSelectDay={sel.handleSelectDayFromWeek}
                          weekSlideDir={sel.weekSlideDir}
                        />
                      </div>
                    )}
                </div>
              )}
            </div>
          )}
          </main>

          <WeekTypeBottomSheet
            isOpen={weekTypeSheetOpen}
            weekType={sel.weekType}
            currentWeekNumber={sel.currentWeekNumber}
            isCurrentWeek={isCurrentWeek}
            canNavigateNextWeek={sel.canNavigateNextWeek}
            onClose={() => setWeekTypeSheetOpen(false)}
            onNextWeek={() => sel.shiftWeekPreservingDay(1)}
            onResetCurrentWeek={sel.resetWeekPreservingDay}
          />

          <TeacherPinModal
            isOpen={teacherPinModalOpen}
            onClose={() => setTeacherPinModalOpen(false)}
            targetGroupName={teacherPinTargetGroup}
            onSuccess={() => {
              setToast("Доступ викладача активовано", "success");
            }}
          />

          <DatePickerModal
            isOpen={datePickerOpen}
            onClose={() => setDatePickerOpen(false)}
            selectedDateIso={sel.activeDayDate}
            todayDateIso={sel.todayActualIso}
            semesterStartIso={semesterStart}
            minDateIso={sel.minDateIso}
            maxDateIso={sel.maxDateIso}
            onSelectDate={sel.handleDatePickerSelect}
          />

          {guideHubMounted && (
            <GuideHubModal
              isOpen={guideHubOpen}
              groupId={groupId}
              teacherId={teacherId}
              mode={mode}
              groupName={groups.find((g) => g.id === groupId)?.name ?? null}
              teacherName={sel.selectedTeacher?.name ?? null}
              taskCounts={
                isLinked
                  ? {
                      pending: guideTaskGroups.pendingCount,
                      overdue: guideTaskGroups.overdueTotalCount,
                      done: guideTaskGroups.doneCount,
                    }
                  : null
              }
              onClose={() => setGuideHubOpen(false)}
            />
          )}

          {subjectHubMounted && (
            <SubjectHubModal
              isOpen={subjectHubOpen}
              target={subjectHubTarget}
              mode={mode}
              groupName={
                subjectHubTarget?.groupName ??
                (groupId ? groups.find((g) => g.id === groupId)?.name ?? null : null)
              }
              teacherName={sel.selectedTeacher?.name ?? null}
              currentWeek={week}
              allTasks={allTasks}
              onClose={() => setSubjectHubOpen(false)}
              onQuickJump={(jumpTarget) => {
                setSubjectHubOpen(false);
                sel.handleQuickJump(jumpTarget);
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
