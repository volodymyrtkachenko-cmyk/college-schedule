"use client";

import React from "react";
import {
  formatMaterialKindLabel,
  formatTaskWeightBadge,
  formatWorkFormatLabel,
  type TaskBrief,
  type TaskMaterialItem,
  type TaskMaterialKind,
} from "../lib/schedule/priorityNavigator";

interface TaskChecklistSectionProps {
  taskKey?: string;
  brief: TaskBrief;
  maxPoints?: number | null;
  scaleType?: "12" | "5" | "100" | null;
  checkedIndices?: number[];
  onToggleStep?: (taskKey: string, stepIdx: number) => void;
  compact?: boolean;
}

const KIND_BADGE_STYLES: Record<TaskMaterialKind, string> = {
  pdf: "bg-rose-500/10 border-rose-500/25 text-rose-700 dark:text-rose-300",
  doc: "bg-sky-500/10 border-sky-500/25 text-sky-700 dark:text-sky-300",
  sheet: "bg-emerald-500/10 border-emerald-500/25 text-emerald-700 dark:text-emerald-300",
  slide: "bg-amber-500/10 border-amber-500/25 text-amber-700 dark:text-amber-300",
  form: "bg-violet-500/10 border-violet-500/25 text-violet-700 dark:text-violet-300",
  video: "bg-red-500/10 border-red-500/25 text-red-700 dark:text-red-300",
  link: "bg-indigo-500/10 border-indigo-500/25 text-indigo-700 dark:text-indigo-300",
  file: "bg-sys-elevated border-sys-border/80 text-sys-text-secondary",
};

function MaterialKindIcon({ kind }: { kind: TaskMaterialKind }) {
  switch (kind) {
    case "video":
      return (
        <svg className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <polygon points="6 4 20 12 6 20 6 4" strokeLinejoin="round" />
        </svg>
      );
    case "form":
      return (
        <svg className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path d="M9 11l3 3L22 4" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "link":
      return (
        <svg className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    default:
      return (
        <svg className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" strokeLinecap="round" strokeLinejoin="round" />
          <polyline points="14 2 14 8 20 8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
  }
}

function MaterialChip({ material }: { material: TaskMaterialItem }) {
  const kindLabel = formatMaterialKindLabel(material.kind);
  const badgeStyle = KIND_BADGE_STYLES[material.kind] ?? KIND_BADGE_STYLES.file;

  if (material.url) {
    return (
      <a
        href={material.url}
        target="_blank"
        rel="noopener noreferrer"
        title={material.title}
        aria-label={`${material.title} (${kindLabel}, відкриється у новій вкладці)`}
        className="group inline-flex items-center gap-2 min-h-[34px] max-w-full rounded-lg border border-sys-border/85 bg-sys-card hover:bg-sys-hover hover:border-sys-accent/50 px-2.5 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sys-accent"
      >
        <span
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[10px] font-bold tracking-wide uppercase shrink-0 ${badgeStyle}`}
        >
          <MaterialKindIcon kind={material.kind} />
          <span>{kindLabel}</span>
        </span>
        <span className="min-w-0 text-[12px] font-medium text-sys-text-primary group-hover:text-sys-accent leading-snug [overflow-wrap:anywhere] transition-colors">
          {material.title}
        </span>
        <svg
          className="w-3.5 h-3.5 text-sys-text-secondary group-hover:text-sys-accent shrink-0 transition-colors"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path d="M7 17L17 7M9 7h8v8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </a>
    );
  }

  return (
    <span
      title={material.title}
      className="inline-flex items-center gap-2 min-h-[34px] max-w-full rounded-lg border border-sys-border/60 bg-sys-bg/75 px-2.5 py-1.5 text-left"
    >
      <span
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[10px] font-bold tracking-wide uppercase shrink-0 ${badgeStyle}`}
      >
        <MaterialKindIcon kind={material.kind} />
        <span>{kindLabel}</span>
      </span>
      <span className="min-w-0 text-[12px] font-medium text-sys-text-secondary leading-snug [overflow-wrap:anywhere]">
        {material.title}
      </span>
    </span>
  );
}

export function TaskChecklistSection({
  brief,
  maxPoints,
  scaleType,
  compact = false,
}: TaskChecklistSectionProps) {
  const weight = formatTaskWeightBadge(maxPoints, scaleType);
  const formatLabel = formatWorkFormatLabel(brief.workFormat);
  const isAi = brief.source === "gemini";

  const summaryText = brief.summary.trim();
  const deliverableText = brief.deliverable?.trim() || "";
  const hasMaterials = brief.materials.length > 0;
  const fallbackLegacyText =
    !summaryText && !deliverableText && !hasMaterials && brief.steps.length > 0
      ? brief.steps.join(" · ")
      : "";

  const displaySummary = summaryText || fallbackLegacyText;
  const showHeaderMeta = Boolean(isAi || brief.estimatedMinutes || weight);

  if (!displaySummary && !deliverableText && !hasMaterials && !showHeaderMeta) {
    return null;
  }

  return (
    <div
      className={`rounded-xl border border-sys-border/80 bg-sys-bg/75 overflow-hidden ${
        compact ? "mt-2" : "mt-2.5"
      }`}
    >
      {showHeaderMeta && (
        <div
          className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-sys-border/60 ${
            isAi ? "bg-indigo-500/[0.06]" : "bg-sys-elevated/45"
          }`}
        >
          <div className="flex items-center gap-1.5">
            {isAi ? (
              <span className="inline-flex items-center gap-1.5 text-[11px] font-bold tracking-tight text-indigo-700 dark:text-indigo-300">
                <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 2l2.1 6.3L20.4 10l-6.3 2.1L12 18.4l-2.1-6.3L3.6 10l6.3-1.7L12 2z" />
                </svg>
                <span>Міні-бриф ШІ</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-[11px] font-bold tracking-tight text-sys-text-secondary">
                <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path d="M4 6h16M4 12h16M4 18h10" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span>Деталі завдання</span>
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {brief.estimatedMinutes && (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-md bg-sys-card border border-sys-border/75 text-sys-text-primary tabular-nums">
                <svg className="w-3 h-3 text-sys-text-secondary shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <polyline points="12 7 12 12 15 14" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                ~{brief.estimatedMinutes} хв
              </span>
            )}
            {(brief.estimatedMinutes || isAi) && (
              <span className="inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-md bg-sys-card border border-sys-border/75 text-sys-text-secondary">
                {formatLabel}
              </span>
            )}
            {weight && (
              <span
                className={`inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-md border tabular-nums ${
                  weight.isHeavy
                    ? "bg-amber-500/10 border-amber-500/25 text-amber-700 dark:text-amber-300"
                    : "bg-sys-card border-sys-border/75 text-sys-text-secondary"
                }`}
              >
                {weight.label}
              </span>
            )}
          </div>
        </div>
      )}

      <div className={`${compact ? "p-2.5 space-y-2.5" : "p-3 space-y-3"}`}>
        {displaySummary && (
          <div className="space-y-1">
            <div className="text-[10px] font-bold uppercase tracking-[0.06em] text-sys-text-secondary">
              Що зробити
            </div>
            <p className="text-[12.5px] sm:text-[13px] font-medium text-sys-text-primary leading-[1.45] whitespace-pre-line break-words">
              {displaySummary}
            </p>
          </div>
        )}

        {deliverableText && (
          <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/[0.06] px-2.5 py-2 flex items-start gap-2">
            <svg
              className="w-4 h-4 text-emerald-700 dark:text-emerald-300 shrink-0 mt-0.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" strokeLinecap="round" strokeLinejoin="round" />
              <polyline points="17 8 12 3 7 8" strokeLinecap="round" strokeLinejoin="round" />
              <line x1="12" y1="3" x2="12" y2="15" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div className="min-w-0 space-y-0.5">
              <div className="text-[10px] font-bold uppercase tracking-[0.06em] text-emerald-700 dark:text-emerald-300">
                Що здати
              </div>
              <p className="text-[12px] sm:text-[12.5px] font-semibold text-sys-text-primary leading-snug">
                {deliverableText}
              </p>
            </div>
          </div>
        )}

        {hasMaterials && (
          <div className="space-y-1.5">
            <div className="text-[10px] font-bold uppercase tracking-[0.06em] text-sys-text-secondary">
              Прикріплені матеріали
            </div>
            <div className="flex flex-wrap gap-1.5">
              {brief.materials.map((mat, idx) => (
                <MaterialChip key={`${mat.url || mat.title}-${idx}`} material={mat} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
