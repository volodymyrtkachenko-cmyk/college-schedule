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

export function formatPlural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod100 >= 11 && mod100 <= 19) return `${count} ${many}`;
  if (mod10 === 1) return `${count} ${one}`;
  if (mod10 >= 2 && mod10 <= 4) return `${count} ${few}`;
  return `${count} ${many}`;
}

export function formatLessonCount(count: number): string {
  return formatPlural(count, "заняття", "заняття", "занять");
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
import type { Lesson, ScheduleResponse } from "./api";
import { KYIV_DATE_FMT } from "./date";

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
  return KYIV_DATE_FMT.format(date);
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

/** Abbreviates one or several teachers ("A B C / D E F" -> "A B.C. / D E.F."). */
export function formatTeachers(value: string): string {
  return value
    .split(/\s*[,/]\s*/)
    .map((name) => formatTeacherName(name))
    .filter(Boolean)
    .join(" / ");
}

const ROOM_PREFIXES = ["ауд", "каб", "спорт", "дист", "акт", "ск"];

export function formatRoom(room: string): string {
  const clean = room
    .split(",")
    .map((part) => part.replace(/^(?:аудиторія|ауд\.?\s*иторія|ауд\.?)\s*/i, "").trim())
    .filter(Boolean)
    .join(" / ");
  const lower = clean.toLowerCase();
  return ROOM_PREFIXES.some((prefix) => lower.startsWith(prefix)) ? clean : `ауд. ${clean}`;
}

export function formatRoomsList(rooms: string[]): string {
  if (rooms.length === 0) return "";
  const parts = rooms
    .flatMap((r) => r.split(","))
    .map((part) => part.replace(/^(?:аудиторія|ауд\.?\s*иторія|ауд\.?)\s*/i, "").trim())
    .filter(Boolean);
  if (parts.length > 1) {
    return parts.join(" · ");
  }
  return formatRoom(rooms[0]);
}

export interface MeetingInfo {
  url: string;
  platform: "meet" | "zoom" | "teams" | "link";
  passcode: string | null;
  label?: string;
  isProtected?: boolean;
}

export function extractOnlineMeetings(
  note?: string | null,
  room?: string | null,
  teacherName?: string | null,
  subjectName?: string | null
): MeetingInfo[] {
  const isForeignLang = Boolean(
    (subjectName && /іноземн|англ/i.test(subjectName)) ||
    (teacherName && /токарєв|хочинськ/i.test(teacherName))
  );

  const isElectronics = Boolean(
    (subjectName && /електронік/i.test(subjectName)) ||
    (teacherName && /філімончук/i.test(teacherName))
  );

  const lines = `${room || ""}\n${note || ""}`.split("\n");
  const results: MeetingInfo[] = [];
  const seenUrls = new Set<string>();

  for (const line of lines) {
    if (line.trim().startsWith("[TASK]")) continue;

    const urlMatches = Array.from(
      line.matchAll(/https?:\/\/(?:meet\.google\.com|[a-z0-9.-]*zoom\.us|teams\.microsoft\.com|teams\.live\.com)\/[^\s<>"')|]+/gi)
    );

    if (urlMatches.length > 0) {
      for (const match of urlMatches) {
        let url = match[0];
        if (seenUrls.has(url.toLowerCase())) continue;
        seenUrls.add(url.toLowerCase());

        const lowerUrl = url.toLowerCase();
        const isMeet = lowerUrl.includes("meet.google.com");
        const isZoom = lowerUrl.includes("zoom.us");
        const isTeams = lowerUrl.includes("teams.microsoft.com") || lowerUrl.includes("teams.live.com");
        const hasPwdInUrl = /[?&]pwd=[^&\s]+/i.test(url);

        const passMatch = line.match(
          /(?:Код(?:\s+доступ[уа])?|Passcode|Пароль)\s*[:\-]?\s*([A-Za-z0-9_.\-]+)/i
        );
        let rawPass = passMatch ? passMatch[1] : null;

        if (isElectronics && !isMeet && !hasPwdInUrl && !rawPass) {
          rawPass = "dfkr";
        }

        if (isZoom && !hasPwdInUrl && rawPass) {
          const sep = url.includes("?") ? "&" : "?";
          url = `${url}${sep}pwd=${encodeURIComponent(rawPass)}`;
        }

        let label: string | undefined;
        const lowerLine = line.toLowerCase();
        if (lowerLine.includes("токарєв") || lowerLine.includes("токарев")) {
          label = "Токарєва";
        } else if (lowerLine.includes("хочинськ") || lowerLine.includes("хочинск")) {
          label = "Хочинська";
        } else {
          const prefixMatch = line.match(
            /^(?:\[([^\]]+)\]|([А-Яа-яІіЇїЄєҐґa-zA-Z0-9\s.'—–\-]+|\d+\s*підгрупа|підгрупа\s*\d+))\s*[:\-–]?\s*https?/i
          );
          if (prefixMatch) {
            const raw = (prefixMatch[1] || prefixMatch[2] || "").trim();
            if (raw.length >= 2 && raw.length <= 30) {
              label = raw;
            }
          }
        }

        if (!label && isForeignLang) {
          label = isMeet ? "Токарєва" : "Хочинська";
        }

        const platform: MeetingInfo["platform"] = isMeet
          ? "meet"
          : isZoom
          ? "zoom"
          : isTeams
          ? "teams"
          : "link";

        results.push({
          url,
          platform,
          passcode: null,
          label,
        });
      }
    } else {
      const lockedMatches = Array.from(
        line.matchAll(/\[🔒\s*Онлайн(?::\s*(Meet|Zoom|Teams))?\]|\[🔒\s*(Meet|Zoom|Teams|Онлайн)\]/gi)
      );
      for (const match of lockedMatches) {
        const rawPlat = (match[1] || match[2] || "").toLowerCase();
        const platform: MeetingInfo["platform"] =
          rawPlat === "meet" ? "meet" : rawPlat === "zoom" ? "zoom" : rawPlat === "teams" ? "teams" : "link";

        let label: string | undefined;
        const lowerLine = line.toLowerCase();
        if (lowerLine.includes("токарєв") || lowerLine.includes("токарев")) {
          label = "Токарєва";
        } else if (lowerLine.includes("хочинськ") || lowerLine.includes("хочинск")) {
          label = "Хочинська";
        } else {
          const prefixMatch = line.match(
            /^(?:\[([^\]]+)\]|([А-Яа-яІіЇїЄєҐґa-zA-Z0-9\s.'—–\-]+|\d+\s*підгрупа|підгрупа\s*\d+))\s*[:\-–]?\s*\[🔒/i
          );
          if (prefixMatch) {
            const raw = (prefixMatch[1] || prefixMatch[2] || "").trim();
            if (raw.length >= 2 && raw.length <= 30 && !raw.includes("🔒")) {
              label = raw;
            }
          }
        }

        if (!label && isForeignLang) {
          label = platform === "meet" ? "Токарєва" : "Хочинська";
        }

        results.push({
          url: "",
          platform,
          passcode: null,
          label,
          isProtected: true,
        });
      }
    }
  }

  if (results.length === 0 && (room?.trim() === "Онлайн" || (note && note.includes("🔒")))) {
    results.push({
      url: "",
      platform: "link",
      passcode: null,
      isProtected: true,
    });
  }

  if (isForeignLang && results.length > 0) {
    for (const r of results) {
      if (!r.label) {
        r.label = r.platform === "meet" ? "Токарєва" : "Хочинська";
      }
    }
    results.sort((a, b) => {
      if (a.label === "Токарєва") return -1;
      if (b.label === "Токарєва") return 1;
      return 0;
    });
  }

  return results;
}

export interface FormattedLessonItem {
  lessonNumber: number;
  time: string;
  startTime: string;
  endTime: string;
  subjectName: string;
  secondary: string;
  rooms: string[];
  roomText: string | null;
  meetings: MeetingInfo[];
  eventBadge: { label: string; bg?: string; text?: string } | null;
  isReplacement: boolean;
}

export function formatLessonDetails(
  lesson: Lesson,
  scheduleMode: "student" | "teacher" | "admin" = "student"
): FormattedLessonItem {
  const [startT = "", endT = ""] = (lesson.time || "").split("-").map((s) => s.trim());
  const subjectDisplay = lesson.event_title && lesson.event_title !== lesson.subject_name
    ? `${lesson.subject_name} (${lesson.event_title})`
    : lesson.subject_name;

  const secondary =
    scheduleMode === "teacher" && lesson.group_name
      ? `Група ${lesson.group_name}`
      : lesson.teacher_name
        ? formatTeachers(lesson.teacher_name)
        : "";

  const rawRooms = lesson.room
    ? lesson.room
        .split(/\s*[,/;]\s*/)
        .map((r) => r.trim())
        .filter(Boolean)
    : [];

  const roomText = rawRooms.length > 0 ? rawRooms.map(formatRoom).join(", ") : null;

  const meetings = extractOnlineMeetings(
    lesson.note,
    lesson.room,
    lesson.teacher_name,
    lesson.subject_name
  );

  let eventBadge: FormattedLessonItem["eventBadge"] = null;
  if (lesson.event_type) {
    let label = "📌 ПОДІЯ";
    let bg = "#0284c7";
    if (lesson.event_type === "exam") { label = "📝 ЕКЗАМЕН"; bg = "#e11d48"; }
    else if (lesson.event_type === "consultation") { label = "💬 КОНСУЛЬТАЦІЯ"; bg = "#d97706"; }
    else if (lesson.event_type === "credit") { label = "✅ ЗАЛІК"; bg = "#059669"; }
    else if (lesson.event_type === "defense") { label = "🎓 ЗАХИСТ"; bg = "#7c3aed"; }
    eventBadge = { label, bg, text: "#ffffff" };
  }

  return {
    lessonNumber: lesson.lesson_number,
    time: lesson.time || "",
    startTime: startT,
    endTime: endT,
    subjectName: subjectDisplay,
    secondary,
    rooms: rawRooms,
    roomText,
    meetings,
    eventBadge,
    isReplacement: Boolean(lesson.is_replacement),
  };
}

const NUM_EMOJI: Record<number, string> = {
  1: "1️⃣",
  2: "2️⃣",
  3: "3️⃣",
  4: "4️⃣",
  5: "5️⃣",
  6: "6️⃣",
  7: "7️⃣",
  8: "8️⃣",
};

export function getMondayOf(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function calculateWeekNumber(anchorDate: Date, semesterStart?: string | null): number | null {
  if (!semesterStart) return null;
  const start = new Date(semesterStart);
  const diffTime = anchorDate.getTime() - getMondayOf(start).getTime();
  const diffWeeks = Math.floor(diffTime / (7 * 24 * 60 * 60 * 1000)) + 1;
  return diffWeeks > 0 ? diffWeeks : null;
}

export function buildTelegramShareText(
  schedule: ScheduleResponse,
  scheduleMode: "student" | "teacher" | "admin" = "student",
  weekNumber?: number | null
): string {
  const dateObj = new Date(`${schedule.date}T12:00:00`);
  const dateFormatted = new Intl.DateTimeFormat("uk-UA", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(dateObj);

  const capitalizedDate = dateFormatted.charAt(0).toUpperCase() + dateFormatted.slice(1);
  const weekTypeUk =
    schedule.week_type === "numerator"
      ? "чисельник"
      : schedule.week_type === "denominator"
      ? "знаменник"
      : "";

  let weekInfo = "";
  if (weekNumber && weekTypeUk) {
    weekInfo = ` · ${weekNumber} тиждень (${weekTypeUk})`;
  } else if (weekNumber) {
    weekInfo = ` · ${weekNumber} тиждень`;
  } else if (weekTypeUk) {
    weekInfo = ` (${weekTypeUk})`;
  }

  const header = `📅 ${capitalizedDate}${weekInfo}`;
  if (!schedule.lessons || schedule.lessons.length === 0) {
    return `${header}\n\n🎉 Пар немає!`;
  }

  const sortedLessons = [...schedule.lessons].sort(
    (left, right) => left.lesson_number - right.lesson_number || left.id - right.id
  );

  const lines = sortedLessons.map((l) => {
    const item = formatLessonDetails(l, scheduleMode);
    const num = NUM_EMOJI[item.lessonNumber] ?? `${item.lessonNumber}.`;
    const rep = item.eventBadge
      ? ` [${item.eventBadge.label}]`
      : item.isReplacement
      ? " ⚡ЗАМІНА"
      : "";

    const parts: string[] = [];
    if (item.secondary) {
      parts.push(scheduleMode === "teacher" ? `👥 ${item.secondary}` : `👤 ${item.secondary}`);
    }
    if (item.roomText) {
      parts.push(item.roomText);
    }
    if (item.meetings.length > 0) {
      const m = item.meetings[0];
      const name = m.platform === "zoom" ? "Zoom" : m.platform === "meet" ? "Meet" : "Онлайн";
      if (m.isProtected || !m.url) {
        parts.push(`💻 🔒 ${name}`);
      } else {
        parts.push(`💻 ${name}: ${m.url}`);
      }
    }

    const detailsLine = parts.length > 0 ? `\n   ${parts.join(" • ")}` : "";
    return `${num} ${item.time} — ${item.subjectName}${rep}${detailsLine}`;
  });

  return `${header}\n\n${lines.join("\n\n")}`;
}

const UKR_MONTHS_SHORT_DECL = [
  "січ.", "лют.", "берез.", "квіт.", "трав.", "черв.",
  "лип.", "серп.", "верес.", "жовт.", "листоп.", "груд."
];

export const UKR_MONTHS_LONG_DECL = [
  "січня", "лютого", "березня", "квітня", "травня", "червня",
  "липня", "серпня", "вересня", "жовтня", "листопада", "грудня"
];

/**
 * Форматує повний діапазон дат тижня (понеділок – неділя):
 * - Якщо дні в одному місяці: "19–25 жовтня 2026 року"
 * - Якщо дні в різних місяцях одного року: "26 жовтня – 1 листопада 2026 року"
 * - Якщо тиждень охоплює різні роки: "28 грудня 2026 року – 3 січня 2027 року"
 * Забезпечує коректне літературне написання «року» без скорочення «р.» та запобігає обрізанню до «202...».
 */
export function formatFullWeekRange(monday: Date): string {
  const mon = getMondayOf(monday);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);

  const monDay = mon.getDate();
  const sunDay = sun.getDate();
  const monMonth = mon.getMonth();
  const sunMonth = sun.getMonth();
  const monYear = mon.getFullYear();
  const sunYear = sun.getFullYear();

  if (monYear !== sunYear) {
    return `${monDay} ${UKR_MONTHS_LONG_DECL[monMonth]} ${monYear} року – ${sunDay} ${UKR_MONTHS_LONG_DECL[sunMonth]} ${sunYear} року`;
  }

  if (monMonth === sunMonth) {
    return `${monDay}–${sunDay} ${UKR_MONTHS_LONG_DECL[monMonth]} ${sunYear} року`;
  }

  return `${monDay} ${UKR_MONTHS_LONG_DECL[monMonth]} – ${sunDay} ${UKR_MONTHS_LONG_DECL[sunMonth]} ${sunYear} року`;
}

export function formatShortWeekRange(monday: Date, weekNumber?: number | null): string {
  const mon = getMondayOf(monday);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);

  const monDay = mon.getDate();
  const sunDay = sun.getDate();
  const monMonth = mon.getMonth();
  const sunMonth = sun.getMonth();

  let dateRange = "";
  if (monMonth === sunMonth) {
    dateRange = `${monDay}–${sunDay} ${UKR_MONTHS_SHORT_DECL[monMonth]}`;
  } else {
    dateRange = `${monDay} ${UKR_MONTHS_SHORT_DECL[monMonth]} – ${sunDay} ${UKR_MONTHS_SHORT_DECL[sunMonth]}`;
  }

  if (weekNumber) {
    return `${dateRange} · ${weekNumber} тиждень`;
  }
  return dateRange;
}

/**
 * Нормалізує назву навчальної дисципліни:
 * - Видаляє суфікси груп: (85 ДФКР), [85-ДФКР], 85 ДФКР, (гр. 85), (група 85) тощо
 * - Видаляє згадки викладачів або підгруп у дужках: (Хочинська Н. О.), (Токарь), (1 підгрупа)
 * - Очищує зайві знаки пунктуації та пробіли
 */
export function normalizeSubjectName(rawName?: string | null): string {
  if (!rawName) return "";
  let name = rawName.trim();
  // Видаляємо групу в дужках або квадратних дужках: (85 ДФКР), [85-ДФКР], (85), (гр. 85), (група 85)
  name = name.replace(/\s*[\(\[]\s*(?:гр(?:упа|\.)?\s*)?\d{1,3}[\s\-_–—]?(?:[А-Яа-яA-Za-z]+)?\s*[\)\]]/gi, "");
  // Видаляємо окремі назви груп у хвості: 85 ДФКР, 85-ДФКР, 85ДФКР
  name = name.replace(/\s*\b\d{1,3}[\s\-_–—]?(?:[А-Яа-яA-Za-z]+)\b/g, "");
  name = name.replace(/\s*\b(?:гр(?:упа|\.)?)\s*\d+.*$/gi, "");
  // Видаляємо прізвища викладачів або підгрупи у дужках: (Хочинська Н. О.), (Токарь), (підгрупа 1)
  name = name.replace(/\s*[\(\[]\s*(?:(?:1|2)[\s\-_–—]?(?:ша|га|а)?\s*(?:підгр(?:упа|\.)?)|(?:викл(?:адач|\.)?\s*)?[А-ЯІЇЄҐA-Z][а-яіїєґa-z]+(?:\s+[А-ЯІЇЄҐA-Z]\.?\s*[А-ЯІЇЄҐA-Z]\.?)?)\s*[\)\]]/gi, "");
  // Прибираємо кінцеві дефіси, коми, двокрапки
  name = name.replace(/[\s\-_–—:,.]+$/, "").trim();
  return name || rawName.trim();
}

/**
 * Перевіряє відповідність дисципліни завданню за фільтром:
 * Нечутливий до регістру, враховує нормалізовані назви та включення
 */
export function isSubjectMatch(taskSubject?: string | null, filterSubject?: string | null): boolean {
  if (!filterSubject || filterSubject.trim() === "") return true;
  if (!taskSubject) return false;
  if (taskSubject === filterSubject) return true;
  const normTask = normalizeSubjectName(taskSubject).toLowerCase();
  const normFilter = normalizeSubjectName(filterSubject).toLowerCase();
  if (!normFilter) return true;
  if (normTask === normFilter) return true;
  if (normTask.length >= 4 && normFilter.length >= 4) {
    if (normTask.includes(normFilter) || normFilter.includes(normTask)) return true;
  }
  return false;
}

/**
 * Перевіряє, чи є рядок реальним ПІБ викладача, а не назвою теми/завдання (наприклад, "Ренесанс", "Вступ").
 * Справжній викладач повинен:
 * - містити ініціали (наприклад, "Домніна Г.С.", "Токарєва О. В."), АБО
 * - починатися з префікса викладача ("викл.", "доц."), АБО
 * - складатись щонайменше з 2 повноцінних слів (Прізвище Ім'я).
 */
export function isValidTeacherName(name?: string | null): boolean {
  if (!name) return false;
  const clean = name.trim();
  if (clean.length < 4) return false;

  // Виключаємо відомі не-викладацькі слова та навчальні теми
  if (
    /^(?:ренесанс|античність|модернізм|просвітництво|середньовіччя|вступ|практика|лекція|семінар|модуль|залік|екзамен|диплом|лабораторна|тест|завдання|тема|конспект)$/i.test(
      clean
    )
  ) {
    return false;
  }

  // 1. Наявність ініціалів: "Домніна Г.С.", "Токарєва О. В.", "І.І. Іванов"
  if (/[А-ЯІЇЄҐA-Z]\.\s*[А-ЯІЇЄҐA-Z]\.?|[А-ЯІЇЄҐA-Z]\.\s*[А-ЯІЇЄҐA-Z]/i.test(clean)) {
    return true;
  }

  // 2. Явний префікс посади: "викл. Домніна", "викладач Шевченко"
  if (
    /^(?:викл(?:адач|\.)?|доц(?:ент|\.)?|проф(?:есор|\.)?|кер(?:івник|\.)?)\s+[А-ЯІЇЄҐA-Z][а-яіїєґa-z]+/i.test(
      clean
    )
  ) {
    return true;
  }

  // 3. Щонайменше 2 слова (Прізвище + Ім'я/По батькові): "Домніна Галина", "Токарєва Тетяна Олександрівна"
  const words = clean.split(/\s+/).filter((w) => w.length >= 2);
  if (words.length >= 2 && words.every((w) => /^[А-ЯІЇЄҐA-Z][а-яіїєґa-z'-]+$/i.test(w))) {
    return true;
  }

  return false;
}

/**
 * Витягує прізвище та ініціали викладача з назви курсу (наприклад, "Математика (Токарєва О.В.)" -> "Токарєва О.В.").
 */
export function extractTeacherFromSubject(rawName?: string | null): string | null {
  if (!rawName) return null;
  // 1. Пошук у дужках: (Хочинська Н. О.), (викл. Токарєва О.В.), [Криволап В.В.]
  const match = rawName.match(
    /[\(\[]\s*(?:(?:викл(?:адач|\.)?|кер(?:івник|\.)?)\s*)?([А-ЯІЇЄҐA-Z][а-яіїєґa-z]+(?:\s+[А-ЯІЇЄҐA-Z]\.?\s*[А-ЯІЇЄҐA-Z]\.?)?)\s*[\)\]]/i
  );
  if (match && match[1]) {
    const val = match[1].trim();
    if (isValidTeacherName(val)) {
      return formatTeacherName(val);
    }
  }
  // 2. Пошук після дефіса або двокрапки у кінці: "Дискретна математика - Токарєва О.В."
  const dashMatch = rawName.match(
    /(?:[-–—:]\s*)(?:(?:викл(?:адач|\.)?|кер(?:івник|\.)?)\s*)?([А-ЯІЇЄҐA-Z][а-яіїєґa-z]+(?:\s+[А-ЯІЇЄҐA-Z]\.?\s*[А-ЯІЇЄҐA-Z]\.?)?)\s*$/i
  );
  if (dashMatch && dashMatch[1]) {
    const val = dashMatch[1].trim();
    if (isValidTeacherName(val)) {
      return formatTeacherName(val);
    }
  }
  return null;
}



