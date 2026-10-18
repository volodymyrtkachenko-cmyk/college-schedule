"use client";

import { useMemo } from "react";

interface MobileWeekBarProps {
  weekRange: string;
  weekType: string;
  isCurrentWeek: boolean;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onResetWeek: () => void;
  shouldReduceMotion?: boolean;
}

export function MobileWeekBar({
  weekRange,
  weekType,
  isCurrentWeek,
  onPrevWeek,
  onNextWeek,
  onResetWeek,
  shouldReduceMotion = false,
}: MobileWeekBarProps) {
  const weekTypeLabel = useMemo(() => {
    if (weekType === "numerator") return "Чисельник";
    if (weekType === "denominator") return "Знаменник";
    return "";
  }, [weekType]);

  return (
    <div className={`w-full border-b border-sys-border/60 bg-sys-card/90 backdrop-blur-xs px-2 ${isCurrentWeek ? "py-1 min-h-[44px] max-h-[48px]" : "py-1.5 min-h-[50px] max-h-[56px]"}`}>
      <div className="flex items-center justify-between gap-1 max-w-md mx-auto">
        {/* Previous Week Button (tap area >= 44x44px) */}
        <button
          type="button"
          onClick={onPrevWeek}
          aria-label="Попередній тиждень"
          className="flex h-11 w-11 min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-lg text-sys-text-secondary hover:text-sys-text-primary hover:bg-sys-bg/60 active:scale-[0.94] transition-all duration-100 ease-out focus:outline-none focus:ring-1 focus:ring-sys-accent"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>

        {/* Center: Range · WeekType (clickable to return to current week if !isCurrentWeek) */}
        {isCurrentWeek ? (
          <div
            aria-live="polite"
            className="flex min-w-0 flex-1 items-center justify-center gap-1.5 px-1 text-center"
          >
            <span className="truncate text-xs font-semibold text-sys-text-primary">
              {weekRange}
            </span>
            {weekTypeLabel && (
              <>
                <span className="text-sys-text-muted text-[10px]">·</span>
                <span className="shrink-0 text-xs font-medium text-sys-accent">
                  {weekTypeLabel}
                </span>
              </>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={onResetWeek}
            aria-live="polite"
            title="Натисніть, щоб повернутися на поточний тиждень"
            className="flex min-w-0 flex-1 flex-col items-center justify-center rounded-lg px-2 py-0.5 text-center transition-colors hover:bg-sys-bg/60 active:scale-[0.98]"
          >
            <div className="flex items-center justify-center gap-1.5 truncate max-w-full">
              <span className="truncate text-xs font-semibold text-sys-text-primary">
                {weekRange}
              </span>
              {weekTypeLabel && (
                <>
                  <span className="text-sys-text-muted text-[10px]">·</span>
                  <span className="shrink-0 text-xs font-medium text-sys-accent">
                    {weekTypeLabel}
                  </span>
                </>
              )}
            </div>
            <span className="text-[10px] font-medium text-sys-text-muted leading-tight mt-0.5">
              не поточний · натисніть для повернення
            </span>
          </button>
        )}

        {/* Next Week Button (tap area >= 44x44px) */}
        <button
          type="button"
          onClick={onNextWeek}
          aria-label="Наступний тиждень"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-sys-text-secondary hover:text-sys-text-primary hover:bg-sys-bg/60 active:scale-[0.94] transition-all duration-100 ease-out focus:outline-none focus:ring-1 focus:ring-sys-accent"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
        </button>
      </div>
    </div>
  );
}
