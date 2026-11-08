"use client";

import { useEffect, useState } from "react";
import { api, DirectoryItem, ScheduleResponse, invalidateEtagCache, invalidateGroupStatusCache } from "./api";
import { useAuth } from "./auth";
import { getSyncedNow } from "./date";


const memoryCache = new Map<string, { time: number; today: ScheduleResponse; week: ScheduleResponse[] }>();
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

export function invalidateScheduleCache(forceClearStorage = false) {
  memoryCache.clear();
  invalidateEtagCache();
  invalidateGroupStatusCache();
  if (forceClearStorage || typeof navigator === "undefined" || navigator.onLine) {
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
  const [isSetupComplete, setIsSetupComplete] = useState(() => {
    if (initialGroupId || initialTeacherId) return true;
    if (typeof window !== "undefined") {
      try {
        return window.localStorage.getItem("schedule:setupComplete") === "1";
      } catch {}
    }
    return false;
  });
  const [mode, setMode] = useState<"student" | "teacher">(() => {
    if (initialMode) return initialMode;
    if (typeof window !== "undefined") {
      try {
        const cachedMode = window.localStorage.getItem("schedule:mode") as "student" | "teacher" | null;
        if (cachedMode === "student" || cachedMode === "teacher") return cachedMode;
      } catch {}
    }
    return "student";
  });
  const [groups, setGroups] = useState<import("./api").ReferenceRecord[]>(initialGroups);
  const [teachers, setTeachers] = useState<import("./api").ReferenceRecord[]>(
    initialTeachers.filter((t) => t.name && !t.name.includes("!"))
  );
  const [groupId, setGroupId] = useState<number | null>(() => {
    if (initialGroupId) return initialGroupId;
    if (typeof window !== "undefined") {
      try {
        const cached = window.localStorage.getItem("schedule:groupId");
        if (cached && Number.isFinite(Number(cached))) return Number(cached);
      } catch {}
    }
    return initialGroups[0]?.id ?? null;
  });
  const [teacherId, setTeacherId] = useState<number | null>(() => {
    if (initialTeacherId) return initialTeacherId;
    if (typeof window !== "undefined") {
      try {
        const cached = window.localStorage.getItem("schedule:teacherId");
        if (cached && Number.isFinite(Number(cached))) return Number(cached);
      } catch {}
    }
    return initialTeachers[0]?.id ?? null;
  });
  const [today, setToday] = useState<ScheduleResponse | null>(null);
  const [week, setWeek] = useState<ScheduleResponse[]>([]);
  const [semesterStart, setSemesterStart] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSlowNetwork, setIsSlowNetwork] = useState(false);
  const [isUsingFallbackCache, setIsUsingFallbackCache] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialGroupId || initialTeacherId) {
      try {
        window.localStorage.setItem("schedule:setupComplete", "1");
        if (initialGroupId) window.localStorage.setItem("schedule:groupId", String(initialGroupId));
        if (initialTeacherId) window.localStorage.setItem("schedule:teacherId", String(initialTeacherId));
        if (initialMode) window.localStorage.setItem("schedule:mode", initialMode);
      } catch {}
    }
    const cachedSetup = window.localStorage.getItem("schedule:setupComplete");
    if (cachedSetup === "1" || initialGroupId || initialTeacherId) setIsSetupComplete(true);

    const cachedMode = window.localStorage.getItem("schedule:mode") as "student" | "teacher" | null;
    if (!initialMode && cachedMode) setMode(cachedMode);

    const cachedGroupId = window.localStorage.getItem("schedule:groupId");
    const cachedTeacherId = window.localStorage.getItem("schedule:teacherId");
    const cachedGroups = window.localStorage.getItem("schedule:groups");
    const cachedTeachers = window.localStorage.getItem("schedule:teachers");

    if (cachedGroups) {
      try {
        const items = JSON.parse(cachedGroups) as import("./api").ReferenceRecord[];
        setGroups(items);
        if (!initialGroupId) {
          setGroupId(cachedGroupId ? Number(cachedGroupId) : (items[0]?.id ?? null));
        }
        setLoading(false);
      } catch {
        window.localStorage.removeItem("schedule:groups");
      }
    }
    
    if (cachedTeachers) {
      try {
        const rawItems = JSON.parse(cachedTeachers) as import("./api").ReferenceRecord[];
        const items = rawItems.filter((t) => t.name && !t.name.includes("!"));
        setTeachers(items);
        if (!initialTeacherId) {
          setTeacherId(cachedTeacherId ? Number(cachedTeacherId) : (items[0]?.id ?? null));
        }
      } catch {
        window.localStorage.removeItem("schedule:teachers");
      }
    }

    const dirSlowTimer = setTimeout(() => {
      setLoading(false);
      setIsSlowNetwork(true);
    }, 3200);
    
    Promise.all([api.directory.groups(), api.directory.teachers()]).then(([items, rawTs]) => {
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

            if (initialMode) {
                setMode(initialMode);
                window.localStorage.setItem("schedule:mode", initialMode);
            }

            window.localStorage.setItem("schedule:groups", JSON.stringify(items));
            window.localStorage.setItem("schedule:teachers", JSON.stringify(ts));
        }
    })
      .catch(() => {
        if (!cachedGroups && initialGroups.length === 0) {
          setError("Не вдалося завантажити список груп. Перевірте підключення до інтернету та спробуйте ще раз.");
        }
      })
      .finally(() => {
        clearTimeout(dirSlowTimer);
        setLoading(false);
      });
  }, [initialGroupId, initialTeacherId, initialMode]);

  const toggleMode = (newMode: "student" | "teacher") => {
    setMode(newMode);
    window.localStorage.setItem("schedule:mode", newMode);
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
    if (mode === "student" && !groupId) { setWeek([]); setToday(null); return; }
    if (mode === "teacher" && !teacherId) { setWeek([]); setToday(null); return; }

    // Очищення застарілих ключів schedule:week:* (старших за 14 днів) у фоні один раз за сесію
    if (typeof window !== "undefined" && !(window as any).__scheduleStorageCleaned) {
      (window as any).__scheduleStorageCleaned = true;
      setTimeout(() => {
        try {
          const cutoff = getSyncedNow();
          cutoff.setDate(cutoff.getDate() - 14);
          const cutoffIso = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}-${String(cutoff.getDate()).padStart(2, "0")}`;
          for (let i = 0; i < window.localStorage.length; i++) {
            const k = window.localStorage.key(i);
            if (k && k.startsWith("schedule:week:")) {
              const dateMatch = k.match(/:(\d{4}-\d{2}-\d{2})(?::all)?(?::(?:auth|guest))?$/);
              if (dateMatch && dateMatch[1] < cutoffIso) {
                window.localStorage.removeItem(k);
                i--;
              }
            }
          }
        } catch {}
      }, 3000);
    }

    const formatDateKey = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

    const getAuthSignature = () => {
      if (typeof window === "undefined") return "guest";
      try {
        const uid = window.localStorage.getItem("schedule:classroom_google_user_id") || "";
        const email = window.localStorage.getItem("schedule:classroom_linked_email") || "";
        const linkedGid = window.localStorage.getItem("schedule:classroom_linked_group_id") || "";
        const pin = window.localStorage.getItem("college_schedule_teacher_pin") ? "pin" : "";
        return `${uid}:${email}:${linkedGid}:${pin}`;
      } catch {
        return "guest";
      }
    };

    const hasElevatedAccess = () => {
      if (typeof window === "undefined") return false;
      try {
        const pin = Boolean(window.localStorage.getItem("college_schedule_teacher_pin"));
        const uid = Boolean(window.localStorage.getItem("schedule:classroom_google_user_id"));
        const email = Boolean(window.localStorage.getItem("schedule:classroom_linked_email"));
        return pin || uid || email;
      } catch {
        return false;
      }
    };

    const dateKey = formatDateKey(weekAnchorDate);
    const targetKey = mode === "student" ? `groupId:${groupId}` : `teacherId:${teacherId}`;
    const cancelSuffix = includeCancelled ? ":all" : "";
    const accessSuffix = hasElevatedAccess() ? ":auth" : ":guest";
    const todayKey = `schedule:today:${targetKey}${cancelSuffix}${accessSuffix}`;
    const weekKey = `schedule:week:${targetKey}:${dateKey}${cancelSuffix}${accessSuffix}`;

    const targetGroupId = mode === "student" ? (groupId as number) : undefined;
    const targetTeacherId = mode === "teacher" ? (teacherId as number) : undefined;
    const getMemKey = (wKey = weekKey) => `${todayKey}|${wKey}|${getAuthSignature()}`;

    let isSubscribed = true;
    let prefetchTimer: ReturnType<typeof setTimeout> | null = null;
    let idleCallbackId: number | null = null;
    let slowNetworkTimer: ReturnType<typeof setTimeout> | null = null;

    // Пошук останнього збереженого тижня цієї ж групи/викладача в localStorage,
    // якщо для обраного тижня точного кешу ще немає (щоб пустити користувача при слабкому інтернеті)
    const findFallbackScheduleFromStorage = (): { today: ScheduleResponse | null; week: ScheduleResponse[] } | null => {
      try {
        const prefix = `schedule:week:${targetKey}:`;
        let bestDate = "";
        let bestRaw: string | null = null;
        for (let i = 0; i < window.localStorage.length; i++) {
          const k = window.localStorage.key(i);
          if (!k || !k.startsWith(prefix) || !k.endsWith(accessSuffix)) continue;
          const m = k.match(/:(\d{4}-\d{2}-\d{2})(?::all)?(?::(?:auth|guest))?$/);
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
            // Проєктуємо дати обраного тижня на основі збережених уроків (без разових переносів іншого тижня)
            const remappedWeek: ScheduleResponse[] = parsedWeek.map((dayItem, idx) => {
              const d = new Date(weekAnchorDate);
              d.setDate(weekAnchorDate.getDate() + idx);
              const mappedIso = formatDateKey(d);
              return {
                ...dayItem,
                date: mappedIso,
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

    // 3.2: Фоновий prefetch сусідніх тижнів (← та →) для миттєвого перемикання без скелетонів
    const prefetchAdjacentWeeks = (currentToday: ScheduleResponse) => {
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      if (typeof navigator !== "undefined" && (navigator as any).connection?.saveData) return;
      for (const offsetDays of [-7, 7]) {
        const adjDate = new Date(weekAnchorDate);
        adjDate.setDate(adjDate.getDate() + offsetDays);
        const adjDateKey = formatDateKey(adjDate);
        const adjWeekKey = `schedule:week:${targetKey}:${adjDateKey}${cancelSuffix}${accessSuffix}`;
        const adjMemKey = getMemKey(adjWeekKey);

        const existingMem = memoryCache.get(adjMemKey);
        if (existingMem && Date.now() - existingMem.time < CACHE_TTL) continue;

        try {
          if (typeof window !== "undefined" && window.localStorage.getItem(adjWeekKey)) {
            continue;
          }
        } catch {}

        api.week(targetGroupId, targetTeacherId, adjDate, includeCancelled)
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
          { timeout: 2500 }
        );
      } else {
        if (prefetchTimer) clearTimeout(prefetchTimer);
        prefetchTimer = setTimeout(() => {
          if (isSubscribed) prefetchAdjacentWeeks(currentToday);
        }, 800);
      }
    };

    const fetchSchedule = (forceNetwork = false) => {
      let hasCachedSchedule = false;
      if (slowNetworkTimer) clearTimeout(slowNetworkTimer);
      const currentMemKey = getMemKey();

      // 5.1: Stale-While-Revalidate — спочатку миттєво показуємо дані з memoryCache або localStorage
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
        // Якщо клієнт уже знає, що офлайн — підставляємо збережений розклад із кешу
        const isOffline = typeof navigator !== "undefined" && !navigator.onLine;
        if (isOffline) {
          const fallback = findFallbackScheduleFromStorage();
          if (fallback) {
            if (fallback.today) setToday(fallback.today);
            setWeek(fallback.week);
            setIsUsingFallbackCache(true);
            setLoading(false);
            hasCachedSchedule = true;
          }
        }

        if (!hasCachedSchedule) {
          // У звичайному режимі онлайн — чекаємо відповіді сервера зі стандартним станом завантаження,
          // БЕЗ передчасного показу повідомлення "сервер тимчасово недоступний"
          setLoading(true);
          setIsUsingFallbackCache(false);
          // Лише якщо сервер не відповідає понад 2.5 с — активуємо fallback-кеш
          slowNetworkTimer = setTimeout(() => {
            if (!isSubscribed) return;
            const fallback = findFallbackScheduleFromStorage();
            if (fallback) {
              if (fallback.today) setToday(fallback.today);
              setWeek(fallback.week);
              setIsUsingFallbackCache(true);
            }
            setIsSlowNetwork(true);
            setLoading(false);
          }, 2500);
        }
      } else {
        // Якщо точний кеш обраного тижня вже є, але фонове оновлення триває > 2.5 с — м'яко показуємо індикатор
        slowNetworkTimer = setTimeout(() => {
          if (!isSubscribed) return;
          setIsSlowNetwork(true);
        }, 2500);
      }

      setError(null);

      const nowKyiv = getSyncedNow();
      const todayIso = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(nowKyiv);
      const isWeekday = nowKyiv.getDay() >= 1 && nowKyiv.getDay() <= 5;

      api.week(targetGroupId, targetTeacherId, weekAnchorDate, includeCancelled)
        .then(async (weekResponse) => {
          if (!isSubscribed) return;
          const matchingDay = isWeekday ? weekResponse.find((d) => d.date === todayIso) : undefined;
          const todayResponse = matchingDay ?? (weekResponse.length > 0 ? weekResponse[0] : (await api.today(targetGroupId, targetTeacherId, includeCancelled)));
          if (!isSubscribed) return;

          setToday(todayResponse);
          setWeek(weekResponse);
          setIsUsingFallbackCache(false);
          setIsSlowNetwork(false);
          setError(null);
          try {
            window.localStorage.setItem(todayKey, JSON.stringify(todayResponse));
            window.localStorage.setItem(weekKey, JSON.stringify(weekResponse));
          } catch {}
          memoryCache.set(getMemKey(), { time: Date.now(), today: todayResponse, week: weekResponse });

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
              setError("Слабке з'єднання з інтернетом. Не вдалося завантажити розклад із сервера.");
            }
          } else {
            setIsUsingFallbackCache(true);
          }
        })
        .finally(() => {
          if (slowNetworkTimer) clearTimeout(slowNetworkTimer);
          if (isSubscribed) setLoading(false);
        });
    };

    fetchSchedule();

    let lastVisibilityRevalidate = 0;
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        const now = Date.now();
        if (now - lastVisibilityRevalidate >= 60_000) {
          lastVisibilityRevalidate = now;
          memoryCache.clear();
          fetchSchedule();
        }
      }
    };
    const handleOnline = () => fetchSchedule(true);
    const handleScheduleRefresh = () => fetchSchedule(true);
    const handleClassroomAccessChange = () => {
      memoryCache.clear();
      invalidateEtagCache();
      invalidateGroupStatusCache();
      fetchSchedule(true);
    };

    window.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("online", handleOnline);
    window.addEventListener("schedule:refresh", handleScheduleRefresh);
    window.addEventListener("teacher-access-changed", handleScheduleRefresh);
    window.addEventListener("classroom-access-changed", handleClassroomAccessChange);

    return () => {
      isSubscribed = false;
      if (idleCallbackId !== null && typeof window !== "undefined" && "cancelIdleCallback" in window) {
        (window as any).cancelIdleCallback(idleCallbackId);
      }
      if (prefetchTimer) clearTimeout(prefetchTimer);
      if (slowNetworkTimer) clearTimeout(slowNetworkTimer);
      window.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("schedule:refresh", handleScheduleRefresh);
      window.removeEventListener("teacher-access-changed", handleScheduleRefresh);
      window.removeEventListener("classroom-access-changed", handleClassroomAccessChange);
    };
  }, [isSetupComplete, mode, groupId, teacherId, weekAnchorDate, includeCancelled]);

  useEffect(() => {
    let active = true;
    const cachedSemesterStart = window.localStorage.getItem("schedule:semesterStart");
    if (cachedSemesterStart) setSemesterStart(cachedSemesterStart);

    api.settings.semesterStart()
      .then((setting) => {
          if (active) setSemesterStart(setting.value);
          window.localStorage.setItem("schedule:semesterStart", setting.value);
      })
      .catch(() => { if (active && !cachedSemesterStart) setSemesterStart(null); });
    return () => { active = false; };
  }, []);

  function updateLesson(lesson: import("./api").Lesson) {
    setToday((value) => value && { ...value, lessons: value.lessons.map((item) => item.id === lesson.id ? lesson : item) });
    setWeek((days) => days.map((day) => ({ ...day, lessons: day.lessons.map((item) => item.id === lesson.id ? lesson : item) })));
  }
  function removeLesson(id: number) {
    setToday((value) => value && { ...value, lessons: value.lessons.filter((item) => item.id !== id) });
    setWeek((days) => days.map((day) => ({ ...day, lessons: day.lessons.filter((item) => item.id !== id) })));
  }
  function addLesson(date: string, lesson: import("./api").Lesson) {
    setToday((value) => value && value.date === date ? { ...value, lessons: [...value.lessons, lesson].sort((a, b) => a.lesson_number - b.lesson_number) } : value);
    setWeek((days) => days.map((day) => day.date === date ? { ...day, lessons: [...day.lessons, lesson].sort((a, b) => a.lesson_number - b.lesson_number) } : day));
  }
    const updateGroupId = (id: number | null) => {
    setGroupId(id);
    if (id !== null) window.localStorage.setItem("schedule:groupId", id.toString());
  };

  const updateTeacherId = (id: number | null) => {
    setTeacherId(id);
    if (id !== null) window.localStorage.setItem("schedule:teacherId", id.toString());
  };

  const completeSetup = () => { window.localStorage.setItem("schedule:setupComplete", "1"); setIsSetupComplete(true); };
  const resetSetup = () => { window.localStorage.removeItem("schedule:setupComplete"); setIsSetupComplete(false); };

  return { isSetupComplete, completeSetup, resetSetup, mode, toggleMode, teachers, teacherId, setTeacherId: updateTeacherId, groups, groupId, setGroupId: updateGroupId, today, week, semesterStart, loading, isSlowNetwork, isUsingFallbackCache, error, setToday, setWeek, updateLesson, removeLesson, addLesson };
}

