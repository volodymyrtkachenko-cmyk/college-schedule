"use client";

import type { ReturnTarget } from "./useScheduleSelection";

interface ScheduleLoadingSkeletonProps {
  rows: number;
}

export function ScheduleLoadingSkeleton({ rows }: ScheduleLoadingSkeletonProps) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Завантаження розкладу">
      {Array.from({ length: rows }, (_, i) => i + 1).map((num) => (
        <div
          key={num}
          className="flex items-start gap-4 rounded-xl border border-sys-border/60 bg-sys-card/70 p-4 animate-pulse"
        >
          <div className="flex w-12 shrink-0 flex-col gap-1.5">
            <div className="h-5 w-6 rounded bg-sys-elevated" />
            <div className="h-3 w-10 rounded bg-sys-elevated/60" />
          </div>
          <div className="flex flex-1 flex-col gap-2.5">
            <div className="h-4 w-3/5 rounded bg-sys-elevated" />
            <div className="h-3.5 w-2/5 rounded bg-sys-elevated/60" />
          </div>
        </div>
      ))}
    </div>
  );
}

interface ScheduleErrorStateProps {
  error: string;
  variant: "mobile" | "desktop";
  returnTarget: ReturnTarget | null;
  onRetry: () => void;
  onReturnBack: () => void;
}

export function ScheduleErrorState({
  error,
  variant,
  returnTarget,
  onRetry,
  onReturnBack,
}: ScheduleErrorStateProps) {
  const isDesktop = variant === "desktop";
  return (
    <div
      className={`rounded-2xl border border-sys-border bg-sys-card text-center space-y-3 ${
        isDesktop ? "p-8 max-w-xl mx-auto" : "p-6"
      }`}
    >
      <p
        className={
          isDesktop
            ? "text-base font-semibold text-sys-text-primary"
            : "text-sm font-medium text-sys-text-primary"
        }
      >
        {error}
      </p>
      <p className={isDesktop ? "text-xs sm:text-sm text-sys-text-secondary" : "text-xs text-sys-text-secondary"}>
        {isDesktop
          ? "Ви можете обрати іншу збережену групу у верхній панелі або повторити спробу."
          : "Ви можете обрати іншу збережену групу у шапці або спробувати оновити дані."}
      </p>
      <div className={`flex items-center justify-center ${isDesktop ? "gap-3 pt-2" : "gap-2 pt-1"}`}>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-xl bg-sys-accentSolid px-4 py-2 text-xs font-semibold text-sys-onAccent hover:opacity-90 active:scale-95 transition-opacity cursor-pointer"
        >
          Спробувати ще раз
        </button>
        {returnTarget && (
          <button
            type="button"
            onClick={onReturnBack}
            className={`rounded-xl border border-sys-border bg-sys-bg py-2 text-xs font-semibold text-sys-text-primary hover:border-sys-accent/50 transition-colors cursor-pointer ${
              isDesktop ? "px-4" : "px-3.5"
            }`}
          >
            {isDesktop ? `← Повернутися до ${returnTarget.label}` : `← До ${returnTarget.label}`}
          </button>
        )}
      </div>
    </div>
  );
}
