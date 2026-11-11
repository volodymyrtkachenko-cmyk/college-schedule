"use client";

import React, { useEffect, useState, startTransition } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useClassroomSubmissions } from "../lib/useClassroomSubmissions";
import { useTeacherAccess } from "../lib/useTeacherAccess";
import { useUserSettings } from "../lib/useUserSettings";

export interface GuideHubModalProps {
  isOpen?: boolean;
  onClose: () => void;
  initialRole?: "student" | "teacher";
  mode?: "student" | "teacher";
  groupId?: number | null;
  teacherId?: number | null;
}

interface GuideStepMeta {
  id: string;
  tabLabel: string;
  title: string;
  points: [string, string];
}

const STEP_DURATION_MS = 6200;
const TICK_MS = 50;

const STUDENT_STEPS: GuideStepMeta[] = [
  {
    id: "st-1-classroom",
    tabLabel: "Classroom",
    title: "1. Прив'язка пошти @kre.dp.ua та синхронізація",
    points: [
      "Натисніть на закриту кнопку «🔒 Meet / Zoom» або кнопку Classroom у шапці й увійдіть через пошту @kre.dp.ua.",
      "Усі посилання на пари відкриються, а ваші завдання та здачі автоматично синхронізуються між телефоном і ПК.",
    ],
  },
  {
    id: "st-2-subgroup",
    tabLabel: "Підгрупи",
    title: "2. Фільтр своєї підгрупи в 1 клік",
    points: [
      "На парах із поділом натисніть на бейдж «1 підгр.» або «2 підгр.» прямо на картці пари.",
      "Чужий викладач, чужий кабінет та завдання іншої підгрупи автоматично сховаються з усього розкладу.",
    ],
  },
  {
    id: "st-3-zoom",
    tabLabel: "Код Zoom",
    title: "3. Авто-кнопка Zoom та копіювання пароля",
    points: [
      "Система сама розпізнає ID та пароль у тексті викладача і створює кнопку «Zoom · код: ...».",
      "При натисканні на кнопку код доступу миттєво копіюється в буфер обміну — у Zoom достатньо натиснути «Вставити».",
    ],
  },
  {
    id: "st-4-tasks",
    tabLabel: "Завдання",
    title: "4. Єдиний список завдань без гортання тижнів",
    points: [
      "Усі роботи зібрані в 3 вкладки: «До здачі», «Борги» та «Здано» (відсортовані від найновіших публікацій).",
      "Випадаючий фільтр «Усі предмети» дозволяє в 1 тап залишити завдання лише з потрібної дисципліни.",
    ],
  },
  {
    id: "st-5-grades",
    tabLabel: "Оцінки",
    title: "5. Авто-підрахунок середнього бала",
    points: [
      "У вкладці «Оцінки» система автоматично рахує ваш поточний середній бал з кожного предмета.",
      "Оцінки зі 100-бальної шкали Classroom автоматично переводяться у 12-бальну або 5-бальну шкалу.",
    ],
  },
  {
    id: "st-7-teacher-jump",
    tabLabel: "Викладач",
    title: "6. Швидкий перехід у розклад викладача",
    points: [
      "Натисніть на прізвище викладача прямо на картці пари, щоб миттєво відкрити його розклад на день.",
      "Ви одразу побачите, у якій аудиторії зараз викладач, і зможете повернутися назад кнопкою «← До групи».",
    ],
  },
];

const TEACHER_STEPS: GuideStepMeta[] = [
  {
    id: "tc-1-pin",
    tabLabel: "PIN-код",
    title: "1. PIN-код для розблокування онлайн-пар",
    points: [
      "Для захисту від сторонніх гостей посилання на дзвінки за замовчуванням закриті замочком «🔒 Meet / Zoom».",
      "Введіть єдиний PIN-код викладача один раз — і прямі посилання на всі онлайн-пари будуть завжди відкриті.",
    ],
  },
  {
    id: "tc-4-stats",
    tabLabel: "Статистика",
    title: "2. Статистика вичитаних пар та годин",
    points: [
      "У розділі «Статистика» автоматично рахується кількість проведених пар і годин за семестр або вибраний період.",
      "Деталізація показує точне виконання навантаження по кожній дисципліні та кожній навчальній групі.",
    ],
  },
  {
    id: "tc-5-radar",
    tabLabel: "Заміни",
    title: "3. Радар замін та перенесень у розкладі",
    points: [
      "Скасовані та перенесені пари показують точну адресу перенесення («↪ Перенесено → Четвер, 3 пара»).",
      "Призначені разові заміни виділяються жовтою рамкою та бейджем «⚡ Заміна» для миттєвого орієнтування.",
    ],
  },
];

/* SVG-іконки з реальних компонентів сайту */
function PlatformSvg({ platform }: { platform: "meet" | "zoom" }) {
  if (platform === "zoom") {
    return (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" className="shrink-0">
        <path d="M15 8c0-.55-.45-1-1-1H3c-.55 0-1 .45-1 1v8c0 .55.45 1 1 1h11c.55 0 1-.45 1-1v-3.24l4.39 3.59c.35.29.88 0 .88-.45V7.1c0-.45-.53-.74-.88-.45L15 10.24V8z" />
      </svg>
    );
  }
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" className="shrink-0">
      <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" />
    </svg>
  );
}

function UserSvg() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-sys-text-muted shrink-0"
    >
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function ClipboardSvg() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-sys-text-muted"
    >
      <path d="M16 4h2a2 2 0 0 1 2 2v14l-8-4-8 4V6a2 2 0 0 1 2-2h2" />
      <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
    </svg>
  );
}

/**
 * Плавний анімований курсор із реалістичною траєкторією та ефектом натискання
 */
function DemoCursor({
  x,
  y,
  clicking,
}: {
  x: string;
  y: string;
  clicking: boolean;
}) {
  return (
    <motion.div
      aria-hidden="true"
      initial={false}
      animate={{
        left: x,
        top: y,
        scale: clicking ? 0.82 : 1,
      }}
      transition={{
        left: { type: "spring", stiffness: 115, damping: 20, mass: 0.65 },
        top: { type: "spring", stiffness: 115, damping: 20, mass: 0.65 },
        scale: { duration: 0.12, ease: "easeOut" },
      }}
      className="pointer-events-none absolute z-30 -translate-x-1 -translate-y-1 will-change-[left,top,transform]"
    >
      <AnimatePresence>
        {clicking && (
          <motion.span
            key="click-ripple"
            initial={{ scale: 0.35, opacity: 0.95 }}
            animate={{ scale: 2.25, opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.48, ease: "easeOut" }}
            className="absolute -left-2.5 -top-2.5 h-7 w-7 rounded-full border-2 border-sys-accent bg-sys-accent/30"
          />
        )}
      </AnimatePresence>

      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        className="drop-shadow-[0_4px_10px_rgba(0,0,0,0.65)]"
      >
        <path
          d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87c.45 0 .67-.53.35-.85L6.35 2.86a.5.5 0 0 0-.85.35Z"
          fill="#ffffff"
          stroke="#0f172a"
          strokeWidth="1.75"
          strokeLinejoin="round"
        />
      </svg>
    </motion.div>
  );
}

export function GuideHubModal({
  isOpen = true,
  onClose,
  initialRole,
  mode,
  groupId,
  teacherId,
}: GuideHubModalProps) {
  const router = useRouter();
  const { isLinked } = useClassroomSubmissions();
  const { isTeacherUnlocked } = useTeacherAccess();
  const { settings, updateSetting } = useUserSettings();

  const [role, setRole] = useState<"student" | "teacher">(initialRole ?? mode ?? "student");
  const [stepIdx, setStepIdx] = useState(0);
  const [slideDir, setSlideDir] = useState(1);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  const steps = role === "student" ? STUDENT_STEPS : TEACHER_STEPS;
  const stepsCount = steps.length;

  useEffect(() => {
    if (!isOpen || typeof window === "undefined") return;
    setStepIdx(0);
    setElapsedMs(0);
    setIsPaused(false);
    try {
      const storedMode = window.localStorage.getItem("schedule:mode");
      if (!initialRole && !mode && (storedMode === "student" || storedMode === "teacher")) {
        setRole(storedMode);
      } else if (mode || initialRole) {
        setRole(initialRole ?? mode ?? "student");
      }
    } catch {}
  }, [isOpen, initialRole, mode]);

  useEffect(() => {
    if (!isOpen || isPaused) return;
    const timer = setInterval(() => {
      setElapsedMs((prev) => {
        const next = prev + TICK_MS;
        if (next >= STEP_DURATION_MS) {
          setSlideDir(1);
          setStepIdx((cur) => (cur + 1) % stepsCount);
          return 0;
        }
        return next;
      });
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [isOpen, isPaused, stepsCount]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === " ") {
        e.preventDefault();
        setIsPaused((p) => !p);
      }
      if (e.key === "ArrowRight") {
        setSlideDir(1);
        setStepIdx((c) => (c + 1) % stepsCount);
        setElapsedMs(0);
      }
      if (e.key === "ArrowLeft") {
        setSlideDir(-1);
        setStepIdx((c) => (c - 1 + stepsCount) % stepsCount);
        setElapsedMs(0);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose, stepsCount]);

  if (!isOpen) return null;

  const safeIdx = stepIdx < stepsCount ? stepIdx : 0;
  const activeStep = steps[safeIdx] ?? steps[0];
  const progressRatio = Math.min(1, elapsedMs / STEP_DURATION_MS);

  /**
   * 5 плавних фаз таймлайну всередині кожного слайду:
   * stage 0 (0.00 - 0.20): початковий стан («До»)
   * stage 1 (0.20 - 0.42): курсор плавно наводиться на цільову кнопку (hover)
   * stage 2 (0.42 - 0.54): курсор натискає на кнопку (click + ripple)
   * stage 3 (0.54 - 0.78): інтерфейс трансформується у стан «Після»
   * stage 4 (0.78 - 1.00): фінальний стан (або другий клік у багатоходових сценах)
   */
  const stage =
    progressRatio < 0.2
      ? 0
      : progressRatio < 0.42
      ? 1
      : progressRatio < 0.54
      ? 2
      : progressRatio < 0.78
      ? 3
      : 4;

  const goToStep = (nextIdx: number) => {
    startTransition(() => {
      setSlideDir(nextIdx >= safeIdx ? 1 : -1);
      setStepIdx(nextIdx);
      setElapsedMs(0);
    });
  };

  const handleRoleChange = (nextRole: "student" | "teacher") => {
    if (nextRole === role) return;
    startTransition(() => {
      setSlideDir(nextRole === "teacher" ? 1 : -1);
      setRole(nextRole);
      setStepIdx(0);
      setElapsedMs(0);
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 sm:bg-black/70 sm:backdrop-blur-xs p-0 sm:p-4 animate-in fade-in duration-150"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="guide-title"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-[520px] max-h-[94dvh] sm:max-h-[90vh] flex flex-col rounded-t-2xl sm:rounded-2xl border border-sys-border bg-sys-card text-sys-text-primary shadow-2xl overflow-hidden select-none"
      >
        {/* =========================================================
            1. HEADER + ROLE SWITCHER + STEP TABS
           ========================================================= */}
        <div className="px-4 pt-3.5 pb-2.5 bg-sys-surface border-b border-sys-border space-y-2.5 shrink-0">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h2 id="guide-title" className="text-sm sm:text-base font-bold text-sys-text-primary truncate">
                Як користуватися розкладом
              </h2>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {/* Role Segmented Switcher */}
              <div className="relative inline-grid grid-cols-2 rounded-lg border border-sys-border bg-sys-bg p-0.5 text-xs font-semibold isolate">
                <div
                  aria-hidden="true"
                  className="absolute top-0.5 bottom-0.5 pointer-events-none transition-transform duration-200 ease-out transform-gpu will-change-transform z-0"
                  style={{
                    left: "2px",
                    width: "calc((100% - 4px) / 2)",
                    transform: `translate3d(${role === "teacher" ? "100%" : "0%"}, 0, 0)`,
                  }}
                >
                  <div className="h-full w-full rounded-md bg-sys-accentSolid shadow-2xs" />
                </div>
                <button
                  type="button"
                  onClick={() => handleRoleChange("student")}
                  className={`relative z-10 px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                    role === "student" ? "text-white font-bold" : "text-sys-text-secondary hover:text-sys-text-primary"
                  }`}
                >
                  Студент
                </button>
                <button
                  type="button"
                  onClick={() => handleRoleChange("teacher")}
                  className={`relative z-10 px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                    role === "teacher" ? "text-white font-bold" : "text-sys-text-secondary hover:text-sys-text-primary"
                  }`}
                >
                  Викладач
                </button>
              </div>

              <button
                type="button"
                onClick={onClose}
                aria-label="Закрити"
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-sys-border bg-sys-bg text-sys-text-secondary hover:text-sys-text-primary active:scale-95 transition-colors cursor-pointer text-xs"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Step Tabs with Smooth Sliding Pill & Progress Fill */}
          <div
            className="relative grid rounded-xl border border-sys-border bg-sys-bg p-1 text-[11px] font-semibold isolate"
            style={{
              gridTemplateColumns: `repeat(${stepsCount}, minmax(0, 1fr))`,
            }}
          >
            <div
              aria-hidden="true"
              className="absolute top-1 bottom-1 pointer-events-none transition-transform duration-200 ease-out transform-gpu will-change-transform z-0"
              style={{
                left: "4px",
                width: `calc((100% - 8px) / ${stepsCount})`,
                transform: `translate3d(calc(${safeIdx} * 100%), 0, 0)`,
              }}
            >
              <div className="relative h-full w-full rounded-lg bg-sys-card border border-sys-border overflow-hidden shadow-2xs">
                <div
                  className="absolute bottom-0 left-0 right-0 h-[2.5px] bg-sys-accent origin-left transform-gpu transition-transform duration-75 ease-linear"
                  style={{ transform: `scaleX(${progressRatio})` }}
                />
              </div>
            </div>

            {steps.map((s, idx) => {
              const isCurrent = idx === safeIdx;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => goToStep(idx)}
                  className={`relative z-10 py-1.5 px-0.5 rounded-lg transition-colors duration-150 cursor-pointer truncate ${
                    isCurrent ? "text-sys-accent font-bold" : "text-sys-text-secondary hover:text-sys-text-primary"
                  }`}
                >
                  {s.tabLabel}
                </button>
              );
            })}
          </div>
        </div>

        {/* =========================================================
            2. ANIMATED STAGE + STEP DESCRIPTION
           ========================================================= */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
          <AnimatePresence mode="wait" initial={false} custom={slideDir}>
            <motion.div
              key={`${role}-${activeStep.id}`}
              custom={slideDir}
              initial={{ opacity: 0, x: slideDir * 22 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: slideDir * -22 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="space-y-4"
            >
              {/* FIXED-HEIGHT INTERACTIVE STAGE (h-[232px]) */}
              <div
                onClick={() => setIsPaused((p) => !p)}
                title="Натисніть на сцену для паузи / продовження"
                className="relative mx-auto w-full h-[232px] rounded-2xl border border-sys-border bg-sys-bg p-3.5 flex flex-col justify-center overflow-hidden cursor-pointer shadow-inner"
              >
                {/* =====================================================
                    STUDENT 1: ПРИВ'ЯЗКА CLASSROOM (@kre.dp.ua)
                   ===================================================== */}
                {role === "student" && safeIdx === 0 && (
                  <div className="relative w-full max-w-[400px] mx-auto space-y-2.5">
                    <DemoCursor
                      x={stage === 0 ? "45%" : stage <= 2 ? "82%" : "88%"}
                      y={stage === 0 ? "78%" : stage <= 2 ? "28%" : "68%"}
                      clicking={stage === 2}
                    />

                    {/* Real LessonCard */}
                    <div className="rounded-2xl border border-sys-border bg-sys-card p-3.5 shadow-sm space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-base font-black text-sys-text-primary leading-none">1</span>
                          <span className="text-sys-text-muted font-bold text-xs">·</span>
                          <span className="text-xs font-semibold text-sys-text-secondary">09:00–10:20</span>
                        </div>

                        <AnimatePresence mode="wait" initial={false}>
                          {stage < 3 ? (
                            <motion.div
                              key="locked-btn"
                              initial={{ opacity: 0, scale: 0.92 }}
                              animate={{
                                opacity: 1,
                                scale: stage === 2 ? 0.93 : 1,
                              }}
                              exit={{ opacity: 0, scale: 0.92 }}
                              transition={{ duration: 0.15 }}
                              className={`inline-flex h-8 px-2.5 items-center gap-1.5 rounded-lg border text-xs font-bold transition-all ${
                                stage === 1 || stage === 2
                                  ? "border-amber-400 bg-amber-500/25 text-amber-200 ring-2 ring-amber-400/40"
                                  : "border-amber-500/40 bg-amber-500/15 text-amber-800 dark:text-amber-200"
                              }`}
                            >
                              <span>🔒</span>
                              <span>Meet</span>
                            </motion.div>
                          ) : (
                            <motion.div
                              key="unlocked-btn"
                              initial={{ opacity: 0, scale: 0.92 }}
                              animate={{ opacity: 1, scale: 1 }}
                              transition={{ duration: 0.18 }}
                              className="inline-flex h-8 px-2.5 items-center gap-1.5 rounded-lg border border-emerald-400/60 dark:border-emerald-500/50 bg-emerald-100/80 dark:bg-emerald-500/20 text-emerald-900 dark:text-emerald-200 text-xs font-bold shadow-xs"
                            >
                              <PlatformSvg platform="meet" />
                              <span>Meet</span>
                              <span className="opacity-75">↗</span>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>

                      <div>
                        <div className="text-sm font-bold text-sys-text-subject leading-snug">
                          Вища математика
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-sys-text-secondary mt-1">
                          <UserSvg />
                          <span>Іваненко О.М.</span>
                        </div>
                      </div>

                      {/* Sync Status / Homework Strip */}
                      <AnimatePresence mode="wait" initial={false}>
                        {stage < 3 ? (
                          <motion.div
                            key="pre-sync-hint"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.14 }}
                            className="flex items-center justify-between rounded-xl border border-dashed border-sys-border bg-sys-bg/50 px-3 py-2 text-xs text-sys-text-muted"
                          >
                            <span>Посилання та ДЗ захищені</span>
                            <span className="text-sys-accent font-semibold">Вхід @kre.dp.ua</span>
                          </motion.div>
                        ) : (
                          <motion.div
                            key="post-sync-hw"
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="flex items-center justify-between rounded-xl bg-sys-bg/60 border border-sys-border px-3 py-2 text-xs"
                            style={{ boxShadow: "inset 3px 0 0 #8b5cf6" }}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <ClipboardSvg />
                              <span className="font-semibold text-sys-text-primary truncate">
                                Практична робота №5
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0 ml-2">
                              <span className="h-1.5 w-1.5 rounded-full bg-purple-500" />
                              <span className="text-purple-700 dark:text-purple-300 font-medium">
                                до 15 лист.
                              </span>
                              <span className="text-sys-text-muted">↗</span>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                )}

                {/* =====================================================
                    STUDENT 2: ФІЛЬТР СВОЄЇ ПІДГРУПИ В 1 КЛІК
                   ===================================================== */}
                {role === "student" && safeIdx === 1 && (
                  <div className="relative w-full max-w-[400px] mx-auto">
                    <DemoCursor
                      x={stage === 0 ? "62%" : stage <= 2 ? "18%" : "78%"}
                      y={stage === 0 ? "82%" : stage <= 2 ? "54%" : "26%"}
                      clicking={stage === 2}
                    />

                    <div className="rounded-2xl border border-sys-border bg-sys-card p-3.5 shadow-sm space-y-2.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-base font-black text-sys-text-primary leading-none">2</span>
                          <span className="text-sys-text-muted font-bold text-xs">·</span>
                          <span className="text-xs font-semibold text-sys-text-secondary">10:40–12:00</span>
                        </div>
                        {stage >= 3 && (
                          <motion.span
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ duration: 0.18 }}
                            className="inline-flex h-7 px-2.5 items-center gap-1.5 rounded-lg border border-emerald-400/60 dark:border-emerald-500/50 bg-emerald-100/80 dark:bg-emerald-500/20 text-emerald-900 dark:text-emerald-200 text-xs font-bold"
                          >
                            <PlatformSvg platform="meet" />
                            <span>Meet ↗</span>
                          </motion.span>
                        )}
                      </div>

                      <div className="text-sm font-bold text-sys-text-subject leading-snug">
                        Іноземна мова (за проф. спрямуванням)
                      </div>

                      {/* Subgroup 1 Row */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <motion.span
                            animate={{ scale: stage === 2 ? 0.92 : 1 }}
                            className={`inline-flex shrink-0 items-center gap-1.5 h-6 px-2 rounded-md border text-xs font-semibold transition-all duration-150 ${
                              stage >= 3
                                ? "border-sys-accent/35 bg-sys-accent/15 text-sys-accent"
                                : stage >= 1
                                ? "border-sys-accent/60 bg-sys-accent/10 text-sys-text-primary ring-2 ring-sys-accent/30"
                                : "bg-sys-bg/80 border-sys-border text-sys-text-secondary"
                            }`}
                          >
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${
                                stage >= 3 ? "bg-sys-accent" : "bg-sys-text-muted/60"
                              }`}
                            />
                            <span>1 підгр.</span>
                          </motion.span>
                          <UserSvg />
                          <span className="text-xs font-medium text-sys-text-secondary truncate">
                            Токарєва О.В.
                          </span>
                        </div>

                        {stage < 3 && (
                          <span className="inline-flex h-7 px-2.5 items-center gap-1.5 rounded-lg border border-emerald-400/60 dark:border-emerald-500/50 bg-emerald-100/80 dark:bg-emerald-500/20 text-emerald-900 dark:text-emerald-200 text-xs font-semibold">
                            <PlatformSvg platform="meet" />
                            <span>Meet ↗</span>
                          </span>
                        )}
                      </div>

                      {/* Subgroup 2 Row (Smoothly collapses at stage >= 3) */}
                      <AnimatePresence initial={false}>
                        {stage < 3 && (
                          <motion.div
                            key="sub-2"
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                            className="overflow-hidden"
                          >
                            <div className="flex items-center justify-between gap-2 pt-0.5">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="inline-flex shrink-0 items-center gap-1.5 h-6 px-2 rounded-md border border-sys-border bg-sys-bg/80 text-xs font-semibold text-sys-text-secondary">
                                  <span className="h-1.5 w-1.5 rounded-full bg-sys-text-muted/60" />
                                  <span>2 підгр.</span>
                                </span>
                                <UserSvg />
                                <span className="text-xs font-medium text-sys-text-secondary truncate">
                                  Хочинська І.В.
                                </span>
                              </div>
                              <span className="shrink-0 rounded-md border border-sys-border bg-sys-bg px-2 py-1 text-xs font-semibold text-sys-text-secondary">
                                ауд. 204
                              </span>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                )}

                {/* =====================================================
                    STUDENT 3: АВТО-КНОПКА ZOOM ТА КОПІЮВАННЯ ПАРОЛЯ
                   ===================================================== */}
                {role === "student" && safeIdx === 2 && (
                  <div className="relative w-full max-w-[400px] mx-auto space-y-2.5">
                    <DemoCursor
                      x={stage === 0 ? "30%" : stage <= 2 ? "76%" : "86%"}
                      y={stage === 0 ? "78%" : stage <= 2 ? "38%" : "75%"}
                      clicking={stage === 2}
                    />

                    {/* Toast on Click */}
                    <AnimatePresence>
                      {stage >= 3 && (
                        <motion.div
                          key="zoom-copied-toast"
                          initial={{ opacity: 0, y: -10, scale: 0.96 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: -8 }}
                          transition={{ duration: 0.18 }}
                          className="flex items-center justify-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-3 py-2 text-xs font-bold text-emerald-700 dark:text-emerald-300 shadow-sm"
                        >
                          <span>✓</span>
                          <span>Код доступу Zoom (dfkr) скопійовано!</span>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    <div className="rounded-2xl border border-sys-border bg-sys-card p-3.5 shadow-sm space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-base font-black text-sys-text-primary leading-none">3</span>
                          <span className="text-sys-text-muted font-bold text-xs">·</span>
                          <span className="text-xs font-semibold text-sys-text-secondary">12:30–13:50</span>
                        </div>

                        <motion.div
                          animate={{ scale: stage === 2 ? 0.93 : 1 }}
                          transition={{ duration: 0.12 }}
                          className={`inline-flex h-8 px-2.5 items-center gap-1.5 rounded-lg border text-xs font-bold shadow-xs transition-all ${
                            stage === 1 || stage === 2
                              ? "border-sky-400 bg-sky-500/30 text-sky-100 ring-2 ring-sky-400/40"
                              : "border-sky-400/60 dark:border-sky-500/50 bg-sky-100/80 dark:bg-sky-500/20 text-sky-900 dark:text-sky-200"
                          }`}
                        >
                          <PlatformSvg platform="zoom" />
                          <span>Zoom · код: dfkr</span>
                          <span className="opacity-75">↗</span>
                        </motion.div>
                      </div>

                      <div>
                        <div className="text-sm font-bold text-sys-text-subject leading-snug">
                          Електроніка та мікросхемотехніка
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-sys-text-secondary mt-1">
                          <UserSvg />
                          <span>Філімончук Т.В.</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* =====================================================
                    STUDENT 4: ЄДИНИЙ TO-DO СПИСОК ЗАВДАНЬ
                   ===================================================== */}
                {role === "student" && safeIdx === 3 && (
                  <div className="relative w-full max-w-[400px] mx-auto space-y-2">
                    <DemoCursor
                      x={stage === 0 ? "18%" : stage <= 2 ? "50%" : "82%"}
                      y={stage === 0 ? "22%" : stage <= 2 ? "20%" : "20%"}
                      clicking={stage === 2}
                    />

                    {/* 3 Status Segmented Pills */}
                    <div className="relative grid grid-cols-3 rounded-xl border border-sys-border bg-sys-card p-1 text-xs font-semibold isolate">
                      <div
                        className="absolute top-1 bottom-1 transition-transform duration-200 ease-out transform-gpu z-0"
                        style={{
                          left: "4px",
                          width: "calc((100% - 8px) / 3)",
                          transform: `translate3d(${stage >= 3 ? "100%" : "0%"}, 0, 0)`,
                        }}
                      >
                        <div className={`h-full w-full rounded-lg shadow-2xs ${stage >= 3 ? "bg-rose-600" : "bg-sys-accentSolid"}`} />
                      </div>
                      <div className={`relative z-10 text-center py-1.5 ${stage < 3 ? "text-white font-bold" : "text-sys-text-secondary"}`}>
                        До здачі 3
                      </div>
                      <div className={`relative z-10 text-center py-1.5 ${stage >= 3 ? "text-white font-bold" : "text-rose-500"}`}>
                        Борги 1
                      </div>
                      <div className="relative z-10 text-center py-1.5 text-sys-text-secondary">
                        Здано 14
                      </div>
                    </div>

                    {/* Collapsible Subject Selector Replica */}
                    <div className="flex items-center justify-between rounded-xl border border-sys-border bg-sys-card px-3 py-1.5 text-xs font-semibold text-sys-text-secondary">
                      <span>Усі предмети (6)</span>
                      <span>▾</span>
                    </div>

                    {/* TaskCardItem Replica */}
                    <AnimatePresence mode="wait" initial={false}>
                      {stage < 3 ? (
                        <motion.div
                          key="todo-pending"
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -6 }}
                          transition={{ duration: 0.16 }}
                          className="rounded-xl bg-sys-card border border-sys-border p-3 shadow-xs space-y-1"
                          style={{ boxShadow: "inset 3px 0 0 #f59e0b" }}
                        >
                          <div className="flex items-center justify-between text-xs font-semibold text-sys-text-primary">
                            <span>Лабораторна робота №4</span>
                            <span className="text-sys-text-muted">↗</span>
                          </div>
                          <p className="text-[11px] text-sys-text-muted">Комп&apos;ютерна схемотехніка · Іваненко О.М.</p>
                          <div className="flex items-center gap-1.5 text-[11px] font-medium text-amber-600 dark:text-amber-400 pt-0.5">
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                            <span>Завтра</span>
                          </div>
                        </motion.div>
                      ) : (
                        <motion.div
                          key="todo-overdue"
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -6 }}
                          transition={{ duration: 0.18 }}
                          className="rounded-xl bg-sys-card border border-sys-border p-3 shadow-xs space-y-1"
                          style={{ boxShadow: "inset 3px 0 0 #ef4444" }}
                        >
                          <div className="flex items-center justify-between text-xs font-semibold text-sys-text-primary">
                            <span>Практична робота №2</span>
                            <span className="text-sys-text-muted">↗</span>
                          </div>
                          <p className="text-[11px] text-sys-text-muted">Вища математика · Петренко І.В.</p>
                          <div className="flex items-center gap-1.5 text-[11px] font-medium text-rose-600 dark:text-rose-400 pt-0.5">
                            <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                            <span>10 лист. · прострочено 2 дні</span>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}

                {/* =====================================================
                    STUDENT 5: АВТО-ПІДРАХУНОК СЕРЕДНЬОГО БАЛА («ОЦІНКИ»)
                   ===================================================== */}
                {role === "student" && safeIdx === 4 && (
                  <div className="relative w-full max-w-[400px] mx-auto space-y-2">
                    <DemoCursor
                      x={stage === 0 ? "25%" : stage <= 2 ? "74%" : "82%"}
                      y={stage === 0 ? "22%" : stage <= 2 ? "18%" : "68%"}
                      clicking={stage === 2}
                    />

                    {/* Top Switcher: Завдання | Оцінки */}
                    <div className="relative grid grid-cols-2 rounded-xl border border-sys-border bg-sys-card p-1 text-xs font-semibold isolate">
                      <div
                        className="absolute top-1 bottom-1 transition-transform duration-200 ease-out transform-gpu z-0"
                        style={{
                          left: "4px",
                          width: "calc((100% - 8px) / 2)",
                          transform: `translate3d(${stage >= 3 ? "100%" : "0%"}, 0, 0)`,
                        }}
                      >
                        <div className="h-full w-full rounded-lg bg-sys-accentSolid shadow-2xs" />
                      </div>
                      <div className={`relative z-10 text-center py-1.5 ${stage < 3 ? "text-white font-bold" : "text-sys-text-secondary"}`}>
                        📋 Завдання (4)
                      </div>
                      <div className={`relative z-10 text-center py-1.5 ${stage >= 3 ? "text-white font-bold" : "text-sys-text-secondary"}`}>
                        📊 Оцінки
                      </div>
                    </div>

                    {/* GradesView Subject Card Replica */}
                    <div className="rounded-2xl border border-sys-border bg-sys-card p-3.5 shadow-sm space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm font-bold text-sys-text-primary truncate">
                            Вища математика
                          </div>
                          <div className="text-[11px] text-sys-text-secondary mt-0.5">
                            Оцінено робіт: 6 • 12-бальна шкала
                          </div>
                        </div>

                        <motion.div
                          animate={{ scale: stage >= 3 ? [1, 1.08, 1] : 1 }}
                          transition={{ duration: 0.28 }}
                          className="shrink-0 rounded-xl border border-emerald-500/35 bg-emerald-500/15 px-3 py-1.5 text-right"
                        >
                          <div className="text-[10px] font-semibold uppercase text-emerald-700 dark:text-emerald-300">
                            Середній
                          </div>
                          <div className="text-base font-black leading-none text-emerald-700 dark:text-emerald-300 mt-0.5">
                            11.0
                          </div>
                        </motion.div>
                      </div>

                      <div className="flex items-center justify-between rounded-lg bg-sys-bg/70 border border-sys-border/60 px-2.5 py-1.5 text-xs">
                        <span className="font-medium text-sys-text-primary truncate">
                          Контрольна робота №1
                        </span>
                        <span className="font-bold text-emerald-600 dark:text-emerald-400 shrink-0 ml-2">
                          95/100 → 11 б.
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* =====================================================
                    STUDENT 6 (#7): ШВИДКИЙ ПЕРЕХІД У РОЗКЛАД ВИКЛАДАЧА
                   ===================================================== */}
                {role === "student" && safeIdx === 5 && (
                  <div className="relative w-full max-w-[400px] mx-auto">
                    <DemoCursor
                      x={stage === 0 ? "75%" : stage <= 2 ? "32%" : "82%"}
                      y={stage === 0 ? "30%" : stage <= 2 ? "74%" : "22%"}
                      clicking={stage === 2}
                    />

                    <AnimatePresence mode="wait" initial={false}>
                      {stage < 3 ? (
                        <motion.div
                          key="st-card-before-jump"
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -6 }}
                          transition={{ duration: 0.18 }}
                          className="rounded-2xl border border-sys-border bg-sys-card p-3.5 shadow-sm space-y-2.5"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-base font-black text-sys-text-primary leading-none">2</span>
                              <span className="text-sys-text-muted font-bold text-xs">·</span>
                              <span className="text-xs font-semibold text-sys-text-secondary">10:40–12:00</span>
                            </div>
                            <span className="rounded-lg border border-sys-border bg-sys-bg px-2.5 py-1 text-xs font-medium text-sys-text-secondary">
                              ауд. 305
                            </span>
                          </div>

                          <div className="text-sm font-bold text-sys-text-subject">
                            Комп&apos;ютерна схемотехніка
                          </div>

                          <div className="flex items-center gap-1.5 text-xs">
                            <UserSvg />
                            <span
                              className={`font-semibold rounded px-1.5 py-0.5 transition-all ${
                                stage === 1 || stage === 2
                                  ? "bg-sys-accent/20 text-sys-accent underline underline-offset-2 ring-1 ring-sys-accent/40"
                                  : "text-sys-text-secondary"
                              }`}
                            >
                              Іваненко О.М.
                            </span>
                          </div>
                        </motion.div>
                      ) : (
                        <motion.div
                          key="st-teacher-jumped"
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -8 }}
                          transition={{ duration: 0.2 }}
                          className="space-y-2"
                        >
                          {/* Exact Return Banner from SchedulePageClient.tsx */}
                          <div className="flex items-center justify-between rounded-xl border border-sys-accent/30 bg-sys-accent/10 px-3 py-2 text-xs">
                            <span className="text-sys-text-secondary truncate mr-2">
                              Викладач: <strong className="text-sys-text-primary">Іваненко О.М.</strong>
                            </span>
                            <span className="shrink-0 rounded-lg bg-sys-accent px-2.5 py-1 text-[11px] font-semibold text-white">
                              ← До КІ-24-2/9-85
                            </span>
                          </div>

                          <div className="rounded-xl border border-sys-border bg-sys-card p-3 space-y-1.5 text-xs">
                            <div className="flex justify-between">
                              <span className="font-bold text-sys-text-primary">1 пара • Група КІ-23-1/9-79</span>
                              <span className="text-sys-text-secondary">ауд. 305</span>
                            </div>
                            <div className="flex justify-between pt-1 border-t border-sys-border/50">
                              <span className="font-bold text-sys-accent">2 пара • Група КІ-24-2/9-85</span>
                              <span className="text-sys-text-secondary">ауд. 305</span>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}

                {/* =====================================================
                    TEACHER 1 (#1): PIN-КОД ДЛЯ РОЗБЛОКУВАННЯ ПОСИЛАНЬ
                   ===================================================== */}
                {role === "teacher" && safeIdx === 0 && (
                  <div className="relative w-full max-w-[400px] mx-auto space-y-2.5">
                    <DemoCursor
                      x={stage === 0 ? "40%" : stage <= 2 ? "82%" : "88%"}
                      y={stage === 0 ? "75%" : stage <= 2 ? "28%" : "68%"}
                      clicking={stage === 2}
                    />

                    <div className="rounded-2xl border border-sys-border bg-sys-card p-3.5 shadow-sm space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-base font-black text-sys-text-primary leading-none">1</span>
                          <span className="text-sys-text-muted font-bold text-xs">·</span>
                          <span className="text-xs font-semibold text-sys-text-secondary">09:00–10:20</span>
                        </div>

                        <AnimatePresence mode="wait" initial={false}>
                          {stage < 3 ? (
                            <motion.div
                              key="tc-locked"
                              initial={{ opacity: 0, scale: 0.92 }}
                              animate={{ opacity: 1, scale: stage === 2 ? 0.93 : 1 }}
                              exit={{ opacity: 0, scale: 0.92 }}
                              className={`inline-flex h-8 px-2.5 items-center gap-1.5 rounded-lg border text-xs font-bold transition-all ${
                                stage === 1 || stage === 2
                                  ? "border-amber-400 bg-amber-500/25 text-amber-200 ring-2 ring-amber-400/40"
                                  : "border-amber-500/40 bg-amber-500/15 text-amber-800 dark:text-amber-200"
                              }`}
                            >
                              <span>🔒</span>
                              <span>Zoom</span>
                            </motion.div>
                          ) : (
                            <motion.div
                              key="tc-unlocked"
                              initial={{ opacity: 0, scale: 0.92 }}
                              animate={{ opacity: 1, scale: 1 }}
                              className="inline-flex h-8 px-2.5 items-center gap-1.5 rounded-lg border border-sky-400/60 dark:border-sky-500/50 bg-sky-100/80 dark:bg-sky-500/20 text-sky-900 dark:text-sky-200 text-xs font-bold shadow-xs"
                            >
                              <PlatformSvg platform="zoom" />
                              <span>Zoom ↗</span>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>

                      <div>
                        <div className="text-sm font-bold text-sys-text-subject leading-snug">
                          Комп&apos;ютерна схемотехніка
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-sys-text-secondary mt-1">
                          <UserSvg />
                          <span className="text-sys-text-muted">Група:</span>
                          <span className="font-medium text-sys-text-secondary">КІ-24-2/9-85</span>
                        </div>
                      </div>

                      <AnimatePresence mode="wait" initial={false}>
                        {stage < 3 ? (
                          <motion.div
                            key="pin-input-row"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="flex items-center justify-between gap-2 rounded-xl border border-sys-accent/40 bg-sys-bg px-3 py-2 text-xs"
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-sys-text-secondary">PIN викладача:</span>
                              <span className="font-mono font-black tracking-widest text-sys-text-primary">
                                {stage >= 1 ? "••••" : "••"}
                              </span>
                            </div>
                            <span className="rounded-lg bg-sys-accent px-2.5 py-1 text-[11px] font-bold text-white">
                              Відкрити
                            </span>
                          </motion.div>
                        ) : (
                          <motion.div
                            key="pin-active-row"
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="flex items-center gap-2 rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300"
                          >
                            <span>✓</span>
                            <span>Доступ до онлайн-пар відкрито для всіх груп</span>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                )}

                {/* =====================================================
                    TEACHER 2 (#4): СТАТИСТИКА ВИЧИТАНИХ ГОДИН
                   ===================================================== */}
                {role === "teacher" && safeIdx === 1 && (
                  <div className="relative w-full max-w-[400px] mx-auto space-y-2.5">
                    <DemoCursor
                      x={stage === 0 ? "25%" : stage <= 2 ? "65%" : "82%"}
                      y={stage === 0 ? "24%" : stage <= 2 ? "54%" : "76%"}
                      clicking={stage === 2}
                    />

                    {/* Top Summary Bar from Statistics Page */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-xl border border-sys-border bg-sys-card px-3 py-2 shadow-2xs">
                        <div className="text-[10px] font-bold uppercase text-sys-text-muted">Проведено за семестр</div>
                        <div className="text-sm font-black text-sys-accent mt-0.5">48 пар • 96 год</div>
                      </div>
                      <div className="rounded-xl border border-sys-border bg-sys-card px-3 py-2 shadow-2xs">
                        <div className="text-[10px] font-bold uppercase text-sys-text-muted">Заміни / Перенесення</div>
                        <div className="text-sm font-black text-emerald-500 mt-0.5">+4 пари враховано</div>
                      </div>
                    </div>

                    {/* Subject & Group Breakdown Card */}
                    <div className="rounded-xl border border-sys-border bg-sys-card p-3 space-y-2 shadow-xs">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-sys-text-primary">Комп&apos;ютерна схемотехніка</span>
                        <span className="font-bold text-sys-accent">34 пари (68 год)</span>
                      </div>

                      <div className="space-y-1.5 pt-1 border-t border-sys-border/50 text-[11px]">
                        <div className="flex items-center justify-between">
                          <span className="text-sys-text-secondary">Група КІ-24-1/9-85</span>
                          <span className="font-bold text-sys-text-primary">18 пар • 36 год</span>
                        </div>
                        <div
                          className={`flex items-center justify-between rounded-lg px-2 py-1 transition-colors ${
                            stage >= 3 ? "bg-sys-accent/15 text-sys-accent font-bold" : "text-sys-text-secondary"
                          }`}
                        >
                          <span>Група КІ-24-2/9-86</span>
                          <span>16 пар • 32 год</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* =====================================================
                    TEACHER 3 (#5): РАДАР ЗАМІН ТА ПЕРЕНЕСЕНЬ
                   ===================================================== */}
                {role === "teacher" && safeIdx === 2 && (
                  <div className="relative w-full max-w-[400px] mx-auto space-y-2">
                    <DemoCursor
                      x={stage === 0 ? "48%" : "70%"}
                      y={stage === 0 ? "18%" : "18%"}
                      clicking={stage === 2}
                    />

                    {/* Exact MobileWeekDaysStrip Replica */}
                    <div className="relative flex h-10 w-full rounded-xl border border-sys-border bg-sys-card overflow-hidden text-xs">
                      <div
                        className="absolute bottom-0 left-0 h-[2.5px] bg-sys-accent transition-transform duration-200 ease-out"
                        style={{
                          width: "20%",
                          transform: `translateX(${(stage >= 3 ? 3 : 2) * 100}%)`,
                        }}
                      />
                      {["Пн 10", "Вт 11", "Ср 12", "Чт 13", "Пт 14"].map((d, i) => {
                        const active = (stage >= 3 ? 3 : 2) === i;
                        return (
                          <div
                            key={d}
                            className={`flex-1 flex items-center justify-center font-semibold transition-colors ${
                              active ? "text-sys-accent font-bold" : "text-sys-text-secondary"
                            }`}
                          >
                            {d}
                          </div>
                        );
                      })}
                    </div>

                    <AnimatePresence mode="wait" initial={false}>
                      {stage < 3 ? (
                        <motion.div
                          key="radar-moved"
                          initial={{ opacity: 0, x: -14 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: -14 }}
                          transition={{ duration: 0.18 }}
                          className="rounded-2xl border border-rose-500/40 border-dashed bg-sys-card p-3.5 space-y-1.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-sys-text-secondary">3 пара · 12:30–13:50</span>
                            <span className="rounded-md px-2 py-0.5 text-[11px] font-bold border border-amber-500/40 bg-amber-500/15 text-amber-800 dark:text-amber-300">
                              ↪ Перенесено → Четвер, 3 пара
                            </span>
                          </div>
                          <div className="text-sm font-bold line-through text-sys-text-muted">
                            Мікропроцесорні системи
                          </div>
                          <div className="text-xs text-sys-text-secondary">
                            Група: КІ-24-2/9-85
                          </div>
                        </motion.div>
                      ) : (
                        <motion.div
                          key="radar-replacement"
                          initial={{ opacity: 0, x: 14 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: 14 }}
                          transition={{ duration: 0.18 }}
                          className="rounded-2xl border border-sys-warning/40 ring-1 ring-sys-warning/60 bg-sys-card p-3.5 space-y-1.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-sys-text-secondary">3 пара · 12:30–13:50</span>
                            <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold bg-sys-warning uppercase text-sys-warningText">
                              ⚡ Заміна
                            </span>
                          </div>
                          <div className="text-sm font-bold text-sys-text-subject">
                            Мікропроцесорні системи
                          </div>
                          <div className="text-xs text-sys-text-secondary">
                            Група: КІ-24-2/9-85 • ауд. 305
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}
              </div>

              {/* =====================================================
                  3. CONCISE STEP EXPLANATION + CONTEXTUAL ACTION
                 ===================================================== */}
              <div className="space-y-2.5 px-0.5">
                <h3 className="text-sm sm:text-base font-bold text-sys-text-primary leading-snug">
                  {activeStep.title}
                </h3>

                <ul className="space-y-1.5 text-xs text-sys-text-secondary leading-relaxed">
                  <li className="flex items-start gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-sys-accent shrink-0" />
                    <span>{activeStep.points[0]}</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-sys-accent shrink-0" />
                    <span>{activeStep.points[1]}</span>
                  </li>
                </ul>

                {/* Швидка дія прямо з поточного слайду */}
                {role === "student" && safeIdx === 0 && !isLinked && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      setTimeout(() => window.dispatchEvent(new CustomEvent("trigger-classroom-sync")), 120);
                    }}
                    className="mt-1 w-full rounded-xl bg-sys-accent py-2.5 text-xs font-bold text-white hover:opacity-95 active:scale-[0.99] transition-all cursor-pointer shadow-xs"
                  >
                    Прив&apos;язати пошту @kre.dp.ua зараз →
                  </button>
                )}

                {role === "student" && safeIdx === 1 && (
                  <div className="flex items-center justify-between rounded-xl border border-sys-border bg-sys-bg px-3 py-2 text-xs">
                    <span className="font-semibold text-sys-text-secondary">Ваша підгрупа за замовчуванням:</span>
                    <div className="inline-flex gap-1">
                      {(["all", 1, 2] as const).map((sub) => (
                        <button
                          key={String(sub)}
                          type="button"
                          onClick={() => updateSetting("defaultSubgroup", sub)}
                          className={`rounded-lg px-2.5 py-1 text-[11px] font-bold transition-colors cursor-pointer ${
                            settings.defaultSubgroup === sub
                              ? "bg-sys-accent text-white"
                              : "bg-sys-card text-sys-text-secondary border border-sys-border"
                          }`}
                        >
                          {sub === "all" ? "Обидві" : `${sub} підгр.`}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {role === "teacher" && safeIdx === 0 && !isTeacherUnlocked && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      router.push("/settings?mode=teacher");
                    }}
                    className="mt-1 w-full rounded-xl bg-sys-accent py-2.5 text-xs font-bold text-white hover:opacity-95 active:scale-[0.99] transition-all cursor-pointer shadow-xs"
                  >
                    Ввести PIN-код викладача в Налаштуваннях →
                  </button>
                )}

                {role === "teacher" && safeIdx === 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      router.push("/statistics");
                    }}
                    className="mt-1 w-full rounded-xl bg-sys-accent/15 border border-sys-accent/35 py-2 text-xs font-bold text-sys-accent hover:bg-sys-accent/25 active:scale-[0.99] transition-all cursor-pointer"
                  >
                    Відкрити сторінку Статистики →
                  </button>
                )}
              </div>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* =========================================================
            4. FOOTER CONTROLS
           ========================================================= */}
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-sys-border bg-sys-surface shrink-0">
          <button
            type="button"
            onClick={() => goToStep((safeIdx - 1 + stepsCount) % stepsCount)}
            className="rounded-xl border border-sys-border bg-sys-card px-3.5 py-2 text-xs font-semibold text-sys-text-secondary hover:text-sys-text-primary active:scale-95 transition-all cursor-pointer"
          >
            ← Назад
          </button>

          <button
            type="button"
            onClick={() => setIsPaused((p) => !p)}
            className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-sys-text-muted hover:text-sys-text-primary transition-colors cursor-pointer"
          >
            {isPaused ? "▶ Продовжити" : "⏸ Пауза"}
          </button>

          <button
            type="button"
            onClick={() => {
              if (safeIdx === stepsCount - 1) {
                onClose();
              } else {
                goToStep(safeIdx + 1);
              }
            }}
            className="rounded-xl bg-sys-accent px-4 py-2 text-xs font-bold text-white hover:opacity-95 active:scale-95 transition-all cursor-pointer"
          >
            {safeIdx === stepsCount - 1 ? "Зрозуміло ✓" : "Далі →"}
          </button>
        </div>
      </div>
    </div>
  );
}
