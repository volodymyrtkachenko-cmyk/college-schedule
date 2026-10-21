"use client";

import { useMemo } from "react";

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт"];

interface MobileWeekDaysStripProps {
  weekAnchorDate: Date;
  selectedDayIndex: number;
  onSelectDay: (index: number) => void;
  isCurrentWeek: boolean;
  todayIso: string;
}

export function MobileWeekDaysStrip({
  weekAnchorDate,
  selectedDayIndex,
  onSelectDay,
  isCurrentWeek,
  todayIso,
}: MobileWeekDaysStripProps) {
  const days = useMemo(() => {
    return [0, 1, 2, 3, 4].map((offset) => {
      const d = new Date(weekAnchorDate);
      d.setDate(weekAnchorDate.getDate() + offset);
      const dayNum = d.getDate();
      const dateIso = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(d);
      return {
        offset,
        weekday: WEEKDAYS[offset],
        dayNum,
        dateIso,
        isToday: isCurrentWeek && dateIso === todayIso,
      };
    });
  }, [weekAnchorDate, isCurrentWeek, todayIso]);

  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      onSelectDay(Math.max(0, index - 1));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      onSelectDay(Math.min(4, index + 1));
    }
  };

  return (
    <div
      role="tablist"
      aria-label="Дні тижня"
      className="relative z-10 flex h-11 w-full border-b border-sys-border/60 bg-sys-card backdrop-blur-xs select-none"
    >
      {/* Sliding indicator line at bottom */}
      <div
        aria-hidden="true"
        className="absolute bottom-0 left-0 h-[2.5px] bg-sys-accent transition-transform duration-180 ease-smooth motion-reduce:transition-none"
        style={{
          width: "20%",
          transform: `translateX(${selectedDayIndex * 100}%)`,
        }}
      />

      {days.map((day) => {
        const isSelected = selectedDayIndex === day.offset;
        return (
          <button
            key={day.offset}
            type="button"
            role="tab"
            aria-selected={isSelected}
            aria-controls="day-pager-content"
            tabIndex={isSelected ? 0 : -1}
            onClick={() => onSelectDay(day.offset)}
            onKeyDown={(e) => handleKeyDown(e, day.offset)}
            className={`relative flex h-full w-1/5 flex-col items-center justify-center py-1 transition-colors duration-150 active:scale-[0.96] motion-reduce:transition-none focus:outline-none ${
              isSelected
                ? "text-sys-accent font-bold"
                : "text-sys-text-secondary hover:text-sys-text-primary"
            }`}
          >
            <span className="text-xs font-semibold leading-tight">
              {day.weekday}
            </span>
            <div className="relative flex flex-col items-center justify-center mt-0.5">
              <span className={`text-[13px] leading-tight ${isSelected ? "font-bold text-sys-accent" : "font-medium"}`}>
                {day.dayNum}
              </span>
              {day.isToday && (
                <span
                  aria-label="Сьогодні"
                  title="Сьогодні"
                  className="absolute -bottom-1 left-1/2 -translate-x-1/2 h-1 w-1 rounded-full bg-sys-accent"
                />
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
