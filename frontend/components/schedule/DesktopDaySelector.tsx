import type { CSSProperties } from "react";
import type { WeekDayMini } from "../../lib/schedule";

interface DesktopDaySelectorProps {
  days: WeekDayMini[];
  selectedDayIndex: number;
  todayActualIso: string;
  shouldReduceMotion: boolean;
  onSelectDayIndex: (index: number) => void;
}

export function DesktopDaySelector({
  days,
  selectedDayIndex,
  todayActualIso,
  shouldReduceMotion,
  onSelectDayIndex,
}: DesktopDaySelectorProps) {
  const activePosition = days.findIndex((day) => day.index === selectedDayIndex);

  return (
    <div
      className="desktop-day-selector relative grid grid-cols-5 isolate"
      data-reduced-motion={shouldReduceMotion || undefined}
    >
      {activePosition >= 0 && (
        <div
          aria-hidden="true"
          className="desktop-day-indicator pointer-events-none absolute left-0 bottom-0"
          style={{ "--day-position": activePosition } as CSSProperties}
        />
      )}
      {days.map((day) => {
        const isActive = day.index === selectedDayIndex;
        return (
          <button
            key={day.iso}
            type="button"
            aria-pressed={isActive}
            onClick={() => onSelectDayIndex(day.index)}
            className={`relative flex min-h-16 flex-col items-center justify-center rounded-t-lg pb-1 cursor-pointer transition-colors duration-fast hover:bg-sys-bg focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sys-accent ${
              isActive ? "text-sys-text-primary" : "text-sys-text-secondary hover:text-sys-text-primary"
            }`}
          >
            <span className="flex items-center justify-center gap-1.5 text-xs uppercase font-semibold">
              {day.name}
              {day.iso === todayActualIso && (
                <span role="img" aria-label="Сьогодні" className="h-1.5 w-1.5 rounded-full bg-sys-accent" />
              )}
            </span>
            <span className="ui-mono-slot text-xl font-bold mt-0.5 leading-none">{day.dateStr}</span>
          </button>
        );
      })}
    </div>
  );
}
