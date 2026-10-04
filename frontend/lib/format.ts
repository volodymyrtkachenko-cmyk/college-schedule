export function formatTeacherName(value: string): string {
  const name = value.trim();
  if (!name || name.includes(".")) return name;

  const parts = name.split(/\s+/);
  if (parts.length < 2) return name;
  if (parts.some((part) => part.length <= 2)) return name;

  const surname = parts[0];
  const initials = parts
    .slice(1)
    .map((part) => part[0]?.toUpperCase())
    .filter(Boolean)
    .join(".");
  return `${surname} ${initials}.`;
}

export function formatLessonCount(count: number): string {
  const remainder10 = count % 10;
  const remainder100 = count % 100;
  const noun = remainder10 >= 2 && remainder10 <= 4 && (remainder100 < 12 || remainder100 > 14)
    ? "заняття"
    : remainder10 === 1 && remainder100 !== 11
      ? "заняття"
      : "занять";
  return `${count} ${noun}`;
}

export function getWarmGreeting(date = new Date()): string {
  const hour = date.getHours();
  const day = date.getDay();

  if (day === 1 && hour < 12) {
    return "Попереду новий тиждень! Нехай він буде легким і продуктивним ☕";
  }
  if (day === 5 && hour >= 13) {
    return "Майже все! Ви чудово впоралися цього тижня, залишилося зовсім трохи 🎉";
  }
  if (hour < 12) return "Доброго ранку! Нехай сьогодні все складається спокійно ☀️";
  if (hour < 18) return "Гарного дня! Крок за кроком — і все встигнете 🌿";
  return "Вечір — час видихнути. Ви зробили достатньо 🌙";
}

export function getWorkloadMessage(lessonCount: number): string {
  if (lessonCount >= 4) {
    return "Сьогодні справжній марафон! Не забувайте пити воду та робити невеликі паузи між заняттями 💧";
  }
  if (lessonCount > 0 && lessonCount <= 2) {
    return "Сьогодні легкий день. Чудова нагода приділити час улюбленим справам або саморозвитку 📚";
  }
  if (lessonCount === 0) {
    return "Сьогодні можна трохи пригальмувати й подбати про себе 🛋️";
  }
  return "Рівний темп — теж хороший темп. Нехай день буде комфортним 🌱";
}

export function getWeekendCharge(date = new Date()): number {
  const day = date.getDay();
  if (day === 0 || day === 6) return 100;

  const fridayEvening = new Date(date);
  fridayEvening.setDate(date.getDate() + (5 - day));
  fridayEvening.setHours(18, 0, 0, 0);
  const mondayMorning = new Date(date);
  mondayMorning.setDate(date.getDate() - (day - 1));
  mondayMorning.setHours(8, 0, 0, 0);

  const total = fridayEvening.getTime() - mondayMorning.getTime();
  const elapsed = date.getTime() - mondayMorning.getTime();
  return Math.round(Math.min(100, Math.max(0, (elapsed / total) * 100)));
}

export function getWeekendMessage(date = new Date()): string {
  const day = date.getDay();
  if (day === 5 && date.getHours() >= 18) return "Вихідні вже почалися — час перемкнутися ✨";
  if (day === 0 || day === 6) return "Заряд вихідних: 100%. Відпочивайте без докорів сумління 💛";
  return `До вихідних ще трохи. Заряд наближення: ${getWeekendCharge(date)}%`;
}

export function getProgressMessage(studiedHours: number, totalHours: number): string {
  if (totalHours <= 0) return "Дані про навантаження відсутні.";

  const percentage = Math.max(0, (studiedHours / totalHours) * 100);
  const step = Math.min(100, Math.floor(percentage / 5) * 5);
  const phrases = motivationPhrases[`PROGRESS_${step}` as keyof typeof motivationPhrases]
    || motivationPhrases.PROGRESS_0;
  return getRandomPhrase(phrases);
}

export function getProgressPercentage(studiedHours: number, totalHours: number): number {
  if (totalHours <= 0) return 0;
  return Math.max(0, Math.floor((studiedHours / totalHours) * 100));
}

export function getInsightMessage(
  entityType: "teacher" | "group",
  todayLessonsCount: number,
  generalProgressMessage: string,
  date = new Date(),
): string {
  const dayOfWeek = date.getDay();
  const hour = date.getHours();
  const teacher = entityType === "teacher";

  if (dayOfWeek === 0 && hour >= 18) {
    return getRandomPhrase(motivationPhrases[teacher ? "WEEK_PREP_TEACHER" : "WEEK_PREP_GROUP"]);
  }
  if (dayOfWeek === 6 || dayOfWeek === 0) {
    return getRandomPhrase(motivationPhrases[teacher ? "WEEKEND_TEACHER" : "WEEKEND_GROUP"]);
  }
  if (dayOfWeek === 5 && hour >= 14) {
    return getRandomPhrase(motivationPhrases[teacher ? "WEEKEND_START_TEACHER" : "WEEKEND_START_GROUP"]);
  }
  if (dayOfWeek === 1 && hour < 12) {
    return generalProgressMessage;
  }
  if (todayLessonsCount === 0) {
    return getRandomPhrase(motivationPhrases[teacher ? "FREE_DAY_TEACHER" : "FREE_DAY_GROUP"]);
  }
  if (todayLessonsCount >= 4) {
    return getRandomPhrase(motivationPhrases[teacher ? "HIGH_LOAD_TEACHER" : "HIGH_LOAD_GROUP"]);
  }
  if (teacher && todayLessonsCount <= 2) {
    return getRandomPhrase(motivationPhrases.LIGHT_DAY_TEACHER);
  }
  if (!teacher && todayLessonsCount === 1) {
    return getRandomPhrase(motivationPhrases.LIGHT_DAY_GROUP);
  }
  return generalProgressMessage;
}

export function getScheduleInsightMessage(
  entityType: "teacher" | "group",
  todayLessonsCount: number,
  entityId = 0,
  date = new Date(),
  lessons: Lesson[] = [],
): { icon: string; text: string } {
  const dayOfWeek = date.getDay();
  const hour = date.getHours();
  const minute = date.getMinutes();
  const currentMinutes = hour * 60 + minute;
  const lastLessonEnd = getLastLessonEnd(lessons);
  const isAfterClasses = lastLessonEnd !== null
    ? currentMinutes >= lastLessonEnd
    : currentMinutes >= 15 * 60 + 20;
  const isWorkingHours = hour >= 8 && !isAfterClasses;
  const teacher = entityType === "teacher";
  const roleKey = `${entityType}:${entityId}`;
  const dayKey = dateKey(date);
  const phrase = (phase: string, values: string[]) =>
    getStablePhrase(values, `${roleKey}:${dayKey}:${phase}`);

  if (dayOfWeek === 0 && hour >= 18) {
    return {
      icon: "🌅",
      text: phrase("week-prep", motivationPhrases[teacher ? "WEEK_PREP_TEACHER" : "WEEK_PREP_GROUP"]),
    };
  }

  if (dayOfWeek === 6 || dayOfWeek === 0) {
    return {
      icon: "☕",
      text: phrase("weekend", motivationPhrases[teacher ? "WEEKEND_TEACHER" : "WEEKEND_GROUP"]),
    };
  }

  if (dayOfWeek === 5 && isAfterClasses) {
    return {
      icon: "🎉",
      text: phrase("weekend-start", motivationPhrases[teacher ? "WEEKEND_START_TEACHER" : "WEEKEND_START_GROUP"]),
    };
  }

  if (todayLessonsCount === 0) {
    return {
      icon: "🥳",
      text: phrase("free-day", motivationPhrases[teacher ? "FREE_DAY_TEACHER" : "FREE_DAY_GROUP"]),
    };
  }

  if (todayLessonsCount >= 4 && isWorkingHours) {
    return {
      icon: "🔥",
      text: phrase("high-load", motivationPhrases[teacher ? "HIGH_LOAD_TEACHER" : "HIGH_LOAD_GROUP"]),
    };
  }

  if (isAfterClasses && dayOfWeek >= 1 && dayOfWeek <= 4) {
    return {
      icon: "🌙",
      text: phrase("evening", motivationPhrases[teacher ? "EVENING_TEACHER" : "EVENING_GROUP"]),
    };
  }

  if (isWorkingHours) {
    return {
      icon: "⏳",
      text: phrase("active", motivationPhrases[teacher ? "ACTIVE_TEACHER" : "ACTIVE_GROUP"]),
    };
  }

  return {
    icon: "🌅",
    text: teacher
      ? "Гарного робочого дня та уважних студентів!"
      : "Продуктивного дня! Нехай всі пари пройдуть легко.",
  };
}
import { getRandomPhrase, motivationPhrases } from "./constants/phrases";
import type { Lesson } from "./api";

function getStablePhrase(phrases: string[], key: string): string {
  if (phrases.length === 0) return "";
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return phrases[(hash >>> 0) % phrases.length];
}

function dateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(date);
}

function parseLessonEnd(time: string | undefined): number | null {
  const match = time?.match(/-(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function getLastLessonEnd(lessons: Lesson[]): number | null {
  const ends = lessons
    .map((lesson) => parseLessonEnd(lesson.time))
    .filter((value): value is number => value !== null);
  return ends.length ? Math.max(...ends) : null;
}
