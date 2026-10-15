"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { ScheduleWeekGrid } from "../ScheduleWeekGrid";
import { WeekTypeBadge } from "../WeekTypeBadge";
import { LessonEditor } from "../LessonEditor";
import { Lesson, LessonMutation, api } from "../../lib/api";
import { invalidateScheduleCache, useSchedule } from "../../lib/hooks";
import { getMondayOf } from "../../lib/date";
import { SearchableSelect } from "../SearchableSelect";
import { useToast } from "../ToastProvider";
import { QuickJumpTarget, findGroupIdByName, findTeacherIdByName } from "../../lib/quickJump";
import { OfficialPrintModal } from "./OfficialPrintSheet";

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
  const [availabilityWeek, setAvailabilityWeek] = useState<Awaited<ReturnType<typeof api.week>> | null>(null);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [editor, setEditor] = useState<{ lesson?: Lesson; date: string } | null>(null);
  const [movingLesson, setMovingLesson] = useState<Lesson | null>(null);
  const [isCopyMode, setIsCopyMode] = useState(false);
  const [returnTarget, setReturnTarget] = useState<{ mode: "student" | "teacher"; id: number; label: string } | null>(null);
  const [moving, setMoving] = useState(false);
  const { showToast: setToast } = useToast();
  const [versions, setVersions] = useState<import("../../lib/api").ScheduleVersion[]>([]);
  const weekType = (week?.[0]?.week_type) ?? today?.week_type ?? "both";
  const [curatorModalOpen, setCuratorModalOpen] = useState(false);
  const [curatorDay, setCuratorDay] = useState(4);
  const [curatorLesson, setCuratorLesson] = useState(4);
  const [curatorWeek, setCuratorWeek] = useState<"both" | "numerator" | "denominator">("both");
  const [curatorLoading, setCuratorLoading] = useState(false);
  const [printModalOpen, setPrintModalOpen] = useState(false);

  useEffect(() => {
    setMovingLesson(null);
    setIsCopyMode(false);
  }, [weekAnchorDate, mode, groupId, teacherId]);

  useEffect(() => {
    api.scheduleVersions.list()
      .then(setVersions)
      .catch((e) => console.error("Failed to load versions", e));
  }, []);

  // Очищуємо кеш доступності при зміні тижня
  useEffect(() => {
    setAvailabilityWeek(null);
    setAvailabilityError(null);
  }, [weekAnchorDate]);

  // Завантажуємо розклад усього коледжу ЛИШЕ коли адмін почав перетягувати або редагувати пару
  const needsAvailability = Boolean(movingLesson || editor);

  useEffect(() => {
    if (!needsAvailability || availabilityWeek !== null) return;
    let active = true;
    setAvailabilityError(null);
    const otherWeekAnchor = new Date(weekAnchorDate);
    otherWeekAnchor.setDate(otherWeekAnchor.getDate() + 7);
    Promise.all([
      api.week(undefined, undefined, weekAnchorDate),
      api.week(undefined, undefined, otherWeekAnchor),
    ])
      .then(([currentWeek, otherWeek]) => {
        if (active) setAvailabilityWeek([...currentWeek, ...otherWeek]);
      })
      .catch((cause) => {
        if (active)
          setAvailabilityError(
            cause instanceof Error ? cause.message : "Не вдалося перевірити вільні місця."
          );
      });
    return () => {
      active = false;
    };
  }, [needsAvailability, availabilityWeek, weekAnchorDate]);

  const weekRange = useMemo(() => {
    const end = new Date(weekAnchorDate);
    end.setDate(end.getDate() + 6);
    const startOpts: Intl.DateTimeFormatOptions = { day: "numeric", month: "long" };
    if (weekAnchorDate.getFullYear() !== end.getFullYear()) startOpts.year = "numeric";
    return `${new Intl.DateTimeFormat("uk-UA", startOpts).format(weekAnchorDate)} – ${new Intl.DateTimeFormat("uk-UA", { day: "numeric", month: "long", year: "numeric" }).format(end)}`;
  }, [weekAnchorDate]);

  const resetWeek = () => setWeekAnchorDate(getMondayOf(new Date()));
  const LESSON_TIMES: Record<number, string> = { 1: "09:00-10:20", 2: "10:40-12:00", 3: "12:30-13:50", 4: "14:00-15:20", 5: "15:30-16:50" };

  const edit = async (lesson: Lesson, date: string, payload: LessonMutation) => {
    const previousToday = today, previousWeek = week;
    const time = LESSON_TIMES[payload.lesson_number];
    if (!time) throw new Error(`Невідомий номер пари: ${payload.lesson_number}`);
    updateLesson({ ...lesson, lesson_number: payload.lesson_number, time, week_type: payload.week_type });
    try { 
        const saved = await api.lessons.update(lesson.id, payload); 
        updateLesson(saved); 
        setToast("Заняття збережено.", "success"); 
    } catch (e) { 
        setToday(previousToday); setWeek(previousWeek); 
        throw e; 
    }
  };

  const handleCopySelect = (lesson: Lesson | null) => {
    setMovingLesson(lesson);
    setIsCopyMode(!!lesson);
  };

  const handleMoveSelect = (lesson: Lesson | null) => {
    setMovingLesson(lesson);
    setIsCopyMode(false);
  };

  const cancelOnDate = async (lesson: Lesson, date: string) => {
    if (!lesson.group_id) {
      setToast("Неможливо скасувати заняття без визначеної групи", "error");
      return;
    }
    try {
      await api.dated.cancel({
        group_id: lesson.group_id,
        date,
        lesson_number: lesson.lesson_number,
      });
      setToast("Заняття на дату скасовано.", "success");
      invalidateScheduleCache();
      const updatedWeek = await (mode === "student" && groupId ? api.week(groupId, undefined, weekAnchorDate) : teacherId ? api.week(undefined, teacherId, weekAnchorDate) : null);
      if (updatedWeek) setWeek(updatedWeek);
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Не вдалося скасувати заняття на дату", "error");
    }
  };

  const handleQuickJump = (target: QuickJumpTarget) => {
    let targetId = target.id;
    if (!targetId && target.name) {
      if (target.mode === "student") {
        targetId = findGroupIdByName(target.name, groups);
      } else {
        targetId = findTeacherIdByName(target.name, teachers);
      }
    }

    if (!targetId) {
      const typeLabel = target.mode === "student" ? "групу" : "викладача";
      setToast(`Не вдалося знайти ${typeLabel} "${target.label || target.name}"`, "error");
      return;
    }

    const currentLabel =
      mode === "student"
        ? groups.find((g) => g.id === groupId)?.name || "групи"
        : teachers.find((t) => t.id === teacherId)?.name || "викладача";

    setReturnTarget({ mode, id: mode === "student" ? (groupId || 0) : (teacherId || 0), label: currentLabel });

    startTransition(() => {
      toggleMode(target.mode);
      if (target.mode === "student") {
        setGroupId(targetId);
      } else {
        setTeacherId(targetId);
      }
    });
  };

  const handleReturnBack = () => {
    if (!returnTarget) return;
    const target = returnTarget;
    setReturnTarget(null);
    startTransition(() => {
      toggleMode(target.mode);
      if (target.mode === "student") {
        setGroupId(target.id);
      } else {
        setTeacherId(target.id);
      }
    });
  };

  const moveLesson = async (lesson: Lesson, date: string, lessonNumber: number) => {
    if (moving || lesson.is_replacement) return;
    const previousToday = today;
    const previousWeek = week;
    const targetDate = new Date(`${date}T12:00:00`).getDay() || 7;
    setMoving(true);
    try {
      if (isCopyMode) {
        const created = await api.lessons.create({
          group_id: lesson.group_id,
          subject_id: lesson.subject_id,
          teacher_id: lesson.teacher_id,
          second_teacher_id: lesson.second_teacher_id,
          day_of_week: targetDate,
          lesson_number: lessonNumber,
          week_type: lesson.week_type,
          room: lesson.room_override || "",
          date: date,
          is_replacement: false,
        });
        addLesson(date, created);
        setMovingLesson(null);
        setIsCopyMode(false);
        invalidateScheduleCache();
        setToast("Заняття скопійовано.", "success");
        return;
      }

      const saved = await api.lessons.update(lesson.id, {
        day_of_week: targetDate,
        lesson_number: lessonNumber,
        date,
        week_type: lesson.week_type,
      });
      setWeek((current) => current.map((day) => ({
        ...day,
        lessons: [
          ...day.lessons.filter((item) => item.id !== lesson.id),
          ...(day.date === date ? [saved] : []),
        ].sort((a, b) => a.lesson_number - b.lesson_number),
      })));
      setToday((current) => current ? {
        ...current,
        lessons: [
          ...current.lessons.filter((item) => item.id !== lesson.id),
          ...(current.date === date ? [saved] : []),
        ].sort((a, b) => a.lesson_number - b.lesson_number),
      } : current);
      setAvailabilityWeek((current) => current?.map((day) => ({
        ...day,
        lessons: [
          ...day.lessons.filter((item) => item.id !== lesson.id),
          ...((new Date(`${day.date}T12:00:00`).getDay() || 7) === targetDate ? [saved] : []),
        ].sort((a, b) => a.lesson_number - b.lesson_number),
      })) ?? null);
      setMovingLesson(null);
      invalidateScheduleCache();
      setToast("Заняття переміщено.", "success");
    } catch (cause) {
      setWeek(previousWeek);
      setToday(previousToday);
      setToast(cause instanceof Error ? cause.message : (isCopyMode ? "Не вдалося скопіювати заняття." : "Не вдалося перемістити заняття."), "error");
    } finally {
      setMoving(false);
    }
  };
  
  const create = async (payload: LessonMutation) => {
    try {
      const created = await api.lessons.create(payload);
      addLesson(payload.date ?? new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(new Date()), created);
      setToast("Заняття додано.", "success");
    } catch (e) {
      throw e;
    }
  };
  
  const remove = async (lesson: Lesson) => {
    const previousToday = today, previousWeek = week; removeLesson(lesson.id);
    try { await api.lessons.remove(lesson.id); setToast("Заняття видалено.", "success"); }
    catch (e) { 
        setToday(previousToday); setWeek(previousWeek); 
        setToast(e instanceof Error ? e.message : "Помилка видалення", "error");
        throw e; 
    }
  };

  const runBulkCurator = async (action: "create" | "delete") => {
    setCuratorLoading(true);
    try {
      const res = await api.lessons.bulkCurator({
        day_of_week: curatorDay,
        lesson_number: curatorLesson,
        week_type: curatorWeek,
        group_ids: [],
        action,
      });
      invalidateScheduleCache();
      setToast(
        action === "create"
          ? `Виховні години створено: ${res.created} (пропущено: ${res.skipped})`
          : `Виховні години видалено: ${res.deleted}`,
        "success"
      );
      setCuratorModalOpen(false);
      // Оновлюємо поточний тиждень
      const refreshed = await api.week(
        mode === "student" ? (groupId ?? undefined) : undefined,
        mode === "teacher" ? (teacherId ?? undefined) : undefined,
        weekAnchorDate
      );
      setWeek(refreshed);
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Помилка операції з виховними годинами", "error");
    } finally {
      setCuratorLoading(false);
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
                 onChange={(val) => startTransition(() => setGroupId(val ? Number(val) : null))}
                 options={groups}
                 placeholder="Оберіть групу"
                 disabled={isPending}
                 ariaLabel="Оберіть групу для перегляду розкладу"
              />
            </div>
          )}
          {mode === 'teacher' && teachers.length > 0 && (
            <div className="w-full sm:w-64 text-sys-text-primary">
              <SearchableSelect
                 value={teacherId ?? null}
                 onChange={(val) => startTransition(() => setTeacherId(val ? Number(val) : null))}
                 options={teachers}
                 placeholder="Оберіть викладача"
                 disabled={isPending}
                 ariaLabel="Оберіть викладача для перегляду розкладу"
              />
            </div>
          )}
        </div>
      </div>

      {returnTarget && (
        <div className="mb-4 flex items-center justify-between rounded-xl border border-sys-accent/30 bg-sys-accent/10 px-4 py-2.5 text-sm">
          <span className="text-sys-text-secondary">
            Редагування розкладу:{" "}
            <strong className="text-sys-text-primary">
              {mode === "student"
                ? groups.find((g) => g.id === groupId)?.name
                : teachers.find((t) => t.id === teacherId)?.name}
            </strong>
          </span>
          <button
            type="button"
            onClick={handleReturnBack}
            className="rounded-lg bg-sys-accent px-3 py-1 text-xs font-semibold text-[#0b1120] transition-opacity hover:opacity-90"
          >
            ← Повернутися до {returnTarget.label}
          </button>
        </div>
      )}

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
            <div className="flex w-full sm:w-auto flex-col sm:flex-row items-stretch sm:items-center gap-3">
               <div className="flex items-center justify-between gap-3">
                 <div className="sm:hidden shrink-0"><WeekTypeBadge weekType={weekType} /></div>
                 <div className="flex w-full sm:w-auto items-center justify-between gap-1 rounded-lg border border-sys-border bg-sys-card p-1 text-sm">
              <button type="button" aria-label="Попередній тиждень" onClick={() => {
                const prev = new Date(weekAnchorDate);
                prev.setDate(prev.getDate() - 7);
                setWeekAnchorDate(prev);
              }} className="relative z-10 flex min-h-[38px] min-w-[38px] items-center justify-center rounded-md p-1.5 px-3 text-sys-text-secondary hover:bg-sys-bg hover:text-sys-text-primary focus:ring-2 focus:ring-sys-accent focus:outline-none transition-colors">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
              </button>
              
              <button type="button" onClick={resetWeek} className={`relative z-10 text-center min-h-[38px] rounded-md px-3 py-1.5 font-medium transition-colors ${isCurrentWeek ? 'text-sys-accent bg-sys-accent/10' : 'text-sys-text-secondary hover:bg-sys-bg hover:text-sys-text-primary'}`}>Сьогодні</button>
              
              <button type="button" aria-label="Наступний тиждень" onClick={() => {
                const next = new Date(weekAnchorDate);
                next.setDate(next.getDate() + 7);
                setWeekAnchorDate(next);
              }} className="relative z-10 flex min-h-[38px] min-w-[38px] items-center justify-center rounded-md p-1.5 px-3 text-sys-text-secondary hover:bg-sys-bg hover:text-sys-text-primary focus:ring-2 focus:ring-sys-accent focus:outline-none transition-colors">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
              </button>
                 </div>
               </div>
            
            {versions.length > 0 && (
              <select 
                className="form-control text-sm py-1.5 w-full sm:w-auto"
                value=""
                onChange={(e) => {
                  if (e.target.value) {
                    const v = versions.find(v => v.id === Number(e.target.value));
                    if (v) setWeekAnchorDate(getMondayOf(new Date(v.valid_from)));
                  }
                }}
                aria-label="Перейти до версії"
              >
                <option value="">Перейти до версії...</option>
                {versions.map(v => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </select>
            )}
            <button
              type="button"
              onClick={() => setCuratorModalOpen(true)}
              className="rounded-lg border border-sys-border bg-sys-card px-3 py-1.5 text-xs font-semibold text-sys-text-primary hover:bg-white/5"
            >
              🎓 Виховна година
            </button>
            <button
              type="button"
              onClick={() => setPrintModalOpen(true)}
              className="rounded-lg border border-sys-border bg-sys-card px-3 py-1.5 text-xs font-semibold text-sys-text-primary hover:bg-white/5"
            >
              🖨️ Друк
            </button>
          </div>
          </div>
          <ScheduleWeekGrid
            week={week}
            availabilityWeek={availabilityWeek}
            availabilityError={availabilityError}
            scheduleMode={mode}
            canEdit={true}
            movingLesson={movingLesson}
            isCopyMode={isCopyMode}
            onMoveSelect={handleMoveSelect}
            onCopySelect={handleCopySelect}
            onCancelDated={cancelOnDate}
            onQuickJump={handleQuickJump}
            onMove={(lesson, date, lessonNumber) => void moveLesson(lesson, date, lessonNumber)}
            onEdit={(lesson) => { const date = week.find((day) => day.lessons.some((item) => item.id === lesson.id))?.date ?? (today?.date || week?.[0]?.date); setEditor({ lesson, date }); }}
            onCreate={(date) => setEditor({ date })}
          />
        </div>
      ) : null}

      {!loading && !error && (!groups.length || (!groupId && mode === "student") || (!teacherId && mode === "teacher")) && (
        <div className="rounded-2xl border border-dashed border-sys-border p-12 text-center text-sys-text-secondary">Оберіть ціль розкладу для перегляду та редагування.</div>
      )}

      {editor && (
        <LessonEditor
          key={editor.lesson?.id ?? editor.date + "-" + (editor.lesson?.lesson_number ?? "new")}
          initialWeekType={weekType}
          lesson={editor.lesson}
          date={editor.date}
          scheduleMode={mode}
          defaultGroupId={groupId}
          defaultTeacherId={teacherId}
          groups={groups}
          availabilityWeek={availabilityWeek}
          onClose={() => setEditor(null)}
          onSave={(payload) => editor.lesson ? edit(editor.lesson, editor.date, payload) : create(payload)}
          onDelete={editor.lesson ? () => remove(editor.lesson!) : undefined}
        />
      )}
      {curatorModalOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-sys-border bg-sys-card p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-sys-text-primary">🎓 Масова виховна година</h3>
              <button type="button" onClick={() => setCuratorModalOpen(false)} className="text-sm text-sys-text-secondary hover:text-white">✕</button>
            </div>
            <p className="text-xs text-sys-text-secondary">
              Автоматично призначає предмет «Виховна година» всім активним групам, у яких вказаний куратор і немає накладки у цей час.
            </p>
            <div className="grid grid-cols-3 gap-3">
              <label className="space-y-1">
                <span className="text-xs text-sys-text-secondary">День</span>
                <select value={curatorDay} onChange={(e) => setCuratorDay(Number(e.target.value))} className="form-control w-full text-sm">
                  <option value={1}>Понеділок</option>
                  <option value={2}>Вівторок</option>
                  <option value={3}>Середа</option>
                  <option value={4}>Четвер</option>
                  <option value={5}>П’ятниця</option>
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs text-sys-text-secondary">Пара</span>
                <select value={curatorLesson} onChange={(e) => setCuratorLesson(Number(e.target.value))} className="form-control w-full text-sm">
                  {[1, 2, 3, 4].map((n) => (
                    <option key={n} value={n}>{n}-та пара</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs text-sys-text-secondary">Тиждень</span>
                <select value={curatorWeek} onChange={(e) => setCuratorWeek(e.target.value as any)} className="form-control w-full text-sm">
                  <option value="both">Обидва</option>
                  <option value="numerator">Чисельник</option>
                  <option value="denominator">Знаменник</option>
                </select>
              </label>
            </div>
            <div className="flex justify-between gap-2 pt-2">
              <button
                type="button"
                disabled={curatorLoading}
                onClick={() => void runBulkCurator("delete")}
                className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-300 hover:bg-rose-500/20 disabled:opacity-50"
              >
                Очистити слот
              </button>
              <button
                type="button"
                disabled={curatorLoading}
                onClick={() => void runBulkCurator("create")}
                className="rounded-lg bg-sys-accent px-4 py-2 text-xs font-bold text-[#0b1120] hover:opacity-90 disabled:opacity-50"
              >
                {curatorLoading ? "Виконуємо..." : "Проставити всім групам"}
              </button>
            </div>
          </div>
        </div>
      )}

      {printModalOpen && (
        <OfficialPrintModal
          groups={groups}
          defaultDate={week?.[0]?.date || new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(new Date())}
          onClose={() => setPrintModalOpen(false)}
        />
      )}
    </div>
  );
}
