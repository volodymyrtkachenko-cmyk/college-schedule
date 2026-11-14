"use client";

import { useEffect, useRef, useState } from "react";
import { TransitionLink } from "@/components/navigation/NavigationTransitionProvider";
import { usePathname } from "next/navigation";
import { buildCurrentScheduleHref, isModifiedMouseClick } from "../lib/navigation";
import { useMobileNav, MobileTab, isScheduleRoutePath } from "../lib/useMobileNav";

export type { MobileTab };

function vibrateTap(ms = 8) {
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
    setPendingTab,
    setHomeTab,
    overdueCount,
    hideTasksTab,
    scheduleMode,
    urlSearch,
    syncScheduleLocation,
  } = useMobileNav();

  const navRef = useRef<HTMLElement | null>(null);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [isWrapped, setIsWrapped] = useState(false);

  const preloadTasksChunk = () => {
    void import("./MobileTasksView");
  };

  const isHiddenRoute = pathname?.startsWith("/admin") || pathname?.startsWith("/login");
  const isOnSchedulePage = isScheduleRoutePath(pathname);
  const isSettings = pathname?.startsWith("/settings");

  useEffect(() => {
    if (isHiddenRoute) return;
    const navEl = navRef.current;
    const rowEl = rowRef.current;
    if (!navEl || !rowEl) return;

    const updateLayoutMetrics = () => {
      const rect = navEl.getBoundingClientRect();
      if (rect.height > 0) {
        document.documentElement.style.setProperty("--bottom-nav-height", `${Math.ceil(rect.height)}px`);
      }
      const links = Array.from(rowEl.querySelectorAll<HTMLElement>("a[data-bottom-nav-item]"));
      if (links.length <= 1) {
        setIsWrapped(false);
        return;
      }
      const firstTop = links[0].offsetTop;
      const baseWidth = links[0].offsetWidth;
      const wrapped = links.some(
        (el) => Math.abs(el.offsetTop - firstTop) > 2 || Math.abs(el.offsetWidth - baseWidth) > 4
      );
      setIsWrapped(wrapped);
    };

    updateLayoutMetrics();
    const observer = new ResizeObserver(updateLayoutMetrics);
    observer.observe(navEl);
    observer.observe(rowEl);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty("--bottom-nav-height");
    };
  }, [hideTasksTab, isHiddenRoute]);

  if (isHiddenRoute) {
    return null;
  }

  const handleScheduleClick = (e: React.MouseEvent) => {
    if (isModifiedMouseClick(e)) return;
    vibrateTap(8);
    if (isOnSchedulePage) {
      e.preventDefault();
      syncScheduleLocation(
        buildCurrentScheduleHref(window.location.pathname, window.location.search, "schedule")
      );
      return;
    }
    setHomeTab("schedule");
    setPendingTab("schedule");
  };

  const handleTasksClick = (e: React.MouseEvent) => {
    if (isModifiedMouseClick(e)) return;
    vibrateTap(8);
    preloadTasksChunk();
    if (isOnSchedulePage) {
      e.preventDefault();
      syncScheduleLocation(
        buildCurrentScheduleHref(window.location.pathname, window.location.search, "tasks")
      );
      return;
    }
    setHomeTab("tasks");
    setPendingTab("tasks");
  };

  const handleSettingsClick = (e: React.MouseEvent) => {
    if (isModifiedMouseClick(e)) return;
    vibrateTap(8);
    if (!isSettings) {
      setPendingTab("settings");
    }
    if (isSettings) {
      e.preventDefault();
      if (typeof window !== "undefined") {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    }
  };

  const scheduleHref = isOnSchedulePage
    ? buildCurrentScheduleHref(pathname, urlSearch, "schedule")
    : "/";
  const tasksHref = isOnSchedulePage
    ? buildCurrentScheduleHref(pathname, urlSearch, "tasks")
    : "/?tab=tasks";
  const settingsHref = scheduleMode === "teacher" ? "/settings?mode=teacher" : "/settings";

  const totalTabs = hideTasksTab ? 2 : 3;
  const tabIndex = activeTab === "schedule" ? 0 : activeTab === "tasks" ? 1 : hideTasksTab ? 1 : 2;

  return (
    <nav
      ref={navRef}
      aria-label="Нижня навігація"
      className="vt-bottom-nav fixed inset-x-0 bottom-0 z-40 border-t border-sys-border bg-sys-card pb-[env(safe-area-inset-bottom)] lg:hidden isolate select-none"
    >
      <div
        ref={rowRef}
        className="relative mx-auto flex min-h-14 max-w-lg flex-wrap items-stretch justify-center gap-x-1 gap-y-1 px-2 py-1"
      >
        {/* Hardware-accelerated GPU sliding pill (лише коли елементи в 1 рівний ряд) */}
        {activeTab !== null && !isWrapped && (
          <div
            aria-hidden="true"
            className="absolute top-1 bottom-1 pointer-events-none transition-transform duration-base [transition-timing-function:var(--ease-spring-snappy)] transform-gpu z-0"
            style={{
              left: "8px",
              width: `calc((100% - 16px) / ${totalTabs})`,
              transform: `translate3d(calc(${tabIndex} * 100%), 0, 0)`,
            }}
          >
            <div className="mx-1 h-full rounded-xl bg-sys-accent/15 shadow-xs" />
          </div>
        )}

        {/* Tab 1: Schedule */}
        <TransitionLink
          href={scheduleHref}
          prefetch={true}
          onClick={handleScheduleClick}
          data-bottom-nav-item="schedule"
          aria-current={activeTab === "schedule" ? "page" : undefined}
          className={`relative z-10 flex min-h-[44px] min-w-fit max-w-full flex-1 basis-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1.5 py-1 text-center transition-colors duration-150 active:scale-95 ${
            activeTab === "schedule"
              ? isWrapped
                ? "bg-sys-accent/15 font-bold text-sys-accent shadow-xs"
                : "font-bold text-sys-accent"
              : "text-sys-text-secondary hover:text-sys-text-primary font-medium"
          }`}
        >
          <svg
            aria-hidden="true"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={activeTab === "schedule" ? "2.2" : "1.75"}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0"
          >
            <rect width="18" height="18" x="3" y="4" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          <span className="text-xs leading-tight tracking-tight break-words">Розклад</span>
        </TransitionLink>

        {/* Tab 2: Tasks (ДЗ) */}
        {!hideTasksTab && (
          <TransitionLink
            href={tasksHref}
            prefetch={true}
            onMouseEnter={preloadTasksChunk}
            onTouchStart={preloadTasksChunk}
            onFocus={preloadTasksChunk}
            onClick={handleTasksClick}
            data-bottom-nav-item="tasks"
            aria-label={overdueCount > 0 ? `Завдання, прострочено ${overdueCount}` : undefined}
            aria-current={activeTab === "tasks" ? "page" : undefined}
            className={`relative z-10 flex min-h-[44px] min-w-fit max-w-full flex-1 basis-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1.5 py-1 text-center transition-colors duration-150 active:scale-95 ${
              activeTab === "tasks"
                ? isWrapped
                  ? "bg-sys-accent/15 font-bold text-sys-accent shadow-xs"
                  : "font-bold text-sys-accent"
                : "text-sys-text-secondary hover:text-sys-text-primary font-medium"
            }`}
          >
            <div className="relative shrink-0">
              <svg
                aria-hidden="true"
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
                  aria-hidden="true"
                  className="absolute -top-1.5 -right-2.5 flex min-h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-700 px-1 text-xs font-black text-white shadow-xs"
                >
                  {overdueCount}
                </span>
              )}
            </div>
            <span className="text-xs leading-tight tracking-tight break-words">Завдання</span>
          </TransitionLink>
        )}

        {/* Tab 3: Settings */}
        <TransitionLink
          href={settingsHref}
          prefetch={true}
          onClick={handleSettingsClick}
          data-bottom-nav-item="settings"
          aria-current={activeTab === "settings" ? "page" : undefined}
          className={`relative z-10 flex min-h-[44px] min-w-fit max-w-full flex-1 basis-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1.5 py-1 text-center transition-colors duration-150 active:scale-95 ${
            activeTab === "settings"
              ? isWrapped
                ? "bg-sys-accent/15 font-bold text-sys-accent shadow-xs"
                : "font-bold text-sys-accent"
              : "text-sys-text-secondary hover:text-sys-text-primary font-medium"
          }`}
        >
          <svg
            aria-hidden="true"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={activeTab === "settings" ? "2.2" : "1.75"}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          <span className="text-xs leading-tight tracking-tight break-words">Налаштування</span>
        </TransitionLink>
      </div>
    </nav>
  );
}
