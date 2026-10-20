"use client";

import { useMemo } from "react";
import { FullTaskItem } from "./MobileTasksView";
import { TaskFilterState, DEFAULT_TASK_FILTERS } from "../lib/useTaskGroups";

const selectClass =
  "w-full h-9 min-w-0 rounded-lg border border-sys-border bg-sys-card px-2.5 text-xs text-sys-text-primary focus:border-sys-accent focus:outline-none focus:ring-1 focus:ring-sys-accent cursor-pointer";

export function TaskFilters({
  tasks,
  value,
  onChange,
  isLinked,
}: {
  tasks: FullTaskItem[];
  value: TaskFilterState;
  onChange: (next: TaskFilterState) => void;
  isLinked: boolean;
}) {
  const subjects = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks) if (t.subject) set.add(t.subject);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "uk"));
  }, [tasks]);

  const subjectValue = subjects.includes(value.subject) ? value.subject : "";
  const isActive = value.status !== "all" || subjectValue !== "";

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <select
        aria-label="Фільтр за статусом"
        value={value.status}
        onChange={(e) => onChange({ ...value, status: e.target.value as TaskFilterState["status"] })}
        className={selectClass}
      >
        <option value="all">Усі статуси</option>
        <option value="pending">Активні</option>
        <option value="overdue">{isLinked ? "Прострочені" : "Термін минув"}</option>
        {isLinked && <option value="done">Здані</option>}
      </select>
      <select
        aria-label="Фільтр за предметом"
        value={subjectValue}
        onChange={(e) => onChange({ ...value, subject: e.target.value })}
        className={selectClass}
      >
        <option value="">Усі предмети</option>
        {subjects.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      {isActive && (
        <button
          type="button"
          onClick={() => onChange(DEFAULT_TASK_FILTERS)}
          className="shrink-0 self-start rounded-lg px-2 py-1.5 text-xs font-semibold text-sys-accent hover:underline cursor-pointer"
        >
          Скинути
        </button>
      )}
    </div>
  );
}
