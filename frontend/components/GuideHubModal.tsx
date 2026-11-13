"use client";

import React, { useEffect, useState, startTransition } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useClassroomSubmissions } from "../lib/useClassroomSubmissions";
import { useTeacherAccess } from "../lib/useTeacherAccess";
import { useUserSettings } from "../lib/useUserSettings";
import { useMobileNav } from "../lib/useMobileNav";

export interface GuideHubModalProps {
  isOpen?: boolean;
  onClose: () => void;
  initialRole?: "student" | "teacher";
  mode?: "student" | "teacher";
  groupId?: number | null;
  teacherId?: number | null;
  /** Назва обраної групи (з довідника) — лише для бейджа в шапці */
  groupName?: string | null;
  /** ПІБ обраного викладача (з довідника) — лише для бейджа в шапці */
  teacherName?: string | null;
  /** Реальні лічильники з useTaskGroups (null, якщо Classroom не прив'язано) */
  taskCounts?: { pending: number; overdue: number; done: number } | null;
}

interface GuideStepMeta {
  id: string;
  tabLabel: string;
  title: string;
  points: [string, string];
}

const FINAL_MS = 4800;
const TICK_MS = 80;

const STUDENT_STEPS: GuideStepMeta[] = [
  {
    id: "st-1-classroom",
    tabLabel: "Classroom",
    title: "1. Пошта @kre.dp.ua: відкриття Meet/Zoom та ДЗ",
    points: [
      "Натисніть на «🔒 Meet / Zoom» або кнопку Classroom у шапці й оберіть свій акаунт @kre.dp.ua.",
      "Замочки зникнуть, до карток пар підтягнуться актуальні домашні завдання, а дані синхронізуються між ПК і телефоном.",
    ],
  },
  {
    id: "st-2-subgroup",
    tabLabel: "Підгрупи",
    title: "2. Фільтр своєї підгрупи в 1 клік",
    points: [
      "Натисніть на бейдж «1 підгр.» або «2 підгр.» прямо на картці пари — другий викладач і чужий кабінет сховаються.",
      "Повторний клік по бейджу підгрупи миттєво повертає показ обох підгруп.",
    ],
  },
  {
    id: "st-3-zoom",
    tabLabel: "Код Zoom",
    title: "3. Автокопіювання пароля Zoom при кліку",
    points: [
      "Система сама знаходить ID та пароль у тексті викладача з Classroom і створює кнопку «Zoom ↗».",
      "При натисканні на «Zoom ↗» пароль конференції автоматично копіюється в буфер обміну.",
    ],
  },
  {
    id: "st-4-tasks",
    tabLabel: "Завдання",
    title: "4. Усі завдання в одному списку без гортання тижнів",
    points: [
      "У вкладці «Завдання» роботи поділені на «До здачі», «Борги» та «Здано», щоб старі борги не губилися.",
      "Фільтр «Усі предмети» дозволяє залишити завдання лише з потрібної дисципліни.",
    ],
  },
  {
    id: "st-5-grades",
    tabLabel: "Оцінки",
    title: "5. Середній бал та всі оцінки за семестр",
    points: [
      "Вкладка «Оцінки» автоматично рахує загальний середній бал (за 5-бальною та 12-бальною шкалами).",
      "Натисніть на предмет, щоб переглянути всі оцінені роботи з автоматичним перерахунком зі 100-бальної шкали.",
    ],
  },
  {
    id: "st-7-teacher-jump",
    tabLabel: "Викладач",
    title: "6. Швидкий перехід у розклад викладача",
    points: [
      "Натисніть на прізвище викладача на картці пари, щоб побачити його розклад та аудиторію на сьогодні.",
      "Кнопка «← До ...» у верхній плашці поверне вас назад до розкладу своєї групи.",
    ],
  },
];

const TEACHER_STEPS: GuideStepMeta[] = [
  {
    id: "tc-1-pin",
    tabLabel: "PIN-код",
    title: "1. PIN-код для відкриття посилань Meet та Zoom",
    points: [
      "Натисніть на «🔒 Zoom / Meet» або кнопку «Вхід викладача» у шапці та введіть PIN-код один раз.",
      "Усі посилання на онлайн-пари відкриються на цьому пристрої для всіх навчальних груп.",
    ],
  },
  {
    id: "tc-4-stats",
    tabLabel: "Статистика",
    title: "2. Статистика проведених пар та годин",
    points: [
      "Сторінка «Статистика» автоматично рахує вичитані академічні години та пари від початку семестру.",
      "Доступний розподіл навантаження за кожною дисципліною та кожною навчальною групою.",
    ],
  },
  {
    id: "tc-5-radar",
    tabLabel: "Заміни",
    title: "3. Позначки замін та перенесень у розкладі",
    points: [
      "Перенесені заняття підписуються новою датою й номером пари («↪ Перенесено → Четвер, 3 пара»).",
      "Призначені разові заміни виділяються жовтою рамкою та бейджем «⚡ Заміна».",
    ],
  },
];

function PlatformSvg({ platform }: { platform: "meet" | "zoom" }) {
  if (platform === "zoom") {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="shrink-0">
        <path d="M15 8c0-.55-.45-1-1-1H3c-.55 0-1 .45-1 1v8c0 .55.45 1 1 1h11c.55 0 1-.45 1-1v-3.24l4.39 3.59c.35.29.88 0 .88-.45V7.1c0-.45-.53-.74-.88-.45L15 10.24V8z" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="shrink-0">
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
      width="15"
      height="15"
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

function DemoCursor({
  x,
  y,
  clicking,
  hidden = false,
}: {
  x: string;
  y: string;
  clicking: boolean;
  hidden?: boolean;
}) {
  return (
    <motion.div
      aria-hidden="true"
      initial={false}
      animate={{
        left: x,
        top: y,
        scale: clicking ? 0.84 : 1,
        opacity: hidden ? 0 : 1,
      }}
      transition={{
        left: { type: "tween", duration: 0.36, ease: [0.22, 1, 0.36, 1] },
        top: { type: "tween", duration: 0.36, ease: [0.22, 1, 0.36, 1] },
        scale: { duration: 0.12, ease: "easeOut" },
        opacity: { duration: 0.25, ease: "easeOut" },
      }}
      className="pointer-events-none absolute z-30 -translate-x-1 -translate-y-1 will-change-[left,top,transform,opacity]"
    >
      <AnimatePresence>
        {clicking && !hidden && (
          <motion.span
            key="click-ripple"
            initial={{ scale: 0.35, opacity: 0.95 }}
            animate={{ scale: 2.25, opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.42, ease: "easeOut" }}
            className="absolute -left-2.5 -top-2.5 h-7 w-7 rounded-full border-2 border-sys-accent bg-sys-accent/35"
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
  groupName = null,
  teacherName = null,
  taskCounts = null,
}: GuideHubModalProps) {
  const router = useRouter();
  const { setHomeTab } = useMobileNav();
  const { isLinked, linkedEmail } = useClassroomSubmissions();
  const { isTeacherUnlocked } = useTeacherAccess();
  const { settings, updateSetting } = useUserSettings();

  const [role, setRole] = useState<"student" | "teacher">(initialRole ?? mode ?? "student");
  const [stepIdx, setStepIdx] = useState(0);
  const [slideDir, setSlideDir] = useState(1);
  const [elapsedMs, setElapsedMs] = useState(0);

  const steps = role === "student" ? STUDENT_STEPS : TEACHER_STEPS;
  const stepsCount = steps.length;

  useEffect(() => {
    if (!isOpen || typeof window === "undefined") return;
    setStepIdx(0);
    setElapsedMs(0);
    try {
      const storedMode = window.localStorage.getItem("schedule:mode");
      if (!initialRole && !mode && (storedMode === "student" || storedMode === "teacher")) {
        setRole(storedMode);
      } else if (mode || initialRole) {
        setRole(initialRole ?? mode ?? "student");
      }
    } catch {}
  }, [isOpen, initialRole, mode]);

  // Програє сцену один раз до фінального стану (FINAL_MS) і зупиняється без миготіння
  useEffect(() => {
    if (!isOpen || elapsedMs >= FINAL_MS) return;
    const timer = setInterval(() => {
      setElapsedMs((prev) => Math.min(FINAL_MS, prev + TICK_MS));
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [isOpen, elapsedMs, stepIdx, role]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") {
        setSlideDir(1);
        setStepIdx((c) => Math.min(stepsCount - 1, c + 1));
        setElapsedMs(0);
      }
      if (e.key === "ArrowLeft") {
        setSlideDir(-1);
        setStepIdx((c) => Math.max(0, c - 1));
        setElapsedMs(0);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose, stepsCount]);

  if (!isOpen) return null;

  const safeIdx = stepIdx < stepsCount ? stepIdx : 0;
  const activeStep = steps[safeIdx] ?? steps[0];

  /**
   * Простий і наочний таймлайн (0..4800 мс):
   * stage 0 (0..900 мс): Стан «До»
   * stage 1 (900..1750 мс): Курсор наводиться на реальну кнопку
   * stage 2 (1750..2350 мс): Клік по кнопці
   * stage 3 (2350..4800 мс): Чистий стан «Після» (на >= 3400 мс курсор плавно зникає)
   */
  const stage =
    elapsedMs < 900
      ? 0
      : elapsedMs < 1750
      ? 1
      : elapsedMs < 2350
      ? 2
      : 3;

  const isCursorHidden = elapsedMs >= 3400;

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
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 sm:bg-black/70 lg:backdrop-blur-xs p-0 sm:p-4 animate-in fade-in duration-150"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="guide-title"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-[500px] max-h-[92dvh] flex flex-col rounded-t-2xl sm:rounded-2xl border border-sys-border bg-sys-card text-sys-text-primary shadow-2xl overflow-hidden select-none"
      >
        {/* 1. ШАПКА + ПЕРЕМИКАЧ РОЛІ + ВКЛАДКИ */}
        <div className="px-4 pt-3.5 pb-2.5 bg-sys-surface border-b border-sys-border space-y-2.5 shrink-0">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h2 id="guide-title" className="text-sm sm:text-base font-bold text-sys-text-primary truncate">
                Як користуватися розкладом
              </h2>
              {(role === "student" ? groupName : teacherName) && (
                <p className="text-[11px] font-medium text-sys-text-secondary truncate">
                  {role === "student"
                    ? `Група ${groupName}${settings.defaultSubgroup !== "all" ? ` · ${settings.defaultSubgroup} підгр.` : ""}`
                    : `Викладач: ${teacherName}`}
                </p>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
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

          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar rounded-xl border border-sys-border bg-sys-bg p-1 text-[11px] font-semibold">
            {steps.map((s, idx) => {
              const isCurrent = idx === safeIdx;
              const isConfigured =
                role === "student"
                  ? (idx === 0 && isLinked) || (idx === 1 && settings.defaultSubgroup !== "all")
                  : idx === 0 && isTeacherUnlocked;
              return (
                <button
                  key={s.id}
                  type="button"
                  role="tab"
                  aria-selected={isCurrent}
                  onClick={() => goToStep(idx)}
                  className={`shrink-0 flex-1 py-1.5 px-2 rounded-lg transition-colors duration-150 cursor-pointer whitespace-nowrap ${
                    isCurrent
                      ? "bg-sys-card text-sys-accent font-bold border border-sys-border shadow-2xs"
                      : "text-sys-text-secondary hover:text-sys-text-primary"
                  }`}
                >
                  {s.tabLabel}
                  {isConfigured && <span className="ml-1 text-sys-status-okText">✓</span>}
                </button>
              );
            })}
          </div>
        </div>

        {/* 2. ЧИСТА СЦЕНА З РЕАЛЬНИМИ КОМПОНЕНТАМИ САЙТУ */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
          <AnimatePresence mode="wait" initial={false} custom={slideDir}>
            <motion.div
              key={`${role}-${activeStep.id}`}
              custom={slideDir}
              initial={{ opacity: 0, x: slideDir * 14 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: slideDir * -14 }}
              transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
              className="space-y-3.5"
            >
              {/* STAGE (h-[228px]) */}
              <div className="relative mx-auto w-full h-[228px] rounded-2xl border border-sys-border bg-sys-bg p-3.5 flex flex-col justify-center overflow-hidden shadow-inner">
                {elapsedMs >= FINAL_MS && (
                  <button
                    type="button"
                    onClick={() => setElapsedMs(0)}
                    title="Повторити анімацію"
                    className="absolute top-2.5 right-2.5 z-40 rounded-lg border border-sys-border bg-sys-card/90 px-2 py-0.5 text-[11px] font-semibold text-sys-text-secondary hover:text-sys-accent active:scale-95 transition-colors cursor-pointer shadow-2xs"
                  >
                    ↻ Повторити
                  </button>
                )}

                {/* =====================================================
                    СТУДЕНТ 0: ПОШТА @kre.dp.ua (Точна копія LessonCard)
                   ===================================================== */}
                {role === "student" && safeIdx === 0 && (
                  <div className="relative w-full max-w-[400px] mx-auto">
                    <DemoCursor
                      x={stage === 0 ? "45%" : stage <= 2 ? "84%" : "86%"}
                      y={stage === 0 ? "78%" : stage <= 2 ? "24%" : "72%"}
                      clicking={stage === 2}
                      hidden={isCursorHidden}
                    />

                    <div className="rounded-2xl border border-sys-border bg-sys-card p-4 shadow-sm space-y-2.5">
                      {/* Row 1: Number + Time on left, Locked/Unlocked Meet on right */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-base font-black text-sys-text-primary leading-none">1</span>
                          <span className="text-sys-text-muted font-bold text-xs">·</span>
                          <span className="text-xs font-semibold text-sys-text-secondary">09:00–10:20</span>
                        </div>

                        {stage < 3 ? (
                          <span
                            className={`inline-flex h-8 px-2.5 items-center gap-1.5 rounded-lg border border-sys-status-warnBg/40 bg-sys-status-warnBg/15 text-sys-status-warnText text-xs font-bold transition-transform ${
                              stage === 2 ? "scale-95" : ""
                            }`}
                          >
                            <span>🔒</span>
                            <span>Meet</span>
                          </span>
                        ) : (
                          <span className="inline-flex h-8 px-2.5 items-center gap-1.5 rounded-lg border border-sys-status-okBg/50 bg-sys-status-okBg/15 text-sys-status-okText text-xs font-bold shadow-xs animate-in fade-in duration-150">
                            <PlatformSvg platform="meet" />
                            <span>Meet</span>
                            <span className="opacity-75">↗</span>
                          </span>
                        )}
                      </div>

                      {/* Row 2 & 3: Subject + Teacher */}
                      <div>
                        <div className="text-base font-semibold text-sys-text-subject leading-snug">
                          Вища математика
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-sys-text-secondary mt-1">
                          <UserSvg />
                          <span>Іваненко О.М.</span>
                        </div>
                      </div>

                      {/* Row 4: Exact Homework Strip from LessonCard.tsx */}
                      {stage >= 3 && (
                        <div
                          className="flex items-center justify-between rounded-xl bg-sys-bg/60 border border-sys-border px-3.5 py-2.5 text-xs animate-in fade-in duration-150"
                          style={{ boxShadow: "inset 3px 0 0 #8b5cf6" }}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <ClipboardSvg />
                            <span className="font-semibold text-sys-text-primary truncate">
                              Практична робота №5
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0 ml-2">
                            <span className="h-1.5 w-1.5 rounded-full bg-sys-status-denomBg" />
                            <span className="text-sys-status-denomText font-medium">до 15 лист.</span>
                            <span className="text-sys-text-muted ml-0.5">↗</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* =====================================================
                    СТУДЕНТ 1: ПІДГРУПИ (Точна копія двовикладацької LessonCard)
                   ===================================================== */}
                {role === "student" && safeIdx === 1 && (
                  <div className="relative w-full max-w-[400px] mx-auto">
                    <DemoCursor
                      x={stage === 0 ? "62%" : stage <= 2 ? "18%" : "78%"}
                      y={stage === 0 ? "82%" : stage <= 2 ? "56%" : "24%"}
                      clicking={stage === 2}
                      hidden={isCursorHidden}
                    />

                    <div className="rounded-2xl border border-sys-border bg-sys-card p-4 shadow-sm space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-base font-black text-sys-text-primary leading-none">2</span>
                          <span className="text-sys-text-muted font-bold text-xs">·</span>
                          <span className="text-xs font-semibold text-sys-text-secondary">10:40–12:00</span>
                        </div>
                        {stage >= 3 && (
                          <span className="inline-flex h-8 px-2.5 items-center gap-1.5 rounded-lg border border-sys-status-okBg/50 bg-sys-status-okBg/15 text-sys-status-okText text-xs font-bold animate-in fade-in duration-150">
                            <PlatformSvg platform="meet" />
                            <span>Meet</span>
                            <span className="opacity-75">↗</span>
                          </span>
                        )}
                      </div>

                      <div className="text-base font-semibold text-sys-text-subject leading-snug">
                        Іноземна мова (за проф. спрямуванням)
                      </div>

                      {/* Subgroup 1 Row */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className={`inline-flex shrink-0 items-center gap-1.5 h-6 px-2 rounded-md border text-xs font-semibold transition-colors ${
                              stage >= 3
                                ? "border-sys-accent/35 bg-sys-accent/15 text-sys-accent"
                                : stage >= 1
                                ? "border-sys-accent/50 bg-sys-accent/10 text-sys-text-primary"
                                : "bg-sys-bg/80 border-sys-border text-sys-text-secondary"
                            }`}
                          >
                            <span className={`h-1.5 w-1.5 rounded-full ${stage >= 3 ? "bg-sys-accent" : "bg-sys-text-muted/60"}`} />
                            <span>1 підгр.</span>
                          </span>
                          <UserSvg />
                          <span className="text-xs font-medium text-sys-text-secondary truncate">
                            Петренко І.В.
                          </span>
                        </div>

                        {stage < 3 && (
                          <span className="inline-flex h-7 px-2.5 items-center gap-1.5 rounded-lg border border-sys-status-okBg/50 bg-sys-status-okBg/15 text-sys-status-okText text-xs font-semibold">
                            <PlatformSvg platform="meet" />
                            <span>Meet ↗</span>
                          </span>
                        )}
                      </div>

                      {/* Subgroup 2 Row (зникає після кліку по «1 підгр.») */}
                      {stage < 3 && (
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="inline-flex shrink-0 items-center gap-1.5 h-6 px-2 rounded-md border border-sys-border bg-sys-bg/80 text-xs font-semibold text-sys-text-secondary">
                              <span className="h-1.5 w-1.5 rounded-full bg-sys-text-muted/60" />
                              <span>2 підгр.</span>
                            </span>
                            <UserSvg />
                            <span className="text-xs font-medium text-sys-text-secondary truncate">
                              Коваленко Н.С.
                            </span>
                          </div>
                          <span className="shrink-0 rounded-md border border-sys-border bg-sys-bg px-2 py-1 text-xs font-semibold leading-none text-sys-text-secondary">
                            ауд. 204
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* =====================================================
                    СТУДЕНТ 2: ZOOM ТА АВТОКОПІЮВАННЯ ПАРОЛЯ (Точна копія LessonCard + ToastProvider)
                   ===================================================== */}
                {role === "student" && safeIdx === 2 && (
                  <div className="relative w-full max-w-[400px] mx-auto space-y-2.5">
                    <DemoCursor
                      x={stage === 0 ? "35%" : stage <= 2 ? "84%" : "86%"}
                      y={stage === 0 ? "76%" : stage <= 2 ? "26%" : "72%"}
                      clicking={stage === 2}
                      hidden={isCursorHidden}
                    />

                    <div className="rounded-2xl border border-sys-border bg-sys-card p-4 shadow-sm space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-base font-black text-sys-text-primary leading-none">3</span>
                          <span className="text-sys-text-muted font-bold text-xs">·</span>
                          <span className="text-xs font-semibold text-sys-text-secondary">12:30–13:50</span>
                        </div>

                        {/* Точна кнопка Zoom із LessonCard.tsx */}
                        <span
                          className={`inline-flex h-8 px-2.5 items-center gap-1.5 rounded-lg border border-sys-status-infoBg/50 bg-sys-status-infoBg/15 text-sys-status-infoText text-xs font-bold shadow-xs transition-transform ${
                            stage === 2 ? "scale-95" : ""
                          }`}
                        >
                          <PlatformSvg platform="zoom" />
                          <span>Zoom</span>
                          <span className="opacity-75">↗</span>
                        </span>
                      </div>

                      <div>
                        <div className="text-base font-semibold text-sys-text-subject leading-snug">
                          Електроніка та мікросхемотехніка
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-sys-text-secondary mt-1">
                          <UserSvg />
                          <span>Мельник В.П.</span>
                        </div>
                      </div>
                    </div>

                    {/* Точна копія спливаючого повідомлення з ToastProvider.tsx */}
                    {stage >= 3 && (
                      <div className="flex items-center gap-2 rounded-[8px] border border-sys-status-okBg/40 bg-sys-card px-3.5 py-2.5 text-xs font-semibold text-sys-status-okText shadow-lg animate-in fade-in duration-150">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                          <path d="M5 12l5 5l10 -10" />
                        </svg>
                        <span>Код доступу Zoom (dfkr) скопійовано!</span>
                      </div>
                    )}
                  </div>
                )}

                {/* =====================================================
                    СТУДЕНТ 3: ЗАВДАННЯ (Точна копія TasksTodoBoard + TaskCardItem)
                   ===================================================== */}
                {role === "student" && safeIdx === 3 && (
                  <div className="relative w-full max-w-[400px] mx-auto space-y-2">
                    <DemoCursor
                      x={stage === 0 ? "18%" : stage <= 2 ? "50%" : "82%"}
                      y={stage === 0 ? "16%" : stage <= 2 ? "16%" : "68%"}
                      clicking={stage === 2}
                      hidden={isCursorHidden}
                    />

                    {/* Точні 3 вкладки з MobileTasksView.tsx */}
                    <div className="relative grid grid-cols-3 rounded-xl border border-sys-border bg-sys-card p-1 text-xs font-semibold isolate">
                      <div
                        className="absolute top-1 bottom-1 transition-transform duration-150 ease-out transform-gpu z-0"
                        style={{
                          left: "4px",
                          width: "calc((100% - 8px) / 3)",
                          transform: `translate3d(${stage >= 3 ? "100%" : "0%"}, 0, 0)`,
                        }}
                      >
                        <div className={`h-full w-full rounded-lg shadow-xs ${stage >= 3 ? "bg-sys-destructive" : "bg-sys-accentSolid"}`} />
                      </div>

                      <div className={`relative z-10 flex items-center justify-center gap-1 py-1.5 ${stage < 3 ? "text-white font-bold" : "text-sys-text-secondary"}`}>
                        <span>До здачі</span>
                        <span className={`inline-flex h-4 min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold ${stage < 3 ? "bg-white/20 text-white" : "bg-sys-bg text-sys-text-secondary"}`}>
                          3
                        </span>
                      </div>

                      <div className={`relative z-10 flex items-center justify-center gap-1 py-1.5 ${stage >= 3 ? "text-white font-bold" : "text-sys-status-dangerText"}`}>
                        <span>Борги</span>
                        <span className={`inline-flex h-4 min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold ${stage >= 3 ? "bg-white/20 text-white" : "bg-sys-status-dangerBg/20 text-sys-status-dangerText"}`}>
                          1
                        </span>
                      </div>

                      <div className="relative z-10 flex items-center justify-center gap-1 py-1.5 text-sys-text-secondary">
                        <span>Здано</span>
                        <span className="inline-flex h-4 min-w-[18px] items-center justify-center rounded-full bg-sys-bg px-1 text-[10px] font-bold text-sys-text-secondary">
                          14
                        </span>
                      </div>
                    </div>

                    {/* Точний селектор предметів із MobileTasksView.tsx */}
                    <div className="flex items-center justify-between rounded-xl border border-sys-border bg-sys-card px-3 py-1.5 text-xs font-semibold text-sys-text-secondary">
                      <div className="flex items-center gap-2">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-80">
                          <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                        </svg>
                        <span>Усі предмети (6)</span>
                      </div>
                      <span>▾</span>
                    </div>

                    {/* Точна картка TaskCardItem.tsx */}
                    {stage < 3 ? (
                      <div
                        className="rounded-xl bg-sys-card border border-sys-border p-3 shadow-xs space-y-1"
                        style={{ boxShadow: "inset 3px 0 0 #f59e0b" }}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-xs font-semibold text-sys-text-primary">Лабораторна робота №4</span>
                          <span className="text-xs text-sys-text-muted">↗</span>
                        </div>
                        <p className="text-[11px] text-sys-text-muted">Комп&apos;ютерна схемотехніка · Іваненко О.М.</p>
                        <div className="flex items-center gap-1.5 text-xs font-medium text-sys-status-warnText pt-0.5">
                          <span className="h-1.5 w-1.5 rounded-full bg-sys-status-warnBg" />
                          <span>Завтра</span>
                        </div>
                      </div>
                    ) : (
                      <div
                        className="rounded-xl bg-sys-card border border-sys-border p-3 shadow-xs space-y-1 animate-in fade-in duration-150"
                        style={{ boxShadow: "inset 3px 0 0 #ef4444" }}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-xs font-semibold text-sys-text-primary">Практична робота №2</span>
                          <span className="text-xs text-sys-text-muted">↗</span>
                        </div>
                        <p className="text-[11px] text-sys-text-muted">Вища математика · Петренко І.В.</p>
                        <div className="flex items-center gap-1.5 text-xs font-medium text-sys-status-dangerText pt-0.5">
                          <span className="h-1.5 w-1.5 rounded-full bg-sys-status-dangerBg" />
                          <span>10 лист. · прострочено 2 дні</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* =====================================================
                    СТУДЕНТ 4: ОЦІНКИ (Точна копія GradesView.tsx)
                   ===================================================== */}
                {role === "student" && safeIdx === 4 && (
                  <div className="relative w-full max-w-[400px] mx-auto space-y-2">
                    <DemoCursor
                      x={stage === 0 ? "30%" : stage <= 2 ? "88%" : "88%"}
                      y={stage === 0 ? "24%" : stage <= 2 ? "62%" : "78%"}
                      clicking={stage === 2}
                      hidden={isCursorHidden}
                    />

                    {/* Точна GPA Overview Card із GradesView.tsx */}
                    <div className="rounded-2xl border border-sys-border bg-sys-card px-3.5 py-2.5 shadow-xs flex items-center justify-between">
                      <div>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-sys-text-muted block">
                          Середній бал
                        </span>
                        <div className="flex items-baseline gap-2.5 mt-0.5">
                          <div className="flex items-baseline gap-1">
                            <span className="text-xl font-black text-sys-text-primary">4.75</span>
                            <span className="text-xs font-semibold text-sys-text-secondary">/ 5.00</span>
                          </div>
                          <div className="flex items-baseline gap-1 pl-2.5 border-l border-sys-border/80">
                            <span className="text-base font-bold text-sys-accent">11.0</span>
                            <span className="text-xs font-semibold text-sys-text-secondary">/ 12 б.</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1">
                        <div className="rounded-lg border border-sys-status-okBg/30 bg-sys-status-okBg/10 px-2 py-1 text-center">
                          <span className="text-[10px] font-bold text-sys-status-okText block">«5»</span>
                          <span className="text-xs font-black text-sys-text-primary">8</span>
                        </div>
                        <div className="rounded-lg border border-sys-status-infoBg/30 bg-sys-status-infoBg/10 px-2 py-1 text-center">
                          <span className="text-[10px] font-bold text-sys-status-infoText block">«4»</span>
                          <span className="text-xs font-black text-sys-text-primary">3</span>
                        </div>
                      </div>
                    </div>

                    {/* Точна картка предмета з GradesView.tsx */}
                    <div className="rounded-2xl border border-sys-border bg-sys-card p-3 shadow-xs space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-sys-text-primary truncate">Вища математика</div>
                          <div className="text-[11px] text-sys-text-muted">3 оцінки • 👨🏫 Іваненко О.М.</div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <div className="text-right">
                            <div className="text-xs font-black text-sys-text-primary leading-none">
                              4.83 <span className="text-[10px] font-semibold text-sys-text-secondary">/ 5</span>
                            </div>
                            <div className="text-[10px] font-bold text-sys-accent mt-0.5">11.0 / 12 б.</div>
                          </div>
                          <span className="text-xs text-sys-text-muted">{stage >= 3 ? "▴" : "▾"}</span>
                        </div>
                      </div>

                      {stage < 3 ? (
                        <div className="flex items-center gap-1 pt-1.5 border-t border-sys-border/40">
                          {["11 б.", "12 б.", "10 б."].map((mark) => (
                            <span
                              key={mark}
                              className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] font-bold border border-sys-status-okBg/30 bg-sys-status-okBg/15 text-sys-status-okText"
                            >
                              {mark}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <div className="flex items-center justify-between rounded-xl border border-sys-border/60 bg-sys-bg/60 px-2.5 py-1.5 text-xs animate-in fade-in duration-150">
                          <span className="font-semibold text-sys-text-primary">Контрольна робота №1</span>
                          <span className="font-bold text-sys-text-primary">
                            95<span className="text-[10px] text-sys-text-secondary">/100 б.</span>{" "}
                            <span className="text-sys-status-okText">(5 за 5-б.)</span>
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* =====================================================
                    СТУДЕНТ 5 (#7): ПЕРЕХІД ДО ВИКЛАДАЧА (Точна копія SchedulePageClient)
                   ===================================================== */}
                {role === "student" && safeIdx === 5 && (
                  <div className="relative w-full max-w-[400px] mx-auto">
                    <DemoCursor
                      x={stage === 0 ? "70%" : stage <= 2 ? "26%" : "82%"}
                      y={stage === 0 ? "28%" : stage <= 2 ? "74%" : "22%"}
                      clicking={stage === 2}
                      hidden={isCursorHidden}
                    />

                    {stage < 3 ? (
                      <div className="rounded-2xl border border-sys-border bg-sys-card p-4 shadow-sm space-y-2.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-base font-black text-sys-text-primary leading-none">2</span>
                            <span className="text-sys-text-muted font-bold text-xs">·</span>
                            <span className="text-xs font-semibold text-sys-text-secondary">10:40–12:00</span>
                          </div>
                          <span className="inline-flex h-8 px-2.5 items-center rounded-lg border border-sys-border bg-sys-bg text-xs font-medium text-sys-text-secondary">
                            ауд. 305
                          </span>
                        </div>

                        <div className="text-base font-semibold text-sys-text-subject">
                          Комп&apos;ютерна схемотехніка
                        </div>

                        <div className="flex items-center gap-1.5 text-xs">
                          <UserSvg />
                          <span
                            className={`font-medium transition-colors ${
                              stage >= 1 ? "text-sys-accent underline underline-offset-2" : "text-sys-text-secondary"
                            }`}
                          >
                            Іваненко О.М.
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2.5 animate-in fade-in duration-150">
                        {/* Точний банер повернення з SchedulePageClient.tsx (рядок 2175) */}
                        <div className="flex items-center justify-between rounded-xl border border-sys-accent/30 bg-sys-accent/10 px-3 py-2 text-xs">
                          <span className="text-sys-text-secondary truncate mr-2">
                            Розклад: <strong className="text-sys-text-primary">Іваненко О.М.</strong>
                          </span>
                          <span className="shrink-0 rounded-lg bg-sys-accent px-2.5 py-1 text-xs font-semibold text-white">
                            ← До групи
                          </span>
                        </div>

                        <div className="rounded-2xl border border-sys-border bg-sys-card p-3.5 shadow-sm space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-sys-text-secondary">2 · 10:40–12:00</span>
                            <span className="rounded-lg border border-sys-border bg-sys-bg px-2.5 py-1 text-xs font-medium text-sys-text-secondary">
                              ауд. 305
                            </span>
                          </div>
                          <div className="text-sm font-semibold text-sys-text-subject">Комп&apos;ютерна схемотехніка</div>
                          <div className="flex items-center gap-1.5 text-xs text-sys-text-secondary">
                            <UserSvg />
                            <span className="text-sys-text-muted">Група:</span>
                            <span className="font-medium text-sys-text-secondary">85</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* =====================================================
                    ВИКЛАДАЧ 0 (#1): PIN-ДОСТУП (Точна копія TeacherPinModal.tsx)
                   ===================================================== */}
                {role === "teacher" && safeIdx === 0 && (
                  <div className="relative w-full max-w-[400px] mx-auto">
                    <DemoCursor
                      x={stage === 0 ? "35%" : stage <= 2 ? "74%" : "84%"}
                      y={stage === 0 ? "25%" : stage <= 2 ? "80%" : "26%"}
                      clicking={stage === 2}
                      hidden={isCursorHidden}
                    />

                    {stage < 3 ? (
                      /* Точний макет TeacherPinModal.tsx */
                      <div className="rounded-2xl border border-sys-border bg-sys-card p-4 shadow-lg space-y-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-xl flex items-center justify-center border border-sys-status-infoBg/30 bg-sys-status-infoBg/15 text-sys-status-infoText shrink-0">
                            🔒
                          </div>
                          <div>
                            <div className="text-xs font-bold text-sys-text-primary">Вхід для викладача</div>
                            <div className="text-[11px] text-sys-text-secondary">PIN-код для доступу до посилань</div>
                          </div>
                        </div>

                        <div className="h-9 px-3 rounded-xl border border-sys-accent bg-sys-bg flex items-center text-xs font-mono tracking-widest text-sys-text-primary">
                          {stage >= 1 ? "••••••" : "•••"}
                        </div>

                        <div className="flex gap-2">
                          <span className="flex-1 h-8 rounded-xl border border-sys-border bg-sys-bg text-xs font-semibold text-sys-text-secondary flex items-center justify-center">
                            Скасувати
                          </span>
                          <span
                            className={`flex-1 h-8 rounded-xl bg-sys-accent text-white text-xs font-bold flex items-center justify-center transition-transform ${
                              stage === 2 ? "scale-95" : ""
                            }`}
                          >
                            Розблокувати
                          </span>
                        </div>
                      </div>
                    ) : (
                      /* Розблокована картка пари викладача */
                      <div className="rounded-2xl border border-sys-border bg-sys-card p-4 shadow-sm space-y-2.5 animate-in fade-in duration-150">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-base font-black text-sys-text-primary leading-none">1</span>
                            <span className="text-sys-text-muted font-bold text-xs">·</span>
                            <span className="text-xs font-semibold text-sys-text-secondary">09:00–10:20</span>
                          </div>
                          <span className="inline-flex h-8 px-2.5 items-center gap-1.5 rounded-lg border border-sys-status-infoBg/50 bg-sys-status-infoBg/15 text-sys-status-infoText text-xs font-bold shadow-xs">
                            <PlatformSvg platform="zoom" />
                            <span>Zoom</span>
                            <span className="opacity-75">↗</span>
                          </span>
                        </div>
                        <div className="text-base font-semibold text-sys-text-subject">
                          Комп&apos;ютерна схемотехніка
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-sys-text-secondary">
                          <UserSvg />
                          <span className="text-sys-text-muted">Група:</span>
                          <span className="font-medium text-sys-text-secondary">85</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* =====================================================
                    ВИКЛАДАЧ 1 (#4): СТАТИСТИКА (Точна копія app/statistics/page.tsx)
                   ===================================================== */}
                {role === "teacher" && safeIdx === 1 && (
                  <div className="relative w-full max-w-[400px] mx-auto space-y-2.5">
                    <DemoCursor
                      x={stage === 0 ? "30%" : stage <= 2 ? "65%" : "82%"}
                      y={stage === 0 ? "25%" : stage <= 2 ? "72%" : "72%"}
                      clicking={stage === 2}
                      hidden={isCursorHidden}
                    />

                    {/* Точні 2 картки зверху зі сторінки /statistics */}
                    <div className="grid grid-cols-2 gap-2.5">
                      <div className="rounded-2xl border border-sys-border bg-sys-card p-2.5 text-center">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-sys-text-secondary">
                          Проведено
                        </p>
                        <p className="text-xl font-black text-sys-accent leading-tight mt-0.5">96</p>
                        <p className="text-[10px] text-sys-text-muted">акад. год · 48 пар</p>
                      </div>
                      <div className="rounded-2xl border border-sys-border bg-sys-card p-2.5 text-center">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-sys-text-secondary">
                          Навантаження
                        </p>
                        <p className="text-xl font-black text-sys-text-primary leading-tight mt-0.5">16</p>
                        <p className="text-[10px] text-sys-text-muted">акад. год/тиждень · 8 пар</p>
                      </div>
                    </div>

                    {/* Точна картка дисципліни з круговим SVG-кільцем зі сторінки /statistics */}
                    <div className="rounded-2xl border border-sys-border bg-sys-card p-3 flex items-center gap-3.5">
                      <div className="relative w-12 h-12 shrink-0 flex items-center justify-center">
                        <svg className="w-full h-full -rotate-90" viewBox="0 0 48 48">
                          <circle cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="4" fill="none" className="text-sys-border" />
                          <circle
                            cx="24"
                            cy="24"
                            r="20"
                            stroke="currentColor"
                            strokeWidth="4"
                            fill="none"
                            strokeDasharray={125.6}
                            strokeDashoffset={32}
                            className="text-sys-accent"
                            strokeLinecap="round"
                          />
                        </svg>
                        <span className="absolute text-[11px] font-bold text-sys-text-primary">68г</span>
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-sys-text-primary truncate">
                          Комп&apos;ютерна схемотехніка
                        </div>
                        <div className="text-[11px] text-sys-text-secondary mt-0.5">
                          68 акад. год · 34 пар
                        </div>
                        <div className="flex items-center gap-1 mt-1">
                          <span className="text-[10px] text-sys-text-muted">Групи:</span>
                          <span className="rounded bg-sys-elevated border border-sys-border px-1.5 py-0.5 text-[10px] font-medium text-sys-text-secondary">
                            85
                          </span>
                          <span className="rounded bg-sys-elevated border border-sys-border px-1.5 py-0.5 text-[10px] font-medium text-sys-text-secondary">
                            86
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* =====================================================
                    ВИКЛАДАЧ 2 (#5): ЗАМІНИ ТА ПЕРЕНЕСЕННЯ (Точна копія MobileWeekDaysStrip + LessonCard)
                   ===================================================== */}
                {role === "teacher" && safeIdx === 2 && (
                  <div className="relative w-full max-w-[400px] mx-auto space-y-2.5">
                    <DemoCursor
                      x={stage === 0 ? "50%" : stage <= 2 ? "70%" : "82%"}
                      y={stage === 0 ? "18%" : stage <= 2 ? "18%" : "68%"}
                      clicking={stage === 2}
                      hidden={isCursorHidden}
                    />

                    {/* Точна копія MobileWeekDaysStrip.tsx */}
                    <div className="relative flex h-10 w-full rounded-xl border border-sys-border bg-sys-card overflow-hidden text-xs">
                      <div
                        className="absolute bottom-0 left-0 h-[3px] bg-sys-accent transition-transform duration-200 ease-out"
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
                              active ? "text-sys-text-primary font-bold" : "text-sys-text-secondary"
                            }`}
                          >
                            {d}
                          </div>
                        );
                      })}
                    </div>

                    {stage < 3 ? (
                      /* Точний макет перенесеної пари з LessonCard.tsx (рядки 1261, 1282) */
                      <div className="rounded-2xl border border-sys-status-dangerBg/40 border-dashed bg-sys-card p-3.5 space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-sys-text-secondary">3 · 12:30–13:50</span>
                          <span className="rounded px-1.5 py-0.5 text-xs font-bold border border-sys-status-warnBg/40 bg-sys-status-warnBg/15 text-sys-status-warnText">
                            ↪ Перенесено → Четвер, 3 пара
                          </span>
                        </div>
                        <div className="text-base font-semibold line-through text-sys-text-muted">
                          Мікропроцесорні системи
                        </div>
                        <div className="text-xs text-sys-text-secondary">Група: 85</div>
                      </div>
                    ) : (
                      /* Точний макет заміни з LessonCard.tsx (рядки 1268, 1306) */
                      <div className="rounded-2xl border border-sys-warning/40 ring-1 ring-sys-warning/60 bg-sys-card p-3.5 space-y-1.5 animate-in fade-in duration-150">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-sys-text-secondary">3 · 12:30–13:50</span>
                          <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-bold bg-sys-warning uppercase tracking-wider text-sys-warningText">
                            ⚡ Заміна
                          </span>
                        </div>
                        <div className="text-base font-semibold text-sys-text-subject">
                          Мікропроцесорні системи
                        </div>
                        <div className="text-xs text-sys-text-secondary">Група: 85 • ауд. 305</div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* 3. ЛАКОНІЧНИЙ ОПИС (2 короткі пункти) + ШВИДКА ДІЯ */}
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

                {role === "student" && safeIdx === 0 && (
                  <div className="flex items-center justify-between rounded-xl border border-sys-border bg-sys-bg px-3 py-2 text-xs">
                    <span className="font-semibold text-sys-text-secondary truncate mr-2">
                      {isLinked ? `✓ Підключено: ${linkedEmail}` : "Пошту @kre.dp.ua ще не прив'язано"}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        setTimeout(() => window.dispatchEvent(new CustomEvent("trigger-classroom-sync")), 120);
                      }}
                      className="shrink-0 rounded-lg bg-sys-accent px-3 py-1.5 text-[11px] font-bold text-white hover:opacity-95 active:scale-95 transition-opacity cursor-pointer"
                    >
                      {isLinked ? "Оновити" : "Прив'язати →"}
                    </button>
                  </div>
                )}

                {role === "student" && safeIdx === 1 && (
                  <div className="flex items-center justify-between rounded-xl border border-sys-border bg-sys-bg px-3 py-2 text-xs">
                    <span className="font-semibold text-sys-text-secondary">Ваша підгрупа:</span>
                    <div className="inline-flex gap-1">
                      {(["all", 1, 2] as const).map((sub) => (
                        <button
                          key={String(sub)}
                          type="button"
                          onClick={() => updateSetting("defaultSubgroup", sub)}
                          className={`rounded-lg px-2.5 py-1 text-[11px] font-bold transition-colors cursor-pointer ${
                            settings.defaultSubgroup === sub
                              ? "bg-sys-accent text-white"
                              : "bg-sys-card text-sys-text-secondary border border-sys-border hover:text-sys-text-primary"
                          }`}
                        >
                          {sub === "all" ? "Обидві" : `${sub} підгр.`}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {role === "student" && (safeIdx === 3 || safeIdx === 4) && (
                  <div className="flex items-center justify-between gap-2 rounded-xl border border-sys-border bg-sys-bg px-3 py-2 text-xs">
                    <span className="font-semibold text-sys-text-secondary truncate">
                      {taskCounts ? (
                        <>
                          У вас зараз: <span className="text-sys-text-primary">{taskCounts.pending} до здачі</span>
                          {" · "}
                          <span className={taskCounts.overdue > 0 ? "text-sys-status-dangerText" : ""}>
                            {taskCounts.overdue} борг.
                          </span>
                          {" · "}
                          <span className="text-sys-status-okText">{taskCounts.done} здано</span>
                        </>
                      ) : (
                        "Прив'яжіть @kre.dp.ua, щоб бачити свої завдання"
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        setHomeTab("tasks");
                      }}
                      className="shrink-0 rounded-lg bg-sys-accent px-3 py-1.5 text-[11px] font-bold text-white hover:opacity-95 active:scale-95 transition-opacity cursor-pointer"
                    >
                      Відкрити →
                    </button>
                  </div>
                )}

                {role === "teacher" && safeIdx === 0 && isTeacherUnlocked && (
                  <div className="rounded-xl border border-sys-border bg-sys-bg px-3 py-2 text-xs font-semibold text-sys-status-okText">
                    ✓ Доступ до посилань на цьому пристрої відкрито
                  </div>
                )}

                {role === "teacher" && safeIdx === 0 && !isTeacherUnlocked && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      router.push("/settings?mode=teacher");
                    }}
                    className="w-full rounded-xl bg-sys-accent py-2 text-xs font-bold text-white hover:opacity-95 active:scale-[0.99] transition-opacity cursor-pointer"
                  >
                    Ввести PIN-код викладача →
                  </button>
                )}

                {role === "teacher" && safeIdx === 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      router.push("/statistics");
                    }}
                    className="w-full rounded-xl bg-sys-accent/15 border border-sys-accent/35 py-2 text-xs font-bold text-sys-accent hover:bg-sys-accent/25 active:scale-[0.99] transition-colors cursor-pointer"
                  >
                    Відкрити сторінку Статистики →
                  </button>
                )}
              </div>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* 4. НИЖНЯ НАВІГАЦІЯ */}
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-sys-border bg-sys-surface shrink-0">
          <button
            type="button"
            disabled={safeIdx === 0}
            onClick={() => goToStep(Math.max(0, safeIdx - 1))}
            className="rounded-xl border border-sys-border bg-sys-card px-3.5 py-2 text-xs font-semibold text-sys-text-secondary hover:text-sys-text-primary disabled:opacity-40 disabled:pointer-events-none active:scale-95 transition-colors cursor-pointer"
          >
            ← Назад
          </button>

          <span className="text-xs font-semibold text-sys-text-muted">
            {safeIdx + 1} / {stepsCount}
          </span>

          <button
            type="button"
            onClick={() => {
              if (safeIdx === stepsCount - 1) {
                onClose();
              } else {
                goToStep(safeIdx + 1);
              }
            }}
            className="rounded-xl bg-sys-accent px-4 py-2 text-xs font-bold text-white hover:opacity-95 active:scale-95 transition-opacity cursor-pointer"
          >
            {safeIdx === stepsCount - 1 ? "Зрозуміло ✓" : "Далі →"}
          </button>
        </div>
      </div>
    </div>
  );
}
