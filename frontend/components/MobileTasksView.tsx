"use client";


import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import { ClassroomSyncButton } from "./ClassroomSyncButton";
import { useClassroomSubmissions } from "../lib/useClassroomSubmissions";
import {
  useTaskGroups,
  formatTaskWord,
  TaskFilterState,
} from "../lib/useTaskGroups";
import { FullTaskItem, renderTaskCard, TaskCardItem } from "./TaskCardItem";

const GradesView = dynamic(() => import("./GradesView").then((m) => m.GradesView), { ssr: false });

export type { FullTaskItem };
export { renderTaskCard };

export type TasksTabMode = "pending" | "overdue" | "done";

export function TasksTodoBoard({
  tasks,
  isLinked,
  layoutPrefix = "mobile-tasks",
}: {
  tasks: FullTaskItem[];
  isLinked: boolean;
  layoutPrefix?: string;
}) {
  const [activeTab, setActiveTab] = useState<TasksTabMode>("pending");
  const [selectedSubject, setSelectedSubject] = useState<string>("");

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

  // Якщо обраний предмет зник у новій вкладці — скидаємо фільтр предмета
  const effectiveSubject = useMemo(() => {
    if (!selectedSubject) return "";
    return subjects.some((s) => s.name === selectedSubject) ? selectedSubject : "";
  }, [selectedSubject, subjects]);

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

      {/* 3 Status Segmented Pills: [ До здачі | Борги | Здано ] */}
      <div
        role="tablist"
        aria-label="Категорії завдань"
        className={`relative grid ${
          isLinked ? "grid-cols-3" : "grid-cols-2"
        } gap-1 rounded-xl border border-sys-border bg-sys-bg p-1 text-xs font-semibold shadow-2xs select-none`}
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "pending"}
          onClick={() => setActiveTab("pending")}
          className={`relative isolate z-10 flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg transition-colors duration-fast ease-smooth cursor-pointer active:scale-[0.98] ${
            activeTab === "pending"
              ? "text-white font-bold"
              : "text-sys-text-secondary hover:text-sys-text-primary"
          }`}
        >
          {activeTab === "pending" && (
            <motion.div
              layoutId={`${layoutPrefix}-status-pill`}
              className="absolute inset-0 rounded-lg bg-sys-accentSolid shadow-xs -z-10"
              transition={{ type: "tween", duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            />
          )}
          <span className="truncate">До здачі</span>
          <span
            className={`inline-flex h-4 min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold ${
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
          className={`relative isolate z-10 flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg transition-colors duration-fast ease-smooth cursor-pointer active:scale-[0.98] ${
            activeTab === "overdue"
              ? "text-white font-bold"
              : overdueTotalCount > 0 && isLinked
              ? "text-rose-600 dark:text-rose-400 hover:text-rose-500"
              : "text-sys-text-secondary hover:text-sys-text-primary"
          }`}
        >
          {activeTab === "overdue" && (
            <motion.div
              layoutId={`${layoutPrefix}-status-pill`}
              className={`absolute inset-0 rounded-lg shadow-xs -z-10 ${
                isLinked && overdueTotalCount > 0 ? "bg-rose-600" : "bg-sys-accentSolid"
              }`}
              transition={{ type: "tween", duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            />
          )}
          <span className="truncate">{isLinked ? "Борги" : "Минув час"}</span>
          <span
            className={`inline-flex h-4 min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold ${
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
            className={`relative isolate z-10 flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg transition-colors duration-fast ease-smooth cursor-pointer active:scale-[0.98] ${
              activeTab === "done"
                ? "text-white font-bold"
                : "text-sys-text-secondary hover:text-sys-text-primary"
            }`}
          >
            {activeTab === "done" && (
              <motion.div
                layoutId={`${layoutPrefix}-status-pill`}
                className="absolute inset-0 rounded-lg bg-emerald-600 shadow-xs -z-10"
                transition={{ type: "tween", duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              />
            )}
            <span className="truncate">Здано</span>
            <span
              className={`inline-flex h-4 min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold ${
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

      {/* Horizontal Subject Chips (1-tap subject filtering, shown when 2+ subjects exist) */}
      {subjects.length > 1 && (
        <div
          role="group"
          aria-label="Фільтр за предметом"
          className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5 -mx-1 px-1"
        >
          <button
            type="button"
            onClick={() => setSelectedSubject("")}
            className={`shrink-0 rounded-xl px-3 py-1.5 text-xs font-semibold border transition-colors duration-fast ease-smooth active:scale-95 cursor-pointer ${
              !effectiveSubject
                ? "bg-sys-accent/15 border-sys-accent/50 text-sys-accent shadow-2xs"
                : "bg-sys-card border-sys-border text-sys-text-secondary hover:text-sys-text-primary hover:border-sys-accent/30"
            }`}
          >
            Усі предмети
          </button>
          {subjects.map((subj) => {
            const isSelected = effectiveSubject === subj.name;
            return (
              <button
                key={subj.name}
                type="button"
                onClick={() => setSelectedSubject(isSelected ? "" : subj.name)}
                className={`shrink-0 rounded-xl px-3 py-1.5 text-xs font-semibold border transition-colors duration-fast ease-smooth flex items-center gap-1.5 active:scale-95 cursor-pointer ${
                  isSelected
                    ? "bg-sys-accent/15 border-sys-accent/50 text-sys-accent shadow-2xs"
                    : "bg-sys-card border-sys-border text-sys-text-secondary hover:text-sys-text-primary hover:border-sys-accent/30"
                }`}
              >
                <span className="truncate max-w-[180px]">{subj.name}</span>
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                    isSelected
                      ? "bg-sys-accent/20 text-sys-accent font-bold"
                      : "bg-sys-bg text-sys-text-muted"
                  }`}
                >
                  {subj.count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Quick Overdue Alert inside "До здачі" tab so student never misses debts */}
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
      {activeTab === "pending" && (
        <div className="space-y-4">
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
        <div className="space-y-2">
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
        <div className="space-y-2">
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
            turnedInTasks.map((t, idx) => (
              <TaskCardItem key={t.id || t.url || `done-${idx}`} task={t} isLinked={isLinked} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function MobileTasksView({
  tasks,
  groupId,
  weekStart,
  lastSyncedAt,
  onSynced,
}: {
  tasks: FullTaskItem[];
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
}) {
  const [viewMode, setViewMode] = useState<"tasks" | "grades">("tasks");
  const { isLinked, isLinkedToGroup } = useClassroomSubmissions();
  const hasAccess = Boolean(groupId && isLinkedToGroup(groupId));

  const { activeCount, totalCount } = useTaskGroups(tasks, "all", undefined, undefined, isLinked);
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
              currentGroupId={groupId}
              weekStart={weekStart}
              onSynced={(id, syncedTasks, lastSynced, isSilent) =>
                onSynced?.(id, syncedTasks, lastSynced, isSilent)
              }
            />
          </div>
        )}
      </div>

      {/* Top Switcher: [ 📋 Завдання | 📊 Оцінки ] */}
      <div className="relative mb-4 grid grid-cols-2 gap-1 rounded-xl border border-sys-border bg-sys-card p-1 text-xs font-semibold shadow-xs select-none">
        <button
          type="button"
          onClick={() => setViewMode("tasks")}
          className={`relative isolate z-10 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg transition-colors duration-fast ease-smooth cursor-pointer active:scale-[0.98] ${
            viewMode === "tasks"
              ? "text-white font-bold"
              : "text-sys-text-secondary hover:text-sys-text-primary"
          }`}
        >
          {viewMode === "tasks" && (
            <motion.div
              layoutId="mobile-view-mode-pill"
              className="absolute inset-0 rounded-lg bg-sys-accentSolid shadow-xs -z-10"
              transition={{ type: "tween", duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            />
          )}
          <span>📋</span>
          <span>Завдання{hasAccess && badgeCount > 0 ? ` (${badgeCount})` : ""}</span>
        </button>
        <button
          type="button"
          onClick={() => setViewMode("grades")}
          className={`relative isolate z-10 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg transition-colors duration-fast ease-smooth cursor-pointer active:scale-[0.98] ${
            viewMode === "grades"
              ? "text-white font-bold"
              : "text-sys-text-secondary hover:text-sys-text-primary"
          }`}
        >
          {viewMode === "grades" && (
            <motion.div
              layoutId="mobile-view-mode-pill"
              className="absolute inset-0 rounded-lg bg-sys-accentSolid shadow-xs -z-10"
              transition={{ type: "tween", duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            />
          )}
          <span>📊</span>
          <span>Оцінки</span>
        </button>
      </div>

      <div className="w-full">
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
        ) : viewMode === "grades" ? (
          <GradesView
            tasks={tasks}
            isLinked={isLinked}
            onSyncClassroom={() =>
              window.dispatchEvent(new CustomEvent("trigger-classroom-sync"))
            }
          />
        ) : (
          <TasksTodoBoard tasks={tasks} isLinked={isLinked} layoutPrefix="mobile-tasks" />
        )}
      </div>
    </div>
  );
}
