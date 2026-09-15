"use client";

import { useMemo, useState } from "react";
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

export default function HomePage() {
  const [weekAnchorDate, setWeekAnchorDate] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - (date.getDay() || 7) + 1);
    date.setHours(12, 0, 0, 0);
    return date;
  });
  const { groups, groupId, setGroupId, today, week, loading, error, setToday, setWeek, updateLesson, removeLesson, addLesson } = useSchedule(weekAnchorDate);
  const { user, loading: authLoading, login, logout } = useAuth();
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [loginError, setLoginError] = useState<string | null>(null);
  const [view, setView] = useState<"today" | "week">("today");
  const [editor, setEditor] = useState<{ lesson?: Lesson; date: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const weekType = view === "week" ? (week[0]?.week_type ?? "both") : (today?.week_type ?? "both");
  const canEdit = user?.role === "admin" || user?.role === "editor";
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
  const edit = async (lesson: Lesson, date: string, payload: LessonMutation) => {
    const previousToday = today, previousWeek = week;
    updateLesson({ ...lesson, lesson_number: payload.lesson_number, time: `${payload.start_time}-${payload.end_time}`, subject: payload.subject ?? lesson.subject, subject_name: payload.subject ?? lesson.subject_name, teacher: payload.teacher ?? null, teacher_name: payload.teacher ?? null, room: payload.room ?? null, room_name: payload.room ?? null, week_type: payload.week_type });
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

  return (
    <main className="min-h-screen bg-slate-950 pb-24 text-slate-100 md:pb-8">
      <OfflineIndicator />
      <InstallPrompt />
      <header className="border-b border-slate-800/80 bg-slate-950/80">
        <div className="mx-auto flex max-w-[1800px] flex-wrap items-center justify-between gap-4 px-3 py-5 sm:px-5 lg:px-6 xl:px-8">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-400">College Schedule</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Розклад занять</h1>
          </div>
          <div className="flex items-center gap-3">
            {groups.length > 0 && (
              <label className="flex items-center gap-2 text-sm text-slate-400">
                <span className="hidden sm:inline">Група</span>
                <select value={groupId ?? ""} onChange={(event) => setGroupId(Number(event.target.value))} className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-medium text-slate-100 outline-none focus:border-cyan-400">
                  {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                </select>
              </label>
            )}
            <div className="flex items-center gap-2">
              <WeekTypeBadge weekType={weekType} />
            </div>
            {view === "week" && (
              <div className="flex flex-wrap items-center justify-end gap-2">
                <span className="hidden text-xs text-slate-400 sm:inline">{weekRange}</span>
                <button type="button" onClick={resetWeek} className="rounded-lg border border-cyan-400/40 px-3 py-2 text-sm text-cyan-300 hover:bg-cyan-400/10">Поточний тиждень</button>
                <button type="button" onClick={() => moveWeek(1)} className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:border-cyan-400 hover:text-cyan-300">Наступний тиждень</button>
              </div>
            )}
            {user ? (
              <div className="flex items-center gap-2">
                {user.role === "admin" && <a href="/admin" className="rounded-lg border border-cyan-400/40 px-3 py-2 text-sm text-cyan-300">Адмін</a>}
                <button onClick={logout} className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300">Вийти ({user.name})</button>
              </div>
            ) : !authLoading && (
              <form onSubmit={async (event) => { event.preventDefault(); setLoginError(null); try { await login(loginForm.username, loginForm.password); setLoginForm({ username: "", password: "" }); } catch (error) { setLoginError(error instanceof Error ? error.message : "Помилка входу"); } }} className="flex items-center gap-2">
                <input aria-label="Логін" value={loginForm.username} onChange={(e) => setLoginForm({ ...loginForm, username: e.target.value })} placeholder="Логін" className="w-24 rounded-lg border border-slate-700 bg-slate-900 px-2 py-2 text-sm" />
                <input aria-label="Пароль" type="password" value={loginForm.password} onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })} placeholder="Пароль" className="w-24 rounded-lg border border-slate-700 bg-slate-900 px-2 py-2 text-sm" />
                <button className="rounded-lg bg-cyan-400 px-3 py-2 text-sm font-semibold text-slate-950">Увійти</button>
              </form>
            )}
          </div>
        </div>
        {loginError && <p className="mx-auto max-w-[1800px] px-3 pb-3 text-right text-sm text-rose-300 sm:px-5 lg:px-6 xl:px-8">{loginError}</p>}
      </header>

      <div className="mx-auto max-w-[1800px] px-3 py-6 sm:px-5 lg:px-6 xl:px-8">
        <div className="mb-6 hidden items-center justify-between md:flex">
          <div>
            <p className="text-sm text-slate-400">{view === "today" ? "Поточний день" : "Навчальний тиждень"}</p>
            <h2 className="text-xl font-semibold">{view === "today" ? "Сьогодні" : "Усі дні"}</h2>
          </div>
          <div className="flex rounded-lg border border-slate-800 bg-slate-900 p-1">
            {(["today", "week"] as const).map((item) => (
              <button key={item} onClick={() => setView(item)} className={`rounded-md px-4 py-2 text-sm font-medium ${view === item ? "bg-cyan-400/15 text-cyan-300" : "text-slate-400 hover:text-slate-100"}`}>
                {item === "today" ? "Сьогодні" : "Тиждень"}
              </button>
            ))}
          </div>
        </div>

        {loading && <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-12 text-center text-slate-400">Завантаження розкладу…</div>}
        {!loading && error && <div className="rounded-2xl border border-rose-400/20 bg-rose-400/5 p-8 text-center text-rose-200">{error}</div>}
        {!loading && !error && today && (
          <>
            <div className={view === "today" ? "block" : "hidden"}>
              <ScheduleDay schedule={today} isToday canEdit={canEdit} onEdit={(lesson) => setEditor({ lesson, date: today.date })} onCreate={(date) => setEditor({ date })}
                onNoteSave={saveNote} onNoteDelete={deleteNote} />
            </div>
            <div className={view === "week" ? "block" : "hidden"}>
              <ScheduleWeekGrid week={week} canEdit={canEdit} onEdit={(lesson) => { const date = week.find((day) => day.lessons.some((item) => item.id === lesson.id))?.date ?? today.date; setEditor({ lesson, date }); }} onCreate={(date) => setEditor({ date })}
                onNoteSave={saveNote} onNoteDelete={deleteNote} />
            </div>
          </>
        )}
        {!loading && !error && !groups.length && <div className="rounded-2xl border border-dashed border-slate-800 p-12 text-center text-slate-400">Активних груп поки немає.</div>}
        {message && <p role="status" className="mt-4 rounded-lg border border-emerald-400/30 bg-emerald-400/5 px-4 py-3 text-sm text-emerald-200">{message}</p>}
      </div>
      {canEdit && editor && groupId !== null && <LessonEditor lesson={editor.lesson} date={editor.date} groupId={groupId} onClose={() => setEditor(null)} onSave={(payload) => editor.lesson ? edit(editor.lesson, editor.date, payload) : create(payload)} onDelete={editor.lesson ? () => remove(editor.lesson!) : undefined} />}
      <BottomNav view={view} onViewChange={setView} />
    </main>
  );
}
