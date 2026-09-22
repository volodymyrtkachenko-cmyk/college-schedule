"use client";

import { useEffect, useState } from "react";
import { api, DirectoryItem, ScheduleResponse } from "./api";


const memoryCache = new Map<string, { time: number; today: ScheduleResponse; week: ScheduleResponse[] }>();
const CACHE_TTL = 1000 * 60 * 5; // 5 minutes

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

export function useSchedule(weekAnchorDate: Date) {
  const [isSetupComplete, setIsSetupComplete] = useState(false);
  const [mode, setMode] = useState<"student" | "teacher">("student");
  const [groups, setGroups] = useState<import("./api").ReferenceRecord[]>([]);
  const [teachers, setTeachers] = useState<import("./api").ReferenceRecord[]>([]);
  const [groupId, setGroupId] = useState<number | null>(null);
  const [teacherId, setTeacherId] = useState<number | null>(null);
  const [today, setToday] = useState<ScheduleResponse | null>(null);
  const [week, setWeek] = useState<ScheduleResponse[]>([]);
  const [semesterStart, setSemesterStart] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const cachedSetup = window.localStorage.getItem("schedule:setupComplete");
    if (cachedSetup === "1") setIsSetupComplete(true);

    const cachedMode = window.localStorage.getItem("schedule:mode") as "student" | "teacher" | null;
    if (cachedMode) setMode(cachedMode);

    const cachedGroupId = window.localStorage.getItem("schedule:groupId");
    const cachedTeacherId = window.localStorage.getItem("schedule:teacherId");
    const cachedGroups = window.localStorage.getItem("schedule:groups");

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
    
    Promise.all([api.groups(), api.directory.teachers()]).then(([items, ts]) => {
        setTeachers(ts);
        setGroups(items);

        // Teacher initialization
        if (!cachedTeacherId && ts.length > 0) {
            setTeacherId(ts[0].id);
        } else if (cachedTeacherId) {
            setTeacherId(Number(cachedTeacherId));
        }

        // Group initialization
        if (!cachedGroupId && items.length > 0) {
            setGroupId(items[0].id);
        } else if (cachedGroupId) {
            setGroupId(Number(cachedGroupId));
        }

        window.localStorage.setItem("schedule:groups", JSON.stringify(items));
      })
      .catch(() => {
        if (!cachedGroups) setError("Не вдалося завантажити групи. Спробуйте ще раз.");
      })
      .finally(() => setLoading(false));
  }, []);

  const toggleMode = (newMode: "student" | "teacher") => {
    setMode(newMode);
    window.localStorage.setItem("schedule:mode", newMode);
  };

  useEffect(() => {
    if (mode === "student" && groupId === null) return;
    if (mode === "teacher" && teacherId === null) return;
    
    const dateKey = `${weekAnchorDate.getFullYear()}-${String(weekAnchorDate.getMonth() + 1).padStart(2, "0")}-${String(weekAnchorDate.getDate()).padStart(2, "0")}`;
    const targetKey = mode === "student" ? `groupId:${groupId}` : `teacherId:${teacherId}`;
    const todayKey = `schedule:today:${targetKey}`;
    const weekKey = `schedule:week:${targetKey}:${dateKey}`;
    
    let hasCachedSchedule = false;
    try {
      const cachedToday = window.localStorage.getItem(todayKey);
      const cachedWeek = window.localStorage.getItem(weekKey);
      if (cachedToday) {
        setToday(JSON.parse(cachedToday) as ScheduleResponse);
        hasCachedSchedule = true;
      }
      if (cachedWeek) {
        setWeek(JSON.parse(cachedWeek) as ScheduleResponse[]);
        hasCachedSchedule = true;
      }
    } catch {
      window.localStorage.removeItem(todayKey);
      window.localStorage.removeItem(weekKey);
    }
    setLoading(!hasCachedSchedule);
    setError(null);
    
    const targetGroupId = mode === "student" ? (groupId as number) : undefined;
    const targetTeacherId = mode === "teacher" ? (teacherId as number) : undefined;
    const memKey = `${todayKey}|${weekKey}`;

    const cached = memoryCache.get(memKey);
    if (cached && Date.now() - cached.time < CACHE_TTL) {
       setToday(cached.today);
       setWeek(cached.week);
       setLoading(false);
       return;
    }

    Promise.all([api.today(targetGroupId, targetTeacherId), api.week(targetGroupId, targetTeacherId, weekAnchorDate)])
      .then(([todayResponse, weekResponse]) => {
        setToday(todayResponse);
        setWeek(weekResponse);
        window.localStorage.setItem(todayKey, JSON.stringify(todayResponse));
        window.localStorage.setItem(weekKey, JSON.stringify(weekResponse));
        memoryCache.set(memKey, { time: Date.now(), today: todayResponse, week: weekResponse });
      })
      .catch(() => {
        if (!hasCachedSchedule) setError("Не вдалося завантажити розклад. Перевірте з'єднання.");
      })
      .finally(() => setLoading(false));
  }, [mode, groupId, teacherId, weekAnchorDate]);

  useEffect(() => {
    let active = true;
    api.settings.semesterStart()
      .then((setting) => { if (active) setSemesterStart(setting.value); })
      .catch(() => { if (active) setSemesterStart(null); });
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

  return { isSetupComplete, completeSetup, resetSetup, mode, toggleMode, teachers, teacherId, setTeacherId: updateTeacherId, groups, groupId, setGroupId: updateGroupId, today, week, semesterStart, loading, error, setToday, setWeek, updateLesson, removeLesson, addLesson };
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
  if (!target.groupId && !target.teacherId) throw new Error("Не обрано ціль для завантаження");

  const mode = target.groupId ? "student" : "teacher";
  const targetKey = mode === "student" ? `groupId:${target.groupId}` : `teacherId:${target.teacherId}`;

  const nextWeekAnchor = new Date(currentWeekAnchor);
  nextWeekAnchor.setDate(nextWeekAnchor.getDate() + 7);

  const currDateKey = `${currentWeekAnchor.getFullYear()}-${String(currentWeekAnchor.getMonth() + 1).padStart(2, "0")}-${String(currentWeekAnchor.getDate()).padStart(2, "0")}`;
  const nextDateKey = `${nextWeekAnchor.getFullYear()}-${String(nextWeekAnchor.getMonth() + 1).padStart(2, "0")}-${String(nextWeekAnchor.getDate()).padStart(2, "0")}`;

  const todayKey = `schedule:today:${targetKey}`;
  const currWeekKey = `schedule:week:${targetKey}:${currDateKey}`;
  const nextWeekKey = `schedule:week:${targetKey}:${nextDateKey}`;

  // Fetching data from network
  const [todayRes, currWeekRes, nextWeekRes] = await Promise.all([
    api.today(target.groupId, target.teacherId),
    api.week(target.groupId, target.teacherId, currentWeekAnchor),
    api.week(target.groupId, target.teacherId, nextWeekAnchor),
  ]);

  // Saving exclusively on successful promise resolution
  window.localStorage.setItem(todayKey, JSON.stringify(todayRes));
  window.localStorage.setItem(currWeekKey, JSON.stringify(currWeekRes));
  window.localStorage.setItem(nextWeekKey, JSON.stringify(nextWeekRes));

  try {
    const saved = JSON.parse(window.localStorage.getItem("schedule:offlineSaved") || "[]");
    if (!saved.includes(targetKey)) {
      saved.push(targetKey);
      window.localStorage.setItem("schedule:offlineSaved", JSON.stringify(saved));
    }
  } catch (e) {
    window.localStorage.setItem("schedule:offlineSaved", JSON.stringify([targetKey]));
  }
}
