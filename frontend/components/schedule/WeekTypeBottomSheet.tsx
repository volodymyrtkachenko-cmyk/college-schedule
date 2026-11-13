"use client";

import { AnimatePresence, motion } from "framer-motion";

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
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="weekTypeBackdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={onClose}
        >
          <motion.div
            key="weekTypeContent"
            role="dialog"
            aria-modal="true"
            aria-labelledby="week-type-sheet-title"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 26, stiffness: 300 }}
            className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl border border-sys-border bg-sys-card p-5 sm:p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
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
                ✕
              </button>
            </div>
            <div className="mt-4 space-y-3 text-sm text-sys-text-secondary leading-relaxed">
              <div className="rounded-xl border border-sys-border/60 bg-sys-bg/60 p-3.5">
                <span className="font-bold text-sys-text-primary block mb-1">
                  {weekType === "numerator" ? "📘 Чисельник (непарний)" : "📙 Знаменник (парний)"}
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
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
