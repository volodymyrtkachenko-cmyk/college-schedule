"use client";

import { useEffect, useRef, useState } from "react";
import { TransitionLink } from "@/components/navigation/NavigationTransitionProvider";
import {
  BarChartIcon,
  BellIcon,
  BookOpenIcon,
  CalendarIcon,
  ChevronDownIcon,
  LightbulbIcon,
} from "@/components/ui/Icons";
import { useAnimatedDisclosure } from "@/lib/useAnimatedDisclosure";
import { ThemeMorphButton } from "@/components/ui/ThemeMorphButton";

const SECTION_LINKS = [
  { href: "/bells", label: "Дзвінки", description: "Розклад пар та перерв", icon: BellIcon },
  {
    href: "/educational-process",
    label: "Графік процесу",
    description: "Семестри, сесії та канікули",
    icon: CalendarIcon,
  },
  {
    href: "/statistics",
    label: "Статистика",
    description: "Виконання плану і години",
    icon: BarChartIcon,
  },
  {
    href: "/atlas",
    label: "Атлас ДФКР",
    description: "Навігація і структура",
    icon: BookOpenIcon,
  },
] as const;

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
  isTeacherUnlocked: boolean;
  resolvedTheme: "light" | "dark";
  onOpenContextModal: () => void;
  onPrevPeriod: () => void;
  onNextPeriod: () => void;
  onResetToday: () => void;
  onOpenDatePicker: () => void;
  onViewChange: (nextView: "today" | "week") => void;
  onOpenTeacherPinModal: () => void;
  onToggleTheme: (e?: React.MouseEvent<HTMLButtonElement>) => void;
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
  const [navMenuOpen, setNavMenuOpen] = useState(false);
  const navMenuRef = useRef<HTMLDivElement | null>(null);
  const navTriggerRef = useRef<HTMLButtonElement | null>(null);
  const navListRef = useRef<HTMLDivElement | null>(null);
  const keyboardTriggerRef = useRef(false);
  const openFocusTargetRef = useRef<"first" | "last" | null>(null);

  const { shouldRender: shouldRenderNavMenu, isClosing: isNavMenuClosing } =
    useAnimatedDisclosure(navMenuOpen, 170);

  const getMenuItems = () => {
    if (!navListRef.current) return [];
    return Array.from(navListRef.current.querySelectorAll<HTMLElement>('[role="menuitem"]'));
  };

  useEffect(() => {
    if (!navMenuOpen) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (navMenuRef.current && !navMenuRef.current.contains(e.target as Node)) {
        setNavMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setNavMenuOpen(false);
        navTriggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [navMenuOpen]);

  useEffect(() => {
    if (!navMenuOpen || !shouldRenderNavMenu || !openFocusTargetRef.current) return;
    const target = openFocusTargetRef.current;
    openFocusTargetRef.current = null;
    const rafId = requestAnimationFrame(() => {
      const items = getMenuItems();
      if (items.length === 0) return;
      const el = target === "last" ? items[items.length - 1] : items[0];
      el?.focus();
    });
    return () => cancelAnimationFrame(rafId);
  }, [navMenuOpen, shouldRenderNavMenu]);

  const handleMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const items = getMenuItems();
    if (items.length === 0) return;
    const currentIdx = items.indexOf(document.activeElement as HTMLElement);

    if (e.key === "ArrowDown") {
      e.preventDefault();
      const nextIdx = currentIdx < 0 ? 0 : (currentIdx + 1) % items.length;
      items[nextIdx]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prevIdx = currentIdx < 0 ? items.length - 1 : (currentIdx - 1 + items.length) % items.length;
      items[prevIdx]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      items[items.length - 1]?.focus();
    } else if (e.key === "Tab") {
      setNavMenuOpen(false);
    }
  };

  const isTodayButtonDisabled =
    (view === "today" && isCurrentWeek && isTodaySelected) ||
    (view === "week" && isCurrentWeek);

  return (
    <header className="vt-desktop-header desktop-toolbar-scroll sticky top-0 z-40 hidden lg:block min-h-[3.5rem] border-b border-sys-border bg-sys-card">
      <div
        aria-hidden="true"
        className="desktop-scroll-progress pointer-events-none absolute inset-x-0 bottom-0 h-[2px] bg-sys-accent/85"
      />
      <div className="mx-auto grid min-h-[3.5rem] max-w-[1800px] grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 px-3 lg:px-4 xl:px-6 py-1.5">
        {/* Left Zone: Brand + Context Selector */}
        <div className="flex items-center gap-2.5 min-w-0">
          <a
            href="https://kre.dp.ua/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 shrink-0 hover:opacity-85 transition-opacity"
            title="Дніпровський фаховий коледж радіоелектроніки"
          >
            <span className="rounded-md bg-sys-accent/15 px-2 py-0.5 text-xs font-black uppercase tracking-wider text-sys-accent border border-sys-accent/20">
              ДФКР
            </span>
            <span className="hidden xl:inline text-sm font-bold tracking-tight text-sys-text-primary">
              Розклад
            </span>
          </a>

          <button
            type="button"
            onClick={onOpenContextModal}
            aria-label="Обрати групу або викладача"
            className="flex h-9 items-center gap-1.5 rounded-xl border border-sys-border bg-sys-bg/80 px-2.5 xl:px-3 text-xs xl:text-sm font-medium text-sys-text-primary hover:border-sys-accent/60 hover:bg-sys-bg transition-colors duration-fast ease-smooth truncate min-w-0 max-w-[190px] xl:max-w-[260px] focus:outline-none focus:ring-2 focus:ring-sys-accent cursor-pointer"
          >
            <span className="text-sys-text-muted shrink-0">
              {mode === "student" ? "Група:" : "Викладач:"}
            </span>
            <span className="truncate font-semibold text-sys-text-primary">
              {currentName || (mode === "student" ? "Оберіть групу" : "Оберіть викладача")}
            </span>
            <ChevronDownIcon className="h-3.5 w-3.5 text-sys-text-muted ml-auto shrink-0" />
          </button>
        </div>

        {/* Center Zone: Unified Period Navigator + View Switcher */}
        <div className="flex items-center justify-center gap-2 shrink-0">
          <div
            role="group"
            aria-label="Навігація по датах"
            className="flex h-9 items-center rounded-xl border border-sys-border bg-sys-bg p-0.5 text-xs"
          >
            <button
              type="button"
              disabled={view === "today" ? !canNavigatePrevDay : !canNavigatePrevWeek}
              onClick={onPrevPeriod}
              aria-label="Попередній період"
              title="Попередній період"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-sys-text-secondary hover:bg-sys-card hover:text-sys-text-primary transition-colors disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
            >
              <svg
                aria-hidden="true"
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m15 18-6-6 6-6" />
              </svg>
            </button>
            <button
              type="button"
              onClick={onResetToday}
              disabled={isTodayButtonDisabled}
              aria-label="Перейти на сьогодні"
              title="Перейти на сьогодні"
              className={`px-2.5 xl:px-3 h-8 rounded-lg font-medium transition-colors whitespace-nowrap ${
                isTodayButtonDisabled
                  ? "text-sys-text-muted cursor-default bg-transparent opacity-50"
                  : "text-sys-text-secondary hover:text-sys-text-primary hover:bg-sys-card active:scale-95 cursor-pointer"
              }`}
            >
              Сьогодні
            </button>
            <span role="separator" aria-orientation="vertical" className="mx-0.5 h-4 w-px bg-sys-border/80 shrink-0" />
            <button
              type="button"
              onClick={onOpenDatePicker}
              aria-label="Обрати дату в календарі"
              title="Обрати дату в календарі"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-sys-accent hover:bg-sys-card active:scale-95 transition-colors cursor-pointer"
            >
              <CalendarIcon className="h-4 w-4 shrink-0" />
            </button>
            <button
              type="button"
              disabled={view === "today" ? !canNavigateNextDay : !canNavigateNextWeek}
              onClick={onNextPeriod}
              aria-label="Наступний період"
              title="Наступний період"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-sys-text-secondary hover:bg-sys-card hover:text-sys-text-primary transition-colors disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
            >
              <svg
                aria-hidden="true"
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m9 18 6-6-6-6" />
              </svg>
            </button>
          </div>

          {/* Segmented Switcher: [ День | Тиждень ] with GPU translate3d */}
          <div
            role="group"
            aria-label="Режим відображення"
            className="relative grid h-9 grid-cols-2 items-center rounded-xl border border-sys-border bg-sys-bg p-0.5 text-xs isolate"
          >
            <div
              aria-hidden="true"
              className="pointer-events-none absolute top-0.5 bottom-0.5 transition-transform duration-base ease-spring transform-gpu z-0"
              style={{
                left: "2px",
                width: "calc((100% - 4px) / 2)",
                transform: `translate3d(${view === "week" ? "100%" : "0%"}, 0, 0)`,
              }}
            >
              <div className="h-full w-full rounded-lg bg-sys-accentSolid shadow-xs" />
            </div>
            <button
              type="button"
              aria-pressed={view === "today"}
              onClick={() => onViewChange("today")}
              className={`relative z-10 flex h-8 items-center justify-center px-3 xl:px-3.5 rounded-lg font-semibold transition-colors duration-150 cursor-pointer ${
                view === "today" ? "text-sys-onAccent" : "text-sys-text-secondary hover:text-sys-text-primary"
              }`}
            >
              День
            </button>
            <button
              type="button"
              aria-pressed={view === "week"}
              onClick={() => onViewChange("week")}
              className={`relative z-10 flex h-8 items-center justify-center px-3 xl:px-3.5 rounded-lg font-semibold transition-colors duration-150 cursor-pointer ${
                view === "week" ? "text-sys-onAccent" : "text-sys-text-secondary hover:text-sys-text-primary"
              }`}
            >
              Тиждень
            </button>
          </div>
        </div>

        {/* Right Zone: Teacher PIN, Borderless Sections Popover, Theme, Settings */}
        <div className="flex items-center justify-end gap-1 min-w-0">
          {mode === "teacher" && !isTeacherUnlocked && (
            <button
              type="button"
              onClick={onOpenTeacherPinModal}
              className="mr-1 flex h-9 items-center gap-1.5 px-2.5 rounded-xl text-xs font-semibold border border-sys-border bg-sys-bg text-sys-text-secondary hover:border-sys-accent/40 hover:text-sys-accent transition-colors duration-fast ease-smooth active:scale-95 cursor-pointer shrink-0 whitespace-nowrap"
              title="Вхід для викладача (PIN)"
            >
              <svg
                aria-hidden="true"
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="shrink-0 text-sys-accent"
              >
                <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              <span className="hidden xl:inline">Вхід викладача</span>
              <span className="xl:hidden">Вхід</span>
            </button>
          )}

          <div ref={navMenuRef} className="relative shrink-0">
            <button
              ref={navTriggerRef}
              id="desktop-sections-trigger"
              type="button"
              onClick={() => {
                setNavMenuOpen((prev) => {
                  const next = !prev;
                  openFocusTargetRef.current = next && keyboardTriggerRef.current ? "first" : null;
                  keyboardTriggerRef.current = false;
                  return next;
                });
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  if (navMenuOpen) {
                    const items = getMenuItems();
                    const el = e.key === "ArrowUp" ? items[items.length - 1] : items[0];
                    el?.focus();
                  } else {
                    openFocusTargetRef.current = e.key === "ArrowUp" ? "last" : "first";
                    setNavMenuOpen(true);
                  }
                } else if (e.key === "Enter" || e.key === " ") {
                  keyboardTriggerRef.current = true;
                }
              }}
              aria-expanded={navMenuOpen}
              aria-haspopup="menu"
              aria-controls="desktop-sections-menu"
              aria-label="Розділи коледжу"
              title="Розділи коледжу та гід"
              className={`flex h-9 items-center justify-center gap-1.5 rounded-xl px-2.5 text-xs font-semibold transition-colors duration-fast ease-smooth focus:outline-none focus:ring-2 focus:ring-sys-accent cursor-pointer active:scale-95 ${
                navMenuOpen
                  ? "bg-sys-accent/10 text-sys-accent"
                  : "text-sys-text-secondary hover:bg-sys-bg hover:text-sys-text-primary"
              }`}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="shrink-0"
              >
                <rect width="7" height="7" x="3" y="3" rx="1" />
                <rect width="7" height="7" x="14" y="3" rx="1" />
                <rect width="7" height="7" x="14" y="14" rx="1" />
                <rect width="7" height="7" x="3" y="14" rx="1" />
              </svg>
              <span className="hidden xl:inline">Розділи</span>
              <ChevronDownIcon
                className={`h-3.5 w-3.5 shrink-0 transition-transform duration-150 ${
                  navMenuOpen ? "rotate-180" : ""
                }`}
              />
            </button>

            {shouldRenderNavMenu && (
              <div
                ref={navListRef}
                id="desktop-sections-menu"
                role="menu"
                aria-labelledby="desktop-sections-trigger"
                onKeyDown={handleMenuKeyDown}
                data-closing={isNavMenuClosing ? "true" : undefined}
                style={{ "--popup-y": "-6px", transformOrigin: "top right" } as React.CSSProperties}
                className="discrete-popup desktop-spring-popup absolute right-0 top-full mt-2 w-64 rounded-2xl border border-sys-border bg-sys-card p-1.5 shadow-xl z-50"
              >
                {SECTION_LINKS.map((item) => {
                  const Icon = item.icon;
                  return (
                    <TransitionLink
                      key={item.href}
                      href={item.href}
                      role="menuitem"
                      tabIndex={-1}
                      onClick={() => setNavMenuOpen(false)}
                      className="flex items-start gap-2.5 rounded-xl px-3 py-2 text-left transition-colors hover:bg-sys-bg focus:bg-sys-bg focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sys-accent group"
                    >
                      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-sys-border bg-sys-bg text-sys-accent group-hover:border-sys-accent/40">
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-semibold text-sys-text-primary leading-snug">
                          {item.label}
                        </span>
                        <span className="block text-[11px] text-sys-text-muted leading-snug">
                          {item.description}
                        </span>
                      </span>
                    </TransitionLink>
                  );
                })}

                <hr className="my-1.5 border-sys-border/70" />

                <button
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  onClick={() => {
                    setNavMenuOpen(false);
                    onOpenGuideHub();
                  }}
                  className="flex w-full items-start gap-2.5 rounded-xl px-3 py-2 text-left transition-colors hover:bg-sys-bg focus:bg-sys-bg focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sys-accent cursor-pointer group"
                >
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-sys-accent/25 bg-sys-accent/10 text-sys-accent group-hover:border-sys-accent/50">
                    <LightbulbIcon className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold text-sys-text-primary leading-snug">
                      Гід та довідник
                    </span>
                    <span className="block text-[11px] text-sys-text-muted leading-snug">
                      Огляд можливостей і підказки
                    </span>
                  </span>
                </button>
              </div>
            )}
          </div>

          <span role="separator" aria-orientation="vertical" className="mx-0.5 h-4 w-px bg-sys-border/80 shrink-0" />

          <ThemeMorphButton
            resolvedTheme={resolvedTheme}
            onToggleTheme={onToggleTheme}
          />

          <TransitionLink
            href={`/settings?mode=${mode}`}
            aria-label="Налаштування застосунку"
            title="Налаштування"
            className="spring-press flex h-9 w-9 items-center justify-center rounded-xl text-sys-text-secondary hover:bg-sys-bg hover:text-sys-text-primary transition-colors duration-fast ease-smooth focus:outline-none focus:ring-2 focus:ring-sys-accent shrink-0"
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
          </TransitionLink>
        </div>
      </div>
    </header>
  );
}
