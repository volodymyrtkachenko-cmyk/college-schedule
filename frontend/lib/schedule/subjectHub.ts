import type {
  AcademicEvent,
  LearningMode,
  Lesson,
  ScheduleResponse,
  StatisticsEntry,
  StatisticsResponse,
  WeekType,
} from "../api";
import type { FullTaskItem } from "../../components/TaskCardItem";
import type { MeetingInfo } from "../format";
import {
  extractOnlineMeetings,
  formatRoomsList,
  isSubjectMatch,
  normalizeSubjectName,
} from "../format";
import {
  getTaskPublishedTimestamp,
  parseMinutes,
  resolveTeacherMeetings,
  sortTasksByDeadline,
  type KyivNowSnapshot,
} from "../lesson-card";
import { parseLessonTeachers, type SecondaryEntityItem } from "../quickJump";

export interface SubjectHubTarget {
  subjectId: number | null;
  subjectName: string;
  groupId: number | null;
  groupName?: string | null;
  teacherId?: number | null;
  teacherName?: string | null;
  sourceLesson?: Lesson | null;
}

export interface NextSubjectOccurrence {
  date: string;
  dayOfWeek: number;
  weekType: WeekType;
  lesson: Lesson;
  isShortenedDay: boolean;
  learningMode: LearningMode | null;
  isToday: boolean;
  isLive: boolean;
  remainingMinutes: number | null;
  minutesUntilStart: number | null;
}

export interface RecurringSubjectSlot {
  dayOfWeek: number;
  dayName: string;
  lessonNumber: number;
  time: string;
  frequency: WeekType;
  sampleLesson: Lesson;
  hasReplacement: boolean;
}

export interface SubjectTasksPartition {
  all: FullTaskItem[];
  overdue: FullTaskItem[];
  activeDated: FullTaskItem[];
  activeNoDate: FullTaskItem[];
  active: FullTaskItem[];
  completed: FullTaskItem[];
}

export interface ResolvedSubjectLessonDetails {
  teachers: SecondaryEntityItem[];
  isDualTeachers: boolean;
  effectiveSubgroup: 1 | 2 | null;
  meetings: MeetingInfo[];
  primaryMeeting: MeetingInfo | null;
  subgroupMeetings: [MeetingInfo | null, MeetingInfo | null];
  subgroupRooms: [string | null, string | null];
  displayRooms: string[];
  roomsLabel: string;
  hasProtectedOnline: boolean;
}

export interface ResolveSubjectLessonOptions {
  defaultSubgroup?: 1 | 2 | "all" | null;
  isLinked?: boolean;
  personalSubgroup?: 1 | 2 | null;
  personalTeachers?: string[];
  hasGroupAccess?: boolean;
}

const UKR_WEEKDAY_NAMES: Record<number, string> = {
  1: "Понеділок",
  2: "Вівторок",
  3: "Середа",
  4: "Четвер",
  5: "П'ятниця",
  6: "Субота",
  7: "Неділя",
};

function getDayOfWeekFromIso(dateIso: string): number {
  const parts = dateIso.split("-").map(Number);
  if (parts.length !== 3) return 1;
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12, 0, 0));
  const day = d.getUTCDay();
  return day === 0 ? 7 : day;
}

/**
 * Checks whether a lesson belongs to the inspected subject, preferring exact subject IDs when known.
 */
export function lessonMatchesSubject(
  lesson: Lesson,
  subjectId: number | null | undefined,
  subjectName: string
): boolean {
  if (subjectId != null && subjectId > 0 && lesson.subject_id > 0) {
    return lesson.subject_id === subjectId;
  }
  const cleanTarget = normalizeSubjectName(subjectName).trim();
  if (!cleanTarget) return false;
  const candidate = lesson.subject_name || lesson.custom_subject || lesson.subject || "";
  if (!normalizeSubjectName(candidate).trim()) return false;
  return isSubjectMatch(candidate, cleanTarget);
}

/**
 * Flattens multiple week responses into deduplicated days sorted ascending by ISO date.
 */
export function filterAndMergeWeekDays(weekGroups: ScheduleResponse[][]): ScheduleResponse[] {
  const byDate = new Map<string, ScheduleResponse>();
  for (const group of weekGroups) {
    if (!Array.isArray(group)) continue;
    for (const day of group) {
      if (!day || !day.date) continue;
      const prev = byDate.get(day.date);
      if (!prev || (prev.lessons.length === 0 && day.lessons.length > 0)) {
        byDate.set(day.date, day);
      }
    }
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Finds the next active or currently live occurrence of the target subject on or after Kyiv now.
 */
export function findNextSubjectOccurrence(
  days: ScheduleResponse[],
  subjectId: number | null | undefined,
  subjectName: string,
  kyivNow: KyivNowSnapshot
): NextSubjectOccurrence | null {
  for (const day of days) {
    if (!day?.date || day.date < kyivNow.dateIso) continue;
    if (!Array.isArray(day.lessons) || day.lessons.length === 0) continue;

    const matching = [...day.lessons]
      .filter(
        (lesson) =>
          !lesson.is_cancelled &&
          lesson.is_relevant_this_week !== false &&
          lessonMatchesSubject(lesson, subjectId, subjectName)
      )
      .sort((a, b) => a.lesson_number - b.lesson_number || a.id - b.id);

    for (const lesson of matching) {
      const [startT = "", endT = ""] = (lesson.time || "").split(/[-–—]/);
      const startMin = parseMinutes(startT);
      const endMin = parseMinutes(endT);
      const isToday = day.date === kyivNow.dateIso;

      if (isToday && endMin !== null && kyivNow.minutes >= endMin) {
        continue;
      }

      const isLive = Boolean(
        isToday &&
          startMin !== null &&
          endMin !== null &&
          kyivNow.minutes >= startMin &&
          kyivNow.minutes < endMin
      );
      const remainingMinutes =
        isLive && endMin !== null ? Math.max(1, endMin - kyivNow.minutes) : null;
      const minutesUntilStart =
        isToday && !isLive && startMin !== null && kyivNow.minutes < startMin
          ? Math.max(1, startMin - kyivNow.minutes)
          : null;

      return {
        date: day.date,
        dayOfWeek: lesson.day_of_week || getDayOfWeekFromIso(day.date),
        weekType: day.week_type || lesson.week_type || "both",
        lesson,
        isShortenedDay: Boolean(day.is_shortened_day),
        learningMode: day.learning_mode ?? null,
        isToday,
        isLive,
        remainingMinutes,
        minutesUntilStart,
      };
    }
  }
  return null;
}

/**
 * Collects unique recurring slots for the subject across available numerator/denominator cycle days.
 */
export function collectRecurringSubjectSlots(
  days: ScheduleResponse[],
  subjectId: number | null | undefined,
  subjectName: string,
  cycleStartIso?: string
): RecurringSubjectSlot[] {
  const scopedDays = cycleStartIso
    ? days.filter((d) => d.date >= cycleStartIso)
    : days;
  const effectiveDays = scopedDays.length > 0 ? scopedDays : days;

  const hasNumeratorDay = effectiveDays.some((d) => d.week_type === "numerator");
  const hasDenominatorDay = effectiveDays.some((d) => d.week_type === "denominator");
  const coversFullCycle = hasNumeratorDay && hasDenominatorDay;

  interface SlotAccumulator {
    dayOfWeek: number;
    lessonNumber: number;
    inNumerator: boolean;
    inDenominator: boolean;
    sampleLesson: Lesson;
    hasReplacement: boolean;
  }

  const slotMap = new Map<string, SlotAccumulator>();

  for (const day of effectiveDays) {
    if (!Array.isArray(day.lessons)) continue;
    for (const lesson of day.lessons) {
      if (lesson.is_cancelled || lesson.is_relevant_this_week === false) continue;
      if (!lessonMatchesSubject(lesson, subjectId, subjectName)) continue;

      const dayOfWeek = lesson.day_of_week || getDayOfWeekFromIso(day.date);
      const key = `${dayOfWeek}-${lesson.lesson_number}`;
      const effectiveWeekType = day.week_type === "numerator" || day.week_type === "denominator"
        ? day.week_type
        : lesson.week_type;

      const existing = slotMap.get(key);
      if (!existing) {
        slotMap.set(key, {
          dayOfWeek,
          lessonNumber: lesson.lesson_number,
          inNumerator: effectiveWeekType === "numerator" || effectiveWeekType === "both",
          inDenominator: effectiveWeekType === "denominator" || effectiveWeekType === "both",
          sampleLesson: lesson,
          hasReplacement: Boolean(lesson.is_replacement),
        });
      } else {
        if (effectiveWeekType === "numerator" || effectiveWeekType === "both") {
          existing.inNumerator = true;
        }
        if (effectiveWeekType === "denominator" || effectiveWeekType === "both") {
          existing.inDenominator = true;
        }
        if (existing.sampleLesson.is_replacement && !lesson.is_replacement) {
          existing.sampleLesson = lesson;
        }
        if (lesson.is_replacement) {
          existing.hasReplacement = true;
        }
      }
    }
  }

  return Array.from(slotMap.values())
    .map((entry) => {
      let frequency: WeekType;
      if (coversFullCycle) {
        if (entry.inNumerator && entry.inDenominator) frequency = "both";
        else if (entry.inNumerator) frequency = "numerator";
        else if (entry.inDenominator) frequency = "denominator";
        else frequency = entry.sampleLesson.week_type || "both";
      } else if (entry.sampleLesson.week_type === "numerator" || entry.sampleLesson.week_type === "denominator") {
        frequency = entry.sampleLesson.week_type;
      } else {
        frequency = "both";
      }

      return {
        dayOfWeek: entry.dayOfWeek,
        dayName: UKR_WEEKDAY_NAMES[entry.dayOfWeek] || "",
        lessonNumber: entry.lessonNumber,
        time: entry.sampleLesson.time,
        frequency,
        sampleLesson: entry.sampleLesson,
        hasReplacement: entry.hasReplacement,
      };
    })
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.lessonNumber - b.lessonNumber);
}

/**
 * Filters upcoming academic events belonging to the inspected subject and sorts chronologically.
 */
export function filterEventsForSubject(
  events: AcademicEvent[],
  subjectId: number | null | undefined,
  subjectName: string,
  todayIso: string
): AcademicEvent[] {
  if (!Array.isArray(events) || events.length === 0) return [];
  const cleanTarget = normalizeSubjectName(subjectName).trim();

  return events
    .filter((ev) => {
      if (!ev || !ev.event_date || ev.event_date < todayIso) return false;
      if (subjectId != null && subjectId > 0 && ev.subject_id != null && ev.subject_id > 0) {
        return ev.subject_id === subjectId;
      }
      if (!cleanTarget) return false;
      const candidate = ev.subject_name || ev.custom_subject || ev.title || "";
      if (!normalizeSubjectName(candidate).trim()) return false;
      return isSubjectMatch(candidate, cleanTarget);
    })
    .sort((a, b) => a.event_date.localeCompare(b.event_date) || (a.start_time || "").localeCompare(b.start_time || ""));
}

export interface SubjectStatisticsSummary {
  id: number;
  name: string;
  completed_hours: number;
  planned_hours: number | null;
  progress_percent: number | null;
  cancelled_count?: number;
  replaced_count?: number;
  lessons_count?: number;
}

/**
 * Looks up the subject entry in a public StatisticsResponse snapshot (supports both student and teacher modes).
 */
export function findSubjectStatistics(
  stats: StatisticsResponse | null | undefined,
  subjectId: number | null | undefined,
  subjectName: string
): SubjectStatisticsSummary | null {
  if (!stats) return null;

  const candidates: SubjectStatisticsSummary[] =
    stats.mode === "teacher"
      ? (stats.subjects ?? []).map((s) => ({
          id: s.id,
          name: s.name,
          completed_hours: s.completed_hours,
          planned_hours: null,
          progress_percent: null,
          lessons_count: s.lessons_count,
        }))
      : (stats.entries ?? []).map((e: StatisticsEntry) => ({
          id: e.id,
          name: e.name,
          completed_hours: e.completed_hours,
          planned_hours: e.planned_hours,
          progress_percent: e.progress_percent,
          cancelled_count: e.cancelled_count,
          replaced_count: e.replaced_count,
        }));

  if (candidates.length === 0) return null;

  if (subjectId != null && subjectId > 0) {
    const byId = candidates.find((e) => e.id === subjectId);
    if (byId) return byId;
  }

  const cleanTarget = normalizeSubjectName(subjectName).trim().toLowerCase();
  if (!cleanTarget) return null;

  const exact = candidates.find(
    (e) => normalizeSubjectName(e.name).trim().toLowerCase() === cleanTarget
  );
  if (exact) return exact;

  return (
    candidates.find((e) => {
      const candidate = normalizeSubjectName(e.name).trim();
      return Boolean(candidate) && isSubjectMatch(candidate, cleanTarget);
    }) ?? null
  );
}

/**
 * Partitions Classroom tasks matching the inspected subject and sorts buckets consistently with the main Tasks tab:
 * overdue/dated items by deadline, and undated/completed items newest-first by Classroom publication timestamp.
 */
export function partitionSubjectTasks(
  tasks: FullTaskItem[],
  subjectName: string,
  isLinked: boolean
): SubjectTasksPartition {
  const cleanTarget = normalizeSubjectName(subjectName).trim();
  if (!cleanTarget || !Array.isArray(tasks) || tasks.length === 0) {
    return { all: [], overdue: [], activeDated: [], activeNoDate: [], active: [], completed: [] };
  }

  const matched = tasks.filter((t) => {
    const subj = normalizeSubjectName(t.subject).trim();
    return Boolean(subj) && isSubjectMatch(subj, cleanTarget);
  });

  const overdue: FullTaskItem[] = [];
  const activeDatedRaw: FullTaskItem[] = [];
  const activeNoDateRaw: FullTaskItem[] = [];
  const completedRaw: FullTaskItem[] = [];

  for (const t of matched) {
    const isDone = isLinked && (t.state === "TURNED_IN" || t.state === "RETURNED");
    if (isDone) {
      completedRaw.push(t);
    } else if (t.deadline?.isOverdue || t.deadline?.badgeTone === "overdue") {
      overdue.push(t);
    } else if (t.dueDateIso || t.deadline?.date) {
      activeDatedRaw.push(t);
    } else {
      activeNoDateRaw.push(t);
    }
  }

  const byPublishedDesc = (a: FullTaskItem, b: FullTaskItem) =>
    getTaskPublishedTimestamp(b) - getTaskPublishedTimestamp(a);

  const activeDated = sortTasksByDeadline(activeDatedRaw);
  const activeNoDate = [...activeNoDateRaw].sort(byPublishedDesc);
  const completed = [...completedRaw].sort(byPublishedDesc);

  return {
    all: matched,
    overdue: sortTasksByDeadline(overdue),
    activeDated,
    activeNoDate,
    active: [...activeDated, ...activeNoDate],
    completed,
  };
}

/**
 * Resolves subgroup-aware teachers, rooms, and online meetings for a lesson in Subject Hub.
 */
export function resolveSubjectLessonDetails(
  lesson: Lesson,
  options: ResolveSubjectLessonOptions = {}
): ResolvedSubjectLessonDetails {
  const {
    defaultSubgroup = null,
    isLinked = false,
    personalSubgroup = null,
    personalTeachers = [],
    hasGroupAccess = true,
  } = options;

  const teachers = parseLessonTeachers(lesson);
  const isDualTeachers = teachers.length === 2;

  let effectiveSubgroup: 1 | 2 | null = null;
  if (defaultSubgroup === 1 || defaultSubgroup === 2) {
    effectiveSubgroup = defaultSubgroup;
  } else if (defaultSubgroup !== "all" && isDualTeachers && isLinked) {
    if (personalSubgroup === 1 || personalSubgroup === 2) {
      effectiveSubgroup = personalSubgroup;
    } else {
      const s0 = teachers[0]?.name ? teachers[0].name.split(/[\s.]+/)[0].toLowerCase() : "";
      const s1 = teachers[1]?.name ? teachers[1].name.split(/[\s.]+/)[0].toLowerCase() : "";
      const matches0 = s0 ? personalTeachers.some((pt) => pt.toLowerCase().includes(s0) || s0.includes(pt.toLowerCase())) : false;
      const matches1 = s1 ? personalTeachers.some((pt) => pt.toLowerCase().includes(s1) || s1.includes(pt.toLowerCase())) : false;
      if (matches0 && !matches1) effectiveSubgroup = 1;
      else if (matches1 && !matches0) effectiveSubgroup = 2;
    }
  }

  const meetings = extractOnlineMeetings(
    lesson.note,
    lesson.room,
    lesson.teacher_name,
    lesson.subject_name,
    lesson.teacher_room,
    lesson.second_teacher_room
  );

  const teacherMeetings = isDualTeachers
    ? resolveTeacherMeetings(meetings, [teachers[0]?.name || "", teachers[1]?.name || ""])
    : ([null, null] as [MeetingInfo | null, MeetingInfo | null]);

  const rawRooms = lesson.room
    ? lesson.room.split(/\s*[,/;]\s*/).map((r) => r.trim()).filter(Boolean)
    : [];

  const cleanRoom = (value?: string | null) =>
    value ? value.replace(/^ауд\.?\s*/i, "").trim() || null : null;

  const subgroupRooms: [string | null, string | null] = isDualTeachers
    ? [
        cleanRoom(lesson.teacher_room || rawRooms[0]),
        cleanRoom(lesson.second_teacher_room || rawRooms[1]),
      ]
    : [null, null];

  let primaryMeeting: MeetingInfo | null = null;
  let displayRooms: string[] = [];

  const subgroupIdx = isDualTeachers && effectiveSubgroup !== null ? effectiveSubgroup - 1 : null;
  if (subgroupIdx !== null && subgroupIdx >= 0 && subgroupIdx <= 1) {
    const own = teacherMeetings[subgroupIdx];
    const otherIdx = subgroupIdx === 0 ? 1 : 0;
    if (own) {
      primaryMeeting = own;
    } else if (meetings.length === 1 && !teacherMeetings[otherIdx]) {
      const otherSurname = (teachers[otherIdx]?.name || "").split(/[\s.]+/)[0].toLowerCase();
      const mLabel = (meetings[0].label || "").toLowerCase();
      if (!otherSurname || !mLabel.includes(otherSurname)) {
        primaryMeeting = meetings[0];
      }
    }

    const subRoom = subgroupRooms[subgroupIdx];
    // Online meeting link takes visual priority over physical room badge.
    if (!primaryMeeting && subRoom) {
      displayRooms = [subRoom];
    }
  } else {
    const sharedMeetings = isDualTeachers
      ? meetings.filter((m) => m !== teacherMeetings[0] && m !== teacherMeetings[1])
      : meetings;
    primaryMeeting = sharedMeetings[0] ?? (isDualTeachers ? null : meetings[0] ?? null);

    if (!(primaryMeeting && hasGroupAccess && !isDualTeachers)) {
      displayRooms = rawRooms;
    }
  }

  const hasAnyMeeting = Boolean(
    primaryMeeting || (isDualTeachers && (teacherMeetings[0] || teacherMeetings[1]))
  );
  const hasProtectedOnline = Boolean(
    !hasGroupAccess &&
      !hasAnyMeeting &&
      (lesson.has_protected_link || (lesson.is_online && displayRooms.length === 0))
  );

  return {
    teachers,
    isDualTeachers,
    effectiveSubgroup,
    meetings,
    primaryMeeting,
    subgroupMeetings: teacherMeetings,
    subgroupRooms,
    displayRooms,
    roomsLabel: formatRoomsList(displayRooms),
    hasProtectedOnline,
  };
}
