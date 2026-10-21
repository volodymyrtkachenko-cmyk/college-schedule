import { useMemo } from "react";
import { Lesson, ScheduleResponse } from "../lib/api";
import { canMoveLesson } from "../lib/scheduleMove";
import { ScheduleDay } from "./ScheduleDay";
import { ScheduleEditGrid } from "./ScheduleEditGrid";
import { LessonCard, QuickJumpTarget } from "./LessonCard";

const KYIV_DATE_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" });

function longWeekday(dateStr: string): string {
  try {
    return new Intl.DateTimeFormat("uk-UA", { weekday: "long" }).format(new Date(`${dateStr}T12:00:00`));
  } catch {
    return "";
  }
}

function shortDateUk(dateStr: string): string {
  try {
    return new Intl.DateTimeFormat("uk-UA", { day: "numeric", month: "short" }).format(new Date(`${dateStr}T12:00:00`));
  } catch {
    return "";
  }
}

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
  onRemoveReplacement,
  onMove,
  onQuickJump,
  // New props
  isSelectMode,
  selectedLessonIds,
  onToggleSelectLesson,
  onSelectMultipleLessons,
  swapSourceLesson,
  swapSourceDate,
  onSwapSelectLesson,
  hasBufferContent,
  onPasteToSlot,
  onCopyDay,
  onMoveDay,
  onSelectDayLessons,
  onPasteDay,
  canPasteDay,
  onOpenPermanentSchedule,
  weekNumber,
}: {
  week: ScheduleResponse[];
  scheduleMode?: "student" | "teacher";
  canEdit?: boolean;
  onEdit?: (lesson: Lesson) => void;
  onCreate?: (date: string, lessonNumber?: number) => void;
  availabilityWeek?: ScheduleResponse[] | null;
  availabilityError?: string | null;
  movingLesson?: Lesson | null;
  isCopyMode?: boolean;
  onMoveSelect?: (lesson: Lesson | null) => void;
  onCopySelect?: (lesson: Lesson) => void;
  onCancelDated?: (lesson: Lesson, date: string) => void;
  onRestoreDated?: (lesson: Lesson, date: string) => void;
  onRemoveReplacement?: (lesson: Lesson, date: string) => void;
  onMove?: (lesson: Lesson, date: string, lessonNumber: number) => void;
  onQuickJump?: (target: QuickJumpTarget) => void;
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
  weekNumber?: number | null;
}) {
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
        <ScheduleEditGrid
          week={week}
          scheduleMode={scheduleMode}
          onEdit={onEdit}
          onCreate={onCreate}
          movingLesson={movingLesson}
          onMoveSelect={onMoveSelect}
          onCopySelect={onCopySelect}
          onCancelDated={onCancelDated}
          onRestoreDated={onRestoreDated}
          onRemoveReplacement={onRemoveReplacement}
          onQuickJump={onQuickJump}
          onMove={onMove}
          canMoveTo={canMoveTo}
          isSelectMode={isSelectMode}
          selectedLessonIds={selectedLessonIds}
          onToggleSelectLesson={onToggleSelectLesson}
          onSelectMultipleLessons={onSelectMultipleLessons}
          swapSourceLesson={swapSourceLesson}
          swapSourceDate={swapSourceDate}
          onSwapSelectLesson={onSwapSelectLesson}
          hasBufferContent={hasBufferContent}
          onPasteToSlot={onPasteToSlot}
          onCopyDay={onCopyDay}
          onMoveDay={onMoveDay}
          onSelectDayLessons={onSelectDayLessons}
          onPasteDay={onPasteDay}
          canPasteDay={canPasteDay}
          onOpenPermanentSchedule={onOpenPermanentSchedule}
        />
      </div>
    );
  }

  const kyivTodayIso = useMemo(() => {
    return KYIV_DATE_FMT.format(new Date());
  }, []);

  const allLessonNumbers = useMemo(() => {
    let max = 4;
    for (const d of week) {
      for (const l of d.lessons) {
        if (l.lesson_number > max) max = l.lesson_number;
      }
    }
    const res: number[] = [];
    for (let i = 1; i <= max; i++) res.push(i);
    return res;
  }, [week]);

  const weekDaysMeta = useMemo(() => {
    return week.map((day) => {
      const slots = new Map<number, Lesson[]>();
      let firstLessonNum = 99;
      let lastLessonNum = 0;
      let latestLesson: Lesson | null = null;

      for (const lesson of day.lessons) {
        const list = slots.get(lesson.lesson_number);
        if (list) {
          list.push(lesson);
        } else {
          slots.set(lesson.lesson_number, [lesson]);
        }
        if (lesson.lesson_number < firstLessonNum) firstLessonNum = lesson.lesson_number;
        if (lesson.lesson_number >= lastLessonNum) {
          lastLessonNum = lesson.lesson_number;
          latestLesson = lesson;
        }
      }

      const count = day.lessons.length;
      let latestEnd: string | null = null;
      if (latestLesson?.time) {
        const parts = latestLesson.time.split("-");
        if (parts[1]) latestEnd = parts[1].trim();
      }
      const summaryText =
        count > 0
          ? `${count} ${count === 1 ? "пара" : count < 5 ? "пари" : "пар"}${latestEnd ? ` · до ${latestEnd}` : ""}`
          : "пар немає";

      return {
        day,
        slots,
        firstLessonNum,
        lastLessonNum,
        summaryText,
      };
    });
  }, [week]);

  const hasAnyOverride = useMemo(
    () => week.some((d) => Boolean(d.learning_mode_override)),
    [week]
  );

  return (
    <div className="w-full pb-4">
      {/* Desktop (>= 1024px): 5-column synchronized CSS Grid by lesson numbers */}
      <div className="hidden lg:grid lg:grid-cols-5 gap-3 xl:gap-3.5 pb-4">
        {/* Row 0: Column Headers */}
        {week.map((day) => {
          const isToday = day.date === kyivTodayIso;
          const isPast = day.date < kyivTodayIso;
          return (
            <div
              key={`desktop-header-${day.date}`}
              className={`flex flex-col justify-center min-h-[64px] px-3.5 py-2.5 rounded-2xl border transition-all ${
                isToday
                  ? "bg-sys-accent/15 border-sys-accent shadow-[0_0_15px_rgba(59,130,246,0.12)] ring-1 ring-sys-accent/40"
                  : isPast
                  ? "bg-sys-card/60 border-sys-border/50 opacity-75 hover:opacity-100"
                  : "bg-sys-card border-sys-border"
              }`}
            >
              <div className="flex items-center justify-between gap-1.5">
                <span className={`text-[17px] xl:text-[18px] font-bold capitalize tracking-tight truncate ${
                  isToday ? "text-sys-accent" : "text-sys-text-primary"
                }`}>
                  {longWeekday(day.date)}
                </span>
                {isToday && (
                  <span className="shrink-0 px-2 py-0.5 rounded-full bg-sys-accent text-xs font-extrabold text-[#0b1120] uppercase tracking-wider shadow-xs">
                    Сьогодні
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between gap-1.5 mt-0.5">
                <span className={`text-xs xl:text-[13px] font-medium ${
                  isToday ? "text-sys-text-primary font-semibold" : "text-sys-text-secondary"
                }`}>
                  {shortDateUk(day.date)}
                </span>
              </div>
            </div>
          );
        })}

        {/* Optional Exception Row in Desktop Week Grid */}
        {hasAnyOverride &&
          week.map((day) => {
            const ov = day.learning_mode_override;
            if (!ov) {
              return <div key={`desktop-override-${day.date}`} className="hidden lg:block" />;
            }
            return (
              <div
                key={`desktop-override-${day.date}`}
                className={`flex items-start gap-2 rounded-2xl border px-3 py-2 text-xs shadow-xs ${
                  ov.mode === "offline"
                    ? "border-sys-accent/35 bg-sys-accent/10 text-sys-text-primary"
                    : "border-sys-warning/35 bg-sys-warning/10 text-sys-text-primary"
                }`}
              >
                <span
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                    ov.mode === "offline"
                      ? "bg-sys-accent/20 text-sys-accent"
                      : "bg-sys-warning/20 text-sys-warning"
                  }`}
                >
                  !
                </span>
                <div className="min-w-0 flex-1 whitespace-normal break-words leading-snug">
                  <div
                    className={`font-bold ${
                      ov.mode === "offline" ? "text-sys-accent" : "text-sys-warning"
                    }`}
                  >
                    {ov.mode === "offline"
                      ? "Виняток: очне навчання"
                      : "Виняток: дистанційне навчання"}
                  </div>
                  {ov.reason && (
                    <p className="mt-0.5 text-[11px] text-sys-text-secondary whitespace-normal break-words">
                      {ov.reason}
                    </p>
                  )}
                </div>
              </div>
            );
          })}

        {/* Rows 1..N: Lesson Slots (1 row per lesson number, synchronized across all 5 days) */}
        {allLessonNumbers.map((num) =>
          weekDaysMeta.map(({ day, slots, firstLessonNum, lastLessonNum }) => {
            const isToday = day.date === kyivTodayIso;
            const isPast = day.date < kyivTodayIso;
            const lessonsForSlot = slots.get(num) ?? [];
            const isWindow = num > firstLessonNum && num < lastLessonNum && lessonsForSlot.length === 0;

            return (
              <div
                key={`desktop-slot-${num}-${day.date}`}
                className={`flex flex-col min-h-[92px] transition-opacity ${
                  isPast && !isToday ? "opacity-80 hover:opacity-100" : ""
                }`}
              >
                {lessonsForSlot.length > 0 ? (
                  <div className="flex flex-col gap-2 h-full">
                    {lessonsForSlot.map((lesson) => (
                      <LessonCard
                        key={`${lesson.id}-${lesson.lesson_number}`}
                        lesson={lesson}
                        targetDate={day.date}
                        scheduleMode={scheduleMode}
                        canEdit={canEdit}
                        onQuickJump={onQuickJump}
                        learningMode={day.learning_mode ?? null}
                        mode="week"
                      />
                    ))}
                  </div>
                ) : isWindow ? (
                  <div
                    title={`Вікно на ${num}-й парі`}
                    className="flex h-full min-h-[72px] items-center justify-center rounded-2xl border border-dashed border-sys-border/50 bg-sys-card/[0.02] p-2 text-center text-xs text-sys-text-muted/60 transition-colors select-none"
                  >
                    <span className="text-xs">—</span>
                  </div>
                ) : (
                  <div className="h-full min-h-[16px] pointer-events-none" />
                )}
              </div>
            );
          })
        )}

        {/* Row N+1: Column Summary Footer */}
        {weekDaysMeta.map(({ day, summaryText }) => (
          <div
            key={`desktop-footer-${day.date}`}
            className="py-2 px-3 text-center text-xs font-medium border-t border-sys-border/40 mt-1"
            style={{ color: "#a1a1aa" }}
          >
            <span>{summaryText}</span>
          </div>
        ))}
      </div>

      {/* Tablet (640px – 1023px): horizontal scroll with snap-start */}
      <div className="hidden sm:flex lg:hidden items-start gap-3 overflow-x-auto snap-x snap-mandatory pb-4" style={{ scrollbarWidth: "thin" }}>
        {weekDaysMeta.map(({ day, slots, firstLessonNum, lastLessonNum }) => {
          const isToday = day.date === kyivTodayIso;
          const isPast = day.date < kyivTodayIso;
          const ov = day.learning_mode_override;
          return (
            <div
              key={`tablet-${day.date}`}
              className={`snap-start min-w-[240px] md:min-w-[260px] flex-1 shrink-0 flex flex-col gap-2.5 ${
                isPast && !isToday ? "opacity-60" : ""
              }`}
            >
              <div
                className={`flex flex-col justify-center min-h-[60px] px-3.5 py-2 rounded-2xl border ${
                  isToday
                    ? "bg-sys-accent/15 border-sys-accent/60 shadow-sm"
                    : "bg-sys-card border-sys-border"
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className={`text-base font-bold capitalize truncate ${isToday ? "text-sys-accent" : "text-sys-text-primary"}`}>
                    {longWeekday(day.date)}
                  </span>
                  {isToday && (
                    <span className="shrink-0 px-2 py-0.5 rounded-full bg-sys-accent text-xs font-extrabold text-[#0b1120] uppercase">
                      Сьогодні
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between gap-1.5 mt-0.5">
                  <span className="text-xs text-sys-text-secondary">
                    {shortDateUk(day.date)}
                  </span>
                </div>
              </div>

              {ov && (
                <div
                  className={`flex items-start gap-2 rounded-2xl border px-3 py-2 text-xs shadow-xs ${
                    ov.mode === "offline"
                      ? "border-sys-accent/35 bg-sys-accent/10 text-sys-text-primary"
                      : "border-sys-warning/35 bg-sys-warning/10 text-sys-text-primary"
                  }`}
                >
                  <span
                    className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                      ov.mode === "offline"
                        ? "bg-sys-accent/20 text-sys-accent"
                        : "bg-sys-warning/20 text-sys-warning"
                    }`}
                  >
                    !
                  </span>
                  <div className="min-w-0 flex-1 whitespace-normal break-words leading-snug">
                    <div
                      className={`font-bold ${
                        ov.mode === "offline" ? "text-sys-accent" : "text-sys-warning"
                      }`}
                    >
                      {ov.mode === "offline"
                        ? "Виняток: очне навчання"
                        : "Виняток: дистанційне навчання"}
                    </div>
                    {ov.reason && (
                      <p className="mt-0.5 text-[11px] text-sys-text-secondary whitespace-normal break-words">
                        {ov.reason}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {allLessonNumbers.map((num) => {
                const lessonsForSlot = slots.get(num) ?? [];
                const isWindow = num > firstLessonNum && num < lastLessonNum && lessonsForSlot.length === 0;

                if (lessonsForSlot.length > 0) {
                  return (
                    <div key={`tablet-slot-${num}-${day.date}`} className="flex flex-col gap-2">
                      {lessonsForSlot.map((lesson) => (
                        <LessonCard
                          key={`${lesson.id}-${lesson.lesson_number}`}
                          lesson={lesson}
                          targetDate={day.date}
                          scheduleMode={scheduleMode}
                          canEdit={canEdit}
                          onQuickJump={onQuickJump}
                          learningMode={day.learning_mode ?? null}
                          mode="week"
                        />
                      ))}
                    </div>
                  );
                }
                if (isWindow) {
                  return (
                    <div
                      key={`tablet-slot-${num}-${day.date}`}
                      title={`Вікно на ${num}-й парі`}
                      className="flex min-h-[56px] items-center justify-center rounded-2xl border border-dashed border-sys-border/40 bg-sys-card/[0.02] text-xs text-sys-text-muted/50 select-none"
                    >
                      <span>—</span>
                    </div>
                  );
                }
                return null;
              })}
            </div>
          );
        })}
      </div>

      {/* Mobile (< 640px): Day list with day headers */}
      <div className="flex w-full flex-col gap-6 sm:hidden">
        {week.map((day) => (
          <div
            key={`mobile-week-day-${day.date}`}
            id={`day-section-${day.date}`}
            data-day-section
            data-day-date={day.date}
            className="scroll-mt-16"
          >
            <ScheduleDay
              schedule={day}
              mode="day"
              scheduleMode={scheduleMode}
              onQuickJump={onQuickJump}
              isToday={day.date === kyivTodayIso}
              weekNumber={weekNumber}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
