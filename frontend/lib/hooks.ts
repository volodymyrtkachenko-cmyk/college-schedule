"use client";

import { useEffect, useLayoutEffect, useState } from "react";
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
  { time: number; today: ScheduleResponse; week: ScheduleResponse[] }
>();
const CACHE_TTL = 1000 * 60;

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

export function invalidateScheduleCache(forceClearStorage?: boolean) {
  memoryCache.clear();
  invalidateEtagCache();
  invalidateGroupStatusCache();
  clearScheduleLocalStorageCache();
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

  // ВАЖЛИВО: початковий стан має на 100% збігатися між SSR та першим клієнтським рендером,
  // щоб уникнути React Error #425 / #418 / #423. Читання localStorage відбувається у useIsomorphicLayoutEffect до відмальовування кадру.
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

  // Мгновенная синхронизация с localStorage ДО первого кадра отрисовки экрана (0 мс старт в PWA без скелетонов)
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

      // Поднимаем кеш расписания текущей недели до первой отрисовки кадра
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
        setToday(JSON.parse(cachedToday) as ScheduleResponse);
        setWeek(JSON.parse(cachedWeek) as ScheduleResponse[]);
        setLoading(false);
      }
    } catch {}
  }, [initialGroupId, initialTeacherId, initialMode]);

  useEffect(() => {
    if (initialGroupId || initialTeacherId) {
      setIsSetupComplete(true);
      try {
        window.localStorage.setItem("schedule:setupComplete", "1");
      } catch {}
    } else if (window.localStorage.getItem("schedule:setupComplete") === "1") {
      setIsSetupComplete(true);
    }

    if (initialMode) {
      setMode(initialMode);
      try {
        window.localStorage.setItem("schedule:mode", initialMode);
      } catch {}
    }

    if (initialGroupId) {
      setGroupId(initialGroupId);
      try {
        window.localStorage.setItem("schedule:groupId", String(initialGroupId));
      } catch {}
    }

    if (initialTeacherId) {
      setTeacherId(initialTeacherId);
      try {
        window.localStorage.setItem("schedule:teacherId", String(initialTeacherId));
      } catch {}
    }

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
    const dirSlowTimer = setTimeout(() => {
      if (!cancelled) {
        setLoading(false);
        if (!hasLocalDirectory) setIsSlowNetwork(true);
      }
    }, 3200);

    const loadDirectory = () => {
      Promise.all([api.directory.groups(), api.directory.teachers()])
        .then(([items, rawTs]) => {
          if (cancelled) return;
          const ts = (rawTs || []).filter((t: any) => t.name && !t.name.includes("!"));
          if (user && user.role === "editor") {
            setTeachers([]);
            const allowed = items.filter((g: any) => (user.allowed_groups || []).includes(g.id));
            setGroups(allowed);
            if (initialGroupId && allowed.some((g: any) => g.id === initialGroupId)) {
              setGroupId(initialGroupId);
            } else if (!cachedGroupId && allowed.length > 0) {
              setGroupId(allowed[0].id);
            } else if (cachedGroupId) {
              setGroupId(Number(cachedGroupId));
            }
          } else {
            setTeachers(ts);
            setGroups(items);

            if (initialTeacherId) {
              setTeacherId(initialTeacherId);
              window.localStorage.setItem("schedule:teacherId", String(initialTeacherId));
            } else if (!cachedTeacherId && ts.length > 0) {
              setTeacherId(ts[0].id);
            } else if (cachedTeacherId) {
              setTeacherId(Number(cachedTeacherId));
            }

            if (initialGroupId) {
              setGroupId(initialGroupId);
              window.localStorage.setItem("schedule:groupId", String(initialGroupId));
            } else if (!cachedGroupId && items.length > 0) {
              setGroupId(items[0].id);
            } else if (cachedGroupId) {
              setGroupId(Number(cachedGroupId));
            }

            window.localStorage.setItem("schedule:groups", JSON.stringify(items));
            window.localStorage.setItem("schedule:teachers", JSON.stringify(ts));
          }
        })
        .catch(() => {
          if (!cancelled && !cachedGroups && initialGroups.length === 0) {
            setError(
              "Не вдалося завантажити список груп. Перевірте підключення до інтернету та спробуйте ще раз."
            );
          }
        })
        .finally(() => {
          clearTimeout(dirSlowTimer);
          if (!cancelled) setLoading(false);
        });
    };

    // Якщо довідники вже є з SSR або localStorage — відкладаємо їх фонове оновлення на 4 с,
    // щоб на слабкому інтернеті миттєво завантажився основний розклад пар
    const deferTimer = hasLocalDirectory
      ? setTimeout(loadDirectory, 4000)
      : (loadDirectory(), null);

    return () => {
      cancelled = true;
      clearTimeout(dirSlowTimer);
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

    if (typeof window !== "undefined" && !(window as any).__scheduleStorageCleaned) {
      (window as any).__scheduleStorageCleaned = true;
      setTimeout(() => {
        try {
          const cutoff = new Date();
          cutoff.setDate(cutoff.getDate() - 14);
          const cutoffIso = formatKyivDateIso(cutoff);
          for (let i = 0; i < window.localStorage.length; i++) {
            const k = window.localStorage.key(i);
            if (k && k.startsWith("schedule:week:")) {
              const dateMatch = k.match(/:(\d{4}-\d{2}-\d{2})(?::|$)/);
              if (dateMatch && dateMatch[1] < cutoffIso) {
                window.localStorage.removeItem(k);
                i--;
              }
            }
          }
        } catch {}
      }, 4000);
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
    let prefetchTimer: ReturnType<typeof setTimeout> | null = null;
    let idleCallbackId: number | null = null;
    let slowNetworkTimer: ReturnType<typeof setTimeout> | null = null;

    const findFallbackScheduleFromStorage = (): {
      today: ScheduleResponse | null;
      week: ScheduleResponse[];
    } | null => {
      try {
        const prefix = `schedule:week:${targetKey}:`;
        let bestDate = "";
        let bestRaw: string | null = null;
        for (let i = 0; i < window.localStorage.length; i++) {
          const k = window.localStorage.key(i);
          if (!k || !k.startsWith(prefix) || !k.endsWith(storageTier)) continue;
          const m = k.match(/:(\d{4}-\d{2}-\d{2})(?::|$)/);
          const dStr = m?.[1] ?? "";
          if (dStr >= bestDate) {
            bestDate = dStr;
            bestRaw = window.localStorage.getItem(k);
          }
        }
        const cachedTodayRaw = window.localStorage.getItem(todayKey);
        const parsedToday = cachedTodayRaw ? (JSON.parse(cachedTodayRaw) as ScheduleResponse) : null;

        if (bestRaw) {
          const parsedWeek = JSON.parse(bestRaw) as ScheduleResponse[];
          if (Array.isArray(parsedWeek) && parsedWeek.length > 0) {
            const remappedWeek: ScheduleResponse[] = parsedWeek.map((dayItem, idx) => {
              const d = new Date(weekAnchorDate);
              d.setDate(weekAnchorDate.getDate() + idx);
              const mappedIso = formatDateKey(d);
              // При фолбеку на інший тиждень відфільтровуємо разові заміни чужого тижня
              const safeLessons = (dayItem.lessons || []).filter((l) => !l.is_replacement);
              return {
                ...dayItem,
                date: mappedIso,
                lessons: bestDate === dateKey ? dayItem.lessons : safeLessons,
              };
            });
            return {
              today: parsedToday ?? remappedWeek[0] ?? null,
              week: remappedWeek,
            };
          }
        }
        if (parsedToday) {
          return { today: parsedToday, week: [parsedToday] };
        }
      } catch {}
      return null;
    };

    const prefetchAdjacentWeeks = (currentToday: ScheduleResponse) => {
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      if (typeof navigator !== "undefined" && (navigator as any).connection?.saveData) return;
      for (const offsetDays of [-7, 7]) {
        const adjDate = new Date(weekAnchorDate);
        adjDate.setDate(adjDate.getDate() + offsetDays);
        const adjDateKey = formatDateKey(adjDate);
        const adjWeekKey = `schedule:week:${targetKey}:${adjDateKey}${cancelSuffix}${storageTier}`;
        const adjMemKey = getMemKey(adjWeekKey);

        const existingMem = memoryCache.get(adjMemKey);
        if (existingMem && Date.now() - existingMem.time < CACHE_TTL) continue;

        try {
          if (typeof window !== "undefined" && window.localStorage.getItem(adjWeekKey)) {
            continue;
          }
        } catch {}

        api
          .week(targetGroupId, targetTeacherId, adjDate, includeCancelled)
          .then((adjWeek) => {
            try {
              window.localStorage.setItem(adjWeekKey, JSON.stringify(adjWeek));
            } catch {}
            memoryCache.set(adjMemKey, { time: Date.now(), today: currentToday, week: adjWeek });
          })
          .catch(() => {});
      }
    };

    const schedulePrefetch = (currentToday: ScheduleResponse) => {
      if (typeof window !== "undefined" && "requestIdleCallback" in window) {
        if (idleCallbackId !== null) {
          (window as any).cancelIdleCallback(idleCallbackId);
        }
        idleCallbackId = (window as any).requestIdleCallback(
          () => {
            if (isSubscribed) prefetchAdjacentWeeks(currentToday);
          },
          { timeout: 3000 }
        );
      } else {
        if (prefetchTimer) clearTimeout(prefetchTimer);
        prefetchTimer = setTimeout(() => {
          if (isSubscribed) prefetchAdjacentWeeks(currentToday);
        }, 1200);
      }
    };

    const fetchSchedule = (forceNetwork = false, silentRevalidate = false) => {
      let hasCachedSchedule = false;
      if (slowNetworkTimer) clearTimeout(slowNetworkTimer);
      const currentMemKey = getMemKey();

      const memCached = memoryCache.get(currentMemKey);
      if (memCached) {
        setToday(memCached.today);
        setWeek(memCached.week);
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
            setToday(JSON.parse(cachedToday) as ScheduleResponse);
            setWeek(JSON.parse(cachedWeek) as ScheduleResponse[]);
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
        const instantFallback = findFallbackScheduleFromStorage();
        if (instantFallback) {
          if (instantFallback.today) setToday(instantFallback.today);
          setWeek(instantFallback.week);
          setLoading(false);
          hasCachedSchedule = true;
        } else {
          setLoading(true);
          setIsUsingFallbackCache(false);
          slowNetworkTimer = setTimeout(() => {
            if (!isSubscribed) return;
            setIsSlowNetwork(true);
            setLoading(false);
          }, 2500);
        }
      } else if (!silentRevalidate) {
        slowNetworkTimer = setTimeout(() => {
          if (!isSubscribed) return;
          setIsSlowNetwork(true);
        }, 3500);
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

          setToday(todayResponse);
          setWeek(weekResponse);
          setIsUsingFallbackCache(false);
          setIsSlowNetwork(false);
          setError(null);
          try {
            window.localStorage.setItem(todayKey, JSON.stringify(todayResponse));
            window.localStorage.setItem(weekKey, JSON.stringify(weekResponse));
          } catch {}
          memoryCache.set(getMemKey(), {
            time: Date.now(),
            today: todayResponse,
            week: weekResponse,
          });

          schedulePrefetch(todayResponse);
        })
        .catch(() => {
          if (!isSubscribed) return;
          setIsSlowNetwork(false);
          if (!hasCachedSchedule) {
            const fallback = findFallbackScheduleFromStorage();
            if (fallback) {
              if (fallback.today) setToday(fallback.today);
              setWeek(fallback.week);
              setIsUsingFallbackCache(true);
              setLoading(false);
            } else {
              setError(
                "Слабке з'єднання з інтернетом. Не вдалося завантажити розклад із сервера."
              );
            }
          } else if (!silentRevalidate) {
            setIsUsingFallbackCache(true);
          }
        })
        .finally(() => {
          if (slowNetworkTimer) clearTimeout(slowNetworkTimer);
          if (isSubscribed) setLoading(false);
        });
    };

    fetchSchedule();

    let lastVisibilityRevalidate = Date.now();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        const now = Date.now();
        if (now - lastVisibilityRevalidate >= 60_000) {
          lastVisibilityRevalidate = now;
          // Тихе оновлення у фоні без стирання memoryCache та без мерехтіння індикаторів
          fetchSchedule(true, true);
        }
      }
    };
    const handleOnline = () => fetchSchedule(true, true);
    const handleScheduleRefresh = () => fetchSchedule(true, false);
    const handleClassroomAccessChange = () => {
      memoryCache.clear();
      invalidateEtagCache();
      invalidateGroupStatusCache();
      fetchSchedule(true, false);
    };

    window.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("online", handleOnline);
    window.addEventListener("schedule:refresh", handleScheduleRefresh);
    window.addEventListener("teacher-access-changed", handleClassroomAccessChange);
    window.addEventListener("classroom-access-changed", handleClassroomAccessChange);

    return () => {
      isSubscribed = false;
      if (
        idleCallbackId !== null &&
        typeof window !== "undefined" &&
        "cancelIdleCallback" in window
      ) {
        (window as any).cancelIdleCallback(idleCallbackId);
      }
      if (prefetchTimer) clearTimeout(prefetchTimer);
      if (slowNetworkTimer) clearTimeout(slowNetworkTimer);
      window.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("online", handleOnline);
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
            if (active) setSemesterStart(setting.value);
            try {
              window.localStorage.setItem("schedule:semesterStart", setting.value);
            } catch {}
          })
          .catch(() => {
            if (active && !cachedSemesterStart) setSemesterStart(null);
          });
      },
      cachedSemesterStart ? 3000 : 0
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
