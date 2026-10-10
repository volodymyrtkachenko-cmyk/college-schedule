import { Lesson, ScheduleResponse } from "../lib/api";
import { DEFAULT_LESSON_TIMES, LESSON_NUMBERS } from "../lib/constants/lessons";
import { LessonCard } from "./LessonCard";

const longWeekday = (date: string) =>
  new Intl.DateTimeFormat("uk-UA", { weekday: "long" }).format(new Date(`${date}T12:00:00`));
const shortDate = (date: string) =>
  new Intl.DateTimeFormat("uk-UA", { day: "numeric", month: "short" }).format(new Date(`${date}T12:00:00`));

/** Admin week table: rows are lesson slots (1-4), columns are weekdays. */
export function ScheduleEditGrid({ week, scheduleMode, onEdit, onCreate, movingLesson, onMoveSelect, onMove, canMoveTo }: {
  week: ScheduleResponse[];
  scheduleMode: "student" | "teacher";
  onEdit?: (lesson: Lesson) => void;
  onCreate?: (date: string) => void;
  movingLesson?: Lesson | null;
  onMoveSelect?: (lesson: Lesson | null) => void;
  onMove?: (lesson: Lesson, date: string, lessonNumber: number) => void;
  canMoveTo: (lesson: Lesson, date: string, lessonNumber: number) => boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-sys-border bg-sys-card/50">
      <div className="grid min-w-[1000px] grid-cols-[5.5rem_repeat(5,minmax(11rem,1fr))]">
        <div className="sticky left-0 z-20 border-b border-r border-sys-border bg-sys-card p-3 text-center text-xs font-semibold uppercase text-sys-text-muted">
          Пара
        </div>
        {week.map((day) => (
          <div key={day.date} className="border-b border-r border-sys-border bg-sys-card px-3 py-3 text-center">
            <h3 className="font-semibold capitalize text-sys-text-primary">{longWeekday(day.date)}</h3>
            <span className="text-xs text-sys-text-muted">{shortDate(day.date)}</span>
            <button type="button" onClick={() => onCreate?.(day.date)}
              className="mt-2 block min-h-[36px] w-full rounded-lg border border-dashed border-sys-border px-2 py-1.5 text-xs text-sys-text-secondary transition-colors hover:border-sys-accent hover:bg-sys-accent/5 hover:text-sys-accent">
              + Додати
            </button>
          </div>
        ))}

        {LESSON_NUMBERS.flatMap((lessonNumber) => [
          <div key={`lesson-${lessonNumber}`} className="sticky left-0 z-10 border-b border-r border-sys-border bg-sys-card p-3 text-center">
            <div className="text-lg font-bold text-sys-text-primary">{lessonNumber}</div>
            <div className="text-xs text-sys-text-muted">{DEFAULT_LESSON_TIMES[lessonNumber]}</div>
          </div>,
          ...week.map((day) => {
            const cellLessons = day.lessons.filter((lesson) => lesson.lesson_number === lessonNumber);
            const hasReplacement = cellLessons.some((lesson) => lesson.is_replacement);
            const canChooseTarget = !!movingLesson && canMoveTo(movingLesson, day.date, lessonNumber);
            const drop = () => { if (movingLesson && canChooseTarget) onMove?.(movingLesson, day.date, lessonNumber); };
            return (
              <div key={`${day.date}-${lessonNumber}`}
                onDragOver={(event) => { if (canChooseTarget) event.preventDefault(); }}
                onDrop={(event) => { event.preventDefault(); drop(); }}
                className={`min-h-[110px] border-b border-r border-sys-border p-2 transition-colors ${
                  canChooseTarget
                    ? hasReplacement ? "bg-amber-500/[0.12] ring-1 ring-inset ring-amber-400/50" : "bg-emerald-500/[0.08] ring-1 ring-inset ring-emerald-400/40"
                    : "hover:bg-white/[0.02]"
                }`}>
                {cellLessons.length > 0 && (
                  <div className="space-y-2">
                    {cellLessons.map((lesson) => (
                      <LessonCard key={`${day.date}-${lesson.id}`} lesson={lesson} targetDate={day.date} mode="week"
                        scheduleMode={scheduleMode} canEdit onEdit={onEdit} movingLesson={movingLesson} onMoveSelect={onMoveSelect} />
                    ))}
                  </div>
                )}
                {canChooseTarget ? (
                  <button type="button" onClick={drop}
                    aria-label={`Перемістити пару на ${longWeekday(day.date)}, ${lessonNumber}-ту пару`}
                    className={`mt-2 flex min-h-10 w-full items-center justify-center rounded-lg border px-2 py-2 text-xs font-semibold transition-colors ${
                      hasReplacement ? "border-amber-400/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20" : "border-emerald-400/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
                    }`}>
                    Перемістити сюди
                  </button>
                ) : cellLessons.length === 0 ? (
                  <div className="flex min-h-[90px] items-center justify-center text-xs text-sys-text-muted/50">—</div>
                ) : null}
              </div>
            );
          }),
        ])}
      </div>
    </div>
  );
}
