"use client";
import { FormEvent, useEffect, useRef, useState, useMemo } from "react";
import { api, DirectoryItem, Lesson, LessonMutation, ScheduleResponse, WeekType } from "../lib/api";
import { ReferenceRecord } from "../lib/api";
import { SearchableSelect } from "./SearchableSelect";
import { SearchableTextInput } from "./SearchableTextInput";
type Props = {
  lesson?: Lesson;
  date: string;
  scheduleMode: "student" | "teacher";
  defaultGroupId: number | null;
  defaultTeacherId: number | null;
  groups: ReferenceRecord[];
  initialWeekType?: WeekType;
  availabilityWeek?: ScheduleResponse[] | null;
  onSave: (payload: LessonMutation) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
  isOneOff?: boolean;
  weekRangeText?: string;
  isTemplate?: boolean;
};
const LESSON_TIME_LABELS: Record<number, string> = {
  1: "1 пара · 9:00–10:20",
  2: "2 пара · 10:40–12:00",
  3: "3 пара · 12:30–13:50",
  4: "4 пара · 14:00–15:20",
  5: "5 пара · 15:30–16:50",
};
const DAY_OPTIONS: [string, string][] = [
  ["1", "Понеділок"],
  ["2", "Вівторок"],
  ["3", "Середа"],
  ["4", "Четвер"],
  ["5", "П’ятниця"],
];
function dayFromDate(date: string) {
  const day = new Date(`${date}T12:00:00`).getDay() || 7;
  return day >= 1 && day <= 5 ? day : 1;
}
function initial(lesson: Lesson | undefined, date: string, scheduleMode: "student"|"teacher", defaultGroupId: number|null, defaultTeacherId: number|null, initialWeekType: WeekType = "both"): LessonMutation {
  return {
    group_id: lesson?.group_id ?? (scheduleMode === "student" ? (defaultGroupId ?? 0) : 0),
    date,
    day_of_week: lesson?.day_of_week ?? dayFromDate(date),
    lesson_number: lesson?.lesson_number ?? 1,
    is_replacement: lesson?.is_replacement ?? false,
    subject_id: lesson?.subject_id,
    teacher_id: lesson?.teacher_id ?? (scheduleMode === "teacher" ? defaultTeacherId : null),
    second_teacher_id: lesson?.second_teacher_id ?? null,
    week_type: lesson?.week_type ?? initialWeekType,
    room: lesson?.room_override ?? "",
  };
}
export function LessonEditor({
  lesson,
  date,
  scheduleMode,
  defaultGroupId,
  defaultTeacherId,
  groups,
  initialWeekType = "both",
  availabilityWeek,
  onSave,
  onDelete,
  onClose,
  isOneOff = false,
  weekRangeText = "",
  isTemplate = false,
}: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
     setTimeout(() => dialogRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
  }, []);
  const [form, setForm] = useState(() => initial(lesson, date, scheduleMode, defaultGroupId, defaultTeacherId, initialWeekType));
  const [subjects, setSubjects] = useState<DirectoryItem[]>([]);
  const [teacherSubjects, setTeacherSubjects] = useState<Record<number, number[]>>({});
  const [teachers, setTeachers] = useState<ReferenceRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [loadingDirectories, setLoadingDirectories] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    Promise.all([api.directory.subjects(), api.directory.teachers(), api.directory.teacherSubjects().catch(() => ({}))])
      .then(([subjectItems, teacherItems, tsMapping]) => {
        if (!active) return;
        setSubjects(subjectItems);
        setTeacherSubjects(tsMapping as Record<number, number[]>);
        setTeachers(teacherItems);
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : "Не вдалося завантажити довідники");
      })
      .finally(() => { if (active) setLoadingDirectories(false); });
    return () => { active = false; };
  }, []);

  const teacherRoom = useMemo(() => {
    if (!teachers) return "";
    const primary = teachers.find(t => t.id === form.teacher_id);
    const secondary = teachers.find(t => t.id === form.second_teacher_id);
    const rooms = [];
    if (primary && primary.room) rooms.push(primary.room);
    if (secondary && secondary.room) rooms.push(secondary.room);
    return rooms.length > 0 ? rooms.join(" / ") : "";
  }, [teachers, form.teacher_id, form.second_teacher_id]);

  const occupiedRoomsMap = useMemo(() => {
    const map = new Map<string, string>();
    if (!availabilityWeek) return map;
    const targetDay = form.day_of_week ?? dayFromDate(date);
    const targetLessonNum = form.lesson_number;
    const targetWeekType = form.week_type ?? "both";

    for (const day of availabilityWeek) {
      const dayNum = new Date(`${day.date}T12:00:00`).getDay() || 7;
      if (dayNum !== targetDay) continue;
      for (const l of day.lessons) {
        if (lesson && l.id === lesson.id) continue;
        if (l.lesson_number !== targetLessonNum) continue;
        const weekOverlap =
          targetWeekType === "both" || l.week_type === "both" || targetWeekType === l.week_type;
        if (!weekOverlap) continue;
        const r = (l.room_override || l.room || "").trim();
        if (r) map.set(r.toLowerCase(), l.group_name || l.subject_name || "зайнято");
      }
    }
    return map;
  }, [availabilityWeek, form.day_of_week, form.lesson_number, form.week_type, date, lesson]);

  const uniqueRooms = useMemo(() => {
    if (!teachers) return [];
    const baseRooms = Array.from(new Set(teachers.map((t) => t.room).filter(Boolean) as string[])).sort();
    return baseRooms.map((r) => {
      const busyBy = occupiedRoomsMap.get(r.trim().toLowerCase());
      return busyBy ? `${r} (⚠️ зайнято: ${busyBy})` : r;
    });
  }, [teachers, occupiedRoomsMap]);

  const currentRoom = (form.room ? form.room.trim() : "") || (teacherRoom ? teacherRoom.trim() : "");

  const roomConflictInfo = useMemo(() => {
    if (!availabilityWeek || !currentRoom) return null;
    const targetDay = form.day_of_week ?? dayFromDate(date);
    const targetLessonNum = form.lesson_number;
    const targetWeekType = form.week_type ?? "both";

    for (const day of availabilityWeek) {
      const dayNum = new Date(`${day.date}T12:00:00`).getDay() || 7;
      if (dayNum !== targetDay) continue;

      for (const l of day.lessons) {
        if (lesson && l.id === lesson.id) continue;
        if (l.lesson_number !== targetLessonNum) continue;

        const weekOverlap =
          targetWeekType === "both" ||
          l.week_type === "both" ||
          targetWeekType === l.week_type;

        if (!weekOverlap) continue;

        const lessonRoom = (l.room_override || l.room || "").trim();
        if (lessonRoom && lessonRoom.toLowerCase() === currentRoom.toLowerCase()) {
          const detail = l.group_name
            ? `${l.group_name} (${l.subject_name || l.teacher_name || ""})`
            : (l.subject_name || "Інше заняття");
          return detail;
        }
      }
    }
    return null;
  }, [availabilityWeek, currentRoom, form.day_of_week, form.lesson_number, form.week_type, date, lesson]);

  const sortedSubjects = useMemo(() => {
    if (!form.teacher_id || !teacherSubjects[form.teacher_id]) return subjects;
    const knownSubjectIds = new Set(teacherSubjects[form.teacher_id]);
    const known: DirectoryItem[] = [];
    const others: DirectoryItem[] = [];
    for (const sub of subjects) {
       if (knownSubjectIds.has(sub.id)) {
           known.push(sub);
       } else {
           others.push(sub);
       }
    }
    if (known.length === 0) return subjects;
    return [
       { id: -1, name: "── Часто обирають ──", disabled: true },
       ...known,
       { id: -2, name: "── Інші предмети ──", disabled: true },
       ...others
    ];
  }, [subjects, form.teacher_id, teacherSubjects]);
  function update<K extends keyof LessonMutation>(key: K, value: LessonMutation[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!form.subject_id) {
      setError("Оберіть предмет зі списку.");
      return;
    }
    if (form.second_teacher_id && form.second_teacher_id === form.teacher_id) {
      setError("Другий викладач має відрізнятися від основного.");
      return;
    }
    
    const payload = { ...form, date };
    if (payload.room !== undefined) {
      payload.room = payload.room ? payload.room.trim() : null;
      if (payload.room === "") payload.room = null;
    }

    setBusy(true);
    setError(null);
    try {
      if (!payload.group_id) {
        setError("Оберіть групу.");
        return;
      }
      await onSave(payload);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не вдалося зберегти");
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!onDelete || !window.confirm(`Видалити заняття «${lesson?.subject_name ?? ""}»?`)) return;
    setBusy(true);
    setError(null);
    try { await onDelete(); onClose(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Не вдалося видалити заняття."); }
    finally { setBusy(false); }
  }
  return (
    <>
      {/* Subtle Drawer Backdrop so week schedule on the left remains visible */}
      <div
        className="fixed inset-0 z-[120] bg-black/40 backdrop-blur-xs transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-over Drawer (420px width on desktop) */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={lesson ? "Редагувати заняття" : "Додати заняття"}
        className="fixed inset-y-0 right-0 z-[130] flex w-full sm:w-[420px] flex-col border-l border-sys-border bg-sys-card shadow-2xl animate-in slide-in-from-right duration-200"
      >
        {/* Sticky Header */}
        <div className="sticky top-0 z-10 border-b border-sys-border bg-sys-card px-5 py-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-sys-text-primary tracking-tight">
              {lesson ? "Редагування заняття" : "Нове заняття"}
            </h3>
            <button
              type="button"
              onClick={onClose}
              aria-label="Закрити панель"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-sys-text-secondary hover:text-white hover:bg-sys-bg transition-colors"
            >
              ✕
            </button>
          </div>

          {/* Warning Banner: One-off substitution */}
          {isOneOff && weekRangeText && (
            <div className="mt-2.5 flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-300">
              <span className="text-sm shrink-0">⚠️</span>
              <span className="truncate">Разова зміна — лише {weekRangeText}</span>
            </div>
          )}
        </div>

        {/* Scrollable Form Body */}
        <form id="lesson-editor-form" onSubmit={submit} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {scheduleMode === "teacher" && (
            <label className="form-label">
              <span>Група</span>
              <SearchableSelect
                options={groups}
                value={form.group_id || null}
                onChange={(id) => update("group_id", id ?? 0)}
                placeholder="Знайти групу"
              />
            </label>
          )}

          {/* 1. Subject (Full width) */}
          <label className="form-label">
            <span>Предмет</span>
            <SearchableSelect
              options={sortedSubjects}
              value={form.subject_id ?? null}
              onChange={(id) => {
                update("subject_id", id ?? undefined);
                if (id && !form.teacher_id) {
                  const matchingTeachers = Object.entries(teacherSubjects)
                    .filter(([, subjIds]) => subjIds.includes(id))
                    .map(([tId]) => Number(tId));
                  if (matchingTeachers.length === 1) {
                    update("teacher_id", matchingTeachers[0]);
                  }
                }
              }}
              disabled={loadingDirectories}
              placeholder={loadingDirectories ? "Завантаження…" : "Знайти предмет"}
            />
          </label>

          {/* 2. Teachers (2 columns) */}
          <div className="grid grid-cols-2 gap-3">
            <label className="form-label">
              <span>Викладач</span>
              <SearchableSelect
                options={teachers}
                value={form.teacher_id}
                onChange={(id) => update("teacher_id", id)}
                disabled={loadingDirectories}
                placeholder="Викладач"
              />
            </label>
            <label className="form-label">
              <span>2-й викладач</span>
              <SearchableSelect
                options={teachers}
                value={form.second_teacher_id}
                onChange={(id) => update("second_teacher_id", id)}
                disabled={loadingDirectories}
                placeholder="Немає"
              />
            </label>
          </div>

          {/* 3. Day & Pair (2 columns) */}
          <div className="grid grid-cols-2 gap-3">
            <label className="form-label">
              <span>День</span>
              <select
                className="form-control"
                value={form.day_of_week ?? dayFromDate(date)}
                onChange={(e) => update("day_of_week", Number(e.target.value))}
              >
                {DAY_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label className="form-label">
              <span>Номер пари</span>
              <select
                className="form-control"
                required
                value={form.lesson_number}
                onChange={(e) => update("lesson_number", Number(e.target.value))}
              >
                {Object.entries(LESSON_TIME_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
          </div>

          {/* 4. Week Type (if permanent) */}
          {!isOneOff && (
            <label className="form-label">
              <span>Тип тижня</span>
              <select
                className="form-control"
                value={form.week_type}
                onChange={(e) => update("week_type", e.target.value as WeekType)}
              >
                <option value="both">Щотижня</option>
                <option value="numerator">Чисельник</option>
                <option value="denominator">Знаменник</option>
              </select>
            </label>
          )}

          {/* 5. Room & Conflict */}
          <label className="form-label">
            <span>Аудиторія</span>
            <SearchableTextInput
              options={uniqueRooms}
              value={form.room ?? ""}
              onChange={(val) => update("room", val.replace(/\s*\(⚠️.*?\)\s*$/, ""))}
              placeholder={teacherRoom ? `За замовчуванням: ${teacherRoom}` : "Введіть аудиторію"}
            />
            <p className="mt-1 text-xs text-sys-text-secondary">Якщо порожнє, використовується аудиторія викладача.</p>
            {roomConflictInfo && (
              <p className="mt-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-300">
                ⚠️ У цей час аудиторія зайнята: <strong>{roomConflictInfo}</strong>
              </p>
            )}
          </label>

          {scheduleMode === "student" && (
            <label className="flex items-center gap-2.5 cursor-pointer pt-1 !flex-row w-fit">
              <input
                type="checkbox"
                className="w-4 h-4 rounded border-sys-border bg-sys-input text-sys-accent focus:ring-sys-accent cursor-pointer"
                checked={form.is_replacement ?? false}
                onChange={(e) => update("is_replacement", e.target.checked)}
              />
              <span className="font-medium text-sm select-none text-sys-text-primary">Разова заміна</span>
            </label>
          )}

          {error && <p role="alert" className="text-sm text-rose-300 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3">{error}</p>}
        </form>

        {/* Sticky Action Footer */}
        <div className="sticky bottom-0 z-10 flex items-center justify-between gap-2.5 border-t border-sys-border bg-sys-card px-5 py-3.5">
          <div>
            {lesson && onDelete ? (
              <button
                type="button"
                disabled={busy}
                onClick={remove}
                className="h-10 rounded-xl border border-sys-border bg-sys-bg px-3.5 text-xs font-semibold text-sys-text-secondary hover:border-rose-500/40 hover:bg-rose-500/10 hover:text-rose-400 active:scale-[0.98] transition-colors disabled:opacity-50"
              >
                Видалити
              </button>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-10 rounded-xl border border-sys-border bg-sys-bg px-4 text-xs font-semibold text-sys-text-primary hover:border-sys-border-elevated active:scale-[0.98] transition-colors"
            >
              Скасувати
            </button>
            <button
              type="submit"
              form="lesson-editor-form"
              disabled={busy || loadingDirectories}
              className="h-10 rounded-xl bg-sys-accent px-5 text-xs font-bold text-white hover:opacity-90 active:scale-[0.98] transition-opacity disabled:opacity-50 shadow-sm"
            >
              {busy ? "Збереження…" : "Зберегти"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}