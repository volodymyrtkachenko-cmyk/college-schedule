"use client";

import { useEffect, useState } from "react";
import { api, DirectoryItem, ScheduleResponse } from "./api";

const DEFAULT_GROUP_ID = Number(process.env.NEXT_PUBLIC_DEFAULT_GROUP_ID ?? "85");
const DEFAULT_GROUP_NAME = process.env.NEXT_PUBLIC_DEFAULT_GROUP_NAME ?? "85";

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
  const [groups, setGroups] = useState<DirectoryItem[]>([]);
  const [groupId, setGroupId] = useState<number | null>(null);
  const [today, setToday] = useState<ScheduleResponse | null>(null);
  const [week, setWeek] = useState<ScheduleResponse[]>([]);
  const [semesterStart, setSemesterStart] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const cachedGroups = window.sessionStorage.getItem("schedule:groups");
    if (cachedGroups) {
      try {
        const items = JSON.parse(cachedGroups) as DirectoryItem[];
        setGroups(items);
        setGroupId(items[0]?.id ?? null);
        setLoading(false);
      } catch {
        window.sessionStorage.removeItem("schedule:groups");
      }
    }
    api.groups().then((items) => {
        const defaultGroup = items.find((item) => item.id === DEFAULT_GROUP_ID)
          ?? items.find((item) => item.name === DEFAULT_GROUP_NAME);
        const visibleGroups = defaultGroup ? [defaultGroup, ...items.filter((item) => item.id !== defaultGroup.id)] : items;
        setGroups(visibleGroups);
        setGroupId(defaultGroup?.id ?? null);
        window.sessionStorage.setItem("schedule:groups", JSON.stringify(visibleGroups));
      })
      .catch(() => {
        if (!cachedGroups) setError("Не вдалося завантажити групи. Спробуйте ще раз.");
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (groupId === null) return;
    const dateKey = `${weekAnchorDate.getFullYear()}-${String(weekAnchorDate.getMonth() + 1).padStart(2, "0")}-${String(weekAnchorDate.getDate()).padStart(2, "0")}`;
    const todayKey = `schedule:today:${groupId}`;
    const weekKey = `schedule:week:${groupId}:${dateKey}`;
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
    Promise.all([api.today(groupId), api.week(groupId, weekAnchorDate)])
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
  }, [groupId, weekAnchorDate]);

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
  return { groups, groupId, setGroupId, today, week, semesterStart, loading, error, setToday, setWeek, updateLesson, removeLesson, addLesson };
}
