"use client";

import React, { memo } from "react";
import { ClassroomTaskItem, getTaskStatusText } from "./LessonCard";
import { formatTaskGradeDisplay } from "../lib/useGradesSummary";

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
  creationTime?: string | null;
  creation_time?: string | null;
  created_at?: string | null;
  isBoundToWeek?: boolean;
}

export interface TaskCardItemProps {
  task: FullTaskItem;
  isLinked?: boolean;
}

export const TaskCardItem = memo(function TaskCardItem({
  task: t,
  isLinked = false,
}: TaskCardItemProps) {
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
  let statusColorClass = "text-sys-text-secondary";
  let dotColorClass = "bg-slate-400";

  if (isReturned) {
    const gradeInfo = formatTaskGradeDisplay(t.assignedGrade, t.maxPoints, t.subject);
    statusText = gradeInfo ? gradeInfo.text : "Перевірено";
    statusColorClass = "text-emerald-700 dark:text-emerald-400";
    dotColorClass = "bg-emerald-600 dark:bg-emerald-400";
  } else if (isTurnedIn) {
    statusText = "Здано";
    statusColorClass = "text-emerald-700 dark:text-emerald-400";
    dotColorClass = "bg-emerald-600 dark:bg-emerald-400";
  } else if (isUnknown) {
    statusText = "статус невідомий";
    statusColorClass = "text-sys-text-muted";
    dotColorClass = "bg-slate-500";
  } else if (isOverdue) {
    if (isLinked) {
      statusColorClass = "text-rose-700 dark:text-rose-400";
      dotColorClass = "bg-rose-600 dark:bg-rose-500";
    } else {
      statusColorClass = "text-sys-text-secondary";
      dotColorClass = "bg-slate-400";
    }
  } else if (isUrgent) {
    statusColorClass = "text-amber-800 dark:text-amber-400";
    dotColorClass = "bg-amber-600 dark:bg-amber-400";
  }

  const borderAccentStyle = isDone
    ? "inset 3px 0 0 #10b981"
    : isOverdue && isLinked
    ? "inset 3px 0 0 #ef4444"
    : isUrgent
    ? "inset 3px 0 0 #f59e0b"
    : undefined;

  return (
    <a
      href={t.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group block min-h-[76px] rounded-xl bg-sys-card border border-sys-border p-3.5 transition-colors duration-fast ease-smooth hover:border-sys-border-elevated hover:bg-sys-bg/60 cursor-pointer shadow-xs text-left active:scale-[0.99] overflow-hidden [content-visibility:auto] [contain-intrinsic-size:78px]"
      style={{
        boxShadow: borderAccentStyle,
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-sm font-semibold text-sys-text-primary leading-snug line-clamp-2 break-words group-hover:text-sys-accent transition-colors flex-1">
          {titleLine}
        </h4>
        <span className="text-sys-text-muted group-hover:text-sys-text-primary transition-colors text-xs shrink-0 mt-0.5">
          ↗
        </span>
      </div>

      {teacherLine && (
        <p className="text-xs text-sys-text-muted mt-1 break-words line-clamp-2">
          {teacherLine}
        </p>
      )}

      {statusText ? (
        <div className={`mt-2 flex items-center gap-1.5 text-xs font-medium ${statusColorClass}`}>
          <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dotColorClass}`} />
          <span>{statusText}</span>
        </div>
      ) : null}
    </a>
  );
});

export function renderTaskCard(t: FullTaskItem, key: string, isLinked: boolean = false) {
  return <TaskCardItem key={t.id || t.url || key} task={t} isLinked={isLinked} />;
}
