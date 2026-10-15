"use client";
import { useState, useEffect } from "react";
import { Lesson, ScheduleResponse } from "../lib/api";
import { canMoveLesson } from "../lib/scheduleMove";
import { ScheduleDay } from "./ScheduleDay";
import { ScheduleEditGrid } from "./ScheduleEditGrid";
import { QuickJumpTarget } from "./LessonCard";
import { motion, AnimatePresence } from "framer-motion";

const dayVariants = {
  enter: (dir: number) => ({ x: dir > 0 ? 300 : -300, opacity: 0, zIndex: 0, position: "absolute" as const }),
  center: { zIndex: 1, x: 0, opacity: 1, position: "relative" as const },
  exit: (dir: number) => ({ zIndex: 0, x: dir > 0 ? -300 : 300, opacity: 0, position: "absolute" as const }),
};

const localDateString = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const UK_SHORT_WEEKDAY_FMT = new Intl.DateTimeFormat("uk-UA", { weekday: "short" });

export function ScheduleWeekGrid({
  week,
  availabilityWeek,
  availabilityError,
  scheduleMode = "student",
  canEdit = false,
  onEdit,
  onCreate,
  movingLesson,
  isCopyMode = false,
  onMoveSelect,
  onCopySelect,
  onCancelDated,
  onRestoreDated,
  onMove,
  onQuickJump,
}: {
  week: ScheduleResponse[];
  scheduleMode?: "student" | "teacher";
  canEdit?: boolean;
  onEdit?: (lesson: Lesson) => void;
  onCreate?: (date: string) => void;
  availabilityWeek?: ScheduleResponse[] | null;
  availabilityError?: string | null;
  movingLesson?: Lesson | null;
  isCopyMode?: boolean;
  onMoveSelect?: (lesson: Lesson | null) => void;
  onCopySelect?: (lesson: Lesson) => void;
  onCancelDated?: (lesson: Lesson, date: string) => void;
  onRestoreDated?: (lesson: Lesson, date: string) => void;
  onMove?: (lesson: Lesson, date: string, lessonNumber: number) => void;
  onQuickJump?: (target: QuickJumpTarget) => void;
}) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [direction, setDirection] = useState(0);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

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
              {isCopyMode ? "Оберіть підсвічене вільне місце для копіювання " : "Перетягніть "}
              <strong>{movingLesson.subject_name}</strong>
              {isCopyMode ? "." : " або виберіть підсвічене вільне місце."}
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
          movingLesson={movingLesson} onMoveSelect={onMoveSelect} onCopySelect={onCopySelect} onCancelDated={onCancelDated} onRestoreDated={onRestoreDated} onQuickJump={onQuickJump} onMove={onMove} canMoveTo={canMoveTo} />
      </div>
    );
  }

  const activeDay = week[activeIdx];
  return (
    <div className="w-full pb-4">
      {isDesktop ? (
        /* Desktop: монтується ЛИШЕ на екранах >= 768px */
        <div className="hidden items-start gap-3 overflow-x-auto pb-4 md:flex xl:gap-4" style={{ scrollbarWidth: "thin" }}>
          {week.map((day) => (
            <div key={`desktop-${day.date}`} className="min-w-[220px] flex-1 shrink-0">
              <ScheduleDay schedule={day} mode="day" scheduleMode={scheduleMode} onQuickJump={onQuickJump} />
            </div>
          ))}
        </div>
      ) : (
        /* Mobile: легкий рендер лише 1 активного дня з плавним скролом */
        <div className="flex w-full flex-col md:hidden">
          {week.length > 0 && (
            <div role="group" aria-label="Оберіть день тижня" className="relative z-10 mb-5 mt-1 flex w-full justify-between px-2">
              {week.map((day, idx) => {
                const dateObj = new Date(`${day.date}T12:00:00`);
                const dayLetter = UK_SHORT_WEEKDAY_FMT.format(dateObj).charAt(0).toUpperCase();
                const isActive = activeIdx === idx;
                return (
                  <button key={`tab-${day.date}`} type="button" onClick={() => switchTab(idx)} aria-pressed={isActive}
                    className="flex w-10 flex-col items-center justify-center gap-2 transition-colors focus:outline-none">
                    <span className={`text-xs font-semibold ${isActive ? "text-sys-text-primary" : "text-sys-text-secondary"}`}>{dayLetter}</span>
                    <span className={`flex h-9 w-9 items-center justify-center rounded-full text-[15px] font-bold transition-transform ${
                      isActive ? "bg-sys-accent text-white shadow-[0_0_12px_rgba(88,166,255,0.4)] scale-105" : "text-sys-text-primary hover:bg-sys-card"
                    }`}>
                      {dateObj.getDate()}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="relative w-full overflow-x-hidden">
            <AnimatePresence initial={false} custom={direction} mode="popLayout">
              {activeDay && (
                <motion.div
                  key={`mobile-${activeDay.date}`}
                  custom={direction}
                  variants={dayVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ x: { type: "tween", duration: 0.22, ease: "easeOut" }, opacity: { duration: 0.15 } }}
                  className="w-full touch-pan-y will-change-transform"
                  drag="x"
                  dragDirectionLock
                  dragConstraints={{ left: 0, right: 0 }}
                  dragElastic={0.25}
                  onDragEnd={(_, { offset, velocity }) => {
                    if ((offset.x > 55 || velocity.x > 400) && activeIdx > 0) switchTab(activeIdx - 1);
                    else if ((offset.x < -55 || velocity.x < -400) && activeIdx < week.length - 1) switchTab(activeIdx + 1);
                  }}
                >
                  <ScheduleDay schedule={activeDay} mode="day" scheduleMode={scheduleMode} onQuickJump={onQuickJump} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      )}
    </div>
  );
}
