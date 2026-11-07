"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { useMobileNav, MobileTab } from "../lib/useMobileNav";

export type { MobileTab };

function vibrateTap(ms = 10) {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    try {
      navigator.vibrate(ms);
    } catch {}
  }
}

export function BottomNav() {
  const pathname = usePathname();
  const {
    activeTab,
    setHomeTab,
    overdueCount,
    hideTasksTab,
    scheduleMode,
  } = useMobileNav();

  // Hidden on admin and login routes, or desktop (lg:hidden)
  const isHiddenRoute = pathname?.startsWith("/admin") || pathname?.startsWith("/login");
  if (isHiddenRoute) {
    return null;
  }

  const isHome = pathname === "/";
  const isSettings = pathname?.startsWith("/settings");

  const handleScheduleClick = (e: React.MouseEvent) => {
    vibrateTap(10);
    setHomeTab("schedule");
    if (isHome) {
      // Already on home, no route change needed, just switch tab
      e.preventDefault();
    }
  };

  const handleTasksClick = (e: React.MouseEvent) => {
    vibrateTap(10);
    setHomeTab("tasks");
    if (isHome) {
      // Already on home, no route change needed, just switch tab
      e.preventDefault();
    }
  };

  const handleSettingsClick = (e: React.MouseEvent) => {
    vibrateTap(10);
    if (isSettings) {
      // Already on settings, smooth scroll to top
      e.preventDefault();
      if (typeof window !== "undefined") {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    }
  };

  const scheduleHref = scheduleMode === "teacher" ? "/?mode=teacher" : "/";
  const tasksHref = scheduleMode === "teacher" ? "/?tab=tasks&mode=teacher" : "/?tab=tasks";
  const settingsHref = scheduleMode === "teacher" ? "/settings?mode=teacher" : "/settings";

  return (
    <nav
      aria-label="Нижня навігація"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-sys-border bg-sys-card pb-[env(safe-area-inset-bottom)] lg:hidden [transform:translateZ(0)] [backface-visibility:hidden] will-change-transform"
    >
      <div className="mx-auto flex h-14 max-w-lg items-stretch justify-around px-2">
        {/* Tab 1: Schedule */}
        <Link
          href={scheduleHref}
          onClick={handleScheduleClick}
          aria-label="Розклад"
          aria-pressed={activeTab === "schedule"}
          className={`relative isolate flex flex-1 min-h-[48px] flex-col items-center justify-center gap-0.5 rounded-xl transition-colors duration-fast ease-smooth active:scale-95 ${
            activeTab === "schedule"
              ? "font-bold text-sys-accent"
              : "text-sys-text-secondary hover:text-sys-text-primary font-medium"
          }`}
        >
          {activeTab === "schedule" && (
            <motion.div
              layoutId="bottom-nav-pill"
              className="absolute inset-1 rounded-xl bg-sys-accent/15 -z-10"
              transition={{ type: "spring", stiffness: 450, damping: 35 }}
            />
          )}
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={activeTab === "schedule" ? "2.2" : "1.75"}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect width="18" height="18" x="3" y="4" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          <span className="text-xs leading-tight tracking-tight">Розклад</span>
        </Link>

        {/* Tab 2: Tasks (ДЗ) */}
        {!hideTasksTab && (
          <Link
            href={tasksHref}
            onClick={handleTasksClick}
            aria-label={`Завдання${overdueCount > 0 ? `, прострочено ${overdueCount}` : ""}`}
            aria-pressed={activeTab === "tasks"}
            className={`relative isolate flex flex-1 min-h-[48px] flex-col items-center justify-center gap-0.5 rounded-xl transition-colors duration-fast ease-smooth active:scale-95 ${
              activeTab === "tasks"
                ? "font-bold text-sys-accent"
                : "text-sys-text-secondary hover:text-sys-text-primary font-medium"
            }`}
          >
            {activeTab === "tasks" && (
              <motion.div
                layoutId="bottom-nav-pill"
                className="absolute inset-1 rounded-xl bg-sys-accent/15 -z-10"
                transition={{ type: "spring", stiffness: 450, damping: 35 }}
              />
            )}
            <div className="relative">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={activeTab === "tasks" ? "2.2" : "1.75"}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
                <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
                <path d="M12 11h4" />
                <path d="M12 16h4" />
                <path d="M8 11h.01" />
                <path d="M8 16h.01" />
              </svg>
              {overdueCount > 0 && (
                <span
                  aria-label={`Прострочено: ${overdueCount}`}
                  className="absolute -top-1.5 -right-2.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-xs font-black text-white shadow-xs"
                >
                  {overdueCount}
                </span>
              )}
            </div>
            <span className="text-xs leading-tight tracking-tight">Завдання</span>
          </Link>
        )}

        {/* Tab 3: Settings */}
        <Link
          href={settingsHref}
          onClick={handleSettingsClick}
          aria-label="Налаштування"
          aria-pressed={activeTab === "settings"}
          className={`relative isolate flex flex-1 min-h-[48px] flex-col items-center justify-center gap-0.5 rounded-xl transition-colors duration-fast ease-smooth active:scale-95 ${
            activeTab === "settings"
              ? "font-bold text-sys-accent"
              : "text-sys-text-secondary hover:text-sys-text-primary font-medium"
          }`}
        >
          {activeTab === "settings" && (
            <motion.div
              layoutId="bottom-nav-pill"
              className="absolute inset-1 rounded-xl bg-sys-accent/15 -z-10"
              transition={{ type: "spring", stiffness: 450, damping: 35 }}
            />
          )}
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={activeTab === "settings" ? "2.2" : "1.75"}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          <span className="text-xs leading-tight tracking-tight">Налаштування</span>
        </Link>
      </div>
    </nav>
  );
}
