"use client";

import React from "react";
import { getMeetingBtnStyle, MeetingInfo } from "../../lib/lesson-card";
import { LockIcon } from "../ui/Icons";

export function MeetingPlatformIcon({
  platform,
  size = 12,
  className = "shrink-0",
}: {
  platform?: string | null;
  size?: number;
  className?: string;
}) {
  if (platform === "zoom") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="currentColor"
        className={className}
        aria-hidden="true"
      >
        <path d="M15 8c0-.55-.45-1-1-1H3c-.55 0-1 .45-1 1v8c0 .55.45 1 1 1h11c.55 0 1-.45 1-1v-3.24l4.39 3.59c.35.29.88 0 .88-.45V7.1c0-.45-.53-.74-.88-.45L15 10.24V8z" />
      </svg>
    );
  }
  if (platform === "meet") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="currentColor"
        className={className}
        aria-hidden="true"
      >
        <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" />
      </svg>
    );
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <polygon points="23 7 16 12 23 17 23 7" />
      <rect x="1" y="5" width="15" height="14" rx="2" />
    </svg>
  );
}

export function LockedMeetingBadge({
  platform,
  size = "normal",
  onClick,
}: {
  platform?: "meet" | "zoom" | "teams" | "link";
  size?: "normal" | "compact" | "tiny";
  onClick?: (e: React.MouseEvent) => void;
}) {
  const sizeClasses =
    size === "tiny"
      ? "h-6 min-h-[24px] px-2 text-[11px] gap-1 rounded-md"
      : size === "compact"
      ? "h-7 px-2.5 text-xs gap-1.5 rounded-lg"
      : "min-h-[36px] h-9 px-3 text-xs gap-1.5 rounded-xl";

  const label = platform === "zoom" ? "Zoom" : platform === "meet" ? "Meet" : "Онлайн";

  return (
    <button
      type="button"
      onClick={onClick}
      title="Онлайн-заняття. Прив'яжіть студентський Classroom цієї групи для доступу до дзвінка"
      aria-label="Онлайн-заняття. Прив'яжіть студентський Classroom цієї групи для доступу до дзвінка"
      className={`inline-flex shrink-0 items-center border border-amber-500/40 dark:border-amber-500/30 bg-amber-500/15 dark:bg-amber-500/10 text-amber-800 dark:text-amber-200 font-bold whitespace-nowrap hover:bg-amber-500/25 dark:hover:bg-amber-500/20 active:scale-95 transition-colors duration-fast ease-smooth shadow-xs cursor-pointer ${sizeClasses}`}
    >
      <LockIcon className="w-3 h-3 shrink-0" />
      <span>{label}</span>
    </button>
  );
}

export type MeetingBadgeVariant =
  | "desktop-day"
  | "mobile-header"
  | "mobile-row"
  | "dual-compact"
  | "dual-week"
  | "week";

const MEETING_BADGE_CONFIG: Record<
  MeetingBadgeVariant,
  {
    styleSize: "normal" | "compact" | "tiny";
    lockedSize: "normal" | "compact" | "tiny";
    iconSize: number;
    anchorCls: string;
    arrowType: "svg-10" | "svg-9" | "char" | "char-week";
  }
> = {
  "desktop-day": {
    styleSize: "normal",
    lockedSize: "normal",
    iconSize: 14,
    anchorCls: "inline-flex h-8 px-3 items-center gap-1.5 rounded-lg font-bold text-xs active:scale-95 transition-colors duration-fast ease-smooth whitespace-nowrap border",
    arrowType: "char",
  },
  "mobile-header": {
    styleSize: "normal",
    lockedSize: "normal",
    iconSize: 14,
    anchorCls: "inline-flex h-8 min-h-[32px] px-2.5 items-center gap-1.5 rounded-lg font-bold text-xs shadow-xs active:scale-95 transition-colors duration-fast ease-smooth whitespace-nowrap border",
    arrowType: "char",
  },
  "mobile-row": {
    styleSize: "normal",
    lockedSize: "normal",
    iconSize: 15,
    anchorCls: "inline-flex min-h-[40px] h-10 px-3.5 items-center gap-2 rounded-xl font-bold text-xs shadow-xs active:scale-95 transition-colors duration-fast ease-smooth whitespace-nowrap border",
    arrowType: "char",
  },
  "dual-compact": {
    styleSize: "compact",
    lockedSize: "compact",
    iconSize: 13,
    anchorCls: "inline-flex shrink-0 h-7 px-2.5 items-center gap-1.5 rounded-lg border text-xs font-semibold whitespace-nowrap active:scale-95 transition-colors duration-fast ease-smooth",
    arrowType: "svg-10",
  },
  "dual-week": {
    styleSize: "tiny",
    lockedSize: "tiny",
    iconSize: 11,
    anchorCls: "inline-flex shrink-0 h-6 px-2 items-center gap-1.5 rounded-md border text-[11px] font-semibold whitespace-nowrap active:scale-95 transition-colors duration-fast ease-smooth",
    arrowType: "svg-9",
  },
  week: {
    styleSize: "tiny",
    lockedSize: "tiny",
    iconSize: 12,
    anchorCls: "inline-flex h-6 min-h-[24px] items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-semibold active:scale-95 transition-colors duration-fast ease-smooth",
    arrowType: "char-week",
  },
};

export function MeetingActionBadge({
  meeting,
  variant,
  hasGroupAccess,
  isLiveOrSoon,
  onLockedClick,
  onLinkClick,
}: {
  meeting: MeetingInfo;
  variant: MeetingBadgeVariant;
  hasGroupAccess: boolean;
  isLiveOrSoon: boolean;
  onLockedClick: (e?: React.MouseEvent) => void;
  onLinkClick: (e: React.MouseEvent<HTMLAnchorElement>, m: MeetingInfo) => void;
}) {
  const cfg = MEETING_BADGE_CONFIG[variant];
  const isLocked = !hasGroupAccess || (variant === "dual-week" || variant === "week" ? meeting.isProtected : false);

  if (isLocked) {
    return (
      <LockedMeetingBadge
        platform={meeting.platform}
        size={cfg.lockedSize}
        onClick={onLockedClick}
      />
    );
  }

  const label = meeting.platform === "zoom" ? "Zoom" : meeting.platform === "meet" ? "Meet" : "Онлайн";

  return (
    <a
      href={meeting.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => onLinkClick(e, meeting)}
      className={`${cfg.anchorCls} ${getMeetingBtnStyle(meeting.platform, isLiveOrSoon, cfg.styleSize)}`}
    >
      <MeetingPlatformIcon platform={meeting.platform} size={cfg.iconSize} />
      <span>{label}</span>
      {cfg.arrowType === "svg-10" || cfg.arrowType === "svg-9" ? (
        <svg
          width={cfg.arrowType === "svg-9" ? 9 : 10}
          height={cfg.arrowType === "svg-9" ? 9 : 10}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0 opacity-70"
        >
          <path d="M7 17 17 7" />
          <path d="M7 7h10v10" />
        </svg>
      ) : cfg.arrowType === "char-week" ? (
        <span className="text-[11px] font-bold opacity-75">↗</span>
      ) : (
        <span className="text-xs opacity-75">↗</span>
      )}
    </a>
  );
}
