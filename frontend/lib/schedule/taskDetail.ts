import type { ScheduleResponse } from "../api/types";
import type { FullTaskItem } from "../../components/TaskCardItem";
import { MANUAL_DONE_STATE, extractClassroomTaskKey } from "../classroomTaskFilter";
import {
  type ClassroomTaskItem,
  type TaskDeadline,
  getTaskStatusText,
  parseTaskDeadline,
} from "../lesson-card";
import {
  type TaskMaterialItem,
  formatBriefChipLabel,
  formatTaskWeightBadge,
  formatWorkFormatLabel,
  getNavigatorTaskKey,
  resolveEffectiveTaskBrief,
} from "./priorityNavigator";

export const OPEN_TASK_DETAIL_EVENT = "schedule:open-task-detail";

export interface TaskDetailOpenPayload {
  task: FullTaskItem | ClassroomTaskItem;
  subjectName?: string | null;
  teacherName?: string | null;
  groupId?: number | null;
}

export interface ResolvedTaskDetail {
  key: string;
  id?: string;
  title: string;
  subject: string;
  teacher: string | null;
  url: string;
  statusText: string;
  badgeTone: "overdue" | "urgent" | "normal";
  state: string;
  isDone: boolean;
  isManualDone: boolean;
  isOverdue: boolean;
  assignedGrade: number | null;
  maxPoints: number | null;
  weightLabel: string | null;
  estimatedMinutes: number | null;
  workFormatLabel: string;
  isAiBrief: boolean;
  chipLabel: string | null;
  leadSummary: string;
  extendedParagraphs: string[];
  deliverable: string | null;
  hasExpandableDescription: boolean;
  materials: TaskMaterialItem[];
  deadline: TaskDeadline;
}

export function openTaskDetailModal(payload: TaskDetailOpenPayload): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<TaskDetailOpenPayload>(OPEN_TASK_DETAIL_EVENT, { detail: payload }));
}

function splitLongSummary(rawText: string, briefSteps: string[], deliverable: string | null): {
  leadSummary: string;
  extendedParagraphs: string[];
} {
  const normalized = rawText.replace(/\r\n/g, "\n").trim();
  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((p) => p.replace(/[ \t]*\n[ \t]*/g, " ").trim())
    .filter(Boolean);

  let leadSummary = "";
  const extendedParagraphs: string[] = [];

  if (paragraphs.length > 1) {
    leadSummary = paragraphs[0];
    extendedParagraphs.push(...paragraphs.slice(1));
  } else if (paragraphs.length === 1) {
    const single = paragraphs[0];
    const sentences = single.match(/[^.!?…]+(?:[.!?…]+|$)/g)?.map((s) => s.trim()).filter(Boolean) ?? [single];
    if (sentences.length > 2 || (single.length > 210 && sentences.length > 1)) {
      let lead = sentences[0];
      let splitIdx = 1;
      while (splitIdx < sentences.length - 1 && lead.length < 130 && (lead + " " + sentences[splitIdx]).length <= 210) {
        lead = `${lead} ${sentences[splitIdx]}`.trim();
        splitIdx++;
      }
      leadSummary = lead;
      const tail = sentences.slice(splitIdx).join(" ").trim();
      if (tail) {
        // Group tail into 1-2 readable paragraphs for comfortable scrolling
        if (tail.length > 280) {
          const restSentences = sentences.slice(splitIdx);
          const mid = Math.ceil(restSentences.length / 2);
          extendedParagraphs.push(restSentences.slice(0, mid).join(" ").trim());
          const second = restSentences.slice(mid).join(" ").trim();
          if (second) extendedParagraphs.push(second);
        } else {
          extendedParagraphs.push(tail);
        }
      }
    } else {
      leadSummary = single;
    }
  }

  if (briefSteps.length > 0) {
    extendedParagraphs.push(
      ...briefSteps.map((step, idx) => `${idx + 1}. ${step}`)
    );
  }

  if (deliverable && leadSummary !== deliverable && !leadSummary.includes(deliverable)) {
    extendedParagraphs.push(`Результат для здачі: ${deliverable}.`);
  }

  return { leadSummary, extendedParagraphs };
}

function matchFullTask(
  candidate: FullTaskItem | ClassroomTaskItem,
  allTasks: FullTaskItem[],
  subjectName?: string | null
): FullTaskItem | null {
  if (!allTasks || allTasks.length === 0) return null;

  const candidateId = "id" in candidate ? candidate.id : undefined;
  if (candidateId) {
    const byId = allTasks.find((item) => item.id && item.id === candidateId);
    if (byId) return byId;
  }

  const candidateUrl = (candidate.url || "").trim();
  const candidateKey = candidateUrl ? extractClassroomTaskKey(candidateUrl) : null;
  if (candidateUrl || candidateKey) {
    const byUrl = allTasks.find((item) => {
      if (candidateUrl && item.url === candidateUrl) return true;
      if (candidateKey && extractClassroomTaskKey(item.url) === candidateKey) return true;
      return false;
    });
    if (byUrl) return byUrl;
  }

  const normTitle = (candidate.title || "").trim().toLowerCase();
  const normSubject = (
    subjectName ||
    ("subject" in candidate ? candidate.subject : "") ||
    ""
  )
    .trim()
    .toLowerCase();
  if (normTitle && normTitle !== "завдання" && normTitle !== "домашнє завдання") {
    const byTitle = allTasks.find((item) => {
      if (item.title.trim().toLowerCase() !== normTitle) return false;
      return !normSubject || item.subject.trim().toLowerCase() === normSubject;
    });
    if (byTitle) return byTitle;
  }

  return null;
}

export function resolveFullTaskDetail(
  payload: TaskDetailOpenPayload,
  allTasks: FullTaskItem[],
  isLinked: boolean
): ResolvedTaskDetail {
  const rawTask = payload.task;
  const matched = matchFullTask(rawTask, allTasks, payload.subjectName);
  const fullItem: FullTaskItem = matched
    ? {
        ...matched,
        subject: payload.subjectName || matched.subject,
        teacher: payload.teacherName || matched.teacher || rawTask.teacher,
        brief: matched.brief ?? ("brief" in rawTask ? rawTask.brief : null),
      }
    : {
        title: rawTask.title || "Завдання",
        subject:
          payload.subjectName ||
          ("subject" in rawTask && rawTask.subject ? rawTask.subject : "Навчальна дисципліна"),
        teacher: payload.teacherName ?? rawTask.teacher ?? null,
        label: rawTask.label || "",
        url: rawTask.url,
        deadline: rawTask.deadline,
        id: "id" in rawTask ? rawTask.id : undefined,
        state: "state" in rawTask ? rawTask.state : undefined,
        assignedGrade: "assignedGrade" in rawTask ? rawTask.assignedGrade : undefined,
        maxPoints: "maxPoints" in rawTask ? rawTask.maxPoints : undefined,
        dueDateIso: "dueDateIso" in rawTask ? rawTask.dueDateIso : undefined,
        brief: "brief" in rawTask ? rawTask.brief : null,
      };

  const title =
    !fullItem.title || fullItem.title === "Домашнє завдання" || fullItem.title === "Завдання"
      ? `${fullItem.subject} — завдання`
      : fullItem.title;

  const brief = resolveEffectiveTaskBrief(fullItem);
  const state = fullItem.state || "NEW";
  const isTurnedIn = state === "TURNED_IN";
  const isReturned = state === "RETURNED";
  const isManualDone = state === MANUAL_DONE_STATE;
  const isUnknown = state === "UNKNOWN";
  const isDone = Boolean(isLinked && (isTurnedIn || isReturned || isManualDone));
  const isOverdue = !isDone && !isUnknown && fullItem.deadline.badgeTone === "overdue";

  const assignedGrade = fullItem.assignedGrade ?? null;
  const maxPoints = fullItem.maxPoints ?? null;
  const weightBadge = formatTaskWeightBadge(maxPoints);

  let statusText = getTaskStatusText(fullItem.deadline, isLinked);
  let badgeTone: "overdue" | "urgent" | "normal" = fullItem.deadline.badgeTone;

  if (isDone) {
    badgeTone = "normal";
    if (isReturned) {
      statusText =
        assignedGrade != null
          ? `Оцінка: ${assignedGrade}/${maxPoints || 100}`
          : "Перевірено";
    } else if (isManualDone) {
      statusText = "Відмічено вручну";
    } else {
      statusText = "Здано";
    }
  } else if (isUnknown) {
    statusText = "Статус невідомий";
    badgeTone = "normal";
  } else if (!statusText) {
    statusText = fullItem.deadline.formattedDate
      ? `до ${fullItem.deadline.formattedDate}`
      : "Без терміну здачі";
  }

  const rawSummary = brief.summary.trim();
  const { leadSummary: splitLead, extendedParagraphs } = splitLongSummary(
    rawSummary,
    brief.steps,
    brief.deliverable
  );

  const fallbackLead = brief.deliverable
    ? brief.deliverable
    : `Завдання з дисципліни «${fullItem.subject}»${
        fullItem.teacher ? ` (${fullItem.teacher})` : ""
      }. Повна умова та матеріали доступні у картці курсу в Google Classroom.`;

  const leadSummary = splitLead || fallbackLead;
  const hasExpandableDescription = extendedParagraphs.length > 0;

  return {
    key: getNavigatorTaskKey(fullItem),
    id: fullItem.id,
    title,
    subject: fullItem.subject,
    teacher: fullItem.teacher ?? null,
    url: fullItem.url,
    statusText,
    badgeTone,
    state,
    isDone,
    isManualDone,
    isOverdue,
    assignedGrade,
    maxPoints,
    weightLabel: weightBadge?.label ?? null,
    estimatedMinutes: brief.estimatedMinutes,
    workFormatLabel: formatWorkFormatLabel(brief.workFormat),
    isAiBrief: brief.source === "gemini",
    chipLabel: formatBriefChipLabel(brief),
    leadSummary,
    extendedParagraphs,
    deliverable: brief.deliverable,
    hasExpandableDescription,
    materials: brief.materials,
    deadline: fullItem.deadline,
  };
}

export function buildNeutralSampleTask(
  week?: ScheduleResponse[],
  groupName?: string | null
): FullTaskItem {
  let subject = "Комп'ютерна схемотехніка та мікропроцесорні системи";
  let teacher: string | null = "Викладач кафедри";

  if (Array.isArray(week)) {
    for (const day of week) {
      const candidate = (day.lessons || []).find(
        (lesson) => !lesson.is_cancelled && Boolean(lesson.subject_name)
      );
      if (candidate) {
        subject = candidate.subject_name;
        teacher = candidate.teacher_name || teacher;
        break;
      }
    }
  }

  const refDate = new Date(Date.now() + 3 * 86_400_000);
  const dd = String(refDate.getDate()).padStart(2, "0");
  const mm = String(refDate.getMonth() + 1).padStart(2, "0");
  const dueLabel = `до ${dd}.${mm}`;
  const deadline = parseTaskDeadline(dueLabel);
  const dueDateIso = `${refDate.getFullYear()}-${mm}-${dd}`;
  const groupSuffix = groupName ? ` для групи ${groupName}` : "";

  const longSummary = [
    `Виконайте розрахунково-графічну частину лабораторної роботи${groupSuffix}: проаналізуйте принципову схему вузла за вашим варіантом, визначте робочі режими елементів та підготуйте покрокову таблицю параметрів.`,
    `На першому етапі зніміть часові діаграми сигналів у середовищі моделювання для номінальної та підвищеної частоти тактування. Порівняйте отриману затримку поширення сигналу з паспортними значеннями обраної серії мікросхем та зафіксуйте розбіжності у примітках.`,
    `На другому етапі побудуйте графіки залежності вихідної напруги й споживаної потужності від опору навантаження. Обов'язково підпишіть осі координат, одиниці вимірювання та контрольні точки на осцилограмах, щоб результати можна було перевірити без запуску проєкту.`,
    `У фінальному розділі сформулюйте короткі висновки про стійкість роботи схеми при зміні напруги живлення на ±10% та дайте відповіді на три контрольні питання з методичних вказівок. Готовий документ збережіть із назвою у форматі Прізвище_Варіант_ЛР.pdf.`,
  ].join("\n\n");

  return {
    id: "sample-task-preview",
    title: "Лабораторна робота: аналіз цифрового вузла та часові діаграми",
    subject,
    teacher,
    label: dueLabel,
    url: "https://classroom.google.com/",
    deadline,
    state: "NEW",
    maxPoints: 12,
    dueDateIso,
    brief: {
      summary: longSummary,
      deliverable: "Звіт у PDF зі схемами, осцилограмами та таблицею вимірювань",
      steps: [
        "Визначити вихідні дані згідно з номером варіанта у таблиці.",
        "Провести моделювання та зберегти 2–3 контрольні осцилограми.",
        "Оформити звіт за шаблоном і прикріпити файл у Google Classroom.",
      ],
      materials: [
        {
          title: "Методичні вказівки до виконання лабораторної роботи.pdf",
          url: "https://classroom.google.com/",
          kind: "pdf",
        },
        {
          title: "Таблиця вихідних даних за варіантами.xlsx",
          url: "https://classroom.google.com/",
          kind: "sheet",
        },
        {
          title: "Шаблон оформлення звіту та контрольні питання.docx",
          url: "https://classroom.google.com/",
          kind: "doc",
        },
      ],
      estimatedMinutes: 45,
      workFormat: "pc",
      source: "heuristic",
    },
  };
}
