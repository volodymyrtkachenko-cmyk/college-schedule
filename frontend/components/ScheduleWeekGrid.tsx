"use client";
import { useState, useEffect } from "react";
import { Lesson, ScheduleResponse } from "../lib/api";
import { canMoveLesson } from "../lib/scheduleMove";
import { ScheduleDay } from "./ScheduleDay";
import { ScheduleEditGrid } from "./ScheduleEditGrid";
import { motion, AnimatePresence } from "framer-motion";

const dayVariants = {
  enter: (dir: number) => ({ x: dir > 0 ? 300 : -300, opacity: 0, zIndex: 0, position: "absolute" as const }),
  center: { zIndex: 1, x: 0, opacity: 1, position: "relative" as const },
  exit: (dir: number) => ({ zIndex: 0, x: dir > 0 ? -300 : 300, opacity: 0, position: "absolute" as const }),
};

const localDateString = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

export function ScheduleWeekGrid({ week, availabilityWeek, availabilityError, scheduleMode = "student", canEdit = false, onEdit, onCreate, movingLesson, onMoveSelect, onMove }: {
  week: ScheduleResponse[]; scheduleMode?: "student" | "teacher"; canEdit?: boolean; onEdit?: (lesson: Lesson) => void; onCreate?: (date: string) => void;
  availabilityWeek?: ScheduleResponse[] | null;
  availabilityError?: string | null;
  movingLesson?: Lesson | null;
  onMoveSelect?: (lesson: Lesson | null) => void;
  onMove?: (lesson: Lesson, date: string, lessonNumber: number) => void;
}) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [direction, setDirection] = useState(0);

  // Keep the active day aligned with reality when the week changes
  useEffect(() => {
    if (week.length === 0) return;
    const todayIdx = week.findIndex((day) => day.date === localDateString());
    setActiveIdx(todayIdx !== -1 ? todayIdx : 0);
  }, [week]);

  const switchTab = (idx: number) => {
    if (idx === activeIdx) return;
    setDirection(idx > activeIdx ? 1 : -1);
    setActiveIdx(idx);
  };

  const canMoveTo = (lesson: Lesson, date: string, lessonNumber: number) =>
    canMoveLesson(lesson, date, lessonNumber, week, availabilityWeek);

  if (canEdit) {
    return (
      <div className="w-full pb-4">
        {movingLesson && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-400/30 bg-emerald-500/[0.08] px-4 py-3">
            <p className="text-sm text-sys-text-primary">
              Перетягніть <strong>{movingLesson.subject_name}</strong> або виберіть підсвічене вільне місце.
              {availabilityWeek ? " Перевіряємо конфлікти групи та викладача в усьому розкладі." : " Перевіряємо доступні місця…"}
            </p>
            <button type="button" onClick={() => onMoveSelect?.(null)}
              className="rounded-lg border border-sys-border px-3 py-1.5 text-sm font-medium text-sys-text-secondary hover:text-sys-text-primary">
              Скасувати
            </button>
          </div>
        )}
        {availabilityError && (
          <p role="alert" className="mb-4 rounded-xl border border-rose-400/30 bg-rose-400/5 px-4 py-3 text-sm text-rose-200">
            Не вдалося перевірити вільні місця: {availabilityError} Вільні місця не підсвічено, але під час збереження система ще раз перевірить розклад.
          </p>
        )}
        <ScheduleEditGrid week={week} scheduleMode={scheduleMode} onEdit={onEdit} onCreate={onCreate}
          movingLesson={movingLesson} onMoveSelect={onMoveSelect} onMove={onMove} canMoveTo={canMoveTo} />
      </div>
    );
  }

  const activeDay = week[activeIdx];
  return (
    <div className="w-full pb-4">
      {/* Desktop: all days side by side */}
      <div className="hidden items-start gap-3 overflow-x-auto pb-4 md:flex xl:gap-4" style={{ scrollbarWidth: "thin" }}>
        {week.map((day) => (
          <div key={`desktop-${day.date}`} className="min-w-[220px] flex-1 shrink-0">
            <ScheduleDay schedule={day} mode="day" scheduleMode={scheduleMode} />
          </div>
        ))}
      </div>

      {/* Mobile: day tabs + swipeable day */}
      <div className="flex w-full flex-col md:hidden">
        {week.length > 0 && (
          <div role="group" aria-label="Оберіть день тижня" className="relative z-10 mb-8 mt-2 flex w-full justify-between px-2">
            {week.map((day, idx) => {
              const dateObj = new Date(`${day.date}T12:00:00`);
              const dayLetter = new Intl.DateTimeFormat("uk-UA", { weekday: "short" }).format(dateObj).charAt(0).toUpperCase();
              const isActive = activeIdx === idx;
              return (
                <button key={`tab-${day.date}`} type="button" onClick={() => switchTab(idx)} aria-pressed={isActive}
                  className="flex w-10 flex-col items-center justify-center gap-3 transition-colors focus:outline-none">
                  <span className={`text-xs font-semibold ${isActive ? "text-sys-text-primary" : "text-sys-text-secondary"}`}>{dayLetter}</span>
                  <span className={`flex h-9 w-9 items-center justify-center rounded-full text-[15px] font-bold transition-all ${
                    isActive ? "bg-sys-accent text-white shadow-[0_0_12px_rgba(88,166,255,0.4)]" : "text-sys-text-primary hover:bg-sys-card"
                  }`}>
                    {dateObj.getDate()}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <div className="relative min-h-[600px] w-full overflow-hidden">
          <AnimatePresence initial={false} custom={direction}>
            {activeDay && (
              <motion.div key={`mobile-${activeDay.date}`} custom={direction} variants={dayVariants}
                initial="enter" animate="center" exit="exit"
                transition={{ x: { type: "spring", stiffness: 300, damping: 30 }, opacity: { duration: 0.2 } }}
                className="left-0 top-0 w-full"
                drag="x" dragConstraints={{ left: 0, right: 0 }} dragElastic={1}
                onDragEnd={(_, { offset }) => {
                  if (offset.x > 50 && activeIdx > 0) switchTab(activeIdx - 1);
                  else if (offset.x < -50 && activeIdx < week.length - 1) switchTab(activeIdx + 1);
                }}>
                <ScheduleDay schedule={activeDay} mode="day" scheduleMode={scheduleMode} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
