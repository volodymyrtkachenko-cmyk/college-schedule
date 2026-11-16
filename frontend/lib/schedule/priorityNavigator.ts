import { extractClassroomTaskKey } from "../classroomTaskFilter";

export type WorkFormat = "phone" | "pc" | "theory";

export type TaskMaterialKind = "pdf" | "doc" | "sheet" | "slide" | "form" | "video" | "link" | "file";

export interface TaskMaterialItem {
  title: string;
  url: string | null;
  kind: TaskMaterialKind;
}

export interface TaskBrief {
  summary: string;
  deliverable: string | null;
  steps: string[];
  materials: TaskMaterialItem[];
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

const VALID_FORMATS = new Set<WorkFormat>(["phone", "pc", "theory"]);
const VALID_MATERIAL_KINDS = new Set<TaskMaterialKind>([
  "pdf",
  "doc",
  "sheet",
  "slide",
  "form",
  "video",
  "link",
  "file",
]);

const PHONE_TITLE_RE = /(тест|опитуван|вікторин|форм|quiz|kahoot)/i;
const THEORY_TITLE_RE = /(конспект|лекці|параграф|теорі|читан|вивчи|опрацюва)/i;

const SAFE_HTTP_URL_RE = /^https?:\/\/[^\s"'<>/?#]+(?::\d+)?(?:[/?#][^\s"'<>]*)?$/i;

function sanitizeHttpUrl(rawUrl: unknown): string | null {
  if (typeof rawUrl !== "string") return null;
  const trimmed = rawUrl.trim();
  if (!trimmed || !SAFE_HTTP_URL_RE.test(trimmed)) return null;
  if (typeof URL === "function") {
    try {
      const parsed = new URL(trimmed);
      if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || !parsed.hostname) {
        return null;
      }
    } catch {
      return null;
    }
  }
  return trimmed;
}

function inferMaterialKind(rawKind: unknown, title: string, url: string | null): TaskMaterialKind {
  const candidate = typeof rawKind === "string" ? rawKind.trim().toLowerCase() : "";
  if (VALID_MATERIAL_KINDS.has(candidate as TaskMaterialKind)) {
    return candidate as TaskMaterialKind;
  }
  const probe = `${title} ${url || ""}`.toLowerCase();
  if (probe.includes(".pdf") || probe.includes("/pdf")) return "pdf";
  if (probe.includes("docs.google.com/forms") || probe.includes("forms.gle")) return "form";
  if (probe.includes("youtube.com") || probe.includes("youtu.be") || /\.(mp4|mov|webm|mkv)(\?|$)/i.test(probe)) return "video";
  if (probe.includes("docs.google.com/spreadsheets") || /\.(xlsx?|csv|ods)(\?|$)/i.test(probe)) return "sheet";
  if (probe.includes("docs.google.com/presentation") || /\.(pptx?|odp)(\?|$)/i.test(probe)) return "slide";
  if (probe.includes("docs.google.com/document") || /\.(docx?|rtf|txt|odt)(\?|$)/i.test(probe)) return "doc";
  if (url) return "link";
  return "file";
}

function normalizeMaterialEntry(raw: unknown): TaskMaterialItem | null {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const directUrl = sanitizeHttpUrl(trimmed);
    if (directUrl) {
      return {
        title: "Прикріплений матеріал",
        url: directUrl,
        kind: inferMaterialKind(null, "", directUrl),
      };
    }
    let cleanTitle = trimmed;
    let hintedKind: TaskMaterialKind | null = null;
    const prefixMatch = trimmed.match(/^(Файл|Відео|Форма|Посилання):\s*(.+)$/i);
    if (prefixMatch) {
      const prefix = prefixMatch[1].toLowerCase();
      cleanTitle = prefixMatch[2].trim();
      if (prefix === "відео") hintedKind = "video";
      else if (prefix === "форма") hintedKind = "form";
      else if (prefix === "посилання") hintedKind = "link";
      else hintedKind = "file";
    }
    if (!cleanTitle) return null;
    const inferred = inferMaterialKind(null, cleanTitle, null);
    const kind = hintedKind && inferred === "file" ? hintedKind : inferred !== "file" ? inferred : hintedKind || "file";
    return {
      title: cleanTitle,
      url: null,
      kind,
    };
  }

  if (raw && typeof raw === "object") {
    const item = raw as Record<string, unknown>;
    const url = sanitizeHttpUrl(item.url);
    const rawTitle = typeof item.title === "string" ? item.title.trim() : "";
    const title = rawTitle || (url ? "Прикріплений матеріал" : "");
    if (!title) return null;
    return {
      title,
      url,
      kind: inferMaterialKind(item.kind, title, url),
    };
  }

  return null;
}

export function formatMaterialKindLabel(kind: TaskMaterialKind): string {
  switch (kind) {
    case "pdf":
      return "PDF";
    case "doc":
      return "Док";
    case "sheet":
      return "Таблиця";
    case "slide":
      return "Слайди";
    case "form":
      return "Форма";
    case "video":
      return "Відео";
    case "link":
      return "Лінк";
    default:
      return "Файл";
  }
}

export function formatMaterialCount(count: number): string {
  const abs = Math.abs(count);
  const mod100 = abs % 100;
  const mod10 = abs % 10;
  if (mod10 === 1 && mod100 !== 11) return `${count} файл`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} файли`;
  return `${count} файлів`;
}

export function getNavigatorTaskKey(task: Pick<NavigatorTaskInput, "url" | "id" | "title">): string {
  const fromUrl = task.url ? extractClassroomTaskKey(task.url) || task.url.trim() : "";
  return fromUrl || task.id || task.title;
}

export function normalizeTaskBrief(raw: unknown): TaskBrief | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const summary = typeof obj.summary === "string" ? obj.summary.trim() : "";
  const rawDeliverable = typeof obj.deliverable === "string" ? obj.deliverable.trim() : "";
  const deliverable = rawDeliverable.length > 0 ? rawDeliverable : null;

  const rawSteps = Array.isArray(obj.steps) ? obj.steps : [];
  const steps = rawSteps
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter(Boolean)
    .slice(0, 4);

  const rawMats = Array.isArray(obj.materials) ? obj.materials : [];
  const materials: TaskMaterialItem[] = [];
  const seenKeys = new Set<string>();
  for (const rawMat of rawMats) {
    const normalized = normalizeMaterialEntry(rawMat);
    if (!normalized) continue;
    const dedupeKey = (normalized.url || normalized.title).toLowerCase();
    if (seenKeys.has(dedupeKey)) continue;
    seenKeys.add(dedupeKey);
    materials.push(normalized);
    if (materials.length >= 6) break;
  }

  if (!summary && !deliverable && steps.length === 0 && materials.length === 0 && obj.source !== "gemini") {
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
    deliverable,
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
    deliverable: null,
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
    (brief.deliverable && brief.deliverable.trim()) ||
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
  if (brief.materials.length > 0) {
    parts.push(formatMaterialCount(brief.materials.length));
  } else if (brief.estimatedMinutes) {
    parts.push(formatWorkFormatLabel(brief.workFormat));
  } else if (brief.source === "gemini") {
    parts.push("Міні-бриф");
  }
  return parts.length > 0 ? parts.join(" · ") : "Міні-бриф";
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
