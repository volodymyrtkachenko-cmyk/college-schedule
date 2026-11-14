import { classroomApi } from "./api/classroom";

export const CLASSROOM_STORAGE_KEYS = {
  LINKED_EMAIL: "schedule:classroom_linked_email",
  GOOGLE_USER_ID: "schedule:classroom_google_user_id",
  LINKED_GROUP_ID: "schedule:classroom_linked_group_id",
  SUBMITTED_TASKS: "schedule:classroom_submitted_tasks",
  PERSONAL_TEACHERS: "schedule:classroom_personal_teachers",
  PERSONAL_SUBGROUP: "schedule:classroom_personal_subgroup",
  ACCESS_TOKEN: "schedule:classroom_access_token",
  ACCESS_TOKEN_EXP: "schedule:classroom_access_token_exp",
  REFRESH_TOKEN: "schedule:classroom_refresh_token",
  NEEDS_RELINK: "schedule:classroom_needs_relink",
  NEEDS_RELINK_REASON: "schedule:classroom_needs_relink_reason",
  SELECTED_SUBGROUP: "schedule_selected_subgroup",
} as const;

export const CLASSROOM_LINKED_EVENT = "classroom-linked-change";
export const CLASSROOM_ACCESS_EVENT = "classroom-access-changed";

export type ClassroomUnlinkStatus = "idle" | "pending" | "success" | "error";

export interface ClassroomUnlinkResult {
  ok: boolean;
  serverConfirmed: boolean;
  error?: string;
}

export interface ClassroomUnlinkState {
  status: ClassroomUnlinkStatus;
  isUnlinking: boolean;
  error: string | null;
}

export type ClassroomDisconnectFn = typeof classroomApi.disconnect;

let _unlinkState: ClassroomUnlinkState = {
  status: "idle",
  isUnlinking: false,
  error: null,
};
let _inFlightUnlink: Promise<ClassroomUnlinkResult> | null = null;
const _stateListeners = new Set<() => void>();

function notifyStateListeners(): void {
  _stateListeners.forEach((cb) => cb());
}

function setUnlinkState(next: ClassroomUnlinkState): void {
  _unlinkState = next;
  notifyStateListeners();
}

export function getClassroomUnlinkState(): ClassroomUnlinkState {
  return _unlinkState;
}

export function subscribeClassroomUnlinkState(cb: () => void): () => void {
  _stateListeners.add(cb);
  return () => {
    _stateListeners.delete(cb);
  };
}

export function clearClassroomUnlinkError(): void {
  if (_unlinkState.error === null && _unlinkState.status !== "error") return;
  setUnlinkState({
    status: _unlinkState.isUnlinking ? "pending" : "idle",
    isUnlinking: _unlinkState.isUnlinking,
    error: null,
  });
}

export function resetClassroomUnlinkState(): void {
  if (_unlinkState.status === "idle" && !_unlinkState.isUnlinking && _unlinkState.error === null) {
    return;
  }
  setUnlinkState({ status: "idle", isUnlinking: false, error: null });
}

/** Formats disconnect errors into actionable Ukrainian guidance without hiding failure. */
export function formatClassroomUnlinkError(err: unknown): string {
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  if (offline) {
    return "Немає підключення до мережі. Перевірте інтернет і повторіть спробу — акаунт лишається прив'язаним на сервері.";
  }

  const rawMsg = err instanceof Error ? err.message.trim() : "";
  const isNetworkErr =
    err instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(rawMsg);
  if (isNetworkErr) {
    return "Не вдалося зв'язатися із сервером. Перевірте мережу та повторіть спробу — акаунт ще прив'язаний.";
  }

  if (rawMsg) {
    const clean = rawMsg.endsWith(".") ? rawMsg.slice(0, -1) : rawMsg;
    return `${clean}. Акаунт ще не відв'язано на сервері — повторіть спробу.`;
  }

  return "Не вдалося підтвердити відв'язання Classroom на сервері. Повторіть спробу.";
}

function clearLocalClassroomKeys(storage: Storage): void {
  storage.removeItem(CLASSROOM_STORAGE_KEYS.LINKED_EMAIL);
  storage.removeItem(CLASSROOM_STORAGE_KEYS.GOOGLE_USER_ID);
  storage.removeItem(CLASSROOM_STORAGE_KEYS.LINKED_GROUP_ID);
  storage.removeItem(CLASSROOM_STORAGE_KEYS.SUBMITTED_TASKS);
  storage.removeItem(CLASSROOM_STORAGE_KEYS.PERSONAL_TEACHERS);
  storage.removeItem(CLASSROOM_STORAGE_KEYS.PERSONAL_SUBGROUP);
  storage.removeItem(CLASSROOM_STORAGE_KEYS.ACCESS_TOKEN);
  storage.removeItem(CLASSROOM_STORAGE_KEYS.ACCESS_TOKEN_EXP);
  storage.removeItem(CLASSROOM_STORAGE_KEYS.REFRESH_TOKEN);
  storage.removeItem(CLASSROOM_STORAGE_KEYS.NEEDS_RELINK);
  storage.removeItem(CLASSROOM_STORAGE_KEYS.NEEDS_RELINK_REASON);
  try {
    storage.removeItem(CLASSROOM_STORAGE_KEYS.SELECTED_SUBGROUP);
  } catch {}
}

export interface PerformClassroomUnlinkOptions {
  disconnect?: ClassroomDisconnectFn;
  onClearCaches?: () => void;
}

/**
 * Disconnects Google Classroom on the server first and only clears local
 * identity and private caches once confirmed. Deduplicates overlapping clicks.
 */
export async function performClassroomUnlink(
  options: PerformClassroomUnlinkOptions = {}
): Promise<ClassroomUnlinkResult> {
  if (typeof window === "undefined") {
    return { ok: false, serverConfirmed: false, error: "Операція доступна лише в браузері." };
  }

  if (_inFlightUnlink) {
    return _inFlightUnlink;
  }

  const disconnectFn = options.disconnect ?? classroomApi.disconnect;

  const run = (async (): Promise<ClassroomUnlinkResult> => {
    let storage: Storage;
    try {
      storage = window.localStorage;
    } catch {
      const msg = "Локальне сховище браузера недоступне.";
      setUnlinkState({ status: "error", isUnlinking: false, error: msg });
      return { ok: false, serverConfirmed: false, error: msg };
    }

    const googleUserId = storage.getItem(CLASSROOM_STORAGE_KEYS.GOOGLE_USER_ID);
    const groupIdRaw = storage.getItem(CLASSROOM_STORAGE_KEYS.LINKED_GROUP_ID);
    const accessToken = storage.getItem(CLASSROOM_STORAGE_KEYS.ACCESS_TOKEN);
    const refreshToken = storage.getItem(CLASSROOM_STORAGE_KEYS.REFRESH_TOKEN);
    const parsedGroupId = groupIdRaw ? Number(groupIdRaw) : undefined;
    const groupId = parsedGroupId && !Number.isNaN(parsedGroupId) ? parsedGroupId : undefined;

    const hasServerCredentials = Boolean(googleUserId || accessToken || refreshToken);

    setUnlinkState({ status: "pending", isUnlinking: true, error: null });

    if (hasServerCredentials) {
      try {
        await disconnectFn({
          group_id: groupId,
          google_user_id: googleUserId || undefined,
          access_token: accessToken || undefined,
          refresh_token: refreshToken || undefined,
        });
      } catch (err) {
        const message = formatClassroomUnlinkError(err);
        setUnlinkState({ status: "error", isUnlinking: false, error: message });
        return { ok: false, serverConfirmed: false, error: message };
      }
    }

    try {
      clearLocalClassroomKeys(storage);
      options.onClearCaches?.();
    } catch {}

    try {
      window.dispatchEvent(new Event(CLASSROOM_LINKED_EVENT));
      window.dispatchEvent(new Event(CLASSROOM_ACCESS_EVENT));
    } catch {}

    setUnlinkState({ status: "success", isUnlinking: false, error: null });
    return { ok: true, serverConfirmed: hasServerCredentials };
  })();

  _inFlightUnlink = run;
  try {
    return await run;
  } finally {
    if (_inFlightUnlink === run) {
      _inFlightUnlink = null;
    }
  }
}
