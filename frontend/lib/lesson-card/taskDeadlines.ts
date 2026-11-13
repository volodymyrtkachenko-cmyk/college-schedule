import { getSyncedNow } from "../date";

const KYIV_DATE_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" });

export const UKR_MONTHS_SHORT = [
  "січ.", "лют.", "бер.", "квіт.", "трав.", "черв.",
  "лип.", "серп.", "вер.", "жовт.", "лист.", "груд."
];

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

  const now = getSyncedNow();
  const kyivNowStr = KYIV_DATE_FMT.format(now);
  const [nowYear, nowMonth, nowDay] = kyivNowStr.split("-").map(Number);

  let year = nowYear;
  if (month - nowMonth > 6) year -= 1;
  else if (nowMonth - month > 6) year += 1;

  const targetDate = new Date(year, month - 1, day, 12, 0, 0);
  const todayDate = new Date(nowYear, nowMonth - 1, nowDay, 12, 0, 0);

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

export interface PublishedTaskLike {
  creationTime?: string | null;
  creation_time?: string | null;
  created_at?: string | null;
  dueDateIso?: string | null;
  deadline?: { date: Date | null } | null;
}

/**
 * Returns the publication timestamp (creationTime / created_at) for newest-first sorting,
 * falling back to due date when publication metadata is absent in older caches.
 */
export function getTaskPublishedTimestamp(t: PublishedTaskLike): number {
  const rawCreated = t.creationTime || t.creation_time || t.created_at;
  if (rawCreated) {
    const parsed = Date.parse(rawCreated);
    if (!Number.isNaN(parsed)) return parsed;
  }
  if (t.dueDateIso) {
    const parsedDue = Date.parse(t.dueDateIso);
    if (!Number.isNaN(parsedDue)) return parsedDue;
  }
  if (t.deadline?.date) {
    return t.deadline.date.getTime();
  }
  return 0;
}

export function sortTasksByDeadline<
  T extends { deadline: TaskDeadline; state?: string } & PublishedTaskLike,
>(taskList: T[]): T[] {
  return [...taskList].sort((a, b) => {
    const isDoneA = a.state === "TURNED_IN" || a.state === "RETURNED";
    const isDoneB = b.state === "TURNED_IN" || b.state === "RETURNED";
    if (isDoneA && !isDoneB) return 1;
    if (!isDoneA && isDoneB) return -1;

    if (a.deadline.isOverdue && !b.deadline.isOverdue) return -1;
    if (!a.deadline.isOverdue && b.deadline.isOverdue) return 1;

    if (a.deadline.isOverdue && b.deadline.isOverdue) {
      const timeA = a.deadline.date ? a.deadline.date.getTime() : 0;
      const timeB = b.deadline.date ? b.deadline.date.getTime() : 0;
      if (timeA !== timeB) return timeA - timeB;
      return getTaskPublishedTimestamp(b) - getTaskPublishedTimestamp(a);
    }

    const hasDateA = Boolean(a.deadline.date);
    const hasDateB = Boolean(b.deadline.date);
    if (hasDateA && !hasDateB) return -1;
    if (!hasDateA && hasDateB) return 1;

    if (hasDateA && hasDateB) {
      const timeA = a.deadline.date ? a.deadline.date.getTime() : Infinity;
      const timeB = b.deadline.date ? b.deadline.date.getTime() : Infinity;
      if (timeA !== timeB) return timeA - timeB;
      return getTaskPublishedTimestamp(b) - getTaskPublishedTimestamp(a);
    }

    return getTaskPublishedTimestamp(b) - getTaskPublishedTimestamp(a);
  });
}

export function hasAllTasksCompleted(note?: string | null): boolean {
  if (!note) return false;
  return note.includes("[TASKS_COMPLETED]");
}
