"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { LessonNote } from "./LessonNote";
const LessonNoteModal = dynamic(() => import("./LessonNote").then((m) => m.LessonNoteModal), { ssr: false });
import { EditIcon, MoveIcon } from "./LessonIcons";
import { Lesson } from "../lib/api";
import { formatRoom, formatRoomsList, extractOnlineMeetings, MeetingInfo } from "../lib/format";
import { extractClassroomTaskKey, isOwnTask, useClassroomSubmissions } from "../lib/useClassroomSubmissions";
import { useUserSettings } from "../lib/useUserSettings";
import { QuickJumpTarget, parseLessonTeachers, parseLessonGroups } from "../lib/quickJump";
import { DEFAULT_LESSON_TIMES } from "../lib/constants/lessons";

export type { QuickJumpTarget, MeetingInfo };
export { extractOnlineMeetings };

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
        label: "Подія",
        title: eventTitle || "Подія",
        badgeClass: "border-sky-500/40 bg-sky-500/15 text-sky-300",
        cardClass: "border-sky-500/40 ring-1 ring-sky-500/40 bg-gradient-to-br from-sky-950/20 via-sys-card to-sys-card",
      };
  }
}

export const UKR_MONTHS_SHORT = [
  "січ.", "лют.", "бер.", "квіт.", "трав.", "черв.",
  "лип.", "серп.", "вер.", "жовт.", "лист.", "груд."
];

export function pluralDays(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return "днів";
  if (mod10 === 1) return "день";
  if (mod10 >= 2 && mod10 <= 4) return "дні";
  return "днів";
}

export function getTaskStatusText(
  deadline: TaskDeadline,
  isLinked: boolean
): string {
  if (deadline.isOverdue) {
    const daysStr = `${deadline.overdueDays} ${pluralDays(deadline.overdueDays)}`;
    if (isLinked) {
      return deadline.formattedDate
        ? `${deadline.formattedDate} · прострочено ${daysStr}`
        : `прострочено ${daysStr}`;
    }
    return deadline.formattedDate
      ? `${deadline.formattedDate} · термін минув ${daysStr} тому`
      : `термін минув ${daysStr} тому`;
  }
  return deadline.statusText;
}

export interface TaskDeadline {
  day: number | null;
  month: number | null;
  year: number | null;
  date: Date | null;
  formattedDate: string; // e.g. "15 жовт."
  isOverdue: boolean;
  overdueDays: number;
  isUrgent: boolean; // within 48h
  statusText: string; // e.g. "15 жовт. · прострочено 4 дні" or "до 15 жовт."
  badgeTone: "overdue" | "urgent" | "normal";
}

export interface ClassroomTaskItem {
  title?: string;
  teacher?: string | null;
  label: string;
  url: string;
  deadline: TaskDeadline;
}

export function parseTaskDeadline(labelOrText: string): TaskDeadline {
  const match = labelOrText.match(/до\s+(\d{1,2})\.(\d{1,2})/i);
  if (!match) {
    return {
      day: null,
      month: null,
      year: null,
      date: null,
      formattedDate: "",
      isOverdue: false,
      overdueDays: 0,
      isUrgent: false,
      statusText: "",
      badgeTone: "normal",
    };
  }

  const day = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);

  const now = new Date();
  const kyivNowStr = KYIV_DATE_FMT.format(now);
  const [nowYear, nowMonth, nowDay] = kyivNowStr.split("-").map(Number);

  let year = nowYear;
  if (month - nowMonth > 6) year -= 1;
  else if (nowMonth - month > 6) year += 1;

  const targetDate = new Date(year, month - 1, day);
  const todayDate = new Date(nowYear, nowMonth - 1, nowDay);

  const diffMs = targetDate.getTime() - todayDate.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  const monthName = UKR_MONTHS_SHORT[month - 1] || "";
  const formattedDate = `${day} ${monthName}`;

  if (diffDays < 0) {
    const overdueDays = Math.abs(diffDays);
    return {
      day,
      month,
      year,
      date: targetDate,
      formattedDate,
      isOverdue: true,
      overdueDays,
      isUrgent: false,
      statusText: `${formattedDate} · прострочено ${overdueDays} ${pluralDays(overdueDays)}`,
      badgeTone: "overdue",
    };
  }

  if (diffDays === 0) {
    return {
      day,
      month,
      year,
      date: targetDate,
      formattedDate,
      isOverdue: false,
      overdueDays: 0,
      isUrgent: true,
      statusText: "Сьогодні",
      badgeTone: "urgent",
    };
  }

  if (diffDays === 1) {
    return {
      day,
      month,
      year,
      date: targetDate,
      formattedDate,
      isOverdue: false,
      overdueDays: 0,
      isUrgent: true,
      statusText: "Завтра",
      badgeTone: "urgent",
    };
  }

  if (diffDays === 2) {
    return {
      day,
      month,
      year,
      date: targetDate,
      formattedDate,
      isOverdue: false,
      overdueDays: 0,
      isUrgent: true,
      statusText: `до ${formattedDate}`,
      badgeTone: "urgent",
    };
  }

  return {
    day,
    month,
    year,
    date: targetDate,
    formattedDate,
    isOverdue: false,
    overdueDays: 0,
    isUrgent: false,
    statusText: `до ${formattedDate}`,
    badgeTone: "normal",
  };
}

export function formatTaskCount(n: number): string {
  const last2 = n % 100;
  const last = n % 10;
  if (last2 >= 11 && last2 <= 19) return `${n} завдань`;
  if (last === 1) return `${n} завдання`;
  if (last >= 2 && last <= 4) return `${n} завдання`;
  return `${n} завдань`;
}

export function getTaskDeadlineTextColor(badgeTone: "overdue" | "urgent" | "normal", isLinked: boolean): string {
  if (badgeTone === "overdue") {
    return isLinked ? "text-rose-600 dark:text-rose-400 font-medium" : "text-sys-text-muted";
  }
  if (badgeTone === "urgent") {
    return "text-amber-700 dark:text-amber-400 font-medium";
  }
  return "text-purple-700 dark:text-purple-300";
}

export function getTaskDeadlineDotColor(badgeTone: "overdue" | "urgent" | "normal", isLinked: boolean): string {
  if (badgeTone === "overdue") {
    return isLinked ? "bg-rose-500" : "bg-slate-400 dark:bg-zinc-500";
  }
  if (badgeTone === "urgent") {
    return "bg-amber-500";
  }
  return "bg-purple-500";
}

export function sortTasksByDeadline<T extends { deadline: TaskDeadline; state?: string }>(taskList: T[]): T[] {
  return [...taskList].sort((a, b) => {
    // Turned in / Returned at bottom
    const isDoneA = a.state === "TURNED_IN" || a.state === "RETURNED";
    const isDoneB = b.state === "TURNED_IN" || b.state === "RETURNED";
    if (isDoneA && !isDoneB) return 1;
    if (!isDoneA && isDoneB) return -1;

    // Overdue first
    if (a.deadline.isOverdue && !b.deadline.isOverdue) return -1;
    if (!a.deadline.isOverdue && b.deadline.isOverdue) return 1;

    // Both overdue: most overdue first
    if (a.deadline.isOverdue && b.deadline.isOverdue) {
      const timeA = a.deadline.date ? a.deadline.date.getTime() : 0;
      const timeB = b.deadline.date ? b.deadline.date.getTime() : 0;
      return timeA - timeB;
    }

    // Dated tasks before undated tasks (13.3)
    const hasDateA = Boolean(a.deadline.date);
    const hasDateB = Boolean(b.deadline.date);
    if (hasDateA && !hasDateB) return -1;
    if (!hasDateA && hasDateB) return 1;

    if (hasDateA && hasDateB) {
      const timeA = a.deadline.date ? a.deadline.date.getTime() : Infinity;
      const timeB = b.deadline.date ? b.deadline.date.getTime() : Infinity;
      return timeA - timeB;
    }

    return 0;
  });
}

export function hasAllTasksCompleted(note?: string | null): boolean {
  if (!note) return false;
  return note.includes("[TASKS_COMPLETED]");
}

let _taskMetaMapCache: Map<string, { title?: string; teacher?: string }> | null = null;
let _taskMetaCacheListenerRegistered = false;
const _classroomTasksCache = new Map<string, ClassroomTaskItem[]>();
const MAX_CLASSROOM_TASKS_CACHE = 250;

function ensureTaskMetaCacheListener() {
  if (_taskMetaCacheListenerRegistered || typeof window === "undefined") return;
  _taskMetaCacheListenerRegistered = true;
  const invalidate = () => {
    _taskMetaMapCache = null;
    _classroomTasksCache.clear();
  };
  window.addEventListener("classroom-synced", invalidate);
  window.addEventListener("storage", invalidate);
}

function findFullTaskMetaByUrl(url: string): { title?: string; teacher?: string } | null {
  if (typeof window === "undefined" || !url) return null;
  ensureTaskMetaCacheListener();
  if (!_taskMetaMapCache) {
    const map = new Map<string, { title?: string; teacher?: string }>();
    try {
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (!k || !k.startsWith("schedule:classroom_tasks:")) continue;
        const raw = window.localStorage.getItem(k);
        if (!raw) continue;
        const list = JSON.parse(raw);
        if (!Array.isArray(list)) continue;
        for (const t of list) {
          const itemUrl = t?.url || t?.alternate_link;
          if (typeof itemUrl === "string" && itemUrl) {
            map.set(itemUrl, {
              title: typeof t.title === "string" ? t.title.replace(/\s+/g, " ").trim() : undefined,
              teacher: typeof t.teacher === "string" ? t.teacher.trim() : undefined,
            });
          }
        }
      }
    } catch {}
    _taskMetaMapCache = map;
  }
  return _taskMetaMapCache.get(url) ?? null;
}

type KyivNowSnapshot = { dateIso: string; minutes: number };
let _sharedKyivNow: KyivNowSnapshot | null = null;
let _sharedKyivTimer: ReturnType<typeof setInterval> | null = null;
const _kyivNowSubscribers = new Set<(now: KyivNowSnapshot) => void>();

function subscribeKyivNow(cb: (now: KyivNowSnapshot) => void) {
  _kyivNowSubscribers.add(cb);
  if (_kyivNowSubscribers.size === 1 && typeof window !== "undefined") {
    _sharedKyivNow = getKyivNow();
    _sharedKyivTimer = setInterval(() => {
      const next = getKyivNow();
      if (
        !_sharedKyivNow ||
        _sharedKyivNow.minutes !== next.minutes ||
        _sharedKyivNow.dateIso !== next.dateIso
      ) {
        _sharedKyivNow = next;
        _kyivNowSubscribers.forEach((sub) => sub(next));
      }
    }, 30_000);
  }
  return () => {
    _kyivNowSubscribers.delete(cb);
    if (_kyivNowSubscribers.size === 0 && _sharedKyivTimer) {
      clearInterval(_sharedKyivTimer);
      _sharedKyivTimer = null;
    }
  };
}

export function extractClassroomTasks(note?: string | null): ClassroomTaskItem[] {
  if (!note) return [];
  ensureTaskMetaCacheListener();
  const cached = _classroomTasksCache.get(note);
  if (cached) return cached;

  const rawLines = note.split("\n");
  const normalizedLines: string[] = [];

  for (let i = 0; i < rawLines.length; i++) {
    const cur = rawLines[i].trim();
    if (!cur) continue;
    if (cur.startsWith("[TASK]") && !cur.includes("|") && i + 1 < rawLines.length) {
      const next = rawLines[i + 1].trim();
      if (next.includes("|") && /https?:\/\//i.test(next)) {
        normalizedLines.push(`${cur} ${next}`);
        i++;
        continue;
      }
    }
    normalizedLines.push(cur);
  }

  const tasks: ClassroomTaskItem[] = [];
  for (const line of normalizedLines) {
    const isTaskLine =
      line.startsWith("[TASK]") ||
      (/\|\s*https?:\/\/classroom\.google\.com\//i.test(line));
    if (isTaskLine) {
      const raw = line.replace(/^\[TASK\]\s*/i, "").trim();
      const pipeIdx = raw.lastIndexOf("|");
      if (pipeIdx === -1) continue;
      const leftPart = raw.slice(0, pipeIdx).trim();
      const urlPart = raw.slice(pipeIdx + 1).trim();
      if (!leftPart || !urlPart || !urlPart.startsWith("http")) continue;

      let teacher: string | null = null;
      let rest = leftPart;

      const badgeMatch = leftPart.match(/^\[([^\]]+)\]\s*(.*)$/);
      if (badgeMatch) {
        teacher = badgeMatch[1].trim();
        rest = badgeMatch[2].trim();
      }

      // Приводимо до стандарту "до DD.MM" або ""
      const dueMatch = rest.match(/\(до\s+\d{1,2}\.\d{1,2}\)/i);
      const label = dueMatch ? dueMatch[0].replace(/[()]/g, "").trim() : "";
      let title = rest.replace(/\(до\s+\d{1,2}\.\d{1,2}\)/i, "").trim() || "Завдання";

      // Якщо рядок був розірваний (без префікса [TASK]), відновлюємо повну назву та викладача з кешу завдань
      if (!line.startsWith("[TASK]")) {
        const meta = findFullTaskMetaByUrl(urlPart);
        if (meta?.title) title = meta.title;
        if (!teacher && meta?.teacher) teacher = meta.teacher;
      }

      const deadline = parseTaskDeadline(label);

      tasks.push({ title, teacher, label, url: urlPart, deadline });
    }
  }

  if (_classroomTasksCache.size >= MAX_CLASSROOM_TASKS_CACHE) {
    _classroomTasksCache.clear();
  }
  _classroomTasksCache.set(note, tasks);

  return tasks;
}

export function getVisibleUserNote(note?: string | null): string {
  if (!note) return "";
  return note
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("[TASK")) return "";
      if (trimmed.includes("🔒") || trimmed.includes("[🔒")) return "";
      if (/https?:\/\/classroom\.google\.com\//i.test(trimmed)) return "";
      // ВАЖЛИВО: без \b перед кирилицею, бо в JS \b працює лише для латиниці!
      const cleaned = line
        .replace(/\[🔒[^\]]*\]/gi, "")
        .replace(/https?:\/\/(?:meet\.google\.com|[a-z0-9.-]*zoom\.us)\/[^\s|]+/gi, "")
        .replace(/(?:Ідентифікатор(?:\s+конференції)?|Meeting\s*ID|ID)\s*[:\-]?\s*[\d\s\-]+/gi, "")
        .replace(/(?:Код(?:\s+доступ[уа])?|Passcode|Пароль)\s*[:\-]?\s*[A-Za-zА-Яа-яІіЇїЄєҐґ0-9_.\-]+/gi, "")
        .replace(/^(?:Токарєв[а-яА-ЯіїєґІЇЄҐ.]*|Хочинськ[а-яА-ЯіїєґІЇЄҐ.]*|Токарев[а-яА-Я.]*|Хочинск[а-яА-Я.]*|[1-9]\s*підгрупа|підгрупа\s*[1-9]|викладач)\s*[:\-]?\s*$/gi, "")
        .replace(/^(?:Zoom|Meet|Google Meet|Підключитися|Приєднатися|Конференція)(?:\s+Zoom|\s+Meet)?\s*[:\-]?$/gi, "")
        .replace(/^[-—_|~*=]{1,5}$/g, "")
        .replace(/\|/g, " ")
        .trim();
      if (cleaned.includes("🔒")) return "";
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

function vibrateTap(ms = 10) {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    try { navigator.vibrate(ms); } catch {}
  }
}

function getMeetingBtnStyle(platform?: string | null, isLiveOrSoon?: boolean, size: "normal" | "compact" | "tiny" = "normal") {
  if (isLiveOrSoon) {
    if (size === "compact" || size === "tiny") {
      return "bg-emerald-600 text-white border-emerald-500 shadow-xs hover:bg-emerald-500";
    }
    return "bg-emerald-600 text-white border-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.35)] hover:bg-emerald-500 animate-pulse";
  }
  if (platform === "zoom") {
    return "border-sky-400/60 dark:border-sky-500/50 bg-sky-100/80 dark:bg-sky-500/20 text-sky-900 dark:text-sky-200 shadow-xs hover:border-sky-500 dark:hover:border-sky-400 hover:text-sky-950 dark:hover:text-sky-100 hover:bg-sky-200/90 dark:hover:bg-sky-500/30";
  }
  if (platform === "meet") {
    return "border-emerald-400/60 dark:border-emerald-500/50 bg-emerald-100/80 dark:bg-emerald-500/20 text-emerald-900 dark:text-emerald-200 shadow-xs hover:border-emerald-500 dark:hover:border-emerald-400 hover:text-emerald-950 dark:hover:text-emerald-100 hover:bg-emerald-200/90 dark:hover:bg-emerald-500/30";
  }
  return "border-indigo-400/60 dark:border-indigo-500/50 bg-indigo-100/80 dark:bg-indigo-500/20 text-indigo-900 dark:text-indigo-200 shadow-xs hover:border-indigo-500 dark:hover:border-indigo-400 hover:text-indigo-950 dark:hover:text-indigo-100 hover:bg-indigo-200/90 dark:hover:bg-indigo-500/30";
}

function MeetingPlatformIcon({
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

function LockedMeetingBadge({
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
      className={`inline-flex shrink-0 items-center border border-amber-500/40 dark:border-amber-500/30 bg-amber-500/15 dark:bg-amber-500/10 text-amber-800 dark:text-amber-200 font-bold whitespace-nowrap hover:bg-amber-500/25 dark:hover:bg-amber-500/20 active:scale-95 transition-all shadow-xs cursor-pointer ${sizeClasses}`}
    >
      <span className="text-[12px]">🔒</span>
      <span>{label}</span>
    </button>
  );
}

export const LessonCard = memo(function LessonCard({
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
  learningMode = null,
  currentTeacherId = null,
  currentTeacherName = null,
}: {
  lesson: Lesson;
  learningMode?: "offline" | "online" | null;
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
  currentTeacherId?: number | null;
  currentTeacherName?: string | null;
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
  const { settings, updateSetting } = useUserSettings();
  const showHw = settings.showHomeworkBadges;
  const selectedSubgroup = settings.defaultSubgroup;

  const toggleHw = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    vibrateTap(10);
    setIsHwOpen((prev) => !prev);
  };

  const [nowState, setNowState] = useState<KyivNowSnapshot | null>(() => _sharedKyivNow);

  useEffect(() => {
    if (!_sharedKyivNow) {
      _sharedKyivNow = getKyivNow();
    }
    setNowState(_sharedKyivNow);
    return subscribeKyivNow(setNowState);
  }, []);

  const { isLinked, isLinkedToGroup, submissions, personalTeachers, personalSubgroup } = useClassroomSubmissions();

  const isTeacherView = scheduleMode === "teacher";
  const hasGroupAccess = useMemo(() => {
    if (isTeacherView || canEdit || scheduleMode === "admin") return true;
    if (!lesson.group_id) return true;
    return isLinkedToGroup(lesson.group_id);
  }, [isTeacherView, canEdit, scheduleMode, lesson.group_id, isLinkedToGroup]);

  const handleLockedMeetingClick = useCallback((e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    vibrateTap(12);
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("prompt-classroom-link", {
          detail: {
            groupId: lesson.group_id,
            message: "Для переходу на онлайн-дзвінок необхідно прив'язати студентський Google Classroom цієї групи.",
          },
        })
      );
    }
  }, [lesson.group_id]);

  const hasMultipleTeachers = Boolean(
    lesson.second_teacher_id ||
    (lesson.teacher_name && /[,/]/.test(lesson.teacher_name)) ||
    (lesson.teacher_room && lesson.second_teacher_room)
  );

  const activeTeacherIdx = useMemo(() => {
    if (!isTeacherView || !hasMultipleTeachers) return null;
    if (currentTeacherId != null) {
      if (lesson.second_teacher_id && lesson.second_teacher_id === currentTeacherId) return 1;
      if (lesson.teacher_id && lesson.teacher_id === currentTeacherId) return 0;
    }
    if (currentTeacherName && lesson.teacher_name) {
      const parts = lesson.teacher_name.split(/\s*[,/]\s*/).map((p) => p.trim().toLowerCase());
      const curLastName = currentTeacherName.trim().toLowerCase().split(/[\s.]+/)[0];
      if (parts[1] && (parts[1].includes(curLastName) || curLastName.includes(parts[1].split(/[\s.]+/)[0]))) return 1;
      if (parts[0] && (parts[0].includes(curLastName) || curLastName.includes(parts[0].split(/[\s.]+/)[0]))) return 0;
    }
    return 0;
  }, [isTeacherView, hasMultipleTeachers, currentTeacherId, lesson.second_teacher_id, lesson.teacher_id, currentTeacherName, lesson.teacher_name]);

  const secondaryItems = useMemo(() => {
    if (isTeacherView) {
      const groups = parseLessonGroups(lesson);
      if (hasMultipleTeachers && activeTeacherIdx !== null) {
        return groups.map((g) => ({
          ...g,
          displayName: `${g.displayName} · ${activeTeacherIdx + 1} підгр.`,
        }));
      }
      return groups;
    }
    return parseLessonTeachers(lesson);
  }, [isTeacherView, lesson.group_id, lesson.group_name, lesson.teacher_id, lesson.second_teacher_id, lesson.teacher_name, hasMultipleTeachers, activeTeacherIdx]);

  const isDualTeachers = !isTeacherView && secondaryItems.length === 2;
  const isDualTeachersOrSplit = isDualTeachers || (isTeacherView && hasMultipleTeachers);

  const effectiveSubgroup = useMemo(() => {
    if (selectedSubgroup === 1 || selectedSubgroup === 2) {
      return selectedSubgroup;
    }
    if (!isDualTeachers) return null;
    if (!isLinked) return null;
    if (personalSubgroup === 1 || personalSubgroup === 2) return personalSubgroup;

    const s0 = secondaryItems[0]?.name ? secondaryItems[0].name.split(/[\s.]+/)[0].toLowerCase() : "";
    const s1 = secondaryItems[1]?.name ? secondaryItems[1].name.split(/[\s.]+/)[0].toLowerCase() : "";

    const matches0 = s0 ? personalTeachers.some(
      (pt: string) => pt.toLowerCase().includes(s0) || s0.includes(pt.toLowerCase())
    ) : false;
    const matches1 = s1 ? personalTeachers.some(
      (pt: string) => pt.toLowerCase().includes(s1) || s1.includes(pt.toLowerCase())
    ) : false;

    if (matches0 && !matches1) return 1;
    if (matches1 && !matches0) return 2;
    return null;
  }, [selectedSubgroup, isDualTeachers, isLinked, personalSubgroup, secondaryItems, personalTeachers]);

  const handleSubgroupToggle = (subIdx: number) => {
    const nextVal = effectiveSubgroup === subIdx ? (subIdx === 1 ? 2 : 1) : subIdx;
    updateSetting("defaultSubgroup", nextVal);
  };

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

  const isUpcomingSoon = Boolean(
    isTodayTarget &&
      startMin !== null &&
      nowState &&
      nowState.minutes >= startMin - 15 &&
      nowState.minutes < startMin
  );
  const isMeetingLiveOrSoon = isLive || isUpcomingSoon;

  const progressPercent =
    isLive && startMin !== null && endMin !== null && nowState
      ? Math.min(100, Math.max(0, Math.round(((nowState.minutes - startMin) / (endMin - startMin)) * 100)))
      : 0;

  const remainingMin =
    isLive && endMin !== null && nowState ? Math.max(1, endMin - nowState.minutes) : 0;

  const rawTasks = useMemo(
    () => (isTeacherView || canEdit || scheduleMode === "admin" || !hasGroupAccess ? [] : extractClassroomTasks(lesson.note)),
    [isTeacherView, canEdit, scheduleMode, hasGroupAccess, lesson.note]
  );
  // Завдання іншої підгрупи та завдання, які здано, не показуються ТІЛЬКИ у користувача, який прив'язав пошту.
  // Завдання іншої підгрупи та завдання, які здано, фільтруються відповідно до обраної підгрупи
  const tasks = useMemo(() => {
    const sorted = sortTasksByDeadline(rawTasks);
    return sorted.filter((t) => {
      if (!isOwnTask(isLinked, submissions, t.url, t.teacher, personalTeachers, t.title, effectiveSubgroup)) {
        return false;
      }
      const key = extractClassroomTaskKey(t.url);
      const sub = submissions[t.url] || (key ? submissions[key] : null);
      return !(isLinked && sub && (sub.state === "TURNED_IN" || sub.state === "RETURNED"));
    });
  }, [rawTasks, isLinked, submissions, personalTeachers, effectiveSubgroup]);

  const nearestDated = useMemo(() => {
    return tasks.find((t) => t.deadline.formattedDate || (t.deadline.day && t.deadline.month)) || null;
  }, [tasks]);
  const highlightTask = nearestDated || tasks[0] || null;
  const meetings = useMemo(
    () => extractOnlineMeetings(lesson.note, lesson.room, lesson.teacher_name, lesson.subject_name),
    [lesson.note, lesson.room, lesson.teacher_name, lesson.subject_name]
  );
  const visibleNoteText = useMemo(() => getVisibleUserNote(lesson.note), [lesson.note]);
  const hasMeeting = meetings.length > 0;
  const rooms = useMemo(() => {
    if (!lesson.room) return [];
    if (learningMode === "online" && meetings.length > 0) return [];
    return lesson.room
      .split(/\s*[,/;]\s*/)
      .map((r) => r.trim())
      .filter(Boolean);
  }, [lesson.room, learningMode, meetings.length]);

  const teacherMeetings = useMemo(() => {
    if (!isDualTeachersOrSplit || meetings.length === 0) return [null, null];
    const teacherNames = isTeacherView
      ? (lesson.teacher_name ? lesson.teacher_name.split(/\s*[,/]\s*/).map((s) => s.trim()) : [])
      : [secondaryItems[0]?.name || "", secondaryItems[1]?.name || ""];
    const s0 = (teacherNames[0] || "").split(/[\s.]+/)[0].toLowerCase();
    const s1 = (teacherNames[1] || "").split(/[\s.]+/)[0].toLowerCase();

    const matchesTeacher = (m: MeetingInfo, s: string, subNum: number) => {
      if (!m.label) return false;
      const l = m.label.toLowerCase();
      if (s && (l.includes(s) || s.includes(l))) return true;
      if (subNum === 1 && (l.includes("1 підгр") || l.includes("1-ша") || l === "1")) return true;
      if (subNum === 2 && (l.includes("2 підгр") || l.includes("2-га") || l === "2")) return true;
      if (s.includes("токар") && (l.includes("токар") || l.includes("токарев"))) return true;
      if (s.includes("хочин") && (l.includes("хочин") || l.includes("хочинск"))) return true;
      return false;
    };

    let m0 = meetings.find((m) => matchesTeacher(m, s0, 1)) || null;
    let m1 = meetings.find((m) => matchesTeacher(m, s1, 2) && m !== m0) || null;

    if (meetings.length >= 2) {
      if (m0 && !m1) {
        m1 = meetings.find((m) => m !== m0) || null;
      } else if (m1 && !m0) {
        m0 = meetings.find((m) => m !== m1) || null;
      } else if (!m0 && !m1) {
        m0 = meetings[0];
        m1 = meetings[1];
      }
    }

    return [m0 || null, m1 || null];
  }, [isDualTeachersOrSplit, isTeacherView, lesson.teacher_name, secondaryItems, meetings]);

  const teacherSpecificRoom = useMemo(() => {
    if (!isTeacherView || !hasMultipleTeachers || activeTeacherIdx === null) return null;
    const r = activeTeacherIdx === 1
      ? (lesson.second_teacher_room || rooms[1] || rooms[0] || lesson.room)
      : (lesson.teacher_room || rooms[0] || lesson.room);
    return r ? r.replace(/^ауд\.?\s*/i, "") : null;
  }, [isTeacherView, hasMultipleTeachers, activeTeacherIdx, lesson.second_teacher_room, lesson.teacher_room, rooms, lesson.room]);

  const teacherSpecificMeeting = useMemo(() => {
    if (!isTeacherView || !hasMultipleTeachers || activeTeacherIdx === null) return null;
    return teacherMeetings[activeTeacherIdx] || (meetings.length === 1 ? meetings[0] : null);
  }, [isTeacherView, hasMultipleTeachers, activeTeacherIdx, teacherMeetings, meetings]);

  const isTeacherSubgroupShown = isTeacherView && hasMultipleTeachers && activeTeacherIdx !== null;

  const singleSubgroupIdx = useMemo(() => {
    if (!isDualTeachers) return null;
    if (effectiveSubgroup !== null) {
      const idx = effectiveSubgroup - 1;
      return idx >= 0 && idx < secondaryItems.length ? idx : null;
    }
    return null;
  }, [isDualTeachers, effectiveSubgroup, secondaryItems.length]);

  const isSingleSubgroupShown = singleSubgroupIdx !== null;

  const singleSubgroupMeeting = useMemo(() => {
    if (singleSubgroupIdx === null) return null;
    return teacherMeetings[singleSubgroupIdx] || meetings[0] || null;
  }, [singleSubgroupIdx, teacherMeetings, meetings]);

  const singleSubgroupRoom = useMemo(() => {
    if (singleSubgroupIdx === null) return null;
    const r = (singleSubgroupIdx === 0 ? lesson.teacher_room : lesson.second_teacher_room) || rooms[singleSubgroupIdx] || rooms[0] || null;
    return r ? r.replace(/^ауд\.?\s*/i, "") : null;
  }, [singleSubgroupIdx, lesson.teacher_room, lesson.second_teacher_room, rooms]);

  const row3Meetings = useMemo(() => {
    if (!isDualTeachers) return meetings;
    return meetings.filter((m) => m !== teacherMeetings[0] && m !== teacherMeetings[1]);
  }, [isDualTeachers, meetings, teacherMeetings]);

  const deskMeeting = isTeacherSubgroupShown
    ? teacherSpecificMeeting
    : ((isDualTeachers ? (isSingleSubgroupShown ? singleSubgroupMeeting : row3Meetings[0]) : meetings[0]) ?? null);
  const mobileMeeting = isTeacherSubgroupShown
    ? teacherSpecificMeeting
    : ((isDualTeachers ? (isSingleSubgroupShown ? singleSubgroupMeeting : row3Meetings[0]) : meetings[0]) ?? null);
  const hasMobileMeeting = Boolean(mobileMeeting);

  const displayRooms = useMemo(() => {
    if (isTeacherSubgroupShown) {
      if (!teacherSpecificRoom) return [];
      if (learningMode === "online" && teacherSpecificMeeting) return [];
      return [teacherSpecificRoom];
    }
    if (isSingleSubgroupShown) {
      if (!singleSubgroupRoom) return [];
      if (learningMode === "online" && singleSubgroupMeeting) return [];
      return [singleSubgroupRoom];
    }
    return rooms;
  }, [isTeacherSubgroupShown, teacherSpecificRoom, teacherSpecificMeeting, isSingleSubgroupShown, singleSubgroupRoom, learningMode, singleSubgroupMeeting, rooms]);

  const roomsLabel = useMemo(() => formatRoomsList(displayRooms), [displayRooms]);
  const hasBothRoomAndMeet = displayRooms.length > 0 && (isTeacherSubgroupShown ? Boolean(teacherSpecificMeeting) : (isSingleSubgroupShown ? hasMobileMeeting : hasMeeting));
  // Два викладачі (ПК, вигляд «День»): аудиторія і посилання біля кожного окремо (тільки для студента)
  const hasPerTeacherRoom = !isTeacherView && Boolean(lesson.teacher_room || lesson.second_teacher_room || rooms.length >= 2);

  const weekGridMeetings = useMemo(() => {
    if (isTeacherSubgroupShown) {
      return teacherSpecificMeeting ? [teacherSpecificMeeting] : [];
    }
    if (!isDualTeachers) return meetings;
    if (isSingleSubgroupShown) return singleSubgroupMeeting ? [singleSubgroupMeeting] : [];
    return row3Meetings;
  }, [isTeacherSubgroupShown, teacherSpecificMeeting, isDualTeachers, isSingleSubgroupShown, singleSubgroupMeeting, row3Meetings, meetings]);

  const groupedTasks = useMemo(() => {
    if (!isDualTeachers || tasks.length === 0) {
      return [{ teacher: null, items: tasks }];
    }
    if (effectiveSubgroup !== null) {
      const myIdx = effectiveSubgroup - 1;
      const myTeacher = secondaryItems[myIdx]?.displayName || null;
      return [{ teacher: myTeacher, items: tasks }];
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
  }, [isDualTeachers, secondaryItems, tasks, effectiveSubgroup]);

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
                : (!isDay && isTodayTarget)
                  ? "border-sys-accent/35 bg-sys-accent/[0.03] shadow-[0_0_12px_rgba(59,130,246,0.06)] hover:border-sys-accent/50"
                  : "border-sys-border hover:border-sys-border/80";

  const renderStatusBadge = (compact = false) => {
    const baseCls = compact
      ? "inline-flex max-w-full [white-space:normal] [overflow-wrap:anywhere] items-center gap-1 rounded px-1.5 py-0.5 text-xs font-bold"
      : "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-bold";
    if (lesson.is_cancelled) {
      if (lesson.moved_to_date) {
        return (
          <span className={`${baseCls} border border-amber-500/40 bg-amber-500/15 tracking-wide text-amber-300`}>
            ↪ {formatMovedTo(lesson.moved_to_date, lesson.moved_to_lesson)}
          </span>
        );
      }
      return (
        <span className={`${baseCls} border border-rose-500/40 bg-rose-500/15 uppercase tracking-wider text-rose-400`}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
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
          {eventBadge.label}
        </span>
      );
    }
    if (lesson.is_replacement) {
      return (
        <span className={`${baseCls} bg-sys-warning uppercase tracking-wider text-sys-warningText`}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-sys-warningText">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
          <span>Заміна</span>
        </span>
      );
    }
    return null;
  };

  const renderTemplateWeekBadge = () => {
    if (!isTemplateMode || lesson.week_type === "both") return null;
    return (
      <span
        className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider ${
          lesson.week_type === "numerator"
            ? "border-sky-500/30 bg-sky-500/10 text-sky-300"
            : "border-purple-500/30 bg-purple-500/10 text-purple-300"
        }`}
      >
        {lesson.week_type === "numerator" ? "Чисельник" : "Знаменник"}
      </span>
    );
  };

  const renderMoreMenu = (alignTop = true) => {
    if (!moreOpen) return null;
    return (
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
          className={`absolute right-0 ${
            alignTop ? "bottom-full mb-1" : "top-full mt-1"
          } z-50 min-w-[200px] rounded-xl border border-sys-border bg-sys-card shadow-2xl p-1 text-xs space-y-0.5 animate-in fade-in zoom-in-95 duration-150`}
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
                  className="w-full flex items-center gap-2 px-2.5 py-2 sm:py-1.5 rounded-lg text-left text-sys-text-primary hover:bg-sky-500/10 hover:text-sky-400 transition-colors"
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
                  className="w-full flex items-center gap-2 px-2.5 py-2 sm:py-1.5 rounded-lg text-left text-sys-text-primary hover:bg-emerald-500/10 hover:text-emerald-400 transition-colors"
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
                  className="w-full flex items-center gap-2 px-2.5 py-2 sm:py-1.5 rounded-lg text-left text-sys-text-primary hover:bg-amber-500/10 hover:text-amber-400 transition-colors"
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
                  className="w-full flex items-center gap-2 px-2.5 py-2 sm:py-1.5 rounded-lg text-left text-rose-400 hover:bg-rose-500/10 transition-colors"
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
                  className="w-full flex items-center gap-2 px-2.5 py-2 sm:py-1.5 rounded-lg text-left text-sys-text-primary hover:bg-emerald-500/10 hover:text-emerald-400 transition-colors"
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
                  className="w-full flex items-center gap-2 px-2.5 py-2 sm:py-1.5 rounded-lg text-left text-sys-text-primary hover:bg-amber-500/10 hover:text-amber-400 transition-colors"
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
                    className="w-full flex items-center gap-2 px-2.5 py-2 sm:py-1.5 rounded-lg text-left text-amber-400 hover:bg-amber-500/10 transition-colors"
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
                    className="w-full flex items-center gap-2 px-2.5 py-2 sm:py-1.5 rounded-lg text-left text-rose-400 hover:bg-rose-500/10 transition-colors"
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
                  className="w-full flex items-center gap-2 px-2.5 py-2 sm:py-1.5 rounded-lg text-left text-sys-accent hover:bg-sys-accent/10 transition-colors"
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
                    className="w-full flex items-center gap-2 px-2.5 py-2 sm:py-1.5 rounded-lg text-left text-sys-text-secondary hover:text-sys-accent hover:bg-sys-accent/10 transition-colors"
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
                    className="w-full flex items-center gap-2 px-2.5 py-2 sm:py-1.5 rounded-lg text-left text-sys-text-secondary hover:text-sys-text-primary hover:bg-white/5 transition-colors"
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
    );
  };

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
      className={`group relative flex min-w-0 flex-col rounded-2xl border bg-sys-card shadow-sm transition-all duration-200 ${
        isDay
          ? isLive
            ? "p-4 pb-6 sm:p-6 sm:pb-8 lg:px-7 lg:py-7 lg:pb-9 sm:min-h-[140px]"
            : "p-4 sm:p-6 lg:px-7 lg:py-7 sm:min-h-[140px]"
          : isLive
            ? "p-2.5 pb-5 rounded-xl h-full flex flex-col justify-between"
            : "p-2.5 rounded-xl h-full flex flex-col justify-between"
      } ${stateClass} ${
        !lesson.is_relevant_this_week ? "opacity-60" : ""
      } ${canMove ? "cursor-grab active:cursor-grabbing" : ""}`}
    >
      {/* Desktop/Tablet 3-Zone Horizontal Layout (for Day mode on screens >= sm) */}
      {isDay && (
        <div className="hidden sm:flex sm:items-stretch gap-4 w-full">
          {/* Zone 1: Timeline (100px - 110px) */}
          {!hideTimeColumn && (
            <div className="w-24 sm:w-28 shrink-0 self-start flex flex-col items-start pr-4 border-r border-sys-border/50 text-left pt-1">
              <span className={`text-2xl sm:text-[26px] font-black leading-none transition-colors ${isLive ? "text-sys-accent" : "text-sys-text-primary group-hover:text-sys-accent"}`}>
                {lesson.lesson_number}
              </span>
              <div className="mt-1.5 flex flex-col leading-tight whitespace-nowrap">
                <span className="text-sm sm:text-[15px] font-bold text-sys-text-primary">
                  {startT}
                </span>
                <span className="text-xs text-sys-text-muted mt-0.5">
                  {endT || DEFAULT_LESSON_TIMES[lesson.lesson_number]?.split("-")[1] || ""}
                </span>
              </div>
              {isLive && (
                <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-sys-accent/15 border border-sys-accent/30 px-2.5 py-0.5 text-xs font-bold text-sys-accent whitespace-nowrap">
                  <span className="h-1.5 w-1.5 animate-ping rounded-full bg-sys-accent shrink-0" />
                  <span>ще {remainingMin} хв</span>
                </div>
              )}
            </div>
          )}

          {/* Right Column: Zone 2 & Zone 3 on top, full-width HW strip below */}
          <div className="flex-1 min-w-0 flex flex-col justify-between gap-2.5 pl-1 sm:pl-2">
            <div className="flex items-start justify-between gap-4 w-full">
              {/* Zone 2: Main Content */}
              <div className="flex-1 min-w-0 flex flex-col justify-center gap-1">
                <h3 className={`font-bold leading-snug text-base sm:text-[18px] lg:text-[19px] break-words ${lesson.is_cancelled ? "line-through text-sys-text-muted" : "text-sys-text-subject"}`}>
                  {lesson.subject_name}
                </h3>
                {lesson.event_title && lesson.event_title !== lesson.subject_name && (
                  <span className="text-xs sm:text-sm font-semibold text-sys-text-secondary">
                    {lesson.event_title}
                  </span>
                )}

                {/* Teacher / Group info */}
                <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm text-sys-text-secondary mt-0.5">
                  {isDualTeachers ? (
                    isSingleSubgroupShown ? (
                      <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); e.preventDefault(); handleSubgroupToggle(singleSubgroupIdx + 1); }}
                          title={`Ваша підгрупа ${singleSubgroupIdx + 1} (натисніть, щоб скинути або перемкнути)`}
                          aria-label={`Ваша підгрупа ${singleSubgroupIdx + 1} (натисніть, щоб скинути або перемкнути)`}
                          className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold border ${
                            singleSubgroupIdx === 0
                              ? "bg-sky-500/20 text-sky-400 font-bold border-sky-500/40"
                              : "bg-indigo-500/20 text-indigo-400 font-bold border-indigo-500/40"
                          }`}
                        >
                          {singleSubgroupIdx + 1} підгр.
                        </button>
                        <svg
                          width="13"
                          height="13"
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
                        {onQuickJump ? (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onQuickJump(secondaryItems[singleSubgroupIdx].target); }}
                            className="text-left text-xs sm:text-sm font-medium text-sys-text-secondary hover:text-sys-accent hover:underline focus:outline-none break-words"
                            title={secondaryItems[singleSubgroupIdx].displayName}
                          >
                            {secondaryItems[singleSubgroupIdx].displayName}
                          </button>
                        ) : (
                          <span className="text-xs sm:text-sm font-medium text-sys-text-secondary break-words" title={secondaryItems[singleSubgroupIdx].displayName}>
                            {secondaryItems[singleSubgroupIdx].displayName}
                          </span>
                        )}
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2 w-full max-w-[520px]">
                        {secondaryItems.map((item, idx) => {
                          const subNum = idx + 1;
                          if (effectiveSubgroup !== null && effectiveSubgroup !== subNum) {
                            return null;
                          }
                          const isFaded = selectedSubgroup !== null && selectedSubgroup !== subNum;
                          const ownMeeting = teacherMeetings[idx];
                          const ownRoom = (idx === 0 ? lesson.teacher_room : lesson.second_teacher_room) || rooms[idx] || null;
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
                                  onClick={(e) => { e.stopPropagation(); e.preventDefault(); handleSubgroupToggle(subNum); }}
                                  title={effectiveSubgroup === subNum ? "Ваша підгрупа (натисніть для скидання)" : `Обрати ${subNum} підгрупу`}
                                  aria-label={effectiveSubgroup === subNum ? "Ваша підгрупа (натисніть для скидання)" : `Обрати ${subNum} підгрупу`}
                                  className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold transition-colors ${
                                    effectiveSubgroup === subNum
                                      ? subNum === 1
                                        ? "bg-sky-500/20 text-sky-400 font-bold border border-sky-500/40"
                                        : "bg-indigo-500/20 text-indigo-400 font-bold border border-indigo-500/40"
                                      : subNum === 1
                                        ? "bg-sys-card border border-sys-border text-slate-400 hover:text-slate-200 hover:border-sky-500/40"
                                        : "bg-sys-card border border-sys-border text-slate-400 hover:text-slate-200 hover:border-indigo-500/40"
                                  }`}
                                >
                                  {subNum} підгр.
                                </button>
                                <svg
                                  width="13"
                                  height="13"
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
                                {onQuickJump ? (
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); onQuickJump(item.target); }}
                                    className="text-left text-xs sm:text-sm font-medium text-sys-text-secondary hover:text-sys-accent hover:underline focus:outline-none truncate min-w-0"
                                    title={item.displayName}
                                  >
                                    {item.displayName}
                                  </button>
                                ) : (
                                  <span className="text-xs sm:text-sm font-medium text-sys-text-secondary truncate min-w-0" title={item.displayName}>
                                    {item.displayName}
                                  </span>
                                )}
                              </div>
                              {ownMeeting ? (
                                !hasGroupAccess ? (
                                  <LockedMeetingBadge platform={ownMeeting.platform} size="compact" onClick={handleLockedMeetingClick} />
                                ) : (
                                  <a
                                    href={ownMeeting.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => { e.stopPropagation(); vibrateTap(12); }}
                                    className={`inline-flex shrink-0 h-7 px-2.5 items-center gap-1.5 rounded-lg border text-xs font-semibold whitespace-nowrap active:scale-95 transition-all ${
                                      getMeetingBtnStyle(ownMeeting.platform, isLive && isMeetingLiveOrSoon, "compact")
                                    }`}
                                  >
                                    <MeetingPlatformIcon platform={ownMeeting.platform} size={13} />
                                    <span>{ownMeeting.platform === "zoom" ? "Zoom" : ownMeeting.platform === "meet" ? "Meet" : "Онлайн"}</span>
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-70">
                                      <path d="M7 17 17 7" />
                                      <path d="M7 7h10v10" />
                                    </svg>
                                  </a>
                                )
                              ) : (
                                <span className="shrink-0 rounded-md border border-sys-border bg-sys-bg px-2 py-1 text-xs font-semibold leading-none text-sys-text-secondary whitespace-nowrap">
                                  {ownRoom ? `ауд. ${ownRoom.replace(/^ауд\.?\s*/i, "")}` : "ауд. —"}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )
                  ) : secondaryItems.length > 0 ? (
                    <>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-sys-text-muted shrink-0">
                        <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                        <circle cx="12" cy="7" r="4" />
                      </svg>
                      {secondaryItems.map((item, idx) => (
                        <span key={idx}>
                          {idx > 0 && <span className="text-sys-text-muted"> / </span>}
                          {onQuickJump ? (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); onQuickJump(item.target); }}
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
                  ) : null}
                </div>
              </div>

              {/* Zone 3: Location & Actions */}
              <div className="shrink-0 flex flex-col items-end justify-start gap-2 pt-0.5">
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {(!isDualTeachers || isSingleSubgroupShown) && displayRooms.length > 0 && (
                    <div className="inline-flex h-8 px-3 items-center gap-1.5 rounded-lg border border-sys-border bg-sys-bg text-sys-text-secondary font-medium text-xs shadow-xs whitespace-nowrap">
                      <span>{roomsLabel}</span>
                    </div>
                  )}
                  {deskMeeting ? (
                    !hasGroupAccess ? (
                      <LockedMeetingBadge platform={deskMeeting.platform} size="normal" onClick={handleLockedMeetingClick} />
                    ) : (
                      <a
                        href={deskMeeting.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => { e.stopPropagation(); vibrateTap(12); }}
                        className={`inline-flex h-8 px-3 items-center gap-1.5 rounded-lg font-bold text-xs active:scale-95 transition-all whitespace-nowrap border ${
                          getMeetingBtnStyle(deskMeeting.platform, isMeetingLiveOrSoon, "normal")
                        }`}
                      >
                        <MeetingPlatformIcon platform={deskMeeting.platform} size={14} />
                        <span>{deskMeeting.platform === "zoom" ? "Zoom" : deskMeeting.platform === "meet" ? "Meet" : "Онлайн"}</span>
                        <span className="text-xs opacity-75">↗</span>
                      </a>
                    )
                  ) : (!isDualTeachers || isSingleSubgroupShown) && !hasGroupAccess && (lesson.has_protected_link || (lesson.is_online && displayRooms.length === 0)) ? (
                    <LockedMeetingBadge platform={meetings[0]?.platform} size="normal" onClick={handleLockedMeetingClick} />
                  ) : null}
                </div>

                {/* Statuses and Actions */}
                <div className="flex flex-wrap items-center justify-end gap-1.5">
                  {renderTemplateWeekBadge()}
                  {renderStatusBadge(false)}

                  {canEdit && (
                    <div className="relative flex items-center gap-1 ml-1">
                      {lesson.is_cancelled ? (
                        <div className="flex items-center gap-1">
                          {onRestoreDated && lesson.group_id && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onRestoreDated(lesson, targetDate);
                              }}
                              title={lesson.moved_to_date ? "Скасувати перенесення та відновити пару" : `Відновити пару на ${targetDate}`}
                              aria-label={lesson.moved_to_date ? "Скасувати перенесення та відновити пару" : `Відновити пару на ${targetDate}`}
                              className="inline-flex h-8 items-center justify-center rounded-lg border border-emerald-500/50 bg-emerald-500/15 px-2.5 text-xs font-semibold text-emerald-400 hover:bg-emerald-500/25 active:scale-[0.98] transition-colors whitespace-nowrap"
                            >
                              Відновити
                            </button>
                          )}
                          {onRemoveReplacement && lesson.group_id && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onRemoveReplacement(lesson, targetDate);
                              }}
                              title="Очистити слот (повністю прибрати скасовану пару)"
                              aria-label="Очистити слот"
                              className="inline-flex h-8 items-center justify-center rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 text-xs font-semibold text-rose-300 hover:bg-rose-500/20 active:scale-[0.98] transition-colors whitespace-nowrap"
                            >
                              Очистити слот
                            </button>
                          )}
                        </div>
                      ) : (
                        <>
                          {canEditAction && (
                            <button
                              type="button"
                              title="Редагувати пару"
                              aria-label="Редагувати пару"
                              onClick={(e) => { e.stopPropagation(); onEdit?.(lesson); }}
                              className="w-8 h-8 flex items-center justify-center rounded-lg border border-sys-border/60 bg-sys-card text-sys-text-secondary hover:text-sys-accent hover:border-sys-accent/60"
                            >
                              <EditIcon />
                            </button>
                          )}
                          <button
                            type="button"
                            title="Більше дій"
                            aria-label="Більше дій"
                            aria-expanded={moreOpen}
                            onClick={(e) => { e.stopPropagation(); setMoreOpen(!moreOpen); }}
                            className="w-8 h-8 flex items-center justify-center rounded-lg border border-sys-border/60 bg-sys-card text-sys-text-secondary hover:text-sys-text-primary"
                          >
                            ⋯
                          </button>
                          {renderMoreMenu(true)}
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* 1 Task: Entire strip is a direct link with ↗ (no accordion) */}
            {showHw && tasks.length === 1 && (
              <a
                href={tasks[0].url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => {
                  e.stopPropagation();
                  vibrateTap(10);
                }}
                className="group flex w-full items-center justify-between rounded-xl bg-sys-bg/60 border border-sys-border px-3.5 py-2.5 text-xs text-sys-text-secondary hover:border-sys-border-elevated hover:bg-sys-bg transition-all shadow-xs cursor-pointer overflow-hidden"
                style={{
                  boxShadow:
                    isLinked && tasks[0].deadline.badgeTone === "overdue"
                      ? "inset 3px 0 0 #ef4444"
                      : tasks[0].deadline.badgeTone === "urgent"
                      ? "inset 3px 0 0 #f59e0b"
                      : tasks[0].deadline.formattedDate
                      ? "inset 3px 0 0 #8b5cf6"
                      : undefined,
                }}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-sys-text-muted group-hover:text-sys-accent transition-colors">
                    <path d="M16 4h2a2 2 0 0 1 2 2v14l-8-4-8 4V6a2 2 0 0 1 2-2h2" />
                    <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
                  </svg>
                  <span className="font-semibold text-sys-text-primary group-hover:text-sys-accent transition-colors truncate">
                    {tasks[0].title && tasks[0].title !== "Домашнє завдання" && tasks[0].title !== "Завдання"
                      ? tasks[0].title
                      : `${lesson.subject_name}${tasks[0].teacher ? ` · ${tasks[0].teacher}` : ""}`}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-3">
                  {tasks[0].deadline.statusText ? (
                    <span className={`inline-flex items-center gap-1.5 font-medium ${getTaskDeadlineTextColor(tasks[0].deadline.badgeTone, isLinked)}`}>
                      <span
                        className={`h-1.5 w-1.5 rounded-full shrink-0 ${getTaskDeadlineDotColor(tasks[0].deadline.badgeTone, isLinked)}`}
                      />
                      <span>{getTaskStatusText(tasks[0].deadline, isLinked)}</span>
                    </span>
                  ) : null}
                  <span className="text-sys-text-muted group-hover:text-sys-text-primary transition-colors text-xs ml-1">↗</span>
                </div>
              </a>
            )}

            {/* 2+ Tasks: Accordion container with rotating chevron */}
            {showHw && tasks.length > 1 && (
              <div
                className="w-full rounded-xl bg-sys-bg/60 border border-sys-border transition-all duration-150 overflow-hidden shadow-xs"
                style={{
                  boxShadow:
                    isLinked && highlightTask?.deadline.badgeTone === "overdue"
                      ? "inset 3px 0 0 #ef4444"
                      : highlightTask?.deadline.badgeTone === "urgent"
                      ? "inset 3px 0 0 #f59e0b"
                      : highlightTask?.deadline.formattedDate
                      ? "inset 3px 0 0 #8b5cf6"
                      : undefined,
                }}
              >
                <div
                  onClick={toggleHw}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") toggleHw(e); }}
                  className="flex w-full items-center justify-between px-3.5 py-2.5 cursor-pointer select-none gap-2 hover:bg-sys-card transition-colors"
                >
                  <div className="flex items-center gap-2 shrink-0">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-sys-text-muted">
                      <path d="M16 4h2a2 2 0 0 1 2 2v14l-8-4-8 4V6a2 2 0 0 1 2-2h2" />
                      <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
                    </svg>
                    <span className="text-xs font-bold text-sys-text-primary whitespace-nowrap">
                      {formatTaskCount(tasks.length)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 min-w-0 justify-end ml-auto">
                    {highlightTask?.deadline.statusText ? (
                      <span
                        className="inline-flex items-center gap-1.5 font-medium text-xs min-w-0"
                        style={{
                          color:
                            highlightTask.deadline.badgeTone === "overdue"
                              ? isLinked ? "#f87171" : "#a1a1aa"
                              : highlightTask.deadline.badgeTone === "urgent"
                              ? "#fbbf24"
                              : "#a1a1aa",
                        }}
                      >
                        <span
                          className="h-1.5 w-1.5 rounded-full shrink-0"
                          style={{
                            backgroundColor:
                              highlightTask.deadline.badgeTone === "overdue"
                                ? isLinked ? "#ef4444" : "#71717a"
                                : highlightTask.deadline.badgeTone === "urgent"
                                ? "#f59e0b"
                                : "#71717a",
                          }}
                        />
                        <span className="truncate">{getTaskStatusText(highlightTask.deadline, isLinked)}</span>
                      </span>
                    ) : null}
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className={`text-sys-text-muted transition-transform duration-200 shrink-0 ${isHwOpen ? "rotate-180" : ""}`}
                    >
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </div>
                </div>

                {isHwOpen && (
                  <div className="flex flex-col gap-1.5 p-3 border-t border-sys-border/60 bg-sys-bg/40 animate-in fade-in duration-150">
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
                        className="group flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-xs hover:bg-sys-card transition-colors"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-semibold text-sys-text-primary group-hover:text-sys-accent transition-colors truncate">
                            {task.title || "Завдання"}
                          </span>
                          {task.teacher && (
                            <span className="text-sys-text-muted text-xs truncate">({task.teacher})</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {task.deadline.statusText ? (
                            <span className={`text-xs font-medium ${getTaskDeadlineTextColor(task.deadline.badgeTone, isLinked)}`}>
                              {getTaskStatusText(task.deadline, isLinked)}
                            </span>
                          ) : null}
                          <span className="text-sys-text-muted group-hover:text-sys-text-primary transition-colors text-xs">↗</span>
                        </div>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )}

            {visibleNoteText && (
              <p title={visibleNoteText} className="flex items-center gap-1.5 text-xs text-sys-text-secondary/60 italic min-w-0">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-sys-text-muted">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                <span className="truncate">{visibleNoteText}</span>
              </p>
            )}
          </div>
        </div>
      )}

      {/* Mobile Day Mode (< sm) */}
      {isDay && (
        <div className="flex sm:hidden flex-col gap-2 w-full">
          {/* Row 1: Number + Time (or badges when hideTimeColumn) on left, Live pill / Room / Meet / Edit actions on right */}
          {(!hideTimeColumn || canEdit || isLive || lesson.is_cancelled || eventBadge || lesson.is_replacement || (isTemplateMode && lesson.week_type !== "both") || (!hasBothRoomAndMeet && !isDualTeachers && (rooms.length > 0 || hasMeeting))) && (
            <div className="flex flex-wrap items-center justify-between gap-2 w-full min-h-[34px]">
              <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                {!hideTimeColumn && (
                  <div className="flex items-center gap-2 whitespace-nowrap">
                    <span className={`text-base font-black leading-none transition-colors ${isLive ? "text-sys-accent" : "text-sys-text-primary group-hover:text-sys-accent"}`}>
                      {lesson.lesson_number}
                    </span>
                    <span className="text-sys-text-muted font-bold text-xs">·</span>
                    <span className="text-xs font-semibold text-sys-text-secondary tracking-tight whitespace-nowrap">
                      {startT}–{endT || DEFAULT_LESSON_TIMES[lesson.lesson_number]?.split("-")[1] || ""}
                    </span>
                  </div>
                )}
                {renderTemplateWeekBadge()}
                {renderStatusBadge(true)}
                {canEdit && !isDualTeachers && rooms.length > 0 && (
                  <span className="inline-flex h-6 px-2 items-center rounded-md border border-sys-border bg-sys-bg text-sys-text-secondary font-medium text-xs whitespace-nowrap">
                    {roomsLabel}
                  </span>
                )}
              </div>

              {canEdit ? (
                <div className="relative flex items-center gap-1.5 ml-auto shrink-0">
                  {lesson.is_cancelled ? (
                    <div className="flex items-center gap-1.5">
                      {onRestoreDated && lesson.group_id && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onRestoreDated(lesson, targetDate);
                          }}
                          title={lesson.moved_to_date ? "Скасувати перенесення та відновити пару" : `Відновити пару на ${targetDate}`}
                          aria-label={lesson.moved_to_date ? "Скасувати перенесення та відновити пару" : `Відновити пару на ${targetDate}`}
                          className="inline-flex h-9 items-center justify-center rounded-lg border border-emerald-500/50 bg-emerald-500/15 px-3 text-xs font-semibold text-emerald-400 hover:bg-emerald-500/25 active:scale-[0.98] transition-colors whitespace-nowrap"
                        >
                          Відновити
                        </button>
                      )}
                      {onRemoveReplacement && lesson.group_id && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onRemoveReplacement(lesson, targetDate);
                          }}
                          title="Очистити слот (повністю прибрати скасовану пару)"
                          aria-label="Очистити слот"
                          className="inline-flex h-9 items-center justify-center rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 text-xs font-semibold text-rose-300 hover:bg-rose-500/20 active:scale-[0.98] transition-colors whitespace-nowrap"
                        >
                          Очистити
                        </button>
                      )}
                    </div>
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
                          className="inline-flex h-9 px-2.5 items-center justify-center gap-1.5 rounded-lg border border-sys-border bg-sys-bg/80 text-xs font-semibold text-sys-text-primary hover:border-sys-accent/60 hover:text-sys-accent active:scale-[0.98] transition-colors whitespace-nowrap"
                        >
                          <EditIcon />
                          <span>Редагувати</span>
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
                        className="w-9 h-9 flex items-center justify-center rounded-lg border border-sys-border bg-sys-bg/80 text-sys-text-secondary hover:text-sys-text-primary active:scale-[0.98] transition-colors font-bold text-sm"
                      >
                        ⋯
                      </button>
                      {renderMoreMenu(false)}
                    </>
                  )}
                </div>
              ) : isLive ? (
                <div className="shrink-0 flex items-center gap-1.5 rounded-full bg-sys-accent/15 border border-sys-accent/30 px-2.5 py-0.5 text-xs font-bold text-sys-accent whitespace-nowrap ml-auto">
                  <span className="h-1.5 w-1.5 animate-ping rounded-full bg-sys-accent shrink-0" />
                  <span>ще {remainingMin} хв</span>
                </div>
              ) : !hasBothRoomAndMeet && (!isDualTeachers || isSingleSubgroupShown) ? (
                <div className="shrink-0 flex items-center gap-2 ml-auto">
                  {displayRooms.length > 0 && (
                    <div
                      title={roomsLabel}
                      className="inline-flex h-8 px-2.5 items-center gap-1 rounded-lg border border-[#3f3f46] bg-sys-bg text-sys-text-secondary font-medium text-xs shadow-xs max-w-[160px] truncate whitespace-nowrap"
                    >
                      <span className="truncate">{roomsLabel}</span>
                    </div>
                  )}
                  {mobileMeeting ? (
                    !hasGroupAccess ? (
                      <LockedMeetingBadge platform={mobileMeeting.platform} size="normal" onClick={handleLockedMeetingClick} />
                    ) : (
                      <a
                        href={mobileMeeting.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => { e.stopPropagation(); vibrateTap(12); }}
                        className={`inline-flex h-8 min-h-[32px] px-2.5 items-center gap-1.5 rounded-lg font-bold text-xs shadow-xs active:scale-95 transition-all whitespace-nowrap border ${
                          getMeetingBtnStyle(mobileMeeting.platform, isMeetingLiveOrSoon, "normal")
                        }`}
                      >
                        <MeetingPlatformIcon platform={mobileMeeting.platform} size={14} />
                        <span>{mobileMeeting.platform === "zoom" ? "Zoom" : mobileMeeting.platform === "meet" ? "Meet" : "Онлайн"}</span>
                        <span className="text-xs opacity-75">↗</span>
                      </a>
                    )
                  ) : !hasGroupAccess && (lesson.has_protected_link || (lesson.is_online && displayRooms.length === 0)) ? (
                    <LockedMeetingBadge platform={meetings[0]?.platform} size="normal" onClick={handleLockedMeetingClick} />
                  ) : null}
                </div>
              ) : null}
            </div>
          )}

          {/* Row 2: Subject Title (16px/600) */}
          <div>
            <h3 className={`font-semibold leading-snug text-base break-words ${lesson.is_cancelled ? "line-through text-sys-text-muted" : "text-sys-text-subject"}`}>
              {lesson.subject_name}
            </h3>
            {lesson.event_title && lesson.event_title !== lesson.subject_name && (
              <span className="text-xs font-medium text-sys-text-secondary mt-0.5 block">
                {lesson.event_title}
              </span>
            )}
          </div>

          {/* Row 3: Teacher / Subgroups */}
          <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm text-sys-text-secondary">
            {isDualTeachers ? (
              isSingleSubgroupShown ? (
                <div className="flex items-center gap-1.5 min-w-0">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); e.preventDefault(); handleSubgroupToggle(singleSubgroupIdx + 1); }}
                    title={`Ваша підгрупа ${singleSubgroupIdx + 1} (натисніть, щоб скинути або перемкнути)`}
                    aria-label={`Ваша підгрупа ${singleSubgroupIdx + 1} (натисніть, щоб скинути або перемкнути)`}
                    className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold border ${
                      singleSubgroupIdx === 0
                        ? "bg-sky-500/20 text-sky-400 font-bold border-sky-500/40"
                        : "bg-indigo-500/20 text-indigo-400 font-bold border-indigo-500/40"
                    }`}
                  >
                    {singleSubgroupIdx + 1} підгр.
                  </button>
                  <svg
                    width="13"
                    height="13"
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
                  {onQuickJump ? (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onQuickJump(secondaryItems[singleSubgroupIdx].target); }}
                      className="text-left text-xs sm:text-sm font-medium text-sys-text-secondary hover:text-sys-accent hover:underline focus:outline-none truncate min-w-0"
                      title={secondaryItems[singleSubgroupIdx].displayName}
                    >
                      {secondaryItems[singleSubgroupIdx].displayName}
                    </button>
                  ) : (
                    <span className="text-xs sm:text-sm font-medium text-sys-text-secondary truncate min-w-0" title={secondaryItems[singleSubgroupIdx].displayName}>
                      {secondaryItems[singleSubgroupIdx].displayName}
                    </span>
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-2 w-full">
                  {secondaryItems.map((item, idx) => {
                    const subNum = idx + 1;
                    if (effectiveSubgroup !== null && effectiveSubgroup !== subNum) {
                      return null;
                    }
                    const isFaded = selectedSubgroup !== null && selectedSubgroup !== subNum;
                    const ownMeeting = teacherMeetings[idx];
                    const ownRoom = (idx === 0 ? lesson.teacher_room : lesson.second_teacher_room) || rooms[idx] || null;
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
                            onClick={(e) => { e.stopPropagation(); e.preventDefault(); handleSubgroupToggle(subNum); }}
                            title={effectiveSubgroup === subNum ? "Ваша підгрупа (натисніть для скидання)" : `Обрати ${subNum} підгрупу`}
                            aria-label={effectiveSubgroup === subNum ? "Ваша підгрупа (натисніть для скидання)" : `Обрати ${subNum} підгрупу`}
                            className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold transition-colors ${
                              effectiveSubgroup === subNum
                                ? subNum === 1
                                  ? "bg-sky-500/20 text-sky-400 font-bold border border-sky-500/40"
                                  : "bg-indigo-500/20 text-indigo-400 font-bold border border-indigo-500/40"
                                : subNum === 1
                                  ? "bg-sys-card border border-sys-border text-slate-400 hover:text-slate-200 hover:border-sky-500/40"
                                  : "bg-sys-card border border-sys-border text-slate-400 hover:text-slate-200 hover:border-indigo-500/40"
                            }`}
                          >
                            {subNum} підгр.
                          </button>
                          <svg
                            width="13"
                            height="13"
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
                          {onQuickJump ? (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); onQuickJump(item.target); }}
                              className="text-left text-xs sm:text-sm font-medium text-sys-text-secondary hover:text-sys-accent hover:underline focus:outline-none truncate min-w-0"
                              title={item.displayName}
                            >
                              {item.displayName}
                            </button>
                          ) : (
                            <span className="text-xs sm:text-sm font-medium text-sys-text-secondary truncate min-w-0" title={item.displayName}>
                              {item.displayName}
                            </span>
                          )}
                        </div>
                        {ownMeeting ? (
                          !hasGroupAccess ? (
                            <LockedMeetingBadge platform={ownMeeting.platform} size="compact" onClick={handleLockedMeetingClick} />
                          ) : (
                            <a
                              href={ownMeeting.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => { e.stopPropagation(); vibrateTap(12); }}
                              className={`inline-flex shrink-0 h-7 px-2.5 items-center gap-1.5 rounded-lg border text-xs font-semibold whitespace-nowrap active:scale-95 transition-all ${
                                getMeetingBtnStyle(ownMeeting.platform, isLive && isMeetingLiveOrSoon, "compact")
                              }`}
                            >
                              <MeetingPlatformIcon platform={ownMeeting.platform} size={13} />
                              <span>{ownMeeting.platform === "zoom" ? "Zoom" : ownMeeting.platform === "meet" ? "Meet" : "Онлайн"}</span>
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-70">
                                <path d="M7 17 17 7" />
                                <path d="M7 7h10v10" />
                              </svg>
                            </a>
                          )
                        ) : (
                          <span className="shrink-0 rounded-md border border-sys-border bg-sys-bg px-2 py-1 text-xs font-semibold leading-none text-sys-text-secondary whitespace-nowrap">
                            {ownRoom ? `ауд. ${ownRoom.replace(/^ауд\.?\s*/i, "")}` : "ауд. —"}
                          </span>
                        )}
                      </div>
                    );
                  })}
                  {row3Meetings[0] && (
                    <div className="flex justify-end w-full pt-0.5">
                      {!hasGroupAccess ? (
                        <LockedMeetingBadge platform={row3Meetings[0]?.platform || meetings[0]?.platform} size="compact" onClick={handleLockedMeetingClick} />
                      ) : (
                        <a
                          href={row3Meetings[0].url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => { e.stopPropagation(); vibrateTap(12); }}
                          className={`inline-flex shrink-0 h-7 px-2.5 items-center gap-1.5 rounded-lg border text-xs font-semibold whitespace-nowrap active:scale-95 transition-all ${
                            getMeetingBtnStyle(row3Meetings[0].platform, isLive && isMeetingLiveOrSoon, "compact")
                          }`}
                        >
                          <MeetingPlatformIcon platform={row3Meetings[0].platform} size={13} />
                          <span>{row3Meetings[0].platform === "zoom" ? "Zoom" : row3Meetings[0].platform === "meet" ? "Meet" : "Онлайн"}</span>
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-70">
                            <path d="M7 17 17 7" />
                            <path d="M7 7h10v10" />
                          </svg>
                        </a>
                      )}
                    </div>
                  )}
                </div>
              )
            ) : secondaryItems.length > 0 ? (
              <div className="text-xs text-sys-text-secondary">
                {secondaryItems.map((item) => item.displayName).join(" / ")}
              </div>
            ) : null}
          </div>

          {/* Dedicated Row for Room & Meet: on live lessons OR when both exist (or when canEdit and hasMeeting) */}
          {(!isDualTeachers || isSingleSubgroupShown) && ((isLive && (displayRooms.length > 0 || hasMobileMeeting || (!hasGroupAccess && lesson.is_online))) || hasBothRoomAndMeet || (canEdit && hasMobileMeeting) || (!hasGroupAccess && lesson.has_protected_link)) && (
            <div className="flex flex-wrap items-center gap-2 w-full mt-0.5">
              {!canEdit && displayRooms.length > 0 && (
                <div
                  title={roomsLabel}
                  className="inline-flex min-h-[38px] px-3 items-center rounded-xl border border-[#3f3f46] bg-sys-bg text-sys-text-secondary font-medium text-xs shadow-xs max-w-[55%] truncate"
                >
                  <span className="truncate">{roomsLabel}</span>
                </div>
              )}
              {mobileMeeting ? (
                !hasGroupAccess ? (
                  <LockedMeetingBadge platform={mobileMeeting.platform} size="normal" onClick={handleLockedMeetingClick} />
                ) : (
                  <a
                    href={mobileMeeting.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => { e.stopPropagation(); vibrateTap(12); }}
                    className={`inline-flex min-h-[40px] h-10 px-3.5 items-center gap-2 rounded-xl font-bold text-xs shadow-xs active:scale-95 transition-all whitespace-nowrap border ${
                      getMeetingBtnStyle(mobileMeeting.platform, isMeetingLiveOrSoon, "normal")
                    }`}
                  >
                    <MeetingPlatformIcon platform={mobileMeeting.platform} size={15} />
                    <span>{mobileMeeting.platform === "zoom" ? "Zoom" : mobileMeeting.platform === "meet" ? "Meet" : "Онлайн"}</span>
                    <span className="text-xs opacity-75">↗</span>
                  </a>
                )
              ) : !hasGroupAccess && (lesson.has_protected_link || (lesson.is_online && displayRooms.length === 0)) ? (
                <LockedMeetingBadge platform={meetings[0]?.platform} size="normal" onClick={handleLockedMeetingClick} />
              ) : null}
            </div>
          )}

          {/* Row 4: Full-width HW strip (44px min-height) */}
          {showHw && tasks.length === 1 && (
            <a
              href={tasks[0].url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => {
                e.stopPropagation();
                vibrateTap(10);
              }}
              className="group flex min-h-[44px] w-full items-start justify-between rounded-xl bg-sys-bg/60 border border-sys-border px-3.5 py-2.5 text-xs text-sys-text-secondary hover:border-sys-border-elevated hover:bg-sys-bg transition-all shadow-xs cursor-pointer mt-1 overflow-hidden"
              style={{
                boxShadow:
                  isLinked && tasks[0].deadline.badgeTone === "overdue"
                    ? "inset 3px 0 0 #ef4444"
                    : tasks[0].deadline.badgeTone === "urgent"
                    ? "inset 3px 0 0 #f59e0b"
                    : tasks[0].deadline.formattedDate
                    ? "inset 3px 0 0 #8b5cf6"
                    : undefined,
              }}
            >
              <div className="flex items-start gap-2 min-w-0 flex-1">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-0.5 text-sys-text-muted group-hover:text-sys-accent transition-colors">
                  <path d="M16 4h2a2 2 0 0 1 2 2v14l-8-4-8 4V6a2 2 0 0 1 2-2h2" />
                  <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
                </svg>
                <div className="flex flex-col min-w-0 flex-1 pr-1">
                  <span className="font-semibold text-sys-text-primary group-hover:text-sys-accent transition-colors line-clamp-2 break-words leading-tight">
                    {tasks[0].title && tasks[0].title !== "Домашнє завдання" && tasks[0].title !== "Завдання"
                      ? tasks[0].title
                      : `${lesson.subject_name}${tasks[0].teacher ? ` · ${tasks[0].teacher}` : ""}`}
                  </span>
                  {tasks[0].deadline.statusText ? (
                    <div className="flex items-center gap-1.5 mt-1 text-xs font-medium">
                      <span
                        className={`h-1.5 w-1.5 rounded-full shrink-0 ${getTaskDeadlineDotColor(tasks[0].deadline.badgeTone, isLinked)}`}
                      />
                      <span className={getTaskDeadlineTextColor(tasks[0].deadline.badgeTone, isLinked)}>
                        {getTaskStatusText(tasks[0].deadline, isLinked)}
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="shrink-0 ml-1.5 mt-0.5">
                <span className="text-sys-text-muted group-hover:text-sys-text-primary transition-colors text-xs">↗</span>
              </div>
            </a>
          )}

          {showHw && tasks.length > 1 && (
            <div
              className="w-full rounded-xl bg-sys-bg/60 border border-sys-border transition-all duration-150 overflow-hidden shadow-xs mt-1"
              style={{
                boxShadow:
                  isLinked && highlightTask?.deadline.badgeTone === "overdue"
                    ? "inset 3px 0 0 #ef4444"
                    : highlightTask?.deadline.badgeTone === "urgent"
                    ? "inset 3px 0 0 #f59e0b"
                    : highlightTask?.deadline.formattedDate
                    ? "inset 3px 0 0 #8b5cf6"
                    : undefined,
              }}
            >
              <div
                onClick={toggleHw}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") toggleHw(e); }}
                className="flex min-h-[44px] w-full items-center justify-between px-3.5 py-2.5 cursor-pointer select-none gap-2 hover:bg-sys-card transition-colors"
              >
                <div className="flex items-center gap-2 shrink-0">
                  {highlightTask?.deadline.badgeTone === "overdue" && isLinked ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-rose-400 shrink-0">
                      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                      <line x1="12" y1="9" x2="12" y2="13" />
                      <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                  ) : (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-sys-text-muted">
                      <path d="M16 4h2a2 2 0 0 1 2 2v14l-8-4-8 4V6a2 2 0 0 1 2-2h2" />
                      <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
                    </svg>
                  )}
                  <span className="text-xs font-bold text-sys-text-primary whitespace-nowrap">
                    {formatTaskCount(tasks.length)}
                  </span>
                </div>
                <div className="flex items-center gap-2 min-w-0 justify-end ml-auto">
                  {highlightTask?.deadline.statusText ? (
                    <span className={`inline-flex items-center gap-1.5 font-medium text-xs min-w-0 ${getTaskDeadlineTextColor(highlightTask.deadline.badgeTone, isLinked)}`}>
                      <span
                        className={`h-1.5 w-1.5 rounded-full shrink-0 ${getTaskDeadlineDotColor(highlightTask.deadline.badgeTone, isLinked)}`}
                      />
                      <span className="truncate">{getTaskStatusText(highlightTask.deadline, isLinked)}</span>
                    </span>
                  ) : null}
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={`text-sys-text-muted transition-transform duration-200 shrink-0 ${isHwOpen ? "rotate-180" : ""}`}
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </div>
              </div>

              {isHwOpen && (
                <div className="flex flex-col gap-1.5 p-3 border-t border-sys-border/60 bg-sys-bg/40 animate-in fade-in duration-150">
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
                      className="group flex min-h-[44px] items-center justify-between gap-3 rounded-lg px-3 py-2 text-xs hover:bg-sys-card transition-colors"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-semibold text-sys-text-primary group-hover:text-sys-accent transition-colors truncate">
                          {task.title || "Завдання"}
                        </span>
                        {task.teacher && (
                          <span className="text-sys-text-muted text-xs truncate">({task.teacher})</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {task.deadline.statusText ? (
                          <span className={`text-xs font-medium ${getTaskDeadlineTextColor(task.deadline.badgeTone, isLinked)}`}>
                            {getTaskStatusText(task.deadline, isLinked)}
                          </span>
                        ) : null}
                        <span className="text-sys-text-muted group-hover:text-sys-text-primary transition-colors text-xs">↗</span>
                      </div>
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}

          {visibleNoteText && (
            <p className="flex items-center gap-1.5 text-xs text-sys-text-secondary/80 italic mt-1">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-sys-text-muted">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <span>{visibleNoteText}</span>
            </p>
          )}
        </div>
      )}

      {/* Week Mode Layout */}
      {!isDay && (
        <div className="flex items-start gap-2.5 sm:gap-3 h-full">
        {/* Left: narrow fixed column (number + start time) */}
        {!hideTimeColumn && (
          <div className="flex w-11 sm:w-12 shrink-0 flex-col text-left">
            <span className={`text-lg sm:text-xl font-bold leading-none transition-colors ${isLive ? "text-sys-accent font-black" : "text-sys-text-primary"}`}>
              {lesson.lesson_number}
            </span>
            <span className="text-xs sm:text-xs font-semibold text-sys-text-secondary mt-1 whitespace-nowrap">
              {startT}
            </span>
            {isLive && (
              <span className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-sys-accent whitespace-nowrap">
                <span className="h-1.5 w-1.5 shrink-0 animate-ping rounded-full bg-sys-accent" />
                <span>{remainingMin}хв</span>
              </span>
            )}
          </div>
        )}

        {/* Right: full remaining width column */}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {/* Row 1: Subject name */}
          <div className="min-w-0">
            <h3
              title={lesson.subject_name}
              className={`font-semibold leading-snug text-sm sm:text-[15px] ${
                "break-words"
              } ${
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

          {/* Row 2: Teacher(s) - compressed into single lines for week view */}
          {isDualTeachers ? (
            isSingleSubgroupShown ? (
              <div className="flex items-center gap-1.5 min-w-0 text-xs text-sys-text-secondary mt-0.5">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); e.preventDefault(); handleSubgroupToggle(singleSubgroupIdx + 1); }}
                  title={`Ваша підгрупа ${singleSubgroupIdx + 1} (натисніть, щоб скинути або перемкнути)`}
                  aria-label={`Ваша підгрупа ${singleSubgroupIdx + 1} (натисніть, щоб скинути або перемкнути)`}
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold border ${
                    singleSubgroupIdx === 0
                      ? "bg-sky-500/20 text-sky-400 border-sky-500/40"
                      : "bg-indigo-500/20 text-indigo-400 border-indigo-500/40"
                  }`}
                >
                  {singleSubgroupIdx + 1} підгр.
                </button>
                <svg
                  width="12"
                  height="12"
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
                {onQuickJump ? (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onQuickJump(secondaryItems[singleSubgroupIdx].target); }}
                    className="text-left text-xs font-medium text-sys-text-secondary hover:text-sys-accent hover:underline focus:outline-none break-words"
                    title={secondaryItems[singleSubgroupIdx].displayName}
                  >
                    {secondaryItems[singleSubgroupIdx].displayName}
                  </button>
                ) : (
                  <span className="text-xs font-medium text-sys-text-secondary break-words" title={secondaryItems[singleSubgroupIdx].displayName}>
                    {secondaryItems[singleSubgroupIdx].displayName}
                  </span>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-2 text-xs text-sys-text-secondary w-full mt-1">
                {secondaryItems.map((item, idx) => {
                  const subNum = idx + 1;
                  if (effectiveSubgroup !== null && effectiveSubgroup !== subNum) {
                    return null;
                  }
                  const isFaded = selectedSubgroup !== null && selectedSubgroup !== subNum;
                  const ownMeeting = teacherMeetings[idx];
                  const ownRoom = (idx === 0 ? lesson.teacher_room : lesson.second_teacher_room) || rooms[idx] || null;
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
                          onClick={(e) => { e.stopPropagation(); e.preventDefault(); handleSubgroupToggle(subNum); }}
                          title={effectiveSubgroup === subNum ? "Ваша підгрупа (натисніть для скидання)" : `Обрати ${subNum} підгрупу`}
                          aria-label={effectiveSubgroup === subNum ? "Ваша підгрупа (натисніть для скидання)" : `Обрати ${subNum} підгрупу`}
                          className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold transition-colors ${
                            effectiveSubgroup === subNum
                              ? subNum === 1
                                ? "bg-sky-500/20 text-sky-400 font-bold border border-sky-500/40"
                                : "bg-indigo-500/20 text-indigo-400 font-bold border border-indigo-500/40"
                              : subNum === 1
                                ? "bg-sys-card border border-sys-border text-slate-400 hover:text-slate-200 hover:border-sky-500/40"
                                : "bg-sys-card border border-sys-border text-slate-400 hover:text-slate-200 hover:border-indigo-500/40"
                          }`}
                        >
                          {subNum} підгр.
                        </button>
                        <svg
                          width="12"
                          height="12"
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
                        {onQuickJump ? (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onQuickJump(item.target); }}
                            className="text-left text-xs font-medium text-sys-text-secondary hover:text-sys-accent hover:underline focus:outline-none break-words leading-tight"
                            title={item.displayName}
                          >
                            {item.displayName}
                          </button>
                        ) : (
                          <span className="text-xs font-medium text-sys-text-secondary break-words leading-tight" title={item.displayName}>
                            {item.displayName}
                          </span>
                        )}
                      </div>
                      {ownMeeting ? (
                        <div className="flex items-center justify-end w-full pl-5">
                          {!hasGroupAccess || ownMeeting.isProtected ? (
                            <LockedMeetingBadge
                              platform={ownMeeting.platform}
                              size="tiny"
                              onClick={handleLockedMeetingClick}
                            />
                          ) : (
                            <a
                              href={ownMeeting.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => { e.stopPropagation(); vibrateTap(12); }}
                              className={`inline-flex shrink-0 h-6 px-2 items-center gap-1.5 rounded-md border text-[11px] font-semibold whitespace-nowrap active:scale-95 transition-all ${
                                getMeetingBtnStyle(ownMeeting.platform, isLive && isMeetingLiveOrSoon, "tiny")
                              }`}
                            >
                              <MeetingPlatformIcon platform={ownMeeting.platform} size={11} />
                              <span>{ownMeeting.platform === "zoom" ? "Zoom" : ownMeeting.platform === "meet" ? "Meet" : "Онлайн"}</span>
                              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-70">
                                <path d="M7 17 17 7" />
                                <path d="M7 7h10v10" />
                              </svg>
                            </a>
                          )}
                        </div>
                      ) : ownRoom ? (
                        <div className="flex items-center justify-end w-full pl-5">
                          <span className="shrink-0 rounded-md border border-sys-border bg-sys-bg px-1.5 py-0.5 text-[11px] font-semibold leading-none text-sys-text-secondary whitespace-nowrap">
                            {`ауд. ${ownRoom.replace(/^ауд\.?\s*/i, "")}`}
                          </span>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )
          ) : secondaryItems.length > 0 ? (
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
          ) : null}

          {/* Row 3: Badges on left, actions on right; pinned to bottom with mt-auto */}
          <div
            className="mt-auto flex flex-wrap items-end gap-x-2 gap-y-1.5 pt-2 w-full"
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
              {/* Show room badge if rooms exist (independent of online meetings) */}
              {(!isDualTeachers || isSingleSubgroupShown) && displayRooms.length > 0 && (
                displayRooms.map((rm, idx) => (
                  <span
                    key={`${rm}-${idx}`}
                    title={formatRoom(rm)}
                    className="inline-flex max-w-full items-center rounded-md border border-sys-border bg-sys-tabActive px-2 py-0.5 text-xs font-medium text-sys-text-primary whitespace-nowrap"
                  >
                    <span>{formatRoom(rm)}</span>
                  </span>
                ))
              )}

              {/* Online meetings */}
              {weekGridMeetings.map((m, idx) => (
                !hasGroupAccess || m.isProtected ? (
                  <LockedMeetingBadge
                    key={`${m.url}-${idx}`}
                    platform={m.platform}
                    size="tiny"
                    onClick={handleLockedMeetingClick}
                  />
                ) : (
                  <a
                    key={`${m.url}-${idx}`}
                    href={m.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => {
                      e.stopPropagation();
                      vibrateTap(12);
                    }}
                    className={`inline-flex h-6 min-h-[24px] items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-semibold active:scale-95 transition-all ${
                      getMeetingBtnStyle(m.platform, isLive && isMeetingLiveOrSoon, "tiny")
                    }`}
                  >
                    <MeetingPlatformIcon platform={m.platform} size={12} />
                    <span>
                      {m.platform === "zoom" ? "Zoom" : m.platform === "meet" ? "Meet" : "Онлайн"}
                    </span>
                    <span className="text-[11px] font-bold opacity-75">↗</span>
                  </a>
                )
              ))}

              {showHw && tasks.length > 0 && (
                <button
                  type="button"
                  onClick={toggleHw}
                  aria-expanded={isHwOpen}
                  aria-controls={`hw-list-${lesson.id}-${lesson.lesson_number}`}
                  title={isHwOpen ? "Згорнути завдання" : `${tasks.length} ДЗ (${getTaskStatusText(tasks[0].deadline, isLinked) || "без терміну"})`}
                  aria-label={isHwOpen ? "Згорнути завдання" : `${tasks.length} ДЗ (${getTaskStatusText(tasks[0].deadline, isLinked) || "без терміну"})`}
                  className={`inline-flex h-6 min-h-[24px] items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold transition-all active:scale-95 ${
                    tasks[0].deadline.badgeTone === "overdue" && isLinked
                      ? "border-rose-500/40 bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-300 hover:border-rose-500/60"
                      : tasks[0].deadline.badgeTone === "urgent"
                      ? "border-amber-500/40 bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-300 hover:border-amber-500/60"
                      : "border-purple-500/30 bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-300 hover:border-purple-500/50"
                  }`}
                >
                  {tasks[0].deadline.badgeTone === "overdue" && isLinked ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-rose-500 dark:text-rose-400 shrink-0">
                      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                      <line x1="12" y1="9" x2="12" y2="13" />
                      <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                  ) : null}
                  <span>{tasks.length} ДЗ</span>
                  <span className={`text-xs text-sys-text-muted transition-transform duration-150 ${isHwOpen ? "rotate-180" : ""}`}>
                    ▾
                  </span>
                </button>
              )}

              {renderTemplateWeekBadge()}
              {renderStatusBadge(true)}
            </div>

            {/* Actions for canEdit pinned to bottom-right (on desktop visible on hover, on mobile always visible) */}
            {canEdit && (
              <div
                className="relative flex items-center gap-1 shrink-0 whitespace-nowrap ml-auto lg:opacity-0 lg:group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
                style={{
                  flex: "0 0 auto",
                  marginLeft: "auto",
                  whiteSpace: "nowrap",
                }}
              >
                {lesson.is_cancelled ? (
                  <div className="flex items-center gap-1">
                    {onRestoreDated && lesson.group_id && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRestoreDated(lesson, targetDate);
                        }}
                        title={lesson.moved_to_date ? "Скасувати перенесення та відновити пару" : `Відновити пару на ${targetDate}`}
                        aria-label={lesson.moved_to_date ? "Скасувати перенесення та відновити пару" : `Відновити пару на ${targetDate}`}
                        className="inline-flex min-h-[44px] min-w-[44px] sm:min-h-[32px] items-center justify-center rounded-md border border-emerald-500/50 bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-400 hover:bg-emerald-500/25 active:scale-[0.98] transition-colors whitespace-nowrap"
                        style={{ whiteSpace: "nowrap" }}
                      >
                        Відновити
                      </button>
                    )}
                    {onRemoveReplacement && lesson.group_id && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveReplacement(lesson, targetDate);
                        }}
                        title="Очистити слот (повністю прибрати скасовану пару)"
                        aria-label="Очистити слот"
                        className="inline-flex min-h-[44px] sm:min-h-[32px] items-center justify-center rounded-md border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-xs font-semibold text-rose-300 hover:bg-rose-500/20 active:scale-[0.98] transition-colors whitespace-nowrap"
                        style={{ whiteSpace: "nowrap" }}
                      >
                        Очистити
                      </button>
                    )}
                  </div>
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

                    {renderMoreMenu(true)}
                  </>
                )}
              </div>
            )}
          </div>

          {/* Week mode tasks popover floating over grid without stretching table rows */}
          {showHw && tasks.length > 0 && isHwOpen && (
            <div
              id={`hw-list-${lesson.id}-${lesson.lesson_number}`}
              onClick={(e) => e.stopPropagation()}
              className={`absolute left-0 right-0 ${
                lesson.lesson_number >= 3 ? "bottom-full mb-1" : "top-full mt-1"
              } z-40 max-h-60 overflow-y-auto rounded-xl border border-sys-border bg-sys-card p-2.5 shadow-2xl animate-in fade-in duration-150`}
            >
              <div className="flex items-center justify-between pb-1.5 mb-2 border-b border-sys-border/60 text-xs font-semibold text-sys-text-secondary">
                <span className="flex items-center gap-1.5 truncate">
                  <span className="font-bold text-sys-text-primary">{formatTaskCount(tasks.length)}</span>
                  {nearestDated && (
                    <span className="text-xs text-sys-text-muted truncate">
                      (найближче {nearestDated.deadline.statusText.startsWith("до") ? nearestDated.deadline.statusText : `до ${nearestDated.deadline.formattedDate}`})
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={toggleHw}
                  aria-label="Закрити"
                  className="rounded p-0.5 text-sys-text-muted hover:text-sys-text-primary hover:bg-sys-bg transition-colors shrink-0 ml-1 cursor-pointer"
                >
                  ✕
                </button>
              </div>
              <div className="flex flex-col gap-1.5">
                {groupedTasks.map((group, gIdx) => (
                  <div key={gIdx} className="flex flex-col gap-1">
                    {group.teacher && (
                      <span className="text-xs font-bold text-sys-text-secondary pt-0.5">
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
                        title={`${task.teacher ? `[${task.teacher}] ` : ""}${task.title || "Завдання"} — Відкрити в Classroom`}
                        className="group flex items-center justify-between gap-2 rounded-lg border border-sys-border bg-sys-bg/80 px-2.5 py-1.5 text-xs text-sys-text-primary hover:border-sys-elevated-border hover:bg-sys-surface transition-colors"
                      >
                        <div className="flex min-w-0 flex-col">
                          <span className="font-semibold text-sys-text-primary truncate text-xs group-hover:text-sys-accent transition-colors">
                            {task.title || "Завдання"}
                          </span>
                          {task.deadline.statusText ? (
                            <span className={`text-xs ${getTaskDeadlineTextColor(task.deadline.badgeTone, isLinked)}`}>
                              {getTaskStatusText(task.deadline, isLinked)}
                            </span>
                          ) : null}
                        </div>
                        <span className="shrink-0 text-xs text-sys-text-muted group-hover:text-sys-accent transition-colors ml-1">
                          ↗
                        </span>
                      </a>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* User note (compact text under badges) */}
          {visibleNoteText && (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-sys-text-secondary/90 [overflow-wrap:anywhere] italic border-t border-sys-border/20 pt-1">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-sys-text-muted">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <span>{visibleNoteText}</span>
            </p>
          )}
        </div>
      </div>
    )}

      {noteModalMode && (
        <LessonNoteModal
          lesson={lesson}
          date={targetDate}
          initialMode={noteModalMode}
          onClose={() => setNoteModalMode(null)}
        />
      )}

      {/* Progress bar inside card padding for live lesson */}
      {isLive && (
        <div className="absolute left-4 right-4 bottom-2.5 h-[3px] rounded-full overflow-hidden bg-blue-500/20">
          <div
            className="h-full rounded-full bg-sys-accent transition-all duration-500 ease-out"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      )}
    </article>
  );
});
