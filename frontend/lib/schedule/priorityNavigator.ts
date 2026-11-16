import type { Lesson, ScheduleResponse } from "../api";
import { extractClassroomTaskKey } from "../classroomTaskFilter";
import { KYIV_DATE_FMT, UKR_DAY_MONTH_SHORT_FMT } from "../date";
import { isSubjectMatch, normalizeSubjectName } from "../format";
import { getKyivNow, parseMinutes, type KyivNowSnapshot } from "../lesson-card/kyivClock";

export type WorkFormat = "phone" | "pc" | "theory";

export interface TaskBrief {
  summary: string;
  steps: string[];
  materials: string[];
  estimatedMinutes: number | null;
  workFormat: WorkFormat;
  source: "gemini" | "heuristic";
}

export interface NavigatorTaskInput {
  id?: string;
  title: string;
  subject: string;
  teacher?: string | null;
  label: string;
  url: string;
  deadline: {
    date: Date | null;
    formattedDate: string;
    isOverdue: boolean;
    overdueDays: number;
    isUrgent: boolean;
    statusText: string;
    badgeTone: "overdue" | "urgent" | "normal";
  };
  state?: string;
  assignedGrade?: number | null;
  maxPoints?: number | null;
  dueDateIso?: string | null;
  brief?: TaskBrief | null;
}

export interface NavigatorSubjectGradeInput {
  subject: string;
  average5: number;
  scaleType: "12" | "5" | "100";
  level: "excellent" | "good" | "satisfactory" | "risk";
}

export interface NearestLessonInfo {
  dateIso: string;
  dayOffset: number;
  lessonNumber: number;
  startTime: string;
  label: string;
}

export interface PrioritizedTaskItem {
  taskKey: string;
  task: NavigatorTaskInput;
  score: number;
  priorityTier: "critical" | "high" | "normal";
  reasons: string[];
  reasonText: string;
  weightLabel: string | null;
  isHeavyWeight: boolean;
  nextLesson: NearestLessonInfo | null;
  brief: TaskBrief;
}

export interface SubjectRiskSummary {
  subject: string;
  pendingCount: number;
  overdueCount: number;
  totalPendingPoints: number;
  scaleType: "12" | "5" | "100" | null;
  nearestLessonLabel: string | null;
  riskLevel: "critical" | "high" | "normal";
  topScore: number;
}

export interface FreeStudyWindow {
  id: string;
  dateIso: string;
  dayOffset: number;
  dayLabel: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  kind: "gap" | "shortened_evening" | "online_day";
  environment: "campus" | "home";
  description: string;
}

export interface WindowTaskSuggestion {
  suggestionId: string;
  window: FreeStudyWindow;
  item: PrioritizedTaskItem;
  isAccepted: boolean;
}

export interface WindowDecisionsState {
  dateIso: string;
  accepted: string[];
  dismissed: string[];
}

export const PRIORITY_NAV_OPEN_KEY = "schedule:priority_nav_open:v1";
export const TASK_CHECKLIST_KEY = "schedule:task_checklist:v1";
export const WINDOW_DECISIONS_KEY = "schedule:window_decisions:v1";

const VALID_FORMATS = new Set<WorkFormat>(["phone", "pc", "theory"]);

const PHONE_TITLE_RE = /(тест|опитуван|вікторин|форм|quiz|kahoot)/i;
const THEORY_TITLE_RE = /(конспект|лекці|параграф|теорі|читан|вивчи|опрацюва)/i;

export function getNavigatorTaskKey(task: Pick<NavigatorTaskInput, "url" | "id" | "title">): string {
  const fromUrl = task.url ? extractClassroomTaskKey(task.url) || task.url.trim() : "";
  return fromUrl || task.id || task.title;
}

export function normalizeTaskBrief(raw: unknown): TaskBrief | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const summary = typeof obj.summary === "string" ? obj.summary.trim() : "";

  const rawSteps = Array.isArray(obj.steps) ? obj.steps : [];
  const steps = rawSteps
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter(Boolean)
    .slice(0, 4);

  const rawMats = Array.isArray(obj.materials) ? obj.materials : [];
  const materials = rawMats
    .map((m) => (typeof m === "string" ? m.trim() : ""))
    .filter(Boolean)
    .slice(0, 5);

  if (!summary && steps.length === 0 && materials.length === 0 && obj.source !== "gemini") {
    return null;
  }

  const rawEst = obj.estimatedMinutes ?? obj.estimated_minutes;
  const estNum = typeof rawEst === "number" && Number.isFinite(rawEst) && rawEst > 0
    ? Math.round(rawEst)
    : null;

  const rawFormat = String(obj.workFormat ?? obj.work_format ?? "pc").toLowerCase() as WorkFormat;
  const workFormat: WorkFormat = VALID_FORMATS.has(rawFormat) ? rawFormat : "pc";
  const source = obj.source === "gemini" ? "gemini" : "heuristic";

  return {
    summary,
    steps,
    materials,
    estimatedMinutes: estNum,
    workFormat,
    source,
  };
}

export function deriveClientTaskBrief(task: Pick<NavigatorTaskInput, "title" | "maxPoints">): TaskBrief {
  const title = (task.title || "").trim() || "Завдання";
  const workFormat: WorkFormat = PHONE_TITLE_RE.test(title)
    ? "phone"
    : THEORY_TITLE_RE.test(title)
      ? "theory"
      : "pc";

  // Never invent random minutes or boilerplate steps when real Classroom description/AI brief is missing
  const explicitMatch = title.match(/(?:^|[^\d])(\d{1,3})\s*(?:хв|хвилин|min|мин)(?![А-Яа-яІіЇїЄєҐґA-Za-z])/i);
  const parsedMin = explicitMatch ? parseInt(explicitMatch[1], 10) : NaN;
  const estimatedMinutes = Number.isFinite(parsedMin) && parsedMin >= 5 && parsedMin <= 240 ? parsedMin : null;

  return {
    summary: "",
    steps: [],
    materials: [],
    estimatedMinutes,
    workFormat,
    source: "heuristic",
  };
}

export function hasExpandableBrief(brief: TaskBrief | null | undefined): brief is TaskBrief {
  if (!brief) return false;
  return Boolean(
    brief.summary.trim() ||
    brief.steps.length > 0 ||
    brief.materials.length > 0
  );
}

export function formatBriefChipLabel(brief: TaskBrief | null | undefined): string | null {
  if (!hasExpandableBrief(brief)) return null;
  const parts: string[] = [];
  if (brief.estimatedMinutes) {
    parts.push(`~${brief.estimatedMinutes} хв`);
  }
  if (brief.source === "gemini" || brief.estimatedMinutes) {
    parts.push(formatWorkFormatLabel(brief.workFormat));
  } else if (brief.materials.length > 0) {
    parts.push(
      brief.materials.length === 1 ? "1 матеріал" : `${brief.materials.length} матеріали`
    );
  }
  return parts.length > 0 ? parts.join(" · ") : "Розбір";
}

export function resolveEffectiveTaskBrief(task: NavigatorTaskInput): TaskBrief {
  return task.brief ?? deriveClientTaskBrief(task);
}

export function formatWorkFormatLabel(format: WorkFormat): string {
  switch (format) {
    case "phone":
      return "Телефон";
    case "theory":
      return "Теорія";
    default:
      return "ПК";
  }
}

export function formatTaskWeightBadge(
  maxPoints: number | null | undefined,
  scaleType?: "12" | "5" | "100" | null,
): { label: string; isHeavy: boolean } | null {
  if (typeof maxPoints !== "number" || !Number.isFinite(maxPoints) || maxPoints <= 0) {
    return null;
  }
  const rounded = Number.isInteger(maxPoints) ? String(maxPoints) : maxPoints.toFixed(1);
  const isHeavy =
    scaleType === "5"
      ? maxPoints >= 4
      : scaleType === "12"
        ? maxPoints >= 10
        : maxPoints <= 12
          ? maxPoints >= 10
          : maxPoints >= 20;
  return {
    label: `${rounded} б.`,
    isHeavy,
  };
}

function parseIsoDayDiff(fromIso: string, toIso: string): number {
  const from = new Date(`${fromIso}T12:00:00Z`).getTime();
  const to = new Date(`${toIso}T12:00:00Z`).getTime();
  if (Number.isNaN(from) || Number.isNaN(to)) return 999;
  return Math.round((to - from) / 86_400_000);
}

function getLessonTimeBounds(lesson: Lesson): { startMin: number; endMin: number; startStr: string; endStr: string } | null {
  const parts = (lesson.time || "").split(/[-–—]/).map((p) => p.trim());
  if (parts.length < 2) return null;
  const startMin = parseMinutes(parts[0]);
  const endMin = parseMinutes(parts[1]);
  if (startMin === null || endMin === null || endMin <= startMin) return null;
  return { startMin, endMin, startStr: parts[0], endStr: parts[1] };
}

function formatDayShortLabel(dateIso: string, dayOffset: number): string {
  if (dayOffset === 0) return "Сьогодні";
  if (dayOffset === 1) return "Завтра";
  const d = new Date(`${dateIso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateIso;
  return UKR_DAY_MONTH_SHORT_FMT.format(d);
}

export function findNearestSubjectLesson(
  subjectName: string,
  week: ScheduleResponse[] | undefined,
  now: KyivNowSnapshot,
): NearestLessonInfo | null {
  if (!week || week.length === 0 || !subjectName) return null;

  const sortedDays = [...week]
    .filter((d) => d.date >= now.dateIso && Array.isArray(d.lessons) && d.lessons.length > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  for (const day of sortedDays) {
    const dayOffset = parseIsoDayDiff(now.dateIso, day.date);
    const matching = [...day.lessons]
      .filter((l) => !l.is_cancelled && isSubjectMatch(l.subject_name || l.subject || "", subjectName))
      .sort((a, b) => a.lesson_number - b.lesson_number);

    for (const lesson of matching) {
      const bounds = getLessonTimeBounds(lesson);
      if (dayOffset === 0 && bounds && bounds.endMin <= now.minutes) {
        continue;
      }
      const startStr = bounds?.startStr || (lesson.time || "").split(/[-–—]/)[0]?.trim() || "";
      const dayText =
        dayOffset === 0
          ? "сьогодні"
          : dayOffset === 1
            ? "завтра"
            : formatDayShortLabel(day.date, dayOffset);
      const label = startStr ? `пара ${dayText} о ${startStr}` : `пара ${dayText}`;
      return {
        dateIso: day.date,
        dayOffset,
        lessonNumber: lesson.lesson_number,
        startTime: startStr,
        label,
      };
    }
  }
  return null;
}

export function scorePriorityTasks(params: {
  tasks: NavigatorTaskInput[];
  week?: ScheduleResponse[];
  subjectGrades?: NavigatorSubjectGradeInput[];
  isLinked: boolean;
  checklistMap?: Record<string, number[]>;
  now?: KyivNowSnapshot;
}): {
  prioritizedTasks: PrioritizedTaskItem[];
  subjectRisks: SubjectRiskSummary[];
} {
  const {
    tasks,
    week,
    subjectGrades = [],
    isLinked,
    checklistMap = {},
    now = getKyivNow(),
  } = params;

  const nearestBySubject = new Map<string, NearestLessonInfo | null>();
  const getNearest = (subject: string): NearestLessonInfo | null => {
    const key = normalizeSubjectName(subject) || subject;
    if (!nearestBySubject.has(key)) {
      nearestBySubject.set(key, findNearestSubjectLesson(subject, week, now));
    }
    return nearestBySubject.get(key) ?? null;
  };

  const findGradeSummary = (subject: string): NavigatorSubjectGradeInput | null => {
    return subjectGrades.find((sg) => isSubjectMatch(sg.subject, subject)) ?? null;
  };

  const prioritized: PrioritizedTaskItem[] = [];

  for (const task of tasks) {
    const isDone = isLinked && (task.state === "TURNED_IN" || task.state === "RETURNED");
    if (isDone) continue;

    const taskKey = getNavigatorTaskKey(task);
    const brief = resolveEffectiveTaskBrief(task);
    const gradeMeta = isLinked ? findGradeSummary(task.subject) : null;
    const nextLesson = getNearest(task.subject);
    const weight = formatTaskWeightBadge(task.maxPoints, gradeMeta?.scaleType ?? null);

    let score = 0;
    const reasons: string[] = [];

    let dueIso = task.dueDateIso || null;
    if (!dueIso && task.deadline.date) {
      dueIso = KYIV_DATE_FMT.format(task.deadline.date);
    }

    if (task.deadline.isOverdue) {
      const overdueDays = Math.max(1, task.deadline.overdueDays || 1);
      score += overdueDays <= 14 ? (isLinked ? 38 : 20) : (isLinked ? 26 : 12);
      if (isLinked) {
        reasons.push(overdueDays === 1 ? "прострочено вчора" : `борг ${overdueDays} дн.`);
      } else {
        reasons.push(`термін минув ${overdueDays} дн. тому`);
      }
    } else if (dueIso) {
      const daysUntil = parseIsoDayDiff(now.dateIso, dueIso);
      if (daysUntil <= 0) {
        score += 50;
        reasons.push("дедлайн сьогодні");
      } else if (daysUntil === 1) {
        score += 44;
        reasons.push("дедлайн завтра");
      } else if (daysUntil <= 3) {
        score += 32;
        reasons.push(`дедлайн через ${daysUntil} дн.`);
      } else if (daysUntil <= 7) {
        score += 20;
        reasons.push(`до ${task.deadline.formattedDate || dueIso}`);
      } else {
        score += 10;
      }
    } else {
      score += 6;
    }

    if (nextLesson) {
      if (nextLesson.dayOffset === 0) {
        score += 22;
        reasons.push(nextLesson.label);
      } else if (nextLesson.dayOffset === 1) {
        score += 16;
        reasons.push(nextLesson.label);
      } else if (nextLesson.dayOffset <= 3) {
        score += 8;
        reasons.push(nextLesson.label);
      }
    }

    if (weight) {
      if (weight.isHeavy) {
        score += 14;
        reasons.push(`вагома (${weight.label})`);
      } else {
        score += 6;
      }
    }

    if (gradeMeta) {
      if (gradeMeta.level === "risk") {
        score += 16;
        reasons.push(`ризик по балу (${gradeMeta.average5.toFixed(1)}/5)`);
      } else if (gradeMeta.level === "satisfactory") {
        score += 8;
      }
    }

    const checkedSteps = checklistMap[taskKey] || [];
    if (checkedSteps.length > 0 && brief.steps.length > 0 && checkedSteps.length < brief.steps.length) {
      score += 4;
    }

    const priorityTier: "critical" | "high" | "normal" =
      score >= 62 ? "critical" : score >= 36 ? "high" : "normal";

    prioritized.push({
      taskKey,
      task,
      score,
      priorityTier,
      reasons: reasons.slice(0, 3),
      reasonText: reasons.slice(0, 2).join(" · "),
      weightLabel: weight?.label ?? null,
      isHeavyWeight: Boolean(weight?.isHeavy),
      nextLesson,
      brief,
    });
  }

  prioritized.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aDue = a.task.dueDateIso || "9999-12-31";
    const bDue = b.task.dueDateIso || "9999-12-31";
    return aDue.localeCompare(bDue);
  });

  // Aggregate subject risks
  const riskMap = new Map<string, SubjectRiskSummary>();
  for (const item of prioritized) {
    const cleanSubj = normalizeSubjectName(item.task.subject) || item.task.subject || "Дисципліна";
    const gradeMeta = isLinked ? findGradeSummary(cleanSubj) : null;
    const existing = riskMap.get(cleanSubj);
    const pts = typeof item.task.maxPoints === "number" && Number.isFinite(item.task.maxPoints)
      ? item.task.maxPoints
      : 0;
    const isOverdue = Boolean(item.task.deadline.isOverdue);

    if (!existing) {
      riskMap.set(cleanSubj, {
        subject: cleanSubj,
        pendingCount: 1,
        overdueCount: isOverdue ? 1 : 0,
        totalPendingPoints: pts,
        scaleType: gradeMeta?.scaleType ?? null,
        nearestLessonLabel: item.nextLesson?.label ?? null,
        riskLevel: item.priorityTier,
        topScore: item.score,
      });
    } else {
      existing.pendingCount += 1;
      if (isOverdue) existing.overdueCount += 1;
      existing.totalPendingPoints += pts;
      if (item.score > existing.topScore) {
        existing.topScore = item.score;
        existing.riskLevel = item.priorityTier;
      }
      if (!existing.nearestLessonLabel && item.nextLesson) {
        existing.nearestLessonLabel = item.nextLesson.label;
      }
    }
  }

  const subjectRisks = Array.from(riskMap.values()).sort((a, b) => {
    if (b.topScore !== a.topScore) return b.topScore - a.topScore;
    return b.pendingCount - a.pendingCount;
  });

  return { prioritizedTasks: prioritized, subjectRisks };
}

function minutesToHhMm(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function findFreeStudyWindows(
  week: ScheduleResponse[] | undefined,
  now: KyivNowSnapshot = getKyivNow(),
): FreeStudyWindow[] {
  if (!week || week.length === 0) return [];

  const candidateDays = [...week]
    .filter((d) => {
      const diff = parseIsoDayDiff(now.dateIso, d.date);
      return diff >= 0 && diff <= 1 && Array.isArray(d.lessons) && d.lessons.length > 0;
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  const windows: FreeStudyWindow[] = [];

  for (const day of candidateDays) {
    const dayOffset = parseIsoDayDiff(now.dateIso, day.date);
    const dayLabel = formatDayShortLabel(day.date, dayOffset);
    const activeLessons = [...day.lessons]
      .filter((l) => !l.is_cancelled)
      .sort((a, b) => a.lesson_number - b.lesson_number);

    // Deduplicate concurrent subgroup slots at the same lesson_number by taking outer bounds
    const slotBounds = new Map<number, { startMin: number; endMin: number; startStr: string; endStr: string }>();
    for (const l of activeLessons) {
      const b = getLessonTimeBounds(l);
      if (!b) continue;
      const prev = slotBounds.get(l.lesson_number);
      if (!prev) {
        slotBounds.set(l.lesson_number, b);
      } else {
        slotBounds.set(l.lesson_number, {
          startMin: Math.min(prev.startMin, b.startMin),
          endMin: Math.max(prev.endMin, b.endMin),
          startStr: b.startMin < prev.startMin ? b.startStr : prev.startStr,
          endStr: b.endMin > prev.endMin ? b.endStr : prev.endStr,
        });
      }
    }

    const orderedSlots = Array.from(slotBounds.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, v]) => v);

    const isOnlineDay = day.learning_mode === "online";

    for (let i = 0; i < orderedSlots.length - 1; i++) {
      const curr = orderedSlots[i];
      const next = orderedSlots[i + 1];
      const gapMinutes = next.startMin - curr.endMin;
      // Only treat >= 45 min as a meaningful study window (ignores ordinary 10–30 min breaks)
      if (gapMinutes < 45) continue;

      const effectiveStartMin = dayOffset === 0 ? Math.max(curr.endMin, now.minutes) : curr.endMin;
      const availableMinutes = next.startMin - effectiveStartMin;
      if (availableMinutes < 35) continue;

      const startStr = dayOffset === 0 && now.minutes > curr.endMin
        ? minutesToHhMm(effectiveStartMin)
        : curr.endStr;

      windows.push({
        id: `${day.date}:gap:${curr.endStr}-${next.startStr}`,
        dateIso: day.date,
        dayOffset,
        dayLabel,
        startTime: startStr,
        endTime: next.startStr,
        durationMinutes: availableMinutes,
        kind: "gap",
        environment: isOnlineDay ? "home" : "campus",
        description: `${dayLabel}, вікно ${startStr}–${next.startStr} (${availableMinutes} хв)`,
      });
    }

    // Check shortened / online day evening window when day ends early (<= 14:10) or is online
    if (orderedSlots.length > 0) {
      const lastEndMin = orderedSlots[orderedSlots.length - 1].endMin;
      const isShortOrOnline = isOnlineDay || Boolean(day.is_shortened_day) || orderedSlots.length <= 2;
      if (isShortOrOnline && (dayOffset === 1 || now.minutes < 20 * 60)) {
        const eveningStartMin = Math.max(lastEndMin + 30, 15 * 60, dayOffset === 0 ? now.minutes : 0);
        if (eveningStartMin <= 20 * 60) {
          const kind = isOnlineDay ? "online_day" : "shortened_evening";
          const startLabel = minutesToHhMm(eveningStartMin);
          windows.push({
            id: `${day.date}:${kind}`,
            dateIso: day.date,
            dayOffset,
            dayLabel,
            startTime: startLabel,
            endTime: "20:30",
            durationMinutes: 90,
            kind,
            environment: "home",
            description:
              kind === "online_day"
                ? `${dayLabel}, дистанційний день (після ${orderedSlots[orderedSlots.length - 1].endStr})`
                : `${dayLabel}, скорочений день (після ${orderedSlots[orderedSlots.length - 1].endStr})`,
          });
        }
      }
    }
  }

  return windows;
}

export function matchTasksToWindows(
  prioritizedTasks: PrioritizedTaskItem[],
  windows: FreeStudyWindow[],
  decisions: WindowDecisionsState,
  limit: number = 2,
): WindowTaskSuggestion[] {
  if (prioritizedTasks.length === 0 || windows.length === 0) return [];

  const dismissedSet = new Set(decisions.dismissed);
  const acceptedSet = new Set(decisions.accepted);
  const usedTaskKeys = new Set<string>();
  const suggestions: WindowTaskSuggestion[] = [];

  for (const win of windows) {
    if (suggestions.length >= limit) break;

    const candidates = prioritizedTasks.filter((item) => {
      if (usedTaskKeys.has(item.taskKey)) return false;
      const suggestionId = `${win.id}::${item.taskKey}`;
      if (dismissedSet.has(suggestionId)) return false;

      const est = item.brief.estimatedMinutes;
      if (est !== null && est > win.durationMinutes + 10) return false;

      // For in-college campus gaps, avoid suggesting heavy PC-only tasks
      if (win.environment === "campus" && item.brief.workFormat === "pc") {
        return false;
      }
      return true;
    });

    if (candidates.length === 0) continue;

    // Prefer tasks whose workFormat naturally suits the window environment
    candidates.sort((a, b) => {
      const aFit =
        win.environment === "campus"
          ? a.brief.workFormat === "phone"
            ? 12
            : 8
          : a.brief.workFormat === "pc"
            ? 8
            : 0;
      const bFit =
        win.environment === "campus"
          ? b.brief.workFormat === "phone"
            ? 12
            : 8
          : b.brief.workFormat === "pc"
            ? 8
            : 0;
      return b.score + bFit - (a.score + aFit);
    });

    const chosen = candidates[0];
    const suggestionId = `${win.id}::${chosen.taskKey}`;
    usedTaskKeys.add(chosen.taskKey);
    suggestions.push({
      suggestionId,
      window: win,
      item: chosen,
      isAccepted: acceptedSet.has(suggestionId),
    });
  }

  return suggestions;
}

export function readChecklistMap(): Record<string, number[]> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(TASK_CHECKLIST_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, number[]>;
  } catch {
    return {};
  }
}

export function toggleChecklistStep(taskKey: string, stepIdx: number): Record<string, number[]> {
  const map = readChecklistMap();
  const prev = Array.isArray(map[taskKey]) ? map[taskKey] : [];
  const next = prev.includes(stepIdx)
    ? prev.filter((i) => i !== stepIdx)
    : [...prev, stepIdx].sort((a, b) => a - b);
  const updated = { ...map };
  if (next.length === 0) {
    delete updated[taskKey];
  } else {
    updated[taskKey] = next;
  }
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(TASK_CHECKLIST_KEY, JSON.stringify(updated));
    } catch {}
  }
  return updated;
}

export function readWindowDecisions(todayIso: string): WindowDecisionsState {
  const empty: WindowDecisionsState = { dateIso: todayIso, accepted: [], dismissed: [] };
  if (typeof window === "undefined") return empty;
  try {
    const raw = window.localStorage.getItem(WINDOW_DECISIONS_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<WindowDecisionsState>;
    if (!parsed || typeof parsed !== "object" || parsed.dateIso !== todayIso) {
      return empty;
    }
    return {
      dateIso: todayIso,
      accepted: Array.isArray(parsed.accepted) ? parsed.accepted.filter((s): s is string => typeof s === "string") : [],
      dismissed: Array.isArray(parsed.dismissed) ? parsed.dismissed.filter((s): s is string => typeof s === "string") : [],
    };
  } catch {
    return empty;
  }
}

export function saveWindowDecision(
  todayIso: string,
  suggestionId: string,
  decision: "accept" | "dismiss",
): WindowDecisionsState {
  const current = readWindowDecisions(todayIso);
  const nextAccepted = new Set(current.accepted);
  const nextDismissed = new Set(current.dismissed);

  if (decision === "accept") {
    if (nextAccepted.has(suggestionId)) nextAccepted.delete(suggestionId);
    else nextAccepted.add(suggestionId);
    nextDismissed.delete(suggestionId);
  } else {
    nextDismissed.add(suggestionId);
    nextAccepted.delete(suggestionId);
  }

  const next: WindowDecisionsState = {
    dateIso: todayIso,
    accepted: Array.from(nextAccepted),
    dismissed: Array.from(nextDismissed),
  };
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(WINDOW_DECISIONS_KEY, JSON.stringify(next));
    } catch {}
  }
  return next;
}
