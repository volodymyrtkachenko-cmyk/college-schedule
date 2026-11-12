"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  api,
  ScheduleResponse,
  invalidateEtagCache,
  invalidateGroupStatusCache,
} from "./api";
import { useAuth } from "./auth";
import { formatKyivDateIso } from "./date";

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

export function useSchedule(
  weekAnchorDate: Date,
  includeCancelled = false,
  initialGroups: import("./api").ReferenceRecord[] = [],
  initialTeachers: import("./api").ReferenceRecord[] = [],
  initialGroupId?: number | null,
  initialTeacherId?: number | null,
  initialMode?: "student" | "teacher"
) {
  const { user } = useAuth();

  const [isSetupComplete, setIsSetupComplete] = useState<boolean>(
    Boolean(initialGroupId || initialTeacherId)
  );
  const [mode, setMode] = useState<"student" | "teacher">(initialMode ?? "student");
  const [groups, setGroups] = useState<import("./api").ReferenceRecord[]>(initialGroups);
  const [teachers, setTeachers] = useState<import("./api").ReferenceRecord[]>(
    initialTeachers.filter((t) => t.name && !t.name.includes("!"))
  );
  const [groupId, setGroupId] = useState<number | null>(
    initialGroupId ?? (initialGroups[0]?.id ?? null)
  );
  const [teacherId, setTeacherId] = useState<number | null>(
    initialTeacherId ?? (initialTeachers[0]?.id ?? null)
  );
  const [today, setToday] = useState<ScheduleResponse | null>(null);
  const [week, setWeek] = useState<ScheduleResponse[]>([]);
  const [semesterStart, setSemesterStart] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSlowNetwork, setIsSlowNetwork] = useState(false);
  const [isUsingFallbackCache, setIsUsingFallbackCache] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Зберігаємо точний зліпок поточних даних на екрані, щоб не викликати setWeek/setToday, якщо дані з мережі не змінилися
  const lastRenderedWeekJsonRef = useRef<string>("");

  // Миттєве підняття кешу ДО першого кадру (0 мс старт без скелетонів і без сплэш-екрана)
  useIsomorphicLayoutEffect(() => {
    try {
      if (initialGroupId || initialTeacherId) {
        setIsSetupComplete(true);
        window.localStorage.setItem("schedule:setupComplete", "1");
      } else if (window.localStorage.getItem("schedule:setupComplete") === "1") {
        setIsSetupComplete(true);
      }

      let resolvedMode: "student" | "teacher" = initialMode ?? mode;
      if (!initialMode) {
        const savedMode = window.localStorage.getItem("schedule:mode");
        if (savedMode === "student" || savedMode === "teacher") {
          resolvedMode = savedMode;
          setMode(savedMode);
        }
      }

      let resolvedGid = initialGroupId ?? groupId;
      if (!initialGroupId) {
        const savedGid = Number(window.localStorage.getItem("schedule:groupId"));
        if (savedGid > 0) {
          resolvedGid = savedGid;
          setGroupId(savedGid);
        }
      }

      let resolvedTid = initialTeacherId ?? teacherId;
      if (!initialTeacherId) {
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
  }, [initialGroupId, initialTeacherId, initialMode]);

  useEffect(() => {
    const cachedGroupId = window.localStorage.getItem("schedule:groupId");
    const cachedTeacherId = window.localStorage.getItem("schedule:teacherId");
    const cachedGroups = window.localStorage.getItem("schedule:groups");
    const cachedTeachers = window.localStorage.getItem("schedule:teachers");

    let hasLocalDirectory = initialGroups.length > 0 && initialTeachers.length > 0;

    if (cachedGroups) {
      try {
        const items = JSON.parse(cachedGroups) as import("./api").ReferenceRecord[];
        if (items.length > 0) {
          setGroups(items);
          hasLocalDirectory = true;
          if (!initialGroupId) {
            setGroupId(cachedGroupId ? Number(cachedGroupId) : (items[0]?.id ?? null));
          }
          setLoading(false);
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
          setTeachers(items);
          if (!initialTeacherId) {
            setTeacherId(cachedTeacherId ? Number(cachedTeacherId) : (items[0]?.id ?? null));
          }
        }
      } catch {
        window.localStorage.removeItem("schedule:teachers");
      }
    }

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
          }
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };

    const deferTimer = hasLocalDirectory
      ? setTimeout(loadDirectory, 6000)
      : (loadDirectory(), null);

    return () => {
      cancelled = true;
      if (deferTimer) clearTimeout(deferTimer);
    };
  }, [initialGroupId, initialTeacherId, initialMode, user]);

  const toggleMode = (newMode: "student" | "teacher") => {
    setMode(newMode);
    try {
      window.localStorage.setItem("schedule:mode", newMode);
    } catch {}
  };

  useEffect(() => {
    if (
      !isSetupComplete &&
      !initialGroupId &&
      !initialTeacherId &&
      window.localStorage.getItem("schedule:setupComplete") !== "1"
    ) {
      return;
    }
    if (mode === "student" && !groupId) {
      setWeek([]);
      setToday(null);
      return;
    }
    if (mode === "teacher" && !teacherId) {
      setWeek([]);
      setToday(null);
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

    const findFallbackScheduleFromStorage = (): {
      today: ScheduleResponse | null;
      week: ScheduleResponse[];
      rawJson: string;
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
              return { today: parsedWeek[0], week: parsedWeek, rawJson: exactRaw };
            }
          }
        }

        const prefix = `schedule:week:${targetKey}:`;
        let bestDate = "";
        let bestRaw: string | null = null;
        for (let i = 0; i < window.localStorage.length; i++) {
          const k = window.localStorage.key(i);
          if (!k || !k.startsWith(prefix)) continue;
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
            const remappedWeek: ScheduleResponse[] = parsedWeek.map((dayItem, idx) => {
              const d = new Date(weekAnchorDate);
              d.setDate(weekAnchorDate.getDate() + idx);
              const mappedIso = formatDateKey(d);
              const safeLessons = (dayItem.lessons || []).filter((l) => !l.is_replacement);
              return {
                ...dayItem,
                date: mappedIso,
                lessons: bestDate === dateKey ? dayItem.lessons : safeLessons,
              };
            });
            const remappedJson = JSON.stringify(remappedWeek);
            return {
              today: remappedWeek[0] ?? null,
              week: remappedWeek,
              rawJson: remappedJson,
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

      if (!hasCachedSchedule) {
        const fallback = findFallbackScheduleFromStorage();
        if (fallback) {
          lastRenderedWeekJsonRef.current = fallback.rawJson;
          if (fallback.today) setToday(fallback.today);
          setWeek(fallback.week);
          setLoading(false);
          hasCachedSchedule = true;
        } else if (!silentRevalidate) {
          setLoading(true);
        }
      }

      setError(null);

      const nowKyiv = new Date();
      const todayIso = formatKyivDateIso(nowKyiv);
      const isWeekday = nowKyiv.getDay() >= 1 && nowKyiv.getDay() <= 5;

      api
        .week(targetGroupId, targetTeacherId, weekAnchorDate, includeCancelled)
        .then((weekResponse) => {
          if (!isSubscribed) return;
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
          if (!isSubscribed) return;
          setIsSlowNetwork(false);
          if (!hasCachedSchedule) {
            setError("Слабке з'єднання з інтернетом. Не вдалося завантажити розклад із сервера.");
          }
        })
        .finally(() => {
          if (isSubscribed) setLoading(false);
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
      window.removeEventListener("schedule:refresh", handleScheduleRefresh);
      window.removeEventListener("teacher-access-changed", handleClassroomAccessChange);
      window.removeEventListener("classroom-access-changed", handleClassroomAccessChange);
    };
  }, [isSetupComplete, mode, groupId, teacherId, weekAnchorDate, includeCancelled]);

  useEffect(() => {
    let active = true;
    const cachedSemesterStart = window.localStorage.getItem("schedule:semesterStart");
    if (cachedSemesterStart) setSemesterStart(cachedSemesterStart);

    const timer = setTimeout(
      () => {
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
      },
      cachedSemesterStart ? 5000 : 500
    );

    return () => {
      active = false;
      clearTimeout(timer);
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
    window.localStorage.setItem("schedule:setupComplete", "1");
    setIsSetupComplete(true);
  };
  const resetSetup = () => {
    window.localStorage.removeItem("schedule:setupComplete");
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
