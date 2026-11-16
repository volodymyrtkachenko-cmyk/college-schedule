import { extractClassroomTaskKey } from "../classroomTaskFilter";
import { formatKyivDateIso } from "../date";
import { normalizeSubjectName } from "../format";
import { pluralDays } from "../lesson-card/taskDeadlines";

export const OVERDUE_BANNER_STORAGE_KEY = "schedule:overdue_banner_dismissal";
export const OVERDUE_BANNER_SYNC_EVENT = "schedule:overdue-banner-sync";

export interface OverdueTaskIdentityInput {
  id?: string;
  url?: string;
  title?: string;
  subject?: string;
  dueDateIso?: string | null;
  deadline?: {
    overdueDays?: number;
    formattedDate?: string;
  };
}

export interface OverdueBannerDismissal {
  dismissedAtIso: string;
  taskIds: string[];
  scopeKey: string;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Formats an overdue task count with proper Ukrainian adjective + noun agreement:
 * - 1 -> "1 прострочене завдання"
 * - 2..4 -> "2 прострочені завдання"
 * - 5..20 -> "5 прострочених завдань"
 */
export function formatOverdueTasksPhrase(count: number): string {
  const safe = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  const mod10 = safe % 10;
  const mod100 = safe % 100;

  if (mod10 === 1 && mod100 !== 11) {
    return `${safe} прострочене завдання`;
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${safe} прострочені завдання`;
  }
  return `${safe} прострочених завдань`;
}

export function formatOverdueBannerMessage(count: number): string {
  return `У вас ${formatOverdueTasksPhrase(count)}`;
}

export function resolveOverdueScopeKey(groupId?: number | null): string {
  return typeof groupId === "number" && Number.isFinite(groupId) && groupId > 0
    ? `g:${groupId}`
    : "g:default";
}

export function getOverdueTaskStableKey(task: OverdueTaskIdentityInput): string {
  const fromUrl = task.url ? extractClassroomTaskKey(task.url) : null;
  if (fromUrl) return fromUrl;

  const trimmedUrl = typeof task.url === "string" ? task.url.trim() : "";
  if (trimmedUrl) return trimmedUrl;

  const trimmedId = typeof task.id === "string" ? task.id.trim() : "";
  if (trimmedId) return trimmedId;

  const subject = normalizeSubjectName(task.subject || "").trim().toLowerCase();
  const title = (task.title || "").trim().toLowerCase();
  const due = (task.dueDateIso || "").trim();
  return `${subject}::${title}::${due}`;
}

export function collectOverdueTaskKeys(tasks: readonly OverdueTaskIdentityInput[]): string[] {
  const seen = new Set<string>();
  for (const task of tasks) {
    const key = getOverdueTaskStableKey(task);
    if (key) seen.add(key);
  }
  return Array.from(seen).sort();
}

export function pickPriorityOverdueTask<T extends OverdueTaskIdentityInput>(
  tasks: readonly T[]
): T | null {
  if (tasks.length === 0) return null;
  let best = tasks[0];
  for (let i = 1; i < tasks.length; i += 1) {
    const candidate = tasks[i];
    const bestDays = best.deadline?.overdueDays ?? 0;
    const candDays = candidate.deadline?.overdueDays ?? 0;
    if (candDays > bestDays) {
      best = candidate;
    } else if (candDays === bestDays) {
      const bestDue = best.dueDateIso || "";
      const candDue = candidate.dueDateIso || "";
      if (candDue && (!bestDue || candDue < bestDue)) {
        best = candidate;
      }
    }
  }
  return best;
}

export function formatOverduePriorityPreview(
  tasks: readonly OverdueTaskIdentityInput[]
): string | null {
  const priority = pickPriorityOverdueTask(tasks);
  if (!priority) return null;

  const subjectName = normalizeSubjectName(priority.subject || "").trim();
  const cleanTitle = (priority.title || "").trim();
  const label = subjectName || cleanTitle || "Прострочене завдання";
  const prefix = tasks.length > 1 ? "Найдавніше: " : "";
  const days = priority.deadline?.overdueDays ?? 0;

  if (days > 0) {
    return `${prefix}${label} · прострочено ${days} ${pluralDays(days)}`;
  }
  const formattedDate = priority.deadline?.formattedDate?.trim();
  if (formattedDate) {
    return `${prefix}${label} · ${formattedDate}`;
  }
  return `${prefix}${label}`;
}

export function parseOverdueBannerDismissal(raw: string | null): OverdueBannerDismissal | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.dismissedAtIso !== "string" || !ISO_DATE_RE.test(obj.dismissedAtIso)) {
      return null;
    }
    if (!Array.isArray(obj.taskIds)) return null;
    const taskIds = obj.taskIds.filter(
      (id): id is string => typeof id === "string" && id.length > 0
    );
    const scopeKey =
      typeof obj.scopeKey === "string" && obj.scopeKey.length > 0 ? obj.scopeKey : "g:default";
    return {
      dismissedAtIso: obj.dismissedAtIso,
      taskIds,
      scopeKey,
    };
  } catch {
    return null;
  }
}

export function shouldShowOverdueBanner({
  isLinked,
  overdueTaskKeys,
  dismissal,
  todayKyivIso = formatKyivDateIso(),
  scopeKey = "g:default",
}: {
  isLinked: boolean;
  overdueTaskKeys: readonly string[];
  dismissal: OverdueBannerDismissal | null;
  todayKyivIso?: string;
  scopeKey?: string;
}): boolean {
  if (!isLinked || overdueTaskKeys.length === 0) {
    return false;
  }
  if (!dismissal) {
    return true;
  }
  if (dismissal.scopeKey !== scopeKey) {
    return true;
  }
  // Snooze persists only until the next Kyiv calendar day.
  if (dismissal.dismissedAtIso !== todayKyivIso) {
    return true;
  }
  // Wake immediately if any unseen overdue task arrives on the same day.
  const knownIds = new Set(dismissal.taskIds);
  for (const key of overdueTaskKeys) {
    if (!knownIds.has(key)) {
      return true;
    }
  }
  return false;
}

export function readOverdueBannerDismissal(): OverdueBannerDismissal | null {
  if (typeof window === "undefined") return null;
  try {
    return parseOverdueBannerDismissal(window.localStorage.getItem(OVERDUE_BANNER_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function saveOverdueBannerDismissal({
  overdueTaskKeys,
  todayKyivIso = formatKyivDateIso(),
  scopeKey = "g:default",
}: {
  overdueTaskKeys: readonly string[];
  todayKyivIso?: string;
  scopeKey?: string;
}): OverdueBannerDismissal {
  const next: OverdueBannerDismissal = {
    dismissedAtIso: todayKyivIso,
    taskIds: Array.from(new Set(overdueTaskKeys)).sort(),
    scopeKey,
  };
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(OVERDUE_BANNER_STORAGE_KEY, JSON.stringify(next));
      window.dispatchEvent(new Event(OVERDUE_BANNER_SYNC_EVENT));
    } catch {}
  }
  return next;
}

export function clearOverdueBannerDismissal(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(OVERDUE_BANNER_STORAGE_KEY);
    window.dispatchEvent(new Event(OVERDUE_BANNER_SYNC_EVENT));
  } catch {}
}
