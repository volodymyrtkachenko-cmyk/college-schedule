import type { Lesson, ScheduleResponse } from "./api";

const weekdayOf = (date: string) => new Date(`${date}T12:00:00`).getDay() || 7;
const weeksOverlap = (a: Lesson, b: Lesson) =>
  a.week_type === "both" || b.week_type === "both" || a.week_type === b.week_type;

/** Whether `lesson` may be moved to the given date/slot without a group or teacher clash. */
export function canMoveLesson(
  lesson: Lesson,
  targetDate: string,
  lessonNumber: number,
  week: ScheduleResponse[],
  availabilityWeek?: ScheduleResponse[] | null,
): boolean {
  const targetWeekday = weekdayOf(targetDate);
  if (lesson.day_of_week === targetWeekday && lesson.lesson_number === lessonNumber) return false;

  if (!availabilityWeek) {
    // Local check while the global schedule is loading
    const localDay = week.find((day) => day.date === targetDate);
    if (!localDay) return true;
    return !localDay.lessons.some((other) =>
      other.id !== lesson.id && other.lesson_number === lessonNumber && !other.is_replacement && weeksOverlap(lesson, other));
  }

  const targetLessons = availabilityWeek
    .filter((day) => weekdayOf(day.date) === targetWeekday)
    .flatMap((day) => day.lessons)
    .filter((candidate) => !candidate.is_replacement);

  const movingTeacherIds = new Set(
    [lesson.teacher_id, lesson.second_teacher_id].filter((id): id is number => id !== null),
  );

  return !targetLessons.some((other) => {
    if (other.id === lesson.id || other.lesson_number !== lessonNumber || !weeksOverlap(lesson, other)) return false;

    const sameGroup = other.group_id === lesson.group_id;
    const teacherConflict = [other.teacher_id, other.second_teacher_id]
      .some((id) => id !== null && movingTeacherIds.has(id));
    if (!sameGroup && !teacherConflict) return false;

    const sameSharedLesson = !sameGroup && !!lesson.stream_id &&
      other.stream_id === lesson.stream_id &&
      other.subject_id === lesson.subject_id &&
      other.teacher_id === lesson.teacher_id &&
      other.second_teacher_id === lesson.second_teacher_id;
    return !sameSharedLesson;
  });
}
