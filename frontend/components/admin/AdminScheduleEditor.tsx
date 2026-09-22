"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { ScheduleWeekGrid } from "../ScheduleWeekGrid";
import { WeekTypeBadge } from "../WeekTypeBadge";
import { LessonEditor } from "../LessonEditor";
import { Lesson, LessonMutation, api } from "../../lib/api";
import { useSchedule } from "../../lib/hooks";
import { getMondayOf } from "../../lib/date";
import { SearchableSelect } from "../SearchableSelect";

export function AdminScheduleEditor() {
  const [weekAnchorDate, setWeekAnchorDate] = useState(() => {
    const date = new Date();
    const day = date.getDay();
    if (day === 0 || day === 6) {
        date.setDate(date.getDate() + (day === 0 ? 1 : 2));
    }
    return getMondayOf(date);
  });

  const isCurrentWeek = useMemo(() => {
    const todayAnchor = getMondayOf(new Date());
    return Math.abs(weekAnchorDate.getTime() - todayAnchor.getTime()) < 1000 * 60 * 60 * 24;
  }, [weekAnchorDate]);

  const { mode, toggleMode, teachers, teacherId, setTeacherId, groups, groupId, setGroupId, today, week, loading, error, setToday, setWeek, updateLesson, removeLesson, addLesson } = useSchedule(weekAnchorDate);
  const [isPending, startTransition] = useTransition();
  const [editor, setEditor] = useState<{ lesson?: Lesson; date: string } | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const weekType = (week?.[0]?.week_type) ?? today?.week_type ?? "both";

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const weekRange = useMemo(() => {
    const end = new Date(weekAnchorDate);
    end.setDate(end.getDate() + 6);
    return `${new Intl.DateTimeFormat("uk-UA", { day: "numeric", month: "long" }).format(weekAnchorDate)} – ${new Intl.DateTimeFormat("uk-UA", { day: "numeric", month: "long", year: "numeric" }).format(end)}`;
  }, [weekAnchorDate]);

  const resetWeek = () => setWeekAnchorDate(getMondayOf(new Date()));
  const LESSON_TIMES: Record<number, string> = { 1: "09:00-10:20", 2: "10:40-12:00", 3: "12:30-13:50", 4: "14:00-15:20" };

  const edit = async (lesson: Lesson, date: string, payload: LessonMutation) => {
    const previousToday = today, previousWeek = week;
    const time = LESSON_TIMES[payload.lesson_number];
    if (!time) throw new Error(`Невідомий номер пари: ${payload.lesson_number}`);
    updateLesson({ ...lesson, lesson_number: payload.lesson_number, time, week_type: payload.week_type });
    try { 
        const saved = await api.lessons.update(lesson.id, payload); 
        updateLesson(saved); 
        setToast({ message: "Заняття збережено.", type: "success" }); 
    } catch (e) { 
        setToday(previousToday); setWeek(previousWeek); 
        throw e; 
    }
  };
  
  const create = async (payload: LessonMutation) => {
    try {
      const created = await api.lessons.create(payload);
      addLesson(payload.date ?? new Date().toISOString().slice(0, 10), created);
      setToast({ message: "Заняття додано.", type: "success" });
    } catch (e) {
      throw e;
    }
  };
  
  const remove = async (lesson: Lesson) => {
    const previousToday = today, previousWeek = week; removeLesson(lesson.id);
    try { await api.lessons.remove(lesson.id); setToast({ message: "Заняття видалено.", type: "success" }); }
    catch (e) { 
        setToday(previousToday); setWeek(previousWeek); 
        setToast({ message: e instanceof Error ? e.message : "Помилка видалення", type: "error" });
        throw e; 
    }
  };
  
  const saveNote = async (lesson: Lesson, note: string, date: string) => {
    try {
      const saved = lesson.note_id
        ? await api.notes.update(lesson.note_id, { note })
        : await api.notes.create({ schedule_id: lesson.id, note_date: date, note });
      updateLesson({ ...lesson, note: saved.note, note_id: saved.id, note_date: saved.note_date });
      setToast({ message: "Примітку збережено.", type: "success" });
    } catch (e) {
      throw e;
    }
  };
  
  const deleteNote = async (lesson: Lesson, date: string) => {
    try {
      if (lesson.note_id) await api.notes.remove(lesson.note_id);
      updateLesson({ ...lesson, note: null, note_id: null, note_date: date });
      setToast({ message: "Примітку видалено.", type: "success" });
    } catch(e) {
      setToast({ message: e instanceof Error ? e.message : "Не вдалося видалити.", type: "error" });
      throw e;
    }
  };

  return (
    <div className="w-full">
      <div className="mb-4 flex flex-col sm:flex-row sm:flex-wrap sm:items-center justify-between gap-4">
        {/* Filters Panel */}
        <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3 w-full lg:w-auto">
          {teachers.length > 0 && (
          <div role="tablist" aria-label="Режим перегляду" className="flex w-full sm:w-auto rounded-lg border border-sys-border bg-sys-card p-1 text-sm relative">
            <div className="absolute top-1 bottom-1 w-[calc(50%-4px)] bg-sys-accent rounded-md shadow-sm transition-all duration-300 ease-out z-0" style={{ left: mode === 'student' ? '4px' : '50%' }}></div>
            <button role="tab" aria-selected={mode === 'student'} type="button" onClick={() => startTransition(() => toggleMode('student'))} className={`relative z-10 flex-1 sm:flex-none sm:w-28 text-center rounded-md px-3 py-2 sm:py-1.5 transition-colors ${mode === 'student' ? 'text-[#0b1120] font-medium' : 'text-sys-text-secondary hover:text-sys-text-primary'}`}>Група</button>
            <button role="tab" aria-selected={mode === 'teacher'} type="button" onClick={() => startTransition(() => toggleMode('teacher'))} className={`relative z-10 flex-1 sm:flex-none sm:w-28 text-center rounded-md px-3 py-2 sm:py-1.5 transition-colors ${mode === 'teacher' ? 'text-[#0b1120] font-medium' : 'text-sys-text-secondary hover:text-sys-text-primary'}`}>Викладач</button>
          </div>
          )}
          {mode === 'student' && groups.length > 0 && (
            <div className="w-full sm:w-64 text-sys-text-primary">
              <SearchableSelect
                 value={groupId ?? null}
                 onChange={(val) => startTransition(() => setGroupId(val ? Number(val) : 0))}
                 options={groups}
                 placeholder="Оберіть групу..."
                 disabled={isPending}
              />
            </div>
          )}
          {mode === 'teacher' && teachers.length > 0 && (
            <div className="w-full sm:w-64 text-sys-text-primary">
              <SearchableSelect
                 value={teacherId ?? null}
                 onChange={(val) => startTransition(() => setTeacherId(val ? Number(val) : 0))}
                 options={teachers}
                 placeholder="Оберіть викладача..."
                 disabled={isPending}
              />
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-sys-border bg-sys-card/50 p-12 text-center text-sys-text-secondary">Завантаження розкладу…</div>
      ) : error ? (
        <div className="rounded-2xl border border-rose-400/20 bg-rose-400/5 p-8 text-center text-rose-200">{error}</div>
      ) : week ? (
        <div className="w-full min-w-0">
          <div className="mb-4 mt-2 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center rounded-xl bg-sys-card/50 p-3 border border-sys-border">
            <div className="text-[13px] font-medium text-sys-text-primary flex items-center gap-2 w-full sm:w-auto overflow-hidden">
              <svg width="1.2em" height="1.2em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-sys-accent shrink-0"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
              <span className="truncate">{weekRange}</span>
              <div className="ml-2 hidden sm:block shrink-0"><WeekTypeBadge weekType={weekType} /></div>
            </div>
            <div className="flex w-full sm:w-auto items-center justify-between gap-3">
               <div className="sm:hidden shrink-0"><WeekTypeBadge weekType={weekType} /></div>
               <div className="flex w-full sm:w-auto rounded-lg border border-sys-border bg-sys-card p-1 text-sm relative">
              <div className="absolute top-1 bottom-1 w-[calc(50%-4px)] bg-sys-bg border border-sys-border/50 rounded-md shadow-sm transition-all duration-300 ease-out z-0" style={{ left: isCurrentWeek ? '4px' : 'calc(50% + 2px)' }} />
              <button type="button" onClick={resetWeek} className={`relative z-10 flex-1 sm:flex-none sm:w-28 text-center rounded-md px-3 py-1.5 font-medium transition-colors ${isCurrentWeek ? 'text-sys-text-primary' : 'text-sys-text-secondary hover:text-sys-text-primary'}`}>Поточний</button>
              <button type="button" onClick={() => {
                const nextAnchor = getMondayOf(new Date());
                nextAnchor.setDate(nextAnchor.getDate() + 7);
                setWeekAnchorDate(nextAnchor);
              }} className={`relative z-10 flex-1 sm:flex-none sm:w-28 text-center rounded-md px-3 py-1.5 font-medium transition-colors ${!isCurrentWeek ? 'text-sys-text-primary' : 'text-sys-text-secondary hover:text-sys-text-primary'}`}>Наступний</button>
            </div>
          </div>
          </div>
          <ScheduleWeekGrid week={week} scheduleMode={mode} canEdit={true} onEdit={(lesson) => { const date = week.find((day) => day.lessons.some((item) => item.id === lesson.id))?.date ?? (today?.date || week?.[0]?.date); setEditor({ lesson, date }); }} onCreate={(date) => setEditor({ date })}
            onNoteSave={saveNote} onNoteDelete={deleteNote} />
        </div>
      ) : null}

      {!loading && !error && (!groups.length || (!groupId && mode === "student") || (!teacherId && mode === "teacher")) && (
        <div className="rounded-2xl border border-dashed border-sys-border p-12 text-center text-sys-text-secondary">Оберіть ціль розкладу для перегляду та редагування.</div>
      )}

      {editor && <LessonEditor key={editor.lesson?.id ?? editor.date + "-" + (editor.lesson?.lesson_number ?? "new")} initialWeekType={weekType} lesson={editor.lesson} date={editor.date} scheduleMode={mode} defaultGroupId={groupId} defaultTeacherId={teacherId} groups={groups} onClose={() => setEditor(null)} onSave={(payload) => editor.lesson ? edit(editor.lesson, editor.date, payload) : create(payload)} onDelete={editor.lesson ? () => remove(editor.lesson!) : undefined} />}

      {toast && (
        <div className={`fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:bottom-6 z-[100] flex animate-in slide-in-from-bottom-5 items-center gap-2 rounded-[8px] border px-4 py-3 text-sm shadow-2xl backdrop-blur-md ${
          toast.type === "success"
          ? "border-emerald-500/40 bg-emerald-950/90 text-emerald-200"
          : "border-rose-500/40 bg-rose-950/90 text-rose-200"
        }`}>
           {toast.type === "success" 
             ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="M5 12l5 5l10 -10"/></svg>
             : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
           }
           {toast.message}
        </div>
      )}
    </div>
  );
}
