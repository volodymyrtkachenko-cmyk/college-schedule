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
    const room = (!hasMeeting && l.room) ? ` • 🚪 ${formatRoom(l.room)}` : "";
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

  return (
    <section className={`min-w-0 ${isToday ? "rounded-3xl border border-sys-accent/30 bg-sys-accent/[0.03] p-1.5 shadow-[0_0_20px_rgba(88,166,255,0.08)]" : ""}`}>
      <header className={`mb-4 flex ${mode === "week" ? "items-center justify-between px-1" : "items-center justify-between gap-2 px-3 pt-2"}`}>
        <div className="flex items-center gap-2">
          {isToday && <span className="flex h-2 w-2 animate-pulse rounded-full bg-sys-accent shadow-[0_0_8px_rgba(88,166,255,0.8)]" />}
          <h2 className="text-[17px] font-bold capitalize tracking-tight text-sys-text-primary">{fmt(schedule.date, { weekday: "long" })}</h2>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[13px] font-medium ${isToday ? "text-sys-accent" : "text-sys-text-muted"}`}>
            {fmt(schedule.date, { day: "numeric", month: "short" })}
          </span>
          {orderedLessons.length > 0 && (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => void handleShareImage()}
                disabled={sharingImage}
                title="Скопіювати або зберегти розклад як PNG-картинку"
                aria-label="Поділитися картинкою розкладу"
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-sys-border/60 bg-sys-bg/40 text-sys-text-secondary transition-colors hover:border-sys-accent/40 hover:text-sys-accent disabled:opacity-50"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
                  <circle cx="9" cy="9" r="2" />
                  <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
                </svg>
              </button>
              <button
                type="button"
                onClick={handleShareDay}
                title="Скопіювати розклад для Telegram"
                aria-label="Скопіювати розклад дня"
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-sys-border/60 bg-sys-bg/40 text-sys-text-secondary transition-colors hover:border-sys-accent/40 hover:text-sys-accent"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                  <polyline points="16 6 12 2 8 6" />
                  <line x1="12" y1="2" x2="12" y2="15" />
                </svg>
              </button>
            </div>
          )}
        </div>
      </header>

      {orderedLessons.length ? (
        <motion.div
          initial="hidden"
          animate="visible"
          variants={{
            hidden: {},
            visible: { transition: { staggerChildren: 0.045 } },
          }}
          className="flex flex-col gap-2.5"
        >
          {orderedLessons.map((lesson, idx) => {
            const prev = idx > 0 ? orderedLessons[idx - 1] : null;
            const prevEnd = prev ? parseMin(prev.time.split("-")[1]) : null;
            const currStart = parseMin(lesson.time.split("-")[0]);
            const isBreakNow = Boolean(
              kyivNow &&
              kyivNow.dateIso === schedule.date &&
              prevEnd !== null &&
              currStart !== null &&
              kyivNow.minutes >= prevEnd &&
              kyivNow.minutes < currStart
            );
            const breakLeft = isBreakNow && currStart !== null && kyivNow ? currStart - kyivNow.minutes : 0;

            return (
              <motion.div
                key={`${lesson.id}-${lesson.lesson_number}`}
                variants={{
                  hidden: { opacity: 0, y: 8 },
                  visible: { opacity: 1, y: 0, transition: { duration: 0.18, ease: "easeOut" } },
                }}
                className="flex flex-col gap-2.5"
              >
                {isBreakNow && (
                  <div className="flex items-center justify-center gap-2 rounded-xl border border-amber-400/30 bg-amber-400/[0.07] px-3 py-1.5 text-xs font-semibold text-amber-300 shadow-sm">
                    <span>☕ Перерва</span>
                    <span>•</span>
                    <span>до {lesson.lesson_number}-ї пари залишилось {breakLeft} хв</span>
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
