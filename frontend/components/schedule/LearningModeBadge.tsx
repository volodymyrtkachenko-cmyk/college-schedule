"use client";

import type { HeaderLearningModeData } from "../../lib/schedule";

interface LearningModeBadgeProps {
  data: HeaderLearningModeData | null | undefined;
  className?: string;
}

/**
 * Contextual badge showing current learning format (online/offline) and active overrides.
 */
export function LearningModeBadge({ data, className = "" }: LearningModeBadgeProps) {
  if (!data) return null;

  const containerTone = data.override
    ? data.mode === "offline"
      ? "border-sys-accent/40 bg-sys-accent/10 text-sys-accent"
      : "border-amber-500/35 bg-amber-500/10 text-amber-900 dark:text-amber-200"
    : "border-sys-border bg-sys-surface/80 text-sys-text-secondary";

  const dotTone =
    data.mode === "offline"
      ? "bg-sys-accent"
      : data.override
        ? "bg-amber-500 dark:bg-amber-400"
        : "bg-slate-400 dark:bg-slate-500";

  return (
    <span
      title={data.title}
      className={`shrink-0 inline-flex items-center justify-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors ${containerTone} ${className}`.trim()}
    >
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full shrink-0 ${dotTone}`} />
      <span className="max-w-[180px] sm:max-w-[220px] truncate">{data.fullLabel}</span>
    </span>
  );
}
