import { Lesson, ScheduleResponse } from "../lib/api";
import { LessonCard } from "./LessonCard";

function dayName(value: string) {
  return new Intl.DateTimeFormat("uk-UA", { weekday: "long" }).format(new Date(`${value}T12:00:00`));
}

function shortDate(value: string) {
  return new Intl.DateTimeFormat("uk-UA", { day: "numeric", month: "short" }).format(new Date(`${value}T12:00:00`));
}

export function ScheduleDay({ schedule, isToday = false, mode = "day", scheduleMode = "student", canEdit = false, onEdit, onCreate, onNoteSave, onNoteDelete, movingLesson, onMoveSelect, onMove, canMoveTo }: {
  schedule: ScheduleResponse; isToday?: boolean; mode?: "day"|"week"; scheduleMode?: "student"|"teacher"; canEdit?: boolean;
  onEdit?: (lesson: Lesson) => void; onCreate?: (date: string) => void;
  onNoteSave?: (lesson: Lesson, note: string, date: string) => Promise<void>;
  onNoteDelete?: (lesson: Lesson, date: string) => Promise<void>;
  movingLesson?: Lesson | null;
  onMoveSelect?: (lesson: Lesson | null) => void;
  onMove?: (lesson: Lesson, date: string, lessonNumber: number) => void;
  canMoveTo?: (lesson: Lesson, date: string, lessonNumber: number) => boolean;
}) {
  const orderedLessons = [...schedule.lessons].sort(
    (left, right) => left.lesson_number - right.lesson_number || left.id - right.id,
  );
  const lessonsByNumber = new Map(orderedLessons.map((lesson) => [lesson.lesson_number, lesson]));
  const renderLesson = (lesson: Lesson) => (
    <LessonCard
      key={lesson.id}
      lesson={lesson}
      targetDate={schedule.date}
      mode={mode}
      scheduleMode={scheduleMode}
      canEdit={canEdit}
      onEdit={onEdit}
      onNoteSave={onNoteSave ? (note) => onNoteSave(lesson, note, schedule.date) : undefined}
      onNoteDelete={onNoteDelete ? () => onNoteDelete(lesson, schedule.date) : undefined}
      onMoveSelect={onMoveSelect}
      isSelectedForMove={movingLesson?.id === lesson.id}
    />
  );

  return (
    <section className={`min-w-0 ${isToday ? "rounded-2xl border border-sys-accent/20 bg-sys-card/20 p-1 ring-1 ring-sys-accent/10" : ""}`}>
      <header className={`mb-3 flex ${mode === "week" ? "flex-col items-start gap-1" : "items-baseline justify-between gap-2"} px-3 pt-2`}>
        <h2 className="capitalize font-semibold tracking-tight text-sys-text-primary">{dayName(schedule.date)}</h2>
        <span className={`pr-2 text-sm ${isToday ? "font-semibold text-sys-accent" : "text-sys-text-muted"}`}>
          {isToday ? "Сьогодні · " : ""}{shortDate(schedule.date)}
        </span>
      </header>
      {canEdit && mode === "week" ? (
        <div className="min-w-0 space-y-2">
          {[1, 2, 3, 4].map((lessonNumber) => {
            const lesson = lessonsByNumber.get(lessonNumber);
            const available = !!movingLesson && !!canMoveTo?.(movingLesson, schedule.date, lessonNumber);
            return (
              <div
                key={lessonNumber}
                onDragOver={(event) => {
                  if (available) event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (movingLesson && available) onMove?.(movingLesson, schedule.date, lessonNumber);
                }}
                className={`min-h-[4.25rem] rounded-xl transition-colors ${
                  available ? "bg-emerald-500/[0.08] ring-1 ring-inset ring-emerald-400/40" : ""
                }`}
              >
                {lesson ? renderLesson(lesson) : (
                  <button
                    type="button"
                    disabled={!available}
                    onClick={() => {
                      if (movingLesson && available) onMove?.(movingLesson, schedule.date, lessonNumber);
                    }}
                    className={`flex min-h-[4.25rem] w-full items-center justify-center rounded-xl border border-dashed px-3 text-xs transition-colors ${
                      available
                        ? "border-emerald-400/50 bg-emerald-500/10 font-semibold text-emerald-300 hover:bg-emerald-500/20"
                        : "border-sys-border/70 text-sys-text-muted"
                    }`}
                    aria-label={available ? `Перемістити пару на ${lessonNumber}-ту пару` : `Вільна ${lessonNumber}-та пара`}
                  >
                    {available ? "Перемістити сюди" : `Вільна ${lessonNumber}-та пара`}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : schedule.lessons.length ? (
        <div className="min-w-0 space-y-2">
          {orderedLessons.map(renderLesson)}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-sys-border bg-sys-card/30 px-4 py-8 text-center text-sm text-sys-text-muted">На цей день занять немає.</div>
      )}
      {canEdit && <button type="button" onClick={() => onCreate?.(schedule.date)} className={`mt-3 w-full rounded-lg border border-dashed border-sys-border px-3 py-2.5 text-sm text-sys-text-secondary transition-colors hover:border-sys-accent hover:bg-sys-accent/5 hover:text-sys-accent ${mode === "week" ? "py-2 text-[13px]" : ""}`}>+ {mode === "week" ? "Додати" : "Додати заняття"}</button>}
    </section>
  );
}
