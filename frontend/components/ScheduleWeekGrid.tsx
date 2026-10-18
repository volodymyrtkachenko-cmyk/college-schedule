import { Lesson, ScheduleResponse } from "../lib/api";
import { canMoveLesson } from "../lib/scheduleMove";
import { ScheduleDay } from "./ScheduleDay";
import { ScheduleEditGrid } from "./ScheduleEditGrid";
import { QuickJumpTarget } from "./LessonCard";

const localDateString = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

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
        />
      </div>
    );
  }

  return (
    <div className="w-full pb-4">
      {/* Desktop (>= 1024px): 5 колонок, картки у згорнутому стані з вирівняною висотою */}
      <div className="hidden lg:grid lg:grid-cols-5 items-start gap-3 xl:gap-4 pb-4">
        {week.map((day) => (
          <div key={`desktop-${day.date}`} className="min-w-0 flex-1">
            <ScheduleDay schedule={day} mode="week" scheduleMode={scheduleMode} onQuickJump={onQuickJump} />
          </div>
        ))}
      </div>

      {/* Tablet (640px – 1023px): горизонтальний скрол зі snap-прокруткою */}
      <div className="hidden sm:flex lg:hidden items-start gap-3 overflow-x-auto snap-x snap-mandatory pb-4" style={{ scrollbarWidth: "thin" }}>
        {week.map((day) => (
          <div key={`tablet-${day.date}`} className="snap-start min-w-[280px] sm:min-w-[320px] flex-1 shrink-0">
            <ScheduleDay schedule={day} mode="week" scheduleMode={scheduleMode} onQuickJump={onQuickJump} />
          </div>
        ))}
      </div>

      {/* Mobile (< 640px): усі 5 днів підряд, кожен із заголовком-розділювачем (день + дата) */}
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
              isToday={day.date === localDateString()}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
