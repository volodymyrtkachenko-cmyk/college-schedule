import { LessonNote } from "./LessonNote";
import { EditIcon, MoveIcon } from "./LessonIcons";
import { Lesson } from "../lib/api";
import { formatRoom, formatTeachers } from "../lib/format";

const ICON_BUTTON =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-base transition-colors";

export function LessonCard({
  lesson, targetDate, mode, scheduleMode, canEdit, onEdit, movingLesson, onMoveSelect,
}: {
  lesson: Lesson;
  targetDate: string;
  mode: "today" | "week" | "day";
  scheduleMode: "student" | "teacher" | "admin";
  canEdit: boolean;
  onEdit?: (lesson: Lesson) => void;
  movingLesson?: Lesson | null;
  onMoveSelect?: (lesson: Lesson | null) => void;
}) {
  const isSelectedForMove = movingLesson?.id === lesson.id;
  const isDay = mode !== "week";
  const canMove = canEdit && !!onMoveSelect && !lesson.is_replacement;
  const [startT, endT] = lesson.time.split("-");

  const secondary =
    scheduleMode === "teacher" && lesson.group_name
      ? `Група ${lesson.group_name}`
      : lesson.teacher_name ? formatTeachers(lesson.teacher_name) : null;

  const stateClass = lesson.is_replacement
    ? "border-sys-warning/40 ring-1 ring-sys-warning/60 bg-sys-warning/[0.03]"
    : isSelectedForMove
      ? "border-emerald-400 ring-1 ring-emerald-400/70"
      : "border-sys-border";

  return (
    <article
      draggable={canMove}
      onDragStart={(event) => {
        if (!canMove) { event.preventDefault(); return; }
        event.dataTransfer.setData("text/plain", String(lesson.id));
        event.dataTransfer.effectAllowed = "move";
        onMoveSelect?.(lesson);
      }}
      className={`relative flex min-w-0 flex-col overflow-hidden rounded-xl border bg-sys-card shadow-sm transition-colors ${
        isDay ? "p-3 xl:p-4" : "p-2.5"
      } ${stateClass} ${lesson.is_relevant_this_week ? "" : "opacity-60"} ${canMove ? "cursor-grab active:cursor-grabbing" : ""}`}
    >
      <div className={`flex items-start ${isDay ? "gap-3 xl:gap-4" : "gap-2"}`}>
        {isDay && (
          <div className="flex w-12 shrink-0 flex-col text-left sm:w-14">
            <span className="mb-1 text-xl font-bold leading-none text-sys-neon">{lesson.lesson_number}</span>
            <span className="text-xs font-medium text-sys-text-secondary">{startT}</span>
            <span className="text-xs font-medium text-sys-text-secondary">{endT}</span>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex items-start justify-between gap-2">
            <h3 className={`min-w-0 flex-1 break-words font-bold leading-snug text-sys-text-subject ${isDay ? "text-base" : "text-sm"}`}>
              {lesson.subject_name}
            </h3>
            {canEdit && (
              <div className="flex shrink-0 items-center">
                <button type="button" aria-label={`Редагувати ${lesson.subject_name}`} onClick={() => onEdit?.(lesson)}
                  className={`${ICON_BUTTON} text-sys-text-secondary hover:bg-sys-accent/10 hover:text-sys-accent`}>
                  <EditIcon />
                </button>
                {canMove && !movingLesson && (
                  <button type="button" aria-label="Перемістити пару"
                    onClick={(event) => { event.stopPropagation(); onMoveSelect?.(lesson); }}
                    className={`${ICON_BUTTON} text-sys-text-secondary hover:bg-sys-accent/10 hover:text-sys-accent`}>
                    <MoveIcon />
                  </button>
                )}
              </div>
            )}
          </div>

          {(secondary || lesson.room) && (
            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
              {secondary && <p className="min-w-0 break-words text-sm text-sys-text-secondary">{secondary}</p>}
              {lesson.room && (
                <span className="ml-auto shrink-0 rounded-md border border-sys-border bg-sys-tabActive px-2 py-0.5 text-xs text-sys-text-primary">
                  {formatRoom(lesson.room)}
                </span>
              )}
            </div>
          )}

          {lesson.is_replacement && (
            <span className="inline-flex w-fit rounded bg-sys-warning px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-sys-warningText">
              Заміна
            </span>
          )}
        </div>
      </div>

      <LessonNote key={`${lesson.group_id}:${targetDate}:${lesson.lesson_number}:${lesson.subject_id}`} lesson={lesson} date={targetDate} />
    </article>
  );
}
