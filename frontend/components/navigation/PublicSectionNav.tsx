"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { m } from "framer-motion";
import { TransitionLink } from "@/components/navigation/NavigationTransitionProvider";
import {
  PUBLIC_NAV_ITEMS,
  isPublicSectionActive,
  type PublicSectionId,
} from "@/lib/navigation";
import { useMobileNav } from "@/lib/useMobileNav";

function SectionIcon({
  id,
  className = "",
}: {
  id: Exclude<PublicSectionId, "settings">;
  className?: string;
}) {
  if (id === "schedule") {
    return (
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        aria-hidden="true"
      >
        <rect width="18" height="18" x="3" y="4" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    );
  }
  if (id === "bells") {
    return (
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        aria-hidden="true"
      >
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
    );
  }
  if (id === "educational-process") {
    return (
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        aria-hidden="true"
      >
        <path d="M8 2v4" />
        <path d="M16 2v4" />
        <rect width="18" height="18" x="3" y="4" rx="2" />
        <path d="M3 10h18" />
        <path d="M8 14h8" />
        <path d="M8 18h5" />
      </svg>
    );
  }
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M3 3v18h18" />
      <path d="M18 17V9" />
      <path d="M13 17V5" />
      <path d="M8 17v-3" />
    </svg>
  );
}

interface PublicSectionNavProps {
  compact?: boolean;
  layoutGroupId?: string;
  className?: string;
}

export function PublicSectionNav({
  compact = false,
  layoutGroupId = "public-section-pill",
  className = "",
}: PublicSectionNavProps) {
  const pathname = usePathname() || "/";
  const { setHomeTab } = useMobileNav();

  return (
    <nav
      aria-label="Розділи сайту"
      className={`inline-flex items-center gap-0.5 rounded-2xl border border-sys-border bg-sys-bg/85 p-1 shadow-xs ${className}`}
    >
      {PUBLIC_NAV_ITEMS.map((item) => {
        const active = isPublicSectionActive(pathname, item.id);

        return (
          <TransitionLink
            key={item.id}
            href={item.href}
            aria-current={active ? "page" : undefined}
            aria-label={item.label}
            title={item.label}
            onClick={() => {
              if (item.id === "schedule") {
                setHomeTab("schedule");
              }
            }}
            className={`spring-press relative inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-[13px] whitespace-nowrap transition-[color,background-color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sys-accent ${
              active
                ? "text-sys-text-primary font-semibold"
                : "text-sys-text-secondary hover:text-sys-text-primary font-medium"
            }`}
          >
            {active && (
              <m.span
                layoutId={layoutGroupId}
                transition={{ type: "spring", stiffness: 520, damping: 38, mass: 0.7 }}
                className="pointer-events-none absolute inset-0 rounded-xl border border-sys-border bg-sys-card shadow-xs"
                aria-hidden="true"
              />
            )}
            <SectionIcon
              id={item.id as Exclude<PublicSectionId, "settings">}
              className={`relative z-10 h-3.5 w-3.5 shrink-0 ${
                active ? "text-sys-accent" : ""
              }`}
            />
            {compact ? (
              <>
                <span className="relative z-10 hidden 2xl:inline">
                  {item.label}
                </span>
                <span className="relative z-10 hidden xl:inline 2xl:hidden">
                  {item.shortLabel}
                </span>
              </>
            ) : (
              <>
                <span className="relative z-10 hidden xl:inline">
                  {item.label}
                </span>
                <span className="relative z-10 inline xl:hidden">
                  {item.shortLabel}
                </span>
              </>
            )}
          </TransitionLink>
        );
      })}
    </nav>
  );
}
