"use client";
import { useState, useEffect } from "react";
import { Lesson, ScheduleResponse } from "../lib/api";
import { ScheduleDay } from "./ScheduleDay";
import { LessonCard } from "./LessonCard";
import { motion, AnimatePresence } from "framer-motion";
import { formatLessonCount } from "../lib/format";

export function ScheduleWeekGrid({ week, availabilityWeek, availabilityError, scheduleMode = "student", canEdit = false, onEdit, onCreate, movingLesson, onMoveSelect, onMove }: {
  week: ScheduleResponse[]; scheduleMode?: "student"|"teacher"; canEdit?: boolean; onEdit?: (lesson: Lesson) => void; onCreate?: (date: string) => void;
  availabilityWeek?: ScheduleResponse[] | null;
  availabilityError?: string | null;
  onNoteSave?: (lesson: Lesson, note: string, date: string) => Promise<void>;
  onNoteDelete?: (lesson: Lesson, date: string) => Promise<void>;
  movingLesson?: Lesson | null;
  onMoveSelect?: (lesson: Lesson | null) => void;
  onMove?: (lesson: Lesson, date: string, lessonNumber: number) => void;
}) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [direction, setDirection] = useState(0);

  // Keep the active day aligned with reality when week array changes
  useEffect(() => {
     if (week.length === 0) return;
     const today = new Date();
     const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
     const todayIdx = week.findIndex(d => d.date === todayStr);
     if (todayIdx !== -1) {
       setActiveIdx(todayIdx);
     } else {
       setActiveIdx(0);
     }
  }, [week]);

  const switchTab = (idx: number) => {
    if (idx === activeIdx) return;
    setDirection(idx > activeIdx ? 1 : -1);
    setActiveIdx(idx);
  };

  const activeDay = week[activeIdx];
  const canMoveTo = (lesson: Lesson, targetDate: string, lessonNumber: number) => {
    const targetWeekday = new Date(`${targetDate}T12:00:00`).getDay() || 7;
    const targetLessons = availabilityWeek
      ?.filter((day) => (new Date(`${day.date}T12:00:00`).getDay() || 7) === targetWeekday)
      .flatMap((day) => day.lessons)
      .filter((candidate) => !candidate.is_replacement);
    if (!targetLessons || (lesson.day_of_week === targetWeekday && lesson.lesson_number === lessonNumber)) {
      return false;
    }
    const movingTeacherIds = new Set([lesson.teacher_id, lesson.second_teacher_id].filter((id): id is number => id !== null));
    return !targetLessons.some((other) => {
      if (other.id === lesson.id || other.lesson_number !== lessonNumber) return false;
      const weeksOverlap = lesson.week_type === "both" || other.week_type === "both" || lesson.week_type === other.week_type;
      if (!weeksOverlap) return false;

      const sameGroup = other.group_id === lesson.group_id;
      const teacherConflict = [other.teacher_id, other.second_teacher_id]
        .some((id) => id !== null && movingTeacherIds.has(id));
      if (!sameGroup && !teacherConflict) return false;

      const sameSharedLesson = !sameGroup &&
        !!lesson.stream_id &&
        other.stream_id === lesson.stream_id &&
        other.subject_id === lesson.subject_id &&
        other.teacher_id === lesson.teacher_id &&
        other.second_teacher_id === lesson.second_teacher_id;
      return !sameSharedLesson;
    });
  };

  const dayProps = {
    scheduleMode,
    canEdit,
    onEdit,
    onCreate,
    movingLesson,
    onMoveSelect,
    onMove,
    canMoveTo,
  };
  const lessonTimes: Record<number, string> = {
    1: "09:00–10:20",
    2: "10:40–12:00",
    3: "12:30–13:50",
    4: "14:00–15:20",
    5: "15:30–16:50",
  };
  const formatDate = (value: string) => new Intl.DateTimeFormat("uk-UA", {
    day: "numeric",
    month: "short",
  }).format(new Date(`${value}T12:00:00`));
  const getDayName = (dateStr: string) => {
     const d = new Date(dateStr);
     return new Intl.DateTimeFormat("uk-UA", { weekday: "short" }).format(d);
  };

  const variants = {
    enter: (dir: number) => ({
      x: dir > 0 ? 300 : -300,
      opacity: 0,
      zIndex: 0,
      position: "absolute" as any,
    }),
    center: {
      zIndex: 1,
      x: 0,
      opacity: 1,
      position: "relative" as any,
    },
    exit: (dir: number) => ({
      zIndex: 0,
      x: dir > 0 ? -300 : 300,
      opacity: 0,
      position: "absolute" as any,
    })
  };

  return (
    <div className="w-full pb-4">
      {canEdit && movingLesson && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-400/30 bg-emerald-500/[0.08] px-4 py-3">
          <p className="text-sm text-sys-text-primary">
            Перетягніть <strong>{movingLesson.subject_name}</strong> або виберіть підсвічене вільне місце.
            {availabilityWeek ? " Перевіряємо конфлікти групи та викладача в усьому розкладі." : " Перевіряємо доступні місця…"}
          </p>
          <button type="button" onClick={() => onMoveSelect?.(null)} className="rounded-lg border border-sys-border px-3 py-1.5 text-sm font-medium text-sys-text-secondary hover:text-sys-text-primary">
            Скасувати
          </button>
        </div>
      )}
      {canEdit && availabilityError && (
        <p role="alert" className="mb-4 rounded-xl border border-rose-400/30 bg-rose-400/5 px-4 py-3 text-sm text-rose-200">
          Не вдалося перевірити вільні місця: {availabilityError} Вільні місця не підсвічено, але під час збереження система ще раз перевірить розклад.
        </p>
      )}
      {canEdit && (
        <div className="overflow-x-auto rounded-2xl border border-sys-border bg-sys-card/50">
          <div className="grid min-w-[1000px] grid-cols-[5.5rem_repeat(5,minmax(11rem,1fr))]">
            <div className="sticky left-0 z-20 border-b border-r border-sys-border bg-sys-card p-3 text-center text-xs font-semibold uppercase text-sys-text-muted">
              Пара
            </div>
            {week.map((day) => (
              <div key={day.date} className="border-b border-r border-sys-border bg-sys-card px-3 py-3 text-center">
                <h3 className="font-semibold capitalize text-sys-text-primary">
                  {new Intl.DateTimeFormat("uk-UA", { weekday: "long" }).format(new Date(`${day.date}T12:00:00`))}
                </h3>
                <span className="text-xs text-sys-text-muted">{formatDate(day.date)}</span>
                <button
                  type="button"
                  onClick={() => onCreate?.(day.date)}
                  className="mt-2 block w-full rounded-lg border border-dashed border-sys-border px-2 py-1.5 min-h-[36px] text-xs text-sys-text-secondary transition-colors hover:border-sys-accent hover:bg-sys-accent/5 hover:text-sys-accent"
                >
                  + Додати
                </button>
              </div>
            ))}

            {[1, 2, 3, 4].flatMap((lessonNumber) => [
              <div key={`lesson-${lessonNumber}`} className="sticky left-0 z-10 border-b border-r border-sys-border bg-sys-card p-3 text-center">
                <div className="text-lg font-bold text-sys-text-primary">{lessonNumber}</div>
                <div className="text-[10px] text-sys-text-muted">{lessonTimes[lessonNumber]}</div>
              </div>,
              ...week.map((day) => {
                const cellLessons = day.lessons.filter((lesson) => lesson.lesson_number === lessonNumber);
                const canChooseTarget = !!movingLesson && !!canMoveTo(movingLesson, day.date, lessonNumber);
                return (
                  <div
                    key={`${day.date}-${lessonNumber}`}
                    onDragOver={(event) => {
                      if (canChooseTarget) event.preventDefault();
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      if (movingLesson && canChooseTarget) onMove?.(movingLesson, day.date, lessonNumber);
                    }}
                    className={`min-h-[110px] border-b border-r border-sys-border p-2 transition-colors ${
                      canChooseTarget ? "bg-emerald-500/[0.08] ring-1 ring-inset ring-emerald-400/40" : "hover:bg-white/[0.02]"
                    }`}
                  >
                    {cellLessons.length > 0 && (
                      <div className="space-y-2">
                        {cellLessons.map((lesson) => (
                          <LessonCard
                            key={`${day.date}-${lesson.id}`}
                            lesson={lesson}
                            targetDate={day.date}
                            mode="week"
                            scheduleMode={scheduleMode}
                            canEdit={canEdit}
                            onEdit={onEdit}
                                                                                    onMoveSelect={onMoveSelect}
                          />
                        ))}
                      </div>
                    )}
                    {canChooseTarget ? (
                      <button
                        type="button"
                        aria-label={`Перемістити пару на ${new Intl.DateTimeFormat("uk-UA", { weekday: "long" }).format(new Date(`${day.date}T12:00:00`))}, ${lessonNumber}-ту пару`}
                        onClick={() => {
                          if (movingLesson) onMove?.(movingLesson, day.date, lessonNumber);
                        }}
                        className="mt-2 flex min-h-10 w-full items-center justify-center rounded-lg border border-emerald-400/40 bg-emerald-500/10 px-2 py-2 text-xs font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/20"
                      >
                        Перемістити сюди
                      </button>
                    ) : cellLessons.length === 0 ? (
                      <div className="flex min-h-[100px] items-center justify-center text-xs opacity-50 text-sys-text-muted">—</div>
                    ) : null}
                  </div>
                );
              }),
            ])}
          </div>
        </div>
      )}

      {/* DESKTOP VIEW */}
      {!canEdit && (
        <div className="hidden md:flex overflow-x-auto gap-3 xl:gap-4 items-start pb-4" style={{ scrollbarWidth: "thin" }}>
          {week.map((day) => (
            <div key={`desktop-${day.date}`} className="min-w-[220px] flex-1 shrink-0">
              <ScheduleDay schedule={day} mode="day" {...dayProps} />
            </div>
          ))}
        </div>
      )}


      {!canEdit && <div className="flex w-full flex-col md:hidden">
        {week.length > 0 && (
          <div role="group" aria-label="Оберіть день тижня" className="mb-8 mt-2 flex w-full justify-between relative z-10 px-2">
            {week.map((day, idx) => {
              const dateObj = new Date(`${day.date}T12:00:00`);
              const dayStr = new Intl.DateTimeFormat("uk-UA", { weekday: "short" }).format(dateObj).charAt(0).toUpperCase();
              const dateStr = dateObj.getDate();
              const isActive = activeIdx === idx;
              return (
                <button
                  key={`tab-${day.date}`}
                  type="button"
                  onClick={() => switchTab(idx)}
                  aria-pressed={isActive}
                  className="flex flex-col items-center justify-center gap-3 w-10 transition-colors focus:outline-none"
                >
                  <span className={`text-[12px] font-semibold ${isActive ? "text-sys-text-primary" : "text-sys-text-secondary"}`}>
                    {dayStr}
                  </span>
                  <span className={`flex h-9 w-9 items-center justify-center rounded-full text-[15px] font-bold transition-all ${
                    isActive ? "bg-sys-accent text-white shadow-[0_0_12px_rgba(88,166,255,0.4)]" : "text-sys-text-primary hover:bg-sys-card"
                  }`}>
                    {dateStr}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <div className="relative w-full overflow-hidden" style={{ minHeight: '600px' }}>
          <AnimatePresence initial={false} custom={direction}>
            {activeDay && (
              <motion.div
                key={`mobile-${activeDay.date}`}
                custom={direction}
                variants={variants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{
                  x: { type: "spring", stiffness: 300, damping: 30 },
                  opacity: { duration: 0.2 }
                }}
                className="w-full top-0 left-0"
                drag={canEdit ? false : "x"}
                dragConstraints={{ left: 0, right: 0 }}
                dragElastic={1}
                onDragEnd={(e, { offset, velocity }) => {
                  const swipe = offset.x;
                  if (swipe > 50 && activeIdx > 0) {
                    switchTab(activeIdx - 1);
                  } else if (swipe < -50 && activeIdx < week.length - 1) {
                    switchTab(activeIdx + 1);
                  }
                }}
              >
                <ScheduleDay schedule={activeDay} mode="day" {...dayProps} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>}
    </div>
  );
}
