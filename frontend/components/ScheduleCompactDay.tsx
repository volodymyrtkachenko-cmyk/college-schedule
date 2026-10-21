"use client";

import { useMemo, useState, useRef, useEffect } from "react";
import { Lesson, ScheduleResponse } from "../lib/api";
import { QuickJumpTarget, parseLessonTeachers, parseLessonGroups } from "../lib/quickJump";
import { formatRoom } from "../lib/format";
import {
  extractClassroomTasks,
  extractOnlineMeetings,
  sortTasksByDeadline,
  getTaskStatusText,
  ClassroomTaskItem,
} from "./LessonCard";
import { useClassroomSubmissions } from "../lib/useClassroomSubmissions";

function parseMinutes(timeStr?: string): number | null {
  if (!timeStr) return null;
  const [h, m] = timeStr.trim().split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

function CompactHwPopover({
  tasks,
  isLinked,
  onClose,
}: {
  tasks: ClassroomTaskItem[];
  isLinked: boolean;
  onClose: () => void;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  return (
    <div
      ref={popoverRef}
      className="absolute right-0 top-full mt-1.5 z-40 w-72 sm:w-80 rounded-xl border border-sys-border bg-sys-card p-3 shadow-xl animate-in fade-in zoom-in-95 duration-100"
    >
      <div className="flex items-center justify-between pb-2 border-b border-sys-border/50">
        <span className="text-xs font-semibold text-sys-text-primary">
          Завдання ({tasks.length})
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-sys-text-muted hover:text-sys-text-primary text-xs px-1.5 py-0.5 rounded cursor-pointer"
        >
          ✕
        </button>
      </div>
      <div className="mt-2 space-y-2 max-h-56 overflow-y-auto">
        {tasks.map((task, idx) => (
          <a
            key={idx}
            href={task.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block rounded-lg border border-sys-border/60 bg-sys-surface p-2 text-xs hover:border-sys-accent/40 transition-colors"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="font-medium text-sys-text-primary line-clamp-2 leading-snug">
                {task.title || "Завдання"}
              </span>
              <span className="text-xs text-sys-text-muted shrink-0">↗</span>
            </div>
            {task.deadline.statusText && (
              <div className="mt-1 flex items-center gap-1.5 text-[11px] font-medium">
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    task.deadline.badgeTone === "overdue"
                      ? isLinked ? "bg-sys-danger" : "bg-zinc-500"
                      : task.deadline.badgeTone === "urgent"
                      ? "bg-sys-warning"
                      : "bg-zinc-500"
                  }`}
                />
                <span
                  className={
                    task.deadline.badgeTone === "overdue"
                      ? isLinked ? "text-sys-danger" : "text-sys-text-secondary"
                      : task.deadline.badgeTone === "urgent"
                      ? "text-sys-warning"
                      : "text-sys-text-secondary"
                  }
                >
                  {getTaskStatusText(task.deadline, isLinked)}
                </span>
              </div>
            )}
          </a>
        ))}
      </div>
    </div>
  );
}

function CompactLessonRow({
  lesson,
  scheduleMode = "student",
  isLive = false,
  isNext = false,
  remainingMin = 0,
  onQuickJump,
}: {
  lesson: Lesson;
  scheduleMode?: "student" | "teacher" | "admin";
  isLive?: boolean;
  isNext?: boolean;
  remainingMin?: number;
  onQuickJump?: (target: QuickJumpTarget) => void;
}) {
  const { isLinked } = useClassroomSubmissions();
  const [hwPopoverOpen, setHwPopoverOpen] = useState(false);

  const isTeacherView = scheduleMode === "teacher";
  const secondaryItems = useMemo(() => {
    return isTeacherView ? parseLessonGroups(lesson) : parseLessonTeachers(lesson);
  }, [isTeacherView, lesson.group_id, lesson.group_name, lesson.teacher_id, lesson.second_teacher_id, lesson.teacher_name]);

  const isDual = !isTeacherView && secondaryItems.length === 2;

  const meetings = useMemo(() => {
    return extractOnlineMeetings(lesson.note, lesson.room, lesson.teacher_name, lesson.subject_name);
  }, [lesson.note, lesson.room, lesson.teacher_name, lesson.subject_name]);

  const tasks = useMemo(() => {
    return sortTasksByDeadline(extractClassroomTasks(lesson.note));
  }, [lesson.note]);

  const [startT, endT] = useMemo(() => {
    const raw = lesson.time || "";
    const p = raw.split(/[-–—]/).map((s) => s.trim());
    return [p[0] || "", p[1] || ""];
  }, [lesson.time]);

  const hasOverdue = tasks.some((t) => t.deadline.badgeTone === "overdue");
  const hasUrgent = tasks.some((t) => t.deadline.badgeTone === "urgent");

  // Determine meeting live/soon
  const isMeetingLiveOrSoon = isLive;

  return (
    <div
      className={`relative flex items-center gap-3 px-3.5 border-b border-sys-borderSubtle bg-sys-surface hover:bg-sys-surfaceHover transition-colors ${
        isDual ? "min-h-[68px] py-2" : "min-h-[52px] h-[52px]"
      } ${
        isLive
          ? "border-l-[3px] border-l-sys-accent bg-sys-accent/[0.04]"
          : isNext
          ? "border-l-[3px] border-l-sys-accent"
          : "border-l-[3px] border-l-transparent"
      }`}
    >
      {/* Col 1: Lesson Number (w-8) */}
      <div className="w-8 shrink-0 flex items-center justify-center font-bold text-sm font-mono text-sys-text-secondary">
        <span className={isLive ? "text-sys-accent" : ""}>{lesson.lesson_number}</span>
      </div>

      {/* Col 2: Time (w-28) */}
      <div className="w-28 shrink-0 flex flex-col justify-center leading-tight whitespace-nowrap">
        <span className="text-xs font-mono font-medium text-sys-text-primary">
          {startT}–{endT}
        </span>
        {isLive ? (
          <span className="text-[11px] font-semibold text-sys-success mt-0.5">
            ще {remainingMin} хв
          </span>
        ) : isNext ? (
          <span className="text-[11px] font-medium text-sys-accent mt-0.5">
            Далі
          </span>
        ) : null}
      </div>

      {/* Col 3: Subject Name (flex-1) */}
      <div className="flex-1 min-w-0 flex items-center gap-2 pr-2">
        <span
          className={`text-sm font-medium truncate ${
            lesson.is_cancelled ? "line-through text-sys-text-muted" : "text-sys-text-primary"
          }`}
          title={lesson.subject_name}
        >
          {lesson.subject_name}
        </span>
        {lesson.is_cancelled && (
          <span className="shrink-0 text-[11px] px-1.5 py-0.2 rounded border border-sys-border bg-sys-surface text-sys-text-secondary">
            Скасовано
          </span>
        )}
        {lesson.is_replacement && (
          <span className="shrink-0 text-[11px] px-1.5 py-0.2 rounded border border-sys-border bg-sys-surface text-sys-text-secondary">
            Заміна
          </span>
        )}
      </div>

      {/* Col 4: Teacher(s) & Room / Link */}
      <div className="shrink-0 flex items-center justify-end">
        {isDual ? (
          <div className="flex flex-col gap-1.5 items-end text-xs">
            {secondaryItems.map((item, idx) => {
              const ownMeeting = meetings[idx];
              const ownRoom = idx === 0 ? lesson.teacher_room : lesson.second_teacher_room;
              return (
                <div key={idx} className="flex items-center gap-2">
                  <span className="text-sys-text-secondary text-xs truncate max-w-[140px]" title={item.displayName}>
                    {idx + 1} підгр. {item.displayName.split(" ")[0]}
                  </span>
                  {ownMeeting ? (
                    <a
                      href={ownMeeting.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`inline-flex h-6 px-2 items-center gap-1 rounded text-[11px] font-semibold transition-colors ${
                        isMeetingLiveOrSoon
                          ? "bg-sys-success text-[#0B0B0E] hover:bg-emerald-400"
                          : "border border-sys-borderStrong bg-sys-surface text-sys-text-primary hover:bg-sys-surfaceHover"
                      }`}
                    >
                      <span>{isMeetingLiveOrSoon ? "Приєднатися" : ownMeeting.platform === "zoom" ? "Zoom ↗" : "Meet ↗"}</span>
                    </a>
                  ) : ownRoom ? (
                    <span className="text-[11px] font-mono text-sys-text-secondary px-1.5 py-0.5 rounded border border-sys-borderSubtle bg-sys-bg">
                      {formatRoom(ownRoom)}
                    </span>
                  ) : (
                    <span className="text-[11px] text-sys-text-muted">—</span>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex items-center gap-3">
            {secondaryItems[0] && (
              <span
                className="text-xs text-sys-text-secondary truncate max-w-[170px]"
                title={secondaryItems[0].displayName}
              >
                {onQuickJump ? (
                  <button
                    type="button"
                    onClick={() => onQuickJump(secondaryItems[0].target)}
                    className="hover:text-sys-accent hover:underline text-left truncate"
                  >
                    {secondaryItems[0].displayName}
                  </button>
                ) : (
                  secondaryItems[0].displayName
                )}
              </span>
            )}

            {/* Room or Link */}
            {meetings[0] ? (
              <a
                href={meetings[0].url}
                target="_blank"
                rel="noopener noreferrer"
                className={`inline-flex h-7 px-2.5 items-center gap-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                  isMeetingLiveOrSoon
                    ? "bg-sys-success text-[#0B0B0E] hover:bg-emerald-400"
                    : "border border-sys-borderStrong bg-sys-surface text-sys-text-primary hover:bg-sys-surfaceHover"
                }`}
              >
                <span>{isMeetingLiveOrSoon ? "Приєднатися" : meetings[0].platform === "zoom" ? "Zoom ↗" : "Meet ↗"}</span>
              </a>
            ) : lesson.room ? (
              <span className="text-xs font-mono text-sys-text-secondary px-2 py-0.5 rounded border border-sys-borderSubtle bg-sys-bg whitespace-nowrap">
                {formatRoom(lesson.room)}
              </span>
            ) : null}
          </div>
        )}
      </div>

      {/* Col 5: HW badge (w-20) */}
      <div className="w-20 shrink-0 flex items-center justify-end relative">
        {tasks.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => setHwPopoverOpen((v) => !v)}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold border transition-colors cursor-pointer ${
                hasOverdue && isLinked
                  ? "border-sys-danger text-sys-danger bg-sys-danger/10"
                  : hasUrgent
                  ? "border-sys-warning text-sys-warning bg-sys-warning/10"
                  : "border-sys-borderStrong text-sys-text-secondary hover:text-sys-text-primary bg-sys-surface"
              }`}
            >
              <span>{tasks.length} ДЗ</span>
            </button>
            {hwPopoverOpen && (
              <CompactHwPopover
                tasks={tasks}
                isLinked={isLinked}
                onClose={() => setHwPopoverOpen(false)}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function ScheduleCompactDay({
  schedule,
  isToday = false,
  scheduleMode = "student",
  onQuickJump,
}: {
  schedule: ScheduleResponse;
  isToday?: boolean;
  scheduleMode?: "student" | "teacher" | "admin";
  onQuickJump?: (target: QuickJumpTarget) => void;
}) {
  const [kyivNow, setKyivNow] = useState<{ dateIso: string; minutes: number } | null>(null);

  useEffect(() => {
    const update = () => {
      const now = new Date();
      const dateIso = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(now);
      const timeStr = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Kyiv",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(now);
      setKyivNow({ dateIso, minutes: parseMinutes(timeStr) ?? 0 });
    };
    update();
    const id = setInterval(update, 30_000);
    return () => clearInterval(id);
  }, []);

  const orderedLessons = useMemo(() => {
    return [...schedule.lessons].sort(
      (a, b) => a.lesson_number - b.lesson_number || a.id - b.id
    );
  }, [schedule.lessons]);

  const liveLessonId = useMemo(() => {
    if (!isToday || !kyivNow) return null;
    return orderedLessons.find((l) => {
      const [s, e] = l.time.split(/[-–—]/).map(parseMinutes);
      return s !== null && e !== null && kyivNow.minutes >= s && kyivNow.minutes < e && !l.is_cancelled;
    })?.id ?? null;
  }, [isToday, kyivNow, orderedLessons]);

  const nextLessonId = useMemo(() => {
    if (!isToday || !kyivNow || liveLessonId) return null;
    return orderedLessons.find((l) => {
      const [s] = l.time.split(/[-–—]/).map(parseMinutes);
      return s !== null && kyivNow.minutes < s && !l.is_cancelled;
    })?.id ?? null;
  }, [isToday, kyivNow, liveLessonId, orderedLessons]);

  if (!orderedLessons.length) {
    return (
      <div className="flex min-h-[220px] flex-col items-center justify-center rounded-2xl border border-dashed border-sys-borderSubtle bg-sys-surface/50 px-6 py-10 text-center">
        <p className="text-sm font-semibold text-sys-text-primary">Пар немає</p>
        <p className="text-xs text-sys-text-secondary mt-1">Розклад на цей день вільний</p>
      </div>
    );
  }

  return (
    <div className="w-full rounded-2xl border border-sys-borderSubtle bg-sys-surface overflow-hidden shadow-xs divide-y divide-sys-borderSubtle">
      {orderedLessons.map((lesson) => {
        const isLive = lesson.id === liveLessonId;
        const isNext = lesson.id === nextLessonId;
        const [, endT] = lesson.time.split(/[-–—]/).map((s) => s.trim());
        const endMin = parseMinutes(endT);
        const remainingMin = isLive && endMin !== null && kyivNow ? Math.max(1, endMin - kyivNow.minutes) : 0;

        return (
          <CompactLessonRow
            key={`${lesson.id}-${lesson.lesson_number}`}
            lesson={lesson}
            scheduleMode={scheduleMode}
            isLive={isLive}
            isNext={isNext}
            remainingMin={remainingMin}
            onQuickJump={onQuickJump}
          />
        );
      })}
    </div>
  );
}
