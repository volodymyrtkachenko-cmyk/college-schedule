"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { getMondayOf, KYIV_DATE_FMT } from "../lib/date";

interface DatePickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedDateIso: string; // YYYY-MM-DD
  todayDateIso: string;    // YYYY-MM-DD
  semesterStartIso?: string | null;
  onSelectDate: (targetDate: Date) => void;
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
  onSelectDate,
}: DatePickerModalProps) {
  // Parsing initial view month/year from selectedDateIso or today
  const initialDate = useMemo(() => {
    if (selectedDateIso) {
      const [y, m, d] = selectedDateIso.split("-").map(Number);
      if (y && m && d) return new Date(y, m - 1, d);
    }
    return new Date();
  }, [selectedDateIso]);

  const [viewYear, setViewYear] = useState<number>(initialDate.getFullYear());
  const [viewMonth, setViewMonth] = useState<number>(initialDate.getMonth()); // 0-indexed

  // Reset view to selected date when modal opens
  useEffect(() => {
    if (isOpen) {
      setViewYear(initialDate.getFullYear());
      setViewMonth(initialDate.getMonth());
    }
  }, [isOpen, initialDate]);

  // Handle Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const goToPrevMonth = useCallback(() => {
    setViewMonth((prev) => {
      if (prev === 0) {
        setViewYear((y) => y - 1);
        return 11;
      }
      return prev - 1;
    });
  }, []);

  const goToNextMonth = useCallback(() => {
    setViewMonth((prev) => {
      if (prev === 11) {
        setViewYear((y) => y + 1);
        return 0;
      }
      return prev + 1;
    });
  }, []);

  // Compute calendar days grid
  const calendarGrid = useMemo(() => {
    const firstDayOfMonth = new Date(viewYear, viewMonth, 1);
    const lastDayOfMonth = new Date(viewYear, viewMonth + 1, 0);

    // Days in current month
    const totalDays = lastDayOfMonth.getDate();

    // Weekday of 1st day (0 is Sun, convert so Mon is 0 ... Sun is 6)
    const firstWeekday = (firstDayOfMonth.getDay() + 6) % 7;

    const days: Array<{
      dayNum: number;
      dateIso: string;
      isCurrentMonth: boolean;
      dateObj: Date;
    }> = [];

    // Previous month padding days
    const prevMonthLastDate = new Date(viewYear, viewMonth, 0).getDate();
    for (let i = firstWeekday - 1; i >= 0; i--) {
      const d = prevMonthLastDate - i;
      const prevDate = new Date(viewYear, viewMonth - 1, d);
      days.push({
        dayNum: d,
        dateIso: KYIV_DATE_FMT.format(prevDate),
        isCurrentMonth: false,
        dateObj: prevDate,
      });
    }

    // Current month days
    for (let d = 1; d <= totalDays; d++) {
      const currDate = new Date(viewYear, viewMonth, d);
      days.push({
        dayNum: d,
        dateIso: KYIV_DATE_FMT.format(currDate),
        isCurrentMonth: true,
        dateObj: currDate,
      });
    }

    // Next month padding days to complete 7-column rows (up to 35 or 42 cells)
    const remaining = (7 - (days.length % 7)) % 7;
    for (let d = 1; d <= remaining; d++) {
      const nextDate = new Date(viewYear, viewMonth + 1, d);
      days.push({
        dayNum: d,
        dateIso: KYIV_DATE_FMT.format(nextDate),
        isCurrentMonth: false,
        dateObj: nextDate,
      });
    }

    return days;
  }, [viewYear, viewMonth]);

  // Week number & type calculator for previewing
  const getWeekInfo = useCallback(
    (targetDate: Date) => {
      if (!semesterStartIso) return null;
      const [sy, sm, sd] = semesterStartIso.split("-").map(Number);
      const start = new Date(sy, sm - 1, sd);
      const mondayTarget = getMondayOf(targetDate);
      const mondayStart = getMondayOf(start);
      const diffTime = mondayTarget.getTime() - mondayStart.getTime();
      const diffWeeks = Math.floor(diffTime / (7 * 24 * 60 * 60 * 1000)) + 1;
      if (diffWeeks <= 0) return null;
      return {
        weekNum: diffWeeks,
        type: diffWeeks % 2 === 1 ? "чисельник" : "знаменник",
      };
    },
    [semesterStartIso]
  );

  const handleSelect = (dObj: Date) => {
    vibrateTap(10);
    onSelectDate(dObj);
    onClose();
  };

  const handleJumpToToday = () => {
    vibrateTap(10);
    const today = new Date();
    onSelectDate(today);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Вибір дати розкладу"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="surface-panel w-full max-w-[340px] sm:max-w-sm rounded-2xl border border-sys-border bg-sys-card p-4 sm:p-5 shadow-2xl relative select-none"
        onClick={(e) => e.stopPropagation()}
      >
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
              aria-label="Попередній місяць"
              title="Попередній місяць"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-sys-border/60 bg-sys-bg text-sys-text-secondary hover:text-sys-text-primary hover:border-sys-accent/40 active:scale-95 transition-colors"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="m15 18-6-6 6-6" />
              </svg>
            </button>
            <button
              type="button"
              onClick={goToNextMonth}
              aria-label="Наступний місяць"
              title="Наступний місяць"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-sys-border/60 bg-sys-bg text-sys-text-secondary hover:text-sys-text-primary hover:border-sys-accent/40 active:scale-95 transition-colors"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="m9 18 6-6-6-6" />
              </svg>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Закрити календар"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-sys-text-muted hover:text-sys-text-primary hover:bg-sys-bg transition-colors ml-1"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
            const dayOfWeek = (item.dateObj.getDay() + 6) % 7; // 0: Mon ... 6: Sun
            const isWeekend = dayOfWeek >= 5;

            return (
              <button
                key={`${item.dateIso}-${idx}`}
                type="button"
                onClick={() => handleSelect(item.dateObj)}
                className={`relative flex h-10 w-full items-center justify-center rounded-xl text-xs sm:text-[13px] transition-all duration-fast ease-smooth focus:outline-none focus:ring-2 focus:ring-sys-accent active:scale-95 ${
                  isSelected
                    ? "bg-sys-accent text-white font-black shadow-sm"
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
              const info = getWeekInfo(new Date(viewYear, viewMonth, 15));
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
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect width="18" height="18" x="3" y="4" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <span>Сьогодні</span>
          </button>
        </div>
      </div>
    </div>
  );
}
