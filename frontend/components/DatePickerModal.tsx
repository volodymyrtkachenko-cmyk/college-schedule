"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { formatKyivDateIso, getSyncedNow } from "../lib/date";
import {
  buildCalendarMonthGrid,
  canNavigateCalendarNextMonth,
  canNavigateCalendarPrevMonth,
  diffCalendarWeeks,
  formatCalendarDateParts,
  resolveCalendarMonthAnchor,
} from "../lib/calendarDate";
import { AppDialog } from "./ui/AppDialog";

interface DatePickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedDateIso: string; // YYYY-MM-DD
  todayDateIso: string;    // YYYY-MM-DD
  semesterStartIso?: string | null;
  minDateIso?: string | null;
  maxDateIso?: string | null;
  onSelectDate: (targetIso: string) => void;
}

const UKR_MONTH_NAMES = [
  "Січень", "Лютий", "Березень", "Квітень", "Травень", "Червень",
  "Липень", "Серпень", "Вересень", "Жовтень", "Листопад", "Грудень"
];

const UKR_WEEKDAY_HEADERS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"];

function vibrateTap(ms = 10) {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    try { navigator.vibrate(ms); } catch {}
  }
}

export function DatePickerModal({
  isOpen,
  onClose,
  selectedDateIso,
  todayDateIso,
  semesterStartIso,
  minDateIso,
  maxDateIso,
  onSelectDate,
}: DatePickerModalProps) {
  const effectiveMinIso = minDateIso ?? semesterStartIso ?? null;
  const effectiveMaxIso = maxDateIso ?? null;

  // Derive initial view month/year strictly from calendar ISO strings (timezone-agnostic).
  const initialAnchor = useMemo(() => {
    const fallbackTodayIso = todayDateIso || formatKyivDateIso(getSyncedNow());
    return resolveCalendarMonthAnchor(selectedDateIso, fallbackTodayIso);
  }, [selectedDateIso, todayDateIso]);

  const [{ year: viewYear, monthIndex0: viewMonth }, setViewMonthAnchor] = useState(initialAnchor);

  // Reset view to selected date when modal opens
  useEffect(() => {
    if (isOpen) {
      setViewMonthAnchor(initialAnchor);
    }
  }, [isOpen, initialAnchor]);

  const canGoPrevMonth = useMemo(
    () => canNavigateCalendarPrevMonth(viewYear, viewMonth, effectiveMinIso),
    [viewYear, viewMonth, effectiveMinIso]
  );

  const canGoNextMonth = useMemo(
    () => canNavigateCalendarNextMonth(viewYear, viewMonth, effectiveMaxIso),
    [viewYear, viewMonth, effectiveMaxIso]
  );

  const goToPrevMonth = useCallback(() => {
    if (!canGoPrevMonth) return;
    setViewMonthAnchor((prev) =>
      prev.monthIndex0 === 0
        ? { year: prev.year - 1, monthIndex0: 11 }
        : { year: prev.year, monthIndex0: prev.monthIndex0 - 1 }
    );
  }, [canGoPrevMonth]);

  const goToNextMonth = useCallback(() => {
    if (!canGoNextMonth) return;
    setViewMonthAnchor((prev) =>
      prev.monthIndex0 === 11
        ? { year: prev.year + 1, monthIndex0: 0 }
        : { year: prev.year, monthIndex0: prev.monthIndex0 + 1 }
    );
  }, [canGoNextMonth]);

  // Compute calendar days grid strictly from YYYY-MM-DD calendar math
  const calendarGrid = useMemo(
    () => buildCalendarMonthGrid(viewYear, viewMonth),
    [viewYear, viewMonth]
  );

  // Week number & type calculator for previewing
  const getWeekInfo = useCallback(
    (targetIso: string) => {
      if (!semesterStartIso) return null;
      const diffWeeks = diffCalendarWeeks(targetIso, semesterStartIso) + 1;
      if (diffWeeks <= 0) return null;
      return {
        weekNum: diffWeeks,
        type: diffWeeks % 2 === 1 ? "чисельник" : "знаменник",
      };
    },
    [semesterStartIso]
  );

  const handleSelect = (dIso: string) => {
    if ((effectiveMinIso && dIso < effectiveMinIso) || (effectiveMaxIso && dIso > effectiveMaxIso)) return;
    vibrateTap(10);
    onSelectDate(dIso);
    onClose();
  };

  const handleJumpToToday = () => {
    vibrateTap(10);
    const todayIso = todayDateIso || formatKyivDateIso(getSyncedNow());
    onSelectDate(todayIso);
    onClose();
  };

  return (
    <AppDialog
      isOpen={isOpen}
      onClose={onClose}
      maxWidth="384px"
      ariaLabel="Вибір дати розкладу"
    >
      <div className="surface-panel w-full rounded-2xl border border-sys-border bg-sys-card p-4 sm:p-5 shadow-2xl relative select-none">
            {/* Header: Month & Year Navigator */}
        <div className="flex items-center justify-between gap-2 mb-3.5 pb-2.5 border-b border-sys-border/60">
          <div className="flex items-center gap-1.5">
            <span className="text-base font-bold text-sys-text-primary tracking-tight">
              {UKR_MONTH_NAMES[viewMonth]}
            </span>
            <span className="text-sm font-semibold text-sys-text-muted">
              {viewYear}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={goToPrevMonth}
              disabled={!canGoPrevMonth}
              aria-label="Попередній місяць"
              title="Попередній місяць"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-sys-border/60 bg-sys-bg text-sys-text-secondary hover:text-sys-text-primary hover:border-sys-accent/40 active:scale-95 transition-colors disabled:opacity-30 disabled:pointer-events-none"
            >
              <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="m15 18-6-6 6-6" />
              </svg>
            </button>
            <button
              type="button"
              onClick={goToNextMonth}
              disabled={!canGoNextMonth}
              aria-label="Наступний місяць"
              title="Наступний місяць"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-sys-border/60 bg-sys-bg text-sys-text-secondary hover:text-sys-text-primary hover:border-sys-accent/40 active:scale-95 transition-colors disabled:opacity-30 disabled:pointer-events-none"
            >
              <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="m9 18 6-6-6-6" />
              </svg>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Закрити календар"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-sys-text-muted hover:text-sys-text-primary hover:bg-sys-bg transition-colors ml-1"
            >
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Weekday headers: Пн Вт Ср Чт Пт Сб Нд */}
        <div className="grid grid-cols-7 gap-1 mb-1 text-center">
          {UKR_WEEKDAY_HEADERS.map((name, idx) => (
            <span
              key={name}
              className={`text-[11px] font-bold py-1 ${
                idx >= 5 ? "text-sys-text-muted/60" : "text-sys-text-muted"
              }`}
            >
              {name}
            </span>
          ))}
        </div>

        {/* Days Grid */}
        <div className="grid grid-cols-7 gap-1">
          {calendarGrid.map((item, idx) => {
            const isSelected = item.dateIso === selectedDateIso;
            const isToday = item.dateIso === todayDateIso;
            const isWeekend = item.isWeekend;
            const isOutOfBounds = Boolean(
              (effectiveMinIso && item.dateIso < effectiveMinIso) ||
              (effectiveMaxIso && item.dateIso > effectiveMaxIso)
            );

            return (
              <button
                key={`${item.dateIso}-${idx}`}
                type="button"
                disabled={isOutOfBounds}
                onClick={() => handleSelect(item.dateIso)}
                className={`relative flex h-10 w-full items-center justify-center rounded-xl text-xs sm:text-[13px] transition-[color,background-color,transform] duration-fast ease-smooth focus:outline-none focus:ring-2 focus:ring-sys-accent active:scale-95 disabled:opacity-25 disabled:pointer-events-none disabled:cursor-not-allowed ${
                  isSelected
                    ? "bg-sys-accentSolid text-sys-onAccent font-black shadow-sm"
                    : isToday
                    ? "ring-1.5 ring-sys-accent font-bold text-sys-accent bg-sys-accent/10 hover:bg-sys-accent/20"
                    : item.isCurrentMonth
                    ? isWeekend
                      ? "text-sys-text-muted hover:bg-sys-bg hover:text-sys-text-primary"
                      : "text-sys-text-primary font-medium hover:bg-sys-bg hover:text-sys-accent"
                    : "text-sys-text-muted/30 hover:bg-sys-bg/50"
                }`}
              >
                <span>{item.dayNum}</span>

                {/* Dot for today if not active */}
                {isToday && !isSelected && (
                  <span className="absolute bottom-1 h-1 w-1 rounded-full bg-sys-accent" />
                )}
              </button>
            );
          })}
        </div>

        {/* Footer actions: Jump to today + Current preview info */}
        <div className="mt-3.5 pt-2.5 border-t border-sys-border/60 flex items-center justify-between gap-2">
          <div className="text-[11px] text-sys-text-secondary truncate">
            {(() => {
              const info = getWeekInfo(formatCalendarDateParts(viewYear, viewMonth, 15));
              if (!info) return null;
              return (
                <span className="inline-flex items-center gap-1 font-medium">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-sys-accent" />
                  <span>{info.weekNum} тижд. ({info.type})</span>
                </span>
              );
            })()}
          </div>

          <button
            type="button"
            onClick={handleJumpToToday}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-sys-border/80 bg-sys-bg hover:border-sys-accent/60 hover:text-sys-accent text-xs font-semibold text-sys-text-primary active:scale-95 transition-colors"
          >
            <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect width="18" height="18" x="3" y="4" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <span>Сьогодні</span>
          </button>
        </div>
      </div>
    </AppDialog>
  );
}
