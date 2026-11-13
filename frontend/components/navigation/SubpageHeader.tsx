"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { TransitionLink } from "@/components/navigation/NavigationTransitionProvider";
import { PublicSectionNav } from "@/components/navigation/PublicSectionNav";
import { PUBLIC_NAV_ITEMS, isPublicSectionActive } from "@/lib/navigation";
import { useMobileNav } from "@/lib/useMobileNav";

interface SubpageHeaderProps {
  title: string;
  subtitle?: string;
  backHref?: string;
  backLabel?: string;
  onBackClick?: () => void;
  rightSlot?: React.ReactNode;
  maxWidthClass?: string;
  showMobileSectionStrip?: boolean;
}

export function SubpageHeader({
  title,
  subtitle,
  backHref = "/",
  backLabel = "Розклад",
  onBackClick,
  rightSlot,
  maxWidthClass = "max-w-5xl",
  showMobileSectionStrip = true,
}: SubpageHeaderProps) {
  const pathname = usePathname() || "/";
  const { setHomeTab } = useMobileNav();
  const isSettingsActive = isPublicSectionActive(pathname, "settings");

  const handleBack = () => {
    setHomeTab("schedule");
    onBackClick?.();
  };

  return (
    <header className="vt-desktop-header sticky top-0 z-30 border-b border-sys-border bg-sys-card/95 lg:bg-sys-card/85 lg:backdrop-blur-md">
      <div className={`mx-auto ${maxWidthClass} px-3 sm:px-6`}>
        <div className="flex h-14 sm:h-16 items-center justify-between gap-2 sm:gap-3">
          <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
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

            <div className="min-w-0">
              <h1 className="truncate text-base sm:text-lg font-bold tracking-tight text-sys-text-primary leading-tight">
                {title}
              </h1>
              {subtitle && (
                <p className="hidden sm:block truncate text-xs text-sys-text-secondary">
                  {subtitle}
                </p>
              )}
            </div>
          </div>

          <div className="hidden lg:flex items-center">
            <PublicSectionNav />
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {rightSlot}
            <TransitionLink
              href="/settings"
              aria-label="Налаштування"
              aria-current={isSettingsActive ? "page" : undefined}
              className={`spring-press hidden lg:inline-flex h-9 w-9 items-center justify-center rounded-xl border transition-[color,border-color,background-color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sys-accent ${
                isSettingsActive
                  ? "border-sys-accent/45 bg-sys-accent/15 text-sys-accent"
                  : "border-sys-border bg-sys-bg text-sys-text-secondary hover:border-sys-accent/40 hover:text-sys-text-primary"
              }`}
              title="Налаштування"
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
                className="h-4 w-4"
                aria-hidden="true"
              >
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </TransitionLink>
          </div>
        </div>

        {showMobileSectionStrip && (
          <nav
            aria-label="Швидкий перехід розділами"
            className="flex lg:hidden items-center gap-1.5 overflow-x-auto pb-2.5 pt-0.5 no-scrollbar"
          >
            {PUBLIC_NAV_ITEMS.filter((item) => item.id !== "schedule").map((item) => {
              const active = isPublicSectionActive(pathname, item.id);
              return (
                <TransitionLink
                  key={item.id}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`spring-press shrink-0 rounded-xl border px-3 py-1.5 text-xs font-medium transition-[color,border-color,background-color] duration-150 ${
                    active
                      ? "border-sys-accent/45 bg-sys-accent/15 text-sys-text-primary font-semibold"
                      : "border-sys-border bg-sys-bg text-sys-text-secondary hover:text-sys-text-primary"
                  }`}
                >
                  {item.label}
                </TransitionLink>
              );
            })}
          </nav>
        )}
      </div>
    </header>
  );
}
