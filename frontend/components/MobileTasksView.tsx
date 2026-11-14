"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ClassroomSyncButton } from "./ClassroomSyncButton";
import { resolveScheduleSubtabFromSearch } from "../lib/navigation";
import type { SubjectHubTarget } from "../lib/schedule";
import { useMobileNav } from "../lib/useMobileNav";
import { useAnimatedDisclosure } from "../lib/useAnimatedDisclosure";
import { useClassroomSubmissions } from "../lib/useClassroomSubmissions";
import {
  useTaskGroups,
  formatTaskWord,
  TaskFilterState,
  TaskGroupsResult,
} from "../lib/useTaskGroups";
import { FullTaskItem, renderTaskCard, TaskCardItem } from "./TaskCardItem";
import { BarChartIcon, ClipboardListIcon, CloseIcon } from "./ui/Icons";

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

const EMPTY_TASKS: FullTaskItem[] = [];
const DONE_INITIAL_LIMIT = 15;

export function TasksTodoBoard({
  tasks,
  isLinked,
}: {
  tasks: FullTaskItem[];
  isLinked: boolean;
  layoutPrefix?: string;
}) {
  const [activeTab, setActiveTab] = useState<TasksTabMode>("pending");
  const [prevTab, setPrevTab] = useState<TasksTabMode>("pending");
  const [tabSlideDir, setTabSlideDir] = useState<"next" | "prev" | null>(null);
  if (activeTab !== prevTab) {
    setTabSlideDir(TASKS_TAB_ORDER[activeTab] > TASKS_TAB_ORDER[prevTab] ? "next" : "prev");
    setPrevTab(activeTab);
  }
  const [selectedSubject, setSelectedSubject] = useState<string>("");
  const [subjectMenuOpen, setSubjectMenuOpen] = useState(false);
  const { shouldRender: shouldRenderSubjectMenu, isClosing: isSubjectMenuClosing } =
    useAnimatedDisclosure(subjectMenuOpen, 170);
  const [showAllDone, setShowAllDone] = useState(false);

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
                Це завдання всієї групи. Прив&apos;яжи пошту, щоб бачити свої здачі та оцінки.
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

      {/* 3 Status Segmented Pills — Pure GPU translate3d slider (zero layout thrashing) */}
      <div
        role="tablist"
        aria-label="Категорії завдань"
        className={`relative grid ${
          isLinked ? "grid-cols-3" : "grid-cols-2"
        } rounded-xl border border-sys-border bg-sys-bg p-1 text-xs font-semibold shadow-2xs select-none isolate`}
      >
        <div
          aria-hidden="true"
          className="absolute top-1 bottom-1 pointer-events-none transition-transform duration-base [transition-timing-function:var(--ease-spring-snappy)] transform-gpu z-0"
          style={{
            left: "4px",
            width: `calc((100% - 8px) / ${totalStatusTabs})`,
            transform: `translate3d(calc(${activeStatusIndex} * 100%), 0, 0)`,
          }}
        >
          <div className={`h-full w-full rounded-lg shadow-xs transition-colors duration-150 ${pillBgColor}`} />
        </div>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "pending"}
          onClick={() => setActiveTab("pending")}
          className={`relative z-10 flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg transition-colors duration-150 cursor-pointer active:scale-[0.98] ${
            activeTab === "pending"
              ? "text-white font-bold"
              : "text-sys-text-secondary hover:text-sys-text-primary"
          }`}
        >
          <span className="truncate">До здачі</span>
          <span
            className={`inline-flex h-4 min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold transition-colors ${
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
          className={`relative z-10 flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg transition-colors duration-150 cursor-pointer active:scale-[0.98] ${
            activeTab === "overdue"
              ? "text-white font-bold"
              : overdueTotalCount > 0 && isLinked
              ? "text-rose-600 dark:text-rose-400 hover:text-rose-500"
              : "text-sys-text-secondary hover:text-sys-text-primary"
          }`}
        >
          <span className="truncate">{isLinked ? "Борги" : "Минув час"}</span>
          <span
            className={`inline-flex h-4 min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold transition-colors ${
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
            className={`relative z-10 flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg transition-colors duration-150 cursor-pointer active:scale-[0.98] ${
              activeTab === "done"
                ? "text-white font-bold"
                : "text-sys-text-secondary hover:text-sys-text-primary"
            }`}
          >
            <span className="truncate">Здано</span>
            <span
              className={`inline-flex h-4 min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold transition-colors ${
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
        <div className="relative">
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
              style={{ "--popup-y": "-6px" } as React.CSSProperties}
              className="discrete-popup mt-1.5 max-h-60 overflow-y-auto custom-scrollbar rounded-xl border border-sys-border bg-sys-card p-1.5 shadow-lg space-y-0.5"
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

      {/* Quick Overdue Alert inside "До здачі" tab */}
      {activeTab === "pending" && isLinked && overdueTotalCount > 0 && !effectiveSubject && (
        <button
          type="button"
          onClick={() => setActiveTab("overdue")}
          className="w-full flex items-center justify-between gap-2 rounded-xl border border-rose-500/35 bg-rose-500/10 px-3.5 py-2.5 text-xs text-left transition-colors hover:bg-rose-500/15 active:scale-[0.99] cursor-pointer"
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="h-2 w-2 rounded-full bg-rose-500 shrink-0" />
            <span className="font-semibold text-rose-800 dark:text-rose-300 truncate">
              У вас {overdueTotalCount} прострочених {formatTaskWord(overdueTotalCount)}
            </span>
          </div>
          <span className="shrink-0 font-bold text-rose-700 dark:text-rose-300">
            Переглянути →
          </span>
        </button>
      )}

      {/* Tasks List by Selected Tab */}
      <div className="overflow-x-clip">
      {activeTab === "pending" && (
        <div key="pending" className="guide-step-slide space-y-4" data-slide-dir={tabSlideDir ?? undefined}>
          {activeTasks.length === 0 && noDateTasks.length === 0 ? (
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
                  ? `Але є нездані роботи у вкладці «${isLinked ? "Борги" : "Минув час"}» (${overdueTotalCount})`
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
                      За розкладом дедлайнів ({activeTasks.length})
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
                <section className="space-y-2">
                  <div className="flex items-center gap-2 px-1 pt-1">
                    <span className="h-2 w-2 rounded-full bg-slate-400" />
                    <h3 className="text-xs font-bold uppercase tracking-wider text-sys-text-secondary">
                      Без терміну здачі ({noDateTasks.length})
                    </h3>
                  </div>
                  <div className="space-y-2">
                    {noDateTasks.map((t, idx) => (
                      <TaskCardItem key={t.id || t.url || `nodate-${idx}`} task={t} isLinked={isLinked} />
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      )}

      {activeTab === "overdue" && (
        <div key="overdue" className="guide-step-slide space-y-2" data-slide-dir={tabSlideDir ?? undefined}>
          {overdueTasks.length === 0 ? (
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
          )}
        </div>
      )}

      {activeTab === "done" && (
        <div key="done" className="guide-step-slide space-y-2" data-slide-dir={tabSlideDir ?? undefined}>
          {turnedInTasks.length === 0 ? (
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
          )}
        </div>
      )}
      </div>
    </div>
  );
}

export function MobileTasksView({
  tasks,
  summaryTaskGroups,
  groupId,
  weekStart,
  lastSyncedAt,
  onSynced,
  onOpenSubjectHub,
}: {
  tasks: FullTaskItem[];
  summaryTaskGroups?: TaskGroupsResult;
  groupId: number | null;
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
  const { urlSearch } = useMobileNav();
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
    } else if (subtab === "tasks") {
      setViewMode("tasks");
    }
  }, [urlSearch]);

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

  const fallbackSummary = useTaskGroups(
    summaryTaskGroups ? EMPTY_TASKS : tasks,
    "all",
    undefined,
    undefined,
    isLinked
  );
  const { activeCount, totalCount } = summaryTaskGroups ?? fallbackSummary;
  const badgeCount = isLinked ? activeCount : totalCount;

  const formattedSyncTime = useMemo(() => {
    if (!lastSyncedAt) return null;
    try {
      const d = new Date(lastSyncedAt);
      if (isNaN(d.getTime())) return null;
      return new Intl.DateTimeFormat("uk-UA", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/Kyiv",
      }).format(d);
    } catch {
      return null;
    }
  }, [lastSyncedAt]);

  return (
    <div className="w-full min-w-0 pb-20 px-4 pt-3">
      {/* Header */}
      <div className="mb-3 flex items-start justify-between min-h-[48px]">
        <div className="min-w-0 flex-1 pr-2">
          <div className="h-7 flex items-center">
            <h2 className="text-xl font-bold tracking-tight text-sys-text-primary leading-none truncate">
              {viewMode === "grades" ? "Оцінки" : "Завдання Classroom"}
            </h2>
          </div>
          {hasAccess && (
            <div className="flex items-center gap-1.5 mt-0.5 h-4 text-xs text-sys-text-secondary min-w-0">
              <span className="truncate">
                {viewMode === "grades"
                  ? "Середній бал та успішність"
                  : isLinked
                  ? `Активних до виконання: ${activeCount}`
                  : `Усього в розкладі: ${totalCount} ${formatTaskWord(totalCount)}`}
              </span>
              {formattedSyncTime && (
                <span className="shrink-0 text-sys-text-muted">• {formattedSyncTime}</span>
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
      <div className="relative mb-4 grid grid-cols-2 rounded-xl border border-sys-border bg-sys-card p-1 text-xs font-semibold shadow-xs select-none isolate">
        <div
          aria-hidden="true"
          className="absolute top-1 bottom-1 pointer-events-none transition-transform duration-base [transition-timing-function:var(--ease-spring-snappy)] transform-gpu z-0"
          style={{
            left: "4px",
            width: "calc((100% - 8px) / 2)",
            transform: `translate3d(${viewMode === "grades" ? "100%" : "0%"}, 0, 0)`,
          }}
        >
          <div className="h-full w-full rounded-lg bg-sys-accentSolid shadow-xs" />
        </div>

        <button
          type="button"
          onClick={() => setViewMode("tasks")}
          className={`relative z-10 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg transition-colors duration-150 cursor-pointer active:scale-[0.98] ${
            viewMode === "tasks"
              ? "text-white font-bold"
              : "text-sys-text-secondary hover:text-sys-text-primary"
          }`}
        >
          <ClipboardListIcon className="h-3.5 w-3.5 shrink-0" />
          <span>Завдання{hasAccess && badgeCount > 0 ? ` (${badgeCount})` : ""}</span>
        </button>
        <button
          type="button"
          onPointerEnter={preloadGradesChunk}
          onFocus={preloadGradesChunk}
          onClick={() => {
            preloadGradesChunk();
            setGradesVisited(true);
            setViewMode("grades");
          }}
          className={`relative z-10 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg transition-colors duration-150 cursor-pointer active:scale-[0.98] ${
            viewMode === "grades"
              ? "text-white font-bold"
              : "text-sys-text-secondary hover:text-sys-text-primary"
          }`}
        >
          <BarChartIcon className="h-3.5 w-3.5 shrink-0" />
          <span>Оцінки</span>
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
              Домашні завдання та оцінки доступні лише для студентів цієї групи. Підключіть студентський Google Classroom, щоб отримати доступ.
            </p>
            <button
              type="button"
              onClick={() => {
                window.dispatchEvent(new CustomEvent("trigger-classroom-sync"));
              }}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-white font-semibold text-xs px-5 py-2.5 transition-colors shadow-sm cursor-pointer active:scale-95"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
              <TasksTodoBoard tasks={tasks} isLinked={isLinked} />
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
