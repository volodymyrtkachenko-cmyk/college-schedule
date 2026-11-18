"use client";

import { useEffect, useRef, useState } from "react";
import type { HeaderLearningModeData, WeekDayMini } from "../../lib/schedule";
import { DesktopDaySelector } from "./DesktopDaySelector";
import { LearningModeBadge } from "./LearningModeBadge";

interface DesktopFocusDaySwitcherProps {
  visible: boolean;
  shouldReduceMotion: boolean;
  mode: "student" | "teacher";
  currentWeekNumber: number | null;
  weekType: string;
  weekRange: string;
  learningModeBadge?: HeaderLearningModeData | null;
  weekDaysMini: WeekDayMini[];
  selectedDayIndex: number;
  todayActualIso: string;
  onToggleFocusMode: () => void;
  onSelectDayIndex: (index: number) => void;
}

export function DesktopFocusDaySwitcher({
  visible,
  shouldReduceMotion,
  mode,
  currentWeekNumber,
  weekType,
  weekRange,
  learningModeBadge = null,
  weekDaysMini,
  selectedDayIndex,
  todayActualIso,
  onToggleFocusMode,
  onSelectDayIndex,
}: DesktopFocusDaySwitcherProps) {
  const [prevVisible, setPrevVisible] = useState(visible);
  const [hasAnimatedToggle, setHasAnimatedToggle] = useState(false);
  if (visible !== prevVisible) {
    setPrevVisible(visible);
    if (!hasAnimatedToggle) setHasAnimatedToggle(true);
  }
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (el) {
      if (!visible) el.setAttribute("inert", "");
      else el.removeAttribute("inert");
    }
  }, [visible]);

  return (
    <div
      ref={containerRef}
      data-visible={visible ? "true" : "false"}
      data-animated={hasAnimatedToggle ? "true" : undefined}
      data-reduced-motion={shouldReduceMotion ? "true" : undefined}
      aria-hidden={!visible || undefined}
      className="desktop-focus-switcher w-full"
    >
      <div className="desktop-focus-switcher-inner">
        <div className="desktop-focus-switcher-card rounded-2xl border border-sys-border bg-sys-card p-4 shadow-sm">
          <div className="flex items-center justify-between pb-3 mb-3 border-b border-sys-border/50">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs font-bold uppercase tracking-wider text-sys-text-muted shrink-0">
                {currentWeekNumber ? `${currentWeekNumber} ТИЖДЕНЬ` : "РОЗКЛАД"}
              </span>
              {weekType !== "both" && (
                <>
                  <span className="text-sys-text-muted">•</span>
                  <span className="text-xs lowercase font-medium text-sys-text-secondary">
                    {weekType === "numerator" ? "чисельник" : "знаменник"}
                  </span>
                </>
              )}
              <span className="text-sys-text-muted">•</span>
              <span className="text-xs font-semibold text-sys-text-primary truncate">
                {weekRange}
              </span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <LearningModeBadge data={learningModeBadge} />
              {mode !== "teacher" && (
                <button
                  type="button"
                  onClick={onToggleFocusMode}
                  title="Показати бічну панель завдань"
                  aria-label="Показати бічну панель завдань"
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-sys-border bg-sys-bg text-sys-text-secondary hover:text-sys-accent hover:border-sys-accent/40 active:scale-95 transition-colors duration-fast ease-smooth shrink-0 cursor-pointer"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect width="18" height="18" x="3" y="2" rx="2" />
                    <path d="M15 3v18" />
                    <path d="m8 9 3 3-3 3" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          <DesktopDaySelector
            days={weekDaysMini}
            selectedDayIndex={selectedDayIndex}
            todayActualIso={todayActualIso}
            shouldReduceMotion={shouldReduceMotion}
            onSelectDayIndex={onSelectDayIndex}
          />
        </div>
      </div>
    </div>
  );
}
