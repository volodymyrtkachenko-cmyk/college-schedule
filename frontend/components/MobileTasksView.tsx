"use client";

import { useMemo, useState } from "react";
import { ClassroomTaskItem, sortTasksByDeadline } from "./LessonCard";
import { ClassroomSyncButton } from "./ClassroomSyncButton";

export interface FullTaskItem {
  title: string;
  subject: string;
  teacher?: string | null;
  label: string;
  url: string;
  deadline: ClassroomTaskItem["deadline"];
}

export function MobileTasksView({
  tasks,
  groupId,
  weekStart,
  onSynced,
}: {
  tasks: FullTaskItem[];
  groupId: number | null;
  weekStart?: string;
  onSynced?: (detectedId: number) => void;
}) {
  const [search, setSearch] = useState("");

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

  const overdueTasks = useMemo(() => {
    return filteredTasks.filter((t) => t.deadline.badgeTone === "overdue");
  }, [filteredTasks]);

  const activeTasks = useMemo(() => {
    return filteredTasks.filter((t) => t.deadline.badgeTone !== "overdue");
  }, [filteredTasks]);

  return (
    <div className="w-full min-w-0 pb-20 px-4 pt-3">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-sys-text-primary">
            Завдання Classroom
          </h2>
          <p className="text-xs text-sys-text-secondary mt-0.5">
            {tasks.length} {tasks.length === 1 ? "завдання" : tasks.length < 5 ? "завдання" : "завдань"} загалом
          </p>
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

          {/* Group 2: Active / Upcoming */}
          {activeTasks.length > 0 && (
            <section>
              <div className="mb-2.5 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-sys-accent shadow-xs" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-sys-text-secondary">
                  Активні завдання ({activeTasks.length})
                </h3>
              </div>
              <div className="space-y-2">
                {activeTasks.map((t, idx) => renderTaskCard(t, `active-${idx}`))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function renderTaskCard(t: FullTaskItem, key: string) {
  const isGenericTitle = !t.title || t.title === "Домашнє завдання" || t.title === "Завдання";
  const titleLine = isGenericTitle ? t.subject : t.title;
  const teacherLine = isGenericTitle ? (t.teacher || null) : `${t.subject}${t.teacher ? ` · ${t.teacher}` : ""}`;
  const isOverdue = t.deadline.badgeTone === "overdue";
  const isUrgent = t.deadline.badgeTone === "urgent";

  return (
    <a
      key={key}
      href={t.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group block min-h-[76px] rounded-xl bg-[#16161a] border border-[#27272a] p-3.5 transition-all hover:border-slate-600 hover:bg-[#1a1a20] cursor-pointer shadow-xs text-left active:scale-[0.99]"
      style={{
        boxShadow: isOverdue ? "inset 3px 0 0 #ef4444" : isUrgent ? "inset 3px 0 0 #f59e0b" : undefined,
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

      <div
        className="mt-2 flex items-center gap-1.5 text-xs font-medium"
        style={{ color: isOverdue ? "#f87171" : isUrgent ? "#fbbf24" : "#a1a1aa" }}
      >
        <span
          className="h-1.5 w-1.5 rounded-full shrink-0"
          style={{ backgroundColor: isOverdue ? "#ef4444" : isUrgent ? "#f59e0b" : "#71717a" }}
        />
        <span>{t.deadline.statusText}</span>
      </div>
    </a>
  );
}
