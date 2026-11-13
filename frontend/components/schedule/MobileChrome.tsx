"use client";

import { ChevronDownIcon, LightbulbIcon } from "@/components/ui/Icons";
import type { HeaderLearningModeData } from "../../lib/schedule";
import type { MobileTab } from "../../lib/useMobileNav";
import { PeriodIcon, type getPeriodMeta } from "../SchedulePeriodCard";

type PeriodBadgeMeta = ReturnType<typeof getPeriodMeta>;

interface MobileChromeProps {
  mode: "student" | "teacher";
  mobileTab: MobileTab;
  currentName?: string;
  isTeacherUnlocked: boolean;
  canNavigatePrevWeek: boolean;
  canNavigateNextWeek: boolean;
  compactWeekRange: string;
  currentWeekNumber: number | null;
  weekType: string;
  headerLearningModeData: HeaderLearningModeData | null;
  activeWeekPeriodMeta: PeriodBadgeMeta | null;
  onOpenContextModal: () => void;
  onOpenTeacherPinModal: () => void;
  onShiftWeekPreservingDay: (offset: number) => void;
  onOpenDatePicker: () => void;
  onOpenWeekTypeSheet: () => void;
  onOpenGuideHub: () => void;
}

export function MobileChrome({
  mode,
  mobileTab,
  currentName,
  isTeacherUnlocked,
  canNavigatePrevWeek,
  canNavigateNextWeek,
  compactWeekRange,
  currentWeekNumber,
  weekType,
  headerLearningModeData,
  activeWeekPeriodMeta,
  onOpenContextModal,
  onOpenTeacherPinModal,
  onShiftWeekPreservingDay,
  onOpenDatePicker,
  onOpenWeekTypeSheet,
  onOpenGuideHub,
}: MobileChromeProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-sys-border bg-sys-card pt-[env(safe-area-inset-top)] lg:hidden">
      {/* Tier 1 (h-14): [ДФКР Група ▾]   ‹ 19–25 жовт. ›   [💡] */}
      <div className="flex h-14 items-center justify-between px-3 gap-1.5 overflow-hidden">
        {/* Left: Brand + Context Selector */}
        <div className="flex items-center gap-1.5 shrink-0">
          <a
            href="https://kre.dp.ua/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center shrink-0 hover:opacity-85 transition-opacity"
            title="Дніпровський фаховий коледж радіоелектроніки"
          >
            <span className="rounded bg-sys-accent/15 px-1.5 py-0.5 text-[11px] font-black uppercase tracking-wider text-sys-accent border border-sys-accent/20">
              ДФКР
            </span>
          </a>
          <button
            type="button"
            onClick={onOpenContextModal}
            aria-label="Обрати групу або викладача"
            className="flex h-10 items-center gap-1 rounded-xl border border-sys-border bg-sys-bg/90 px-2 text-xs font-semibold text-sys-text-primary hover:border-sys-accent/60 active:scale-95 transition-colors duration-fast ease-smooth truncate max-w-[105px] sm:max-w-[145px] shrink-0"
          >
            <span className="truncate">
              {currentName || (mode === "student" ? "Група" : "Викладач")}
            </span>
            <ChevronDownIcon className="h-3.5 w-3.5 text-sys-text-muted shrink-0" />
          </button>
          {mode === "teacher" && !isTeacherUnlocked && (
            <button
              type="button"
              onClick={onOpenTeacherPinModal}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-sys-border bg-sys-bg/90 text-sys-text-secondary hover:text-sys-accent transition-colors duration-fast ease-smooth active:scale-95 shrink-0"
              title="Вхід для викладача (PIN)"
              aria-label="Вхід для викладача (PIN)"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </button>
          )}
        </div>

        {/* Center: Week Navigator & week type info */}
        {mobileTab === "tasks" ? (
          <div className="flex flex-col items-center justify-center flex-1 min-w-0">
            <span className="text-sm font-bold text-sys-text-primary">Завдання</span>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center flex-1 min-w-0">
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                disabled={!canNavigatePrevWeek}
                onClick={() => onShiftWeekPreservingDay(-1)}
                aria-label="Попередній тиждень"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-sys-text-secondary hover:text-sys-text-primary hover:bg-sys-bg active:scale-90 transition-colors duration-fast ease-smooth shrink-0 disabled:opacity-30 disabled:pointer-events-none"
              >
                <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m15 18-6-6 6-6" />
                </svg>
              </button>

              <button
                type="button"
                onClick={onOpenDatePicker}
                aria-label="Обрати дату в календарі"
                title="Відкрити календар для вибору дати"
                className="flex items-center justify-center gap-1 px-1.5 py-0.5 rounded-lg hover:bg-sys-bg text-center truncate min-w-0 max-w-[135px] sm:max-w-[185px] transition-colors active:scale-95 cursor-pointer"
              >
                <span className="text-xs sm:text-[13px] font-bold text-sys-text-primary block truncate leading-tight">
                  {compactWeekRange}
                </span>
                <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-sys-accent opacity-90">
                  <rect width="18" height="18" x="3" y="4" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              </button>

              <button
                type="button"
                disabled={!canNavigateNextWeek}
                onClick={() => onShiftWeekPreservingDay(1)}
                aria-label="Наступний тиждень"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-sys-text-secondary hover:text-sys-text-primary hover:bg-sys-bg active:scale-90 transition-colors duration-fast ease-smooth shrink-0 disabled:opacity-30 disabled:pointer-events-none"
              >
                <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m9 18 6-6-6-6" />
                </svg>
              </button>
            </div>

            <button
              type="button"
              onClick={onOpenWeekTypeSheet}
              className="flex items-center justify-center gap-1 text-[11px] text-sys-text-muted hover:text-sys-text-secondary leading-none py-0.5 whitespace-nowrap overflow-hidden max-w-full"
            >
              {currentWeekNumber ? <span className="shrink-0">{currentWeekNumber} тиждень</span> : null}
              {weekType !== "both" && (
                <>
                  {currentWeekNumber ? <span className="shrink-0">·</span> : null}
                  <span className="underline decoration-dotted underline-offset-2 shrink-0">
                    {weekType === "numerator" ? "чисельник" : "знаменник"}
                  </span>
                  <span className="text-[10px] shrink-0">ⓘ</span>
                </>
              )}
              {headerLearningModeData && (
                <>
                  {(currentWeekNumber || weekType !== "both") && <span className="shrink-0">·</span>}
                  <span className="font-semibold text-sys-text-secondary shrink-0">
                    {headerLearningModeData.baseLabel}
                  </span>
                </>
              )}
              {activeWeekPeriodMeta && (
                <>
                  {(currentWeekNumber || weekType !== "both" || headerLearningModeData) && <span className="shrink-0">·</span>}
                  <span className="inline-flex items-center gap-1 font-semibold text-violet-700 dark:text-violet-400 shrink-0">
                    <PeriodIcon periodType={activeWeekPeriodMeta.periodType} className="h-3 w-3 shrink-0" />
                    <span>{activeWeekPeriodMeta.shortLabel}</span>
                  </span>
                </>
              )}
            </button>
          </div>
        )}

        {/* Right: Guide 💡 */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onOpenGuideHub}
            aria-label="Гід та довідник можливостей"
            title="Гід та довідник"
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-sys-border bg-sys-bg/90 text-sys-accent hover:border-sys-accent/60 active:scale-95 transition-colors duration-fast ease-smooth"
          >
            <LightbulbIcon className="h-[18px] w-[18px]" />
          </button>
        </div>
      </div>
    </header>
  );
}
