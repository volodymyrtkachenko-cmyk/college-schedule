"use client";

import Link from "next/link";

function vibrateTap(ms = 10) {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    try {
      navigator.vibrate(ms);
    } catch {}
  }
}

export type MobileTab = "schedule" | "tasks";

export function BottomNav({
  activeTab,
  onTabChange,
  overdueCount = 0,
  hideTasksTab = false,
}: {
  activeTab: MobileTab;
  onTabChange: (tab: MobileTab) => void;
  overdueCount?: number;
  hideTasksTab?: boolean;
}) {
  return (
    <nav
      aria-label="Нижня навігація"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-sys-border bg-sys-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
    >
      <div className="mx-auto flex h-14 max-w-lg items-stretch justify-around px-2">
        {/* Tab 1: Schedule */}
        <button
          type="button"
          onClick={() => {
            vibrateTap(10);
            onTabChange("schedule");
          }}
          aria-label="Розклад"
          aria-pressed={activeTab === "schedule"}
          className={`flex flex-1 min-h-[48px] flex-col items-center justify-center gap-0.5 rounded-xl transition-all duration-150 active:scale-95 ${
            activeTab === "schedule"
              ? "font-bold text-sys-accent"
              : "text-sys-text-secondary hover:text-sys-text-primary font-medium"
          }`}
        >
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
        </button>

        {/* Tab 2: Tasks (ДЗ) */}
        {!hideTasksTab && (
          <button
            type="button"
            onClick={() => {
              vibrateTap(10);
              onTabChange("tasks");
            }}
            aria-label={`Завдання${overdueCount > 0 ? `, прострочено ${overdueCount}` : ""}`}
            aria-pressed={activeTab === "tasks"}
            className={`relative flex flex-1 min-h-[48px] flex-col items-center justify-center gap-0.5 rounded-xl transition-all duration-150 active:scale-95 ${
              activeTab === "tasks"
                ? "font-bold text-sys-accent"
                : "text-sys-text-secondary hover:text-sys-text-primary font-medium"
            }`}
          >
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
          </button>
        )}

        {/* Tab 3: Settings */}
        <Link
          href="/settings"
          onClick={() => vibrateTap(10)}
          aria-label="Налаштування"
          className="flex flex-1 min-h-[48px] flex-col items-center justify-center gap-0.5 rounded-xl transition-all duration-150 active:scale-95 text-sys-text-secondary hover:text-sys-text-primary font-medium"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
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
