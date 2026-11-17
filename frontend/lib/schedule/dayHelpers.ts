import type { Lesson } from "../api";

export function parseLessonMinutes(timeStr?: string | null): [number, number] | null {
  if (!timeStr) return null;
  const parts = timeStr.split(/[-–—]/).map((s) => s.trim());
  if (parts.length !== 2) return null;
  const parsePart = (p: string) => {
    const [h, m] = p.split(":").map(Number);
    return Number.isNaN(h) || Number.isNaN(m) ? null : h * 60 + m;
  };
  const s = parsePart(parts[0]);
  const e = parsePart(parts[1]);
  return s !== null && e !== null ? [s, e] : null;
}

export function computeLessonBreakState(
  prevLesson: Lesson | null | undefined,
  currentLesson: Lesson,
  isCurrentDayToday: boolean,
  currentMinutes: number
): { isBreakNow: boolean; breakRemainMins: number; breakProgressPct: number } {
  let isBreakNow = false;
  let breakRemainMins = 0;
  let breakProgressPct = 0;
  if (
    prevLesson &&
    prevLesson.lesson_number !== currentLesson.lesson_number &&
    isCurrentDayToday &&
    currentMinutes >= 0
  ) {
    const prevRange = parseLessonMinutes(prevLesson.time);
    const currRange = parseLessonMinutes(currentLesson.time);
    if (prevRange && currRange && currentMinutes > prevRange[1] && currentMinutes < currRange[0]) {
      isBreakNow = true;
      breakRemainMins = currRange[0] - currentMinutes;
      const totalBreak = Math.max(1, currRange[0] - prevRange[1]);
      breakProgressPct = Math.min(
        100,
        Math.max(0, Math.round(((currentMinutes - prevRange[1]) / totalBreak) * 100))
      );
    }
  }
  return { isBreakNow, breakRemainMins, breakProgressPct };
}

export function resolveScheduleOwnerLabel(
  scheduleMode: "student" | "teacher",
  currentGroupName?: string | null,
  currentTeacherName?: string | null,
  lessons?: Lesson[]
): string {
  return scheduleMode === "teacher"
    ? currentTeacherName || lessons?.[0]?.teacher_name || "Розклад викладача"
    : currentGroupName
      ? `Група ${currentGroupName}`
      : lessons?.[0]?.group_name
        ? `Група ${lessons[0].group_name}`
        : "Розклад";
}
