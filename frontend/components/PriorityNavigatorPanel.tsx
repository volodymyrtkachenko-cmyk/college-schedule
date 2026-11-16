"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { ScheduleResponse } from "../lib/api";
import { getKyivNow, subscribeKyivNow, type KyivNowSnapshot } from "../lib/lesson-card/kyivClock";
import {
  PRIORITY_NAV_OPEN_KEY,
  findFreeStudyWindows,
  formatWorkFormatLabel,
  matchTasksToWindows,
  readWindowDecisions,
  saveWindowDecision,
  scorePriorityTasks,
  type WindowDecisionsState,
} from "../lib/schedule/priorityNavigator";
import { useGradesSummary } from "../lib/useGradesSummary";
import { useTaskChecklist } from "../lib/useTaskChecklist";
import type { FullTaskItem } from "./TaskCardItem";

interface PriorityNavigatorPanelProps {
  tasks: FullTaskItem[];
  week?: ScheduleResponse[];
  groupId?: number | null;
  isLinked: boolean;
}

export function PriorityNavigatorPanel({
  tasks,
  week,
  groupId,
  isLinked,
}: PriorityNavigatorPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [kyivNow, setKyivNow] = useState<KyivNowSnapshot | null>(null);
  const [decisions, setDecisions] = useState<WindowDecisionsState>(() => ({
    dateIso: "",
    accepted: [],
    dismissed: [],
  }));

  const { checklistMap } = useTaskChecklist();
  const gradesSummary = useGradesSummary(isLinked ? tasks : [], groupId ?? null);

  useEffect(() => {
    setHydrated(true);
    const now = getKyivNow();
    setKyivNow(now);
    setDecisions(readWindowDecisions(now.dateIso));
    try {
      const saved = localStorage.getItem(PRIORITY_NAV_OPEN_KEY);
      if (saved === "1") setIsOpen(true);
    } catch {}
    return subscribeKyivNow(setKyivNow);
  }, []);

  const effectiveNow = kyivNow;

  const { prioritizedTasks } = useMemo(() => {
    if (!effectiveNow) {
      return { prioritizedTasks: [] };
    }
    return scorePriorityTasks({
      tasks,
      week,
      subjectGrades: gradesSummary.subjects.map((s) => ({
        subject: s.subject,
        average5: s.average5,
        scaleType: s.scaleType,
        level: s.level,
      })),
      isLinked,
      checklistMap,
      now: effectiveNow,
    });
  }, [tasks, week, gradesSummary.subjects, isLinked, checklistMap, effectiveNow]);

  const windowSuggestions = useMemo(() => {
    if (!effectiveNow || prioritizedTasks.length === 0) return [];
    const windows = findFreeStudyWindows(week, effectiveNow);
    return matchTasksToWindows(prioritizedTasks, windows, decisions, 2);
  }, [week, effectiveNow, prioritizedTasks, decisions]);

  if (!hydrated || prioritizedTasks.length === 0) {
    return null;
  }

  const topItems = prioritizedTasks.slice(0, 3);
  const topHint =
    windowSuggestions.length > 0
      ? `є вікно · ${topItems[0].task.subject}`
      : topItems[0].reasonText || `${prioritizedTasks.length} активних`;

  const handleToggle = () => {
    const next = !isOpen;
    setIsOpen(next);
    try {
      localStorage.setItem(PRIORITY_NAV_OPEN_KEY, next ? "1" : "0");
    } catch {}
  };

  const handleWindowDecision = (suggestionId: string, action: "accept" | "dismiss") => {
    if (!effectiveNow) return;
    setDecisions(saveWindowDecision(effectiveNow.dateIso, suggestionId, action));
  };

  return (
    <div className="rounded-xl border border-sys-border bg-sys-card overflow-hidden">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={handleToggle}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-xs transition-colors duration-fast hover:bg-sys-bg/60 cursor-pointer"
      >
        <div className="min-w-0 flex-1 flex items-center gap-1.5">
          <span className="font-semibold text-sys-text-secondary shrink-0">
            Навігатор пріоритетів
          </span>
          {!isOpen && topHint && (
            <span className="truncate text-[11px] text-sys-text-muted">
              · {topHint}
            </span>
          )}
        </div>
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
          className={`shrink-0 text-sys-text-muted transition-transform duration-fast ${
            isOpen ? "rotate-180" : ""
          }`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {isOpen && (
        <div className="border-t border-sys-border/70 px-3 py-2.5 space-y-3 bg-sys-bg/40">
          <div className="space-y-1.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-sys-text-muted">
              Що закрити першим
            </div>
            <ul className="space-y-1.5">
              {topItems.map((entry, idx) => {
                const est = entry.brief.estimatedMinutes;
                const fmtLabel = formatWorkFormatLabel(entry.brief.workFormat);
                return (
                  <li key={entry.taskKey}>
                    <a
                      href={entry.task.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex items-start justify-between gap-2 rounded-lg border border-sys-border/70 bg-sys-card px-2.5 py-2 hover:border-sys-border-elevated transition-colors"
                    >
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-[11px] font-bold text-sys-text-muted shrink-0">
                            {idx + 1}.
                          </span>
                          <span className="text-xs font-semibold text-sys-text-primary group-hover:text-sys-accent transition-colors line-clamp-1 break-words">
                            {entry.task.title}
                          </span>
                        </div>
                        <div className="text-[11px] text-sys-text-secondary line-clamp-1 break-words">
                          {entry.task.subject}
                          {entry.reasonText ? ` · ${entry.reasonText}` : ""}
                        </div>
                      </div>
                      <span className="shrink-0 text-[10px] font-medium text-sys-text-muted whitespace-nowrap pt-0.5">
                        {est ? `~${est} хв · ${fmtLabel}` : fmtLabel} ↗
                      </span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>

          {windowSuggestions.length > 0 && (
            <div className="space-y-1.5 pt-1 border-t border-sys-border/50">
              <div className="text-[10px] font-bold uppercase tracking-wider text-sys-text-muted">
                Можна закрити у вільний час
              </div>
              <div className="space-y-1.5">
                {windowSuggestions.map((s) => {
                  const est = s.item.brief.estimatedMinutes;
                  const fmtLabel = formatWorkFormatLabel(s.item.brief.workFormat);
                  return (
                    <div
                      key={s.suggestionId}
                      className="rounded-lg border border-sys-border/70 bg-sys-card px-2.5 py-2 space-y-1.5"
                    >
                      <div className="text-[11px] font-medium text-sys-text-secondary">
                        {s.window.description}
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <a
                          href={s.item.task.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="min-w-0 flex-1 text-xs font-semibold text-sys-text-primary hover:text-sys-accent transition-colors truncate"
                        >
                          {s.item.task.title}
                        </a>
                        <span className="shrink-0 text-[10px] text-sys-text-muted whitespace-nowrap">
                          {est ? `~${est} хв · ${fmtLabel}` : fmtLabel}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 pt-0.5">
                        <button
                          type="button"
                          onClick={() => handleWindowDecision(s.suggestionId, "accept")}
                          className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold transition-colors cursor-pointer ${
                            s.isAccepted
                              ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                              : "border-sys-border bg-sys-bg text-sys-text-secondary hover:text-sys-text-primary"
                          }`}
                        >
                          {s.isAccepted ? "Заплановано ✓" : "Зроблю"}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleWindowDecision(s.suggestionId, "dismiss")}
                          className="rounded-md px-1.5 py-0.5 text-[11px] font-medium text-sys-text-muted hover:text-sys-text-secondary transition-colors cursor-pointer"
                        >
                          Пропустити
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
