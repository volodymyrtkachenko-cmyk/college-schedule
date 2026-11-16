import type { ScheduleResponse } from "../api";
import type { FullTaskItem } from "../../components/TaskCardItem";
import type { PersonalSubmission } from "../classroomTaskFilter";
import {
  MANUAL_DONE_STATE,
  extractClassroomTaskKey,
  isCompletedTaskState,
  isOwnTask,
} from "../classroomTaskFilter";
import { KYIV_DATE_FMT } from "../date";
import {
  extractTeacherFromSubject,
  isValidTeacherName,
  normalizeSubjectName,
} from "../format";
import {
  TaskDeadline,
  extractClassroomTasks,
  parseTaskDeadline,
  sortTasksByDeadline,
} from "../lesson-card";
import { normalizeTaskBrief } from "./priorityNavigator";

/**
 * Merges incoming Classroom tasks onto existing cached items without clobbering richer metadata/briefs
 * when an endpoint only supplies lightweight note-reconstructed fallback entries.
 */
export function mergeTasksLists(existing: any[], incoming: any[]): any[] {
  if (!Array.isArray(incoming) || incoming.length === 0) return existing;
  if (!Array.isArray(existing) || existing.length === 0) return incoming;
  const map = new Map<string, any>();
  const resolveKey = (item: any): string | null => {
    const rawUrl = item?.alternate_link || item?.url;
    const taskKey = extractClassroomTaskKey(rawUrl);
    if (taskKey) return taskKey;
    const fallback = rawUrl || item?.id;
    return fallback ? String(fallback) : null;
  };
  for (const item of existing) {
    const key = resolveKey(item);
    if (key) map.set(key, item);
  }
  for (const item of incoming) {
    const key = resolveKey(item);
    if (!key) continue;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, item);
      continue;
    }
    if (item?.is_reconstructed) {
      map.set(key, {
        ...prev,
        ...item,
        subject: prev.subject || item.subject,
        course_name: prev.course_name || item.course_name,
        teacher: item.teacher || prev.teacher,
        max_points: item.max_points ?? prev.max_points,
        creation_time: prev.creation_time ?? item.creation_time,
        created_at: prev.created_at ?? item.created_at,
        brief: item.brief ?? prev.brief ?? null,
      });
    } else {
      map.set(key, {
        ...prev,
        ...item,
        brief: item.brief !== undefined ? item.brief : prev.brief,
      });
    }
  }
  return Array.from(map.values());
}

/**
 * Aggregates week-bound lesson tasks and unlinked Classroom tasks, applying personal submission states.
 */
export function aggregateClassroomTasks(params: {
  mode: "student" | "teacher";
  week: ScheduleResponse[];
  classroomTasks: any[];
  isLinked: boolean;
  submissions: Record<string, PersonalSubmission>;
  personalTeachers: string[];
}): FullTaskItem[] {
  const { mode, week, classroomTasks, isLinked, submissions, personalTeachers } = params;
  if (mode === "teacher") return [];

  const tasks: FullTaskItem[] = [];
  const seenUrls = new Set<string>();
  const boundUrls = new Set<string>();

  if (week && week.length > 0) {
    for (const d of week) {
      if (!d.lessons) continue;
      for (const l of d.lessons) {
        const extracted = extractClassroomTasks(l.note);
        for (const t of extracted) {
          if (!t.url) continue;
          boundUrls.add(t.url);
          if (!isOwnTask(isLinked, submissions, t.url, t.teacher || l.teacher_name, personalTeachers, t.title)) {
            continue;
          }
          if (!seenUrls.has(t.url)) {
            seenUrls.add(t.url);

            const key = extractClassroomTaskKey(t.url);
            const matchedTask = classroomTasks?.find(
              (ct) => (ct.alternate_link || ct.url) === t.url || (ct.id && key && ct.id === key)
            );
            const personalSub = isLinked
              ? submissions[t.url] ||
                (key ? submissions[key] : null) ||
                (matchedTask?.id ? submissions[matchedTask.id] : null)
              : null;
            const effectiveState = personalSub ? personalSub.state : "NEW";
            const effectiveGrade = personalSub ? (personalSub.grade ?? null) : null;
            const effectiveMaxPoints =
              personalSub?.maxPoints ?? matchedTask?.max_points ?? matchedTask?.maxPoints ?? null;
            const isDone = isLinked && isCompletedTaskState(effectiveState);

            let deadline = t.deadline;
            if (isDone) {
              deadline = {
                ...t.deadline,
                isOverdue: false,
                statusText:
                  effectiveState === "RETURNED" && effectiveGrade != null
                    ? `Оцінка: ${effectiveGrade}/${effectiveMaxPoints || 100}`
                    : effectiveState === MANUAL_DONE_STATE
                    ? "Відмічено вручну"
                    : "Здано",
                badgeTone: "normal",
              };
            }

            const dueIso = t.deadline.date ? KYIV_DATE_FMT.format(t.deadline.date) : null;

            const rawCreated =
              (t as any).creationTime ??
              (t as any).creation_time ??
              (t as any).created_at ??
              matchedTask?.creation_time ??
              matchedTask?.created_at ??
              matchedTask?.creationTime ??
              null;

            const cleanSubj = normalizeSubjectName(l.subject_name || l.subject || "Дисципліна");
            tasks.push({
              title: t.title || "Завдання",
              subject: cleanSubj,
              teacher: t.teacher || l.teacher_name || l.teacher,
              label: t.label,
              url: t.url,
              deadline,
              state: effectiveState,
              assignedGrade: effectiveGrade,
              maxPoints: effectiveMaxPoints,
              dueDateIso: dueIso,
              creationTime: rawCreated,
              creation_time: rawCreated,
              created_at: rawCreated,
              isBoundToWeek: true,
              brief: normalizeTaskBrief(matchedTask?.brief),
            });
          }
        }
      }
    }
  }

  if (classroomTasks && classroomTasks.length > 0) {
    for (const ct of classroomTasks) {
      const url = ct.alternate_link || ct.url;
      if (!url || seenUrls.has(url)) continue;
      if (!isOwnTask(isLinked, submissions, url, ct.teacher, personalTeachers, ct.title)) {
        continue;
      }
      seenUrls.add(url);

      const key = extractClassroomTaskKey(url);
      const personalSub = isLinked
        ? submissions[url] || (key ? submissions[key] : null) || (ct.id ? submissions[ct.id] : null)
        : null;
      const effectiveState = personalSub ? personalSub.state : "NEW";
      const effectiveGrade = personalSub ? (personalSub.grade ?? null) : null;
      const effectiveMaxPoints = personalSub?.maxPoints ?? ct.max_points ?? ct.maxPoints ?? null;
      const isDone = isLinked && isCompletedTaskState(effectiveState);

      let deadline: TaskDeadline;
      if (ct.due_date) {
        const parts = ct.due_date.split("-");
        deadline = parseTaskDeadline(`до ${parts[2]}.${parts[1]}`);
        if (isDone) {
          deadline.isOverdue = false;
          deadline.statusText =
            effectiveState === "RETURNED" && effectiveGrade != null
              ? `Оцінка: ${effectiveGrade}/${effectiveMaxPoints || 100}`
              : effectiveState === MANUAL_DONE_STATE
              ? "Відмічено вручну"
              : "Здано";
          deadline.badgeTone = "normal";
        }
      } else {
        deadline = {
          day: null,
          month: null,
          year: null,
          date: null,
          formattedDate: "",
          isOverdue: false,
          overdueDays: 0,
          isUrgent: false,
          statusText: isDone
            ? effectiveState === "RETURNED" && effectiveGrade != null
              ? `Оцінка: ${effectiveGrade}/${effectiveMaxPoints || 100}`
              : effectiveState === MANUAL_DONE_STATE
              ? "Відмічено вручну"
              : "Здано"
            : "",
          badgeTone: "normal",
        };
      }

      const rawSubj = ct.subject || ct.course_name || "";
      const cleanSubj = normalizeSubjectName(rawSubj) || "Дисципліна";
      const teacherFromRaw = extractTeacherFromSubject(rawSubj);
      const resolvedTeacher =
        (isValidTeacherName(ct.teacher) ? ct.teacher : null) ||
        (isValidTeacherName(ct.teacher_name) ? ct.teacher_name : null) ||
        teacherFromRaw ||
        null;

      const rawCreated = ct.creationTime ?? ct.creation_time ?? ct.created_at ?? null;

      tasks.push({
        id: ct.id,
        title: ct.title || "Завдання",
        subject: cleanSubj,
        teacher: resolvedTeacher,
        label: ct.due_date ? `до ${ct.due_date}` : "",
        url,
        deadline,
        state: effectiveState,
        assignedGrade: effectiveGrade,
        maxPoints: effectiveMaxPoints,
        dueDateIso: ct.due_date,
        creationTime: rawCreated,
        creation_time: rawCreated,
        created_at: rawCreated,
        isBoundToWeek: boundUrls.has(url),
        brief: normalizeTaskBrief(ct.brief),
      });
    }
  }

  return sortTasksByDeadline(tasks);
}

/**
 * Counts unsubmitted tasks that are overdue or due before the current school week Monday.
 */
export function countOverdueClassroomTasks(
  tasks: FullTaskItem[],
  isLinked: boolean,
  actualMondayIso: string
): number {
  let count = 0;
  for (const t of tasks) {
    const isDone = isLinked && isCompletedTaskState(t.state);
    if (isDone) continue;
    const dueIso = t.dueDateIso || (t.deadline.date ? KYIV_DATE_FMT.format(t.deadline.date) : null);
    if (t.deadline.isOverdue || (dueIso && dueIso < actualMondayIso)) {
      count++;
    }
  }
  return count;
}
