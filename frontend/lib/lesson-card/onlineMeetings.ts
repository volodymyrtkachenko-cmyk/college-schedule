import { extractOnlineMeetings, MeetingInfo } from "../format";

export type { MeetingInfo };
export { extractOnlineMeetings };

export function extractOnlineMeetingInfo(note?: string | null, room?: string | null) {
  const meetings = extractOnlineMeetings(note, room);
  return meetings[0] ?? null;
}

export function getMeetingBtnStyle(
  platform?: string | null,
  isLiveOrSoon?: boolean,
  size: "normal" | "compact" | "tiny" = "normal"
) {
  if (isLiveOrSoon) {
    if (size === "compact" || size === "tiny") {
      return "bg-emerald-600 text-white border-emerald-500 shadow-xs hover:bg-emerald-500";
    }
    return "bg-emerald-600 text-white border-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.35)] hover:bg-emerald-500";
  }
  if (platform === "zoom") {
    return "border-sky-400/60 dark:border-sky-500/50 bg-sky-100/80 dark:bg-sky-500/20 text-sky-900 dark:text-sky-200 shadow-xs hover:border-sky-500 dark:hover:border-sky-400 hover:text-sky-950 dark:hover:text-sky-100 hover:bg-sky-200/90 dark:hover:bg-sky-500/30";
  }
  if (platform === "meet") {
    return "border-emerald-400/60 dark:border-emerald-500/50 bg-emerald-100/80 dark:bg-emerald-500/20 text-emerald-900 dark:text-emerald-200 shadow-xs hover:border-emerald-500 dark:hover:border-emerald-400 hover:text-emerald-950 dark:hover:text-emerald-100 hover:bg-emerald-200/90 dark:hover:bg-emerald-500/30";
  }
  return "border-indigo-400/60 dark:border-indigo-500/50 bg-indigo-100/80 dark:bg-indigo-500/20 text-indigo-900 dark:text-indigo-200 shadow-xs hover:border-indigo-500 dark:hover:border-indigo-400 hover:text-indigo-950 dark:hover:text-indigo-100 hover:bg-indigo-200/90 dark:hover:bg-indigo-500/30";
}

export function resolveTeacherMeetings(
  meetings: MeetingInfo[],
  teacherNames: string[]
): [MeetingInfo | null, MeetingInfo | null] {
  if (meetings.length === 0) return [null, null];

  const s0 = (teacherNames[0] || "").split(/[\s.]+/)[0].toLowerCase();
  const s1 = (teacherNames[1] || "").split(/[\s.]+/)[0].toLowerCase();

  const matchesTeacher = (m: MeetingInfo, s: string, subNum: 1 | 2) => {
    if (m.subgroup === subNum) return true;
    if (!m.label) return false;
    const l = m.label.toLowerCase();
    if (s && (l.includes(s) || s.includes(l))) return true;
    if (subNum === 1 && (l.includes("1 підгр") || l.includes("1-ша") || l === "1")) return true;
    if (subNum === 2 && (l.includes("2 підгр") || l.includes("2-га") || l === "2")) return true;
    if (s.includes("токар") && (l.includes("токар") || l.includes("токарев"))) return true;
    if (s.includes("хочин") && (l.includes("хочин") || l.includes("хочинск"))) return true;
    return false;
  };

  let m0 = meetings.find((m) => matchesTeacher(m, s0, 1)) || null;
  let m1 = meetings.find((m) => matchesTeacher(m, s1, 2) && m !== m0) || null;

  if (meetings.length >= 2) {
    if (m0 && !m1) {
      m1 = meetings.find((m) => m !== m0) || null;
    } else if (m1 && !m0) {
      m0 = meetings.find((m) => m !== m1) || null;
    }
  }

  return [m0 || null, m1 || null];
}
