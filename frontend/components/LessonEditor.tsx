"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { api, DirectoryItem, Lesson, LessonMutation, WeekType } from "../lib/api";

import { ReferenceRecord } from "../lib/api";
import { SearchableSelect } from "./SearchableSelect";

type Props = {
  lesson?: Lesson;
  date: string;
  scheduleMode: "student" | "teacher";
  defaultGroupId: number | null;
  defaultTeacherId: number | null;
  groups: ReferenceRecord[];
  initialWeekType?: WeekType;
  onSave: (payload: LessonMutation) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
};

const LESSON_TIME_LABELS: Record<number, string> = {
  1: "1 пара · 9:00–10:20",
  2: "2 пара · 10:40–12:00",
  3: "3 пара · 12:30–13:50",
  4: "4 пара · 14:00–15:20",
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
    subject_id: lesson?.subject_id,
    teacher_id: lesson?.teacher_id ?? (scheduleMode === "teacher" ? defaultTeacherId : null),
    second_teacher_id: lesson?.second_teacher_id ?? null,
    week_type: lesson?.week_type ?? initialWeekType,
  };
}

export function LessonEditor({ lesson, date, scheduleMode, defaultGroupId, defaultTeacherId, groups, initialWeekType = "both", onSave, onDelete, onClose }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
     setTimeout(() => dialogRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
  }, []);
  const [form, setForm] = useState(() => initial(lesson, date, scheduleMode, defaultGroupId, defaultTeacherId, initialWeekType));
  const [subjects, setSubjects] = useState<DirectoryItem[]>([]);
  const [teachers, setTeachers] = useState<DirectoryItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [loadingDirectories, setLoadingDirectories] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([api.directory.subjects(), api.directory.teachers()])
      .then(([subjectItems, teacherItems]) => {
        if (!active) return;
        setSubjects(subjectItems);
        setTeachers(teacherItems);
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : "Не вдалося завантажити довідники");
      })
      .finally(() => { if (active) setLoadingDirectories(false); });
    return () => { active = false; };
  }, []);

  function update<K extends keyof LessonMutation>(key: K, value: LessonMutation[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!form.subject_id) {
      setError("Оберіть предмет із довідника.");
      return;
    }
    if (form.second_teacher_id && form.second_teacher_id === form.teacher_id) {
      setError("Другий викладач має відрізнятися від основного.");
      return;
    }
    setBusy(true);
    setError(null);
    try {

      if (!form.group_id) {
        setError("Оберіть групу.");
        return;
      }
      await onSave({ ...form, date });
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не вдалося зберегти");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!onDelete || !window.confirm("Видалити це заняття?")) return;
    setBusy(true);
    setError(null);
    try { await onDelete(); onClose(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Не вдалося видалити"); }
    finally { setBusy(false); }
  }

  return (
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={lesson ? "Редагувати заняття" : "Додати заняття"} className="fixed inset-x-0 bottom-0 z-40 max-h-[90vh] overflow-y-auto rounded-t-2xl border border-sys-border bg-sys-card p-5 shadow-2xl md:static md:mt-3 md:rounded-xl md:border-sys-border">
      <div className="mx-auto max-w-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div><h3 className="font-semibold">{lesson ? "Редагувати заняття" : "Нове заняття"}</h3><p className="text-xs text-sys-text-secondary">Час пари фіксований і визначається номером пари.</p></div>
          <button type="button" onClick={onClose} aria-label="Закрити" className="text-xl text-sys-text-secondary">×</button>
        </div>
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
          <label className="sm:col-span-2">Предмет
            <SearchableSelect
              options={subjects}
              value={form.subject_id ?? null}
              onChange={(id) => update("subject_id", id ?? undefined)}
              disabled={loadingDirectories}
              placeholder={loadingDirectories ? "Завантаження…" : "Пошук предмета..."}
            />
          </label>
          <label>День
            <select value={form.day_of_week ?? dayFromDate(date)} onChange={(e) => update("day_of_week", Number(e.target.value))}>
              {DAY_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label>№ пари
            <select required value={form.lesson_number} onChange={(e) => update("lesson_number", Number(e.target.value))}>
              {Object.entries(LESSON_TIME_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label>Тиждень<select value={form.week_type} onChange={(e) => update("week_type", e.target.value as WeekType)}><option value="both">Щотижня</option><option value="numerator">Чисельник</option><option value="denominator">Знаменник</option></select></label>
          {scheduleMode === "teacher" && (
            <label>Група
              <SearchableSelect
                options={groups}
                value={form.group_id || null}
                onChange={(id) => update("group_id", id ?? 0)}
                placeholder="Пошук групи..."
              />
            </label>
          )}
          <label>Викладач
            <SearchableSelect
              options={teachers}
              value={form.teacher_id}
              onChange={(id) => update("teacher_id", id)}
              disabled={loadingDirectories}
              placeholder="Пошук викладача..."
            />
          </label>
          <label>Другий викладач (опційно)
            <SearchableSelect
              options={teachers}
              value={form.second_teacher_id}
              onChange={(id) => update("second_teacher_id", id)}
              disabled={loadingDirectories}
              placeholder="Немає"
            />
          </label>
          {error && <p role="alert" className="sm:col-span-2 text-sm text-rose-300">{error}</p>}
          <div className="flex gap-2 sm:col-span-2">
            <button disabled={busy || loadingDirectories} className="rounded-lg bg-sys-accent px-4 py-2 font-semibold text-slate-950">{busy ? "Збереження…" : "Зберегти"}</button>
            {lesson && onDelete && <button type="button" disabled={busy} onClick={remove} className="rounded-lg border border-rose-400/50 px-4 py-2 text-rose-300">Видалити</button>}
            <button type="button" onClick={onClose} className="ml-auto rounded-lg border border-sys-border px-4 py-2 text-sys-text-primary">Скасувати</button>
          </div>
        </form>
      </div>
    </div>
  );
}