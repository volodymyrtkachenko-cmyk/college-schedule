import { DEFAULT_LESSON_TIMES, SHORTENED_LESSON_TIMES } from "../constants/lessons";
import { formatKyivDateIso, formatKyivTime } from "../date";

function parseEndTime(range?: string): string | null {
  if (!range) return null;
  const parts = range.split(/[-–]/);
  return parts[1]?.trim() || null;
}

export function isSlotInPast(
  slotDate: string,
  lessonNumber: number,
  isShortenedDay = false,
  nowDate?: Date
): boolean {
  const todayIso = formatKyivDateIso(nowDate);
  if (slotDate < todayIso) return true;
  if (slotDate > todayIso) return false;
  const timesMap = isShortenedDay ? SHORTENED_LESSON_TIMES : DEFAULT_LESSON_TIMES;
  const endTime = parseEndTime(timesMap[lessonNumber]) || parseEndTime(DEFAULT_LESSON_TIMES[lessonNumber]);
  if (!endTime) return false;
  const nowTime = formatKyivTime(nowDate);
  return nowTime >= endTime;
}
