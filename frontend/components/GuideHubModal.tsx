"use client";

import { useEffect, useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useUserSettings } from "../lib/useUserSettings";
import { api, Lesson, ScheduleResponse } from "../lib/api";
import { extractOnlineMeetings, formatRoom, checkScheduleHasSubgroups } from "../lib/format";
import { parseLessonTeachers } from "../lib/quickJump";
import { DEFAULT_LESSON_TIMES } from "../lib/constants/lessons";

export interface GuideHubModalProps {
  groupId?: number | null;
  onClose: () => void;
}

interface DemoData {
  subgroupSubject: string;
  teacher1: string;
  teacher1Room: string;
  teacher2: string;
  teacher2Room: string;
  onlineSubject: string;
  onlineTeacher: string;
  platform: "Meet" | "Zoom" | "Онлайн";
  hwSubject: string;
  hwRoom: string;
}

function extractGuideData(weekSchedule: ScheduleResponse[]): DemoData {
  const allLessons: Lesson[] = [];
  weekSchedule.forEach((day) => {
    if (Array.isArray(day?.lessons)) {
      allLessons.push(...day.lessons);
    }
  });

  // Find dual lesson
  const dualLesson = allLessons.find(
    (l) =>
      !l.is_cancelled &&
      (l.second_teacher_id != null ||
        (l.teacher_name && /[,/]/.test(l.teacher_name)) ||
        (l.teacher_room && l.second_teacher_room))
  );

  let subgroupSubject = "Комп'ютерні мережі";
  let teacher1 = "Викладач 1";
  let teacher1Room = "ауд. 101";
  let teacher2 = "Викладач 2";
  let teacher2Room = "ауд. 102";

  if (dualLesson) {
    subgroupSubject = dualLesson.subject_name;
    const teachers = parseLessonTeachers(dualLesson);
    teacher1 = teachers[0]?.displayName || teachers[0]?.name || "Викладач 1";
    teacher2 = teachers[1]?.displayName || teachers[1]?.name || "Викладач 2";
    teacher1Room = formatRoom(dualLesson.teacher_room || dualLesson.room || "101");
    teacher2Room = formatRoom(dualLesson.second_teacher_room || dualLesson.room || "102");
  } else if (allLessons.length > 0) {
    const firstWithTeacher = allLessons.find((l) => !l.is_cancelled && l.teacher_name);
    if (firstWithTeacher) {
      subgroupSubject = firstWithTeacher.subject_name;
      teacher1 = firstWithTeacher.teacher_name || "Викладач 1";
      teacher1Room = formatRoom(firstWithTeacher.room || "101");
      const otherTeacher = allLessons.find(
        (l) => !l.is_cancelled && l.teacher_name && l.teacher_name !== firstWithTeacher.teacher_name
      );
      teacher2 = otherTeacher?.teacher_name || "Викладач 2";
      teacher2Room = "ауд. 102";
    }
  }

  // Find online lesson
  let onlineSubject = "Програмування та алгоритми";
  let onlineTeacher = teacher1;
  let platform: "Meet" | "Zoom" | "Онлайн" = "Meet";

  for (const l of allLessons) {
    if (l.is_cancelled) continue;
    const meets = extractOnlineMeetings(l.note, l.room, l.teacher_name, l.subject_name);
    if (meets && meets.length > 0 && meets[0].url) {
      onlineSubject = l.subject_name;
      onlineTeacher = l.teacher_name || "Викладач";
      platform = meets[0].platform === "zoom" ? "Zoom" : "Meet";
      break;
    }
  }

  // HW lesson
  const hwL = allLessons.find((l) => !l.is_cancelled && l.subject_name !== subgroupSubject) || allLessons[0];
  const hwSubject = hwL?.subject_name || "Бази даних та SQL";
  const hwRoom = formatRoom(hwL?.room || "204");

  return {
    subgroupSubject,
    teacher1,
    teacher1Room,
    teacher2,
    teacher2Room,
    onlineSubject,
    onlineTeacher,
    platform,
    hwSubject,
    hwRoom,
  };
}

export function GuideHubModal({ groupId, onClose }: GuideHubModalProps) {
  const { updateSetting } = useUserSettings();

  const effectiveGroupId =
    groupId ??
    (typeof window !== "undefined"
      ? Number(localStorage.getItem("schedule:groupId")) ||
        Number(localStorage.getItem("schedule:classroom_linked_group_id")) ||
        null
      : null);

  const [weekSchedule, setWeekSchedule] = useState<ScheduleResponse[]>([]);
  const [activeSlide, setActiveSlide] = useState(0);

  // Interactive demo states
  const [demoSubgroup, setDemoSubgroup] = useState<1 | 2 | null>(null);
  const [demoMeetUnlocked, setDemoMeetUnlocked] = useState(true);
  const [demoHwChecked, setDemoHwChecked] = useState(false);
  const [copiedToast, setCopiedToast] = useState(false);

  // PWA detection
  const [pwaPrompt, setPwaPrompt] = useState<any>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [pwaFeedback, setPwaFeedback] = useState("");

  // Touch swipe support
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchEnd, setTouchEnd] = useState<number | null>(null);

  useEffect(() => {
    let isMounted = true;
    if (effectiveGroupId) {
      api.week(effectiveGroupId)
        .then((data) => {
          if (isMounted && Array.isArray(data)) setWeekSchedule(data);
        })
        .catch(() => {});
    }
    return () => {
      isMounted = false;
    };
  }, [effectiveGroupId]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const standalone =
      ("standalone" in window.navigator && (window.navigator as any).standalone === true) ||
      window.matchMedia("(display-mode: standalone)").matches;
    setIsStandalone(standalone);

    setIsIos(/iphone|ipad|ipod/i.test(navigator.userAgent || ""));

    if ((window as any).__pwaInstallEvent) {
      setPwaPrompt((window as any).__pwaInstallEvent);
    }

    const onInstallReady = (e: any) => setPwaPrompt(e.detail || (window as any).__pwaInstallEvent);
    const onAppInstalled = () => {
      setIsStandalone(true);
      setPwaPrompt(null);
      setPwaFeedback("✅ Додаток встановлено на екран!");
    };

    window.addEventListener("pwa-install-ready", onInstallReady);
    window.addEventListener("appinstalled", onAppInstalled);

    return () => {
      window.removeEventListener("pwa-install-ready", onInstallReady);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  const demoData = useMemo(() => extractGuideData(weekSchedule), [weekSchedule]);

  const slides = [
    {
      id: "live",
      icon: "🔴",
      title: "«Жива» пара в реальному часі",
      caption: "Заняття, яке триває зараз, автоматично підсвічується акцентним кольором та показує таймер «● ще N хв» і прогрес-лінію.",
      render: () => (
        <div className="relative rounded-2xl border border-sys-accent bg-gradient-to-br from-sys-accent/15 via-sys-card to-sys-card p-4 space-y-3 shadow-lg">
          <div className="flex items-center justify-between text-xs">
            <span className="font-black text-sys-accent">
              1 пара · 09:00–10:20
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-sys-accent/20 border border-sys-accent/40 px-2.5 py-0.5 text-xs font-bold text-sys-accent">
              <span className="h-2 w-2 rounded-full bg-sys-accent animate-ping" />
              ще 25 хв
            </span>
          </div>
          <div className="font-bold text-base text-sys-text-primary">
            {demoData.subgroupSubject}
          </div>
          <div className="text-xs text-sys-text-secondary">
            {demoData.teacher1} · {demoData.teacher1Room}
          </div>
          <div className="h-2 w-full rounded-full bg-sys-accent/20 overflow-hidden mt-1">
            <div className="h-full bg-sys-accent rounded-full w-2/3 transition-all duration-500" />
          </div>
        </div>
      ),
    },
    {
      id: "subgroups",
      icon: "👥",
      title: "Обидві підгрупи та швидкий фільтр",
      caption: "Розклад показує обох викладачів паралельно. Натискайте прямо на «1 підгр.» чи «2 підгр.», щоб залишити тільки свого викладача.",
      render: () => (
        <div className="rounded-2xl border border-sys-border bg-sys-card p-4 space-y-3 shadow-md">
          <div className="flex items-center justify-between text-xs border-b border-sys-border/50 pb-2">
            <span className="font-bold text-sys-text-secondary">2 пара · 10:40–12:00</span>
            <span className="text-[11px] text-sys-accent font-semibold">
              {demoSubgroup === null ? "Обидві підгрупи" : `${demoSubgroup} підгрупа`}
            </span>
          </div>
          <div className="font-bold text-sm sm:text-base text-sys-text-primary">
            {demoData.subgroupSubject}
          </div>
          <div className="space-y-2 pt-1">
            {(demoSubgroup === null || demoSubgroup === 1) && (
              <div className="flex items-center justify-between rounded-xl border border-sky-500/30 bg-sky-500/10 p-2.5">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setDemoSubgroup(demoSubgroup === 1 ? null : 1)}
                    className="rounded px-1.5 py-0.5 text-xs font-bold bg-sky-500 text-white shadow-xs"
                  >
                    1 підгр.
                  </button>
                  <span className="text-xs font-semibold text-sys-text-primary">
                    {demoData.teacher1}
                  </span>
                </div>
                <span className="text-xs font-medium text-sys-text-secondary">
                  {demoData.teacher1Room}
                </span>
              </div>
            )}
            {(demoSubgroup === null || demoSubgroup === 2) && (
              <div className="flex items-center justify-between rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-2.5">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setDemoSubgroup(demoSubgroup === 2 ? null : 2)}
                    className="rounded px-1.5 py-0.5 text-xs font-bold bg-indigo-500 text-white shadow-xs"
                  >
                    2 підгр.
                  </button>
                  <span className="text-xs font-semibold text-sys-text-primary">
                    {demoData.teacher2}
                  </span>
                </div>
                <span className="text-xs font-medium text-sys-text-secondary">
                  {demoData.teacher2Room}
                </span>
              </div>
            )}
          </div>
          <div className="text-center">
            {demoSubgroup !== null ? (
              <button
                type="button"
                onClick={() => setDemoSubgroup(null)}
                className="text-xs text-sys-accent font-bold hover:underline"
              >
                Показати обидві підгрупи ✓
              </button>
            ) : (
              <span className="text-[11px] text-sys-text-muted">
                👆 Натискайте на бейджі підгруп прямо на картці
              </span>
            )}
          </div>
        </div>
      ),
    },
    {
      id: "online",
      icon: "💻",
      title: "Відеоуроки в один клік",
      caption: "Прямий перехід до Google Meet або Zoom. Посилання захищені позначкою [🔒 Онлайн] від сторонніх і відкриті для вашої групи.",
      render: () => (
        <div className="rounded-2xl border border-sys-border bg-sys-card p-4 space-y-3 shadow-md">
          <div className="flex items-center justify-between text-xs border-b border-sys-border/50 pb-2">
            <span className="font-bold text-sys-text-secondary">3 пара · 12:30–13:50</span>
            <button
              type="button"
              onClick={() => setDemoMeetUnlocked((v) => !v)}
              className="text-[11px] text-sys-accent hover:underline"
            >
              {demoMeetUnlocked ? "Перемкнути: Гість 🔒" : "Перемкнути: Студент ✓"}
            </button>
          </div>
          <div className="font-bold text-sm sm:text-base text-sys-text-primary">
            {demoData.onlineSubject}
          </div>
          <div className="text-xs text-sys-text-secondary">{demoData.onlineTeacher}</div>
          <div className="pt-1">
            {demoMeetUnlocked ? (
              <button
                type="button"
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-500/15 border border-emerald-500/40 py-2.5 text-xs sm:text-sm font-bold text-emerald-400 shadow-xs"
              >
                <span>{demoData.platform} ↗</span>
                <span className="text-[11px] font-normal opacity-80">(Посилання активне)</span>
              </button>
            ) : (
              <button
                type="button"
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-sys-bg border border-sys-border py-2.5 text-xs sm:text-sm font-bold text-sys-text-muted"
              >
                <span>🔒 {demoData.platform}</span>
                <span className="text-[11px] font-normal">(Захищено)</span>
              </button>
            )}
          </div>
        </div>
      ),
    },
    {
      id: "classroom",
      icon: "📋",
      title: "Classroom: дедлайни та оцінки",
      caption: "Завдання синхронізуються автоматично. Підключивши пошту, ви бачите зелені мітки «Здано» та оцінки викладача (наприклад, 12/12).",
      render: () => (
        <div className="rounded-2xl border border-sys-border bg-sys-card p-4 space-y-2.5 shadow-md">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-sys-text-secondary">{demoData.hwSubject}</span>
            <span className="text-emerald-400 font-bold text-[11px]">Classroom ✓</span>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between rounded-xl border border-purple-500/30 bg-purple-500/10 p-2.5 text-xs">
              <div>
                <div className="font-bold text-sys-text-primary">Практична робота №3</div>
                <div className="text-purple-300 text-[11px]">Термін: сьогодні до 23:59 ↗</div>
              </div>
              <span className="rounded-md bg-amber-500/20 text-amber-300 font-bold px-2 py-0.5 text-[10px]">
                Дедлайн
              </span>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-2.5 text-xs">
              <div>
                <div className="font-bold text-sys-text-primary">Лабораторна робота №2</div>
                <div className="text-emerald-300 text-[11px]">Роботу перевірено ✓</div>
              </div>
              <span className="rounded-md bg-emerald-500/20 text-emerald-400 font-bold px-2 py-0.5 text-xs">
                12 / 12
              </span>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: "share",
      icon: "📸",
      title: "Поділитися фото розкладу в 1 клік",
      caption: "Більше жодних скріншотів екрана! Натисніть кнопку «Поділитися» у шапці дня — застосунок створить фірмову листівку для Telegram або Viber.",
      render: () => (
        <div className="rounded-2xl border border-sys-border bg-sys-card p-4 space-y-3 shadow-md text-center">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-sys-accent/15 flex items-center justify-center text-2xl shadow-xs">
            📸
          </div>
          <div className="space-y-1">
            <div className="font-bold text-sm text-sys-text-primary">
              Стильна картинка розкладу дня
            </div>
            <p className="text-xs text-sys-text-secondary max-w-xs mx-auto">
              Містить слоти дзвінків, назви предметів, викладачів та аудиторії в естетичному форматі.
            </p>
          </div>
          <div className="flex items-center justify-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                setCopiedToast(true);
                setTimeout(() => setCopiedToast(false), 2000);
              }}
              className="rounded-xl bg-sys-accent px-4 py-2 text-xs font-bold text-slate-900 shadow-md active:scale-95 transition-all"
            >
              {copiedToast ? "✓ Згенеровано!" : "Спробувати створити фото"}
            </button>
          </div>
        </div>
      ),
    },
    {
      id: "pwa",
      icon: "📲",
      title: "Працює без інтернету (PWA)",
      caption: "Розклад автоматично кешується в пам'яті вашого телефона. Він відкривається в укриттях, метро чи під час відключень світла без мережі.",
      render: () => (
        <div className="rounded-2xl border border-sys-border bg-sys-card p-4 space-y-3 shadow-md">
          <div className="flex items-center gap-3">
            <span className="text-2xl">⚡</span>
            <div className="text-left">
              <div className="font-bold text-xs sm:text-sm text-sys-text-primary">
                {isStandalone ? "✓ Застосунок уже на вашому екрані" : "Встановлення на головний екран"}
              </div>
              <div className="text-[11px] text-sys-text-secondary">
                Працює як рідний мобільний додаток
              </div>
            </div>
          </div>
          <p className="text-xs text-sys-text-secondary text-left leading-relaxed">
            {isStandalone
              ? "Ви вже використовуєте автономну версію розкладу."
              : isIos
              ? "Натисніть кнопку «Поділитися» ⎋ у Safari, потім — «На початковий екран» ⊞."
              : "Натисніть кнопку нижче або скористайтеся меню браузера (⋮) → «Встановити додаток»."}
          </p>
          {!isStandalone && (
            <button
              type="button"
              onClick={async () => {
                if (pwaPrompt && typeof pwaPrompt.prompt === "function") {
                  try {
                    await pwaPrompt.prompt();
                    const choice = await pwaPrompt.userChoice;
                    if (choice?.outcome === "accepted") {
                      setIsStandalone(true);
                      setPwaFeedback("✅ Додаток успішно встановлено!");
                    }
                  } catch {}
                } else if (isIos) {
                  setPwaFeedback("В Safari: «Поділитися» ⎋ → «На початковий екран» ⊞");
                } else {
                  setPwaFeedback("Відкрийте меню браузера (⋮) → «Встановити додаток».");
                }
              }}
              className="w-full rounded-xl bg-sys-accent py-2.5 text-xs sm:text-sm font-bold text-slate-900 shadow-md active:scale-95 transition-all"
            >
              📲 Додати розклад на екран
            </button>
          )}
          {pwaFeedback && (
            <div className="text-xs text-center text-sys-accent font-semibold pt-1">
              {pwaFeedback}
            </div>
          )}
        </div>
      ),
    },
  ];

  const total = slides.length;
  const current = slides[activeSlide];

  // Swipe handling
  const minSwipeDistance = 50;
  const onTouchStartHandler = (e: React.TouchEvent) => {
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
  };
  const onTouchMoveHandler = (e: React.TouchEvent) => {
    setTouchEnd(e.targetTouches[0].clientX);
  };
  const onTouchEndHandler = () => {
    if (!touchStart || !touchEnd) return;
    const distance = touchStart - touchEnd;
    if (distance > minSwipeDistance && activeSlide < total - 1) {
      setActiveSlide((prev) => prev + 1);
    } else if (distance < -minSwipeDistance && activeSlide > 0) {
      setActiveSlide((prev) => prev - 1);
    }
  };

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" && activeSlide < total - 1) {
        setActiveSlide((prev) => prev + 1);
      } else if (e.key === "ArrowLeft" && activeSlide > 0) {
        setActiveSlide((prev) => prev - 1);
      } else if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [activeSlide, total, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-5 backdrop-blur-md overflow-hidden animate-in fade-in duration-150">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="guide-title"
        className="relative flex flex-col w-full max-w-lg rounded-3xl border border-sys-border bg-sys-card text-sys-text-primary shadow-2xl overflow-hidden"
      >
        {/* Top Header: Story Pills + Close */}
        <header className="px-5 pt-4 pb-2 bg-sys-card shrink-0 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-lg">💡</span>
              <h2 id="guide-title" className="text-sm font-bold text-sys-text-primary">
                Як користуватися розкладом
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Закрити"
              className="flex h-8 w-8 items-center justify-center rounded-xl text-sys-text-secondary hover:text-sys-text-primary hover:bg-sys-bg transition-colors font-bold text-sm"
            >
              ✕
            </button>
          </div>

          {/* Story Progress Bars */}
          <div className="flex items-center gap-1.5 pt-1">
            {slides.map((s, idx) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setActiveSlide(idx)}
                aria-label={`Слайд ${idx + 1}: ${s.title}`}
                className="flex-1 py-1 group focus:outline-hidden"
              >
                <div
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    idx === activeSlide
                      ? "bg-sys-accent shadow-xs"
                      : idx < activeSlide
                      ? "bg-sys-accent/40"
                      : "bg-sys-border"
                  }`}
                />
              </button>
            ))}
          </div>
        </header>

        {/* Center: Slide Visual Card + Punchy Caption */}
        <main
          onTouchStart={onTouchStartHandler}
          onTouchMove={onTouchMoveHandler}
          onTouchEnd={onTouchEndHandler}
          className="p-5 sm:p-6 flex-1 flex flex-col justify-between min-h-[380px] select-none"
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={current.id}
              initial={{ opacity: 0, scale: 0.98, x: 15 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              exit={{ opacity: 0, scale: 0.98, x: -15 }}
              transition={{ duration: 0.2 }}
              className="space-y-4 my-auto"
            >
              {/* Slide Title */}
              <div className="flex items-center gap-2">
                <span className="text-xl">{current.icon}</span>
                <h3 className="font-black text-base sm:text-lg text-sys-text-primary tracking-tight">
                  {current.title}
                </h3>
              </div>

              {/* Visual Mockup */}
              <div className="py-1">{current.render()}</div>

              {/* 1-2 Clear Sentences */}
              <p className="text-xs sm:text-sm text-sys-text-secondary leading-relaxed pt-1">
                {current.caption}
              </p>
            </motion.div>
          </AnimatePresence>
        </main>

        {/* Bottom Navigation: Prev, Dots, Next */}
        <footer className="flex items-center justify-between border-t border-sys-border/50 px-5 py-3.5 bg-sys-card shrink-0">
          <button
            type="button"
            onClick={() => setActiveSlide((prev) => Math.max(0, prev - 1))}
            disabled={activeSlide === 0}
            className="rounded-xl border border-sys-border bg-sys-bg px-4 py-2 text-xs sm:text-sm font-bold text-sys-text-secondary hover:text-sys-text-primary disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
          >
            ← Назад
          </button>

          <span className="text-xs font-bold text-sys-text-muted">
            {activeSlide + 1} з {total}
          </span>

          <button
            type="button"
            onClick={() => {
              if (activeSlide < total - 1) {
                setActiveSlide((prev) => prev + 1);
              } else {
                onClose();
              }
            }}
            className="rounded-xl bg-sys-accent px-5 py-2 text-xs sm:text-sm font-bold text-slate-900 hover:opacity-95 active:scale-95 transition-all shadow-md"
          >
            {activeSlide === total - 1 ? "Зрозуміло ✓" : "Далі →"}
          </button>
        </footer>
      </div>
    </div>
  );
}
