import { Lesson, ScheduleResponse } from "../lib/api";
import { LessonCard } from "./LessonCard";

function dayName(value: string) {
  return new Intl.DateTimeFormat("uk-UA", { weekday: "long" }).format(new Date(`${value}T12:00:00`));
}

function shortDate(value: string) {
  return new Intl.DateTimeFormat("uk-UA", { day: "numeric", month: "short" }).format(new Date(`${value}T12:00:00`));
}

export function ScheduleDay({ schedule, isToday = false, canEdit = false, onEdit, onCreate, onNoteSave, onNoteDelete }: {
  schedule: ScheduleResponse; isToday?: boolean; canEdit?: boolean;
  onEdit?: (lesson: Lesson) => void; onCreate?: (date: string) => void;
  onNoteSave?: (lesson: Lesson, note: string, date: string) => Promise<void>;
  onNoteDelete?: (lesson: Lesson, date: string) => Promise<void>;
}) {
  return (
    <section className={`min-w-0 ${isToday ? "rounded-2xl ring-1 ring-cyan-400/20" : ""}`}>
      <header className="mb-3 flex items-baseline justify-between gap-2 px-3 pt-2">
        <h2 className="capitalize font-semibold text-slate-100">{dayName(schedule.date)}</h2>
        <span className={`pr-2 text-sm ${isToday ? "font-semibold text-cyan-300" : "text-slate-500"}`}>
          {isToday ? "Сьогодні · " : ""}{shortDate(schedule.date)}
        </span>
      </header>
      {schedule.lessons.length ? (
        <div className="min-w-0 space-y-2">
          {schedule.lessons.map((lesson) => <LessonCard key={lesson.id} lesson={lesson} targetDate={schedule.date} canEdit={canEdit} onEdit={onEdit}
            onNoteSave={onNoteSave ? (note) => onNoteSave(lesson, note, schedule.date) : undefined}
            onNoteDelete={onNoteDelete ? () => onNoteDelete(lesson, schedule.date) : undefined} />)}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-slate-800 px-4 py-8 text-center text-sm text-slate-500">Пар немає</div>
      )}
      {canEdit && <button type="button" onClick={() => onCreate?.(schedule.date)} className="mt-3 w-full rounded-lg border border-dashed border-cyan-400/40 px-3 py-2 text-sm text-cyan-300 hover:bg-cyan-400/10">+ Додати заняття</button>}
    </section>
  );
}
