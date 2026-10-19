"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ScheduleResponse, Lesson } from "../lib/api";
import { formatRoom, formatTeachers } from "../lib/format";
import { useToast } from "./ToastProvider";
import { LessonCard, QuickJumpTarget } from "./LessonCard";
import { shareScheduleAsImage } from "../lib/shareImage";

const NUM_EMOJI: Record<number, string> = { 1: "1️⃣", 2: "2️⃣", 3: "3️⃣", 4: "4️⃣", 5: "5️⃣" };

const KYIV_DATE_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" });
const KYIV_TIME_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Kyiv",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const SHARE_DATE_FMT = new Intl.DateTimeFormat("uk-UA", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

const fmt = (value: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("uk-UA", options).format(new Date(`${value}T12:00:00`));

function buildTelegramShareText(schedule: ScheduleResponse, scheduleMode: "student" | "teacher" | "admin"): string {
  const dateFormatted = SHARE_DATE_FMT.format(new Date(`${schedule.date}T12:00:00`));
  const weekLabel =
    schedule.week_type === "numerator" ? "Чисельник" : schedule.week_type === "denominator" ? "Знаменник" : "";

  const header = `📅 ${dateFormatted.charAt(0).toUpperCase() + dateFormatted.slice(1)}${weekLabel ? ` (${weekLabel})` : ""}`;
  if (!schedule.lessons.length) {
    return `${header}\n\n🎉 Пар немає!`;
  }

  const sortedLessons = [...schedule.lessons].sort(
    (left, right) => left.lesson_number - right.lesson_number || left.id - right.id,
  );

  const lines = sortedLessons.map((l) => {
    const num = NUM_EMOJI[l.lesson_number] ?? `${l.lesson_number}.`;
    let evTag = "";
    if (l.event_type) {
      if (l.event_type === "exam") evTag = " [📝 ЕКЗАМЕН]";
      else if (l.event_type === "consultation") evTag = " [💬 КОНСУЛЬТАЦІЯ]";
      else if (l.event_type === "credit") evTag = " [✅ ЗАЛІК]";
      else if (l.event_type === "defense") evTag = " [🎓 ЗАХИСТ]";
      else evTag = " [📌 ПОДІЯ]";
      if (l.event_title && l.event_title !== l.subject_name) {
        evTag += ` (${l.event_title})`;
      }
    }
    const rep = evTag || (l.is_replacement ? " ⚡ЗАМІНА" : "");
    const hasMeeting = Boolean(l.note && /(meet\.google\.com|zoom\.us)/i.test(l.note));
    const room = (!hasMeeting && l.room) ? ` • ${formatRoom(l.room)}` : "";
    const who =
      scheduleMode === "teacher" && l.group_name
        ? `👥 ${l.group_name}`
        : l.teacher_name
          ? `👤 ${formatTeachers(l.teacher_name)}`
          : "";
    return `${num} ${l.time} — ${l.subject_name}${rep}\n   ${[who, room.replace(" • ", "")].filter(Boolean).join(" • ")}`;
  });

  return `${header}\n\n${lines.join("\n\n")}`;
}

function parseMin(t?: string): number | null {
  if (!t) return null;
  const [h, m] = t.trim().split(":").map(Number);
  return Number.isNaN(h) || Number.isNaN(m) ? null : h * 60 + m;
}

/** Read-only or editable list of one day's lessons, with Telegram sharing, live break indicator, and cascade motion. */
export function ScheduleDay({
  schedule,
  isToday = false,
  mode = "day",
  scheduleMode = "student",
  canEdit = false,
  onEdit,
  movingLesson,
  onMoveSelect,
  onCopySelect,
  onCancelDated,
  onRestoreDated,
  onQuickJump,
  hideHeaderOnMobile = false,
}: {
  schedule: ScheduleResponse;
  isToday?: boolean;
  mode?: "day" | "week";
  scheduleMode?: "student" | "teacher" | "admin";
  canEdit?: boolean;
  onEdit?: (lesson: Lesson) => void;
  movingLesson?: Lesson | null;
  onMoveSelect?: (lesson: Lesson | null) => void;
  onCopySelect?: (lesson: Lesson) => void;
  onCancelDated?: (lesson: Lesson, date: string) => void;
  onRestoreDated?: (lesson: Lesson, date: string) => void;
  onQuickJump?: (target: QuickJumpTarget) => void;
  hideHeaderOnMobile?: boolean;
}) {
  const { showToast } = useToast();
  const [kyivNow, setKyivNow] = useState<{ dateIso: string; minutes: number } | null>(null);

  useEffect(() => {
    const update = () => {
      const now = new Date();
      setKyivNow({
        dateIso: KYIV_DATE_FMT.format(now),
        minutes: parseMin(KYIV_TIME_FMT.format(now)) ?? 0,
      });
    };
    update();
    const id = setInterval(update, 30_000);
    return () => clearInterval(id);
  }, []);

  const handleShareDay = async () => {
    const text = buildTelegramShareText(schedule, scheduleMode);
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        showToast("Розклад скопійовано для Telegram!", "success");
      } else if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ text });
      }
    } catch {
      if (typeof navigator !== "undefined" && navigator.share) {
        try {
          await navigator.share({ text });
        } catch {
          // ignore share dismiss
        }
      }
    }
  };

  const [sharingImage, setSharingImage] = useState(false);

  const handleShareImage = async () => {
    if (sharingImage) return;
    setSharingImage(true);
    try {
      const firstLesson = schedule.lessons[0];
      const ownerLabel =
        scheduleMode === "teacher"
          ? firstLesson?.teacher_name || "Розклад викладача"
          : firstLesson?.group_name
            ? `Група ${firstLesson.group_name}`
            : "Розклад занять";

      const result = await shareScheduleAsImage(schedule, scheduleMode, ownerLabel);
      if (result === "copied") {
        showToast("Картинку скопійовано! Натисніть Ctrl+V у Telegram", "success");
      } else if (result === "downloaded") {
        showToast("Картинку розкладу завантажено", "success");
      }
    } catch (err) {
      if (err instanceof Error && err.name !== "AbortError") {
        showToast("Не вдалося створити картинку розкладу", "error");
      }
    } finally {
      setSharingImage(false);
    }
  };

  const orderedLessons = [...schedule.lessons].sort(
    (left, right) => left.lesson_number - right.lesson_number || left.id - right.id,
  );

  const firstStart = orderedLessons.length > 0 ? parseMin(orderedLessons[0].time.split(/[-–—]/)[0]) : null;
  const isBeforeDayStart = Boolean(
    kyivNow &&
    kyivNow.dateIso === schedule.date &&
    firstStart !== null &&
    kyivNow.minutes < firstStart &&
    kyivNow.minutes >= firstStart - 120
  );
  const timeToStart = isBeforeDayStart && firstStart !== null && kyivNow ? firstStart - kyivNow.minutes : 0;

  return (
    <section className="min-w-0">
      <header className={`mb-3.5 flex items-center justify-between gap-2 px-0 ${mode === "week" ? "min-h-[56px]" : "pt-1"} ${hideHeaderOnMobile ? "hidden sm:flex" : ""}`}>
        {mode === "day" ? (
          <div className="flex flex-wrap items-baseline gap-2">
            <div className="flex items-center gap-2.5">
              {isToday && <span className="flex h-2.5 w-2.5 animate-pulse rounded-full bg-sys-accent shadow-[0_0_10px_rgba(59,130,246,0.9)]" />}
              <h2 className={`text-xl sm:text-2xl lg:text-[26px] font-bold capitalize tracking-tight ${isToday ? "text-sys-accent" : "text-sys-text-primary"}`}>
                {fmt(schedule.date, { weekday: "long" })}<span className="font-normal text-sys-text-secondary">,</span>
              </h2>
            </div>
            <span className="text-sm sm:text-base lg:text-lg font-medium text-sys-text-secondary">
              {fmt(schedule.date, { day: "numeric", month: "long" })}
            </span>
          </div>
        ) : (
          <div className="flex flex-col justify-center min-h-[56px] min-w-0 flex-1">
            <div className="flex items-center justify-between gap-1">
              <h2 className={`text-base sm:text-lg font-bold capitalize tracking-tight truncate ${isToday ? "text-sys-accent" : "text-sys-text-primary"}`}>
                {fmt(schedule.date, { weekday: "long" })}
              </h2>
              {isToday && (
                <span className="shrink-0 px-1.5 py-0.5 rounded-full bg-sys-accent text-[10px] font-extrabold text-[#0b1120] uppercase">
                  Сьогодні
                </span>
              )}
            </div>
            <span className="text-xs font-medium text-sys-text-secondary mt-0.5">
              {fmt(schedule.date, { day: "numeric", month: "short" })}
            </span>
          </div>
        )}

        {mode === "day" && orderedLessons.length > 0 && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleShareImage()}
              disabled={sharingImage}
              title="Скопіювати або зберегти розклад як PNG-картинку"
              aria-label="Поділитися картинкою розкладу"
              className="h-9 px-3 gap-1.5 flex items-center justify-center rounded-xl border border-sys-border bg-sys-card text-xs font-semibold text-sys-text-secondary transition-all hover:border-sys-accent/40 hover:text-sys-accent hover:bg-sys-accent/5 active:scale-95 disabled:opacity-50"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
                <circle cx="9" cy="9" r="2" />
                <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
              </svg>
              <span className="hidden sm:inline">Зберегти картинку</span>
            </button>
            <button
              type="button"
              onClick={handleShareDay}
              title="Скопіювати розклад для Telegram"
              aria-label="Скопіювати розклад дня"
              className="h-9 px-3 gap-1.5 flex items-center justify-center rounded-xl border border-sys-border bg-sys-card text-xs font-semibold text-sys-text-secondary transition-all hover:border-sys-accent/40 hover:text-sys-accent hover:bg-sys-accent/5 active:scale-95"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                <polyline points="16 6 12 2 8 6" />
                <line x1="12" y1="2" x2="12" y2="15" />
              </svg>
              <span className="hidden sm:inline">Поділитися</span>
            </button>
          </div>
        )}
      </header>

      {/* Morning pre-lesson indicator */}
      {isBeforeDayStart && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-sys-border bg-sys-card px-4 py-2.5 text-xs text-sys-text-secondary shadow-xs mb-3">
          <div className="flex items-center gap-2">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-sys-accent"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            <span>До початку занять</span>
          </div>
          <div className="flex items-center gap-1.5 text-sys-text-primary font-medium">
            <span>
              {orderedLessons[0].lesson_number}-а пара о {orderedLessons[0].time.split(/[-–—]/)[0]} (через {timeToStart >= 60 ? `${Math.floor(timeToStart / 60)} год${timeToStart % 60 > 0 ? ` ${timeToStart % 60} хв` : ""}` : `${timeToStart} хв`})
            </span>
          </div>
        </div>
      )}

      {orderedLessons.length ? (
        <motion.div
          initial="hidden"
          animate="visible"
          variants={{
            hidden: {},
            visible: { transition: { staggerChildren: 0.02 } },
          }}
          className="flex flex-col gap-3"
        >
          {orderedLessons.map((lesson, idx) => {
            const lessonKey = `${lesson.id}-${lesson.lesson_number}`;
            const prev = idx > 0 ? orderedLessons[idx - 1] : null;
            const prevEnd = prev ? parseMin(prev.time.split(/[-–—]/)[1]) : null;
            const currStart = parseMin(lesson.time.split(/[-–—]/)[0]);
            const isBreakNow = Boolean(
              kyivNow &&
              kyivNow.dateIso === schedule.date &&
              prev &&
              prev.lesson_number !== lesson.lesson_number &&
              prevEnd !== null &&
              currStart !== null &&
              kyivNow.minutes >= prevEnd &&
              kyivNow.minutes < currStart
            );
            const breakDuration = prevEnd !== null && currStart !== null ? currStart - prevEnd : 0;
            const breakLeft = isBreakNow && currStart !== null && kyivNow ? currStart - kyivNow.minutes : 0;

            return (
              <motion.div
                key={lessonKey}
                variants={{
                  hidden: { opacity: 0, y: 8 },
                  visible: { opacity: 1, y: 0, transition: { duration: 0.18, ease: [0.2, 0, 0, 1] } },
                }}
                className="flex flex-col gap-2.5"
              >
                {isBreakNow && (
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-sys-border bg-sys-card/60 px-4 py-2 text-xs text-sys-text-secondary">
                    <div className="flex items-center gap-2">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-sys-text-muted"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                      <span>перерва {breakDuration} хв</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-sys-text-muted text-[11px]">
                      <span>наступна ({lesson.lesson_number}-а) через</span>
                      <span className="font-semibold text-sys-text-primary">{breakLeft} хв</span>
                    </div>
                  </div>
                )}
                <LessonCard
                  lesson={lesson}
                  targetDate={schedule.date}
                  mode={mode}
                  scheduleMode={scheduleMode}
                  canEdit={canEdit}
                  onEdit={onEdit}
                  movingLesson={movingLesson}
                  onMoveSelect={onMoveSelect}
                  onCopySelect={onCopySelect}
                  onCancelDated={onCancelDated}
                  onRestoreDated={onRestoreDated}
                  onQuickJump={onQuickJump}
                />
              </motion.div>
            );
          })}
        </motion.div>
      ) : (
        <div className="rounded-xl border border-dashed border-sys-border bg-sys-card/30 px-4 py-8 text-center text-sm text-sys-text-muted">
          На цей день занять немає.
        </div>
      )}
    </section>
  );
}
