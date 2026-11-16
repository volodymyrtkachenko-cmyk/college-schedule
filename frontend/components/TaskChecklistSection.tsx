"use client";

import React from "react";
import {
  formatTaskWeightBadge,
  formatWorkFormatLabel,
  type TaskBrief,
} from "../lib/schedule/priorityNavigator";

interface TaskChecklistSectionProps {
  taskKey: string;
  brief: TaskBrief;
  maxPoints?: number | null;
  checkedIndices: number[];
  onToggleStep: (taskKey: string, stepIdx: number) => void;
  compact?: boolean;
}

export function TaskChecklistSection({
  taskKey,
  brief,
  maxPoints,
  checkedIndices,
  onToggleStep,
  compact = false,
}: TaskChecklistSectionProps) {
  const weight = formatTaskWeightBadge(maxPoints ?? null);
  const formatLabel = formatWorkFormatLabel(brief.workFormat);

  return (
    <div
      className={`border-t border-sys-border/60 ${
        compact ? "mt-2 pt-2 space-y-1.5" : "mt-2.5 pt-2.5 space-y-2"
      }`}
    >
      <p className="text-xs text-sys-text-secondary leading-relaxed break-words">
        {brief.summary}
      </p>

      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-sys-text-muted">
        {brief.estimatedMinutes ? (
          <span className="inline-flex items-center rounded-md border border-sys-border/70 bg-sys-bg px-1.5 py-0.5 font-medium text-sys-text-secondary">
            ~{brief.estimatedMinutes} хв · {formatLabel}
          </span>
        ) : (
          <span className="inline-flex items-center rounded-md border border-sys-border/70 bg-sys-bg px-1.5 py-0.5 font-medium text-sys-text-secondary">
            {formatLabel}
          </span>
        )}
        {weight && (
          <span className="inline-flex items-center rounded-md border border-sys-border/70 bg-sys-bg px-1.5 py-0.5 font-medium text-sys-text-secondary">
            Вага: {weight.label}
          </span>
        )}
        {brief.source === "gemini" && (
          <span className="text-[10px] text-sys-text-muted">AI-розбір</span>
        )}
      </div>

      {brief.steps.length > 0 && (
        <ul className="space-y-1 pt-0.5">
          {brief.steps.map((step, idx) => {
            const checked = checkedIndices.includes(idx);
            return (
              <li key={idx}>
                <label className="flex items-start gap-2 text-xs cursor-pointer select-none group/step">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggleStep(taskKey, idx)}
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-sys-border accent-[rgb(var(--sys-accent-solid))] cursor-pointer"
                  />
                  <span
                    className={`leading-snug break-words transition-colors ${
                      checked
                        ? "line-through text-sys-text-muted"
                        : "text-sys-text-primary group-hover/step:text-sys-accent"
                    }`}
                  >
                    {step}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
