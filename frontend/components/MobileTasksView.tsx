"use client";

import { useMemo, useState } from "react";
import { ClassroomTaskItem, sortTasksByDeadline } from "./LessonCard";
import { ClassroomSyncButton } from "./ClassroomSyncButton";
import { useClassroomSubmissions } from "../lib/useClassroomSubmissions";

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
  lastSyncedAt?: string | null;
  onSynced?: (detectedId: number) => void;
}) {
  const [search, setSearch] = useState("");
  const [turnedInOpen, setTurnedInOpen] = useState(false);
  const { linkedEmail, isLinked, unlink } = useClassroomSubmissions();

  const sortedTasks = useMemo(() => {
    return sortTasksByDeadline(tasks);
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    if (!search.trim()) return sortedTasks;
    const q = search.toLowerCase();
    return sortedTasks.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.subject.toLowerCase().includes(q) ||
        (t.teacher && t.teacher.toLowerCase().includes(q))
    );
  }, [sortedTasks, search]);

  // Group 1: Overdue (unsubmitted)
  const overdueTasks = useMemo(() => {
    return filteredTasks.filter(
      (t) =>
        t.deadline.isOverdue &&
        t.state !== "TURNED_IN" &&
        t.state !== "RETURNED" &&
        t.state !== "UNKNOWN"
    );
  }, [filteredTasks]);

  // Group 2: Active / Upcoming with due date
  const activeTasks = useMemo(() => {
    return filteredTasks.filter(
      (t) =>
        !t.deadline.isOverdue &&
        Boolean(t.deadline.date) &&
        t.state !== "TURNED_IN" &&
        t.state !== "RETURNED"
    );
  }, [filteredTasks]);

  // Group 3: No due date (unsubmitted)
  const noDateTasks = useMemo(() => {
    return filteredTasks.filter(
      (t) =>
        !t.deadline.date &&
        t.state !== "TURNED_IN" &&
        t.state !== "RETURNED"
    );
  }, [filteredTasks]);

  // Group 4: Turned In / Returned
  const turnedInTasks = useMemo(() => {
    return filteredTasks.filter(
      (t) => t.state === "TURNED_IN" || t.state === "RETURNED"
    );
  }, [filteredTasks]);

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
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-sys-text-primary">
            Завдання Classroom
          </h2>
          <div className="flex items-center gap-2 mt-0.5">
            <p className="text-xs text-sys-text-secondary">
              {tasks.length} {tasks.length === 1 ? "завдання" : tasks.length < 5 ? "завдання" : "завдань"} загалом
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

      {/* Linked Email Status / Unlink Banner */}
      {isLinked && linkedEmail ? (
        <div className="mb-4 flex items-center justify-between rounded-xl border border-sys-border bg-sys-card px-3.5 py-2.5 text-xs">
          <div className="flex items-center gap-2 truncate">
            <span className="flex h-2 w-2 rounded-full bg-emerald-400 shrink-0" />
            <span className="text-sys-text-secondary truncate">
              Прив'язано: <strong className="text-sys-text-primary">{linkedEmail}</strong>
            </span>
          </div>
          <button
            type="button"
            onClick={unlink}
            className="shrink-0 ml-2 rounded-lg bg-white/5 hover:bg-white/10 px-2 py-1 text-[11px] font-medium text-rose-300 hover:text-rose-200 transition-colors"
          >
            Від'єднати
          </button>
        </div>
      ) : (
        <div className="mb-4 rounded-xl border border-sys-border/50 bg-sys-card/40 px-3.5 py-2.5 text-xs text-sys-text-muted">
          💡 Прив'яжіть пошту через кнопку вище, щоб відстежувати свої здані завдання. Для всіх інших розклад показує всі завдання.
        </div>
      )}

      {/* Search Filter */}
      {tasks.length > 3 && (
        <div className="mb-4 relative">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Пошук завдань або викладачів..."
            className="w-full h-10 rounded-xl border border-sys-border bg-sys-card px-3.5 text-sm text-sys-text-primary placeholder:text-sys-text-muted focus:border-sys-accent focus:outline-none focus:ring-1 focus:ring-sys-accent"
          />
        </div>
      )}

      {tasks.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-sys-border bg-sys-card/30 p-8 text-center text-sys-text-muted">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-sys-card border border-sys-border text-emerald-400 shadow-xs">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          </div>
          <p className="text-sm font-semibold text-sys-text-primary">Немає активних завдань ✓</p>
          <p className="text-xs text-sys-text-secondary mt-1">Всі завдання виконано або дедлайни відсутні</p>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Group 1: Overdue */}
          {overdueTasks.length > 0 && (
            <section>
              <div className="mb-2.5 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-rose-500 shadow-xs" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-rose-400">
                  Прострочено ({overdueTasks.length})
                </h3>
              </div>
              <div className="space-y-2">
                {overdueTasks.map((t, idx) => renderTaskCard(t, `overdue-${idx}`))}
              </div>
            </section>
          )}

          {/* Group 2: Active / Upcoming with date */}
          {activeTasks.length > 0 && (
            <section>
              <div className="mb-2.5 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-sys-accent shadow-xs" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-sys-text-secondary">
                  Активні ({activeTasks.length})
                </h3>
              </div>
              <div className="space-y-2">
                {activeTasks.map((t, idx) => renderTaskCard(t, `active-${idx}`))}
              </div>
            </section>
          )}

          {/* Group 3: No due date */}
          {noDateTasks.length > 0 && (
            <section>
              <div className="mb-2.5 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-slate-400 shadow-xs" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                  Без терміну ({noDateTasks.length})
                </h3>
              </div>
              <div className="space-y-2">
                {noDateTasks.map((t, idx) => renderTaskCard(t, `nodate-${idx}`))}
              </div>
            </section>
          )}

          {/* Group 4: Turned In / Returned */}
          {turnedInTasks.length > 0 && (
            <section className="pt-1">
              <button
                type="button"
                onClick={() => setTurnedInOpen(!turnedInOpen)}
                className="mb-2.5 flex w-full items-center justify-between text-left select-none p-1 rounded-lg hover:bg-white/5 transition-colors"
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
                  {turnedInTasks.map((t, idx) => renderTaskCard(t, `done-${idx}`))}
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}

export function renderTaskCard(t: FullTaskItem, key: string) {
  const isGenericTitle = !t.title || t.title === "Домашнє завдання" || t.title === "Завдання";
  const titleLine = isGenericTitle ? t.subject : t.title;
  const teacherLine = isGenericTitle ? (t.teacher || null) : `${t.subject}${t.teacher ? ` · ${t.teacher}` : ""}`;
  
  const isTurnedIn = t.state === "TURNED_IN";
  const isReturned = t.state === "RETURNED";
  const isUnknown = t.state === "UNKNOWN";
  const isDone = isTurnedIn || isReturned;

  const isOverdue = !isDone && !isUnknown && t.deadline.badgeTone === "overdue";
  const isUrgent = !isDone && !isUnknown && t.deadline.badgeTone === "urgent";

  let statusText = t.deadline.statusText;
  let statusColor = "#a1a1aa";
  let dotColor = "#71717a";

  if (isReturned) {
    statusText = t.assignedGrade != null ? `✓ Оцінка: ${t.assignedGrade}/${t.maxPoints || 100}` : "✓ Перевірено";
    statusColor = "#34d399";
    dotColor = "#10b981";
  } else if (isTurnedIn) {
    statusText = "✓ Здано";
    statusColor = "#34d399";
    dotColor = "#10b981";
  } else if (isUnknown) {
    statusText = "статус невідомий";
    statusColor = "#94a3b8";
    dotColor = "#64748b";
  } else if (isOverdue) {
    statusColor = "#f87171";
    dotColor = "#ef4444";
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
      className="group block min-h-[76px] rounded-xl bg-[#16161a] border border-[#27272a] p-3.5 transition-all hover:border-slate-600 hover:bg-[#1a1a20] cursor-pointer shadow-xs text-left active:scale-[0.99]"
      style={{
        boxShadow: isDone
          ? "inset 3px 0 0 #10b981"
          : isOverdue
          ? "inset 3px 0 0 #ef4444"
          : isUrgent
          ? "inset 3px 0 0 #f59e0b"
          : undefined,
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-sm font-semibold text-sys-text-primary leading-snug line-clamp-2 group-hover:text-sys-accent transition-colors flex-1">
          {titleLine}
        </h4>
        <span className="text-slate-400 group-hover:text-white transition-colors text-xs shrink-0 mt-0.5">
          ↗
        </span>
      </div>

      {teacherLine && (
        <p className="text-xs text-sys-text-muted mt-1 truncate">
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
