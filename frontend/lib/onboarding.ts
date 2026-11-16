import { addDaysToCalendarIso } from "./calendarDate";
import type { Lesson, ScheduleResponse } from "./api/types";

export const SETUP_COMPLETE_STORAGE_KEY = "schedule:setupComplete";
export const ADMIN_SESSION_STORAGE_KEY = "schedule:has_admin_session";
export const ONBOARDING_CHANGE_EVENT = "college-schedule:onboarding-change";

const EXEMPT_ROUTE_PREFIXES = ["/admin", "/login", "/~offline"] as const;

const PREVIEW_LESSONS_BLUEPRINT: Array<{
  lesson_number: number;
  time: string;
  subject: string;
  room: string;
  is_online?: boolean;
}> = [
  {
    lesson_number: 1,
    time: "09:00-10:20",
    subject: "Вища математика",
    room: "ауд. 204",
  },
  {
    lesson_number: 2,
    time: "10:40-12:00",
    subject: "Іноземна мова",
    room: "ауд. 308",
    is_online: true,
  },
  {
    lesson_number: 3,
    time: "12:30-13:50",
    subject: "Алгоритми та структури даних",
    room: "ауд. 115",
  },
  {
    lesson_number: 4,
    time: "14:00-15:20",
    subject: "Комп'ютерна схемотехніка",
    room: "ауд. 212",
  },
];

/**
 * Повертає true для службових маршрутів, які мають залишатися доступними
 * без проходження студентського/викладацького онбордингу.
 */
export function isOnboardingExemptPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  const normalized = pathname.split("?")[0].split("#")[0].replace(/\/+$/, "") || "/";
  return EXEMPT_ROUTE_PREFIXES.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`)
  );
}

export function readStoredSetupComplete(storage?: Pick<Storage, "getItem"> | null): boolean {
  try {
    const store = storage ?? (typeof window !== "undefined" ? window.localStorage : null);
    if (!store) return false;
    return (
      store.getItem(SETUP_COMPLETE_STORAGE_KEY) === "1" ||
      store.getItem(ADMIN_SESSION_STORAGE_KEY) === "1"
    );
  } catch {
    return false;
  }
}

export function writeStoredSetupComplete(storage?: Pick<Storage, "setItem"> | null): void {
  try {
    const store = storage ?? (typeof window !== "undefined" ? window.localStorage : null);
    store?.setItem(SETUP_COMPLETE_STORAGE_KEY, "1");
  } catch {}
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(ONBOARDING_CHANGE_EVENT));
  }
}

function makeStaticPreviewDay(dateIso: string): ScheduleResponse {
  const lessons: Lesson[] = PREVIEW_LESSONS_BLUEPRINT.map((item, idx) => ({
    id: -(idx + 1),
    lesson_number: item.lesson_number,
    time: item.time,
    subject: item.subject,
    subject_id: -(idx + 1),
    subject_name: item.subject,
    teacher: "Викладач коледжу",
    teacher_id: null,
    second_teacher_id: null,
    teacher_name: "Викладач коледжу",
    day_of_week: 0,
    room: item.room,
    week_type: "both",
    is_relevant_this_week: true,
    note: null,
    is_online: item.is_online,
  }));

  return {
    date: dateIso,
    week_type: "numerator",
    lessons,
  };
}

/**
 * Формує день для заблюреного фонового прев'ю за екраном привітання:
 * пріоритет — реальний день із SSR-розкладу, далі — найближчий навчальний день
 * із SSR, або нейтральний демонстраційний розклад, якщо API/мережа недоступні.
 */
export function buildBlurredPreviewScheduleDay(
  dateIso: string,
  candidateWeek?: ScheduleResponse[] | null
): ScheduleResponse {
  if (Array.isArray(candidateWeek) && candidateWeek.length > 0) {
    const exactMatch = candidateWeek.find((d) => d.date === dateIso && d.lessons?.length > 0);
    if (exactMatch) return exactMatch;

    const firstPopulated = candidateWeek.find((d) => d.lessons && d.lessons.length > 0);
    if (firstPopulated) {
      return {
        ...firstPopulated,
        date: dateIso,
      };
    }
  }
  return makeStaticPreviewDay(dateIso);
}

export function buildBlurredPreviewWeek(
  weekStartIso: string,
  candidateWeek?: ScheduleResponse[] | null
): ScheduleResponse[] {
  if (Array.isArray(candidateWeek) && candidateWeek.some((d) => d.lessons && d.lessons.length > 0)) {
    return candidateWeek;
  }
  return [0, 1, 2, 3, 4].map((offset) =>
    makeStaticPreviewDay(addDaysToCalendarIso(weekStartIso, offset))
  );
}
