"use client";

import { TransitionLink } from "@/components/navigation/NavigationTransitionProvider";
import type { HeaderLearningModeData } from "../../lib/schedule";

interface DesktopToolbarProps {
  mode: "student" | "teacher";
  currentName?: string;
  view: "today" | "week";
  canNavigatePrevDay: boolean;
  canNavigateNextDay: boolean;
  canNavigatePrevWeek: boolean;
  canNavigateNextWeek: boolean;
  isCurrentWeek: boolean;
  isTodaySelected: boolean;
  compactWeekRange: string;
  headerLearningModeData: HeaderLearningModeData | null;
  isTeacherUnlocked: boolean;
  resolvedTheme: "light" | "dark";
  onOpenContextModal: () => void;
  onPrevPeriod: () => void;
  onNextPeriod: () => void;
  onResetToday: () => void;
  onOpenDatePicker: () => void;
  onViewChange: (nextView: "today" | "week") => void;
  onOpenTeacherPinModal: () => void;
  onToggleTheme: () => void;
  onOpenGuideHub: () => void;
}

export function DesktopToolbar({
  mode,
  currentName,
  view,
  canNavigatePrevDay,
  canNavigateNextDay,
  canNavigatePrevWeek,
  canNavigateNextWeek,
  isCurrentWeek,
  isTodaySelected,
  compactWeekRange,
  headerLearningModeData,
  isTeacherUnlocked,
  resolvedTheme,
  onOpenContextModal,
  onPrevPeriod,
  onNextPeriod,
  onResetToday,
  onOpenDatePicker,
  onViewChange,
  onOpenTeacherPinModal,
  onToggleTheme,
  onOpenGuideHub,
}: DesktopToolbarProps) {
  const isTodayButtonDisabled =
    (view === "today" && isCurrentWeek && isTodaySelected) ||
    (view === "week" && isCurrentWeek);

  return (
    <header className="vt-desktop-header sticky top-0 z-40 hidden lg:block h-14 border-b border-sys-border bg-sys-card">
      <div className="mx-auto flex h-full max-w-[1800px] items-center justify-between gap-3 px-4 xl:px-6">
        {/* Left Zone: Brand + Context Selector */}
        <div className="flex items-center gap-3 min-w-0">
          <a
            href="https://kre.dp.ua/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 shrink-0 hover:opacity-85 transition-opacity"
            title="Дніпровський фаховий коледж радіоелектроніки"
          >
            <span className="rounded bg-sys-accent/15 px-2 py-0.5 text-xs font-black uppercase tracking-wider text-sys-accent border border-sys-accent/20">
              ДФКР
            </span>
            <span className="text-sm font-bold tracking-tight text-sys-text-primary">
              Розклад
            </span>
          </a>

          <button
            type="button"
            onClick={onOpenContextModal}
            aria-label="Обрати групу або викладача"
            className="flex h-10 items-center gap-2 rounded-xl border border-sys-border bg-sys-bg/80 px-3 text-sm font-medium text-sys-text-primary hover:border-sys-accent/60 hover:bg-sys-bg transition-colors duration-fast ease-smooth truncate max-w-[260px] focus:outline-none focus:ring-2 focus:ring-sys-accent"
          >
            <span className="text-sys-text-muted shrink-0">
              {mode === "student" ? "Група:" : "Викладач:"}
            </span>
            <span className="truncate font-semibold text-sys-text-primary">
              {currentName || (mode === "student" ? "Оберіть групу" : "Оберіть викладача")}
            </span>
            <span className="text-sys-text-muted text-xs ml-auto shrink-0">▼</span>
          </button>
        </div>

        {/* Center Zone: Date Navigator + View Mode */}
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="flex items-center rounded-xl border border-sys-border bg-sys-bg p-0.5 text-xs">
            <button
              type="button"
              disabled={view === "today" ? !canNavigatePrevDay : !canNavigatePrevWeek}
              onClick={onPrevPeriod}
              aria-label="Попередній період"
              title="Попередній період"
              className="flex h-10 w-10 items-center justify-center rounded-lg text-sys-text-secondary hover:bg-sys-card hover:text-sys-text-primary transition-colors disabled:opacity-30 disabled:pointer-events-none"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m15 18-6-6 6-6" />
              </svg>
            </button>
            <button
              type="button"
              onClick={onResetToday}
              disabled={isTodayButtonDisabled}
              aria-label="Перейти на сьогодні"
              title="Перейти на сьогодні"
              className={`px-3.5 h-10 rounded-lg font-medium transition-colors ${
                isTodayButtonDisabled
                  ? "text-sys-text-muted cursor-default bg-transparent opacity-50"
                  : "text-sys-text-secondary hover:text-sys-text-primary hover:bg-sys-card active:scale-95"
              }`}
            >
              Сьогодні
            </button>
            <button
              type="button"
              disabled={view === "today" ? !canNavigateNextDay : !canNavigateNextWeek}
              onClick={onNextPeriod}
              aria-label="Наступний період"
              title="Наступний період"
              className="flex h-10 w-10 items-center justify-center rounded-lg text-sys-text-secondary hover:bg-sys-card hover:text-sys-text-primary transition-colors disabled:opacity-30 disabled:pointer-events-none"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m9 18 6-6-6-6" />
              </svg>
            </button>
          </div>

          <button
            type="button"
            onClick={onOpenDatePicker}
            aria-label="Обрати дату в календарі"
            title="Обрати дату в календарі"
            className="flex h-10 items-center gap-2 rounded-xl border border-sys-border bg-sys-bg px-3 text-xs font-semibold text-sys-text-primary hover:border-sys-accent/60 hover:bg-sys-card active:scale-95 transition-colors cursor-pointer"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-sys-accent">
              <rect width="18" height="18" x="3" y="4" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <span className="truncate">{compactWeekRange}</span>
          </button>

          {/* Segmented Switcher: [ День | Тиждень ] with GPU translate3d */}
          <div
            role="group"
            aria-label="Режим відображення"
            className="relative grid grid-cols-2 rounded-xl border border-sys-border bg-sys-bg p-1 text-xs isolate"
          >
            <div
              aria-hidden="true"
              className="absolute top-1 bottom-1 pointer-events-none transition-transform duration-150 ease-out transform-gpu z-0"
              style={{
                left: "4px",
                width: "calc((100% - 8px) / 2)",
                transform: `translate3d(${view === "week" ? "100%" : "0%"}, 0, 0)`,
              }}
            >
              <div className="h-full w-full rounded-lg bg-sys-accentSolid shadow-xs" />
            </div>
            <button
              type="button"
              onClick={() => onViewChange("today")}
              className={`relative z-10 h-8 px-3.5 rounded-lg font-semibold transition-colors duration-150 cursor-pointer ${
                view === "today" ? "text-white" : "text-sys-text-secondary hover:text-sys-text-primary"
              }`}
            >
              День
            </button>
            <button
              type="button"
              onClick={() => onViewChange("week")}
              className={`relative z-10 h-8 px-3.5 rounded-lg font-semibold transition-colors duration-150 cursor-pointer ${
                view === "week" ? "text-white" : "text-sys-text-secondary hover:text-sys-text-primary"
              }`}
            >
              Тиждень
            </button>
          </div>
          {headerLearningModeData && (
            <span
              title={headerLearningModeData.title}
              className={`shrink-0 inline-flex items-center justify-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                headerLearningModeData.override
                  ? headerLearningModeData.mode === "offline"
                    ? "border-sys-accent/40 bg-sys-accent/10 text-sys-accent"
                    : "border-amber-500/35 bg-amber-500/10 text-amber-900 dark:text-amber-200"
                  : "border-sys-border bg-sys-surface/80 text-sys-text-secondary"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  headerLearningModeData.mode === "offline"
                    ? "bg-sys-accent"
                    : headerLearningModeData.override
                      ? "bg-amber-500 dark:bg-amber-400"
                      : "bg-slate-400 dark:bg-slate-500"
                }`}
              />
              <span>{headerLearningModeData.fullLabel}</span>
            </span>
          )}
        </div>

        {/* Right Zone: Teacher PIN, Theme, Guide, Settings */}
        <div className="flex items-center gap-2 justify-self-end">
          {mode === "teacher" && !isTeacherUnlocked && (
            <button
              type="button"
              onClick={onOpenTeacherPinModal}
              className="flex h-10 items-center gap-1.5 px-3 rounded-xl text-xs font-semibold border border-sys-border bg-sys-bg text-sys-text-secondary hover:border-sys-accent/40 hover:text-sys-accent transition-colors duration-fast ease-smooth active:scale-95 cursor-pointer"
              title="Вхід для викладача (PIN)"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-sys-accent">
                <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              <span>Вхід викладача</span>
            </button>
          )}

          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={
              resolvedTheme === "dark"
                ? "Поточна тема: Темна (натисніть, щоб змінити)"
                : "Поточна тема: Світла (натисніть, щоб змінити)"
            }
            title={resolvedTheme === "dark" ? "Поточна тема: Темна" : "Поточна тема: Світла"}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-sys-border bg-sys-bg text-sys-text-secondary hover:text-sys-text-primary hover:border-sys-border-elevated active:scale-95 transition-colors duration-fast ease-smooth focus:outline-none focus:ring-2 focus:ring-sys-accent cursor-pointer"
          >
            {resolvedTheme === "dark" ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2" />
                <path d="M12 20v2" />
                <path d="m4.93 4.93 1.41 1.41" />
                <path d="m17.66 17.66 1.41 1.41" />
                <path d="M2 12h2" />
                <path d="M20 12h2" />
                <path d="m6.34 17.66-1.41 1.41" />
                <path d="m19.07 4.93-1.41 1.41" />
              </svg>
            )}
          </button>

          <button
            type="button"
            onClick={onOpenGuideHub}
            aria-label="Гід та довідник можливостей"
            title="Гід та довідник можливостей"
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-sys-border bg-sys-bg text-sys-accent hover:border-sys-accent/60 hover:bg-sys-accent/10 active:scale-95 transition-colors duration-fast ease-smooth focus:outline-none focus:ring-2 focus:ring-sys-accent cursor-pointer text-base"
          >
            💡
          </button>

          <TransitionLink
            href={`/settings?mode=${mode}`}
            aria-label="Налаштування застосунку"
            title="Налаштування"
            className="spring-press flex h-10 items-center justify-center gap-1.5 rounded-xl border border-sys-border bg-sys-bg px-2.5 xl:px-3 text-sys-text-secondary hover:text-sys-text-primary hover:border-sys-border-elevated transition-colors duration-fast ease-smooth focus:outline-none focus:ring-2 focus:ring-sys-accent"
          >
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="shrink-0"
            >
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            <span className="hidden xl:inline text-xs font-semibold">Налаштування</span>
          </TransitionLink>
        </div>
      </div>
    </header>
  );
}
