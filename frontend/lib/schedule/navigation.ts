import type {
  LearningMode,
  LearningModeOverride,
  ReferenceRecord,
  ScheduleResponse,
  WeekType,
} from "../api";
import {
  KYIV_DATE_FMT,
  KYIV_TIME_FMT,
  UKR_DAY_MONTH_SHORT_FMT,
  UKR_MONTH_SHORT_FMT,
  UKR_WEEKDAY_LONG_FMT,
  getMondayOf,
  getSyncedNow,
} from "../date";

const EN_KYIV_DOW_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Kyiv",
  weekday: "short",
});

const KYIV_DOW_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const SHORT_DAY_NAMES = ["Пн", "Вт", "Ср", "Чт", "Пт"] as const;

export interface WeekDayMini {
  index: number;
  name: string;
  dateStr: string;
  iso: string;
}

export interface HeaderLearningModeData {
  mode: LearningMode;
  override: LearningModeOverride | null;
  baseLabel: string;
  fullLabel: string;
  title: string;
}

/**
 * Returns the day of week (0 = Sun .. 6 = Sat) in the Europe/Kyiv timezone.
 */
export function getKyivWeekday(d: Date): number {
  const short = EN_KYIV_DOW_FMT.format(d);
  return KYIV_DOW_MAP[short] ?? d.getDay();
}

/**
 * Returns the active weekday tab index (0..4 for Mon..Fri, falling back to 0 on weekends).
 */
export function getActualTodayIndex(now: Date = getSyncedNow()): number {
  const dow = getKyivWeekday(now);
  if (dow >= 1 && dow <= 5) return dow - 1;
  return 0;
}

/**
 * Returns tomorrow's weekday index after 15:20 on Mon-Thu so evening views look ahead cleanly.
 */
export function getEveningSelectedDayIndex(now: Date = new Date()): number | null {
  const dow = getKyivWeekday(now);
  if (dow >= 1 && dow <= 4) {
    const [kyivHour, kyivMin] = KYIV_TIME_FMT.format(now).split(":").map(Number);
    const totalMins = (kyivHour || 0) * 60 + (kyivMin || 0);
    if (totalMins >= 15 * 60 + 20) {
      return dow;
    }
  }
  return null;
}

/**
 * Checks whether Kyiv local time is on Mon-Thu at or past 15:20.
 */
export function isEveningAfterLessonsTime(now: Date = getSyncedNow()): boolean {
  const dow = getKyivWeekday(now);
  if (dow < 1 || dow > 4) return false;
  const [kyivHour, kyivMin] = KYIV_TIME_FMT.format(now).split(":").map(Number);
  const totalMins = (kyivHour || 0) * 60 + (kyivMin || 0);
  return totalMins >= 15 * 60 + 20;
}

/**
 * Calculates the 1-based academic week index from semester start to the selected week anchor.
 */
export function computeCurrentWeekNumber(
  semesterStart: string | null | undefined,
  weekAnchorDate: Date
): number | null {
  if (!semesterStart) return null;
  const [sy, sm, sd] = semesterStart.split("-").map(Number);
  const start = sy && sm && sd ? new Date(sy, sm - 1, sd, 12, 0, 0) : new Date(semesterStart);
  const diffTime = getMondayOf(weekAnchorDate).getTime() - getMondayOf(start).getTime();
  const diffWeeks = Math.round(diffTime / (7 * 24 * 60 * 60 * 1000)) + 1;
  return diffWeeks > 0 ? diffWeeks : null;
}

/**
 * Resolves whether the viewed week is numerator, denominator, or both.
 */
export function resolveWeekType(
  week: ScheduleResponse[] | null | undefined,
  currentWeekNumber: number | null,
  isCurrentWeek: boolean,
  todayWeekType?: WeekType | null
): WeekType {
  if (week && week.length > 0 && week[0]?.week_type && week[0].week_type !== "both") {
    return week[0].week_type;
  }
  if (currentWeekNumber) {
    return currentWeekNumber % 2 === 1 ? "numerator" : "denominator";
  }
  if (isCurrentWeek && todayWeekType && todayWeekType !== "both") {
    return todayWeekType;
  }
  return todayWeekType ?? "both";
}

/**
 * Formats the Mon-Sun week range into a compact Ukrainian label such as "19–25 жовт.".
 */
export function formatCompactWeekRange(weekAnchorDate: Date): string {
  const end = new Date(weekAnchorDate);
  end.setDate(end.getDate() + 6);
  const startDay = weekAnchorDate.getDate();
  const endDay = end.getDate();
  const startMonth = UKR_MONTH_SHORT_FMT.format(weekAnchorDate).replace(".", "");
  const endMonth = UKR_MONTH_SHORT_FMT.format(end).replace(".", "");

  if (startMonth === endMonth) {
    return `${startDay}–${endDay} ${startMonth}.`;
  }
  return `${startDay} ${startMonth}. – ${endDay} ${endMonth}.`;
}

/**
 * Builds the 5 Mon-Fri quick-switch buttons for the current week anchor.
 */
export function buildWeekDaysMini(weekAnchorDate: Date): WeekDayMini[] {
  const days: WeekDayMini[] = [];
  for (let i = 0; i < 5; i++) {
    const d = new Date(weekAnchorDate);
    d.setDate(weekAnchorDate.getDate() + i);
    days.push({
      index: i,
      name: SHORT_DAY_NAMES[i],
      dateStr: `${d.getDate()}`,
      iso: KYIV_DATE_FMT.format(d),
    });
  }
  return days;
}

/**
 * Checks whether week navigation backward stays within minDateIso.
 */
export function canNavigatePrevWeekDate(weekAnchorDate: Date, minDateIso: string | null): boolean {
  if (!minDateIso) return true;
  const prevWeekEnd = new Date(weekAnchorDate);
  prevWeekEnd.setDate(prevWeekEnd.getDate() - 3);
  return KYIV_DATE_FMT.format(prevWeekEnd) >= minDateIso;
}

/**
 * Checks whether week navigation forward stays within maxDateIso.
 */
export function canNavigateNextWeekDate(weekAnchorDate: Date, maxDateIso: string | null): boolean {
  if (!maxDateIso) return true;
  const nextWeekStart = new Date(weekAnchorDate);
  nextWeekStart.setDate(nextWeekStart.getDate() + 7);
  return KYIV_DATE_FMT.format(nextWeekStart) <= maxDateIso;
}

/**
 * Checks whether stepping one school day backward stays within minDateIso.
 */
export function canNavigatePrevDayDate(
  weekAnchorDate: Date,
  selectedDayIndex: number,
  minDateIso: string | null
): boolean {
  if (!minDateIso) return true;
  const prevD = new Date(weekAnchorDate);
  prevD.setDate(weekAnchorDate.getDate() + (selectedDayIndex > 0 ? selectedDayIndex - 1 : -3));
  return KYIV_DATE_FMT.format(prevD) >= minDateIso;
}

/**
 * Checks whether stepping one school day forward stays within maxDateIso.
 */
export function canNavigateNextDayDate(
  weekAnchorDate: Date,
  selectedDayIndex: number,
  maxDateIso: string | null
): boolean {
  if (!maxDateIso) return true;
  const nextD = new Date(weekAnchorDate);
  nextD.setDate(weekAnchorDate.getDate() + (selectedDayIndex < 4 ? selectedDayIndex + 1 : 7));
  return KYIV_DATE_FMT.format(nextD) <= maxDateIso;
}

/**
 * Picks today's schedule or tomorrow's schedule after 15:25 on Mon-Thu when week data contains tomorrow.
 */
export function resolveDisplayDaySchedule(
  today: ScheduleResponse | null,
  week: ScheduleResponse[],
  now: Date = getSyncedNow()
): { displayDaySchedule: ScheduleResponse | null; isShowingTomorrow: boolean } {
  if (!today) return { displayDaySchedule: null, isShowingTomorrow: false };
  const kyivHour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Kyiv", hour: "2-digit", hour12: false }).format(now)
  );
  const kyivMin = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Kyiv", minute: "2-digit" }).format(now)
  );
  const totalMins = kyivHour * 60 + kyivMin;
  const dow = now.getDay();

  if (dow >= 1 && dow <= 4 && totalMins >= 15 * 60 + 25 && week.length > 0) {
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    const tomorrowIso = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(tomorrow);
    const foundTomorrow = week.find((d) => d.date === tomorrowIso);
    if (foundTomorrow) {
      return { displayDaySchedule: foundTomorrow, isShowingTomorrow: true };
    }
  }
  return { displayDaySchedule: today, isShowingTomorrow: false };
}

/**
 * Computes the adaptive header badge summarizing offline vs online learning mode and any active override.
 */
export function computeHeaderLearningMode(params: {
  view: "today" | "week";
  week: ScheduleResponse[];
  selectedDaySchedule: ScheduleResponse | null;
  todayActualIso: string;
}): HeaderLearningModeData | null {
  const { view, week, selectedDaySchedule, todayActualIso } = params;
  let learningMode: LearningMode | null = null;
  let override: LearningModeOverride | null = null;

  if (view !== "week") {
    learningMode = selectedDaySchedule?.learning_mode ?? null;
    override = selectedDaySchedule?.learning_mode_override ?? null;
    if (override?.mode) {
      learningMode = override.mode;
    }
  } else if (week && week.length > 0) {
    const todayInWeek = week.find((d) => d.date === todayActualIso);
    override =
      todayInWeek?.learning_mode_override ??
      selectedDaySchedule?.learning_mode_override ??
      week.find((d) => Boolean(d.learning_mode_override))?.learning_mode_override ??
      null;

    if (override?.mode) {
      learningMode = override.mode;
    } else {
      learningMode =
        todayInWeek?.learning_mode ??
        selectedDaySchedule?.learning_mode ??
        week.find((d) => Boolean(d.learning_mode))?.learning_mode ??
        null;
    }
  }

  if (!learningMode) return null;

  const baseLabel = learningMode === "offline" ? "Очно" : "Дистанційно";

  let dateRangeStr: string | null = null;
  if (override?.start && override?.end) {
    const fmtShort = (iso: string) => {
      const [y, m, d] = iso.split("-").map(Number);
      return new Date(y, m - 1, d).toLocaleDateString("uk-UA", { day: "numeric", month: "short" });
    };
    dateRangeStr =
      override.start === override.end
        ? fmtShort(override.start)
        : `${fmtShort(override.start)} – ${fmtShort(override.end)}`;
  }

  const fullLabel = dateRangeStr ? `${baseLabel} · ${dateRangeStr}` : baseLabel;
  const title = override
    ? `${learningMode === "offline" ? "Очне" : "Дистанційне"} навчання${dateRangeStr ? ` (${dateRangeStr})` : ""}${
        override.reason ? `: ${override.reason}` : ""
      }`
    : `${learningMode === "offline" ? "Очне" : "Дистанційне"} навчання`;

  return {
    mode: learningMode,
    override,
    baseLabel,
    fullLabel,
    title,
  };
}

/**
 * Formats the whole week schedule into a shareable plain-text summary for clipboard sharing.
 */
export function formatWeekShareText(params: {
  week: ScheduleResponse[];
  mode: "student" | "teacher";
  groupId: number | null;
  teacherId: number | null;
  groups: ReferenceRecord[];
  teachers: ReferenceRecord[];
  weekRange: string;
  currentWeekNumber: number | null;
  weekType: string;
}): string {
  const { week, mode, groupId, teacherId, groups, teachers, weekRange, currentWeekNumber, weekType } = params;
  const groupOrTeacher =
    mode === "student"
      ? groups.find((g) => g.id === groupId)?.name
        ? `Група ${groups.find((g) => g.id === groupId)?.name}`
        : "Розклад"
      : teachers.find((t) => t.id === teacherId)?.name
        ? `Викладач ${teachers.find((t) => t.id === teacherId)?.name}`
        : "Розклад";

  const weekTypeSuffix =
    weekType === "numerator"
      ? ", чисельник"
      : weekType === "denominator"
        ? ", знаменник"
        : "";
  const header = `📅 ${groupOrTeacher}\n🗓 ${weekRange}${currentWeekNumber ? ` (${currentWeekNumber} тиждень` : ""}${weekTypeSuffix}${currentWeekNumber ? ")" : ""}\n`;

  const dayBlocks = week
    .map((d) => {
      const dObj = new Date(`${d.date}T12:00:00`);
      const dayName = UKR_WEEKDAY_LONG_FMT.format(dObj);
      const dayDate = UKR_DAY_MONTH_SHORT_FMT.format(dObj);
      const activeLessons = (d.lessons || []).filter((l) => !l.is_cancelled);
      if (activeLessons.length === 0) {
        return `▫️ ${dayName.toUpperCase()} (${dayDate}): пар немає`;
      }
      const lessons = [...activeLessons]
        .sort((a, b) => a.lesson_number - b.lesson_number)
        .map((l) => {
          const room = l.room ? ` [${l.room}]` : "";
          const secondary =
            mode === "teacher" && l.group_name
              ? ` (гр. ${l.group_name})`
              : mode === "student" && l.teacher_name
                ? ` (${l.teacher_name})`
                : "";
          return `  ${l.lesson_number}. ${l.time} ${l.subject_name}${room}${secondary}`;
        })
        .join("\n");
      return `▫️ ${dayName.toUpperCase()} (${dayDate}):\n${lessons}`;
    })
    .join("\n\n");

  return `${header}\n${dayBlocks}`;
}
