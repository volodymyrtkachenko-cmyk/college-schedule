"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { AnimatePresence, m } from "framer-motion";
import { ClassroomSyncButton } from "./ClassroomSyncButton";
import { useDesktopMotionEnabled } from "../lib/useViewportTier";
import type { ScheduleResponse } from "../lib/api";
import { formatKyivDateIso, KYIV_TIME_FMT } from "../lib/date";
import { buildCurrentScheduleHref, resolveScheduleSubtabFromSearch } from "../lib/navigation";
import type { SubjectHubTarget } from "../lib/schedule";
import {
  collectOverdueTaskKeys,
  formatOverdueBannerMessage,
  formatOverduePriorityPreview,
  formatOverdueTasksPhrase,
  OVERDUE_BANNER_SYNC_EVENT,
  readOverdueBannerDismissal,
  resolveOverdueScopeKey,
  saveOverdueBannerDismissal,
  shouldShowOverdueBanner,
  type OverdueBannerDismissal,
} from "../lib/schedule/overdueBanner";
import { useMobileNav } from "../lib/useMobileNav";
import { useAnimatedDisclosure } from "../lib/useAnimatedDisclosure";
import { useClassroomSubmissions } from "../lib/useClassroomSubmissions";
import {
  useTaskGroups,
  formatTaskWord,
  TaskFilterState,
  TaskGroupsResult,
} from "../lib/useTaskGroups";
import { useOptionalToast } from "./ToastProvider";
import { FullTaskItem, renderTaskCard, TaskCardItem } from "./TaskCardItem";
import { BarChartIcon, ClipboardListIcon, ClockIcon, CloseIcon } from "./ui/Icons";

const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

const preloadGradesChunk = () => {
  void import("./GradesView");
};

const GradesView = dynamic(() => import("./GradesView").then((m) => m.GradesView), { ssr: false });

export type { FullTaskItem };
export { renderTaskCard };

export type TasksTabMode = "pending" | "overdue" | "done";

const TASKS_TAB_ORDER: Record<TasksTabMode, number> = {
  pending: 0,
  overdue: 1,
  done: 2,
};

const DONE_INITIAL_LIMIT = 15;

export function TasksTodoBoard({
  tasks,
  isLinked,
  groupId = null,
  layoutPrefix = "tasks",
}: {
  tasks: FullTaskItem[];
  isLinked: boolean;
  week?: ScheduleResponse[];
  groupId?: number | null;
  layoutPrefix?: string;
}) {
  const desktopMotion = useDesktopMotionEnabled();
  const optionalToast = useOptionalToast();
  const [activeTab, setActiveTab] = useState<TasksTabMode>("pending");
  const [prevTab, setPrevTab] = useState<TasksTabMode>("pending");
  const [hasSwitchedTab, setHasSwitchedTab] = useState(false);
  const [tabSlideDir, setTabSlideDir] = useState<"next" | "prev" | null>(null);
  if (activeTab !== prevTab) {
    setTabSlideDir(TASKS_TAB_ORDER[activeTab] > TASKS_TAB_ORDER[prevTab] ? "next" : "prev");
    setHasSwitchedTab(true);
    setPrevTab(activeTab);
  }
  const [selectedSubject, setSelectedSubject] = useState<string>("");
  const [subjectMenuOpen, setSubjectMenuOpen] = useState(false);
  const subjectMenuRef = useRef<HTMLDivElement | null>(null);
  const { shouldRender: shouldRenderSubjectMenu, isClosing: isSubjectMenuClosing } =
    useAnimatedDisclosure(subjectMenuOpen, 190);
  const [showAllDone, setShowAllDone] = useState(false);
  const [noDateExpanded, setNoDateExpanded] = useState(false);

  useEffect(() => {
    if (!subjectMenuOpen) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (subjectMenuRef.current && !subjectMenuRef.current.contains(e.target as Node)) {
        setSubjectMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSubjectMenuOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [subjectMenuOpen]);

  const filters: TaskFilterState = useMemo(
    () => ({
      status: activeTab,
      subject: selectedSubject,
    }),
    [activeTab, selectedSubject]
  );

  const {
    overdueTasks,
    activeTasks,
    noDateTasks,
    turnedInTasks,
    pendingCount,
    overdueTotalCount,
    doneCount,
    subjects,
  } = useTaskGroups(tasks, "all", undefined, undefined, isLinked, filters);

  const effectiveSubject = useMemo(() => {
    if (!selectedSubject) return "";
    return subjects.some((s) => s.name === selectedSubject) ? selectedSubject : "";
  }, [selectedSubject, subjects]);

  const selectedSubjectMeta = useMemo(
    () => subjects.find((s) => s.name === effectiveSubject) ?? null,
    [subjects, effectiveSubject]
  );

  const scopeKey = useMemo(() => resolveOverdueScopeKey(groupId), [groupId]);
  const [dismissalHydrated, setDismissalHydrated] = useState(false);
  const [dismissalState, setDismissalState] = useState<OverdueBannerDismissal | null>(null);
  const [todayKyivIso, setTodayKyivIso] = useState<string>("");

  useIsomorphicLayoutEffect(() => {
    setDismissalState(readOverdueBannerDismissal());
    setTodayKyivIso(formatKyivDateIso());
    setDismissalHydrated(true);
  }, []);

  useEffect(() => {
    const syncFromStorage = () => {
      setDismissalState(readOverdueBannerDismissal());
      setTodayKyivIso(formatKyivDateIso());
    };
    const handleVisibilityChange = () => {
      if (!document.hidden) syncFromStorage();
    };
    window.addEventListener(OVERDUE_BANNER_SYNC_EVENT, syncFromStorage);
    window.addEventListener("storage", syncFromStorage);
    window.addEventListener("focus", syncFromStorage);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener(OVERDUE_BANNER_SYNC_EVENT, syncFromStorage);
      window.removeEventListener("storage", syncFromStorage);
      window.removeEventListener("focus", syncFromStorage);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  const overdueTaskKeys = useMemo(() => collectOverdueTaskKeys(overdueTasks), [overdueTasks]);
  const overdueAlertCount = overdueTasks.length > 0 ? overdueTasks.length : overdueTotalCount;
  const overdueHeadline = useMemo(
    () => formatOverdueBannerMessage(overdueAlertCount),
    [overdueAlertCount]
  );
  const overduePreview = useMemo(
    () => formatOverduePriorityPreview(overdueTasks),
    [overdueTasks]
  );

  const isOverdueBannerOpen =
    dismissalHydrated &&
    activeTab === "pending" &&
    !effectiveSubject &&
    shouldShowOverdueBanner({
      isLinked,
      overdueTaskKeys,
      dismissal: dismissalState,
      todayKyivIso: todayKyivIso || formatKyivDateIso(),
      scopeKey,
    });

  const { shouldRender: shouldRenderOverdueBanner, isClosing: isOverdueBannerClosing } =
    useAnimatedDisclosure(isOverdueBannerOpen, 280);

  const handleDismissOverdueBanner = () => {
    const next = saveOverdueBannerDismissal({
      overdueTaskKeys,
      todayKyivIso: todayKyivIso || formatKyivDateIso(),
      scopeKey,
    });
    setDismissalState(next);
    optionalToast?.showToast("Нагадування приховано до завтра", "info");
  };

  const totalStatusTabs = isLinked ? 3 : 2;
  const activeStatusIndex =
    activeTab === "pending" ? 0 : activeTab === "overdue" ? 1 : isLinked ? 2 : 0;

  const pillBgColor =
    activeTab === "overdue" && isLinked && overdueTotalCount > 0
      ? "bg-rose-600"
      : activeTab === "done"
      ? "bg-emerald-600"
      : "bg-sys-accentSolid";

  return (
    <div className="w-full space-y-3.5">
      {/* Unlinked Prompt Banner */}
      {!isLinked && (
        <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 p-3 text-xs text-sys-text-secondary">
          <div className="flex items-center justify-between gap-2.5">
            <div className="flex items-start gap-2 min-w-0">
              <span className="text-sky-600 dark:text-sky-400 font-bold shrink-0">ⓘ</span>
              <span className="leading-snug text-sys-text-primary">
                Це завдання всієї групи. Прив&apos;яжіть пошту @kre.dp.ua, щоб бачити свої здачі та оцінки.
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                window.dispatchEvent(new CustomEvent("trigger-classroom-sync"));
              }}
              className="shrink-0 rounded-lg bg-sky-500/25 hover:bg-sky-500/35 border border-sky-500/40 px-2.5 py-1 text-xs font-semibold text-sky-800 dark:text-sky-200 transition-colors cursor-pointer active:scale-95"
            >
              Прив&apos;язати
            </button>
          </div>
        </div>
      )}

      {/* 3 Status Segmented Pills — Framer layoutId on desktop or pure GPU translate3d slider */}
      <div
        role="tablist"
        aria-label="Категорії завдань"
        style={
          {
            "--seg-cols": totalStatusTabs,
            "--seg-index": activeStatusIndex,
          } as React.CSSProperties
        }
        className={`ui-seg-xl ui-seg-pad-4 relative grid items-stretch ${
          isLinked ? "grid-cols-3" : "grid-cols-2"
        } rounded-xl border border-sys-border bg-sys-bg text-xs font-semibold shadow-2xs select-none isolate`}
      >
        {!desktopMotion && (
          <div
            aria-hidden="true"
            className="ui-seg-slider pointer-events-none transition-transform duration-base [transition-timing-function:var(--ease-spring-snappy)] transform-gpu z-0"
          >
            <div className={`ui-seg-pill h-full w-full shadow-xs transition-colors duration-150 ${pillBgColor}`} />
          </div>
        )}

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "pending"}
          onClick={() => setActiveTab("pending")}
          className={`ui-seg-pill relative z-10 flex min-w-0 items-center justify-center gap-1 sm:gap-1.5 py-2 px-1 sm:px-2 text-[11px] sm:text-xs transition-colors duration-150 cursor-pointer active:scale-[0.98] ${
            activeTab === "pending"
              ? "text-white font-bold"
              : "text-sys-text-secondary hover:text-sys-text-primary"
          }`}
        >
          {desktopMotion && activeTab === "pending" && (
            <m.div
              layoutId={`${layoutPrefix}-status-pill`}
              transition={{ type: "spring", stiffness: 460, damping: 32 }}
              aria-hidden="true"
              className={`ui-seg-pill pointer-events-none absolute inset-0 shadow-xs transition-colors duration-150 ${pillBgColor}`}
            />
          )}
          <span className="relative z-10 truncate">До здачі</span>
          <span
            className={`relative z-10 inline-flex h-4 min-w-[18px] shrink-0 items-center justify-center rounded-full px-1 text-[10px] font-bold transition-colors ${
              activeTab === "pending"
                ? "bg-white/20 text-white"
                : "bg-sys-card text-sys-text-secondary border border-sys-border/60"
            }`}
          >
            {pendingCount}
          </span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "overdue"}
          onClick={() => setActiveTab("overdue")}
          className={`ui-seg-pill relative z-10 flex min-w-0 items-center justify-center gap-1 sm:gap-1.5 py-2 px-1 sm:px-2 text-[11px] sm:text-xs transition-colors duration-150 cursor-pointer active:scale-[0.98] ${
            activeTab === "overdue"
              ? "text-white font-bold"
              : overdueTotalCount > 0 && isLinked
              ? "text-rose-600 dark:text-rose-400 hover:text-rose-500"
              : "text-sys-text-secondary hover:text-sys-text-primary"
          }`}
        >
          {desktopMotion && activeTab === "overdue" && (
            <m.div
              layoutId={`${layoutPrefix}-status-pill`}
              transition={{ type: "spring", stiffness: 460, damping: 32 }}
              aria-hidden="true"
              className={`ui-seg-pill pointer-events-none absolute inset-0 shadow-xs transition-colors duration-150 ${pillBgColor}`}
            />
          )}
          <span className="relative z-10 truncate">{isLinked ? "Борги" : "Минув час"}</span>
          <span
            className={`relative z-10 inline-flex h-4 min-w-[18px] shrink-0 items-center justify-center rounded-full px-1 text-[10px] font-bold transition-colors ${
              activeTab === "overdue"
                ? "bg-white/20 text-white"
                : overdueTotalCount > 0 && isLinked
                ? "bg-rose-500/20 text-rose-700 dark:text-rose-300 border border-rose-500/30"
                : "bg-sys-card text-sys-text-secondary border border-sys-border/60"
            }`}
          >
            {overdueTotalCount}
          </span>
        </button>

        {isLinked && (
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "done"}
            onClick={() => setActiveTab("done")}
            className={`ui-seg-pill relative z-10 flex min-w-0 items-center justify-center gap-1 sm:gap-1.5 py-2 px-1 sm:px-2 text-[11px] sm:text-xs transition-colors duration-150 cursor-pointer active:scale-[0.98] ${
              activeTab === "done"
                ? "text-white font-bold"
                : "text-sys-text-secondary hover:text-sys-text-primary"
            }`}
          >
            {desktopMotion && activeTab === "done" && (
              <m.div
                layoutId={`${layoutPrefix}-status-pill`}
                transition={{ type: "spring", stiffness: 460, damping: 32 }}
                aria-hidden="true"
                className={`ui-seg-pill pointer-events-none absolute inset-0 shadow-xs transition-colors duration-150 ${pillBgColor}`}
              />
            )}
            <span className="relative z-10 truncate">Здано</span>
            <span
              className={`relative z-10 inline-flex h-4 min-w-[18px] shrink-0 items-center justify-center rounded-full px-1 text-[10px] font-bold transition-colors ${
                activeTab === "done"
                  ? "bg-white/20 text-white"
                  : "bg-sys-card text-sys-text-secondary border border-sys-border/60"
              }`}
            >
              {doneCount}
            </span>
          </button>
        )}
      </div>

      {/* Compact Collapsible Subject Selector */}
      {subjects.length > 1 && (
        <div ref={subjectMenuRef} className="relative z-30">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setSubjectMenuOpen((prev) => !prev)}
              aria-expanded={subjectMenuOpen}
              className={`flex-1 min-w-0 flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors duration-150 cursor-pointer active:scale-[0.99] ${
                effectiveSubject
                  ? "border-sys-accent/45 bg-sys-accent/10 text-sys-accent"
                  : "border-sys-border bg-sys-card text-sys-text-secondary hover:text-sys-text-primary hover:border-sys-elevatedBorder"
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="shrink-0 opacity-80"
                >
                  <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                </svg>
                <span className="truncate">
                  {effectiveSubject ? effectiveSubject : `Усі предмети (${subjects.length})`}
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {selectedSubjectMeta && (
                  <span className="rounded-full bg-sys-accent/20 px-1.5 py-0.5 text-[10px] font-bold text-sys-accent">
                    {selectedSubjectMeta.count}
                  </span>
                )}
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={`transition-transform duration-150 ${subjectMenuOpen ? "rotate-180" : ""}`}
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </div>
            </button>

            {effectiveSubject && (
              <button
                type="button"
                onClick={() => {
                  setSelectedSubject("");
                  setSubjectMenuOpen(false);
                }}
                title="Скинути фільтр предмета"
                aria-label="Скинути фільтр предмета"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-sys-border bg-sys-card text-sys-text-secondary hover:text-rose-500 hover:border-rose-500/40 active:scale-95 transition-colors cursor-pointer"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            )}
          </div>

          {shouldRenderSubjectMenu && (
            <div
              data-closing={isSubjectMenuClosing ? "true" : undefined}
              style={{ "--popup-y": "-6px", "--popup-origin": "top center" } as React.CSSProperties}
              className="discrete-popup desktop-spring-popup absolute left-0 right-0 top-full z-40 mt-1.5 max-h-60 overflow-y-auto custom-scrollbar rounded-xl border border-sys-border bg-sys-card p-1.5 shadow-xl space-y-0.5"
            >
              <button
                type="button"
                onClick={() => {
                  setSelectedSubject("");
                  setSubjectMenuOpen(false);
                }}
                className={`w-full flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors cursor-pointer ${
                  !effectiveSubject
                    ? "bg-sys-accent/15 text-sys-accent font-bold"
                    : "text-sys-text-primary hover:bg-sys-bg font-medium"
                }`}
              >
                <span>Усі предмети</span>
                <span className="text-[11px] text-sys-text-muted shrink-0">
                  {subjects.reduce((acc, item) => acc + item.count, 0)}
                </span>
              </button>

              {subjects.map((subj) => {
                const isSelected = effectiveSubject === subj.name;
                return (
                  <button
                    key={subj.name}
                    type="button"
                    onClick={() => {
                      setSelectedSubject(isSelected ? "" : subj.name);
                      setSubjectMenuOpen(false);
                    }}
                    className={`w-full flex items-center justify-between gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition-colors cursor-pointer ${
                      isSelected
                        ? "bg-sys-accent/15 text-sys-accent font-bold"
                        : "text-sys-text-primary hover:bg-sys-bg font-medium"
                    }`}
                  >
                    <span className="leading-snug break-words flex-1">{subj.name}</span>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        isSelected
                          ? "bg-sys-accent/25 text-sys-accent"
                          : "bg-sys-bg text-sys-text-secondary border border-sys-border/60"
                      }`}
                    >
                      {subj.count}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Dismissible Smart Overdue Alert inside "До здачі" tab */}
      {shouldRenderOverdueBanner && (
        <aside
          aria-label="Нагадування про прострочені завдання"
          aria-hidden={isOverdueBannerClosing || undefined}
          data-open={!isOverdueBannerClosing}
          className="grid-accordion !mt-0"
        >
          <div className="grid-accordion-inner pt-3.5">
            <div className="relative overflow-hidden rounded-xl border border-rose-500/35 bg-rose-500/[0.08] dark:bg-rose-500/[0.11] p-3 shadow-xs">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -top-10 -left-10 h-24 w-24 rounded-full bg-rose-500/15 blur-xl"
              />
              <div className="relative flex items-start gap-2.5">
                <span
                  aria-hidden="true"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-rose-500/30 bg-rose-500/15 text-rose-700 dark:text-rose-300"
                >
                  <ClockIcon className="h-3.5 w-3.5" />
                </span>

                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold leading-snug text-rose-900 dark:text-rose-200 break-words">
                    {overdueHeadline}
                  </p>
                  {overduePreview && (
                    <p className="mt-0.5 truncate text-[11px] font-medium leading-snug text-rose-800 dark:text-rose-300">
                      {overduePreview}
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={handleDismissOverdueBanner}
                  disabled={isOverdueBannerClosing}
                  tabIndex={isOverdueBannerClosing ? -1 : undefined}
                  aria-label="Приховати нагадування до завтра"
                  title="Приховати до завтра"
                  className="flex h-7 w-7 min-h-[28px] min-w-[28px] shrink-0 items-center justify-center rounded-lg text-rose-700 dark:text-rose-300 hover:bg-rose-500/15 hover:text-rose-950 dark:hover:text-rose-100 active:scale-95 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
                >
                  <CloseIcon className="h-3.5 w-3.5" />
                </button>
              </div>

              <button
                type="button"
                onClick={() => setActiveTab("overdue")}
                disabled={isOverdueBannerClosing}
                tabIndex={isOverdueBannerClosing ? -1 : undefined}
                className="group/cta relative mt-2.5 flex min-h-[32px] w-full items-center justify-between gap-2 rounded-lg border border-rose-500/25 bg-rose-500/[0.12] hover:bg-rose-500/20 px-2.5 py-1.5 text-[11px] font-bold text-rose-800 dark:text-rose-200 active:scale-[0.985] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
              >
                <span>Переглянути у вкладці «Борги»</span>
                <span
                  aria-hidden="true"
                  className="inline-flex items-center transition-transform duration-150 group-hover/cta:translate-x-0.5"
                >
                  →
                </span>
              </button>
            </div>
          </div>
        </aside>
      )}

      {/* Tasks List by Selected Tab */}
      {(() => {
        const activeTabContent =
          activeTab === "pending" ? (
            activeTasks.length === 0 && noDateTasks.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-sys-border bg-sys-card/30 p-7 text-center">
                <div className="mb-2.5 flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <p className="text-sm font-semibold text-sys-text-primary">
                  {effectiveSubject
                    ? `З предмета «${effectiveSubject}» активних завдань немає`
                    : "Нових завдань до здачі немає"}
                </p>
                <p className="text-xs text-sys-text-muted mt-1">
                  {overdueTotalCount > 0
                    ? isLinked
                      ? `Але є ${formatOverdueTasksPhrase(overdueTotalCount)} у вкладці «Борги»`
                      : `Але є ${overdueTotalCount} ${formatTaskWord(overdueTotalCount)} у вкладці «Минув час»`
                    : "Усі поточні роботи виконано вчасно"}
                </p>
                {effectiveSubject && (
                  <button
                    type="button"
                    onClick={() => setSelectedSubject("")}
                    className="mt-3 rounded-lg bg-sys-accent/15 border border-sys-accent/30 px-3 py-1.5 text-xs font-semibold text-sys-accent hover:bg-sys-accent/25 transition-colors cursor-pointer"
                  >
                    Показати всі предмети
                  </button>
                )}
              </div>
            ) : (
              <>
                {activeTasks.length > 0 && (
                  <section className="space-y-2">
                    <div className="flex items-center gap-2 px-1">
                      <span className="h-2 w-2 rounded-full bg-sys-accent" />
                      <h3 className="text-xs font-bold uppercase tracking-wider text-sys-text-secondary">
                        З терміном здачі ({activeTasks.length})
                      </h3>
                    </div>
                    <div className="space-y-2">
                      {activeTasks.map((t, idx) => (
                        <TaskCardItem key={t.id || t.url || `act-${idx}`} task={t} isLinked={isLinked} />
                      ))}
                    </div>
                  </section>
                )}

                {noDateTasks.length > 0 && (
                  <section>
                    <button
                      type="button"
                      aria-expanded={noDateExpanded}
                      onClick={() => setNoDateExpanded((prev) => !prev)}
                      className="w-full flex items-center justify-between gap-2 rounded-xl border border-sys-border/70 bg-sys-card/60 hover:bg-sys-card px-3 py-2 text-left transition-colors cursor-pointer active:scale-[0.99]"
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="h-2 w-2 rounded-full bg-slate-400 shrink-0" />
                        <span className="text-xs font-bold uppercase tracking-wider text-sys-text-secondary truncate">
                          Без терміну здачі ({noDateTasks.length})
                        </span>
                      </span>
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                        className={`shrink-0 text-sys-text-muted transition-transform duration-200 ${
                          noDateExpanded ? "rotate-180" : ""
                        }`}
                      >
                        <path d="m6 9 6 6 6-6" />
                      </svg>
                    </button>
                    {desktopMotion ? (
                      <AnimatePresence initial={false}>
                        {noDateExpanded && (
                          <m.div
                            key="nodate-tasks-panel"
                            initial={{ opacity: 0, height: 0, y: -4 }}
                            animate={{
                              opacity: 1,
                              height: "auto",
                              y: 0,
                              transition: {
                                height: { duration: 0.24, ease: [0.22, 1, 0.36, 1] },
                                y: { duration: 0.22, ease: [0.22, 1, 0.36, 1] },
                                opacity: { duration: 0.16, ease: [0.22, 1, 0.36, 1], delay: 0.03 },
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
                            <div className="space-y-2 pt-2">
                              {noDateTasks.map((t, idx) => (
                                <TaskCardItem key={t.id || t.url || `nodate-${idx}`} task={t} isLinked={isLinked} />
                              ))}
                            </div>
                          </m.div>
                        )}
                      </AnimatePresence>
                    ) : (
                      <div
                        data-open={noDateExpanded ? "true" : undefined}
                        aria-hidden={!noDateExpanded || undefined}
                        className="grid-accordion"
                      >
                        <div className="grid-accordion-inner">
                          <div className="space-y-2 pt-2">
                            {noDateTasks.map((t, idx) => (
                              <TaskCardItem key={t.id || t.url || `nodate-${idx}`} task={t} isLinked={isLinked} />
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </section>
                )}
              </>
            )
          ) : activeTab === "overdue" ? (
            overdueTasks.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-sys-border bg-sys-card/30 p-7 text-center">
                <div className="mb-2.5 flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <p className="text-sm font-semibold text-sys-text-primary">
                  Прострочених завдань немає
                </p>
                <p className="text-xs text-sys-text-muted mt-1">
                  Жодних хвостів за попередні тижні!
                </p>
              </div>
            ) : (
              overdueTasks.map((t, idx) => (
                <TaskCardItem key={t.id || t.url || `ovr-${idx}`} task={t} isLinked={isLinked} />
              ))
            )
          ) : turnedInTasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-sys-border bg-sys-card/30 p-7 text-center">
              <p className="text-sm font-semibold text-sys-text-primary">
                Зданих робіт поки немає
              </p>
              <p className="text-xs text-sys-text-muted mt-1">
                Тут з&apos;являться ваші здані та оцінені завдання з Classroom
              </p>
            </div>
          ) : (
            <>
              {(showAllDone ? turnedInTasks : turnedInTasks.slice(0, DONE_INITIAL_LIMIT)).map((t, idx) => (
                <TaskCardItem key={t.id || t.url || `done-${idx}`} task={t} isLinked={isLinked} />
              ))}
              {!showAllDone && turnedInTasks.length > DONE_INITIAL_LIMIT && (
                <button
                  type="button"
                  onClick={() => setShowAllDone(true)}
                  className="w-full rounded-xl border border-sys-border bg-sys-card py-2.5 px-4 text-xs font-semibold text-sys-text-secondary hover:text-sys-text-primary hover:border-sys-accent/40 active:scale-[0.99] transition-colors cursor-pointer"
                >
                  Показати всі здані ({turnedInTasks.length})
                </button>
              )}
            </>
          );

        if (desktopMotion) {
          const tabMotionDir = tabSlideDir === "prev" ? -1 : 1;
          return (
            <div className="relative overflow-x-clip">
              <AnimatePresence mode="popLayout" initial={false} custom={tabMotionDir}>
                <m.div
                  key={activeTab}
                  custom={tabMotionDir}
                  initial={hasSwitchedTab ? { opacity: 0, x: tabMotionDir * 24 } : false}
                  animate={{
                    opacity: 1,
                    x: 0,
                    transition: {
                      x: { type: "spring", stiffness: 380, damping: 28 },
                      opacity: { duration: 0.16, ease: [0.22, 1, 0.36, 1] },
                    },
                  }}
                  exit={{
                    opacity: 0,
                    x: tabMotionDir * -20,
                    pointerEvents: "none",
                    transition: { duration: 0.14, ease: [0.32, 0, 0.24, 1] },
                  }}
                  className={activeTab === "pending" ? "space-y-4" : "space-y-2"}
                >
                  {activeTabContent}
                </m.div>
              </AnimatePresence>
            </div>
          );
        }

        return (
          <div className="overflow-x-clip">
            <div
              key={activeTab}
              className={`guide-step-slide ${activeTab === "pending" ? "space-y-4" : "space-y-2"}`}
              data-slide-dir={tabSlideDir ?? undefined}
            >
              {activeTabContent}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

export function MobileTasksView({
  tasks,
  summaryTaskGroups,
  groupId,
  week,
  weekStart,
  lastSyncedAt,
  onSynced,
  onOpenSubjectHub,
}: {
  tasks: FullTaskItem[];
  summaryTaskGroups?: TaskGroupsResult;
  groupId: number | null;
  week?: ScheduleResponse[];
  weekStart?: string;
  weekAnchorDate?: Date;
  weekNumber?: number | null;
  onPrevWeek?: () => void;
  onNextWeek?: () => void;
  tasksScope?: "week" | "all";
  onTasksScopeChange?: (scope: "week" | "all") => void;
  lastSyncedAt?: string | null;
  onSynced?: (
    detectedId: number,
    tasks?: any[],
    lastSyncedAt?: string | null,
    isSilent?: boolean
  ) => void;
  onOpenSubjectHub?: (target: SubjectHubTarget) => void;
}) {
  const [viewMode, setViewMode] = useState<"tasks" | "grades">(() => {
    if (typeof window === "undefined") return "tasks";
    return resolveScheduleSubtabFromSearch(window.location.search) ?? "tasks";
  });
  const [prevViewMode, setPrevViewMode] = useState<"tasks" | "grades">(viewMode);
  const [viewSlideDir, setViewSlideDir] = useState<"next" | "prev" | null>(null);
  if (viewMode !== prevViewMode) {
    setViewSlideDir(viewMode === "grades" ? "next" : "prev");
    setPrevViewMode(viewMode);
  }
  const [gradesVisited, setGradesVisited] = useState(() => viewMode === "grades");
  if (viewMode === "grades" && !gradesVisited) {
    setGradesVisited(true);
  }
  const { urlSearch, syncScheduleLocation } = useMobileNav();
  const tasksViewRef = useRef<HTMLDivElement | null>(null);
  const gradesViewRef = useRef<HTMLDivElement | null>(null);

  useIsomorphicLayoutEffect(() => {
    const tEl = tasksViewRef.current;
    if (tEl) {
      if (viewMode !== "tasks") tEl.setAttribute("inert", "");
      else tEl.removeAttribute("inert");
    }
    const gEl = gradesViewRef.current;
    if (gEl) {
      if (viewMode !== "grades") gEl.setAttribute("inert", "");
      else gEl.removeAttribute("inert");
    }
  }, [viewMode, gradesVisited]);

  useEffect(() => {
    let idleId: number | null = null;
    let timerId: number | null = null;
    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      idleId = window.requestIdleCallback(preloadGradesChunk, { timeout: 1400 });
    } else {
      timerId = globalThis.setTimeout(preloadGradesChunk, 600) as unknown as number;
    }
    return () => {
      if (idleId !== null && typeof window !== "undefined" && "cancelIdleCallback" in window) {
        window.cancelIdleCallback(idleId);
      }
      if (timerId !== null) globalThis.clearTimeout(timerId);
    };
  }, []);

  useEffect(() => {
    const subtab = resolveScheduleSubtabFromSearch(urlSearch);
    if (subtab === "grades") {
      setGradesVisited(true);
      setViewMode("grades");
    } else {
      setViewMode("tasks");
    }
  }, [urlSearch]);

  const handleSelectSubtab = (nextMode: "tasks" | "grades") => {
    if (nextMode === "grades") {
      preloadGradesChunk();
      setGradesVisited(true);
    }
    setViewMode(nextMode);
    if (typeof window !== "undefined") {
      syncScheduleLocation(
        buildCurrentScheduleHref(
          window.location.pathname,
          window.location.search,
          "tasks",
          nextMode === "grades" ? "grades" : null
        )
      );
    }
  };

  useEffect(() => {
    const onOpenTasksPanel = (event: Event) => {
      const detail = (event as CustomEvent<{ subtab?: "tasks" | "grades" }>).detail;
      if (detail?.subtab === "grades") {
        setGradesVisited(true);
        setViewMode("grades");
      } else if (detail?.subtab === "tasks") {
        setViewMode("tasks");
      }
    };
    window.addEventListener("schedule:open-tasks-panel", onOpenTasksPanel);
    return () => window.removeEventListener("schedule:open-tasks-panel", onOpenTasksPanel);
  }, []);
  const { isLinked, isLinkedToGroup } = useClassroomSubmissions();
  const hasAccess = Boolean(groupId && isLinkedToGroup(groupId));

  const { activeCount, totalCount } = useMemo(() => {
    if (summaryTaskGroups) {
      return {
        activeCount: summaryTaskGroups.activeCount,
        totalCount: summaryTaskGroups.totalCount,
      };
    }
    let active = 0;
    for (const t of tasks) {
      const isDone =
        isLinked &&
        (t.state === "TURNED_IN" || t.state === "RETURNED" || t.state === "MANUAL_DONE");
      if (!isDone) active++;
    }
    return { activeCount: active, totalCount: tasks.length };
  }, [summaryTaskGroups, tasks, isLinked]);
  const badgeCount = isLinked ? activeCount : totalCount;

  const formattedSyncTime = useMemo(() => {
    if (!lastSyncedAt) return null;
    try {
      const d = new Date(lastSyncedAt);
      if (isNaN(d.getTime())) return null;
      return KYIV_TIME_FMT.format(d);
    } catch {
      return null;
    }
  }, [lastSyncedAt]);

  return (
    <div className="w-full min-w-0 pb-bottom-nav-safe px-4 pt-3">
      {/* Header */}
      <div className="mb-3 flex items-start justify-between min-h-[48px]">
        <div className="min-w-0 flex-1 pr-2">
          <div className="min-h-[1.75rem] flex items-center">
            <h2 className="text-xl font-bold tracking-tight text-sys-text-primary leading-tight break-words">
              {viewMode === "grades" ? "Оцінки" : "Завдання Classroom"}
            </h2>
          </div>
          {hasAccess && (
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 mt-0.5 min-h-[1rem] text-xs leading-snug text-sys-text-secondary min-w-0">
              <span className="break-words">
                {viewMode === "grades"
                  ? "Середній бал та успішність"
                  : isLinked
                  ? `Активних до виконання: ${activeCount}`
                  : `Усього в розкладі: ${totalCount} ${formatTaskWord(totalCount)}`}
              </span>
              {formattedSyncTime && (
                <span className="shrink-0 whitespace-nowrap text-sys-text-muted">• {formattedSyncTime}</span>
              )}
            </div>
          )}
        </div>

        {groupId && (
          <div className="shrink-0 pt-0.5">
            <ClassroomSyncButton
              listenGlobalTrigger={false}
              currentGroupId={groupId}
              weekStart={weekStart}
              onSynced={(id, syncedTasks, lastSynced, isSilent) =>
                onSynced?.(id, syncedTasks, lastSynced, isSilent)
              }
            />
          </div>
        )}
      </div>

      {/* Top Switcher: [ 📋 Завдання | 📊 Оцінки ] — Pure GPU translate3d slider */}
      <div
        style={
          {
            "--seg-cols": 2,
            "--seg-index": viewMode === "grades" ? 1 : 0,
          } as React.CSSProperties
        }
        className="ui-seg-xl ui-seg-pad-4 relative mb-4 grid grid-cols-2 items-stretch rounded-xl border border-sys-border bg-sys-card text-xs font-semibold shadow-xs select-none isolate"
      >
        <div
          aria-hidden="true"
          className="ui-seg-slider pointer-events-none transition-transform duration-base [transition-timing-function:var(--ease-spring-snappy)] transform-gpu z-0 bg-sys-accentSolid shadow-xs"
        />

        <button
          type="button"
          aria-pressed={viewMode === "tasks"}
          onClick={() => handleSelectSubtab("tasks")}
          className={`ui-seg-pill relative z-10 flex min-w-0 items-center justify-center gap-1.5 py-2 px-2 sm:px-3 transition-colors duration-150 cursor-pointer active:scale-[0.98] ${
            viewMode === "tasks"
              ? "text-sys-onAccent font-bold"
              : "text-sys-text-secondary hover:text-sys-text-primary"
          }`}
        >
          <ClipboardListIcon className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">Завдання{hasAccess && badgeCount > 0 ? ` (${badgeCount})` : ""}</span>
        </button>
        <button
          type="button"
          aria-pressed={viewMode === "grades"}
          onPointerEnter={preloadGradesChunk}
          onFocus={preloadGradesChunk}
          onClick={() => handleSelectSubtab("grades")}
          className={`ui-seg-pill relative z-10 flex min-w-0 items-center justify-center gap-1.5 py-2 px-2 sm:px-3 transition-colors duration-150 cursor-pointer active:scale-[0.98] ${
            viewMode === "grades"
              ? "text-sys-onAccent font-bold"
              : "text-sys-text-secondary hover:text-sys-text-primary"
          }`}
        >
          <BarChartIcon className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">Оцінки</span>
        </button>
      </div>

      <div className="w-full overflow-x-clip">
        {!hasAccess ? (
          <div className="rounded-2xl border border-sky-500/20 bg-sky-500/5 p-6 text-center mt-6">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-500/10 text-sky-700 dark:text-sky-400 border border-sky-500/20">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </div>
            <h3 className="text-base font-bold text-sys-text-primary mb-1.5">
              {viewMode === "grades" ? "Оцінки захищено" : "Завдання захищено"}
            </h3>
            <p className="text-xs text-sys-text-secondary leading-relaxed max-w-sm mx-auto mb-5">
              Завдання та оцінки доступні лише студентам цієї групи. Прив&apos;яжіть пошту @kre.dp.ua своєї групи.
            </p>
            <button
              type="button"
              onClick={() => {
                window.dispatchEvent(new CustomEvent("trigger-classroom-sync"));
              }}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-sky-700 hover:bg-sky-800 text-white font-semibold text-xs px-5 py-2.5 transition-colors shadow-sm cursor-pointer active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:ring-offset-sys-card"
            >
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                <polyline points="10 17 15 12 10 7" />
                <line x1="15" y1="12" x2="3" y2="12" />
              </svg>
              <span>Прив&apos;язати Google Classroom</span>
            </button>
          </div>
        ) : (
          <>
            <div
              ref={tasksViewRef}
              data-inactive={viewMode !== "tasks"}
              data-slide-dir={viewSlideDir ?? undefined}
              aria-hidden={viewMode !== "tasks"}
              className="spa-tab-panel"
            >
              <TasksTodoBoard
                tasks={tasks}
                isLinked={isLinked}
                week={week}
                groupId={groupId}
                layoutPrefix="mobile-tasks"
              />
            </div>
            {(gradesVisited || viewMode === "grades") && (
              <div
                ref={gradesViewRef}
                data-inactive={viewMode !== "grades"}
                data-slide-dir={viewSlideDir ?? undefined}
                aria-hidden={viewMode !== "grades"}
                className="spa-tab-panel"
              >
                <GradesView
                  tasks={tasks}
                  isLinked={isLinked}
                  groupId={groupId}
                  onSyncClassroom={() =>
                    window.dispatchEvent(new CustomEvent("trigger-classroom-sync"))
                  }
                  onOpenSubjectHub={
                    onOpenSubjectHub
                      ? (subjectName) =>
                          onOpenSubjectHub({
                            subjectId: null,
                            subjectName,
                            groupId: groupId ?? null,
                          })
                      : undefined
                  }
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
