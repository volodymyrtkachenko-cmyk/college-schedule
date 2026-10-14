"use client";

import { useEffect, useState } from "react";
import { LessonNote } from "./LessonNote";
import { EditIcon, MoveIcon } from "./LessonIcons";
import { Lesson } from "../lib/api";
import { formatRoom, formatTeachers } from "../lib/format";

const ICON_BUTTON =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-base transition-colors";

function parseMinutes(timeStr?: string): number | null {
  if (!timeStr) return null;
  const [h, m] = timeStr.trim().split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

function getKyivNow() {
  const now = new Date();
  const dateIso = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(now);
  const timeParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Kyiv",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  return { dateIso, minutes: parseMinutes(timeParts) ?? 0 };
}

function getRoomBadgeMeta(room: string) {
  const lower = room.toLowerCase();
  if (lower.includes("спорт") || lower.includes("зал")) {
    return { icon: "🏃", tone: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" };
  }
  if (lower.includes("онлайн") || lower.includes("дистанц") || lower.includes("zoom") || lower.includes("meet")) {
    return { icon: "💻", tone: "border-sky-500/30 bg-sky-500/10 text-sky-300" };
  }
  if (lower.includes("лаб") || lower.includes("майст")) {
    return { icon: "🔬", tone: "border-purple-500/30 bg-purple-500/10 text-purple-300" };
  }
  return { icon: "🚪", tone: "border-sys-border bg-sys-tabActive text-sys-text-primary" };
}

export function LessonCard({
  lesson, targetDate, mode, scheduleMode, canEdit, onEdit, movingLesson, onMoveSelect,
}: {
  lesson: Lesson;
  targetDate: string;
  mode: "today" | "week" | "day";
  scheduleMode: "student" | "teacher" | "admin";
  canEdit: boolean;
  onEdit?: (lesson: Lesson) => void;
  movingLesson?: Lesson | null;
  onMoveSelect?: (lesson: Lesson | null) => void;
}) {
  const isSelectedForMove = movingLesson?.id === lesson.id;
  const isDay = mode !== "week";
  const canEditTemplate = canEdit && !lesson.is_replacement && lesson.id > 0;
  const canMove = canEditTemplate && !!onMoveSelect;
  const [startT, endT] = lesson.time.split("-");

  const [nowState, setNowState] = useState<{ dateIso: string; minutes: number } | null>(null);

  useEffect(() => {
    setNowState(getKyivNow());
    const timer = setInterval(() => setNowState(getKyivNow()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const startMin = parseMinutes(startT);
  const endMin = parseMinutes(endT);
  const isTodayTarget = nowState?.dateIso === targetDate;

  const isLive = Boolean(
    isTodayTarget &&
    startMin !== null &&
    endMin !== null &&
    nowState &&
    nowState.minutes >= startMin &&
    nowState.minutes < endMin
  );

  const isPast = Boolean(
    isTodayTarget &&
    endMin !== null &&
    nowState &&
    nowState.minutes >= endMin &&
    !canEdit
  );

  const progressPercent =
    isLive && startMin !== null && endMin !== null && nowState
      ? Math.min(100, Math.max(0, Math.round(((nowState.minutes - startMin) / (endMin - startMin)) * 100)))
      : 0;

  const remainingMin =
    isLive && endMin !== null && nowState ? Math.max(1, endMin - nowState.minutes) : 0;

  const secondary =
    scheduleMode === "teacher" && lesson.group_name
      ? `Група ${lesson.group_name}`
      : lesson.teacher_name ? formatTeachers(lesson.teacher_name) : null;

  const stateClass = isLive
    ? "border-sys-accent/60 ring-1 ring-sys-accent/50 bg-gradient-to-r from-sys-accent/[0.08] via-sys-card to-sys-card shadow-[0_0_20px_rgba(56,189,248,0.12)]"
    : lesson.is_replacement
      ? "border-sys-warning/40 ring-1 ring-sys-warning/60 bg-sys-warning/[0.03]"
      : isSelectedForMove
        ? "border-emerald-400 ring-1 ring-emerald-400/70"
        : "border-sys-border";

  const roomMeta = lesson.room ? getRoomBadgeMeta(lesson.room) : null;

  return (
    <article
      draggable={canMove}
      onDragStart={(event) => {
        if (!canMove) { event.preventDefault(); return; }
        event.dataTransfer.setData("text/plain", String(lesson.id));
        event.dataTransfer.effectAllowed = "move";
        onMoveSelect?.(lesson);
      }}
      className={`relative flex min-w-0 flex-col overflow-hidden rounded-xl border bg-sys-card shadow-sm transition-all duration-300 ${
        isDay ? "p-3 xl:p-4" : "p-2.5"
      } ${stateClass} ${
        !lesson.is_relevant_this_week ? "opacity-60" : isPast ? "opacity-55 hover:opacity-100" : ""
      } ${canMove ? "cursor-grab active:cursor-grabbing" : ""}`}
    >
      <div className={`flex items-start ${isDay ? "gap-3 xl:gap-4" : "gap-2"}`}>
        {isDay && (
          <div className="flex w-12 shrink-0 flex-col text-left sm:w-14">
            <span className={`mb-1 text-xl font-bold leading-none ${isLive ? "text-sys-accent" : "text-sys-neon"}`}>
              {lesson.lesson_number}
            </span>
            <span className="text-xs font-medium text-sys-text-secondary">{startT}</span>
            <span className="text-xs font-medium text-sys-text-secondary">{endT}</span>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              {isLive && (
                <div className="mb-1 inline-flex items-center gap-1.5 rounded-full bg-sys-accent/15 px-2 py-0.5 text-[11px] font-semibold text-sys-accent border border-sys-accent/30">
                  <span className="h-1.5 w-1.5 rounded-full bg-sys-accent animate-ping" />
                  <span>Зараз іде • ще {remainingMin} хв</span>
                </div>
              )}
              <h3 className={`min-w-0 break-words font-bold leading-snug text-sys-text-subject ${isDay ? "text-base" : "text-sm"}`}>
                {lesson.subject_name}
              </h3>
            </div>
            {canEditTemplate && (
              <div className="flex shrink-0 items-center">
                <button type="button" aria-label={`Редагувати ${lesson.subject_name}`} onClick={() => onEdit?.(lesson)}
                  className={`${ICON_BUTTON} text-sys-text-secondary hover:bg-sys-accent/10 hover:text-sys-accent`}>
                  <EditIcon />
                </button>
                {canMove && !movingLesson && (
                  <button type="button" aria-label="Перемістити пару"
                    onClick={(event) => { event.stopPropagation(); onMoveSelect?.(lesson); }}
                    className={`${ICON_BUTTON} text-sys-text-secondary hover:bg-sys-accent/10 hover:text-sys-accent`}>
                    <MoveIcon />
                  </button>
                )}
              </div>
            )}
          </div>

          {(secondary || lesson.room) && (
            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
              {secondary && <p className="min-w-0 break-words text-sm text-sys-text-secondary">{secondary}</p>}
              {lesson.room && roomMeta && (
                <span className={`ml-auto inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium ${roomMeta.tone}`}>
                  <span aria-hidden="true" className="text-[11px]">{roomMeta.icon}</span>
                  <span>{formatRoom(lesson.room)}</span>
                </span>
              )}
            </div>
          )}

          {lesson.is_replacement && (
            <span className="inline-flex w-fit items-center gap-1 rounded bg-sys-warning px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-sys-warningText">
              ⚡ Заміна
            </span>
          )}
        </div>
      </div>

      <LessonNote key={`${lesson.group_id}:${targetDate}:${lesson.lesson_number}:${lesson.subject_id}`} lesson={lesson} date={targetDate} />

      {isLive && (
        <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-sys-border/40 overflow-hidden">
          <div
            className="h-full bg-sys-accent shadow-[0_0_8px_rgba(56,189,248,0.8)] transition-all duration-500 ease-out"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      )}
    </article>
  );
}
