"use client";

import React from "react";
import { AnimatePresence, m } from "framer-motion";
import { Lesson } from "../../lib/api";
import {
  ClassroomTaskItem,
  formatTaskCount,
  getTaskDeadlineDotColor,
  getTaskDeadlineTextColor,
  getTaskStatusText,
  vibrateTap,
} from "../../lib/lesson-card";
import { PersonalSubmission, extractClassroomTaskKey } from "../../lib/useClassroomSubmissions";
import { CloseIcon } from "../ui/Icons";

interface GroupedTasks {
  teacher: string | null;
  items: ClassroomTaskItem[];
}

function ClipboardIcon({ className = "shrink-0 text-sys-text-muted" }: { className?: string }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M16 4h2a2 2 0 0 1 2 2v14l-8-4-8 4V6a2 2 0 0 1 2-2h2" />
      <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
    </svg>
  );
}

function getDeadlineAccentShadow(highlightTask: ClassroomTaskItem | null, isLinked: boolean): string | undefined {
  if (!highlightTask) return undefined;
  if (isLinked && highlightTask.deadline.badgeTone === "overdue") return "inset 3px 0 0 #ef4444";
  if (highlightTask.deadline.badgeTone === "urgent") return "inset 3px 0 0 #f59e0b";
  if (highlightTask.deadline.formattedDate) return "inset 3px 0 0 #8b5cf6";
  return undefined;
}

function ActiveTasksList({
  groups,
  isLinked,
  isMobile,
  isWeek = false,
}: {
  groups: GroupedTasks[];
  isLinked: boolean;
  isMobile: boolean;
  isWeek?: boolean;
}) {
  return (
    <>
      {groups.map((group, gIdx) => (
        <div key={gIdx} className={isWeek ? "flex flex-col gap-1" : "flex flex-col gap-1.5"}>
          {group.teacher && (
            <span className={isWeek ? "text-xs font-bold text-sys-text-secondary pt-0.5" : "text-xs font-bold text-sys-text-secondary px-1 pt-0.5"}>
              {group.teacher}:
            </span>
          )}
          {group.items.map((task, idx) =>
            isWeek ? (
              <a
                key={idx}
                href={task.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => {
                  e.stopPropagation();
                  vibrateTap(10);
                }}
                title={`${task.teacher ? `[${task.teacher}] ` : ""}${task.title || "Завдання"} — Відкрити в Classroom`}
                className="group flex items-center justify-between gap-2 rounded-lg border border-sys-border bg-sys-bg/80 px-2.5 py-1.5 text-xs text-sys-text-primary hover:border-sys-elevated-border hover:bg-sys-surface transition-colors"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="font-semibold text-sys-text-primary truncate text-xs group-hover:text-sys-accent transition-colors">
                    {task.title || "Завдання"}
                  </span>
                  {!group.teacher && task.teacher && (
                    <span className="text-[11px] text-sys-text-muted truncate">({task.teacher})</span>
                  )}
                  {task.deadline.statusText ? (
                    <span className={`text-xs ${getTaskDeadlineTextColor(task.deadline.badgeTone, isLinked)}`}>
                      {getTaskStatusText(task.deadline, isLinked)}
                    </span>
                  ) : null}
                </div>
                <span className="shrink-0 text-xs text-sys-text-muted group-hover:text-sys-accent transition-colors ml-1">
                  ↗
                </span>
              </a>
            ) : (
              <a
                key={idx}
                href={task.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => {
                  e.stopPropagation();
                  vibrateTap(10);
                }}
                className={`group flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-xs hover:bg-sys-card transition-colors ${
                  isMobile ? "min-h-[44px]" : ""
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-semibold text-sys-text-primary group-hover:text-sys-accent transition-colors truncate">
                    {task.title || "Завдання"}
                  </span>
                  {!group.teacher && task.teacher && (
                    <span className="text-sys-text-muted text-xs truncate">({task.teacher})</span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {task.deadline.statusText ? (
                    <span className={`text-xs font-medium ${getTaskDeadlineTextColor(task.deadline.badgeTone, isLinked)}`}>
                      {getTaskStatusText(task.deadline, isLinked)}
                    </span>
                  ) : null}
                  <span className="text-sys-text-muted group-hover:text-sys-text-primary transition-colors text-xs">↗</span>
                </div>
              </a>
            )
          )}
        </div>
      ))}
    </>
  );
}

function CompletedTasksList({
  completedCount,
  groups,
  submissions,
  variant,
}: {
  completedCount: number;
  groups: GroupedTasks[];
  submissions: Record<string, PersonalSubmission>;
  variant: "desktop" | "mobile" | "week";
}) {
  if (completedCount === 0) return null;

  const isWeek = variant === "week";
  const isMobile = variant === "mobile";

  return (
    <div className={`pt-2 mt-1 ${isWeek ? "border-t border-sys-border/50" : "border-t border-sys-border/40"} flex flex-col gap-1.5`}>
      <div
        className={`flex items-center ${
          isWeek ? "gap-1" : "gap-1.5 px-1"
        } text-[11px] font-semibold text-emerald-700 dark:text-emerald-400`}
      >
        <svg width={isWeek ? 12 : 13} height={isWeek ? 12 : 13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
        <span>Здані завдання ({completedCount})</span>
      </div>
      {groups.map((group, gIdx) => (
        <div key={gIdx} className={isWeek ? "flex flex-col gap-1" : "flex flex-col gap-1.5"}>
          {group.teacher && (
            <span className={isWeek ? "text-xs font-bold text-sys-text-secondary pt-0.5" : "text-xs font-bold text-sys-text-secondary px-1 pt-0.5"}>
              {group.teacher}:
            </span>
          )}
          {group.items.map((task, idx) => {
            const key = extractClassroomTaskKey(task.url);
            const sub = submissions[task.url] || (key ? submissions[key] : null);
            const isGraded = sub?.state === "RETURNED" && sub?.grade != null;
            const gradeText = isGraded ? `Оцінка: ${sub.grade}/${sub.maxPoints || 100}` : "Здано";

            if (isWeek) {
              return (
                <a
                  key={`wk-cm-${idx}`}
                  href={task.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => {
                    e.stopPropagation();
                    vibrateTap(10);
                  }}
                  className="group flex items-center justify-between gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] px-2.5 py-1.5 text-xs text-sys-text-primary hover:bg-emerald-500/10 transition-colors"
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="font-semibold text-sys-text-primary truncate text-xs group-hover:text-sys-accent transition-colors">
                      {task.title || "Завдання"}
                    </span>
                    {!group.teacher && task.teacher && (
                      <span className="text-[11px] text-sys-text-muted truncate">({task.teacher})</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 ml-1">
                    <span className="inline-flex items-center text-[10px] font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-500/15 px-1.5 py-0.5 rounded">
                      {gradeText}
                    </span>
                    <span className="text-sys-text-muted group-hover:text-sys-text-primary text-xs">↗</span>
                  </div>
                </a>
              );
            }

            if (isMobile) {
              return (
                <a
                  key={`mb-cm-${idx}`}
                  href={task.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => {
                    e.stopPropagation();
                    vibrateTap(10);
                  }}
                  className="group flex items-start justify-between gap-2 rounded-lg p-2 text-xs hover:bg-emerald-500/10 transition-colors bg-emerald-500/[0.03] border border-emerald-500/20"
                >
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="font-semibold text-sys-text-primary group-hover:text-sys-accent transition-colors line-clamp-2 break-words leading-tight">
                      {task.title || "Завдання"}
                    </span>
                    {!group.teacher && task.teacher && (
                      <span className="text-sys-text-muted text-[11px] mt-0.5 truncate">({task.teacher})</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 ml-1.5 mt-0.5">
                    <span className="inline-flex items-center text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-500/15 px-1.5 py-0.5 rounded">
                      {gradeText}
                    </span>
                    <span className="text-sys-text-muted group-hover:text-sys-text-primary text-xs">↗</span>
                  </div>
                </a>
              );
            }

            return (
              <a
                key={`dt-cm-${idx}`}
                href={task.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => {
                  e.stopPropagation();
                  vibrateTap(10);
                }}
                className="group flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-xs hover:bg-emerald-500/10 transition-colors bg-emerald-500/[0.03] border border-emerald-500/20"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-semibold text-sys-text-primary group-hover:text-sys-accent transition-colors truncate">
                    {task.title || "Завдання"}
                  </span>
                  {!group.teacher && task.teacher && (
                    <span className="text-sys-text-muted text-xs truncate">({task.teacher})</span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-500/15 px-2 py-0.5 rounded-md">
                    {gradeText}
                  </span>
                  <span className="text-sys-text-muted group-hover:text-sys-text-primary transition-colors text-xs">↗</span>
                </div>
              </a>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function DayTasksSection({
  variant,
  lesson,
  tasks,
  highlightTask,
  groupedTasks,
  completedTasksCount,
  groupedCompletedTasks,
  submissions,
  isDualTeachers,
  isLinked,
  isHwOpen,
  onToggleHw,
}: {
  variant: "desktop" | "mobile";
  lesson: Lesson;
  tasks: ClassroomTaskItem[];
  highlightTask: ClassroomTaskItem | null;
  groupedTasks: GroupedTasks[];
  completedTasksCount: number;
  groupedCompletedTasks: GroupedTasks[];
  submissions: Record<string, PersonalSubmission>;
  isDualTeachers: boolean;
  isLinked: boolean;
  isHwOpen: boolean;
  onToggleHw: (e: React.MouseEvent | React.KeyboardEvent) => void;
}) {
  if (tasks.length === 0) return null;

  const isMobile = variant === "mobile";

  if (tasks.length === 1) {
    const task = tasks[0];
    const titleLabel =
      task.title && task.title !== "Домашнє завдання" && task.title !== "Завдання"
        ? `${task.title}${isDualTeachers && task.teacher ? ` (${task.teacher})` : ""}`
        : `${lesson.subject_name}${task.teacher ? ` · ${task.teacher}` : ""}`;

    return (
      <a
        href={task.url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => {
          e.stopPropagation();
          vibrateTap(10);
        }}
        className={`group flex w-full ${
          isMobile
            ? "min-h-[44px] items-start justify-between rounded-xl bg-sys-bg/60 border border-sys-border px-3.5 py-2.5 text-xs text-sys-text-secondary hover:border-sys-border-elevated hover:bg-sys-bg transition-colors duration-fast ease-smooth shadow-xs cursor-pointer mt-1 overflow-hidden"
            : "items-center justify-between rounded-xl bg-sys-bg/60 border border-sys-border px-3.5 py-2.5 text-xs text-sys-text-secondary hover:border-sys-border-elevated hover:bg-sys-bg transition-colors duration-fast ease-smooth shadow-xs cursor-pointer overflow-hidden"
        }`}
        style={{ boxShadow: getDeadlineAccentShadow(task, isLinked) }}
      >
        {isMobile ? (
          <>
            <div className="flex items-start gap-2 min-w-0 flex-1">
              <ClipboardIcon className="shrink-0 mt-0.5 text-sys-text-muted group-hover:text-sys-accent transition-colors" />
              <div className="flex flex-col min-w-0 flex-1 pr-1">
                <span className="font-semibold text-sys-text-primary group-hover:text-sys-accent transition-colors line-clamp-2 break-words leading-tight">
                  {titleLabel}
                </span>
                {task.deadline.statusText ? (
                  <div className="flex items-center gap-1.5 mt-1 text-xs font-medium">
                    <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${getTaskDeadlineDotColor(task.deadline.badgeTone, isLinked)}`} />
                    <span className={getTaskDeadlineTextColor(task.deadline.badgeTone, isLinked)}>
                      {getTaskStatusText(task.deadline, isLinked)}
                    </span>
                  </div>
                ) : null}
              </div>
            </div>
            <div className="shrink-0 ml-1.5 mt-0.5">
              <span className="text-sys-text-muted group-hover:text-sys-text-primary transition-colors text-xs">↗</span>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 min-w-0">
              <ClipboardIcon className="shrink-0 text-sys-text-muted group-hover:text-sys-accent transition-colors" />
              <span className="font-semibold text-sys-text-primary group-hover:text-sys-accent transition-colors truncate">
                {titleLabel}
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0 ml-3">
              {task.deadline.statusText ? (
                <span className={`inline-flex items-center gap-1.5 font-medium ${getTaskDeadlineTextColor(task.deadline.badgeTone, isLinked)}`}>
                  <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${getTaskDeadlineDotColor(task.deadline.badgeTone, isLinked)}`} />
                  <span>{getTaskStatusText(task.deadline, isLinked)}</span>
                </span>
              ) : null}
              <span className="text-sys-text-muted group-hover:text-sys-text-primary transition-colors text-xs ml-1">↗</span>
            </div>
          </>
        )}
      </a>
    );
  }

  return (
    <div
      className={`w-full rounded-xl bg-sys-bg/60 border border-sys-border transition-[opacity,border-color] duration-fast ease-smooth overflow-hidden shadow-xs ${
        isMobile ? "mt-1" : ""
      }`}
      style={{ boxShadow: getDeadlineAccentShadow(highlightTask, isLinked) }}
    >
      <div
        onClick={onToggleHw}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onToggleHw(e);
        }}
        className={`flex ${
          isMobile ? "min-h-[44px]" : ""
        } w-full items-center justify-between px-3.5 py-2.5 cursor-pointer select-none gap-2 hover:bg-sys-card transition-colors`}
      >
        <div className="flex items-center gap-2 shrink-0">
          {isMobile && highlightTask?.deadline.badgeTone === "overdue" && isLinked ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-rose-600 dark:text-rose-400 shrink-0">
              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          ) : (
            <ClipboardIcon />
          )}
          <span className="text-xs font-bold text-sys-text-primary whitespace-nowrap">
            {formatTaskCount(tasks.length)}
          </span>
        </div>
        <div className="flex items-center gap-2 min-w-0 justify-end ml-auto">
          {highlightTask?.deadline.statusText ? (
            <span className={`inline-flex items-center gap-1.5 font-medium text-xs min-w-0 ${getTaskDeadlineTextColor(highlightTask.deadline.badgeTone, isLinked)}`}>
              <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${getTaskDeadlineDotColor(highlightTask.deadline.badgeTone, isLinked)}`} />
              <span className="truncate">{getTaskStatusText(highlightTask.deadline, isLinked)}</span>
            </span>
          ) : null}
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`text-sys-text-muted transition-transform duration-200 shrink-0 ${isHwOpen ? "rotate-180" : ""}`}
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateRows: isHwOpen ? "1fr" : "0fr",
          transition: isMobile
            ? "grid-template-rows 0.20s cubic-bezier(0.25, 1, 0.5, 1), opacity 0.16s ease"
            : "grid-template-rows 0.28s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.22s ease",
          opacity: isHwOpen ? 1 : 0,
        }}
        className="w-full overflow-hidden"
      >
        <div className="min-h-0 overflow-hidden">
          <div className="flex flex-col gap-2 p-3 border-t border-sys-border/60 bg-sys-bg/40">
            <ActiveTasksList groups={groupedTasks} isLinked={isLinked} isMobile={isMobile} />
            <CompletedTasksList
              completedCount={completedTasksCount}
              groups={groupedCompletedTasks}
              submissions={submissions}
              variant={variant}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export function WeekTasksTrigger({
  lesson,
  tasks,
  isLinked,
  isHwOpen,
  onToggleHw,
}: {
  lesson: Lesson;
  tasks: ClassroomTaskItem[];
  isLinked: boolean;
  isHwOpen: boolean;
  onToggleHw: (e: React.MouseEvent | React.KeyboardEvent) => void;
}) {
  if (tasks.length === 0) return null;
  const firstDeadlineText = getTaskStatusText(tasks[0].deadline, isLinked) || "без терміну";

  return (
    <button
      type="button"
      onClick={onToggleHw}
      aria-expanded={isHwOpen}
      aria-controls={`hw-list-${lesson.id}-${lesson.lesson_number}`}
      title={isHwOpen ? "Згорнути завдання" : `${tasks.length} ДЗ (${firstDeadlineText})`}
      aria-label={isHwOpen ? "Згорнути завдання" : `${tasks.length} ДЗ (${firstDeadlineText})`}
      className={`inline-flex h-6 min-h-[24px] items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold transition-colors duration-fast ease-smooth active:scale-95 ${
        tasks[0].deadline.badgeTone === "overdue" && isLinked
          ? "border-rose-500/40 bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-300 hover:border-rose-500/60"
          : tasks[0].deadline.badgeTone === "urgent"
          ? "border-amber-500/40 bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-300 hover:border-amber-500/60"
          : "border-purple-500/30 bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-300 hover:border-purple-500/50"
      }`}
    >
      {tasks[0].deadline.badgeTone === "overdue" && isLinked ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-rose-600 dark:text-rose-400 shrink-0">
          <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      ) : null}
      <span>{tasks.length} ДЗ</span>
      <span className={`text-xs text-sys-text-muted transition-transform duration-150 ${isHwOpen ? "rotate-180" : ""}`}>
        ▾
      </span>
    </button>
  );
}

export function WeekTasksPopover({
  show,
  lesson,
  tasks,
  nearestDated,
  groupedTasks,
  completedTasksCount,
  groupedCompletedTasks,
  submissions,
  isLinked,
  onClose,
  onToggleHw,
}: {
  show: boolean;
  lesson: Lesson;
  tasks: ClassroomTaskItem[];
  nearestDated: ClassroomTaskItem | null;
  groupedTasks: GroupedTasks[];
  completedTasksCount: number;
  groupedCompletedTasks: GroupedTasks[];
  submissions: Record<string, PersonalSubmission>;
  isLinked: boolean;
  onClose: () => void;
  onToggleHw: (e: React.MouseEvent | React.KeyboardEvent) => void;
}) {
  return (
    <AnimatePresence>
      {show && (
        <>
          <m.div
            key="hw-list-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-40"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
          />
          <m.div
            key={`hw-list-${lesson.id}-${lesson.lesson_number}`}
            id={`hw-list-${lesson.id}-${lesson.lesson_number}`}
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, scale: 0.95, y: lesson.lesson_number >= 3 ? 6 : -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: lesson.lesson_number >= 3 ? 6 : -6 }}
            transition={{ type: "spring", stiffness: 350, damping: 28 }}
            className={`absolute left-0 right-0 ${
              lesson.lesson_number >= 3 ? "bottom-full mb-1.5" : "top-full mt-1.5"
            } z-50 max-h-64 overflow-y-auto rounded-xl border border-sys-border bg-sys-card p-2.5 shadow-2xl min-w-[220px]`}
          >
            <div className="flex items-center justify-between pb-1.5 mb-2 border-b border-sys-border/60 text-xs font-semibold text-sys-text-secondary">
              <span className="flex items-center gap-1.5 truncate">
                <span className="font-bold text-sys-text-primary">{formatTaskCount(tasks.length)}</span>
                {nearestDated && (
                  <span className="text-xs text-sys-text-muted truncate">
                    (найближче {nearestDated.deadline.statusText.startsWith("до") ? nearestDated.deadline.statusText : `до ${nearestDated.deadline.formattedDate}`})
                  </span>
                )}
              </span>
              <button
                type="button"
                onClick={onToggleHw}
                aria-label="Закрити"
                className="rounded p-0.5 text-sys-text-muted hover:text-sys-text-primary hover:bg-sys-bg transition-colors shrink-0 ml-1 cursor-pointer"
              >
                <CloseIcon className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="flex flex-col gap-1.5">
              <ActiveTasksList groups={groupedTasks} isLinked={isLinked} isMobile={false} isWeek />
              <CompletedTasksList
                completedCount={completedTasksCount}
                groups={groupedCompletedTasks}
                submissions={submissions}
                variant="week"
              />
            </div>
          </m.div>
        </>
      )}
    </AnimatePresence>
  );
}
