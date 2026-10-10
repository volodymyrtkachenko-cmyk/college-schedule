import { ScheduleResponse } from "../lib/api";
import { LessonCard } from "./LessonCard";

const fmt = (value: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("uk-UA", options).format(new Date(`${value}T12:00:00`));

/** Read-only list of one day's lessons, ordered by slot (several lessons per slot are all shown). */
export function ScheduleDay({ schedule, isToday = false, mode = "day", scheduleMode = "student" }: {
  schedule: ScheduleResponse; isToday?: boolean; mode?: "day" | "week"; scheduleMode?: "student" | "teacher";
}) {
  const orderedLessons = [...schedule.lessons].sort(
    (left, right) => left.lesson_number - right.lesson_number || left.id - right.id,
  );

  return (
    <section className={`min-w-0 ${isToday ? "rounded-3xl border border-sys-accent/30 bg-sys-accent/[0.03] p-1.5 shadow-[0_0_20px_rgba(88,166,255,0.08)]" : ""}`}>
      <header className={`mb-4 flex ${mode === "week" ? "flex-col items-start gap-1 px-1" : "items-baseline justify-between gap-2 px-3 pt-2"}`}>
        <div className="flex items-center gap-2">
          {isToday && <span className="flex h-2 w-2 animate-pulse rounded-full bg-sys-accent shadow-[0_0_8px_rgba(88,166,255,0.8)]" />}
          <h2 className="text-[17px] font-bold capitalize tracking-tight text-sys-text-primary">{fmt(schedule.date, { weekday: "long" })}</h2>
        </div>
        <span className={`pr-2 text-[13px] font-medium ${isToday ? "text-sys-accent" : "text-sys-text-muted"}`}>
          {fmt(schedule.date, { day: "numeric", month: "short" })}
        </span>
      </header>

      {orderedLessons.length ? (
        <div className="min-w-0 space-y-2">
          {orderedLessons.map((lesson) => (
            <LessonCard key={lesson.id} lesson={lesson} targetDate={schedule.date} mode={mode} scheduleMode={scheduleMode} canEdit={false} />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-sys-border bg-sys-card/30 px-4 py-8 text-center text-sm text-sys-text-muted">
          На цей день занять немає.
        </div>
      )}
    </section>
  );
}
