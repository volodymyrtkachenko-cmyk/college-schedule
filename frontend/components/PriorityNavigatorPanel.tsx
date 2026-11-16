"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { ScheduleResponse } from "../lib/api";
import { getKyivNow, subscribeKyivNow, type KyivNowSnapshot } from "../lib/lesson-card/kyivClock";
import {
  PRIORITY_NAV_OPEN_KEY,
  findFreeStudyWindows,
  formatMaterialCount,
  matchTasksToWindows,
  readWindowDecisions,
  saveWindowDecision,
  scorePriorityTasks,
  type PrioritizedTaskItem,
  type SubjectRiskSummary,
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

function getRankBadgeClass(tier: PrioritizedTaskItem["priorityTier"]): string {
  if (tier === "critical") {
    return "bg-rose-500/10 border-rose-500/25 text-rose-700 dark:text-rose-300";
  }
  if (tier === "high") {
    return "bg-amber-500/10 border-amber-500/25 text-amber-700 dark:text-amber-300";
  }
  return "bg-indigo-500/10 border-indigo-500/25 text-indigo-700 dark:text-indigo-300";
}

function getSubjectRiskDotClass(level: SubjectRiskSummary["riskLevel"]): string {
  if (level === "critical") return "bg-rose-500";
  if (level === "high") return "bg-amber-500";
  return "bg-sys-accent";
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

  const { prioritizedTasks, subjectRisks } = useMemo(() => {
    if (!effectiveNow) {
      return { prioritizedTasks: [], subjectRisks: [] };
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
  const topSubjects = subjectRisks.slice(0, 3);
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
        className="w-full min-h-[40px] flex items-center justify-between gap-2 px-3 py-2 text-left text-xs transition-colors duration-fast hover:bg-sys-hover cursor-pointer"
      >
        <div className="min-w-0 flex-1 flex items-center gap-2">
          <span
            aria-hidden="true"
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-indigo-500/25 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300"
          >
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 2l2.1 6.3L20.4 10l-6.3 2.1L12 18.4l-2.1-6.3L3.6 10l6.3-1.7L12 2z" />
            </svg>
          </span>
          <span className="font-semibold text-sys-text-primary shrink-0">
            Навігатор пріоритетів
          </span>
          {!isOpen && topHint && (
            <span className="truncate text-[11px] text-sys-text-secondary">
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
          className={`shrink-0 text-sys-text-secondary transition-transform duration-fast ${
            isOpen ? "rotate-180" : ""
          }`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {isOpen && (
        <div className="border-t border-sys-border/70 px-3 py-3 space-y-3.5 bg-sys-bg/45">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[10px] font-bold uppercase tracking-[0.06em] text-sys-text-secondary">
                Що закрити першим
              </div>
              <span className="text-[10px] font-medium text-sys-text-muted">
                Топ-{topItems.length}
              </span>
            </div>
            <ul className="space-y-2">
              {topItems.map((entry, idx) => {
                const fileBadge =
                  entry.brief.materials.length > 0
                    ? formatMaterialCount(entry.brief.materials.length)
                    : null;
                const timeBadge = entry.brief.estimatedMinutes ? `~${entry.brief.estimatedMinutes} хв` : null;

                return (
                  <li key={entry.taskKey}>
                    <a
                      href={entry.task.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex items-start justify-between gap-2.5 rounded-xl border border-sys-border/80 bg-sys-card px-2.5 py-2.5 hover:border-sys-accent/45 hover:bg-sys-hover transition-colors"
                    >
                      <div className="min-w-0 flex-1 flex items-start gap-2.5">
                        <span
                          aria-hidden="true"
                          className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-[11px] font-bold tabular-nums ${getRankBadgeClass(
                            entry.priorityTier
                          )}`}
                        >
                          {idx + 1}
                        </span>
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="text-xs font-semibold text-sys-text-primary group-hover:text-sys-accent transition-colors line-clamp-1 break-words">
                            {entry.task.title}
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                            <span className="font-medium text-sys-text-secondary truncate max-w-[170px]">
                              {entry.task.subject}
                            </span>
                            {entry.reasonText && (
                              <span
                                className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${
                                  entry.priorityTier === "critical"
                                    ? "bg-rose-500/10 border-rose-500/25 text-rose-700 dark:text-rose-300"
                                    : entry.priorityTier === "high"
                                      ? "bg-amber-500/10 border-amber-500/25 text-amber-700 dark:text-amber-300"
                                      : "bg-sys-bg border-sys-border/75 text-sys-text-secondary"
                                }`}
                              >
                                {entry.reasonText}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="shrink-0 flex flex-col items-end gap-1 pt-0.5">
                        <div className="flex items-center gap-1">
                          {entry.weightLabel && (
                            <span className="rounded-md border border-sys-border/75 bg-sys-bg/80 px-1.5 py-0.5 text-[10px] font-semibold text-sys-text-primary tabular-nums">
                              {entry.weightLabel}
                            </span>
                          )}
                          {timeBadge && (
                            <span className="rounded-md border border-sys-border/75 bg-sys-bg/80 px-1.5 py-0.5 text-[10px] font-medium text-sys-text-secondary tabular-nums">
                              {timeBadge}
                            </span>
                          )}
                          <span
                            aria-hidden="true"
                            className="text-xs text-sys-text-muted group-hover:text-sys-accent transition-colors pl-0.5"
                          >
                            ↗
                          </span>
                        </div>
                        {fileBadge && (
                          <span className="text-[10px] font-medium text-sys-text-muted">
                            {fileBadge}
                          </span>
                        )}
                      </div>
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>

          {topSubjects.length >= 2 && (
            <div className="space-y-1.5 pt-2 border-t border-sys-border/60">
              <div className="text-[10px] font-bold uppercase tracking-[0.06em] text-sys-text-secondary">
                Навантаження за предметами
              </div>
              <div className="flex flex-wrap gap-1.5">
                {topSubjects.map((sr) => (
                  <span
                    key={sr.subject}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-sys-border/80 bg-sys-card px-2 py-1 text-[11px] text-sys-text-secondary"
                  >
                    <span
                      aria-hidden="true"
                      className={`h-1.5 w-1.5 rounded-full shrink-0 ${getSubjectRiskDotClass(sr.riskLevel)}`}
                    />
                    <span className="font-semibold text-sys-text-primary truncate max-w-[140px]">
                      {sr.subject}
                    </span>
                    <span className="text-sys-text-muted tabular-nums">
                      {sr.pendingCount}{sr.totalPendingPoints > 0 ? ` · ${sr.totalPendingPoints} б.` : ""}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {windowSuggestions.length > 0 && (
            <div className="space-y-1.5 pt-2 border-t border-sys-border/60">
              <div className="text-[10px] font-bold uppercase tracking-[0.06em] text-sys-text-secondary">
                Можна закрити у вільний час
              </div>
              <div className="space-y-2">
                {windowSuggestions.map((s) => (
                  <div
                    key={s.suggestionId}
                    className="rounded-xl border border-sys-border/80 bg-sys-card px-3 py-2.5 space-y-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1 rounded-md border border-indigo-500/25 bg-indigo-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 dark:text-indigo-300">
                        {s.window.description}
                      </span>
                      <div className="flex items-center gap-1 text-[10px] font-medium text-sys-text-secondary tabular-nums">
                        {s.item.weightLabel && <span>{s.item.weightLabel}</span>}
                        {s.item.weightLabel && s.item.brief.estimatedMinutes && <span>·</span>}
                        {s.item.brief.estimatedMinutes && <span>~{s.item.brief.estimatedMinutes} хв</span>}
                      </div>
                    </div>

                    <a
                      href={s.item.task.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex items-center justify-between gap-2 text-xs font-semibold text-sys-text-primary hover:text-sys-accent transition-colors"
                    >
                      <span className="truncate">{s.item.task.title}</span>
                      <span aria-hidden="true" className="shrink-0 text-sys-text-muted group-hover:text-sys-accent">
                        ↗
                      </span>
                    </a>

                    <div className="flex items-center gap-2 pt-0.5">
                      <button
                        type="button"
                        onClick={() => handleWindowDecision(s.suggestionId, "accept")}
                        className={`min-h-[28px] rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                          s.isAccepted
                            ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                            : "border-sys-border bg-sys-bg text-sys-text-secondary hover:text-sys-text-primary hover:bg-sys-hover"
                        }`}
                      >
                        {s.isAccepted ? "Заплановано ✓" : "Зроблю"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleWindowDecision(s.suggestionId, "dismiss")}
                        className="min-h-[28px] rounded-lg px-2 py-1 text-[11px] font-medium text-sys-text-muted hover:text-sys-text-secondary hover:bg-sys-bg/70 transition-colors cursor-pointer"
                      >
                        Пропустити
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
