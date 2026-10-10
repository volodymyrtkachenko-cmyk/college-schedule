/** A group can have at most 4 lessons per day. */
export const MAX_LESSONS = 4;
export const LESSON_NUMBERS = [1, 2, 3, 4] as const;

export const DEFAULT_LESSON_TIMES: Record<number, string> = {
  1: "09:00–10:20",
  2: "10:40–12:00",
  3: "12:30–13:50",
  4: "14:00–15:20",
};
