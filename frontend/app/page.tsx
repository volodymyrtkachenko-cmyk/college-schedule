"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { BottomNav } from "../components/BottomNav";
import { OfflineIndicator } from "../components/OfflineIndicator";
import { InstallPrompt } from "../components/InstallPrompt";
import { ScheduleDay } from "../components/ScheduleDay";
import { ScheduleWeekGrid } from "../components/ScheduleWeekGrid";
import { WeekTypeBadge } from "../components/WeekTypeBadge";
import { LessonEditor } from "../components/LessonEditor";
import { Lesson, LessonMutation, api } from "../lib/api";
import { useSchedule } from "../lib/hooks";
import { useAuth } from "../lib/auth";
import { WelcomeScreen } from "../components/WelcomeScreen";
import { motion, AnimatePresence } from "framer-motion";

export default function HomePage() {
  const [weekAnchorDate, setWeekAnchorDate] = useState(() => {
    const date = new Date();
    const day = date.getDay();
    // If it's Saturday (6) or Sunday (0), shift to next week's Monday
    if (day === 0 || day === 6) {
        date.setDate(date.getDate() + (day === 0 ? 1 : 2));
    } else {
        date.setDate(date.getDate() - (day || 7) + 1);
    }
    date.setHours(12, 0, 0, 0);
    return date;
  });

  const isCurrentWeek = useMemo(() => {
    const todayAnchor = new Date();
    todayAnchor.setDate(todayAnchor.getDate() - (todayAnchor.getDay() || 7) + 1);
    todayAnchor.setHours(12, 0, 0, 0);
    return Math.abs(weekAnchorDate.getTime() - todayAnchor.getTime()) < 1000 * 60 * 60 * 24;
  }, [weekAnchorDate]);
  const { isSetupComplete, completeSetup, resetSetup, mode, toggleMode, teachers, teacherId, setTeacherId, groups, groupId, setGroupId, today, week, loading, error, setToday, setWeek, updateLesson, removeLesson, addLesson } = useSchedule(weekAnchorDate);
  const { user, loading: authLoading, login, logout } = useAuth();
  const [view, setView] = useState<"today" | "week">("today");
  const [isPending, startTransition] = useTransition();
  const [editor, setEditor] = useState<{ lesson?: Lesson; date: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const weekType = view === "week" ? (week[0]?.week_type ?? "both") : (today?.week_type ?? "both");
  const canEdit = user?.role === "admin" || user?.role === "editor";
  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [message]);
  const weekRange = useMemo(() => {
    const end = new Date(weekAnchorDate);
    end.setDate(end.getDate() + 6);
    return `${new Intl.DateTimeFormat("uk-UA", { day: "numeric", month: "long" }).format(weekAnchorDate)} – ${new Intl.DateTimeFormat("uk-UA", { day: "numeric", month: "long", year: "numeric" }).format(end)}`;
  }, [weekAnchorDate]);
  const moveWeek = (amount: number) => setWeekAnchorDate((date) => {
    const next = new Date(date);
    next.setDate(next.getDate() + amount * 7);
    return next;
  });
  const resetWeek = () => {
    const date = new Date();
    date.setDate(date.getDate() - (date.getDay() || 7) + 1);
    date.setHours(12, 0, 0, 0);
    setWeekAnchorDate(date);
  };
  const LESSON_TIMES: Record<number, string> = { 1: "09:00-10:20", 2: "10:40-12:00", 3: "12:30-13:50", 4: "14:00-15:20" };
  const edit = async (lesson: Lesson, date: string, payload: LessonMutation) => {
    const previousToday = today, previousWeek = week;
    const time = LESSON_TIMES[payload.lesson_number] ?? "09:00-10:20";
    updateLesson({ ...lesson, lesson_number: payload.lesson_number, time, subject: (payload as any).subject ?? lesson.subject, subject_name: (payload as any).subject_name ?? lesson.subject_name, teacher: (payload as any).teacher ?? null, teacher_name: (payload as any).teacher_name ?? null, room: (payload as any).room ?? null, week_type: payload.week_type });
    try { const saved = await api.lessons.update(lesson.id, payload); updateLesson(saved); setMessage("Заняття збережено."); }
    catch (e) { setToday(previousToday); setWeek(previousWeek); throw e; }
  };
  const create = async (payload: LessonMutation) => {
    const created = await api.lessons.create(payload); addLesson(payload.date ?? new Date().toISOString().slice(0, 10), created); setMessage("Заняття додано.");
  };
  const remove = async (lesson: Lesson) => {
    const previousToday = today, previousWeek = week; removeLesson(lesson.id);
    try { await api.lessons.remove(lesson.id); setMessage("Заняття видалено."); }
    catch (e) { setToday(previousToday); setWeek(previousWeek); throw e; }
  };
  const saveNote = async (lesson: Lesson, note: string, date: string) => {
    const saved = lesson.note_id
      ? await api.notes.update(lesson.note_id, { note })
      : await api.notes.create({ schedule_id: lesson.id, note_date: date, note });
    updateLesson({ ...lesson, note: saved.note, note_id: saved.id, note_date: saved.note_date });
    setMessage("Примітку збережено.");
  };
  const deleteNote = async (lesson: Lesson, date: string) => {
    if (lesson.note_id) await api.notes.remove(lesson.note_id);
    updateLesson({ ...lesson, note: null, note_id: null, note_date: date });
    setMessage("Примітку видалено.");
  };

  if (!loading && !isSetupComplete) {
    return <WelcomeScreen groups={groups} teachers={teachers} initialMode={mode} onComplete={(m, id) => {
        toggleMode(m);
        if (m === "student") setGroupId(id);
        else setTeacherId(id);
        completeSetup();
    }} />;
  }

  return (
    <main className="min-h-screen bg-sys-bg pb-24 text-sys-text-primary md:pb-8">
      <OfflineIndicator />
      <InstallPrompt />
      <header className="border-b border-sys-border bg-sys-bg/80">
        <div className="mx-auto flex max-w-[1800px] flex-col md:flex-row md:items-center justify-between gap-4 px-3 py-5 sm:px-5 lg:px-6 xl:px-8">
          <div>
            <a href="https://kre.dp.ua/" target="_blank" rel="noopener noreferrer" className="inline-block hover:opacity-80 transition-opacity" title="Головна сторінка закладу">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-sys-accent">ДФКР</p>
            </a>
            <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Розклад занять</h1>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center gap-4 w-full md:w-auto">
            <div className="flex items-center justify-between sm:justify-start gap-4">
              <div className="flex items-center gap-2 bg-sys-card border border-sys-border px-4 py-2 rounded-xl">
                 <span className="font-medium text-white truncate max-w-[200px]">
                   {mode === "student" ? groups.find(g => g.id === groupId)?.name || "Не обрано" : teachers.find(t => t.id === teacherId)?.name || "Не обрано"}
                 </span>
                 <button onClick={resetSetup} className="ml-2 text-sys-text-secondary hover:text-white transition-colors" title="Змінити налаштування" type="button">
                   <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
                 </button>
              </div>
              <WeekTypeBadge weekType={weekType} />
            </div>

            {user && (
              <div className="flex items-center gap-2 ml-auto sm:ml-0 mt-2 sm:mt-0">
                {user.role === "admin" && <a href="/admin" className="rounded-lg border border-cyan-400/40 px-3 py-2 text-sm text-cyan-300">Адмін</a>}
                <button onClick={logout} className="rounded-lg border border-sys-border px-3 py-2 text-sm text-slate-300">Вийти ({user.name})</button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1800px] px-3 py-6 sm:px-5 lg:px-6 xl:px-8">
        <div className="mb-6 hidden items-center justify-between md:flex">
          <div>
            <p className="text-sm text-sys-text-secondary">{view === "today" ? "Поточний день" : "Навчальний тиждень"}</p>
            <h2 className="text-xl font-semibold">{view === "today" ? "Сьогодні" : "Усі дні"}</h2>
          </div>
          <div className="flex rounded-lg border border-sys-border bg-sys-card p-1 text-sm relative">
            <div className="absolute top-1 bottom-1 w-[calc(50%-4px)] bg-sys-accent/10 border border-sys-accent/20 rounded-md shadow-sm transition-all duration-300 ease-out z-0" style={{ left: view === 'today' ? '4px' : 'calc(50% + 2px)' }}></div>
            <button key="today" onClick={() => setView("today")} className={`w-24 relative z-10 rounded-md px-4 py-2 text-sm font-medium transition-colors ${view === 'today' ? 'text-sys-accent' : 'text-sys-text-secondary hover:text-sys-text-primary'}`}>Сьогодні</button>
            <button key="week" onClick={() => setView("week")} className={`w-24 relative z-10 rounded-md px-4 py-2 text-sm font-medium transition-colors ${view === 'week' ? 'text-sys-accent' : 'text-sys-text-secondary hover:text-sys-text-primary'}`}>Тиждень</button>
          </div>
        </div>

        
        
        
          {loading ? (
            <div className="rounded-2xl border border-sys-border bg-sys-card/50 p-12 text-center text-sys-text-secondary">Завантаження розкладу…</div>
          ) : error ? (
            <div className="rounded-2xl border border-rose-400/20 bg-rose-400/5 p-8 text-center text-rose-200">{error}</div>
          ) : today ? (
            <div>
              <div className={view === "today" ? "block" : "hidden"}>
                <ScheduleDay schedule={today} isToday scheduleMode={mode} canEdit={canEdit} onEdit={(lesson) => setEditor({ lesson, date: today.date })} onCreate={(date) => setEditor({ date })}
                  onNoteSave={saveNote} onNoteDelete={deleteNote} />
              </div>
                            <div className={view === "week" ? "block w-full min-w-0" : "hidden"}>
                 <div className="mb-4 mt-2 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center rounded-xl bg-sys-card p-3 border border-sys-border/50">
                    <div className="text-[13px] font-medium text-sys-text-primary flex items-center gap-2">
                      <svg width="1.2em" height="1.2em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-sys-accent"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                      {weekRange}
                    </div>
                    <div className="flex w-full sm:w-auto rounded-lg border border-sys-border bg-sys-card p-1 text-sm relative">
                      <div className="absolute top-1 bottom-1 w-[calc(50%-4px)] bg-sys-bg border border-sys-border/50 rounded-md shadow-sm transition-all duration-300 ease-out z-0" style={{ left: isCurrentWeek ? '4px' : 'calc(50% + 2px)' }} />
                      <button type="button" onClick={resetWeek} className={`relative z-10 flex-1 sm:flex-none sm:w-28 text-center rounded-md px-3 py-1.5 font-medium transition-colors ${isCurrentWeek ? 'text-sys-text-primary' : 'text-sys-text-secondary hover:text-sys-text-primary'}`}>Поточний</button>
                      <button type="button" onClick={() => {
                        const nextAnchor = new Date();
                        nextAnchor.setDate(nextAnchor.getDate() - (nextAnchor.getDay() || 7) + 1 + 7);
                        nextAnchor.setHours(12, 0, 0, 0);
                        setWeekAnchorDate(nextAnchor);
                      }} className={`relative z-10 flex-1 sm:flex-none sm:w-28 text-center rounded-md px-3 py-1.5 font-medium transition-colors ${!isCurrentWeek ? 'text-sys-text-primary' : 'text-sys-text-secondary hover:text-sys-text-primary'}`}>Наступний</button>
                    </div>
                 </div>
                <ScheduleWeekGrid week={week} scheduleMode={mode} canEdit={canEdit} onEdit={(lesson) => { const date = week.find((day) => day.lessons.some((item) => item.id === lesson.id))?.date ?? today.date; setEditor({ lesson, date }); }} onCreate={(date) => setEditor({ date })}
                  onNoteSave={saveNote} onNoteDelete={deleteNote} />
              </div>
            </div>
          ) : null}
        
        {!loading && !error && !groups.length && <div className="rounded-2xl border border-dashed border-sys-border p-12 text-center text-sys-text-secondary">Активних груп поки немає.</div>}
        {message && <p role="status" className="mt-4 rounded-lg border border-emerald-400/30 bg-emerald-400/5 px-4 py-3 text-sm text-emerald-200">{message}</p>}
      </div>
      {canEdit && editor && <LessonEditor key={editor.lesson?.id ?? editor.date + "-" + (editor.lesson?.lesson_number ?? "new")} initialWeekType={weekType} lesson={editor.lesson} date={editor.date} scheduleMode={mode} defaultGroupId={groupId} defaultTeacherId={teacherId} groups={groups} onClose={() => setEditor(null)} onSave={(payload) => editor.lesson ? edit(editor.lesson, editor.date, payload) : create(payload)} onDelete={editor.lesson ? () => remove(editor.lesson!) : undefined} />}
      <BottomNav view={view} onViewChange={setView} />
    </main>
  );
}
