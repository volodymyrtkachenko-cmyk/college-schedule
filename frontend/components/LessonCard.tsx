"use client";

import { useEffect, useMemo, useState } from "react";
import { LessonNote } from "./LessonNote";
import { EditIcon, MoveIcon } from "./LessonIcons";
import { Lesson } from "../lib/api";
import { formatRoom } from "../lib/format";
import { QuickJumpTarget, parseLessonTeachers, parseLessonGroups } from "../lib/quickJump";

export type { QuickJumpTarget };

const ICON_BUTTON =
  "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-sys-border/50 bg-sys-card/70 text-sys-text-secondary shadow-xs transition-colors";

function CopyIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}

function CalendarOffIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.2 4.2A2 2 0 0 0 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 1.8-1.2" />
      <path d="M21 15V6a2 2 0 0 0-2-2H9" />
      <line x1="2" x2="22" y1="2" y2="22" />
    </svg>
  );
}

function parseMinutes(timeStr?: string): number | null {
  if (!timeStr) return null;
  const [h, m] = timeStr.trim().split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

const KYIV_DATE_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" });
const KYIV_TIME_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Kyiv",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function getKyivNow() {
  const now = new Date();
  return {
    dateIso: KYIV_DATE_FMT.format(now),
    minutes: parseMinutes(KYIV_TIME_FMT.format(now)) ?? 0,
  };
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

function getEventBadge(eventType?: string | null, eventTitle?: string | null) {
  if (!eventType) return null;
  switch (eventType) {
    case "exam":
      return {
        label: "📝 Екзамен",
        title: eventTitle || "Екзамен",
        badgeClass: "border-rose-500/40 bg-rose-500/15 text-rose-300",
        cardClass: "border-rose-500/40 ring-1 ring-rose-500/40 bg-gradient-to-br from-rose-950/20 via-sys-card to-sys-card",
      };
    case "consultation":
      return {
        label: "💬 Консультація",
        title: eventTitle || "Консультація",
        badgeClass: "border-amber-500/40 bg-amber-500/15 text-amber-300",
        cardClass: "border-amber-500/40 ring-1 ring-amber-500/40 bg-gradient-to-br from-amber-950/20 via-sys-card to-sys-card",
      };
    case "credit":
      return {
        label: "✅ Залік",
        title: eventTitle || "Залік",
        badgeClass: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
        cardClass: "border-emerald-500/40 ring-1 ring-emerald-500/40 bg-gradient-to-br from-emerald-950/20 via-sys-card to-sys-card",
      };
    case "defense":
      return {
        label: "🎓 Захист",
        title: eventTitle || "Захист",
        badgeClass: "border-purple-500/40 bg-purple-500/15 text-purple-300",
        cardClass: "border-purple-500/40 ring-1 ring-purple-500/40 bg-gradient-to-br from-purple-950/20 via-sys-card to-sys-card",
      };
    default:
      return {
        label: "📌 Подія",
        title: eventTitle || "Подія",
        badgeClass: "border-sky-500/40 bg-sky-500/15 text-sky-300",
        cardClass: "border-sky-500/40 ring-1 ring-sky-500/40 bg-gradient-to-br from-sky-950/20 via-sys-card to-sys-card",
      };
  }
}

export interface ClassroomTaskItem {
  teacher?: string | null;
  label: string;
  url: string;
}

export function extractClassroomTasks(note?: string | null): ClassroomTaskItem[] {
  if (!note) return [];
  const tasks: ClassroomTaskItem[] = [];
  for (const line of note.split("\n")) {
    if (line.trim().startsWith("[TASK]")) {
      const raw = line.replace("[TASK]", "").trim();
      const [leftPart, urlPart] = raw.split("|").map((s) => s.trim());
      if (!leftPart || !urlPart || !urlPart.startsWith("http")) continue;

      let teacher: string | null = null;
      let rest = leftPart;

      const badgeMatch = leftPart.match(/^\[([^\]]+)\]\s*(.*)$/);
      if (badgeMatch) {
        teacher = badgeMatch[1].trim();
        rest = badgeMatch[2].trim();
      }

      // Приводимо до стандарту "до DD.MM" або "ДЗ"
      const dueMatch = rest.match(/\(до\s+\d{2}\.\d{2}\)/i);
      const label = dueMatch ? dueMatch[0].replace(/[()]/g, "").trim() : "ДЗ";

      tasks.push({ teacher, label, url: urlPart });
    }
  }
  return tasks;
}

export function getVisibleUserNote(note?: string | null): string {
  if (!note) return "";
  return note
    .split("\n")
    .map((line) => {
      if (line.trim().startsWith("[TASK]")) return "";
      // ВАЖЛИВО: без \b перед кирилицею, бо в JS \b працює лише для латиниці!
      const cleaned = line
        .replace(/https?:\/\/(?:meet\.google\.com|[a-z0-9.-]*zoom\.us)\/[^\s|]+/gi, "")
        .replace(/(?:Ідентифікатор(?:\s+конференції)?|Meeting\s*ID|ID)\s*[:\-]?\s*[\d\s\-]+/gi, "")
        .replace(/(?:Код(?:\s+доступ[уа])?|Passcode|Пароль)\s*[:\-]?\s*[A-Za-zА-Яа-яІіЇїЄєҐґ0-9_.\-]+/gi, "")
        .replace(/^(?:Токарєв[а-яА-ЯіїєґІЇЄҐ.]*|Хочинськ[а-яА-ЯіїєґІЇЄҐ.]*|Токарев[а-яА-Я.]*|Хочинск[а-яА-Я.]*|[1-9]\s*підгрупа|підгрупа\s*[1-9]|викладач)\s*[:\-]?\s*$/gi, "")
        .replace(/^(?:Zoom|Meet|Google Meet|Підключитися|Приєднатися|Конференція)(?:\s+Zoom|\s+Meet)?\s*[:\-]?$/gi, "")
        .replace(/^[-—_|~*=]{1,5}$/g, "")
        .replace(/\|/g, " ")
        .trim();
      return cleaned;
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

export function extractOnlineMeetingInfo(note?: string | null, room?: string | null) {
  const meetings = extractOnlineMeetings(note, room);
  return meetings[0] ?? null;
}

export interface MeetingInfo {
  url: string;
  platform: "meet" | "zoom";
  passcode: string | null;
  label?: string;
}

export function extractOnlineMeetings(
  note?: string | null,
  room?: string | null,
  teacherName?: string | null,
  subjectName?: string | null
): MeetingInfo[] {
  const isForeignLang = Boolean(
    (subjectName && /іноземн|англ/i.test(subjectName)) ||
    (teacherName && /токарєв|хочинськ/i.test(teacherName))
  );

  const isElectronics = Boolean(
    (subjectName && /електронік/i.test(subjectName)) ||
    (teacherName && /філімончук/i.test(teacherName))
  );

  const lines = `${room || ""}\n${note || ""}`.split("\n");
  const results: MeetingInfo[] = [];
  const seenUrls = new Set<string>();

  for (const line of lines) {
    const urlMatches = Array.from(
      line.matchAll(/https?:\/\/(?:meet\.google\.com|[a-z0-9.-]*zoom\.us)\/[^\s<>"')|]+/gi)
    );

    for (const match of urlMatches) {
      let url = match[0];
      if (seenUrls.has(url.toLowerCase())) continue;
      seenUrls.add(url.toLowerCase());

      const isMeet = url.toLowerCase().includes("meet.google.com");
      const hasPwdInUrl = /[?&]pwd=[^&\s]+/i.test(url);

      const passMatch = line.match(
        /(?:Код(?:\s+доступ[уа])?|Passcode|Пароль)\s*[:\-]?\s*([A-Za-z0-9_.\-]+)/i
      );
      let rawPass = passMatch ? passMatch[1] : null;

      if (isElectronics && !isMeet && !hasPwdInUrl && !rawPass) {
        rawPass = "dfkr";
      }

      // Якщо це Zoom і в URL ще немає ?pwd=, вшиваємо код прямо в посилання!
      if (!isMeet && !hasPwdInUrl && rawPass) {
        const sep = url.includes("?") ? "&" : "?";
        url = `${url}${sep}pwd=${encodeURIComponent(rawPass)}`;
      }

      let label: string | undefined;
      const lowerLine = line.toLowerCase();
      if (lowerLine.includes("токарєв") || lowerLine.includes("токарев")) {
        label = "Токарєва";
      } else if (lowerLine.includes("хочинськ") || lowerLine.includes("хочинск")) {
        label = "Хочинська";
      } else {
        const prefixMatch = line.match(
          /^([А-Яа-яІіЇїЄєҐґa-zA-Z\s.'—–\-]+|\d+\s*підгрупа|підгрупа\s*\d+)\s*[:\-–]\s*https?/i
        );
        if (prefixMatch) {
          const raw = prefixMatch[1].trim();
          if (raw.length >= 3 && raw.length <= 25) {
            label = raw;
          }
        }
      }

      if (!label && isForeignLang) {
        label = isMeet ? "Токарєва" : "Хочинська";
      }

      // Оскільки пароль або вже був у ?pwd=, або щойно вшитий у URL, окремий бейдж 🔑 не потрібен
      results.push({
        url,
        platform: isMeet ? "meet" : "zoom",
        passcode: null,
        label,
      });
    }
  }

  if (isForeignLang && results.length > 0) {
    for (const r of results) {
      if (!r.label) {
        r.label = r.platform === "meet" ? "Токарєва" : "Хочинська";
      }
    }
    results.sort((a, b) => {
      if (a.label === "Токарєва") return -1;
      if (b.label === "Токарєва") return 1;
      return 0;
    });
  }

  return results;
}

function vibrateTap(ms = 10) {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    try { navigator.vibrate(ms); } catch {}
  }
}

export function LessonCard({
  lesson,
  targetDate,
  mode,
  scheduleMode,
  canEdit,
  onEdit,
  movingLesson,
  onMoveSelect,
  onCopySelect,
  onCancelDated,
  onRestoreDated,
  onQuickJump,
}: {
  lesson: Lesson;
  targetDate: string;
  mode: "today" | "week" | "day";
  scheduleMode: "student" | "teacher" | "admin";
  canEdit: boolean;
  onEdit?: (lesson: Lesson) => void;
  movingLesson?: Lesson | null;
  onMoveSelect?: (lesson: Lesson | null) => void;
  onCopySelect?: (lesson: Lesson) => void;
  onCancelDated?: (lesson: Lesson, date: string) => void;
  onRestoreDated?: (lesson: Lesson, date: string) => void;
  onQuickJump?: (target: QuickJumpTarget) => void;
}) {
  const isSelectedForMove = movingLesson?.id === lesson.id;
  const isDay = mode !== "week";
  const isEvent = Boolean(lesson.event_type || lesson.event_id);
  const canEditTemplate = canEdit && !lesson.is_cancelled && (!lesson.is_replacement || isEvent);
  const canMove = canEditTemplate && !!onMoveSelect;
  const [startT, endT] = lesson.time.split("-");

  const [isHwOpen, setIsHwOpen] = useState(false);

  const toggleHw = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    vibrateTap(10);
    setIsHwOpen((prev) => !prev);
  };

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
    isTodayTarget && endMin !== null && nowState && nowState.minutes >= endMin && !canEdit
  );

  const progressPercent =
    isLive && startMin !== null && endMin !== null && nowState
      ? Math.min(100, Math.max(0, Math.round(((nowState.minutes - startMin) / (endMin - startMin)) * 100)))
      : 0;

  const remainingMin =
    isLive && endMin !== null && nowState ? Math.max(1, endMin - nowState.minutes) : 0;

  const isTeacherView = scheduleMode === "teacher";
  const tasks = useMemo(() => extractClassroomTasks(lesson.note), [lesson.note]);
  const meetings = useMemo(
    () => extractOnlineMeetings(lesson.note, lesson.room, lesson.teacher_name, lesson.subject_name),
    [lesson.note, lesson.room, lesson.teacher_name, lesson.subject_name]
  );
  const visibleNoteText = useMemo(() => getVisibleUserNote(lesson.note), [lesson.note]);
  const hasMeeting = meetings.length > 0;
  const secondaryItems = useMemo(() => {
    return isTeacherView ? parseLessonGroups(lesson) : parseLessonTeachers(lesson);
  }, [isTeacherView, lesson.group_id, lesson.group_name, lesson.teacher_id, lesson.second_teacher_id, lesson.teacher_name]);

  const rooms = useMemo(() => {
    if (!lesson.room) return [];
    return lesson.room
      .split(/\s*[,/;]\s*/)
      .map((r) => r.trim())
      .filter(Boolean);
  }, [lesson.room]);

  const hasTwoTeachersWithRooms = !isTeacherView && secondaryItems.length === 2 && rooms.length >= 2;

  const eventBadge = useMemo(
    () => getEventBadge(lesson.event_type, lesson.event_title),
    [lesson.event_type, lesson.event_title]
  );

  const stateClass = lesson.is_cancelled
    ? "border-rose-500/40 border-dashed bg-rose-500/[0.04] opacity-80"
    : isLive
      ? "border-sys-accent/60 ring-1 ring-sys-accent/50 bg-gradient-to-r from-sys-accent/[0.08] via-sys-card to-sys-card shadow-[0_0_20px_rgba(56,189,248,0.12)]"
      : eventBadge
        ? eventBadge.cardClass
        : lesson.is_replacement
          ? "border-sys-warning/40 ring-1 ring-sys-warning/60 bg-sys-warning/[0.03]"
          : isSelectedForMove
            ? "border-emerald-400 ring-1 ring-emerald-400/70"
            : "border-sys-border";

  return (
    <article
      data-live={isLive ? "true" : undefined}
      draggable={canMove}
      onDragStart={(event) => {
        if (!canMove) {
          event.preventDefault();
          return;
        }
        event.dataTransfer.setData("text/plain", String(lesson.id));
        event.dataTransfer.effectAllowed = event.altKey ? "copy" : "move";
        if (event.altKey && onCopySelect) {
          onCopySelect(lesson);
        } else {
          onMoveSelect?.(lesson);
        }
      }}
      className={`relative flex min-w-0 flex-col overflow-hidden rounded-xl border bg-sys-card shadow-sm transition-colors duration-200 ${
        isDay ? "p-3 xl:p-3.5" : "p-2.5"
      } ${stateClass} ${
        !lesson.is_relevant_this_week ? "opacity-60" : isPast ? "opacity-55 hover:opacity-100" : ""
      } ${canMove ? "cursor-grab active:cursor-grabbing" : ""}`}
    >
      <div className="flex items-start gap-2.5 sm:gap-3">
        {/* Left: narrow fixed column (number + start time) */}
        <div className="flex w-11 sm:w-12 shrink-0 flex-col text-left">
          <span className={`text-lg sm:text-xl font-bold leading-none ${isLive ? "text-sys-accent" : "text-sys-neon"}`}>
            {lesson.lesson_number}
          </span>
          <span className="text-[11px] sm:text-xs font-semibold text-sys-text-secondary mt-1">
            {startT}
          </span>
          {isLive && (
            <span className="mt-1 flex items-center gap-1 text-[10px] font-semibold text-sys-accent">
              <span className="h-1.5 w-1.5 animate-ping rounded-full bg-sys-accent" />
              <span>{remainingMin}хв</span>
            </span>
          )}
        </div>

        {/* Right: full remaining width column */}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {/* Row 1: Subject name (full width, NO line-clamp, NO text-overflow: ellipsis) */}
          <div className="min-w-0">
            <h3
              className={`break-words font-semibold leading-snug text-sm sm:text-[15px] ${
                lesson.is_cancelled ? "line-through text-sys-text-muted" : "text-sys-text-subject"
              }`}
            >
              {lesson.subject_name}
            </h3>
            {lesson.event_title && lesson.event_title !== lesson.subject_name && (
              <span className="mt-0.5 block text-xs font-medium text-sys-text-secondary">
                {lesson.event_title}
              </span>
            )}
          </div>

          {/* Row 2: Teacher(s) - completely visible without trimming, overflow-wrap anywhere */}
          {hasTwoTeachersWithRooms ? (
            <div className="flex flex-col gap-0.5 text-xs text-sys-text-secondary [overflow-wrap:anywhere]">
              <div className="inline-flex items-center whitespace-nowrap">
                {onQuickJump ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onQuickJump(secondaryItems[0].target);
                    }}
                    className="font-medium underline-offset-2 hover:text-sys-accent hover:underline focus:outline-none"
                  >
                    {secondaryItems[0].displayName}
                  </button>
                ) : (
                  <span>{secondaryItems[0].displayName}</span>
                )}
                <span className="text-sys-text-muted"> · </span>
                <span className="font-medium text-sys-text-primary">{formatRoom(rooms[0])}</span>
              </div>
              <div className="inline-flex items-center whitespace-nowrap">
                {onQuickJump ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onQuickJump(secondaryItems[1].target);
                    }}
                    className="font-medium underline-offset-2 hover:text-sys-accent hover:underline focus:outline-none"
                  >
                    {secondaryItems[1].displayName}
                  </button>
                ) : (
                  <span>{secondaryItems[1].displayName}</span>
                )}
                <span className="text-sys-text-muted"> · </span>
                <span className="font-medium text-sys-text-primary">{formatRoom(rooms[1])}</span>
              </div>
            </div>
          ) : secondaryItems.length > 0 ? (
            <div className="text-xs text-sys-text-secondary [overflow-wrap:anywhere]">
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
                      className="font-medium underline-offset-2 hover:text-sys-accent hover:underline focus:outline-none"
                    >
                      {item.displayName}
                    </button>
                  ) : (
                    <span>{item.displayName}</span>
                  )}
                </span>
              ))}
            </div>
          ) : null}

          {/* Row 3: Badges in flex-wrap with gap (room, special venue, online meeting, HW badge, replacement, cancellation) */}
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 pt-0.5">
            {!hasTwoTeachersWithRooms && rooms.length > 0 && (
              rooms.map((rm, idx) => {
                const meta = getRoomBadgeMeta(rm);
                return (
                  <span
                    key={`${rm}-${idx}`}
                    title={formatRoom(rm)}
                    className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium ${meta.tone}`}
                  >
                    <span aria-hidden="true" className="text-[11px]">{meta.icon}</span>
                    <span>{formatRoom(rm)}</span>
                  </span>
                );
              })
            )}

            {hasMeeting && meetings.map((m, idx) => (
              <a
                key={`${m.url}-${idx}`}
                href={m.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => {
                  e.stopPropagation();
                  vibrateTap(12);
                }}
                title={
                  m.label
                    ? `${m.label} (${m.platform === "meet" ? "Google Meet" : "Zoom"})`
                    : m.platform === "meet"
                    ? "Google Meet"
                    : "Zoom"
                }
                className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-bold transition-transform active:scale-[0.98] ${
                  m.platform === "meet"
                    ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"
                    : "border-sky-500/40 bg-sky-500/15 text-sky-300 hover:bg-sky-500/25"
                }`}
              >
                <span>{m.platform === "meet" ? "🎥 Meet" : "📹 Zoom"}</span>
                {m.label && <span className="text-[10px] opacity-80">({m.label})</span>}
                <span>↗</span>
              </a>
            ))}

            {tasks.length > 0 && (
              <button
                type="button"
                onClick={toggleHw}
                aria-expanded={isHwOpen}
                aria-controls={`hw-list-${lesson.id}-${lesson.lesson_number}`}
                title={isHwOpen ? "Згорнути завдання" : `${tasks.length} ДЗ — натисніть для перегляду`}
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-purple-500/35 bg-purple-500/10 px-2 py-0.5 text-xs font-semibold text-purple-200 hover:bg-purple-500/20 active:scale-[0.98] transition-all duration-100 ease-out focus:outline-none focus:ring-1 focus:ring-purple-400"
              >
                <span>📌 {tasks.length} ДЗ</span>
                <span className={`text-[10px] transition-transform duration-150 motion-reduce:transition-none ${isHwOpen ? "rotate-180" : ""}`}>
                  ▾
                </span>
              </button>
            )}

            {lesson.is_cancelled ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded border border-rose-500/40 bg-rose-500/15 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-rose-400">
                ❌ Скасовано
              </span>
            ) : eventBadge ? (
              <span className={`inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wider ${eventBadge.badgeClass}`}>
                {eventBadge.label}
              </span>
            ) : lesson.is_replacement ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded bg-sys-warning px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-sys-warningText">
                ⚡ Заміна
              </span>
            ) : null}
          </div>

          {/* Smooth HW expansion container using CSS grid (0fr -> 1fr + opacity 0 -> 1) */}
          {tasks.length > 0 && (
            <div
              id={`hw-list-${lesson.id}-${lesson.lesson_number}`}
              className={`grid transition-[grid-template-rows] duration-200 ease-smooth motion-reduce:transition-none ${
                isHwOpen ? "grid-rows-[1fr] mt-2" : "grid-rows-[0fr]"
              }`}
            >
              <div className={`overflow-hidden transition-opacity duration-200 ease-smooth motion-reduce:transition-none ${
                isHwOpen ? "opacity-100" : "opacity-0"
              }`}>
                <div className="flex flex-col gap-1.5 pt-1 border-t border-purple-500/20">
                  {tasks.map((task, idx) => (
                    <a
                      key={idx}
                      href={task.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => {
                        e.stopPropagation();
                        vibrateTap(10);
                      }}
                      title={`${task.teacher ? `[${task.teacher}] ` : ""}📌 ${task.label} — Відкрити в Classroom`}
                      className="group flex flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded-lg border border-purple-500/35 bg-purple-500/10 px-2.5 py-1.5 text-xs font-medium text-purple-200 transition-colors hover:bg-purple-500/20 active:scale-[0.98]"
                    >
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                        {task.teacher && (
                          <span className="shrink-0 rounded bg-purple-500/30 px-1.5 py-0.5 text-[10px] font-bold text-purple-100">
                            {task.teacher}
                          </span>
                        )}
                        <span className="font-semibold text-purple-100">📌 {task.label}</span>
                      </div>
                      <span className="ml-auto shrink-0 text-[11px] font-bold text-purple-300 transition-transform group-hover:translate-x-0.5">
                        Classroom ↗
                      </span>
                    </a>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Admin edit controls */}
          {canEdit && (
            <div className="mt-1 flex flex-wrap items-center gap-1 border-t border-sys-border/30 pt-1.5">
              {lesson.is_cancelled ? (
                onRestoreDated && lesson.group_id && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRestoreDated(lesson, targetDate);
                    }}
                    title={`Відновити пару на ${targetDate}`}
                    aria-label="Відновити пару на цю дату"
                    className="inline-flex items-center gap-1 rounded-md border border-emerald-500/50 bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-400 shadow-xs transition-colors hover:border-emerald-500 hover:bg-emerald-500/25 active:scale-[0.98]"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                      <path d="M3 3v5h5" />
                    </svg>
                    <span>Відновити пару</span>
                  </button>
                )
              ) : (
                <>
                  {canEditTemplate && (
                    <>
                      <button
                        type="button"
                        title={isEvent ? "Редагувати подію сесії" : "Редагувати шаблон пари"}
                        aria-label={`Редагувати ${lesson.subject_name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onEdit?.(lesson);
                        }}
                        className={`${ICON_BUTTON} hover:border-sys-accent/60 hover:bg-sys-accent/15 hover:text-sys-accent active:scale-[0.98]`}
                      >
                        <EditIcon />
                      </button>
                      {canMove && !movingLesson && (
                        <button
                          type="button"
                          title={isEvent ? "Перемістити подію" : "Перемістити пару"}
                          aria-label="Перемістити пару"
                          onClick={(event) => {
                            event.stopPropagation();
                            onMoveSelect?.(lesson);
                          }}
                          className={`${ICON_BUTTON} hover:border-emerald-500/60 hover:bg-emerald-500/15 hover:text-emerald-400 active:scale-[0.98]`}
                        >
                          <MoveIcon />
                        </button>
                      )}
                      {onCopySelect && !movingLesson && (
                        <button
                          type="button"
                          title={isEvent ? "Дублювати подію в інший слот" : "Дублювати пару в інший слот"}
                          aria-label="Дублювати пару"
                          onClick={(event) => {
                            event.stopPropagation();
                            onCopySelect(lesson);
                          }}
                          className={`${ICON_BUTTON} hover:border-sky-500/60 hover:bg-sky-500/15 hover:text-sky-400 active:scale-[0.98]`}
                        >
                          <CopyIcon />
                        </button>
                      )}
                    </>
                  )}
                  {onCancelDated && lesson.group_id && (
                    <button
                      type="button"
                      title={`Скасувати лише на ${targetDate}`}
                      aria-label="Скасувати лише на цю дату"
                      onClick={(event) => {
                        event.stopPropagation();
                        if (
                          typeof window !== "undefined" &&
                          !window.confirm(`Ви впевнені, що хочете скасувати пару "${lesson.subject_name}" на ${targetDate}?`)
                        ) {
                          return;
                        }
                        onCancelDated(lesson, targetDate);
                      }}
                      className={`${ICON_BUTTON} hover:border-rose-500/60 hover:bg-rose-500/15 hover:text-rose-400 active:scale-[0.98]`}
                    >
                      <CalendarOffIcon />
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {/* User note */}
          {!lesson.is_cancelled && (canEdit || visibleNoteText.length > 0) && (
            <div onClick={(e) => e.stopPropagation()}>
              <LessonNote key={`${lesson.group_id}:${targetDate}:${lesson.lesson_number}:${lesson.subject_id}`} lesson={lesson} date={targetDate} />
            </div>
          )}
        </div>
      </div>

      {/* Progress bar at the bottom for live lesson */}
      {isLive && (
        <div className="absolute bottom-0 left-0 right-0 h-[3px] overflow-hidden bg-sys-border/40">
          <div
            className="h-full bg-sys-accent shadow-[0_0_8px_rgba(56,189,248,0.8)] transition-all duration-500 ease-out"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      )}
    </article>
  );
}
