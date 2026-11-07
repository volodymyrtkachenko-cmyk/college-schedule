"use client";

import { useEffect, useState } from "react";
import { api, DirectoryItem, ScheduleResponse, invalidateEtagCache, invalidateGroupStatusCache } from "./api";
import { useAuth } from "./auth";


const memoryCache = new Map<string, { time: number; today: ScheduleResponse; week: ScheduleResponse[] }>();
const CACHE_TTL = 1000 * 60;

export function invalidateScheduleCache() {
  memoryCache.clear();
  invalidateEtagCache();
  invalidateGroupStatusCache();
  if (typeof navigator === "undefined" || navigator.onLine) {
    for (let index = 0; index < window.localStorage.length; index++) {
      const key = window.localStorage.key(index);
      if (key?.startsWith("schedule:today:") || key?.startsWith("schedule:week:")) {
        window.localStorage.removeItem(key);
        index--;
      }
    }
  }
  window.dispatchEvent(new Event("schedule:refresh"));
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
  initialTeachers: import("./api").ReferenceRecord[] = []
) {
  const { user } = useAuth();
  const [isSetupComplete, setIsSetupComplete] = useState(false);
  const [mode, setMode] = useState<"student" | "teacher">("student");
  const [groups, setGroups] = useState<import("./api").ReferenceRecord[]>(initialGroups);
  const [teachers, setTeachers] = useState<import("./api").ReferenceRecord[]>(initialTeachers);
  const [groupId, setGroupId] = useState<number | null>(initialGroups[0]?.id ?? null);
  const [teacherId, setTeacherId] = useState<number | null>(initialTeachers[0]?.id ?? null);
  const [today, setToday] = useState<ScheduleResponse | null>(null);
  const [week, setWeek] = useState<ScheduleResponse[]>([]);
  const [semesterStart, setSemesterStart] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSlowNetwork, setIsSlowNetwork] = useState(false);
  const [isUsingFallbackCache, setIsUsingFallbackCache] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const cachedSetup = window.localStorage.getItem("schedule:setupComplete");
    if (cachedSetup === "1") setIsSetupComplete(true);

    const cachedMode = window.localStorage.getItem("schedule:mode") as "student" | "teacher" | null;
    if (cachedMode) setMode(cachedMode);

    const cachedGroupId = window.localStorage.getItem("schedule:groupId");
    const cachedTeacherId = window.localStorage.getItem("schedule:teacherId");
    const cachedGroups = window.localStorage.getItem("schedule:groups");
    const cachedTeachers = window.localStorage.getItem("schedule:teachers");

    if (cachedGroups) {
      try {
        const items = JSON.parse(cachedGroups) as import("./api").ReferenceRecord[];
        setGroups(items);
        setGroupId(cachedGroupId ? Number(cachedGroupId) : (items[0]?.id ?? null));
        setLoading(false);
      } catch {
        window.localStorage.removeItem("schedule:groups");
      }
    }
    
    if (cachedTeachers) {
      try {
        const items = JSON.parse(cachedTeachers) as import("./api").ReferenceRecord[];
        setTeachers(items);
        setTeacherId(cachedTeacherId ? Number(cachedTeacherId) : (items[0]?.id ?? null));
      } catch {
        window.localStorage.removeItem("schedule:teachers");
      }
    }

    const dirSlowTimer = setTimeout(() => {
      setLoading(false);
      setIsSlowNetwork(true);
    }, 3200);
    
    Promise.all([api.directory.groups(), api.directory.teachers()]).then(([items, ts]) => {
        if (user && user.role === "editor") {
            setTeachers([]);
            const allowed = items.filter((g: any) => (user.allowed_groups || []).includes(g.id));
            setGroups(allowed);
            if (!cachedGroupId && allowed.length > 0) {
                setGroupId(allowed[0].id);
            } else if (cachedGroupId) {
                setGroupId(Number(cachedGroupId));
            }
        } else {
            setTeachers(ts);
            setGroups(items);
            
            if (!cachedTeacherId && ts.length > 0) {
                setTeacherId(ts[0].id);
            } else if (cachedTeacherId) {
                setTeacherId(Number(cachedTeacherId));
            }
            
            if (!cachedGroupId && items.length > 0) {
                setGroupId(items[0].id);
            } else if (cachedGroupId) {
                setGroupId(Number(cachedGroupId));
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
  }, []);

  const toggleMode = (newMode: "student" | "teacher") => {
    setMode(newMode);
    window.localStorage.setItem("schedule:mode", newMode);
  };

  useEffect(() => {
    if (!isSetupComplete && window.localStorage.getItem("schedule:setupComplete") !== "1") {
      return;
    }
    if (mode === "student" && !groupId) { setWeek([]); setToday(null); return; }
    if (mode === "teacher" && !teacherId) { setWeek([]); setToday(null); return; }

    // Очищення застарілих ключів schedule:week:* (старших за 14 днів) у фоні один раз за сесію
    if (typeof window !== "undefined" && !(window as any).__scheduleStorageCleaned) {
      (window as any).__scheduleStorageCleaned = true;
      setTimeout(() => {
        try {
          const cutoff = new Date();
          cutoff.setDate(cutoff.getDate() - 14);
          const cutoffIso = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}-${String(cutoff.getDate()).padStart(2, "0")}`;
          for (let i = 0; i < window.localStorage.length; i++) {
            const k = window.localStorage.key(i);
            if (k && k.startsWith("schedule:week:")) {
              const dateMatch = k.match(/:(\d{4}-\d{2}-\d{2})(?::all)?$/);
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

    const dateKey = formatDateKey(weekAnchorDate);
    const targetKey = mode === "student" ? `groupId:${groupId}` : `teacherId:${teacherId}`;
    const cancelSuffix = includeCancelled ? ":all" : "";
    const todayKey = `schedule:today:${targetKey}${cancelSuffix}`;
    const weekKey = `schedule:week:${targetKey}:${dateKey}${cancelSuffix}`;

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

    const targetGroupId = mode === "student" ? (groupId as number) : undefined;
    const targetTeacherId = mode === "teacher" ? (teacherId as number) : undefined;
    const getMemKey = (wKey = weekKey) => `${todayKey}|${wKey}|${getAuthSignature()}`;

    let isSubscribed = true;
    let prefetchTimer: ReturnType<typeof setTimeout> | null = null;
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
          if (!k || !k.startsWith(prefix)) continue;
          const m = k.match(/:(\d{4}-\d{2}-\d{2})(?::all)?$/);
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
        const adjWeekKey = `schedule:week:${targetKey}:${adjDateKey}${cancelSuffix}`;
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

      const nowKyiv = new Date();
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

          if (prefetchTimer) clearTimeout(prefetchTimer);
          prefetchTimer = setTimeout(() => prefetchAdjacentWeeks(todayResponse), 350);
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

export function useIsStandalonePwa() {
  const [isStandalone, setIsStandalone] = useState(false);
  useEffect(() => {
    const iosStandalone = "standalone" in window.navigator && (window.navigator as any).standalone === true;
    const displayModeStandalone = window.matchMedia("(display-mode: standalone)").matches;
    setIsStandalone(iosStandalone || displayModeStandalone);
  }, []);
  return isStandalone;
}

export async function downloadForOffline(
  target: { groupId?: number; teacherId?: number },
  currentWeekAnchor: Date
) {
  if (!target.groupId && !target.teacherId) throw new Error("Оберіть групу або викладача.");

  const mode = target.groupId ? "student" : "teacher";
  const targetKey = mode === "student" ? `groupId:${target.groupId}` : `teacherId:${target.teacherId}`;

  const nextWeekAnchor = new Date(currentWeekAnchor);
  nextWeekAnchor.setDate(nextWeekAnchor.getDate() + 7);

  const currDateKey = `${currentWeekAnchor.getFullYear()}-${String(currentWeekAnchor.getMonth() + 1).padStart(2, "0")}-${String(currentWeekAnchor.getDate()).padStart(2, "0")}`;
  const nextDateKey = `${nextWeekAnchor.getFullYear()}-${String(nextWeekAnchor.getMonth() + 1).padStart(2, "0")}-${String(nextWeekAnchor.getDate()).padStart(2, "0")}`;

  const keys = {
    today: `schedule:today:${targetKey}`,
    currWeek: `schedule:week:${targetKey}:${currDateKey}`,
    nextWeek: `schedule:week:${targetKey}:${nextDateKey}`,
  };

  let successCount = 0;
  let lastError = "";

  try {
    const res = await api.today(target.groupId, target.teacherId);
    window.localStorage.setItem(keys.today, JSON.stringify(res));
    successCount++;
  } catch(e: any) {
    lastError = e.message || String(e);
    console.error(`[Offline] Запит впав (today):`, e);
  }

  try {
    const res = await api.week(target.groupId, target.teacherId, currentWeekAnchor);
    window.localStorage.setItem(keys.currWeek, JSON.stringify(res));
    successCount++;
  } catch(e: any) {
    lastError = e.message || String(e);
    console.error(`[Offline] Запит впав (currWeek):`, e);
  }

  try {
    const res = await api.week(target.groupId, target.teacherId, nextWeekAnchor);
    window.localStorage.setItem(keys.nextWeek, JSON.stringify(res));
    successCount++;
  } catch(e: any) {
    lastError = e.message || String(e);
    console.error(`[Offline] Запит впав (nextWeek):`, e);
  }

  if (successCount === 0) {
    throw new Error(lastError || "Не вдалося зберегти розклад на пристрій. Перевірте підключення та спробуйте ще раз.");
  }

  try {
    const saved = JSON.parse(window.localStorage.getItem("schedule:offlineSaved") || "[]");
    if (Array.isArray(saved) && !saved.includes(targetKey)) {
      saved.push(targetKey);
      window.localStorage.setItem("schedule:offlineSaved", JSON.stringify(saved));
    }
  } catch (e) {
    window.localStorage.setItem("schedule:offlineSaved", JSON.stringify([targetKey]));
  }

  window.localStorage.setItem(`offline_marker:${targetKey}`, "true");
}
