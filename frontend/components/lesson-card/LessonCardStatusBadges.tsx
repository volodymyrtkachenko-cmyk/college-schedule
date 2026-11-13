"use client";

import React from "react";
import { Lesson } from "../../lib/api";
import { formatMovedTo } from "../../lib/lesson-card";
import {
  CheckCircleIcon,
  DoorOpenIcon,
  FileTextIcon,
  FlaskIcon,
  GraduationCapIcon,
  LaptopIcon,
  MessageSquareIcon,
} from "../ui/Icons";

export function getRoomBadgeMeta(room: string) {
  const lower = room.toLowerCase();
  if (lower.includes("спорт") || lower.includes("зал")) {
    return {
      icon: <DoorOpenIcon className="w-3 h-3 shrink-0" />,
      tone: "border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
    };
  }
  if (lower.includes("онлайн") || lower.includes("дистанц") || lower.includes("zoom") || lower.includes("meet")) {
    return {
      icon: <LaptopIcon className="w-3 h-3 shrink-0" />,
      tone: "border-sky-500/30 bg-sky-500/10 text-sky-800 dark:text-sky-300",
    };
  }
  if (lower.includes("лаб") || lower.includes("майст")) {
    return {
      icon: <FlaskIcon className="w-3 h-3 shrink-0" />,
      tone: "border-purple-500/30 bg-purple-500/10 text-purple-800 dark:text-purple-300",
    };
  }
  return {
    icon: <DoorOpenIcon className="w-3 h-3 shrink-0" />,
    tone: "border-sys-border bg-sys-tabActive text-sys-text-primary",
  };
}

export function getEventBadge(eventType?: string | null, eventTitle?: string | null) {
  if (!eventType) return null;
  switch (eventType) {
    case "exam":
      return {
        eventType,
        label: "Екзамен",
        title: eventTitle || "Екзамен",
        badgeClass: "border-rose-500/40 bg-rose-500/15 text-rose-700 dark:text-rose-300",
        cardClass: "border-rose-500/40 ring-1 ring-rose-500/40 bg-gradient-to-br from-rose-950/20 via-sys-card to-sys-card",
      };
    case "consultation":
      return {
        eventType,
        label: "Консультація",
        title: eventTitle || "Консультація",
        badgeClass: "border-amber-500/40 bg-amber-500/15 text-amber-800 dark:text-amber-300",
        cardClass: "border-amber-500/40 ring-1 ring-amber-500/40 bg-gradient-to-br from-amber-950/20 via-sys-card to-sys-card",
      };
    case "credit":
      return {
        eventType,
        label: "Залік",
        title: eventTitle || "Залік",
        badgeClass: "border-emerald-500/40 bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
        cardClass: "border-emerald-500/40 ring-1 ring-emerald-500/40 bg-gradient-to-br from-emerald-950/20 via-sys-card to-sys-card",
      };
    case "defense":
      return {
        eventType,
        label: "Захист",
        title: eventTitle || "Захист",
        badgeClass: "border-purple-500/40 bg-purple-500/15 text-purple-800 dark:text-purple-300",
        cardClass: "border-purple-500/40 ring-1 ring-purple-500/40 bg-gradient-to-br from-purple-950/20 via-sys-card to-sys-card",
      };
    default:
      return {
        eventType,
        label: "Подія",
        title: eventTitle || "Подія",
        badgeClass: "border-sky-500/40 bg-sky-500/15 text-sky-800 dark:text-sky-300",
        cardClass: "border-sky-500/40 ring-1 ring-sky-500/40 bg-gradient-to-br from-sky-950/20 via-sys-card to-sys-card",
      };
  }
}

function EventTypeIcon({ eventType }: { eventType?: string | null }) {
  switch (eventType) {
    case "exam":
      return <FileTextIcon className="w-3 h-3 shrink-0" />;
    case "consultation":
      return <MessageSquareIcon className="w-3 h-3 shrink-0" />;
    case "credit":
      return <CheckCircleIcon className="w-3 h-3 shrink-0" />;
    case "defense":
      return <GraduationCapIcon className="w-3 h-3 shrink-0" />;
    default:
      return null;
  }
}

export function LessonStatusBadge({
  lesson,
  eventBadge,
  compact = false,
}: {
  lesson: Lesson;
  eventBadge: ReturnType<typeof getEventBadge>;
  compact?: boolean;
}) {
  const baseCls = compact
    ? "inline-flex max-w-full [white-space:normal] [overflow-wrap:anywhere] items-center gap-1 rounded px-1.5 py-0.5 text-xs font-bold"
    : "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-bold";

  if (lesson.is_cancelled) {
    if (lesson.moved_to_date) {
      return (
        <span className={`${baseCls} border border-amber-500/40 bg-amber-500/15 tracking-wide text-amber-800 dark:text-amber-300`}>
          ↪ {formatMovedTo(lesson.moved_to_date, lesson.moved_to_lesson)}
        </span>
      );
    }
    return (
      <span className={`${baseCls} border border-rose-500/40 bg-rose-500/15 uppercase tracking-wider text-rose-700 dark:text-rose-400`}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden="true">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
        <span>Скасовано</span>
      </span>
    );
  }
  if (eventBadge) {
    return (
      <span className={`${baseCls} border uppercase tracking-wider ${eventBadge.badgeClass}`}>
        <EventTypeIcon eventType={eventBadge.eventType} />
        <span>{eventBadge.label}</span>
      </span>
    );
  }
  if (lesson.is_replacement) {
    return (
      <span className={`${baseCls} bg-sys-warning uppercase tracking-wider text-sys-warningText`}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-sys-warningText" aria-hidden="true">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
        <span>Заміна</span>
      </span>
    );
  }
  return null;
}

export function TemplateWeekBadge({
  isTemplateMode,
  weekType,
}: {
  isTemplateMode: boolean;
  weekType: string;
}) {
  if (!isTemplateMode || weekType === "both") return null;
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-bold uppercase tracking-wider ${
        weekType === "numerator"
          ? "border-sky-500/30 bg-sky-500/10 text-sky-800 dark:text-sky-300"
          : "border-purple-500/30 bg-purple-500/10 text-purple-800 dark:text-purple-300"
      }`}
    >
      {weekType === "numerator" ? "Чисельник" : "Знаменник"}
    </span>
  );
}
