import { useState, useRef, useEffect } from "react";
import { Lesson, ScheduleResponse } from "../lib/api";
import { DEFAULT_LESSON_TIMES, LESSON_NUMBERS } from "../lib/constants/lessons";
import { LessonCard, QuickJumpTarget } from "./LessonCard";

const longWeekday = (date: string) =>
  new Intl.DateTimeFormat("uk-UA", { weekday: "long" }).format(new Date(`${date}T12:00:00`));
const shortDate = (date: string) =>
  new Intl.DateTimeFormat("uk-UA", { day: "numeric", month: "short" }).format(new Date(`${date}T12:00:00`));

const KYIV_DATE_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" });
const KYIV_TIME_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Kyiv",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function isSlotInPast(slotDate: string, lessonNumber: number) {
  const now = new Date();
  const todayIso = KYIV_DATE_FMT.format(now);
  if (slotDate < todayIso) return true;
  if (slotDate > todayIso) return false;
  const lessonTimes: Record<number, string> = {
    1: "10:20",
    2: "12:00",
    3: "13:50",
    4: "15:20",
    5: "16:50",
  };
  const endTime = lessonTimes[lessonNumber];
  if (!endTime) return false;
  const nowTime = KYIV_TIME_FMT.format(now);
  return nowTime >= endTime;
}

export interface DayActionOptions {
  onCopyDay?: (date: string) => void;
  onMoveDay?: (date: string) => void;
  onSelectDayLessons?: (date: string) => void;
  onPasteDay?: (targetDate: string) => void;
  canPasteDay?: boolean;
}

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
  // Selection & swap
  isSelectMode,
  selectedLessonIds,
  onToggleSelectLesson,
  onSelectMultipleLessons,
  swapSourceLesson,
  swapSourceDate,
  onSwapSelectLesson,
  // Buffer slot paste
  hasBufferContent,
  onPasteToSlot,
  // Day actions
  onCopyDay,
  onMoveDay,
  onSelectDayLessons,
  onPasteDay,
  canPasteDay,
  onOpenPermanentSchedule,
  onRemoveReplacement,
}: {
  week: ScheduleResponse[];
  scheduleMode: "student" | "teacher";
  onEdit?: (lesson: Lesson) => void;
  onCreate?: (date: string, lessonNumber?: number) => void;
  movingLesson?: Lesson | null;
  onMoveSelect?: (lesson: Lesson | null) => void;
  onCopySelect?: (lesson: Lesson) => void;
  onCancelDated?: (lesson: Lesson, date: string) => void;
  onRestoreDated?: (lesson: Lesson, date: string) => void;
  onRemoveReplacement?: (lesson: Lesson, date: string) => void;
  onQuickJump?: (target: QuickJumpTarget) => void;
  onMove?: (lesson: Lesson, date: string, lessonNumber: number) => void;
  canMoveTo: (lesson: Lesson, date: string, lessonNumber: number) => boolean;
  // Selection & swap
  isSelectMode?: boolean;
  selectedLessonIds?: Set<number>;
  onToggleSelectLesson?: (lesson: Lesson) => void;
  onSelectMultipleLessons?: (lesson: Lesson) => void;
  swapSourceLesson?: Lesson | null;
  swapSourceDate?: string | null;
  onSwapSelectLesson?: (lesson: Lesson, date: string) => void;
  // Buffer slot paste
  hasBufferContent?: boolean;
  onPasteToSlot?: (date: string, lessonNumber: number) => void;
  // Day actions
  onCopyDay?: (date: string) => void;
  onMoveDay?: (date: string) => void;
  onSelectDayLessons?: (date: string) => void;
  onPasteDay?: (targetDate: string) => void;
  canPasteDay?: boolean;
  onOpenPermanentSchedule?: (lesson: Lesson) => void;
}) {
  const [activeDayMenu, setActiveDayMenu] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!activeDayMenu) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setActiveDayMenu(null);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [activeDayMenu]);

  return (
    <div
      className="overflow-x-auto rounded-2xl border border-sys-border bg-sys-card/50 relative shadow-sm"
      style={{ scrollSnapType: "x proximity" }}
    >
      <div className="grid min-w-[1026px] grid-cols-[76px_repeat(5,minmax(190px,1fr))]">
        {/* Sticky top-left header */}
        <div className="sticky left-0 top-0 z-30 border-b border-r border-sys-border bg-sys-card p-2 text-center text-xs font-semibold uppercase text-sys-text-muted flex items-center justify-center">
          Пара
        </div>

        {/* Sticky top day headers */}
        {week.map((day) => {
          const isMenuOpen = activeDayMenu === day.date;
          return (
            <div
              key={day.date}
              className="sticky top-0 z-20 border-b border-r border-sys-border bg-sys-card px-2.5 py-2 text-center snap-start"
            >
              <div className="flex items-center justify-between gap-1">
                <div className="flex-1 text-left min-w-0">
                  <h3 className="font-semibold text-sm capitalize text-sys-text-primary truncate">
                    {longWeekday(day.date)}
                  </h3>
                  <span className="text-[11px] text-sys-text-muted">{shortDate(day.date)}</span>
                </div>

                {/* Day actions menu button */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setActiveDayMenu(isMenuOpen ? null : day.date)}
                    className="p-1 rounded-md text-sys-text-muted hover:text-sys-text-primary hover:bg-white/5 transition-colors"
                    aria-label={`Дії для ${longWeekday(day.date)}`}
                    title="Дії з днем"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                      <circle cx="12" cy="5" r="2" />
                      <circle cx="12" cy="12" r="2" />
                      <circle cx="12" cy="19" r="2" />
                    </svg>
                  </button>

                  {isMenuOpen && (
                    <div
                      ref={menuRef}
                      className="absolute right-0 top-full mt-1 z-50 w-48 rounded-xl border border-sys-border bg-sys-card p-1 text-left shadow-xl animate-in fade-in zoom-in-95 duration-150"
                    >
                      {onCopyDay && (
                        <button
                          type="button"
                          onClick={() => {
                            setActiveDayMenu(null);
                            onCopyDay(day.date);
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-sys-text-secondary hover:bg-white/5 hover:text-sys-text-primary transition-colors"
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                            <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                          </svg>
                          <span>Копіювати день</span>
                        </button>
                      )}

                      {onMoveDay && (
                        <button
                          type="button"
                          onClick={() => {
                            setActiveDayMenu(null);
                            onMoveDay(day.date);
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-sys-text-secondary hover:bg-white/5 hover:text-sys-text-primary transition-colors"
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="5 9 2 12 5 15" />
                            <polyline points="9 5 12 2 15 5" />
                            <polyline points="15 19 12 22 9 19" />
                            <polyline points="19 9 22 12 19 15" />
                            <line x1="2" x2="22" y1="12" y2="12" />
                            <line x1="12" x2="12" y1="2" y2="22" />
                          </svg>
                          <span>Перемістити день</span>
                        </button>
                      )}

                      {canPasteDay && (
                        <>
                          <div className="my-1 border-t border-sys-border/40" />
                          <button
                            type="button"
                            onClick={() => {
                              setActiveDayMenu(null);
                              onPasteDay?.(day.date);
                            }}
                            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-sys-accent hover:bg-sys-accent/10 transition-colors"
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
                              <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
                            </svg>
                            <span>Вставити день сюди</span>
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={() => onCreate?.(day.date)}
                className="mt-1.5 block min-h-[28px] w-full rounded-md border border-dashed border-sys-border px-2 py-0.5 text-xs text-sys-text-secondary transition-colors hover:border-sys-accent hover:bg-sys-accent/5 hover:text-sys-accent active:scale-[0.98]"
              >
                + Додати
              </button>
            </div>
          );
        })}

        {/* Rows by lesson number */}
        {LESSON_NUMBERS.flatMap((lessonNumber) => [
          <div
            key={`lesson-${lessonNumber}`}
            className="sticky left-0 z-10 border-b border-r border-sys-border bg-sys-card p-2 text-center self-stretch min-h-[96px] flex flex-col justify-center items-center"
          >
            <div className="text-base font-bold text-sys-text-primary">{lessonNumber}</div>
            <div className="text-[10px] text-sys-text-muted leading-tight mt-0.5">
              {DEFAULT_LESSON_TIMES[lessonNumber]}
            </div>
          </div>,

          ...week.map((day) => {
            const cellLessons = day.lessons.filter((lesson) => lesson.lesson_number === lessonNumber);
            const hasReplacement = cellLessons.some((lesson) => lesson.is_replacement);
            const isPast = isSlotInPast(day.date, lessonNumber);
            const canChooseTarget = !isPast && !!movingLesson && canMoveTo(movingLesson, day.date, lessonNumber);
            const isSwapMode = !isPast && !!swapSourceLesson;
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
                className={`border-b border-r border-sys-border p-1.5 transition-colors self-stretch min-h-[96px] flex flex-col justify-start ${
                  isPast && (movingLesson || swapSourceLesson)
                    ? "opacity-40 bg-black/10 cursor-not-allowed"
                    : canChooseTarget
                    ? hasReplacement
                      ? "bg-amber-500/[0.12] ring-1 ring-inset ring-amber-400/50"
                      : "bg-emerald-500/[0.08] ring-1 ring-inset ring-emerald-400/40"
                    : isSwapMode
                      ? "hover:bg-sys-accent/5"
                      : "hover:bg-white/[0.02]"
                }`}
              >
                {cellLessons.length > 0 ? (
                  <div className="space-y-1.5 flex-1 flex flex-col justify-between">
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
                        onRemoveReplacement={onRemoveReplacement}
                        onQuickJump={onQuickJump}
                        isSelectMode={isSelectMode}
                        isSelected={selectedLessonIds?.has(lesson.id)}
                        onToggleSelect={() => onToggleSelectLesson?.(lesson)}
                        onSwapSelect={isPast ? undefined : () => onSwapSelectLesson?.(lesson, day.date)}
                        onOpenPermanentSchedule={onOpenPermanentSchedule}
                        isSwapSource={swapSourceLesson?.id === lesson.id && swapSourceDate === day.date}
                      />
                    ))}
                  </div>
                ) : canChooseTarget ? (
                  <button
                    type="button"
                    onClick={drop}
                    aria-label={`Перемістити пару на ${longWeekday(day.date)}, ${lessonNumber}-ту пару`}
                    className={`flex flex-1 min-h-[50px] w-full items-center justify-center rounded-lg border px-2 py-2 text-xs font-semibold transition-colors ${
                      hasReplacement
                        ? "border-amber-400/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20"
                        : "border-emerald-400/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
                    }`}
                  >
                    Перемістити сюди
                  </button>
                ) : isSwapMode && swapSourceLesson ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (onMove && swapSourceLesson) {
                        onMove(swapSourceLesson, day.date, lessonNumber);
                      }
                    }}
                    aria-label={`Перемістити сюди пару ${swapSourceLesson.subject_name}`}
                    className="flex flex-1 min-h-[50px] w-full items-center justify-center rounded-lg border border-sys-accent/40 bg-sys-accent/10 px-2 py-2 text-xs font-semibold text-sys-accent hover:bg-sys-accent/20 transition-colors"
                  >
                    ⇄ Перемістити сюди
                  </button>
                ) : hasBufferContent && onPasteToSlot ? (
                  <button
                    type="button"
                    onClick={() => onPasteToSlot(day.date, lessonNumber)}
                    className="flex flex-1 min-h-[50px] w-full items-center justify-center rounded-lg border border-dashed border-sys-accent/40 bg-sys-accent/5 px-2 py-2 text-xs font-semibold text-sys-accent hover:bg-sys-accent/15 transition-colors"
                  >
                    📋 Вставити сюди
                  </button>
                ) : (
                  <div
                    onClick={() => onCreate?.(day.date, lessonNumber)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") onCreate?.(day.date, lessonNumber);
                    }}
                    title="Натисніть щоб додати пару"
                    className="group flex flex-1 items-center justify-center text-xs text-sys-text-muted/40 hover:text-sys-accent cursor-pointer transition-colors"
                  >
                    <span className="group-hover:hidden">—</span>
                    <span className="hidden group-hover:inline text-[11px] font-medium">+ Додати</span>
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
