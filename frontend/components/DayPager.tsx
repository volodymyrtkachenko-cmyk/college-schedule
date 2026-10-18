"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
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

function formatDayHeader(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`);
  const weekday = new Intl.DateTimeFormat("uk-UA", { weekday: "long" }).format(d);
  const capitalWeekday = weekday.charAt(0).toUpperCase() + weekday.slice(1);
  const dayMonth = new Intl.DateTimeFormat("uk-UA", { day: "numeric", month: "short" }).format(d);
  return `${capitalWeekday} · ${dayMonth}`;
}

export function DayPager({
  schedule,
  todayDate,
  scheduleMode = "student",
  canEdit = false,
  onEdit,
  movingLesson,
  onMoveSelect,
  onCopySelect,
  onCancelDated,
  onRestoreDated,
  onQuickJump,
  onNextDay,
  onPrevDay,
  onJumpToToday,
  daySlideDir = 0,
  shouldReduceMotion = false,
  isWeekend = false,
  isShowingTomorrow = false,
}: {
  schedule: ScheduleResponse;
  todayDate?: string;
  scheduleMode?: "student" | "teacher" | "admin";
  canEdit?: boolean;
  onEdit?: (lesson: Lesson) => void;
  movingLesson?: Lesson | null;
  onMoveSelect?: (lesson: Lesson | null) => void;
  onCopySelect?: (lesson: Lesson) => void;
  onCancelDated?: (lesson: Lesson, date: string) => void;
  onRestoreDated?: (lesson: Lesson, date: string) => void;
  onQuickJump?: (target: QuickJumpTarget) => void;
  onNextDay?: () => void;
  onPrevDay?: () => void;
  onJumpToToday?: () => void;
  daySlideDir?: number;
  shouldReduceMotion?: boolean;
  isWeekend?: boolean;
  isShowingTomorrow?: boolean;
}) {
  const { showToast } = useToast();
  const [kyivNow, setKyivNow] = useState<{ dateIso: string; minutes: number } | null>(null);
  const [sharingImage, setSharingImage] = useState(false);

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
        } catch {}
      }
    }
  };

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

  // Touch swipe handling that respects horizontal overflow elements
  const touchStartRef = useRef<{ x: number; y: number; time: number; isHoriz: boolean } | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    let isHoriz = false;
    let curr = e.target as HTMLElement | null;
    while (curr && curr !== e.currentTarget) {
      const overflowX = window.getComputedStyle(curr).overflowX;
      if ((overflowX === "auto" || overflowX === "scroll") && curr.scrollWidth > curr.clientWidth) {
        isHoriz = true;
        break;
      }
      curr = curr.parentElement;
    }

    touchStartRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
      time: Date.now(),
      isHoriz,
    };
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!touchStartRef.current || touchStartRef.current.isHoriz || e.changedTouches.length === 0) return;
    const start = touchStartRef.current;
    const touch = e.changedTouches[0];
    const diffX = touch.clientX - start.x;
    const diffY = touch.clientY - start.y;
    touchStartRef.current = null;

    if (Math.abs(diffX) > 40 && Math.abs(diffX) > Math.abs(diffY) * 1.5) {
      if (diffX < 0) {
        onNextDay?.();
      } else {
        onPrevDay?.();
      }
    }
  };

  const orderedLessons = useMemo(() => {
    return [...schedule.lessons].sort(
      (left, right) => left.lesson_number - right.lesson_number || left.id - right.id,
    );
  }, [schedule.lessons]);

  const isToday = schedule.date === todayDate;
  const showTodayChip = !isToday && !!onJumpToToday;

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      className="w-full min-w-0 touch-pan-y"
    >
      {/* Top context banners: weekend or tomorrow */}
      {isWeekend && (
        <div className="mb-2.5 flex h-9 max-h-10 items-center justify-between rounded-lg border border-slate-700/50 bg-slate-800/50 px-3 text-xs text-sys-text-secondary">
          <div className="flex items-center gap-1.5 min-w-0">
            <span aria-hidden="true">🛋️</span>
            <span className="font-semibold text-sys-text-primary whitespace-nowrap">Сьогодні вихідний</span>
            <span className="truncate">— розклад найближчого навчального дня</span>
          </div>
        </div>
      )}

      {isShowingTomorrow && !isWeekend && (
        <div className="mb-2.5 flex items-center justify-between rounded-xl border border-sys-accent/30 bg-sys-accent/10 px-3.5 py-2 text-xs text-sys-text-primary">
          <span>🌙 Пари на сьогодні завершено — показано <strong>розклад на завтра</strong></span>
        </div>
      )}

      {/* Day header: «Назва дня · дата» + «Сьогодні» chip + Share icons */}
      <header className="mb-3 flex items-center justify-between gap-2 px-1 pt-0.5">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="text-[17px] font-bold tracking-tight text-sys-text-primary truncate">
            {formatDayHeader(schedule.date)}
          </h2>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {showTodayChip && (
            <button
              type="button"
              onClick={onJumpToToday}
              className="rounded-full border border-sys-accent/40 bg-sys-accent/10 px-2.5 py-0.5 text-[11px] font-semibold text-sys-accent transition-all active:scale-[0.94] hover:bg-sys-accent/20 focus:outline-none"
            >
              Сьогодні
            </button>
          )}

          {orderedLessons.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => void handleShareImage()}
                disabled={sharingImage}
                title="Скопіювати або зберегти розклад як PNG-картинку"
                aria-label="Поділитися картинкою розкладу"
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-sys-border/60 bg-sys-bg/40 text-sys-text-secondary transition-colors hover:border-sys-accent/40 hover:text-sys-accent active:scale-[0.94] disabled:opacity-50"
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
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-sys-border/60 bg-sys-bg/40 text-sys-text-secondary transition-colors hover:border-sys-accent/40 hover:text-sys-accent active:scale-[0.94]"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                  <polyline points="16 6 12 2 8 6" />
                  <line x1="12" y1="2" x2="12" y2="15" />
                </svg>
              </button>
            </>
          )}
        </div>
      </header>

      {/* Animated Day Schedule List */}
      <AnimatePresence initial={false} custom={daySlideDir} mode="wait">
        <motion.div
          key={schedule.date}
          custom={daySlideDir}
          variants={{
            enter: (dir: number) => ({
              x: dir > 0 ? 10 : dir < 0 ? -10 : 0,
              opacity: 0,
            }),
            center: {
              x: 0,
              opacity: 1,
            },
            exit: (dir: number) => ({
              x: dir > 0 ? -10 : dir < 0 ? 10 : 0,
              opacity: 0,
            }),
          }}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{
            duration: shouldReduceMotion ? 0 : 0.18,
            ease: [0.2, 0, 0, 1],
          }}
          className="flex flex-col gap-2.5 will-change-transform"
        >
          {orderedLessons.length > 0 ? (
            orderedLessons.map((lesson, idx) => {
              const lessonKey = `${lesson.id}-${lesson.lesson_number}`;
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
                <div key={lessonKey} className="flex flex-col gap-2.5">
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
                    mode="day"
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
                </div>
              );
            })
          ) : (
            <div className="rounded-2xl border border-dashed border-sys-border bg-sys-card/30 px-6 py-12 text-center text-sys-text-muted">
              <span className="text-2xl block mb-2" aria-hidden="true">🎉</span>
              <p className="text-base font-semibold text-sys-text-primary">Пар немає</p>
              <p className="text-xs text-sys-text-secondary mt-1">Розклад на цей день вільний</p>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
