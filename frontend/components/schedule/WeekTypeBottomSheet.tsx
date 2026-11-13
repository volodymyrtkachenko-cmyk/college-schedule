"use client";

import { AppDialog } from "../ui/AppDialog";
import { BookOpenIcon, CloseIcon } from "../ui/Icons";

interface WeekTypeBottomSheetProps {
  isOpen: boolean;
  weekType: string;
  currentWeekNumber: number | null;
  isCurrentWeek: boolean;
  canNavigateNextWeek: boolean;
  onClose: () => void;
  onNextWeek: () => void;
  onResetCurrentWeek: () => void;
}

export function WeekTypeBottomSheet({
  isOpen,
  weekType,
  currentWeekNumber,
  isCurrentWeek,
  canNavigateNextWeek,
  onClose,
  onNextWeek,
  onResetCurrentWeek,
}: WeekTypeBottomSheetProps) {
  return (
    <AppDialog
      isOpen={isOpen}
      onClose={onClose}
      variant="sheet"
      maxWidth="448px"
      labelledBy="week-type-sheet-title"
    >
      <div className="w-full rounded-t-3xl sm:rounded-2xl border border-sys-border bg-sys-card p-5 pb-safe sm:p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-sys-border/60">
              <h2 id="week-type-sheet-title" className="text-base font-bold text-sys-text-primary">
                Тип тижня за графіком
              </h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Закрити"
                className="flex h-8 w-8 items-center justify-center rounded-xl border border-sys-border text-sys-text-secondary hover:text-sys-text-primary hover:bg-sys-bg transition-colors"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-4 space-y-3 text-sm text-sys-text-secondary leading-relaxed">
              <div className="rounded-xl border border-sys-border/60 bg-sys-bg/60 p-3.5">
                <span className="inline-flex items-center gap-2 font-bold text-sys-text-primary mb-1">
                  <BookOpenIcon className={`h-4 w-4 shrink-0 ${weekType === "numerator" ? "text-sky-600 dark:text-sky-400" : "text-amber-600 dark:text-amber-400"}`} />
                  <span>{weekType === "numerator" ? "Чисельник (непарний)" : "Знаменник (парний)"}</span>
                </span>
                <p className="text-xs text-sys-text-secondary">
                  {weekType === "numerator"
                    ? "Чисельник — це непарні тижні навчального семестру (1, 3, 5, 7…). Заняття чергуються за графіком коледжу."
                    : "Знаменник — це парні тижні навчального семестру (2, 4, 6, 8…). Заняття чергуються за графіком коледжу."}
                </p>
              </div>
              {currentWeekNumber && (
                <p className="text-xs text-sys-text-muted">
                  Поточний навчальний тиждень: <strong>{currentWeekNumber}-й тиждень</strong>.
                </p>
              )}
              <div className="pt-2 border-t border-sys-border/40 space-y-2">
                <button
                  type="button"
                  disabled={!canNavigateNextWeek}
                  onClick={() => {
                    onNextWeek();
                    onClose();
                  }}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-sys-tabActive border border-sys-border px-4 py-2.5 text-xs font-semibold text-sys-text-primary hover:border-sys-accent hover:text-sys-accent active:scale-[0.98] transition-colors duration-fast ease-smooth disabled:opacity-40 disabled:pointer-events-none"
                >
                  <span>Перейти на {weekType === "numerator" ? "знаменник (наступний тиждень)" : "чисельник (наступний тиждень)"}</span>
                  <span>→</span>
                </button>
                {!isCurrentWeek && (
                  <button
                    type="button"
                    onClick={() => {
                      onResetCurrentWeek();
                      onClose();
                    }}
                    className="w-full flex items-center justify-center gap-1.5 rounded-xl border border-transparent py-1.5 text-xs font-medium text-sys-accent hover:underline active:scale-[0.98]"
                  >
                    Повернутися до поточного тижня
                  </button>
                )}
              </div>
            </div>
      </div>
    </AppDialog>
  );
}
