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

export function extractClassroomTasks(note?: string | null): Array<{ title: string; url: string }> {
  if (!note) return [];
  const tasks: Array<{ title: string; url: string }> = [];
  for (const line of note.split("\n")) {
    if (line.trim().startsWith("[TASK]")) {
      const raw = line.replace("[TASK]", "").trim();
      const [titlePart, urlPart] = raw.split("|").map((s) => s.trim());
      if (titlePart && urlPart && urlPart.startsWith("http")) {
        tasks.push({ title: titlePart, url: urlPart });
      }
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
      // Прибираємо технічні сегменти, які вже показані кнопками Meet / Zoom / Код
      const cleaned = line
        .replace(/https?:\/\/(?:meet\.google\.com|[a-z0-9.-]*zoom\.us)\/[^\s|]+/gi, "")
        .replace(/\b(?:Ідентифікатор(?:\s+конференції)?|Meeting\s*ID|ID)\s*[:\-]?\s*[\d\s\-]+/gi, "")
        .replace(/\b(?:Код(?:\s+доступу)?|Passcode|Пароль)\s*[:\-]?\s*[A-Za-z0-9_.\-]+/gi, "")
        .replace(/^(?:Токарєв[а-яА-Я.]*|Хочинськ[а-яА-Я.]*|Токарев[а-яА-Я.]*|Хочинск[а-яА-Я.]*|[1-9]\s*підгрупа|підгрупа\s*[1-9]|викладач)\s*[:\-]?\s*$/gi, "")
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
  const lines = `${room || ""}\n${note || ""}`.split("\n");

  for (const line of lines) {
    const urlMatch = line.match(
      /https?:\/\/(?:meet\.google\.com|[a-z0-9.-]*zoom\.us)\/[^\s<>"')|]+/i
    );
    if (!urlMatch) continue;

    const url = urlMatch[0];
    const isMeet = url.toLowerCase().includes("meet.google.com");

    // Шукаємо код доступу ТІЛЬКИ в цьому ж рядку (або в параметрі ?pwd= для Zoom)
    const passMatch = line.match(
      /(?:Код(?:\s+доступ[уа])?|Passcode|Пароль)\s*[:\-]?\s*([A-Za-z0-9_.\-]+)/i
    );

    return {
      url,
      platform: isMeet ? ("meet" as const) : ("zoom" as const),
      passcode: passMatch ? passMatch[1] : null,
    };
  }
  return null;
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
      // Zoom-хеш містить принаймні 16 символів base64
      const hasAuthenticPwdHash = /[?&]pwd=[A-Za-z0-9_.\-]{16,}/i.test(url);

      const passMatch = line.match(
        /(?:Код(?:\s+доступ[уа])?|Passcode|Пароль)\s*:\s*([A-Za-z0-9_.\-]+)/i
      );
      // Якщо в URL стоїть короткий пароль типу ?pwd=dfkr, дістаємо його як явний код
      const shortUrlPwdMatch = url.match(/[?&]pwd=([A-Za-z0-9_.\-]{1,15})(?:&|$)/i);
      let rawPass =
        (passMatch ? passMatch[1] : null) ||
        (shortUrlPwdMatch ? shortUrlPwdMatch[1] : null);

      if (isElectronics && !isMeet && !rawPass) {
        rawPass = "dfkr";
      }

      let label: string | undefined;
      const lowerLine = line.toLowerCase();
      if (lowerLine.includes("токарєв") || lowerLine.includes("токарев")) {
        label = "Токарєва";
      } else if (lowerLine.includes("хочинськ") || lowerLine.includes("хочинск")) {
        label = "Хочинська";
      } else {
        const prefixMatch = line.match(
          /^([А-Яа-яІіЇїЄєa-zA-Z\s.'—–\-]+|\d+\s*підгрупа|підгрупа\s*\d+)\s*[:\-–]\s*https?/i
        );
        if (prefixMatch) {
          const raw = prefixMatch[1].trim();
          if (raw.length >= 3 && raw.length <= 25) {
            label = raw;
          }
        }
      }

      // Якщо мітка не з рядка, перевіряємо викладачів пари
      if (!label && isForeignLang) {
        label = isMeet ? "Токарєва" : "Хочинська";
      }

      results.push({
        url,
        platform: isMeet ? "meet" : "zoom",
        passcode: hasAuthenticPwdHash ? null : rawPass,
        label,
      });
    }
  }

  // Якщо в нотатці чи аудиторії є посилання для Іноземної мови — підписуємо та впорядковуємо
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

  // Якщо електроніка і в нотатці ДІЙСНО є Zoom-посилання без пароля — додаємо пароль dfkr
  if (isElectronics && results.length > 0) {
    for (const r of results) {
      if (r.platform === "zoom" && !r.passcode) {
        r.passcode = "dfkr";
      }
    }
  }

  return results;
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

  const [nowState, setNowState] = useState<{ dateIso: string; minutes: number } | null>(null);
  const [copiedPass, setCopiedPass] = useState<string | null>(null);

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
  const tasks = extractClassroomTasks(lesson.note);
  const meetings = extractOnlineMeetings(lesson.note, lesson.room, lesson.teacher_name, lesson.subject_name);
  const hasMeeting = meetings.length > 0;
  const secondaryItems = useMemo(() => {
    return isTeacherView ? parseLessonGroups(lesson) : parseLessonTeachers(lesson);
  }, [isTeacherView, lesson]);

  const eventBadge = getEventBadge(lesson.event_type, lesson.event_title);

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

  const roomMeta = lesson.room ? getRoomBadgeMeta(lesson.room) : null;

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
          {isLive && (
            <div className="mb-0.5 inline-flex w-fit items-center gap-1.5 rounded-full border border-sys-accent/30 bg-sys-accent/15 px-2 py-0.5 text-[11px] font-semibold text-sys-accent">
              <span className="h-1.5 w-1.5 animate-ping rounded-full bg-sys-accent" />
              <span>Зараз іде • ще {remainingMin} хв</span>
            </div>
          )}

          <div className="flex flex-col">
            <h3 className={`min-w-0 break-words font-bold leading-snug ${lesson.is_cancelled ? "line-through text-sys-text-muted" : "text-sys-text-subject"} ${isDay ? "text-base" : "text-sm"}`}>
              {lesson.subject_name}
            </h3>
            {lesson.event_title && lesson.event_title !== lesson.subject_name && (
              <span className="mt-0.5 text-xs font-semibold text-sys-text-secondary">
                {lesson.event_title}
              </span>
            )}
          </div>

          {(secondaryItems.length > 0 || lesson.room || hasMeeting) && (
            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
              {secondaryItems.length > 0 && (
                <div className="min-w-0 break-words text-left text-sm text-sys-text-secondary">
                  {isTeacherView && (
                    <span className="text-sys-text-muted">
                      {secondaryItems.length > 1 ? "Групи " : "Група "}
                    </span>
                  )}
                  {secondaryItems.map((item, index) => (
                    <span key={`${item.name}-${index}`}>
                      {index > 0 && <span className="text-sys-text-muted"> / </span>}
                      {onQuickJump ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onQuickJump(item.target);
                          }}
                          title={
                            item.target.mode === "teacher"
                              ? `Переглянути розклад викладача ${item.displayName}`
                              : `Переглянути розклад групи ${item.displayName}`
                          }
                          className="font-medium underline-offset-4 transition-colors hover:text-sys-accent hover:underline focus:outline-none focus:text-sys-accent"
                        >
                          {item.displayName}
                        </button>
                      ) : (
                        <span>{item.displayName}</span>
                      )}
                    </span>
                  ))}
                </div>
              )}
              <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
                {hasMeeting && (
                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                    {meetings.map((m, idx) => (
                      <div key={`${m.url}-${idx}`} className="flex flex-wrap items-center justify-end gap-1.5">
                        <a
                          href={m.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          title={
                            m.label
                              ? `${m.label} (${m.platform === "meet" ? "Google Meet" : "Zoom"})`
                              : m.platform === "meet"
                              ? "Google Meet"
                              : "Zoom"
                          }
                          className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 text-[11px] font-bold transition-colors ${
                            m.platform === "meet"
                              ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"
                              : "border-sky-500/40 bg-sky-500/15 text-sky-300 hover:bg-sky-500/25"
                          }`}
                        >
                          <span>{m.platform === "meet" ? "🎥 Meet" : "📹 Zoom"}</span>
                          {m.label && <span className="text-[10px] opacity-80">({m.label})</span>}
                          <span>↗</span>
                        </a>
                        {m.passcode && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void navigator.clipboard.writeText(m.passcode!);
                              setCopiedPass(m.passcode!);
                              setTimeout(() => setCopiedPass(null), 2000);
                            }}
                            title="Натисніть, щоб скопіювати код доступу"
                            className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-300 hover:bg-amber-500/20 active:scale-95"
                          >
                            <span>🔑</span>
                            <span>{copiedPass === m.passcode ? "Скопійовано" : m.passcode}</span>
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {!hasMeeting && lesson.room && roomMeta && (
                  <span className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium ${roomMeta.tone}`}>
                    <span aria-hidden="true" className="text-[11px]">{roomMeta.icon}</span>
                    <span>{formatRoom(lesson.room)}</span>
                  </span>
                )}
              </div>
            </div>
          )}

          {tasks.length > 0 && (
            <div className="mt-1 flex flex-col gap-1">
              {tasks.map((task, idx) => (
                <a
                  key={idx}
                  href={task.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center justify-between gap-2 rounded-lg border border-purple-500/35 bg-purple-500/10 px-2.5 py-1 text-xs font-medium text-purple-200 transition-colors hover:bg-purple-500/20"
                >
                  <span className="truncate">📌 Здача: {task.title}</span>
                  <span className="shrink-0 font-bold text-purple-300">Classroom ↗</span>
                </a>
              ))}
            </div>
          )}

          {lesson.is_cancelled ? (
            <span className="inline-flex w-fit items-center gap-1 rounded border border-rose-500/40 bg-rose-500/15 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-rose-400">
              ❌ Скасовано
            </span>
          ) : eventBadge ? (
            <span className={`inline-flex w-fit items-center gap-1 rounded border px-2 py-0.5 text-xs font-bold uppercase tracking-wider ${eventBadge.badgeClass}`}>
              {eventBadge.label}
            </span>
          ) : lesson.is_replacement ? (
            <span className="inline-flex w-fit items-center gap-1 rounded bg-sys-warning px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-sys-warningText">
              ⚡ Заміна
            </span>
          ) : null}

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
                    className="inline-flex items-center gap-1 rounded-md border border-emerald-500/50 bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-400 shadow-xs transition-colors hover:border-emerald-500 hover:bg-emerald-500/25"
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
                        className={`${ICON_BUTTON} hover:border-sys-accent/60 hover:bg-sys-accent/15 hover:text-sys-accent`}
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
                          className={`${ICON_BUTTON} hover:border-emerald-500/60 hover:bg-emerald-500/15 hover:text-emerald-400`}
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
                          className={`${ICON_BUTTON} hover:border-sky-500/60 hover:bg-sky-500/15 hover:text-sky-400`}
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
                      className={`${ICON_BUTTON} hover:border-rose-500/60 hover:bg-rose-500/15 hover:text-rose-400`}
                    >
                      <CalendarOffIcon />
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {!lesson.is_cancelled && (canEdit || getVisibleUserNote(lesson.note).length > 0) && (
        <LessonNote key={`${lesson.group_id}:${targetDate}:${lesson.lesson_number}:${lesson.subject_id}`} lesson={lesson} date={targetDate} />
      )}

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
