import { ClassroomTaskItem, parseTaskDeadline } from "./taskDeadlines";

let _taskMetaMapCache: Map<string, { title?: string; teacher?: string }> | null = null;
let _taskMetaCacheListenerRegistered = false;
const _classroomTasksCache = new Map<string, ClassroomTaskItem[]>();
const MAX_CLASSROOM_TASKS_CACHE = 250;

function ensureTaskMetaCacheListener() {
  if (_taskMetaCacheListenerRegistered || typeof window === "undefined") return;
  _taskMetaCacheListenerRegistered = true;
  const invalidate = () => {
    _taskMetaMapCache = null;
    _classroomTasksCache.clear();
  };
  window.addEventListener("classroom-synced", invalidate);
  window.addEventListener("storage", invalidate);
}

function findFullTaskMetaByUrl(url: string): { title?: string; teacher?: string } | null {
  if (typeof window === "undefined" || !url) return null;
  ensureTaskMetaCacheListener();
  if (!_taskMetaMapCache) {
    const map = new Map<string, { title?: string; teacher?: string }>();
    try {
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (
          !k ||
          (!k.startsWith("schedule:classroom_tasks:") && !k.startsWith("schedule:classroom_group_tasks:"))
        ) {
          continue;
        }
        const raw = window.localStorage.getItem(k);
        if (!raw) continue;
        const list = JSON.parse(raw);
        if (!Array.isArray(list)) continue;
        for (const t of list) {
          const itemUrl = t?.url || t?.alternate_link;
          if (typeof itemUrl === "string" && itemUrl) {
            map.set(itemUrl, {
              title: typeof t.title === "string" ? t.title.replace(/\s+/g, " ").trim() : undefined,
              teacher: typeof t.teacher === "string" ? t.teacher.trim() : undefined,
            });
          }
        }
      }
    } catch {}
    _taskMetaMapCache = map;
  }
  return _taskMetaMapCache.get(url) ?? null;
}

export function extractClassroomTasks(note?: string | null): ClassroomTaskItem[] {
  if (!note) return [];
  ensureTaskMetaCacheListener();
  const cached = _classroomTasksCache.get(note);
  if (cached) return cached;

  const rawLines = note.split("\n");
  const normalizedLines: string[] = [];

  for (let i = 0; i < rawLines.length; i++) {
    const cur = rawLines[i].trim();
    if (!cur) continue;
    if (cur.startsWith("[TASK]") && !cur.includes("|") && i + 1 < rawLines.length) {
      const next = rawLines[i + 1].trim();
      if (next.includes("|") && /https?:\/\//i.test(next)) {
        normalizedLines.push(`${cur} ${next}`);
        i++;
        continue;
      }
    }
    normalizedLines.push(cur);
  }

  const tasks: ClassroomTaskItem[] = [];
  for (const line of normalizedLines) {
    const isTaskLine =
      line.startsWith("[TASK]") ||
      (/\|\s*https?:\/\/classroom\.google\.com\//i.test(line));
    if (isTaskLine) {
      const raw = line.replace(/^\[TASK\]\s*/i, "").trim();
      const parts = raw.split("|").map((p) => p.trim()).filter(Boolean);
      if (parts.length < 2) continue;
      const leftPart = parts[0];
      const urlPart = parts.find((p, idx) => idx > 0 && /^https?:\/\//i.test(p)) || parts[1];
      if (!leftPart || !urlPart || !urlPart.startsWith("http")) continue;

      let teacher: string | null = null;
      let rest = leftPart;

      const badgeMatch = leftPart.match(/^\[([^\]]+)\]\s*(.*)$/);
      if (badgeMatch) {
        teacher = badgeMatch[1].trim();
        rest = badgeMatch[2].trim();
      }

      // Приводимо до стандарту "до DD.MM" або ""
      const dueMatch = rest.match(/\(до\s+\d{1,2}\.\d{1,2}\)/i);
      const label = dueMatch ? dueMatch[0].replace(/[()]/g, "").trim() : "";
      let title = rest.replace(/\(до\s+\d{1,2}\.\d{1,2}\)/i, "").trim() || "Завдання";

      // Якщо в рядку немає викладача або рядок був розірваний (без префікса [TASK]), відновлюємо з метаданих
      if (!teacher || !line.startsWith("[TASK]")) {
        const meta = findFullTaskMetaByUrl(urlPart);
        if (!line.startsWith("[TASK]") && meta?.title) title = meta.title;
        if (!teacher && meta?.teacher) {
          teacher = meta.teacher.replace(/^\[|\]$/g, "").trim();
        }
      }

      const deadline = parseTaskDeadline(label);
      tasks.push({ title, teacher, label, url: urlPart, deadline });
    }
  }

  if (_classroomTasksCache.size >= MAX_CLASSROOM_TASKS_CACHE) {
    _classroomTasksCache.clear();
  }
  _classroomTasksCache.set(note, tasks);

  return tasks;
}

export function getVisibleUserNote(note?: string | null): string {
  if (!note) return "";
  return note
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("[TASK")) return "";
      if (trimmed.includes("🔒") || trimmed.includes("[🔒")) return "";
      if (/https?:\/\/classroom\.google\.com\//i.test(trimmed)) return "";
      // ВАЖЛИВО: без \b перед кирилицею, бо в JS \b працює лише для латиниці!
      const cleaned = line
        .replace(/\[🔒[^\]]*\]/gi, "")
        .replace(/https?:\/\/(?:meet\.google\.com|[a-z0-9.-]*zoom\.us)\/[^\s|]+/gi, "")
        .replace(/(?:Ідентифікатор(?:\s+конференції)?|Meeting\s*ID|ID)\s*[:\-]?\s*[\d\s\-]+/gi, "")
        .replace(/(?:Код(?:\s+доступ[уа])?|Passcode|Пароль)\s*[:\-]?\s*[A-Za-zА-Яа-яІіЇїЄєҐґ0-9_.\-]+/gi, "")
        .replace(/^(?:Токарєв[а-яА-ЯіїєґІЇЄҐ.]*|Хочинськ[а-яА-ЯіїєґІЇЄҐ.]*|Токарев[а-яА-Я.]*|Хочинск[а-яА-Я.]*|[1-9]\s*підгрупа|підгрупа\s*[1-9]|викладач)\s*[:\-]?\s*$/gi, "")
        .replace(/^(?:Zoom|Meet|Google Meet|Підключитися|Приєднатися|Конференція)(?:\s+Zoom|\s+Meet)?\s*[:\-]?$/gi, "")
        .replace(/^[-—_|~*=]{1,5}$/g, "")
        .replace(/\|/g, " ")
        .trim();
      if (cleaned.includes("🔒")) return "";
      return cleaned;
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}
