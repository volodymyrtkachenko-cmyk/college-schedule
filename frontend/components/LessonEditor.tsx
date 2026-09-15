"use client";

import { FormEvent, useEffect, useState } from "react";
import { api, DirectoryItem, Lesson, LessonMutation, WeekType } from "../lib/api";

type Props = {
  lesson?: Lesson;
  date: string;
  groupId: number;
  onSave: (payload: LessonMutation) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
};

function dayFromDate(date: string) {
  return new Date(`${date}T12:00:00`).getDay() || 7;
}

function initial(lesson: Lesson | undefined, date: string): LessonMutation {
  const [start_time = "08:00", end_time = "09:20"] = lesson?.time.split("-") ?? [];
  return {
    group_id: 0,
    date,
    day_of_week: lesson?.day_of_week ?? dayFromDate(date),
    lesson_number: lesson?.lesson_number ?? 1,
    start_time,
    end_time,
    subject_id: lesson?.subject_id,
    teacher_id: lesson?.teacher_id ?? null,
    room: lesson?.room_name ?? "",
    week_type: lesson?.week_type ?? "both",
  };
}

export function LessonEditor({ lesson, date, groupId, onSave, onDelete, onClose }: Props) {
  const [form, setForm] = useState(() => initial(lesson, date));
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
    setBusy(true);
    setError(null);
    try {
      await onSave({ ...form, group_id: groupId, date });
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
    <div role="dialog" aria-modal="true" aria-label={lesson ? "Редагувати заняття" : "Додати заняття"} className="fixed inset-x-0 bottom-0 z-40 max-h-[90vh] overflow-y-auto rounded-t-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl md:static md:mt-3 md:rounded-xl md:border-slate-800">
      <div className="mx-auto max-w-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div><h3 className="font-semibold">{lesson ? "Редагувати заняття" : "Нове заняття"}</h3><p className="text-xs text-slate-400">Час і день змінюються тут, у редакторі заняття.</p></div>
          <button type="button" onClick={onClose} aria-label="Закрити" className="text-xl text-slate-400">×</button>
        </div>
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
          <label className="sm:col-span-2">Предмет
            <select required disabled={loadingDirectories} value={form.subject_id ?? ""} onChange={(e) => update("subject_id", Number(e.target.value) || undefined)}>
              <option value="">{loadingDirectories ? "Завантаження…" : "Оберіть предмет"}</option>
              {subjects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label>День
            <select value={form.day_of_week ?? dayFromDate(date)} onChange={(e) => update("day_of_week", Number(e.target.value))}>
              {[["1", "Понеділок"], ["2", "Вівторок"], ["3", "Середа"], ["4", "Четвер"], ["5", "П’ятниця"], ["6", "Субота"], ["7", "Неділя"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label>№ заняття<input required type="number" min="1" value={form.lesson_number} onChange={(e) => update("lesson_number", Number(e.target.value))} /></label>
          <label>Початок<input required type="time" value={form.start_time} onChange={(e) => update("start_time", e.target.value)} /></label>
          <label>Кінець<input required type="time" value={form.end_time} onChange={(e) => update("end_time", e.target.value)} /></label>
          <label>Тиждень<select value={form.week_type} onChange={(e) => update("week_type", e.target.value as WeekType)}><option value="both">Щотижня</option><option value="numerator">Чисельник</option><option value="denominator">Знаменник</option></select></label>
          <label>Викладач
            <select disabled={loadingDirectories} value={form.teacher_id ?? ""} onChange={(e) => update("teacher_id", Number(e.target.value) || null)}>
              <option value="">Без викладача</option>
              {teachers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label>Аудиторія<input value={form.room ?? ""} onChange={(e) => update("room", e.target.value)} placeholder="Введіть вручну" /></label>
          {error && <p role="alert" className="sm:col-span-2 text-sm text-rose-300">{error}</p>}
          <div className="flex gap-2 sm:col-span-2">
            <button disabled={busy || loadingDirectories} className="rounded-lg bg-cyan-400 px-4 py-2 font-semibold text-slate-950">{busy ? "Збереження…" : "Зберегти"}</button>
            {lesson && onDelete && <button type="button" disabled={busy} onClick={remove} className="rounded-lg border border-rose-400/50 px-4 py-2 text-rose-300">Видалити</button>}
            <button type="button" onClick={onClose} className="ml-auto rounded-lg border border-slate-700 px-4 py-2 text-slate-300">Скасувати</button>
          </div>
        </form>
      </div>
    </div>
  );
}
