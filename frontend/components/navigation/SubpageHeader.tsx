"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { TransitionLink } from "@/components/navigation/NavigationTransitionProvider";
import { isPublicSectionActive } from "@/lib/navigation";
import { useMobileNav } from "@/lib/useMobileNav";

interface SubpageHeaderProps {
  title: string;
  subtitle?: string;
  backHref?: string;
  backLabel?: string;
  onBackClick?: () => void;
  rightSlot?: React.ReactNode;
  maxWidthClass?: string;
}

export function SubpageHeader({
  title,
  subtitle,
  backHref = "/",
  backLabel = "Розклад",
  onBackClick,
  rightSlot,
  maxWidthClass = "max-w-5xl",
}: SubpageHeaderProps) {
  const pathname = usePathname() || "/";
  const { setHomeTab, scheduleMode } = useMobileNav();
  const isSettingsActive = isPublicSectionActive(pathname, "settings");
  const settingsHref = scheduleMode === "teacher" ? "/settings?mode=teacher" : "/settings";

  const handleBack = () => {
    setHomeTab("schedule");
    onBackClick?.();
  };

  return (
    <header className="vt-desktop-header sticky top-0 z-40 min-h-[3.5rem] border-b border-sys-border bg-sys-card">
      <div className={`mx-auto min-h-[3.5rem] ${maxWidthClass} px-3 sm:px-6 flex items-center`}>
        <div className="flex w-full py-1.5 items-center justify-between gap-2 sm:gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-2.5 sm:gap-3">
            <TransitionLink
              href={backHref}
              onClick={handleBack}
              className="spring-press inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-sys-border bg-sys-bg px-2.5 sm:px-3 text-[13px] font-medium text-sys-text-secondary hover:border-sys-accent/45 hover:text-sys-text-primary transition-[color,border-color,background-color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sys-accent"
              aria-label={`Повернутися до: ${backLabel}`}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4 shrink-0"
                aria-hidden="true"
              >
                <path d="M19 12H5" />
                <path d="m12 19-7-7 7-7" />
              </svg>
              <span className="hidden sm:inline">{backLabel}</span>
            </TransitionLink>

            <div className="min-w-0 flex-1">
              <h1 className="text-sm sm:text-base font-bold tracking-tight text-sys-text-primary leading-tight break-words [text-wrap:balance]">
                {title}
              </h1>
              {subtitle && (
                <p className="hidden sm:block text-[11px] text-sys-text-secondary leading-snug break-words">
                  {subtitle}
                </p>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {rightSlot}
            {!isSettingsActive && (
              <TransitionLink
                href={settingsHref}
                aria-label="Налаштування"
                className="spring-press hidden lg:inline-flex h-9 items-center gap-1.5 rounded-xl border border-sys-border bg-sys-bg px-2.5 text-xs font-medium text-sys-text-secondary hover:border-sys-accent/40 hover:text-sys-text-primary transition-[color,border-color,background-color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sys-accent"
                title="Налаштування"
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-3.5 w-3.5 shrink-0"
                  aria-hidden="true"
                >
                  <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                <span>Налаштування</span>
              </TransitionLink>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
