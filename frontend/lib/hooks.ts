"use client";

import { useEffect, useState } from "react";
import { api, DirectoryItem, ScheduleResponse } from "./api";


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
    const cachedMode = window.localStorage.getItem("schedule:mode") as "student" | "teacher" | null;
    if (cachedMode) setMode(cachedMode);

    const cachedGroups = window.sessionStorage.getItem("schedule:groups");
    const cachedGroupId = window.localStorage.getItem("schedule:groupId");
    const cachedTeacherId = window.localStorage.getItem("schedule:teacherId");
    
    if (cachedGroups) {
      try {
        const items = JSON.parse(cachedGroups) as import("./api").ReferenceRecord[];
        setGroups(items);
        setGroupId(cachedGroupId ? Number(cachedGroupId) : (items[0]?.id ?? null));
        setLoading(false);
      } catch {
        window.sessionStorage.removeItem("schedule:groups");
      }
    }
    
    Promise.all([api.groups(), api.directory.teachers()]).then(([items, ts]) => {
        setTeachers(ts);
        setGroups(items);
        if (!cachedGroupId && items.length > 0) setGroupId(items[0].id);
        else if (cachedGroupId && !groupId) setGroupId(Number(cachedGroupId));
        
        if (!cachedTeacherId && ts.length > 0) setTeacherId(ts[0].id);
        else if (cachedTeacherId && !teacherId) setTeacherId(Number(cachedTeacherId));
        
        window.sessionStorage.setItem("schedule:groups", JSON.stringify(items));
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
      const cachedToday = window.sessionStorage.getItem(todayKey);
      const cachedWeek = window.sessionStorage.getItem(weekKey);
      if (cachedToday) {
        setToday(JSON.parse(cachedToday) as ScheduleResponse);
        hasCachedSchedule = true;
      }
      if (cachedWeek) {
        setWeek(JSON.parse(cachedWeek) as ScheduleResponse[]);
        hasCachedSchedule = true;
      }
    } catch {
      window.sessionStorage.removeItem(todayKey);
      window.sessionStorage.removeItem(weekKey);
    }
    setLoading(!hasCachedSchedule);
    setError(null);
    
    const targetGroupId = mode === "student" ? (groupId as number) : undefined;
    const targetTeacherId = mode === "teacher" ? (teacherId as number) : undefined;

    Promise.all([api.today(targetGroupId, targetTeacherId), api.week(targetGroupId, targetTeacherId, weekAnchorDate)])
      .then(([todayResponse, weekResponse]) => {
        setToday(todayResponse);
        setWeek(weekResponse);
        window.sessionStorage.setItem(todayKey, JSON.stringify(todayResponse));
        window.sessionStorage.setItem(weekKey, JSON.stringify(weekResponse));
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

  return { mode, toggleMode, teachers, teacherId, setTeacherId: updateTeacherId, groups, groupId, setGroupId: updateGroupId, today, week, semesterStart, loading, error, setToday, setWeek, updateLesson, removeLesson, addLesson };
}
