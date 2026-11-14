import type { Lesson, ScheduleResponse } from "./api";
import { KYIV_DATE_FMT, formatKyivDateIso, getMondayOf } from "./date";
import {
  addDaysToCalendarIso,
  calendarDateIsoToUtcDate,
  diffCalendarWeeks,
  getMondayCalendarIso,
  parseCalendarDateIso,
} from "./calendarDate";

export { getMondayOf };

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

export function getProgressPercentage(studiedHours: number, totalHours: number): number {
  if (totalHours <= 0) return 0;
  return Math.max(0, Math.floor((studiedHours / totalHours) * 100));
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

export function checkScheduleHasSubgroups(lessons: Array<{
  second_teacher_id?: number | null;
  teacher_name?: string | null;
  teacher_room?: string | null;
  second_teacher_room?: string | null;
  note?: string | null;
  is_cancelled?: boolean;
}>): boolean {
  if (!Array.isArray(lessons) || lessons.length === 0) return false;
  return lessons.some(
    (l) =>
      !l.is_cancelled &&
      (l.second_teacher_id != null ||
        (l.teacher_name && (l.teacher_name.includes(",") || l.teacher_name.includes("/"))) ||
        (Boolean(l.teacher_room) && Boolean(l.second_teacher_room)) ||
        (l.note && /(?:1|2)\s*підгр/i.test(l.note)))
  );
}

export interface SubgroupTeacherHint {
  subgroup: 1 | 2;
  teacher: string;
  subject: string;
}

export function extractSubgroupTeacherHints(lessons: Array<{
  teacher_id?: number | null;
  second_teacher_id?: number | null;
  teacher_name?: string | null;
  subject_name?: string | null;
  teacher_room?: string | null;
  second_teacher_room?: string | null;
  is_cancelled?: boolean;
}>): { sub1: SubgroupTeacherHint[]; sub2: SubgroupTeacherHint[] } {
  const sub1List: SubgroupTeacherHint[] = [];
  const sub2List: SubgroupTeacherHint[] = [];
  const seen1 = new Set<string>();
  const seen2 = new Set<string>();

  if (!Array.isArray(lessons)) return { sub1: [], sub2: [] };

  for (const l of lessons) {
    if (l.is_cancelled || !l.teacher_name) continue;
    const hasSplit =
      l.second_teacher_id != null ||
      /[,/]/.test(l.teacher_name) ||
      Boolean(l.teacher_room && l.second_teacher_room);
    if (!hasSplit) continue;

    const parts = l.teacher_name.split(/\s*[,/]\s*/).map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const subj = l.subject_name?.trim() || "";
      const t1 = formatTeacherName(parts[0]);
      const t2 = formatTeacherName(parts[1]);
      const key1 = `${t1}__${subj}`;
      const key2 = `${t2}__${subj}`;
      if (!seen1.has(key1)) {
        seen1.add(key1);
        sub1List.push({ subgroup: 1, teacher: t1, subject: subj });
      }
      if (!seen2.has(key2)) {
        seen2.add(key2);
        sub2List.push({ subgroup: 2, teacher: t2, subject: subj });
      }
    }
  }

  return { sub1: sub1List, sub2: sub2List };
}

export interface MeetingInfo {
  url: string;
  platform: "meet" | "zoom" | "teams" | "link";
  passcode: string | null;
  label?: string;
  isProtected?: boolean;
  subgroup?: 1 | 2;
}

const ZOOM_ID_RE = /(?:[ІИіи]дент[иі]ф[иі]катор(?:\s+\S+)?|Meeting\s*ID|\bID(?:\s+\S+)?)\s*[:\-]?\s*(\d[\d\s\-\u00a0]{8,15}\d)/i;
const ZOOM_PASS_RE = /(?:Код(?:\s+доступ[уае]|\s+конференці[їі])?|Passcode|Пароль(?:\s+конференці[їі])?)\s*[:\-]?\s*([A-Za-z0-9_.\-]+)/i;
const BARE_MEET_RE = /(?<![/\w.-])(?:meet\.google\.com\/)?([a-z]{3}-[a-z]{4}-[a-z]{3})\b/i;

/**
 * Надійне синхронне та асинхронне копіювання тексту в буфер обміну.
 * Працює надійно навіть при переході на сторонні сайти (Zoom, Meet) на iOS Safari та Android Chrome.
 */
export function copyTextToClipboard(text: string): boolean {
  if (!text || typeof window === "undefined") return false;
  let ok = false;
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "0";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    ok = document.execCommand("copy");
    document.body.removeChild(ta);
  } catch {
    ok = false;
  }
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => {});
  }
  return ok;
}

export function extractOnlineMeetings(
  note?: string | null,
  room?: string | null,
  teacherName?: string | null,
  subjectName?: string | null,
  teacherRoom?: string | null,
  secondTeacherRoom?: string | null
): MeetingInfo[] {
  const teacherTokens = (teacherName || "")
    .split(/[,/]/)
    .map((t) => t.trim())
    .filter(Boolean);

  const isLegacy85ForeignLang = Boolean(
    (subjectName && /іноземн|англ/i.test(subjectName)) &&
    (teacherName && /токарєв|хочинськ/i.test(teacherName))
  );

  const isElectronics = Boolean(
    (subjectName && /електронік/i.test(subjectName)) ||
    (teacherName && /філімончук/i.test(teacherName))
  );

  const sources: Array<{ text: string; defaultLabel?: string; subgroup?: 1 | 2 }> = [];
  if (teacherRoom) {
    sources.push({
      text: teacherRoom,
      defaultLabel: teacherTokens[0] || "1 підгр.",
      subgroup: 1,
    });
  }
  if (secondTeacherRoom) {
    sources.push({
      text: secondTeacherRoom,
      defaultLabel: teacherTokens[1] || "2 підгр.",
      subgroup: 2,
    });
  }
  if (room) {
    sources.push({ text: room });
  }
  if (note) {
    sources.push({ text: note });
  }

  const results: MeetingInfo[] = [];
  const seenUrls = new Set<string>();

  const allSourcesText = sources.map((s) => s.text).join("\n");
  const globalPassMatch = allSourcesText.match(ZOOM_PASS_RE);
  const globalRawPass = globalPassMatch ? globalPassMatch[1].trim() : null;

  for (const src of sources) {
    const srcPassMatch = src.text.match(ZOOM_PASS_RE);
    const srcRawPass = srcPassMatch ? srcPassMatch[1].trim() : null;
    const lines = src.text.split("\n");
    for (const line of lines) {
      if (line.trim().startsWith("[TASK]")) continue;

      const urlMatches = Array.from(
        line.matchAll(/https?:\/\/(?:meet\.google\.com|[a-z0-9.-]*zoom\.us|teams\.microsoft\.com|teams\.live\.com)\/[^\s<>"')|]+/gi)
      );

      // Якщо прямого URL немає, перевіряємо Zoom ID або чистий код Google Meet
      let manualMeeting: { url: string; isMeet: boolean; isZoom: boolean; isTeams: boolean; rawPass: string | null } | null = null;
      if (urlMatches.length === 0) {
        const idMatch = line.match(ZOOM_ID_RE);
        const meetMatch = line.match(BARE_MEET_RE);
        if (idMatch) {
          const cleanId = idMatch[1].replace(/[\s\-\u00a0]/g, "");
          const passMatch = line.match(ZOOM_PASS_RE) || srcPassMatch || globalPassMatch;
          const rawPass = passMatch ? passMatch[1].trim() : (isElectronics ? "dfkr" : null);
          const zoomUrl = `https://zoom.us/j/${cleanId}${rawPass ? `?pwd=${encodeURIComponent(rawPass)}` : ""}`;
          manualMeeting = { url: zoomUrl, isMeet: false, isZoom: true, isTeams: false, rawPass };
        } else if (meetMatch) {
          manualMeeting = { url: `https://meet.google.com/${meetMatch[1]}`, isMeet: true, isZoom: false, isTeams: false, rawPass: null };
        }
      }

      if (urlMatches.length > 0 || manualMeeting) {
        const candidateUrls = manualMeeting ? [manualMeeting.url] : urlMatches.map((m) => m[0]);
        for (const rawCandidateUrl of candidateUrls) {
          let url = rawCandidateUrl;
          if (seenUrls.has(url.toLowerCase())) continue;
          seenUrls.add(url.toLowerCase());

          const lowerUrl = url.toLowerCase();
          const isMeet = manualMeeting ? manualMeeting.isMeet : lowerUrl.includes("meet.google.com");
          const isZoom = manualMeeting ? manualMeeting.isZoom : lowerUrl.includes("zoom.us");
          const isTeams = manualMeeting ? manualMeeting.isTeams : (lowerUrl.includes("teams.microsoft.com") || lowerUrl.includes("teams.live.com"));

          const matchPwd = url.match(/[?&]pwd=([^&\s]+)/i);
          const hasPwdInUrl = Boolean(matchPwd);
          const existingPwd = matchPwd ? decodeURIComponent(matchPwd[1]) : null;

          const linePassMatch = line.match(ZOOM_PASS_RE);
          const lineRawPass = linePassMatch ? linePassMatch[1].trim() : null;
          const textPass = (manualMeeting?.rawPass || lineRawPass || srcRawPass || globalRawPass) ?? null;

          // Визначаємо зрозумілий людині passcode:
          // 1. Пріоритет: явний код доступу з тексту (<= 20 символів)
          // 2. Інакше якщо в URL параметр pwd короткий (<= 18 символів), а не довгий 32-значний хеш
          // 3. Інакше для «Електроніки» (Філімончук) дефолтний пароль 'dfkr'
          let humanPasscode: string | null = null;
          if (textPass && textPass.length <= 20) {
            humanPasscode = textPass;
          } else if (existingPwd && existingPwd.length <= 18) {
            humanPasscode = existingPwd;
          } else if (isElectronics && !isMeet) {
            humanPasscode = "dfkr";
          }

          if (isZoom && !hasPwdInUrl && (humanPasscode || textPass)) {
            const sep = url.includes("?") ? "&" : "?";
            url = `${url}${sep}pwd=${encodeURIComponent(humanPasscode || textPass!)}`;
          }

          let label: string | undefined = src.defaultLabel;
          let subgroup: 1 | 2 | undefined = src.subgroup;
          const lowerLine = line.toLowerCase();

          if (lowerLine.includes("токарєв") || lowerLine.includes("токарев")) {
            label = "Токарєва";
            subgroup = 1;
          } else if (lowerLine.includes("хочинськ") || lowerLine.includes("хочинск")) {
            label = "Хочинська";
            subgroup = 2;
          } else {
            // Перевіряємо вчителів зі списку викладачів пари
            if (teacherTokens.length >= 1) {
              const t0 = teacherTokens[0].split(/[\s.]+/)[0].toLowerCase();
              if (t0 && lowerLine.includes(t0)) {
                label = teacherTokens[0];
                subgroup = 1;
              }
            }
            if (!label && teacherTokens.length >= 2) {
              const t1 = teacherTokens[1].split(/[\s.]+/)[0].toLowerCase();
              if (t1 && lowerLine.includes(t1)) {
                label = teacherTokens[1];
                subgroup = 2;
              }
            }

            if (!label) {
              if (/(?:1\s*[-–]?\s*підгр|1-ша\s*підгр|1\s*підгрупа)/i.test(line)) {
                subgroup = 1;
                label = teacherTokens[0] || "1 підгр.";
              } else if (/(?:2\s*[-–]?\s*підгр|2-га\s*підгр|2\s*підгрупа)/i.test(line)) {
                subgroup = 2;
                label = teacherTokens[1] || "2 підгр.";
              }
            }

            if (!label) {
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
          }

          if (!label && isLegacy85ForeignLang) {
            label = isMeet ? "Токарєва" : "Хочинська";
            subgroup = isMeet ? 1 : 2;
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
            passcode: isZoom ? humanPasscode : null,
            label,
            subgroup,
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

          let label: string | undefined = src.defaultLabel;
          let subgroup: 1 | 2 | undefined = src.subgroup;
          const lowerLine = line.toLowerCase();
          if (lowerLine.includes("токарєв") || lowerLine.includes("токарев")) {
            label = "Токарєва";
            subgroup = 1;
          } else if (lowerLine.includes("хочинськ") || lowerLine.includes("хочинск")) {
            label = "Хочинська";
            subgroup = 2;
          } else {
            if (teacherTokens.length >= 1) {
              const t0 = teacherTokens[0].split(/[\s.]+/)[0].toLowerCase();
              if (t0 && lowerLine.includes(t0)) {
                label = teacherTokens[0];
                subgroup = 1;
              }
            }
            if (!label && teacherTokens.length >= 2) {
              const t1 = teacherTokens[1].split(/[\s.]+/)[0].toLowerCase();
              if (t1 && lowerLine.includes(t1)) {
                label = teacherTokens[1];
                subgroup = 2;
              }
            }
            if (!label) {
              if (/(?:1\s*[-–]?\s*підгр|1-ша\s*підгр|1\s*підгрупа)/i.test(line)) {
                subgroup = 1;
                label = teacherTokens[0] || "1 підгр.";
              } else if (/(?:2\s*[-–]?\s*підгр|2-га\s*підгр|2\s*підгрупа)/i.test(line)) {
                subgroup = 2;
                label = teacherTokens[1] || "2 підгр.";
              }
            }
            if (!label) {
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
          }

          if (!label && isLegacy85ForeignLang) {
            label = platform === "meet" ? "Токарєва" : "Хочинська";
            subgroup = platform === "meet" ? 1 : 2;
          }

          results.push({
            url: "",
            platform,
            passcode: null,
            label,
            isProtected: true,
            subgroup,
          });
        }
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

  if (isLegacy85ForeignLang && results.length > 0) {
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

export function calculateWeekNumber(anchorDate: Date, semesterStart?: string | null): number | null {
  if (!semesterStart) return null;
  const anchorIso = formatKyivDateIso(anchorDate);
  const startIso = parseCalendarDateIso(semesterStart)
    ? semesterStart.trim()
    : formatKyivDateIso(new Date(semesterStart));
  const diffWeeks = diffCalendarWeeks(anchorIso, startIso) + 1;
  return diffWeeks > 0 ? diffWeeks : null;
}

export function buildTelegramShareText(
  schedule: ScheduleResponse,
  scheduleMode: "student" | "teacher" | "admin" = "student",
  weekNumber?: number | null
): string {
  const dateObj = calendarDateIsoToUtcDate(schedule.date);
  const dateFormatted = new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
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
  const monIso = getMondayCalendarIso(formatKyivDateIso(monday));
  const sunIso = addDaysToCalendarIso(monIso, 6);
  const monParts = parseCalendarDateIso(monIso)!;
  const sunParts = parseCalendarDateIso(sunIso)!;

  const monDay = monParts.day;
  const sunDay = sunParts.day;
  const monMonth = monParts.month - 1;
  const sunMonth = sunParts.month - 1;
  const monYear = monParts.year;
  const sunYear = sunParts.year;

  if (monYear !== sunYear) {
    return `${monDay} ${UKR_MONTHS_LONG_DECL[monMonth]} ${monYear} року – ${sunDay} ${UKR_MONTHS_LONG_DECL[sunMonth]} ${sunYear} року`;
  }

  if (monMonth === sunMonth) {
    return `${monDay}–${sunDay} ${UKR_MONTHS_LONG_DECL[monMonth]} ${sunYear} року`;
  }

  return `${monDay} ${UKR_MONTHS_LONG_DECL[monMonth]} – ${sunDay} ${UKR_MONTHS_LONG_DECL[sunMonth]} ${sunYear} року`;
}

export function formatShortWeekRange(monday: Date, weekNumber?: number | null): string {
  const monIso = getMondayCalendarIso(formatKyivDateIso(monday));
  const sunIso = addDaysToCalendarIso(monIso, 6);
  const monParts = parseCalendarDateIso(monIso)!;
  const sunParts = parseCalendarDateIso(sunIso)!;

  const monDay = monParts.day;
  const sunDay = sunParts.day;
  const monMonth = monParts.month - 1;
  const sunMonth = sunParts.month - 1;

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
  name = name.replace(
    /\s*[\(\[]\s*(?:гр(?:упа|\.)?\s*)?\d{1,3}(?:[\s\-_–—]?(?:ДФКР|КРЕ|ДКРЕ|[А-ЯІЇЄҐA-Z]{1,4}(?:[\s\-_–—]?\d{1,2})?))?\s*[\)\]]/gi,
    ""
  );
  // Видаляємо окремі назви груп із відомими абревіатурами коледжу: 85 ДФКР, 85-ДФКР, 85ДФКР
  name = name.replace(/\s*\b\d{1,3}[\s\-_–—]?(?:ДФКР|КРЕ|ДКРЕ)\b/gi, "");
  // Видаляємо згадки групи у хвості: гр. 85, група 85, - 85 курс
  name = name.replace(/\s*(?:[-–—:]\s*)?\b(?:гр(?:упа|\.)?\s*\d+.*|\d{2,3}\s*(?:гр(?:упа|\.)?|курс))$/gi, "");
  // Видаляємо прізвища викладачів або підгрупи у дужках: (Хочинська Н. О.), (Токарь), (підгрупа 1)
  name = name.replace(
    /\s*[\(\[]\s*(?:(?:1|2)[\s\-_–—]?(?:ша|га|а)?\s*(?:підгр(?:упа|\.)?)|(?:викл(?:адач|\.)?\s*)?[А-ЯІЇЄҐA-Z][а-яіїєґa-z]+(?:\s+[А-ЯІЇЄҐA-Z]\.?\s*[А-ЯІЇЄҐA-Z]\.?)?)\s*[\)\]]/gi,
    ""
  );
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
  if (clean.length < 4 || clean.includes("!")) return false;

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



