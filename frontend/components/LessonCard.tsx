"use client";

import { useEffect, useMemo, useState } from "react";
import { LessonNote, LessonNoteModal } from "./LessonNote";
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

function SwapIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m7 15 5 5 5-5" />
      <path d="m7 9 5-5 5 5" />
    </svg>
  );
}

function CheckSquareIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 11 12 14 22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}

const UKR_DAY_NAMES: Record<number, string> = {
  1: "Понеділок",
  2: "Вівторок",
  3: "Середа",
  4: "Четвер",
  5: "П'ятниця",
  6: "Субота",
  7: "Неділя",
};

function formatMovedTo(movedToDate?: string | null, movedToLesson?: number | null) {
  if (!movedToDate) return null;
  const parts = movedToDate.split("-").map(Number);
  if (parts.length === 3) {
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    const dow = d.getDay() === 0 ? 7 : d.getDay();
    const dayName = UKR_DAY_NAMES[dow] || "";
    return `Перенесено → ${dayName}, ${movedToLesson || "?"} пара`;
  }
  return `Перенесено → ${movedToDate}`;
}

function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
      <line x1="10" x2="10" y1="11" y2="17" />
      <line x1="14" x2="14" y1="11" y2="17" />
    </svg>
  );
}

function TemplateIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="18" height="18" x="3" y="4" rx="2" ry="2" />
      <line x1="16" x2="16" y1="2" y2="6" />
      <line x1="8" x2="8" y1="2" y2="6" />
      <line x1="3" x2="21" y1="10" y2="10" />
      <path d="M8 14h.01" />
      <path d="M12 14h.01" />
      <path d="M16 14h.01" />
      <path d="M8 18h.01" />
      <path d="M12 18h.01" />
      <path d="M16 18h.01" />
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
  platform: "meet" | "zoom" | "teams" | "link";
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
    if (line.trim().startsWith("[TASK]")) continue;

    const urlMatches = Array.from(
      line.matchAll(/https?:\/\/(?:meet\.google\.com|[a-z0-9.-]*zoom\.us|teams\.microsoft\.com|teams\.live\.com)\/[^\s<>"')|]+/gi)
    );

    for (const match of urlMatches) {
      let url = match[0];
      if (seenUrls.has(url.toLowerCase())) continue;
      seenUrls.add(url.toLowerCase());

      const lowerUrl = url.toLowerCase();
      const isMeet = lowerUrl.includes("meet.google.com");
      const isZoom = lowerUrl.includes("zoom.us");
      const isTeams = lowerUrl.includes("teams.microsoft.com") || lowerUrl.includes("teams.live.com");
      const hasPwdInUrl = /[?&]pwd=[^&\s]+/i.test(url);

      const passMatch = line.match(
        /(?:Код(?:\s+доступ[уа])?|Passcode|Пароль)\s*[:\-]?\s*([A-Za-z0-9_.\-]+)/i
      );
      let rawPass = passMatch ? passMatch[1] : null;

      if (isElectronics && !isMeet && !hasPwdInUrl && !rawPass) {
        rawPass = "dfkr";
      }

      // Якщо це Zoom і в URL ще немає ?pwd=, вшиваємо код прямо в посилання!
      if (isZoom && !hasPwdInUrl && rawPass) {
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

      const platform: MeetingInfo["platform"] = isMeet
        ? "meet"
        : isZoom
        ? "zoom"
        : isTeams
        ? "teams"
        : "link";

      results.push({
        url,
        platform,
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
  hideTimeColumn = false,
  onEdit,
  movingLesson,
  onMoveSelect,
  onCopySelect,
  onCancelDated,
  onRestoreDated,
  onQuickJump,
  isSelectMode = false,
  isSelected = false,
  onToggleSelect,
  onSwapSelect,
  onSelectMultiple,
  isSwapSource = false,
  onOpenPermanentSchedule,
  isTemplateMode = false,
  onDeleteTemplate,
  onRemoveReplacement,
}: {
  lesson: Lesson;
  targetDate: string;
  mode: "today" | "week" | "day";
  scheduleMode: "student" | "teacher" | "admin";
  canEdit: boolean;
  hideTimeColumn?: boolean;
  onEdit?: (lesson: Lesson) => void;
  movingLesson?: Lesson | null;
  onMoveSelect?: (lesson: Lesson | null) => void;
  onCopySelect?: (lesson: Lesson) => void;
  onCancelDated?: (lesson: Lesson, date: string) => void;
  onRestoreDated?: (lesson: Lesson, date: string) => void;
  onRemoveReplacement?: (lesson: Lesson, date: string) => void;
  onQuickJump?: (target: QuickJumpTarget) => void;
  isSelectMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (lesson: Lesson) => void;
  onSwapSelect?: (lesson: Lesson) => void;
  onSelectMultiple?: (lesson: Lesson) => void;
  isSwapSource?: boolean;
  onOpenPermanentSchedule?: (lesson: Lesson) => void;
  isTemplateMode?: boolean;
  onDeleteTemplate?: (lesson: Lesson) => void;
}) {
  const isSelectedForMove = movingLesson?.id === lesson.id;
  const isDay = mode !== "week";
  const isEvent = Boolean(lesson.event_type || lesson.event_id);
  const canEditAction = canEdit && !lesson.is_cancelled;
  const canMove = canEditAction && !!onMoveSelect;
  const [startT, endT] = lesson.time.split("-");

  const [isHwOpen, setIsHwOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [noteModalMode, setNoteModalMode] = useState<"edit" | "history" | null>(null);

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
  const tasks = useMemo(
    () => (isTeacherView ? [] : extractClassroomTasks(lesson.note)),
    [isTeacherView, lesson.note]
  );
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

  const isDualTeachers = !isTeacherView && secondaryItems.length === 2;

  const teacherMeetings = useMemo(() => {
    if (!isDualTeachers || meetings.length === 0) return [null, null];
    const s0 = secondaryItems[0].name.split(/[\s.]+/)[0].toLowerCase();
    const s1 = secondaryItems[1].name.split(/[\s.]+/)[0].toLowerCase();
    const m0 = meetings.find((m) => m.label && (m.label.toLowerCase().includes(s0) || s0.includes(m.label.toLowerCase())));
    const m1 = meetings.find((m) => m.label && (m.label.toLowerCase().includes(s1) || s1.includes(m.label.toLowerCase())));
    return [m0 || null, m1 || null];
  }, [isDualTeachers, secondaryItems, meetings]);

  const row3Meetings = useMemo(() => {
    if (!isDualTeachers) return meetings;
    return meetings.filter((m) => m !== teacherMeetings[0] && m !== teacherMeetings[1]);
  }, [isDualTeachers, meetings, teacherMeetings]);

  const groupedTasks = useMemo(() => {
    if (!isDualTeachers || tasks.length === 0) {
      return [{ teacher: null, items: tasks }];
    }
    const s0 = secondaryItems[0].name.split(/[\s.]+/)[0].toLowerCase();
    const s1 = secondaryItems[1].name.split(/[\s.]+/)[0].toLowerCase();

    const g0: typeof tasks = [];
    const g1: typeof tasks = [];
    const others: typeof tasks = [];

    for (const t of tasks) {
      const teacherStr = (t.teacher || "").toLowerCase();
      if (teacherStr.includes(s0) || s0.includes(teacherStr)) {
        g0.push(t);
      } else if (teacherStr.includes(s1) || s1.includes(teacherStr)) {
        g1.push(t);
      } else {
        others.push(t);
      }
    }

    const res: { teacher: string | null; items: typeof tasks }[] = [];
    if (g0.length > 0) res.push({ teacher: secondaryItems[0].displayName, items: g0 });
    if (g1.length > 0) res.push({ teacher: secondaryItems[1].displayName, items: g1 });
    if (others.length > 0) res.push({ teacher: res.length > 0 ? "Інші завдання" : null, items: others });
    return res.length > 0 ? res : [{ teacher: null, items: tasks }];
  }, [isDualTeachers, secondaryItems, tasks]);

  const eventBadge = useMemo(
    () => getEventBadge(lesson.event_type, lesson.event_title),
    [lesson.event_type, lesson.event_title]
  );

  const stateClass = isSwapSource
    ? "border-amber-400 ring-2 ring-amber-400/80 bg-amber-400/10 shadow-[0_0_15px_rgba(251,191,36,0.2)]"
    : isSelected
      ? "border-sys-accent ring-2 ring-sys-accent/60 bg-sys-accent/10"
      : lesson.is_cancelled
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
      className={`relative flex min-w-0 flex-col rounded-xl border bg-sys-card shadow-sm transition-colors duration-200 ${
        isDay ? "p-3 xl:p-3.5" : "p-2.5"
      } ${stateClass} ${
        !lesson.is_relevant_this_week ? "opacity-60" : isPast ? "opacity-55 hover:opacity-100" : ""
      } ${canMove ? "cursor-grab active:cursor-grabbing" : ""}`}
    >
      <div className="flex items-start gap-2.5 sm:gap-3">
        {/* Left: narrow fixed column (number + start time) */}
        {!hideTimeColumn && (
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
        )}

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
          {isDualTeachers ? (
            <div className="flex flex-col gap-2 text-xs text-sys-text-secondary [overflow-wrap:anywhere]">
              {/* Teacher 0 */}
              <div className="flex flex-col items-start gap-1 min-w-0">
                <div className="font-medium text-sys-text-secondary [overflow-wrap:anywhere]">
                  {onQuickJump ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onQuickJump(secondaryItems[0].target);
                      }}
                      className="text-left font-medium text-sys-text-secondary no-underline underline-offset-2 hover:text-sys-accent hover:underline focus:outline-none"
                    >
                      {secondaryItems[0].displayName}
                    </button>
                  ) : (
                    <span>{secondaryItems[0].displayName}</span>
                  )}
                </div>
                {/* Teacher 0 badge: online link or room */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {teacherMeetings[0] ? (
                    <a
                      href={teacherMeetings[0].url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => {
                        e.stopPropagation();
                        vibrateTap(12);
                      }}
                      className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-bold transition-transform active:scale-[0.98] ${
                        teacherMeetings[0].platform === "meet"
                          ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"
                          : teacherMeetings[0].platform === "zoom"
                          ? "border-sky-500/40 bg-sky-500/15 text-sky-300 hover:bg-sky-500/25"
                          : "border-indigo-500/40 bg-indigo-500/15 text-indigo-300 hover:bg-indigo-500/25"
                      }`}
                    >
                      <span>
                        {teacherMeetings[0].platform === "meet"
                          ? "🎥 Meet"
                          : teacherMeetings[0].platform === "zoom"
                          ? "📹 Zoom"
                          : teacherMeetings[0].platform === "teams"
                          ? "💻 Teams"
                          : "🔗 Посилання"}
                      </span>
                      <span>↗</span>
                    </a>
                  ) : rooms[0] ? (
                    (() => {
                      const meta = getRoomBadgeMeta(rooms[0]);
                      return (
                        <span
                          title={formatRoom(rooms[0])}
                          className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium ${meta.tone}`}
                        >
                          <span aria-hidden="true" className="text-[11px]">{meta.icon}</span>
                          <span>{formatRoom(rooms[0])}</span>
                        </span>
                      );
                    })()
                  ) : null}
                </div>
              </div>

              {/* Teacher 1 */}
              <div className="flex flex-col items-start gap-1 min-w-0">
                <div className="font-medium text-sys-text-secondary [overflow-wrap:anywhere]">
                  {onQuickJump ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onQuickJump(secondaryItems[1].target);
                      }}
                      className="text-left font-medium text-sys-text-secondary no-underline underline-offset-2 hover:text-sys-accent hover:underline focus:outline-none"
                    >
                      {secondaryItems[1].displayName}
                    </button>
                  ) : (
                    <span>{secondaryItems[1].displayName}</span>
                  )}
                </div>
                {/* Teacher 1 badge: online link or room */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {teacherMeetings[1] ? (
                    <a
                      href={teacherMeetings[1].url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => {
                        e.stopPropagation();
                        vibrateTap(12);
                      }}
                      className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-bold transition-transform active:scale-[0.98] ${
                        teacherMeetings[1].platform === "meet"
                          ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"
                          : teacherMeetings[1].platform === "zoom"
                          ? "border-sky-500/40 bg-sky-500/15 text-sky-300 hover:bg-sky-500/25"
                          : "border-indigo-500/40 bg-indigo-500/15 text-indigo-300 hover:bg-indigo-500/25"
                      }`}
                    >
                      <span>
                        {teacherMeetings[1].platform === "meet"
                          ? "🎥 Meet"
                          : teacherMeetings[1].platform === "zoom"
                          ? "📹 Zoom"
                          : teacherMeetings[1].platform === "teams"
                          ? "💻 Teams"
                          : "🔗 Посилання"}
                      </span>
                      <span>↗</span>
                    </a>
                  ) : rooms[1] ? (
                    (() => {
                      const meta = getRoomBadgeMeta(rooms[1]);
                      return (
                        <span
                          title={formatRoom(rooms[1])}
                          className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium ${meta.tone}`}
                        >
                          <span aria-hidden="true" className="text-[11px]">{meta.icon}</span>
                          <span>{formatRoom(rooms[1])}</span>
                        </span>
                      );
                    })()
                  ) : null}
                </div>
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
          ) : null}

          {/* Row 3: Badges on left, actions on right; wraps naturally without overlap */}
          <div
            className="mt-1 flex flex-wrap items-end gap-x-2 gap-y-1.5 pt-0.5 w-full"
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "flex-end",
              gap: "6px 8px",
            }}
          >
            <div
              className="flex flex-wrap items-center gap-1.5 min-w-0 flex-1"
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "6px",
                flex: "1 1 auto",
                minWidth: 0,
              }}
            >
              {/* If single teacher and pair has NO meeting, show room badge */}
              {!isDualTeachers && !hasMeeting && rooms.length > 0 && (
                rooms.map((rm, idx) => {
                  const meta = getRoomBadgeMeta(rm);
                  return (
                    <span
                      key={`${rm}-${idx}`}
                      title={formatRoom(rm)}
                      className={`inline-flex max-w-full [white-space:normal] [overflow-wrap:anywhere] items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium ${meta.tone}`}
                      style={{ maxWidth: "100%", whiteSpace: "normal", overflowWrap: "anywhere", wordBreak: "break-word" }}
                    >
                      <span aria-hidden="true" className="shrink-0 text-[11px]">{meta.icon}</span>
                      <span className="[overflow-wrap:anywhere]">{formatRoom(rm)}</span>
                    </span>
                  );
                })
              )}

              {/* Online meetings (for single teacher or teacher view) */}
              {!isDualTeachers && row3Meetings.map((m, idx) => (
                <a
                  key={`${m.url}-${idx}`}
                  href={m.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => {
                    e.stopPropagation();
                    vibrateTap(12);
                  }}
                  className={`inline-flex max-w-full [white-space:normal] [overflow-wrap:anywhere] items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-bold transition-transform active:scale-[0.98] ${
                    m.platform === "meet"
                      ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"
                      : m.platform === "zoom"
                      ? "border-sky-500/40 bg-sky-500/15 text-sky-300 hover:bg-sky-500/25"
                      : "border-indigo-500/40 bg-indigo-500/15 text-indigo-300 hover:bg-indigo-500/25"
                  }`}
                  style={{ maxWidth: "100%", whiteSpace: "normal", overflowWrap: "anywhere", wordBreak: "break-word" }}
                >
                  <span>
                    {m.platform === "meet"
                      ? "🎥 Meet"
                      : m.platform === "zoom"
                      ? "📹 Zoom"
                      : m.platform === "teams"
                      ? "💻 Teams"
                      : "🔗 Посилання"}
                  </span>
                  <span className="shrink-0">↗</span>
                </a>
              ))}

              {tasks.length > 0 && (
                <button
                  type="button"
                  onClick={toggleHw}
                  aria-expanded={isHwOpen}
                  aria-controls={`hw-list-${lesson.id}-${lesson.lesson_number}`}
                  title={isHwOpen ? "Згорнути завдання" : `${tasks.length} ДЗ — натисніть для перегляду`}
                  className="inline-flex max-w-full [white-space:normal] [overflow-wrap:anywhere] items-center gap-1 rounded-md border border-purple-500/35 bg-purple-500/10 px-2 py-0.5 text-xs font-semibold text-purple-200 hover:bg-purple-500/20 active:scale-[0.98] transition-all duration-100 ease-out focus:outline-none focus:ring-1 focus:ring-purple-400"
                  style={{ maxWidth: "100%", whiteSpace: "normal", overflowWrap: "anywhere", wordBreak: "break-word" }}
                >
                  <span className="shrink-0">📌 {tasks.length} ДЗ</span>
                  <span className={`shrink-0 text-[10px] transition-transform duration-150 motion-reduce:transition-none ${isHwOpen ? "rotate-180" : ""}`}>
                    ▾
                  </span>
                </button>
              )}

              {lesson.is_cancelled ? (
                lesson.moved_to_date ? (
                  <span
                    className="inline-flex max-w-full [white-space:normal] [overflow-wrap:anywhere] items-center gap-1 rounded border border-amber-500/40 bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-bold tracking-wide text-amber-300"
                    style={{ maxWidth: "100%", whiteSpace: "normal", overflowWrap: "anywhere", wordBreak: "break-word" }}
                  >
                    ↪ {formatMovedTo(lesson.moved_to_date, lesson.moved_to_lesson)}
                  </span>
                ) : (
                  <span
                    className="inline-flex max-w-full [white-space:normal] [overflow-wrap:anywhere] items-center gap-1 rounded border border-rose-500/40 bg-rose-500/15 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-rose-400"
                    style={{ maxWidth: "100%", whiteSpace: "normal", overflowWrap: "anywhere", wordBreak: "break-word" }}
                  >
                    ❌ Скасовано
                  </span>
                )
              ) : eventBadge ? (
                <span
                  className={`inline-flex max-w-full [white-space:normal] [overflow-wrap:anywhere] items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wider ${eventBadge.badgeClass}`}
                  style={{ maxWidth: "100%", whiteSpace: "normal", overflowWrap: "anywhere", wordBreak: "break-word" }}
                >
                  {eventBadge.label}
                </span>
              ) : lesson.is_replacement ? (
                <span
                  className="inline-flex max-w-full [white-space:normal] [overflow-wrap:anywhere] items-center gap-1 rounded bg-sys-warning px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-sys-warningText"
                  style={{ maxWidth: "100%", whiteSpace: "normal", overflowWrap: "anywhere", wordBreak: "break-word" }}
                >
                  ⚡ Заміна
                </span>
              ) : null}
            </div>

            {/* Actions for canEdit pinned to bottom-right (wraps to next line when narrow) */}
            {canEdit && (
              <div
                className="relative flex items-center gap-1 shrink-0 whitespace-nowrap ml-auto"
                style={{
                  flex: "0 0 auto",
                  marginLeft: "auto",
                  whiteSpace: "nowrap",
                }}
              >
                {lesson.is_cancelled ? (
                  onRestoreDated && lesson.group_id && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRestoreDated(lesson, targetDate);
                      }}
                      title={lesson.moved_to_date ? "Скасувати перенесення та відновити пару" : `Відновити пару на ${targetDate}`}
                      className="inline-flex min-h-[44px] min-w-[44px] sm:min-h-[32px] items-center justify-center rounded-md border border-emerald-500/50 bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-400 hover:bg-emerald-500/25 active:scale-[0.98] transition-colors whitespace-nowrap"
                      style={{ whiteSpace: "nowrap" }}
                    >
                      Відновити
                    </button>
                  )
                ) : (
                  <>
                    {canEditAction && (
                      <button
                        type="button"
                        title={isEvent ? "Редагувати подію сесії" : lesson.is_replacement ? "Редагувати заміну" : "Редагувати пару"}
                        aria-label={`Редагувати ${lesson.subject_name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onEdit?.(lesson);
                        }}
                        className="w-7 h-7 flex items-center justify-center rounded-md border border-sys-border/60 bg-sys-card text-sys-text-secondary hover:border-sys-accent/60 hover:bg-sys-accent/15 hover:text-sys-accent active:scale-[0.98] transition-colors"
                      >
                        <EditIcon />
                      </button>
                    )}

                    <button
                      type="button"
                      title="Більше дій"
                      aria-label="Більше дій для пари"
                      aria-expanded={moreOpen}
                      onClick={(e) => {
                        e.stopPropagation();
                        setMoreOpen(!moreOpen);
                      }}
                      className="w-7 h-7 flex items-center justify-center rounded-md border border-sys-border/60 bg-sys-card text-sys-text-secondary hover:text-sys-text-primary hover:bg-white/5 active:scale-[0.98] transition-colors font-bold text-sm tracking-widest leading-none"
                    >
                      ⋯
                    </button>

                    {moreOpen && (
                      <>
                        <div
                          className="fixed inset-0 z-40"
                          onClick={(e) => {
                            e.stopPropagation();
                            setMoreOpen(false);
                          }}
                        />
                        <div
                          onClick={(e) => e.stopPropagation()}
                          className="absolute right-0 bottom-full mb-1 z-50 min-w-[190px] rounded-xl border border-sys-border bg-sys-card shadow-2xl p-1 text-xs space-y-0.5 animate-in fade-in zoom-in-95 duration-150"
                        >
                          {isTemplateMode ? (
                            <>
                              {onCopySelect && !movingLesson && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setMoreOpen(false);
                                    onCopySelect(lesson);
                                  }}
                                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-sys-text-primary hover:bg-sky-500/10 hover:text-sky-400 transition-colors"
                                >
                                  <CopyIcon />
                                  <span>Копіювати</span>
                                </button>
                              )}

                              {onMoveSelect && !movingLesson && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setMoreOpen(false);
                                    onMoveSelect(lesson);
                                  }}
                                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-sys-text-primary hover:bg-emerald-500/10 hover:text-emerald-400 transition-colors"
                                >
                                  <MoveIcon />
                                  <span>Перемістити</span>
                                </button>
                              )}

                              {onSwapSelect && !movingLesson && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setMoreOpen(false);
                                    onSwapSelect(lesson);
                                  }}
                                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-sys-text-primary hover:bg-amber-500/10 hover:text-amber-400 transition-colors"
                                >
                                  <SwapIcon />
                                  <span>Поміняти місцями</span>
                                </button>
                              )}

                              {onDeleteTemplate && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setMoreOpen(false);
                                    if (
                                      typeof window !== "undefined" &&
                                      window.confirm(`Видалити пару «${lesson.subject_name}» з постійного розкладу?`)
                                    ) {
                                      onDeleteTemplate(lesson);
                                    }
                                  }}
                                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-rose-400 hover:bg-rose-500/10 transition-colors"
                                >
                                  <TrashIcon />
                                  <span>Видалити</span>
                                </button>
                              )}
                            </>
                          ) : (
                            <>
                              {canMove && !movingLesson && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setMoreOpen(false);
                                    onMoveSelect?.(lesson);
                                  }}
                                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-sys-text-primary hover:bg-emerald-500/10 hover:text-emerald-400 transition-colors"
                                >
                                  <MoveIcon />
                                  <span>Перенести</span>
                                </button>
                              )}

                              {onSwapSelect && !movingLesson && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setMoreOpen(false);
                                    onSwapSelect(lesson);
                                  }}
                                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-sys-text-primary hover:bg-amber-500/10 hover:text-amber-400 transition-colors"
                                >
                                  <SwapIcon />
                                  <span>Поміняти місцями</span>
                                </button>
                              )}

                              {lesson.is_replacement ? (
                                onRemoveReplacement && lesson.group_id && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setMoreOpen(false);
                                      if (
                                        typeof window !== "undefined" &&
                                        window.confirm(`Прибрати заміну «${lesson.subject_name}» на ${targetDate}?`)
                                      ) {
                                        onRemoveReplacement(lesson, targetDate);
                                      }
                                    }}
                                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-amber-400 hover:bg-amber-500/10 transition-colors"
                                  >
                                    <span>↩</span>
                                    <span>Прибрати заміну</span>
                                  </button>
                                )
                              ) : (
                                onCancelDated && lesson.group_id && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setMoreOpen(false);
                                      if (
                                        typeof window !== "undefined" &&
                                        window.confirm(`Скасувати пару «${lesson.subject_name}» на ${targetDate}?`)
                                      ) {
                                        onCancelDated(lesson, targetDate);
                                      }
                                    }}
                                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-rose-400 hover:bg-rose-500/10 transition-colors"
                                  >
                                    <CalendarOffIcon />
                                    <span>Скасувати</span>
                                  </button>
                                )
                              )}

                              {onOpenPermanentSchedule && (!lesson.is_replacement || lesson.has_template !== false) && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setMoreOpen(false);
                                    onOpenPermanentSchedule(lesson);
                                  }}
                                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-sys-accent hover:bg-sys-accent/10 transition-colors"
                                >
                                  <TemplateIcon />
                                  <span>Змінити в постійному розкладі</span>
                                </button>
                              )}

                              {lesson.group_id && (
                                <>
                                  <div className="border-t border-sys-border/40 my-1" />
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setMoreOpen(false);
                                      setNoteModalMode("edit");
                                    }}
                                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-sys-text-secondary hover:text-sys-accent hover:bg-sys-accent/10 transition-colors"
                                  >
                                    <span>💬</span>
                                    <span>{visibleNoteText ? "Редагувати примітку" : "+ Примітка"}</span>
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => {
                                      setMoreOpen(false);
                                      setNoteModalMode("history");
                                    }}
                                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-sys-text-secondary hover:text-sys-text-primary hover:bg-white/5 transition-colors"
                                  >
                                    <span>📜</span>
                                    <span>Історія примітки</span>
                                  </button>
                                </>
                              )}
                            </>
                          )}
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
            )}
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
                <div className="flex flex-col gap-2 pt-1 border-t border-purple-500/20">
                  {groupedTasks.map((group, gIdx) => (
                    <div key={gIdx} className="flex flex-col gap-1.5">
                      {group.teacher && (
                        <span className="text-[11px] font-bold text-purple-200/90 pt-0.5">
                          {group.teacher}:
                        </span>
                      )}
                      {group.items.map((task, idx) => (
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
                            {task.teacher && !group.teacher && (
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
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* User note (compact text under badges) */}
          {visibleNoteText && (
            <p className="mt-1 text-xs text-sys-text-secondary/90 [overflow-wrap:anywhere] italic border-t border-sys-border/20 pt-1">
              💬 {visibleNoteText}
            </p>
          )}

          {noteModalMode && (
            <LessonNoteModal
              lesson={lesson}
              date={targetDate}
              initialMode={noteModalMode}
              onClose={() => setNoteModalMode(null)}
            />
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
