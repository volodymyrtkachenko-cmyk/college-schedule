"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  api,
  ScheduleResponse,
  invalidateEtagCache,
  invalidateGroupStatusCache,
} from "./api";
import { useAuth } from "./auth";
import { addDaysToCalendarIso, getCalendarWeekdayMon0 } from "./calendarDate";
import { formatKyivDateIso } from "./date";
import { checkScheduleHasSubgroups, extractSubgroupTeacherHints } from "./format";
import {
  ONBOARDING_CHANGE_EVENT,
  readStoredSetupComplete,
  writeStoredSetupComplete,
} from "./onboarding";
import { findTeacherBySlug } from "./slug";

function safeDecodePathnameSegment(raw: string): string {
  let decoded = raw;
  for (let i = 0; i < 2; i++) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded;
}

function matchEntityFromPathname(
  pathname: string,
  groupsList: import("./api").ReferenceRecord[],
  teachersList: import("./api").ReferenceRecord[]
): { mode: "student"; id: number } | { mode: "teacher"; id: number } | null {
  const groupMatch = pathname.match(/^\/group\/([^/]+)/);
  if (groupMatch && groupsList.length > 0) {
    const rawCode = safeDecodePathnameSegment(groupMatch[1]).trim().toLowerCase();
    const found = groupsList.find((g) => g.name.toLowerCase() === rawCode);
    if (found) return { mode: "student", id: found.id };
  }
  const teacherMatch = pathname.match(/^\/teacher\/([^/]+)/);
  if (teacherMatch && teachersList.length > 0) {
    const rawSlug = safeDecodePathnameSegment(teacherMatch[1]).trim();
    const found = findTeacherBySlug(teachersList, rawSlug);
    if (found) return { mode: "teacher", id: found.id };
  }
  return null;
}

const memoryCache = new Map<
  string,
  { time: number; today: ScheduleResponse; week: ScheduleResponse[]; rawJson: string }
>();
const CACHE_TTL = 1000 * 60 * 5; // 5 хвилин без зайвих фонових запитів

export function clearScheduleLocalStorageCache() {
  if (typeof window === "undefined") return;
  try {
    for (let index = 0; index < window.localStorage.length; index++) {
      const key = window.localStorage.key(index);
      if (key?.startsWith("schedule:today:") || key?.startsWith("schedule:week:")) {
        window.localStorage.removeItem(key);
        index--;
      }
    }
  } catch {}
}

/**
 * Очищає застарілі тижні з localStorage (зберігає лише останні maxWeeksToKeep тижнів),
 * щоб сховище браузера на мобільних телефонах не роздувалося.
 */
function pruneOldScheduleCache(targetKey: string, maxWeeksToKeep = 6) {
  if (typeof window === "undefined") return;
  try {
    const prefix = `schedule:week:${targetKey}:`;
    const entries: { key: string; date: string }[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(prefix)) {
        const m = k.match(/:(\d{4}-\d{2}-\d{2})/);
        entries.push({ key: k, date: m ? m[1] : "" });
      }
    }
    if (entries.length > maxWeeksToKeep) {
      entries.sort((a, b) => a.date.localeCompare(b.date));
      const toRemove = entries.slice(0, entries.length - maxWeeksToKeep);
      for (const item of toRemove) {
        window.localStorage.removeItem(item.key);
      }
    }
  } catch {}
}

/**
 * Обмежує розростання допоміжних групових кешів (завдання груп, підказки підгруп, часи синхронізації)
 * у межах останніх переглянутих груп, щоб не вичерпати 5 MB ліміт localStorage на Safari iOS.
 */
export function pruneGroupAuxiliaryCaches(
  activeGroupIds: ReadonlyArray<number | null | undefined> = [],
  maxExtraGroups = 8
) {
  if (typeof window === "undefined") return;
  try {
    const keepIds = new Set<string>();
    const savedGid = window.localStorage.getItem("schedule:groupId");
    const linkedGid = window.localStorage.getItem("schedule:classroom_linked_group_id");
    if (savedGid) keepIds.add(savedGid);
    if (linkedGid) keepIds.add(linkedGid);
    for (const id of activeGroupIds) {
      if (id != null && Number.isFinite(Number(id)) && Number(id) > 0) {
        keepIds.add(String(id));
      }
    }

    try {
      const recentRaw = window.localStorage.getItem("schedule:recent_groups");
      const recent = recentRaw ? JSON.parse(recentRaw) : [];
      if (Array.isArray(recent)) {
        for (const rid of recent.slice(0, maxExtraGroups)) {
          if (rid != null) keepIds.add(String(rid));
        }
      }
    } catch {}

    const auxPrefixes = [
      "schedule:classroom_group_tasks:",
      "schedule:has_subgroups:",
      "schedule:subgroup_hints:",
      "schedule:last_synced_at:",
    ];
    const discoveredIds: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key) continue;
      for (const prefix of auxPrefixes) {
        if (key.startsWith(prefix)) {
          const gidStr = key.slice(prefix.length).trim();
          if (gidStr && !keepIds.has(gidStr) && !discoveredIds.includes(gidStr)) {
            discoveredIds.push(gidStr);
          }
          break;
        }
      }
    }

    const overflow = Math.max(0, discoveredIds.length - maxExtraGroups);
    if (overflow > 0) {
      for (const dropId of discoveredIds.slice(0, overflow)) {
        for (const prefix of auxPrefixes) {
          window.localStorage.removeItem(`${prefix}${dropId}`);
        }
      }
    }
  } catch {}
}

/**
 * За замовчуванням НЕ стираємо localStorage, щоб розклад ніколи не зникав у скелетони
 * і не блимав перед очима користувача під час фонової синхронізації.
 */
export function invalidateScheduleCache(forceClearStorage = false) {
  memoryCache.clear();
  invalidateEtagCache();
  invalidateGroupStatusCache();
  if (forceClearStorage) {
    clearScheduleLocalStorageCache();
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("schedule:refresh"));
  }
}

export function useOnlineStatus() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

const EMPTY_SCHEDULE_WEEK: ScheduleResponse[] = [];

export function useSchedule(
  weekAnchorDate: Date,
  includeCancelled = false,
  initialGroups: import("./api").ReferenceRecord[] = [],
  initialTeachers: import("./api").ReferenceRecord[] = [],
  initialGroupId?: number | null,
  initialTeacherId?: number | null,
  initialMode?: "student" | "teacher",
  initialWeek: ScheduleResponse[] = EMPTY_SCHEDULE_WEEK,
  initialWeekStartIso?: string
) {
  const { user } = useAuth();

  const initialSeedToday = useMemo(
    () =>
      initialWeek.length > 0
        ? initialWeek.find((d) => d.lessons && d.lessons.length > 0) ?? initialWeek[0]
        : null,
    [initialWeek]
  );
  const initialWeekJson = useMemo(
    () => (initialWeek.length > 0 ? JSON.stringify(initialWeek) : ""),
    [initialWeek]
  );
  const hasInitialSeedOnMount = Boolean(
    !includeCancelled &&
      initialWeek.length > 0 &&
      initialWeekStartIso &&
      formatKyivDateIso(weekAnchorDate) === initialWeekStartIso &&
      ((initialMode ?? "student") === "student" ? Boolean(initialGroupId) : Boolean(initialTeacherId))
  );

  const [isSetupComplete, setIsSetupComplete] = useState<boolean>(Boolean(includeCancelled) || Boolean(user));
  const [mode, setMode] = useState<"student" | "teacher">(initialMode ?? "student");
  const [groups, setGroups] = useState<import("./api").ReferenceRecord[]>(initialGroups);
  const [teachers, setTeachers] = useState<import("./api").ReferenceRecord[]>(
    initialTeachers.filter((t) => t.name && !t.name.includes("!"))
  );
  const [groupId, setGroupId] = useState<number | null>(initialGroupId ?? null);
  const [teacherId, setTeacherId] = useState<number | null>(initialTeacherId ?? null);
  const [today, setToday] = useState<ScheduleResponse | null>(() =>
    hasInitialSeedOnMount ? initialSeedToday : null
  );
  const [week, setWeek] = useState<ScheduleResponse[]>(() =>
    hasInitialSeedOnMount ? initialWeek : []
  );
  const [semesterStart, setSemesterStart] = useState<string | null>(null);
  const [loading, setLoading] = useState(() =>
    Boolean(includeCancelled || initialGroupId || initialTeacherId) ? !hasInitialSeedOnMount : false
  );
  const [isSlowNetwork, setIsSlowNetwork] = useState(false);
  const [isUsingFallbackCache, setIsUsingFallbackCache] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Зберігаємо точний зліпок поточних даних на екрані, щоб не викликати setWeek/setToday, якщо дані з мережі не змінилися
  const lastRenderedWeekJsonRef = useRef<string>(hasInitialSeedOnMount ? initialWeekJson : "");
  const initialPathnameRef = useRef<string>(
    typeof window !== "undefined" ? window.location.pathname : ""
  );

  // Миттєве підняття кешу ДО першого кадру (0 мс старт без скелетонів і без сплэш-екрана)
  useIsomorphicLayoutEffect(() => {
    try {
      const mountPath = initialPathnameRef.current || window.location.pathname;
      const urlMatchedInitial =
        !initialGroupId && !initialTeacherId
          ? matchEntityFromPathname(mountPath, initialGroups, initialTeachers)
          : null;

      const effectiveInitialGroupId =
        initialGroupId ?? (urlMatchedInitial?.mode === "student" ? urlMatchedInitial.id : undefined);
      const effectiveInitialTeacherId =
        initialTeacherId ?? (urlMatchedInitial?.mode === "teacher" ? urlMatchedInitial.id : undefined);
      const effectiveInitialMode = initialMode ?? urlMatchedInitial?.mode;

      const setupDone = Boolean(includeCancelled) || Boolean(user) || readStoredSetupComplete();
      setIsSetupComplete(setupDone);

      if (!setupDone) {
        // Незнайомий користувач не повинен чекати мережеві таймери чи бачити групу 75:
        // одразу знімаємо loading і залишаємо дефолтну групу порожньою до вибору в онбордингу.
        setLoading(false);
        if (effectiveInitialGroupId) setGroupId(effectiveInitialGroupId);
        if (effectiveInitialTeacherId) setTeacherId(effectiveInitialTeacherId);
        if (effectiveInitialMode) setMode(effectiveInitialMode);
        return;
      }

      if (effectiveInitialGroupId) {
        if (!window.localStorage.getItem("schedule:groupId")) {
          window.localStorage.setItem("schedule:groupId", String(effectiveInitialGroupId));
        }
        if (!window.localStorage.getItem("schedule:mode")) {
          window.localStorage.setItem("schedule:mode", "student");
        }
      }
      if (effectiveInitialTeacherId) {
        if (!window.localStorage.getItem("schedule:teacherId")) {
          window.localStorage.setItem("schedule:teacherId", String(effectiveInitialTeacherId));
        }
        if (!window.localStorage.getItem("schedule:mode")) {
          window.localStorage.setItem("schedule:mode", "teacher");
        }
      }

      let resolvedMode: "student" | "teacher" = effectiveInitialMode ?? mode;
      if (effectiveInitialMode) {
        setMode(effectiveInitialMode);
      } else {
        const savedMode = window.localStorage.getItem("schedule:mode");
        if (savedMode === "student" || savedMode === "teacher") {
          resolvedMode = savedMode;
          setMode(savedMode);
        }
      }

      let resolvedGid = effectiveInitialGroupId ?? groupId;
      if (effectiveInitialGroupId) {
        setGroupId(effectiveInitialGroupId);
      } else {
        const savedGid = Number(window.localStorage.getItem("schedule:groupId"));
        if (savedGid > 0) {
          resolvedGid = savedGid;
          setGroupId(savedGid);
        }
      }

      let resolvedTid = effectiveInitialTeacherId ?? teacherId;
      if (effectiveInitialTeacherId) {
        setTeacherId(effectiveInitialTeacherId);
      } else {
        const savedTid = Number(window.localStorage.getItem("schedule:teacherId"));
        if (savedTid > 0) {
          resolvedTid = savedTid;
          setTeacherId(savedTid);
        }
      }

      const savedSem = window.localStorage.getItem("schedule:semesterStart");
      if (savedSem) setSemesterStart(savedSem);

      const uid = window.localStorage.getItem("schedule:classroom_google_user_id") || "";
      const email = window.localStorage.getItem("schedule:classroom_linked_email") || "";
      const linkedGid = window.localStorage.getItem("schedule:classroom_linked_group_id") || "";
      const pin = window.localStorage.getItem("college_schedule_teacher_pin") ? "pin" : "";
      const hasAuth = Boolean(
        (resolvedMode === "teacher" && pin) ||
          (resolvedMode === "student" && (uid || email) && (!linkedGid || Number(linkedGid) === resolvedGid))
      );
      const storageTier = hasAuth ? ":auth" : ":guest";
      const targetKey = resolvedMode === "student" ? `groupId:${resolvedGid}` : `teacherId:${resolvedTid}`;
      const cancelSuffix = includeCancelled ? ":all" : "";
      const dateKey = formatKyivDateIso(weekAnchorDate);

      const todayKey = `schedule:today:${targetKey}${cancelSuffix}${storageTier}`;
      const weekKey = `schedule:week:${targetKey}:${dateKey}${cancelSuffix}${storageTier}`;

      const cachedToday = window.localStorage.getItem(todayKey);
      const cachedWeek = window.localStorage.getItem(weekKey);
      if (cachedToday && cachedWeek) {
        lastRenderedWeekJsonRef.current = cachedWeek;
        setToday(JSON.parse(cachedToday) as ScheduleResponse);
        setWeek(JSON.parse(cachedWeek) as ScheduleResponse[]);
        setLoading(false);
      }
    } catch {}
  }, [initialGroupId, initialTeacherId, initialMode, includeCancelled, user]);

  useEffect(() => {
    const syncSetup = () => {
      const setupDone = Boolean(includeCancelled) || Boolean(user) || readStoredSetupComplete();
      setIsSetupComplete(setupDone);
      if (!setupDone) setLoading(false);
    };
    window.addEventListener(ONBOARDING_CHANGE_EVENT, syncSetup);
    return () => window.removeEventListener(ONBOARDING_CHANGE_EVENT, syncSetup);
  }, [includeCancelled, user]);

  useEffect(() => {
    const cachedGroupId = window.localStorage.getItem("schedule:groupId");
    const cachedTeacherId = window.localStorage.getItem("schedule:teacherId");
    const cachedGroups = window.localStorage.getItem("schedule:groups");
    const cachedTeachers = window.localStorage.getItem("schedule:teachers");

    const mountPath = initialPathnameRef.current || window.location.pathname;
    const needsUrlResolution =
      !initialGroupId &&
      !initialTeacherId &&
      (/^\/group\/[^/]+/.test(mountPath) || /^\/teacher\/[^/]+/.test(mountPath));

    let hasLocalDirectory = initialGroups.length > 0 && initialTeachers.length > 0;
    let parsedCachedGroups: import("./api").ReferenceRecord[] = [];
    let parsedCachedTeachers: import("./api").ReferenceRecord[] = [];

    const setupDoneNow = Boolean(includeCancelled) || Boolean(user) || readStoredSetupComplete();
    if (!setupDoneNow) {
      setLoading(false);
    }

    if (cachedGroups) {
      try {
        const items = JSON.parse(cachedGroups) as import("./api").ReferenceRecord[];
        if (items.length > 0) {
          parsedCachedGroups = items;
          setGroups(items);
          hasLocalDirectory = true;
          if (!setupDoneNow || lastRenderedWeekJsonRef.current !== "") {
            setLoading(false);
          }
        }
      } catch {
        window.localStorage.removeItem("schedule:groups");
      }
    }

    if (cachedTeachers) {
      try {
        const rawItems = JSON.parse(cachedTeachers) as import("./api").ReferenceRecord[];
        const items = rawItems.filter((t) => t.name && !t.name.includes("!"));
        if (items.length > 0) {
          parsedCachedTeachers = items;
          setTeachers(items);
        }
      } catch {
        window.localStorage.removeItem("schedule:teachers");
      }
    }

    const applyUrlOrStorageResolution = (
      gList: import("./api").ReferenceRecord[],
      tList: import("./api").ReferenceRecord[],
      allowFallbackToStorage: boolean
    ) => {
      const currentSetupDone = Boolean(includeCancelled) || Boolean(user) || readStoredSetupComplete();
      if (needsUrlResolution) {
        const matched = matchEntityFromPathname(mountPath, gList, tList);
        if (matched) {
          if (currentSetupDone) {
            setIsSetupComplete(true);
            try {
              if (!window.localStorage.getItem("schedule:mode")) {
                window.localStorage.setItem("schedule:mode", matched.mode);
              }
              if (matched.mode === "student" && !window.localStorage.getItem("schedule:groupId")) {
                window.localStorage.setItem("schedule:groupId", String(matched.id));
              }
              if (matched.mode === "teacher" && !window.localStorage.getItem("schedule:teacherId")) {
                window.localStorage.setItem("schedule:teacherId", String(matched.id));
              }
            } catch {}
          }
          setMode(matched.mode);
          if (matched.mode === "student") setGroupId(matched.id);
          else setTeacherId(matched.id);
          return true;
        }
      }
      if (allowFallbackToStorage && currentSetupDone) {
        let resolvedStorageMode: "student" | "teacher" = initialMode ?? "student";
        if (!initialMode) {
          try {
            const savedMode = window.localStorage.getItem("schedule:mode");
            if (savedMode === "teacher" || savedMode === "student") resolvedStorageMode = savedMode;
          } catch {}
        }
        if ((resolvedStorageMode === "student" || Boolean(includeCancelled)) && !initialGroupId && parsedCachedGroups.length > 0) {
          const parsedGid = Number(cachedGroupId);
          setGroupId(parsedGid > 0 ? parsedGid : (parsedCachedGroups[0]?.id ?? null));
        }
        if ((resolvedStorageMode === "teacher" || Boolean(includeCancelled)) && !initialTeacherId && parsedCachedTeachers.length > 0) {
          const parsedTid = Number(cachedTeacherId);
          setTeacherId(parsedTid > 0 ? parsedTid : (parsedCachedTeachers[0]?.id ?? null));
        }
      }
      return false;
    };

    const resolvedFromCache = applyUrlOrStorageResolution(
      parsedCachedGroups.length > 0 ? parsedCachedGroups : initialGroups,
      parsedCachedTeachers.length > 0 ? parsedCachedTeachers : initialTeachers,
      true
    );

    let cancelled = false;
    const loadDirectory = () => {
      Promise.all([api.directory.groups(), api.directory.teachers()])
        .then(([items, rawTs]) => {
          if (cancelled) return;
          const ts = (rawTs || []).filter((t: any) => t.name && !t.name.includes("!"));
          if (user && user.role === "editor") {
            setTeachers([]);
            const allowed = items.filter((g: any) => (user.allowed_groups || []).includes(g.id));
            setGroups(allowed);
          } else {
            const newGroupsJson = JSON.stringify(items);
            const newTeachersJson = JSON.stringify(ts);
            if (window.localStorage.getItem("schedule:groups") !== newGroupsJson) {
              setGroups(items);
              window.localStorage.setItem("schedule:groups", newGroupsJson);
            }
            if (window.localStorage.getItem("schedule:teachers") !== newTeachersJson) {
              setTeachers(ts);
              window.localStorage.setItem("schedule:teachers", newTeachersJson);
            }
            if (needsUrlResolution) {
              applyUrlOrStorageResolution(items, ts, false);
            }
          }
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) {
            const setupDone =
              Boolean(includeCancelled) || Boolean(user) || readStoredSetupComplete();
            if (!setupDone || lastRenderedWeekJsonRef.current !== "") {
              setLoading(false);
            }
          }
        });
    };

    let deferTimer: ReturnType<typeof setTimeout> | null = null;
    let idleId: number | null = null;

    if (hasLocalDirectory && (!needsUrlResolution || resolvedFromCache)) {
      if (typeof window !== "undefined" && "requestIdleCallback" in window) {
        idleId = (window as any).requestIdleCallback(loadDirectory, { timeout: 2000 });
      } else {
        deferTimer = setTimeout(loadDirectory, 1000);
      }
    } else {
      loadDirectory();
    }

    return () => {
      cancelled = true;
      if (deferTimer) clearTimeout(deferTimer);
      if (idleId !== null && typeof window !== "undefined" && "cancelIdleCallback" in window) {
        (window as any).cancelIdleCallback(idleId);
      }
    };
  }, [initialGroupId, initialTeacherId, initialMode, user]);

  const toggleMode = (newMode: "student" | "teacher") => {
    setMode(newMode);
    if (newMode === "teacher" && !teacherId) {
      let fallbackTid: number | null = null;
      try {
        const savedTid = Number(window.localStorage.getItem("schedule:teacherId"));
        if (savedTid > 0) fallbackTid = savedTid;
      } catch {}
      setTeacherId(fallbackTid ?? teachers[0]?.id ?? null);
    } else if (newMode === "student" && !groupId) {
      let fallbackGid: number | null = null;
      try {
        const savedGid = Number(window.localStorage.getItem("schedule:groupId"));
        if (savedGid > 0) fallbackGid = savedGid;
      } catch {}
      setGroupId(fallbackGid ?? groups[0]?.id ?? null);
    }
    try {
      window.localStorage.setItem("schedule:mode", newMode);
    } catch {}
  };

  const activeTargetId = mode === "student" ? groupId : teacherId;

  useEffect(() => {
    if (!includeCancelled && !isSetupComplete && !user) {
      return;
    }
    if (mode === "student" && !groupId) {
      lastRenderedWeekJsonRef.current = "";
      setWeek([]);
      setToday(null);
      if (groups.length > 0) setLoading(false);
      return;
    }
    if (mode === "teacher" && !teacherId) {
      lastRenderedWeekJsonRef.current = "";
      setWeek([]);
      setToday(null);
      if (teachers.length > 0) setLoading(false);
      return;
    }

    const formatDateKey = (d: Date) => formatKyivDateIso(d);

    const getAuthSignature = () => {
      if (typeof window === "undefined") return "guest";
      try {
        const uid = window.localStorage.getItem("schedule:classroom_google_user_id") || "";
        const email = window.localStorage.getItem("schedule:classroom_linked_email") || "";
        const linkedGid = window.localStorage.getItem("schedule:classroom_linked_group_id") || "";
        const pin = window.localStorage.getItem("college_schedule_teacher_pin") ? "pin" : "";
        const hasAuth = Boolean(
          (mode === "teacher" && pin) ||
            (mode === "student" && (uid || email) && (!linkedGid || Number(linkedGid) === groupId))
        );
        return hasAuth ? `auth:${uid}:${email}:${linkedGid}:${pin}` : "guest";
      } catch {
        return "guest";
      }
    };

    const authSig = getAuthSignature();
    const storageTier = authSig.startsWith("auth:") ? ":auth" : ":guest";
    const dateKey = formatDateKey(weekAnchorDate);
    const targetKey = mode === "student" ? `groupId:${groupId}` : `teacherId:${teacherId}`;
    const cancelSuffix = includeCancelled ? ":all" : "";
    const todayKey = `schedule:today:${targetKey}${cancelSuffix}${storageTier}`;
    const weekKey = `schedule:week:${targetKey}:${dateKey}${cancelSuffix}${storageTier}`;

    const targetGroupId = mode === "student" ? (groupId as number) : undefined;
    const targetTeacherId = mode === "teacher" ? (teacherId as number) : undefined;
    const getMemKey = (wKey = weekKey) => `${todayKey}|${wKey}|${getAuthSignature()}`;

    let isSubscribed = true;
    let activeAbortController: AbortController | null = null;

    const findFallbackScheduleFromStorage = (): {
      today: ScheduleResponse | null;
      week: ScheduleResponse[];
      rawJson: string;
      isSameWeek: boolean;
    } | null => {
      try {
        // Спочатку шукаємо точний тиждень у будь-якому tier (:auth або :guest), щоб не блимати при перемиканні
        for (const tier of [storageTier, ":auth", ":guest"]) {
          const exactRaw = window.localStorage.getItem(
            `schedule:week:${targetKey}:${dateKey}${cancelSuffix}${tier}`
          );
          if (exactRaw) {
            const parsedWeek = JSON.parse(exactRaw) as ScheduleResponse[];
            if (Array.isArray(parsedWeek) && parsedWeek.length > 0) {
              return { today: parsedWeek[0], week: parsedWeek, rawJson: exactRaw, isSameWeek: true };
            }
          }
        }

        const prefix = `schedule:week:${targetKey}:`;
        let bestDate = "";
        let bestRaw: string | null = null;
        for (let i = 0; i < window.localStorage.length; i++) {
          const k = window.localStorage.key(i);
          if (!k || !k.startsWith(prefix)) continue;
          const isAllKey = k.includes(":all:");
          if (Boolean(includeCancelled) !== isAllKey) continue;
          const m = k.match(/:(\d{4}-\d{2}-\d{2})(?::|$)/);
          const dStr = m?.[1] ?? "";
          if (dStr >= bestDate) {
            bestDate = dStr;
            bestRaw = window.localStorage.getItem(k);
          }
        }

        if (bestRaw) {
          const parsedWeek = JSON.parse(bestRaw) as ScheduleResponse[];
          if (Array.isArray(parsedWeek) && parsedWeek.length > 0) {
            const isSameWeek = bestDate === dateKey;
            const remappedWeek: ScheduleResponse[] = parsedWeek.map((dayItem, idx) => {
              const mappedIso = addDaysToCalendarIso(dateKey, idx);
              const safeLessons = isSameWeek
                ? dayItem.lessons
                : (dayItem.lessons || [])
                    .filter((l) => !l.is_replacement)
                    .map((l) => {
                      if (!l.note || !l.note.includes("[TASK")) return l;
                      const cleanedNote = l.note
                        .split("\n")
                        .filter((line) => !line.trim().startsWith("[TASK"))
                        .join("\n")
                        .trim();
                      return { ...l, note: cleanedNote || null };
                    });
              return {
                ...dayItem,
                date: mappedIso,
                lessons: safeLessons,
              };
            });
            const remappedJson = JSON.stringify(remappedWeek);
            return {
              today: remappedWeek[0] ?? null,
              week: remappedWeek,
              rawJson: remappedJson,
              isSameWeek,
            };
          }
        }
      } catch {}
      return null;
    };

    const fetchSchedule = (forceNetwork = false, silentRevalidate = false) => {
      let hasCachedSchedule = false;
      const currentMemKey = getMemKey();

      const memCached = memoryCache.get(currentMemKey);
      if (memCached) {
        if (lastRenderedWeekJsonRef.current !== memCached.rawJson) {
          lastRenderedWeekJsonRef.current = memCached.rawJson;
          setToday(memCached.today);
          setWeek(memCached.week);
        }
        setIsUsingFallbackCache(false);
        setLoading(false);
        hasCachedSchedule = true;
        if (!forceNetwork && Date.now() - memCached.time < CACHE_TTL) {
          setIsSlowNetwork(false);
          return;
        }
      } else {
        try {
          const cachedToday = window.localStorage.getItem(todayKey);
          const cachedWeek = window.localStorage.getItem(weekKey);
          if (cachedToday && cachedWeek) {
            if (lastRenderedWeekJsonRef.current !== cachedWeek) {
              lastRenderedWeekJsonRef.current = cachedWeek;
              setToday(JSON.parse(cachedToday) as ScheduleResponse);
              setWeek(JSON.parse(cachedWeek) as ScheduleResponse[]);
            }
            setIsUsingFallbackCache(false);
            setLoading(false);
            hasCachedSchedule = true;
          }
        } catch {
          window.localStorage.removeItem(todayKey);
          window.localStorage.removeItem(weekKey);
        }
      }

      const matchesInitialSsrSeed =
        !includeCancelled &&
        initialWeek.length > 0 &&
        Boolean(initialWeekStartIso) &&
        dateKey === initialWeekStartIso &&
        mode === (initialMode ?? "student") &&
        (mode === "student" ? groupId === initialGroupId : teacherId === initialTeacherId);

      if (!hasCachedSchedule) {
        if (matchesInitialSsrSeed) {
          if (lastRenderedWeekJsonRef.current !== initialWeekJson) {
            lastRenderedWeekJsonRef.current = initialWeekJson;
            setToday(initialSeedToday);
            setWeek(initialWeek);
          }
          setIsUsingFallbackCache(false);
          setLoading(false);
          hasCachedSchedule = true;
        } else {
          const fallback = findFallbackScheduleFromStorage();
          if (fallback) {
            lastRenderedWeekJsonRef.current = fallback.rawJson;
            if (fallback.today) setToday(fallback.today);
            setWeek(fallback.week);
            setIsUsingFallbackCache(!fallback.isSameWeek);
            setLoading(false);
            hasCachedSchedule = true;
          } else if (!silentRevalidate) {
            setLoading(true);
          }
        }
      }

      setError(null);

      const nowKyiv = new Date();
      const todayIso = formatKyivDateIso(nowKyiv);
      const isWeekday = getCalendarWeekdayMon0(todayIso) < 5;

      activeAbortController?.abort();
      const requestController =
        typeof AbortController !== "undefined" ? new AbortController() : null;
      activeAbortController = requestController;

      api
        .week(targetGroupId, targetTeacherId, weekAnchorDate, includeCancelled, requestController?.signal)
        .then((weekResponse) => {
          if (!isSubscribed || requestController?.signal.aborted) return;
          const matchingDay = isWeekday ? weekResponse.find((d) => d.date === todayIso) : undefined;
          const todayResponse: ScheduleResponse = matchingDay ??
            weekResponse[0] ?? {
              date: todayIso,
              week_type: "both",
              lessons: [],
            };

          const incomingWeekJson = JSON.stringify(weekResponse);
          const incomingTodayJson = JSON.stringify(todayResponse);

          try {
            window.localStorage.setItem(todayKey, incomingTodayJson);
            window.localStorage.setItem(weekKey, incomingWeekJson);
            pruneOldScheduleCache(targetKey, 6);
            if (mode === "student" && targetGroupId) {
              const allLessons = weekResponse.flatMap((d) => d.lessons || []);
              window.localStorage.setItem(
                `schedule:has_subgroups:${targetGroupId}`,
                checkScheduleHasSubgroups(allLessons) ? "1" : "0"
              );
              window.localStorage.setItem(
                `schedule:subgroup_hints:${targetGroupId}`,
                JSON.stringify(extractSubgroupTeacherHints(allLessons))
              );
              pruneGroupAuxiliaryCaches([targetGroupId]);
            }
          } catch {}

          memoryCache.set(getMemKey(), {
            time: Date.now(),
            today: todayResponse,
            week: weekResponse,
            rawJson: incomingWeekJson,
          });

          // КЛЮЧОВЕ ВИПРАВЛЕННЯ БЛІКУ:
          // Оновлюємо React-стейт ТІЛЬКИ якщо розклад реально змінився порівняно з тим, що вже на екрані!
          if (lastRenderedWeekJsonRef.current !== incomingWeekJson) {
            lastRenderedWeekJsonRef.current = incomingWeekJson;
            setToday(todayResponse);
            setWeek(weekResponse);
          }

          setIsUsingFallbackCache(false);
          setIsSlowNetwork(false);
          setError(null);
        })
        .catch(() => {
          if (!isSubscribed || requestController?.signal.aborted) return;
          setIsSlowNetwork(false);
          if (!hasCachedSchedule) {
            setError("Слабке з'єднання з інтернетом. Не вдалося завантажити розклад із сервера.");
          }
        })
        .finally(() => {
          if (isSubscribed && !requestController?.signal.aborted) setLoading(false);
        });
    };

    fetchSchedule();

    const handleScheduleRefresh = () => fetchSchedule(true, true);
    const handleClassroomAccessChange = () => {
      memoryCache.clear();
      invalidateEtagCache();
      invalidateGroupStatusCache();
      fetchSchedule(true, true);
    };

    window.addEventListener("schedule:refresh", handleScheduleRefresh);
    window.addEventListener("teacher-access-changed", handleClassroomAccessChange);
    window.addEventListener("classroom-access-changed", handleClassroomAccessChange);

    return () => {
      isSubscribed = false;
      activeAbortController?.abort();
      window.removeEventListener("schedule:refresh", handleScheduleRefresh);
      window.removeEventListener("teacher-access-changed", handleClassroomAccessChange);
      window.removeEventListener("classroom-access-changed", handleClassroomAccessChange);
    };
  }, [isSetupComplete, mode, activeTargetId, weekAnchorDate, includeCancelled]);

  useEffect(() => {
    let active = true;
    const cachedSemesterStart = window.localStorage.getItem("schedule:semesterStart");
    if (cachedSemesterStart) setSemesterStart(cachedSemesterStart);

    const fetchSemesterStart = () => {
      api.settings
        .semesterStart()
        .then((setting) => {
          if (active && setting.value !== cachedSemesterStart) {
            setSemesterStart(setting.value);
          }
          try {
            window.localStorage.setItem("schedule:semesterStart", setting.value);
          } catch {}
        })
        .catch(() => {});
    };

    if (!cachedSemesterStart) {
      fetchSemesterStart();
      return () => {
        active = false;
      };
    }

    let timer: ReturnType<typeof setTimeout> | null = null;
    let idleId: number | null = null;
    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      idleId = (window as any).requestIdleCallback(fetchSemesterStart, { timeout: 2500 });
    } else {
      timer = setTimeout(fetchSemesterStart, 1000);
    }

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      if (idleId !== null && typeof window !== "undefined" && "cancelIdleCallback" in window) {
        (window as any).cancelIdleCallback(idleId);
      }
    };
  }, []);

  function updateLesson(lesson: import("./api").Lesson) {
    setToday(
      (value) =>
        value && {
          ...value,
          lessons: value.lessons.map((item) => (item.id === lesson.id ? lesson : item)),
        }
    );
    setWeek((days) =>
      days.map((day) => ({
        ...day,
        lessons: day.lessons.map((item) => (item.id === lesson.id ? lesson : item)),
      }))
    );
  }
  function removeLesson(id: number) {
    setToday(
      (value) => value && { ...value, lessons: value.lessons.filter((item) => item.id !== id) }
    );
    setWeek((days) =>
      days.map((day) => ({ ...day, lessons: day.lessons.filter((item) => item.id !== id) }))
    );
  }
  function addLesson(date: string, lesson: import("./api").Lesson) {
    setToday((value) =>
      value && value.date === date
        ? {
            ...value,
            lessons: [...value.lessons, lesson].sort((a, b) => a.lesson_number - b.lesson_number),
          }
        : value
    );
    setWeek((days) =>
      days.map((day) =>
        day.date === date
          ? {
              ...day,
              lessons: [...day.lessons, lesson].sort((a, b) => a.lesson_number - b.lesson_number),
            }
          : day
      )
    );
  }
  const updateGroupId = (id: number | null) => {
    setGroupId(id);
    if (id !== null) window.localStorage.setItem("schedule:groupId", id.toString());
  };

  const updateTeacherId = (id: number | null) => {
    setTeacherId(id);
    if (id !== null) window.localStorage.setItem("schedule:teacherId", id.toString());
  };

  const completeSetup = () => {
    writeStoredSetupComplete();
    setIsSetupComplete(true);
  };
  const resetSetup = () => {
    try {
      window.localStorage.removeItem("schedule:setupComplete");
    } catch {}
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(ONBOARDING_CHANGE_EVENT));
    }
    setIsSetupComplete(false);
  };

  return {
    isSetupComplete,
    completeSetup,
    resetSetup,
    mode,
    toggleMode,
    teachers,
    teacherId,
    setTeacherId: updateTeacherId,
    groups,
    groupId,
    setGroupId: updateGroupId,
    today,
    week,
    semesterStart,
    loading,
    isSlowNetwork,
    isUsingFallbackCache,
    error,
    setToday,
    setWeek,
    updateLesson,
    removeLesson,
    addLesson,
  };
}
