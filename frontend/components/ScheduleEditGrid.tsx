import { Lesson, ScheduleResponse } from "../lib/api";
import { DEFAULT_LESSON_TIMES, LESSON_NUMBERS } from "../lib/constants/lessons";
import { LessonCard, QuickJumpTarget } from "./LessonCard";

const longWeekday = (date: string) =>
  new Intl.DateTimeFormat("uk-UA", { weekday: "long" }).format(new Date(`${date}T12:00:00`));
const shortDate = (date: string) =>
  new Intl.DateTimeFormat("uk-UA", { day: "numeric", month: "short" }).format(new Date(`${date}T12:00:00`));

/** Admin week table: rows are lesson slots (1-4), columns are weekdays. */
export function ScheduleEditGrid({
  week,
  scheduleMode,
  onEdit,
  onCreate,
  movingLesson,
  onMoveSelect,
  onCopySelect,
  onCancelDated,
  onRestoreDated,
  onQuickJump,
  onMove,
  canMoveTo,
}: {
  week: ScheduleResponse[];
  scheduleMode: "student" | "teacher";
  onEdit?: (lesson: Lesson) => void;
  onCreate?: (date: string) => void;
  movingLesson?: Lesson | null;
  onMoveSelect?: (lesson: Lesson | null) => void;
  onCopySelect?: (lesson: Lesson) => void;
  onCancelDated?: (lesson: Lesson, date: string) => void;
  onRestoreDated?: (lesson: Lesson, date: string) => void;
  onQuickJump?: (target: QuickJumpTarget) => void;
  onMove?: (lesson: Lesson, date: string, lessonNumber: number) => void;
  canMoveTo: (lesson: Lesson, date: string, lessonNumber: number) => boolean;
}) {
  return (
    <div
      className="overflow-x-auto rounded-2xl border border-sys-border bg-sys-card/50 relative"
      style={{ scrollSnapType: "x proximity" }}
    >
      <div className="grid min-w-[1026px] grid-cols-[76px_repeat(5,minmax(190px,1fr))] items-start">
        {/* Sticky top-left header */}
        <div className="sticky left-0 top-0 z-30 border-b border-r border-sys-border bg-sys-card p-2 text-center text-xs font-semibold uppercase text-sys-text-muted">
          Пара
        </div>

        {/* Sticky top day headers */}
        {week.map((day) => (
          <div
            key={day.date}
            className="sticky top-0 z-20 border-b border-r border-sys-border bg-sys-card px-2.5 py-2.5 text-center snap-start"
          >
            <h3 className="font-semibold text-sm capitalize text-sys-text-primary truncate">
              {longWeekday(day.date)}
            </h3>
            <span className="text-xs text-sys-text-muted">{shortDate(day.date)}</span>
            <button
              type="button"
              onClick={() => onCreate?.(day.date)}
              className="mt-1.5 block min-h-[32px] w-full rounded-md border border-dashed border-sys-border px-2 py-1 text-xs text-sys-text-secondary transition-colors hover:border-sys-accent hover:bg-sys-accent/5 hover:text-sys-accent active:scale-[0.98]"
            >
              + Додати
            </button>
          </div>
        ))}

        {/* Rows by lesson number */}
        {LESSON_NUMBERS.flatMap((lessonNumber) => [
          <div
            key={`lesson-${lessonNumber}`}
            className="sticky left-0 z-10 border-b border-r border-sys-border bg-sys-card p-2 text-center"
          >
            <div className="text-base font-bold text-sys-text-primary">{lessonNumber}</div>
            <div className="text-[10px] text-sys-text-muted leading-tight mt-0.5">
              {DEFAULT_LESSON_TIMES[lessonNumber]}
            </div>
          </div>,

          ...week.map((day) => {
            const cellLessons = day.lessons.filter((lesson) => lesson.lesson_number === lessonNumber);
            const hasReplacement = cellLessons.some((lesson) => lesson.is_replacement);
            const canChooseTarget = !!movingLesson && canMoveTo(movingLesson, day.date, lessonNumber);
            const drop = () => {
              if (movingLesson && canChooseTarget) onMove?.(movingLesson, day.date, lessonNumber);
            };

            return (
              <div
                key={`${day.date}-${lessonNumber}`}
                onDragOver={(event) => {
                  if (canChooseTarget) event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  drop();
                }}
                className={`border-b border-r border-sys-border p-1.5 transition-colors ${
                  canChooseTarget
                    ? hasReplacement
                      ? "bg-amber-500/[0.12] ring-1 ring-inset ring-amber-400/50"
                      : "bg-emerald-500/[0.08] ring-1 ring-inset ring-emerald-400/40"
                    : "hover:bg-white/[0.02]"
                }`}
              >
                {cellLessons.length > 0 ? (
                  <div className="space-y-1.5">
                    {cellLessons.map((lesson) => (
                      <LessonCard
                        key={`${day.date}-${lesson.id}`}
                        lesson={lesson}
                        targetDate={day.date}
                        mode="week"
                        scheduleMode={scheduleMode}
                        canEdit
                        hideTimeColumn={true}
                        onEdit={onEdit}
                        movingLesson={movingLesson}
                        onMoveSelect={onMoveSelect}
                        onCopySelect={onCopySelect}
                        onCancelDated={onCancelDated}
                        onRestoreDated={onRestoreDated}
                        onQuickJump={onQuickJump}
                      />
                    ))}
                  </div>
                ) : canChooseTarget ? (
                  <button
                    type="button"
                    onClick={drop}
                    aria-label={`Перемістити пару на ${longWeekday(day.date)}, ${lessonNumber}-ту пару`}
                    className={`flex min-h-[50px] w-full items-center justify-center rounded-lg border px-2 py-2 text-xs font-semibold transition-colors ${
                      hasReplacement
                        ? "border-amber-400/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20"
                        : "border-emerald-400/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
                    }`}
                  >
                    Перемістити сюди
                  </button>
                ) : (
                  <div className="flex min-h-[44px] items-center justify-center text-xs text-sys-text-muted/40">
                    —
                  </div>
                )}
              </div>
            );
          }),
        ])}
      </div>
    </div>
  );
}
