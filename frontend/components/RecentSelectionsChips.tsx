"use client";

import { useMemo } from "react";
import type { ReferenceRecord } from "../lib/api";

export interface RecentSelectionsChipsProps {
  mode: "student" | "teacher";
  currentId: number | null | undefined;
  recentIds: number[];
  options: ReferenceRecord[];
  onSelect: (id: number) => void;
  className?: string;
}

export function RecentSelectionsChips({
  mode,
  currentId,
  recentIds,
  options,
  onSelect,
  className = "",
}: RecentSelectionsChipsProps) {
  const recentItems = useMemo(() => {
    return recentIds
      .map((id) => options.find((opt) => opt.id === id))
      .filter((opt): opt is ReferenceRecord => Boolean(opt));
  }, [recentIds, options]);

  // Якщо історія порожня - не рендеримо нічого (без порожніх рамок)
  if (recentItems.length === 0) return null;

  return (
    <div className={`pt-2.5 pb-1 ${className}`}>
      <div className="flex items-center justify-between text-[11px] font-semibold text-sys-text-muted mb-1.5 px-0.5">
        <span className="flex items-center gap-1.5">
          <svg
            className="w-3.5 h-3.5 text-sys-accent shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>Нещодавні:</span>
        </span>
      </div>
      {/* Рендеримо виключно наявні елементи (якщо 1 - то тільки 1), без порожніх слотів чи плейсхолдерів */}
      <div
        className="flex flex-wrap gap-1.5"
        role="group"
        aria-label={`Нещодавні ${mode === "student" ? "групи" : "викладачі"}`}
      >
        {recentItems.map((item) => {
          const isSelected = item.id === currentId;
          return (
            <button
              key={`recent-${mode}-${item.id}`}
              type="button"
              aria-pressed={isSelected}
              onClick={() => onSelect(item.id)}
              className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors duration-fast border flex items-center gap-1.5 active:scale-95 ${
                isSelected
                  ? "bg-sys-accent/15 border-sys-accent/50 text-sys-accent shadow-xs"
                  : "bg-sys-bg border-sys-border text-sys-text-primary hover:border-sys-accent/40 hover:text-sys-accent hover:bg-sys-card"
              }`}
            >
              <span>{item.name}</span>
              {isSelected && (
                <span className="text-[10px] text-sys-accent font-bold" aria-hidden="true">
                  ✓
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
