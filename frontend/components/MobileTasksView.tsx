"use client";

import { useMemo, useState } from "react";
import { ClassroomTaskItem, getTaskStatusText } from "./LessonCard";
import { ClassroomSyncButton } from "./ClassroomSyncButton";
import { useClassroomSubmissions } from "../lib/useClassroomSubmissions";
import { useTaskGroups, formatTaskWord, TaskFilterState, DEFAULT_TASK_FILTERS } from "../lib/useTaskGroups";
import { TaskFilters } from "./TaskFilters";

export interface FullTaskItem {
  id?: string;
  title: string;
  subject: string;
  teacher?: string | null;
  label: string;
  url: string;
  deadline: ClassroomTaskItem["deadline"];
  state?: string;
  assignedGrade?: number | null;
  maxPoints?: number | null;
  dueDateIso?: string | null;
  isBoundToWeek?: boolean;
}

export function MobileTasksView({
  tasks,
  groupId,
  weekStart,
  weekAnchorDate,
  weekNumber,
  onPrevWeek,
  onNextWeek,
  tasksScope,
  onTasksScopeChange,
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
  onSynced?: (detectedId: number) => void;
}) {
  const [filters, setFilters] = useState<TaskFilterState>(DEFAULT_TASK_FILTERS);
  const { isLinked } = useClassroomSubmissions();

  const [internalScope, setInternalScope] = useState<"week" | "all">("week");
  const scope = tasksScope ?? internalScope;
  const setScope = onTasksScopeChange ?? setInternalScope;

  const [pastWeekOpen, setPastWeekOpen] = useState(true);
  const [userToggledOverdue, setUserToggledOverdue] = useState<boolean | null>(null);
  const overdueOpen = userToggledOverdue !== null ? userToggledOverdue : isLinked;
  const [activeOpen, setActiveOpen] = useState(true);
  const [noDateOpen, setNoDateOpen] = useState(true);
  const [turnedInOpen, setTurnedInOpen] = useState(false);

  const anchor = weekAnchorDate ?? new Date();

  const {
    pastWeekTasks,
    overdueTasks,
    activeTasks,
    noDateTasks,
    turnedInTasks,
    totalCount,
    isOnlyTurnedIn,
    weekLabel,
  } = useTaskGroups(tasks, scope, anchor, weekNumber, isLinked, filters);

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

  const countNoun = formatTaskWord(totalCount);

  return (
    <div className="w-full min-w-0 pb-20 px-4 pt-3">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-sys-text-primary">
            Завдання Classroom
          </h2>
          <div className="flex items-center gap-2 mt-0.5">
            <p className="text-xs text-sys-text-secondary">
              {scope === "week"
                ? `${totalCount} ${countNoun} на цьому тижні`
                : `${totalCount} ${countNoun} загалом`}
            </p>
            {formattedSyncTime && (
              <>
                <span className="text-slate-600 text-xs">•</span>
                <span className="text-[11px] text-sys-text-muted">
                  дані від {formattedSyncTime}
                </span>
              </>
            )}
          </div>
        </div>

        {groupId && (
          <div className="shrink-0">
            <ClassroomSyncButton
              currentGroupId={groupId}
              weekStart={weekStart}
              onSynced={(id) => onSynced?.(id)}
            />
          </div>
        )}
      </div>

      {/* Week Switcher & Scope Segment (Section 22.1) */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        {/* Week Switcher ‹ 19–25 жовт. · 8 тиждень › */}
        <div className="inline-flex items-center gap-1 rounded-xl border border-sys-border bg-sys-card px-1.5 py-1 text-xs shadow-xs">
          {onPrevWeek && (
            <button
              type="button"
              onClick={onPrevWeek}
              aria-label="Попередній тиждень"
              className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-white/5 active:scale-95 transition-all cursor-pointer font-bold"
            >
              ‹
            </button>
          )}
          <span className="px-1.5 font-semibold text-sys-text-primary whitespace-nowrap text-xs">
            {weekLabel}
          </span>
          {onNextWeek && (
            <button
              type="button"
              onClick={onNextWeek}
              aria-label="Наступний тиждень"
              className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-white/5 active:scale-95 transition-all cursor-pointer font-bold"
            >
              ›
            </button>
          )}
        </div>

        {/* Scope Segment [Цей тиждень | Усі] */}
        <div className="inline-flex items-center rounded-xl border border-sys-border bg-sys-card p-0.5 text-xs shadow-xs">
          <button
            type="button"
            onClick={() => setScope("week")}
            className={`rounded-lg px-2.5 py-1 font-semibold transition-all cursor-pointer ${
              scope === "week"
                ? "bg-sys-accent text-[#0b1120] shadow-xs"
                : "text-sys-text-secondary hover:text-white"
            }`}
          >
            Цей тиждень
          </button>
          <button
            type="button"
            onClick={() => setScope("all")}
            className={`rounded-lg px-2.5 py-1 font-semibold transition-all cursor-pointer ${
              scope === "all"
                ? "bg-sys-accent text-[#0b1120] shadow-xs"
                : "text-sys-text-secondary hover:text-white"
            }`}
          >
            Усі
          </button>
        </div>
      </div>

      {/* Unlinked Prompt Banner (Section 17.2) */}
      {!isLinked && (
        <div className="mb-4 rounded-xl border border-sky-500/30 bg-sky-500/10 p-3 text-xs text-sys-text-secondary">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-start gap-2 min-w-0">
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
          <p className="text-[11px] text-slate-400 mt-1.5 pl-5">
            Лише читання, ми нічого не змінюємо в Classroom.
          </p>
        </div>
      )}

      {/* Filters */}
      {tasks.length > 0 && (
        <div className="mb-4">
          <TaskFilters tasks={tasks} value={filters} onChange={setFilters} isLinked={isLinked} />
        </div>
      )}

      {/* Empty State (Section 22.2) */}
      {totalCount === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-sys-border bg-sys-card/30 p-8 text-center text-sys-text-muted mt-2">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-sys-card border border-sys-border text-slate-400 shadow-xs">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect width="18" height="18" x="3" y="4" rx="2" ry="2" />
              <line x1="16" x2="16" y1="2" y2="6" />
              <line x1="8" x2="8" y1="2" y2="6" />
              <line x1="3" x2="21" y1="10" y2="10" />
            </svg>
          </div>
          <p className="text-sm font-semibold text-sys-text-primary">
            {scope === "week" ? "На цьому тижні завдань немає" : "Завдань немає"}
          </p>
          {scope === "week" && (
            <button
              type="button"
              onClick={() => setScope("all")}
              className="mt-3.5 inline-flex items-center gap-1.5 rounded-lg bg-sys-accent/15 border border-sys-accent/30 px-3.5 py-1.5 text-xs font-semibold text-sys-accent hover:bg-sys-accent/25 transition-colors cursor-pointer"
            >
              Переглянути всі
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          {/* Group 0: Past weeks uncompleted overdue tasks (Section 22.1) */}
          {scope === "week" && pastWeekTasks.length > 0 && (
            <section>
              <button
                type="button"
                onClick={() => setPastWeekOpen(!pastWeekOpen)}
                className="mb-2.5 flex w-full items-center justify-between text-left select-none p-1 rounded-lg hover:bg-white/5 transition-colors cursor-pointer"
                aria-expanded={pastWeekOpen}
              >
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full shadow-xs ${isLinked ? "bg-rose-500" : "bg-slate-500"}`} />
                  <h3 className={`text-xs font-bold uppercase tracking-wider ${isLinked ? "text-rose-400" : "text-slate-400"}`}>
                    З минулих тижнів ({pastWeekTasks.length})
                  </h3>
                </div>
                <span className="text-xs text-sys-text-muted">
                  {pastWeekOpen ? "Згорнути ▴" : "Показати ▾"}
                </span>
              </button>
              {pastWeekOpen && (
                <div className="space-y-2 animate-in fade-in duration-150">
                  {pastWeekTasks.map((t, idx) => renderTaskCard(t, `past-${idx}`, isLinked))}
                </div>
              )}
            </section>
          )}

          {/* Group 1: Overdue or Past due */}
          {overdueTasks.length > 0 && (
            <section>
              <button
                type="button"
                onClick={() => setUserToggledOverdue(!overdueOpen)}
                className="mb-2.5 flex w-full items-center justify-between text-left select-none p-1 rounded-lg hover:bg-white/5 transition-colors cursor-pointer"
                aria-expanded={overdueOpen}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2 w-2 rounded-full shadow-xs ${
                      isLinked ? "bg-rose-500" : "bg-slate-500"
                    }`}
                  />
                  <h3
                    className={`text-xs font-bold uppercase tracking-wider ${
                      isLinked ? "text-rose-400" : "text-slate-400"
                    }`}
                  >
                    {isLinked
                      ? `Прострочено (${overdueTasks.length})`
                      : `Термін минув (${overdueTasks.length})`}
                  </h3>
                </div>
                <span className="text-xs text-sys-text-muted">
                  {overdueOpen ? "Згорнути ▴" : "Показати ▾"}
                </span>
              </button>
              {overdueOpen && (
                <div className="space-y-2 animate-in fade-in duration-150">
                  {overdueTasks.map((t, idx) => renderTaskCard(t, `overdue-${idx}`, isLinked))}
                </div>
              )}
            </section>
          )}

          {/* Group 2: Active / Upcoming with date */}
          {activeTasks.length > 0 && (
            <section>
              <button
                type="button"
                onClick={() => setActiveOpen(!activeOpen)}
                className="mb-2.5 flex w-full items-center justify-between text-left select-none p-1 rounded-lg hover:bg-white/5 transition-colors cursor-pointer"
                aria-expanded={activeOpen}
              >
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-sys-accent shadow-xs" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-sys-text-secondary">
                    Активні ({activeTasks.length})
                  </h3>
                </div>
                <span className="text-xs text-sys-text-muted">
                  {activeOpen ? "Згорнути ▴" : "Показати ▾"}
                </span>
              </button>
              {activeOpen && (
                <div className="space-y-2 animate-in fade-in duration-150">
                  {activeTasks.map((t, idx) => renderTaskCard(t, `active-${idx}`, isLinked))}
                </div>
              )}
            </section>
          )}

          {/* Group 3: No due date */}
          {noDateTasks.length > 0 && (
            <section>
              <button
                type="button"
                onClick={() => setNoDateOpen(!noDateOpen)}
                className="mb-2.5 flex w-full items-center justify-between text-left select-none p-1 rounded-lg hover:bg-white/5 transition-colors cursor-pointer"
                aria-expanded={noDateOpen}
              >
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-slate-400 shadow-xs" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                    Без терміну ({noDateTasks.length})
                  </h3>
                </div>
                <span className="text-xs text-sys-text-muted">
                  {noDateOpen ? "Згорнути ▴" : "Показати ▾"}
                </span>
              </button>
              {noDateOpen && (
                <div className="space-y-2 animate-in fade-in duration-150">
                  {noDateTasks.map((t, idx) => renderTaskCard(t, `nodate-${idx}`, isLinked))}
                </div>
              )}
            </section>
          )}

          {/* Empty state when only turned-in tasks exist (Section 22.2) */}
          {isOnlyTurnedIn && (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-950/20 px-3.5 py-2.5 text-xs text-emerald-400 font-medium select-none shadow-xs">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-emerald-400">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span>Нічого не горить</span>
            </div>
          )}

          {/* Group 4: Turned In / Returned */}
          {turnedInTasks.length > 0 && (
            <section className="pt-1">
              <button
                type="button"
                onClick={() => setTurnedInOpen(!turnedInOpen)}
                className="mb-2.5 flex w-full items-center justify-between text-left select-none p-1 rounded-lg hover:bg-white/5 transition-colors cursor-pointer"
                aria-expanded={turnedInOpen}
              >
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-xs" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                    Здано ({turnedInTasks.length})
                  </h3>
                </div>
                <span className="text-xs text-sys-text-muted">
                  {turnedInOpen ? "Згорнути ▴" : "Показати ▾"}
                </span>
              </button>
              {turnedInOpen && (
                <div className="space-y-2 animate-in fade-in duration-150">
                  {turnedInTasks.map((t, idx) => renderTaskCard(t, `done-${idx}`, isLinked))}
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}

export function renderTaskCard(t: FullTaskItem, key: string, isLinked: boolean = false) {
  const isGenericTitle = !t.title || t.title === "Домашнє завдання" || t.title === "Завдання";
  const titleLine = isGenericTitle ? t.subject : t.title;
  const teacherLine = isGenericTitle ? (t.teacher || null) : `${t.subject}${t.teacher ? ` · ${t.teacher}` : ""}`;
  
  const isTurnedIn = t.state === "TURNED_IN";
  const isReturned = t.state === "RETURNED";
  const isUnknown = t.state === "UNKNOWN";
  const isDone = isTurnedIn || isReturned;

  const isOverdue = !isDone && !isUnknown && t.deadline.badgeTone === "overdue";
  const isUrgent = !isDone && !isUnknown && t.deadline.badgeTone === "urgent";

  let statusText = getTaskStatusText(t.deadline, isLinked);
  let statusColor = "#a1a1aa";
  let dotColor = "#71717a";

  if (isReturned) {
    statusText = t.assignedGrade != null ? `Оцінка: ${t.assignedGrade}/${t.maxPoints || 100}` : "Перевірено";
    statusColor = "#34d399";
    dotColor = "#10b981";
  } else if (isTurnedIn) {
    statusText = "Здано";
    statusColor = "#34d399";
    dotColor = "#10b981";
  } else if (isUnknown) {
    statusText = "статус невідомий";
    statusColor = "#94a3b8";
    dotColor = "#64748b";
  } else if (isOverdue) {
    if (isLinked) {
      statusColor = "#f87171";
      dotColor = "#ef4444";
    } else {
      statusColor = "#a1a1aa";
      dotColor = "#71717a";
    }
  } else if (isUrgent) {
    statusColor = "#fbbf24";
    dotColor = "#f59e0b";
  }

  return (
    <a
      key={key}
      href={t.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group block min-h-[76px] rounded-xl bg-[#16161a] border border-[#27272a] p-3.5 transition-all hover:border-slate-600 hover:bg-[#1a1a20] cursor-pointer shadow-xs text-left active:scale-[0.99] overflow-hidden"
      style={{
        boxShadow: isDone
          ? "inset 3px 0 0 #10b981"
          : isOverdue && isLinked
          ? "inset 3px 0 0 #ef4444"
          : isUrgent
          ? "inset 3px 0 0 #f59e0b"
          : undefined,
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-sm font-semibold text-sys-text-primary leading-snug line-clamp-2 break-words group-hover:text-sys-accent transition-colors flex-1">
          {titleLine}
        </h4>
        <span className="text-slate-400 group-hover:text-white transition-colors text-xs shrink-0 mt-0.5">
          ↗
        </span>
      </div>

      {teacherLine && (
        <p className="text-xs text-sys-text-muted mt-1 break-words line-clamp-2">
          {teacherLine}
        </p>
      )}

      {statusText ? (
        <div
          className="mt-2 flex items-center gap-1.5 text-xs font-medium"
          style={{ color: statusColor }}
        >
          <span
            className="h-1.5 w-1.5 rounded-full shrink-0"
            style={{ backgroundColor: dotColor }}
          />
          <span>{statusText}</span>
        </div>
      ) : null}
    </a>
  );
}
