import { Lesson, ScheduleResponse } from "../lib/api";
import { LessonCard } from "./LessonCard";

function dayName(value: string) {
  return new Intl.DateTimeFormat("uk-UA", { weekday: "long" }).format(new Date(`${value}T12:00:00`));
}

function shortDate(value: string) {
  return new Intl.DateTimeFormat("uk-UA", { day: "numeric", month: "short" }).format(new Date(`${value}T12:00:00`));
}

export function ScheduleDay({ schedule, isToday = false, mode = "day", scheduleMode = "student", canEdit = false, onEdit, onCreate, onNoteSave, onNoteDelete }: {
  schedule: ScheduleResponse; isToday?: boolean; mode?: "day"|"week"; scheduleMode?: "student"|"teacher"; canEdit?: boolean;
  onEdit?: (lesson: Lesson) => void; onCreate?: (date: string) => void;
  onNoteSave?: (lesson: Lesson, note: string, date: string) => Promise<void>;
  onNoteDelete?: (lesson: Lesson, date: string) => Promise<void>;
}) {
  return (
    <section className={`min-w-0 ${isToday ? "rounded-2xl ring-1 ring-sys-accent/20" : ""}`}>
      <header className={`mb-3 flex ${mode === "week" ? "flex-col items-start gap-1" : "items-baseline justify-between gap-2"} px-3 pt-2`}>
        <h2 className="capitalize font-semibold text-sys-text-primary">{dayName(schedule.date)}</h2>
        <span className={`pr-2 text-sm ${isToday ? "font-semibold text-sys-accent" : "text-sys-text-muted"}`}>
          {isToday ? "Сьогодні · " : ""}{shortDate(schedule.date)}
        </span>
      </header>
      {schedule.lessons.length ? (
        <div className="min-w-0 space-y-2">
                    {schedule.lessons.map((lesson) => <LessonCard key={lesson.id} lesson={lesson} targetDate={schedule.date} mode={mode} scheduleMode={scheduleMode} canEdit={canEdit} onEdit={onEdit}
            onNoteSave={onNoteSave ? (note) => onNoteSave(lesson, note, schedule.date) : undefined}
            onNoteDelete={onNoteDelete ? () => onNoteDelete(lesson, schedule.date) : undefined} />)}
                  </div>
      ) : (
        <div className="rounded-xl border-[0.5px] border-dashed border-slate-800 px-4 py-8 text-center text-sm text-sys-text-muted">Пар немає</div>
      )}
      {canEdit && <button type="button" onClick={() => onCreate?.(schedule.date)} className={`mt-3 w-full rounded-[8px] border-[0.5px] border-dashed border-sys-border px-3 py-2 text-sm text-sys-text-muted hover:border-sys-accent hover:text-sys-accent transition-colors ${mode === "week" ? "py-1.5 text-[13px]" : ""}`}>+ {mode === "week" ? "Додати" : "Додати заняття"}</button>}
    </section>
  );
}
