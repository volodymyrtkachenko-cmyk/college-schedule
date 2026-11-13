"use client";

import { motion } from "framer-motion";
import type { WeekDayMini } from "../../lib/schedule";

interface DesktopFocusDaySwitcherProps {
  visible: boolean;
  shouldReduceMotion: boolean;
  mode: "student" | "teacher";
  currentWeekNumber: number | null;
  weekType: string;
  weekRange: string;
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
  weekDaysMini,
  selectedDayIndex,
  todayActualIso,
  onToggleFocusMode,
  onSelectDayIndex,
}: DesktopFocusDaySwitcherProps) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateRows: visible ? "1fr" : "0fr",
        opacity: visible ? 1 : 0,
        marginBottom: visible ? 20 : 0,
        transition: shouldReduceMotion
          ? "none"
          : "grid-template-rows 0.18s cubic-bezier(0.2, 0, 0, 1), opacity 0.15s ease, margin-bottom 0.18s cubic-bezier(0.2, 0, 0, 1)",
      }}
      className={`w-full overflow-hidden ${visible ? "" : "pointer-events-none"}`}
    >
      <div className="min-h-0 overflow-hidden">
        <div className="rounded-2xl border border-sys-border bg-sys-card p-4 shadow-sm">
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

          <div className="grid grid-cols-5 gap-2">
            {weekDaysMini.map((d) => {
              const isActive = d.index === selectedDayIndex;
              const isToday = d.iso === todayActualIso;
              return (
                <button
                  key={d.iso}
                  type="button"
                  onClick={() => onSelectDayIndex(d.index)}
                  className={`relative isolate z-10 flex flex-col items-center justify-center h-15 rounded-xl transition-colors duration-fast ease-smooth cursor-pointer active:scale-95 ${
                    isActive
                      ? "text-white font-black"
                      : "border border-sys-border bg-sys-bg text-sys-text-secondary hover:text-sys-text-primary hover:border-sys-elevated-border font-medium"
                  }`}
                >
                  {isActive && (
                    <motion.div
                      layoutId="desktop-focus-day-pill"
                      className="absolute inset-0 rounded-xl bg-sys-accentSolid shadow-md ring-2 ring-sys-accent/60 -z-10"
                      transition={{ type: "spring", stiffness: 480, damping: 36 }}
                    />
                  )}
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs uppercase font-semibold opacity-90">{d.name}</span>
                    {isToday && (
                      <span
                        title="Сьогодні"
                        className={`h-1.5 w-1.5 rounded-full shrink-0 ${isActive ? "bg-white" : "bg-sys-accent"}`}
                      />
                    )}
                  </div>
                  <span className="text-xl font-bold mt-0.5 leading-none">{d.dateStr}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
