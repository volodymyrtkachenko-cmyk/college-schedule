"use client";

import React, { memo, useState } from "react";
import { ClassroomTaskItem, getTaskStatusText } from "./LessonCard";
import {
  formatBriefChipLabel,
  formatTaskWeightBadge,
  getNavigatorTaskKey,
  hasExpandableBrief,
  openTaskDetailModal,
  resolveEffectiveTaskBrief,
  type TaskBrief,
} from "../lib/schedule";
import { formatTaskGradeDisplay } from "../lib/useGradesSummary";
import { markPendingClassroomReturn, setTaskManualDone } from "../lib/useClassroomSubmissions";
import { TaskChecklistSection } from "./TaskChecklistSection";
import { useOptionalToast } from "./ToastProvider";
import { CheckIcon } from "./ui/Icons";

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
  brief?: TaskBrief | null;
}

export interface TaskCardItemProps {
  task: FullTaskItem;
  isLinked?: boolean;
}

export const TaskCardItem = memo(function TaskCardItem({
  task: t,
  isLinked = false,
}: TaskCardItemProps) {
  const [briefOpen, setBriefOpen] = useState(false);
  const optionalToast = useOptionalToast();

  const isGenericTitle = !t.title || t.title === "Домашнє завдання" || t.title === "Завдання";
  const titleLine = isGenericTitle ? t.subject : t.title;
  const teacherLine = isGenericTitle ? (t.teacher || null) : `${t.subject}${t.teacher ? ` · ${t.teacher}` : ""}`;
  
  const isTurnedIn = t.state === "TURNED_IN";
  const isReturned = t.state === "RETURNED";
  const isManualDone = t.state === "MANUAL_DONE";
  const isUnknown = t.state === "UNKNOWN";
  const isDone = isTurnedIn || isReturned || isManualDone;

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
  } else if (isManualDone) {
    statusText = "Відмічено вручну";
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

  const handleMarkManualDone = () => {
    setTaskManualDone({ url: t.url, id: t.id }, true);
    optionalToast?.showToast("Перенесено у «Здано» (відмічено вручну)", "success");
  };

  const handleUnmarkManualDone = () => {
    setTaskManualDone({ url: t.url, id: t.id }, false);
    optionalToast?.showToast("Позначку здачі скасовано", "info");
  };

  if (isDone) {
    if (isManualDone && isLinked) {
      return (
        <div
          className="min-h-[76px] rounded-xl bg-sys-card border border-sys-border p-3.5 transition-colors duration-fast ease-smooth hover:border-sys-border-elevated shadow-xs text-left overflow-hidden [content-visibility:auto] [contain-intrinsic-size:78px]"
          style={{
            boxShadow: borderAccentStyle,
          }}
        >
          <div className="flex items-start justify-between gap-2">
            <button
              type="button"
              onClick={() => openTaskDetailModal({ task: t })}
              className="group block flex-1 min-w-0 text-left cursor-pointer"
            >
              <h4 className="text-sm font-semibold text-sys-text-primary leading-snug line-clamp-2 break-words group-hover:text-sys-accent transition-colors">
                {titleLine}
              </h4>

              {teacherLine && (
                <p className="text-xs text-sys-text-muted mt-1 break-words line-clamp-2">
                  {teacherLine}
                </p>
              )}
            </button>
            <a
              href={t.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => {
                e.stopPropagation();
                markPendingClassroomReturn();
              }}
              aria-label={`Відкрити завдання «${titleLine}» у Google Classroom`}
              title="Відкрити в Classroom"
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-sys-text-muted hover:text-sys-accent hover:bg-sys-bg transition-colors text-xs"
            >
              ↗
            </a>
          </div>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <div className={`flex items-center gap-1.5 text-xs font-medium ${statusColorClass}`}>
              <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dotColorClass}`} />
              <span>{statusText}</span>
            </div>

            <button
              type="button"
              onClick={handleUnmarkManualDone}
              aria-label={`Скасувати ручну позначку здачі для «${titleLine}»`}
              title="Повернути завдання у невиконані"
              className="inline-flex items-center gap-1 min-h-[26px] rounded-md border border-sys-border/80 bg-sys-bg/80 hover:border-rose-500/40 hover:bg-rose-500/10 px-2 py-0.5 text-[11px] font-medium text-sys-text-secondary hover:text-rose-700 dark:hover:text-rose-300 transition-colors cursor-pointer active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sys-accent"
            >
              <span>Скасувати</span>
            </button>
          </div>
        </div>
      );
    }

    return (
      <div
        className="min-h-[76px] rounded-xl bg-sys-card border border-sys-border p-3.5 transition-colors duration-fast ease-smooth hover:border-sys-border-elevated hover:bg-sys-bg/60 shadow-xs text-left overflow-hidden [content-visibility:auto] [contain-intrinsic-size:78px]"
        style={{
          boxShadow: borderAccentStyle,
        }}
      >
        <div className="flex items-start justify-between gap-2">
          <button
            type="button"
            onClick={() => openTaskDetailModal({ task: t })}
            className="group block flex-1 min-w-0 text-left cursor-pointer"
          >
            <h4 className="text-sm font-semibold text-sys-text-primary leading-snug line-clamp-2 break-words group-hover:text-sys-accent transition-colors">
              {titleLine}
            </h4>

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
          </button>
          <a
            href={t.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
              e.stopPropagation();
              markPendingClassroomReturn();
            }}
            aria-label={`Відкрити завдання «${titleLine}» у Google Classroom`}
            title="Відкрити в Classroom"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-sys-text-muted hover:text-sys-accent hover:bg-sys-bg transition-colors text-xs"
          >
            ↗
          </a>
        </div>
      </div>
    );
  }

  const taskKey = getNavigatorTaskKey(t);
  const brief = resolveEffectiveTaskBrief(t);
  const canExpandBrief = hasExpandableBrief(brief);
  const canMarkManualDone = isLinked && isOverdue;
  const chipLabel = formatBriefChipLabel(brief);
  const weightBadge = formatTaskWeightBadge(t.maxPoints ?? null);

  if (!canExpandBrief && !canMarkManualDone) {
    return (
      <div
        className="min-h-[76px] rounded-xl bg-sys-card border border-sys-border p-3.5 transition-colors duration-fast ease-smooth hover:border-sys-border-elevated hover:bg-sys-bg/60 shadow-xs text-left overflow-hidden [content-visibility:auto] [contain-intrinsic-size:78px]"
        style={{
          boxShadow: borderAccentStyle,
        }}
      >
        <div className="flex items-start justify-between gap-2">
          <button
            type="button"
            onClick={() => openTaskDetailModal({ task: t })}
            className="group block flex-1 min-w-0 text-left cursor-pointer"
          >
            <h4 className="text-sm font-semibold text-sys-text-primary leading-snug line-clamp-2 break-words group-hover:text-sys-accent transition-colors">
              {titleLine}
            </h4>

            {teacherLine && (
              <p className="text-xs text-sys-text-muted mt-1 break-words line-clamp-2">
                {teacherLine}
              </p>
            )}
          </button>
          <a
            href={t.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
              e.stopPropagation();
              markPendingClassroomReturn();
            }}
            aria-label={`Відкрити завдання «${titleLine}» у Google Classroom`}
            title="Відкрити в Classroom"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-sys-text-muted hover:text-sys-accent hover:bg-sys-bg transition-colors text-xs"
          >
            ↗
          </a>
        </div>

        {(statusText || weightBadge) && (
          <div className="mt-2 flex items-center justify-between gap-2">
            {statusText ? (
              <div className={`flex items-center gap-1.5 text-xs font-medium ${statusColorClass}`}>
                <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dotColorClass}`} />
                <span>{statusText}</span>
              </div>
            ) : (
              <span />
            )}
            {weightBadge && (
              <span className="text-[11px] font-medium text-sys-text-muted shrink-0">
                {weightBadge.label}
              </span>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className="min-h-[76px] rounded-xl bg-sys-card border border-sys-border p-3.5 transition-colors duration-fast ease-smooth hover:border-sys-border-elevated shadow-xs text-left overflow-hidden"
      style={{
        boxShadow: borderAccentStyle,
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={() => openTaskDetailModal({ task: t })}
          className="group block flex-1 min-w-0 text-left cursor-pointer"
        >
          <h4 className="text-sm font-semibold text-sys-text-primary leading-snug line-clamp-2 break-words group-hover:text-sys-accent transition-colors">
            {titleLine}
          </h4>

          {teacherLine && (
            <p className="text-xs text-sys-text-muted mt-1 break-words line-clamp-2">
              {teacherLine}
            </p>
          )}
        </button>
        <a
          href={t.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => {
            e.stopPropagation();
            markPendingClassroomReturn();
          }}
          aria-label={`Відкрити завдання «${titleLine}» у Google Classroom`}
          title="Відкрити в Classroom"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-sys-text-muted hover:text-sys-accent hover:bg-sys-bg transition-colors text-xs"
        >
          ↗
        </a>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        {statusText ? (
          <div className={`flex items-center gap-1.5 text-xs font-medium ${statusColorClass}`}>
            <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dotColorClass}`} />
            <span>{statusText}</span>
            {!canExpandBrief && weightBadge && (
              <span className="text-[11px] font-medium text-sys-text-muted shrink-0">
                · {weightBadge.label}
              </span>
            )}
          </div>
        ) : (
          <span />
        )}

        <div className="flex flex-wrap items-center gap-1.5">
          {canMarkManualDone && (
            <button
              type="button"
              onClick={handleMarkManualDone}
              aria-label={`Позначити завдання «${titleLine}» як здане`}
              title="Прибрати з боргів і перенести у «Здано»"
              className="inline-flex items-center gap-1 min-h-[26px] rounded-md border border-emerald-500/35 bg-emerald-500/10 hover:bg-emerald-500/20 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:text-emerald-300 transition-colors cursor-pointer active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
            >
              <CheckIcon className="h-3 w-3 shrink-0" />
              <span>Позначити зданим</span>
            </button>
          )}

          {canExpandBrief && (
            <button
              type="button"
              aria-expanded={briefOpen}
              onClick={() => setBriefOpen((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 min-h-[26px] rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors cursor-pointer active:scale-95 ${
                briefOpen
                  ? "border-sys-accent/45 bg-sys-hover text-sys-text-primary"
                  : "border-sys-border/70 bg-sys-bg/80 text-sys-text-secondary hover:text-sys-text-primary hover:border-sys-accent/40 hover:bg-sys-hover"
              }`}
            >
              <span>{chipLabel || "Міні-бриф"}</span>
              <svg
                aria-hidden="true"
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`transition-transform duration-base [transition-timing-function:var(--ease-desktop-panel)] shrink-0 ${briefOpen ? "rotate-180" : ""}`}
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <div
        data-open={briefOpen ? "true" : undefined}
        aria-hidden={!briefOpen}
        className="grid-accordion"
      >
        <div className="grid-accordion-inner">
          <TaskChecklistSection
            taskKey={taskKey}
            brief={brief}
            maxPoints={t.maxPoints}
            compact
          />
        </div>
      </div>
    </div>
  );
});

export function renderTaskCard(t: FullTaskItem, key: string, isLinked: boolean = false) {
  return <TaskCardItem key={t.id || t.url || key} task={t} isLinked={isLinked} />;
}
