"use client";
import { useState, useEffect } from "react";
import { Lesson, ScheduleResponse } from "../lib/api";
import { ScheduleDay } from "./ScheduleDay";
import { motion, AnimatePresence } from "framer-motion";

export function ScheduleWeekGrid({ week, scheduleMode = "student", canEdit = false, onEdit, onCreate, onNoteSave, onNoteDelete }: {
  week: ScheduleResponse[]; scheduleMode?: "student"|"teacher"; canEdit?: boolean; onEdit?: (lesson: Lesson) => void; onCreate?: (date: string) => void;
  onNoteSave?: (lesson: Lesson, note: string, date: string) => Promise<void>;
  onNoteDelete?: (lesson: Lesson, date: string) => Promise<void>;
}) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [direction, setDirection] = useState(0);

  // Keep the active day aligned with reality when week array changes
  useEffect(() => {
     if (week.length === 0) return;
     const todayStr = new Date().toISOString().slice(0, 10);
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
  const getDayName = (dateStr: string) => {
     const d = new Date(dateStr);
     return new Intl.DateTimeFormat("uk-UA", { weekday: "short" }).format(d);
  };

  const variants = {
    enter: (dir: number) => ({
      x: dir > 0 ? -300 : 300,
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
      x: dir > 0 ? 300 : -300,
      opacity: 0,
      position: "absolute" as any,
    })
  };

  return (
    <div className="w-full pb-4">
      {/* DESKTOP VIEW */}
      <div className="hidden xl:grid min-w-0 gap-6 grid-cols-5 xl:gap-3">
        {week.map((day) => <ScheduleDay key={`desktop-${day.date}`} schedule={day} mode="week" scheduleMode={scheduleMode} canEdit={canEdit} onEdit={onEdit} onCreate={onCreate} onNoteSave={onNoteSave} onNoteDelete={onNoteDelete} />)}
      </div>

      {/* MOBILE/TABLET VIEW */}
      <div className="flex xl:hidden flex-col w-full">
        {week.length > 0 && (
          <div className="flex bg-sys-card border border-sys-border rounded-xl p-1 mb-6 relative z-10 w-full sm:w-[400px] sm:mx-auto justify-between">
            {week.map((day, idx) => (
              <button
                key={`tab-${day.date}`}
                type="button"
                onClick={() => switchTab(idx)}
                style={{ width: `${100 / week.length}%` }}
                className={`relative flex-1 py-2 text-[13px] font-bold uppercase tracking-wider z-10 transition-colors ${
                  activeIdx === idx ? 'text-[#0b1120]' : 'text-sys-text-secondary hover:text-sys-text-primary'
                }`}
              >
                {getDayName(day.date)}
              </button>
            ))}
            <div 
              className="absolute top-1 bottom-1 bg-sys-accent rounded-lg transition-all duration-300 ease-out z-0 shadow-sm"
              style={{ 
                width: week.length > 0 ? `calc((100% - 8px) / ${week.length})` : '0px', 
                left: week.length > 0 ? `calc(4px + (100% - 8px) * ${activeIdx} / ${week.length})` : '0px'
              }}
            />
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
                drag="x"
                dragConstraints={{ left: 0, right: 0 }}
                dragElastic={1}
                onDragEnd={(e, { offset, velocity }) => {
                  const swipe = offset.x;
                  if (swipe > 50 && activeIdx < week.length - 1) {
                    switchTab(activeIdx + 1);
                  } else if (swipe < -50 && activeIdx > 0) {
                    switchTab(activeIdx - 1);
                  }
                }}
              >
                <ScheduleDay schedule={activeDay} mode="week" scheduleMode={scheduleMode} canEdit={canEdit} onEdit={onEdit} onCreate={onCreate} onNoteSave={onNoteSave} onNoteDelete={onNoteDelete} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
