"use client";

import React from "react";
import { Lesson } from "../../lib/api";
import { MeetingInfo } from "../../lib/lesson-card";
import { QuickJumpTarget } from "../../lib/quickJump";
import { MeetingActionBadge } from "./LessonCardMeetingControls";

export type SubgroupBlockVariant = "desktop-day" | "mobile-day" | "week";

interface SecondaryItem {
  name: string;
  displayName: string;
  target: QuickJumpTarget;
}

function PersonIcon({ size = 13 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-sys-text-muted shrink-0"
      aria-hidden="true"
    >
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

export function SubgroupTeacherBlock({
  variant,
  lesson,
  isTeacherView,
  isDualTeachers,
  isSingleSubgroupShown,
  singleSubgroupIdx,
  effectiveSubgroup,
  selectedSubgroup,
  secondaryItems,
  teacherMeetings,
  row3Meetings,
  rawRooms,
  hasGroupAccess,
  isLive,
  isMeetingLiveOrSoon,
  onSubgroupToggle,
  onQuickJump,
  onLockedClick,
  onMeetingLinkClick,
}: {
  variant: SubgroupBlockVariant;
  lesson: Lesson;
  isTeacherView: boolean;
  isDualTeachers: boolean;
  isSingleSubgroupShown: boolean;
  singleSubgroupIdx: number | null;
  effectiveSubgroup: number | null;
  selectedSubgroup: 1 | 2 | "all" | null;
  secondaryItems: SecondaryItem[];
  teacherMeetings: (MeetingInfo | null)[];
  row3Meetings: MeetingInfo[];
  rawRooms: string[];
  hasGroupAccess: boolean;
  isLive: boolean;
  isMeetingLiveOrSoon: boolean;
  onSubgroupToggle: (target: 1 | 2 | "all") => void;
  onQuickJump?: (target: QuickJumpTarget) => void;
  onLockedClick: (e?: React.MouseEvent) => void;
  onMeetingLinkClick: (e: React.MouseEvent<HTMLAnchorElement>, m: MeetingInfo) => void;
}) {
  const isWeek = variant === "week";
  const iconSize = isWeek ? 12 : 13;

  if (isDualTeachers) {
    if (isSingleSubgroupShown && singleSubgroupIdx !== null) {
      const item = secondaryItems[singleSubgroupIdx];
      return (
        <div
          className={
            isWeek
              ? "flex items-center gap-1.5 min-w-0 text-xs text-sys-text-secondary mt-0.5"
              : "flex items-center gap-1.5 sm:gap-2 min-w-0"
          }
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onSubgroupToggle((singleSubgroupIdx + 1) as 1 | 2);
            }}
            title={`Ваша підгрупа ${singleSubgroupIdx + 1} (натисніть, щоб показати обидві)`}
            aria-label={`Ваша підгрупа ${singleSubgroupIdx + 1} (натисніть, щоб показати обидві)`}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border border-sys-accent/35 bg-sys-accent/15 font-semibold text-sys-accent whitespace-nowrap active:scale-95 transition-colors duration-fast ease-smooth shadow-2xs hover:bg-sys-accent/25 cursor-pointer ${
              isWeek ? "h-5.5 px-2 text-[11px]" : "h-6 px-2 text-xs"
            }`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-sys-accent shrink-0" aria-hidden="true" />
            <span>{singleSubgroupIdx + 1} підгр.</span>
          </button>
          <PersonIcon size={iconSize} />
          {onQuickJump ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onQuickJump(item.target);
              }}
              className={`text-left font-medium text-sys-text-secondary hover:text-sys-accent hover:underline focus:outline-none ${
                variant === "desktop-day"
                  ? "text-xs sm:text-sm break-words"
                  : variant === "mobile-day"
                  ? "text-xs sm:text-sm truncate min-w-0"
                  : "text-xs break-words"
              }`}
              title={item.displayName}
            >
              {item.displayName}
            </button>
          ) : (
            <span
              className={`font-medium text-sys-text-secondary ${
                variant === "desktop-day"
                  ? "text-xs sm:text-sm break-words"
                  : variant === "mobile-day"
                  ? "text-xs sm:text-sm truncate min-w-0"
                  : "text-xs break-words"
              }`}
              title={item.displayName}
            >
              {item.displayName}
            </span>
          )}
        </div>
      );
    }

    return (
      <div
        className={
          variant === "desktop-day"
            ? "flex flex-col gap-2 w-full max-w-[520px]"
            : variant === "mobile-day"
            ? "flex flex-col gap-2 w-full"
            : "flex flex-col gap-2 text-xs text-sys-text-secondary w-full mt-1"
        }
      >
        {secondaryItems.map((item, idx) => {
          const subNum = (idx === 0 ? 1 : 2) as 1 | 2;
          if (effectiveSubgroup !== null && effectiveSubgroup !== subNum) {
            return null;
          }
          const isFaded =
            selectedSubgroup !== null && selectedSubgroup !== "all" && selectedSubgroup !== subNum;
          const ownMeeting = teacherMeetings[idx];
          const ownRoom =
            (idx === 0 ? lesson.teacher_room : lesson.second_teacher_room) ||
            (idx === 0 ? rawRooms[0] || null : rawRooms[1] || null);
          const formattedOwnRoom = ownRoom ? `ауд. ${ownRoom.replace(/^ауд\.?\s*/i, "")}` : "ауд. —";

          if (isWeek) {
            return (
              <div
                key={idx}
                className={`flex flex-col gap-1 w-full transition-opacity ${
                  isFaded ? "opacity-50 hover:opacity-80" : "opacity-100"
                }`}
              >
                <div className="flex items-center gap-1.5 min-w-0 w-full">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      onSubgroupToggle(subNum);
                    }}
                    title={effectiveSubgroup === subNum ? "Ваша підгрупа (натисніть для скидання)" : `Обрати ${subNum} підгрупу`}
                    aria-label={effectiveSubgroup === subNum ? "Ваша підгрупа (натисніть для скидання)" : `Обрати ${subNum} підгрупу`}
                    className={`inline-flex shrink-0 items-center gap-1.5 h-5.5 px-2 rounded-md border text-[11px] font-semibold whitespace-nowrap active:scale-95 transition-colors duration-fast ease-smooth shadow-2xs ${
                      effectiveSubgroup === subNum
                        ? "border-sys-accent/35 bg-sys-accent/15 text-sys-accent hover:bg-sys-accent/25"
                        : "bg-sys-bg/80 border-sys-border text-sys-text-secondary hover:text-sys-text-primary hover:border-sys-accent/40 hover:bg-sys-accent/5"
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                        effectiveSubgroup === subNum ? "bg-sys-accent" : "bg-sys-text-muted/60"
                      }`}
                      aria-hidden="true"
                    />
                    <span>{subNum} підгр.</span>
                  </button>
                  <PersonIcon size={12} />
                  {onQuickJump ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onQuickJump(item.target);
                      }}
                      className="text-left text-xs font-medium text-sys-text-secondary hover:text-sys-accent hover:underline focus:outline-none break-words leading-tight"
                      title={item.displayName}
                    >
                      {item.displayName}
                    </button>
                  ) : (
                    <span
                      className="text-xs font-medium text-sys-text-secondary break-words leading-tight"
                      title={item.displayName}
                    >
                      {item.displayName}
                    </span>
                  )}
                </div>
                {ownMeeting ? (
                  <div className="flex items-center justify-end w-full pl-5">
                    <MeetingActionBadge
                      meeting={ownMeeting}
                      variant="dual-week"
                      hasGroupAccess={hasGroupAccess}
                      isLiveOrSoon={isLive && isMeetingLiveOrSoon}
                      onLockedClick={onLockedClick}
                      onLinkClick={onMeetingLinkClick}
                    />
                  </div>
                ) : ownRoom ? (
                  <div className="flex items-center justify-end w-full pl-5">
                    <span className="shrink-0 rounded-md border border-sys-border bg-sys-bg px-1.5 py-0.5 text-[11px] font-semibold leading-none text-sys-text-secondary whitespace-nowrap">
                      {formattedOwnRoom}
                    </span>
                  </div>
                ) : null}
              </div>
            );
          }

          return (
            <div
              key={idx}
              className={`flex items-center justify-between gap-x-2 w-full transition-opacity ${
                isFaded ? "opacity-50 hover:opacity-80" : "opacity-100"
              }`}
            >
              <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-1 mr-1">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    onSubgroupToggle(subNum);
                  }}
                  title={effectiveSubgroup === subNum ? "Ваша підгрупа (натисніть для скидання)" : `Обрати ${subNum} підгрупу`}
                  aria-label={effectiveSubgroup === subNum ? "Ваша підгрупа (натисніть для скидання)" : `Обрати ${subNum} підгрупу`}
                  className={`inline-flex shrink-0 items-center gap-1.5 h-6 px-2 rounded-md border text-xs font-semibold whitespace-nowrap active:scale-95 transition-colors duration-fast ease-smooth shadow-2xs ${
                    effectiveSubgroup === subNum
                      ? "border-sys-accent/35 bg-sys-accent/15 text-sys-accent hover:bg-sys-accent/25"
                      : "bg-sys-bg/80 border-sys-border text-sys-text-secondary hover:text-sys-text-primary hover:border-sys-accent/40 hover:bg-sys-accent/5"
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                      effectiveSubgroup === subNum ? "bg-sys-accent" : "bg-sys-text-muted/60"
                    }`}
                    aria-hidden="true"
                  />
                  <span>{subNum} підгр.</span>
                </button>
                <PersonIcon size={13} />
                {onQuickJump ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onQuickJump(item.target);
                    }}
                    className="text-left text-xs sm:text-sm font-medium text-sys-text-secondary hover:text-sys-accent hover:underline focus:outline-none truncate min-w-0"
                    title={item.displayName}
                  >
                    {item.displayName}
                  </button>
                ) : (
                  <span
                    className="text-xs sm:text-sm font-medium text-sys-text-secondary truncate min-w-0"
                    title={item.displayName}
                  >
                    {item.displayName}
                  </span>
                )}
              </div>
              {ownMeeting ? (
                <MeetingActionBadge
                  meeting={ownMeeting}
                  variant="dual-compact"
                  hasGroupAccess={hasGroupAccess}
                  isLiveOrSoon={isLive && isMeetingLiveOrSoon}
                  onLockedClick={onLockedClick}
                  onLinkClick={onMeetingLinkClick}
                />
              ) : (
                <span className="shrink-0 rounded-md border border-sys-border bg-sys-bg px-2 py-1 text-xs font-semibold leading-none text-sys-text-secondary whitespace-nowrap">
                  {formattedOwnRoom}
                </span>
              )}
            </div>
          );
        })}

        {variant === "mobile-day" && row3Meetings[0] && (
          <div className="flex justify-end w-full pt-0.5">
            <MeetingActionBadge
              meeting={row3Meetings[0]}
              variant="dual-compact"
              hasGroupAccess={hasGroupAccess}
              isLiveOrSoon={isLive && isMeetingLiveOrSoon}
              onLockedClick={onLockedClick}
              onLinkClick={onMeetingLinkClick}
            />
          </div>
        )}
      </div>
    );
  }

  if (secondaryItems.length === 0) return null;

  if (variant === "mobile-day") {
    return (
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-sys-text-secondary">
        <PersonIcon size={13} />
        {isTeacherView && (
          <span className="text-sys-text-muted">
            {secondaryItems.length > 1 ? "Групи: " : "Група: "}
          </span>
        )}
        {secondaryItems.map((item, idx) => (
          <span key={`${item.name}-${idx}`} className="inline-flex items-center">
            {idx > 0 && <span className="text-sys-text-muted mr-1"> / </span>}
            {onQuickJump ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onQuickJump(item.target);
                }}
                className="py-0.5 font-medium text-sys-text-secondary hover:text-sys-accent active:text-sys-accent active:scale-95 transition-colors duration-fast ease-smooth focus:outline-none underline-offset-2 hover:underline"
                title={item.displayName}
              >
                {item.displayName}
              </button>
            ) : (
              <span>{item.displayName}</span>
            )}
          </span>
        ))}
      </div>
    );
  }

  if (isWeek) {
    return (
      <div className="text-xs text-sys-text-secondary break-words">
        {isTeacherView && (
          <span className="text-sys-text-muted">
            {secondaryItems.length > 1 ? "Групи: " : "Група: "}
          </span>
        )}
        {secondaryItems.map((item, idx) => (
          <span key={`${item.name}-${idx}`}>
            {idx > 0 && <span className="text-sys-text-muted"> / </span>}
            {onQuickJump ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onQuickJump(item.target);
                }}
                className="font-medium text-sys-text-secondary no-underline underline-offset-2 hover:text-sys-accent hover:underline focus:outline-none"
              >
                {item.displayName}
              </button>
            ) : (
              <span>{item.displayName}</span>
            )}
          </span>
        ))}
      </div>
    );
  }

  return (
    <>
      <PersonIcon size={13} />
      {secondaryItems.map((item, idx) => (
        <span key={idx}>
          {idx > 0 && <span className="text-sys-text-muted"> / </span>}
          {onQuickJump ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onQuickJump(item.target);
              }}
              className="hover:text-sys-accent hover:underline focus:outline-none"
            >
              {item.displayName}
            </button>
          ) : (
            <span>{item.displayName}</span>
          )}
        </span>
      ))}
    </>
  );
}
