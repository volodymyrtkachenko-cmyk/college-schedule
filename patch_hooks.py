import re

with open("frontend/lib/hooks.ts", "r") as f:
    text = f.read()

# Add in-memory cache at top-level
memory_cache = """const memoryCache = new Map<string, { time: number; today: ScheduleResponse; week: ScheduleResponse[] }>();
const CACHE_TTL = 1000 * 60 * 5; // 5 minutes

export function useOnlineStatus() {"""
text = text.replace('export function useOnlineStatus() {', memory_cache)

# Modify the fetch logic
old_fetch = """    const targetGroupId = mode === "student" ? (groupId as number) : undefined;
    const targetTeacherId = mode === "teacher" ? (teacherId as number) : undefined;

    Promise.all([api.today(targetGroupId, targetTeacherId), api.week(targetGroupId, targetTeacherId, weekAnchorDate)])
      .then(([todayResponse, weekResponse]) => {
        setToday(todayResponse);
        setWeek(weekResponse);
        window.localStorage.setItem(todayKey, JSON.stringify(todayResponse));
        window.localStorage.setItem(weekKey, JSON.stringify(weekResponse));
      })
      .catch(() => {
        if (!hasCachedSchedule) setError("Не вдалося завантажити розклад. Перевірте з'єднання.");
      })
      .finally(() => setLoading(false));"""

new_fetch = """    const targetGroupId = mode === "student" ? (groupId as number) : undefined;
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
      .finally(() => setLoading(false));"""

text = text.replace(old_fetch, new_fetch)

with open("frontend/lib/hooks.ts", "w") as f:
    f.write(text)
