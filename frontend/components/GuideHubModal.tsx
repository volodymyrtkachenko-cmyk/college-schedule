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
  phaseLabels: [string, string, string];
  points: [string, string, string];
}

// Сценарій триває 6.4 с і зупиняється на чистому фінальному стані (stage 5) без різкого скидання
const FINAL_MS = 6400;
const TICK_MS = 80;

const STUDENT_STEPS: GuideStepMeta[] = [
  {
    id: "st-1-classroom",
    tabLabel: "Пошта @kre",
    title: "1. Прив'язка @kre.dp.ua: посилання на пари, ДЗ та синхронізація",
    phaseLabels: ["1. Захищена пара", "2. Вхід @kre.dp.ua", "3. Все відкрито ✓"],
    points: [
      "Відкриває посилання на пари: сервер знаходить ваші курси в Google Classroom і автоматично дістає посилання на Meet та Zoom із оголошень викладачів, прибираючи замочки «🔒».",
      "Прикріплює ДЗ прямо до пар: нездані роботи відображаються внизу картки відповідної пари (щойно ви здаєте роботу в Classroom — плашка зникає, і картка пари стає чистою).",
      "Синхронізація ПК ↔ Телефон та авто-профіль: система сама визначає вашу групу й підгрупу за курсами Classroom і оновлює дані у фоні кожні 10 хвилин без повторного входу.",
    ],
  },
  {
    id: "st-2-subgroup",
    tabLabel: "Підгрупи",
    title: "2. Індивідуальний фільтр підгрупи (1 / 2 / Обидві)",
    phaseLabels: ["1. Обидві підгрупи", "2. Клік по «1 підгр.»", "3. Чистий розклад ✓"],
    points: [
      "Роздільні кабінети та посилання: на парах із поділом навпроти кожного викладача показується саме його аудиторія або його власне посилання на Meet чи Zoom.",
      "Фільтрація в 1 клік прямо з картки: натисніть на бейдж «1 підгр.» або «2 підгр.» на парі — чужий викладач, його кабінет та чужі ДЗ сховаються з усього розкладу.",
      "Миттєве повернення: повторний клік по активному бейджу підгрупи (або клавіші «1», «2», «0» на ПК) миттєво повертає паралельний показ обох підгруп.",
    ],
  },
  {
    id: "st-3-zoom",
    tabLabel: "Код Zoom",
    title: "3. Розумна кнопка Zoom та автокопіювання пароля",
    phaseLabels: ["1. Текст викладача", "2. Клік по кнопці", "3. Пароль у буфері ✓"],
    points: [
      "Авто-розпізнавання з тексту: якщо викладач опублікував у Classroom лише текстовий Ідентифікатор конференції (ID) та Код доступу без посилання — система сама створить кнопку «Zoom · код: ...».",
      "Автокопіювання пароля в буфер: у момент натискання на кнопку пароль конференції автоматично копіюється в буфер обміну — у Zoom достатньо натиснути «Вставити».",
      "Підсвічування живої пари: за 15 хвилин до початку заняття та під час пари кнопка відеозв'язку автоматично виділяється активним індикатором.",
    ],
  },
  {
    id: "st-4-tasks",
    tabLabel: "Завдання",
    title: "4. Єдиний список завдань за семестр (До здачі / Борги / Здано)",
    phaseLabels: ["1. До здачі", "2. Контроль боргів", "3. Фільтр предмета ✓"],
    points: [
      "Без гортання тижнів: усі завдання з Classroom зібрані в єдиний список і поділені на «До здачі», «Борги» та «Здано» — старі нездані роботи ніколи не загубляться на минулих тижнях.",
      "Кольоровий радар дедлайнів: система автоматично виділяє термінові роботи (Сьогодні / Завтра), прострочені борги з підрахунком днів та вже оцінені здачі.",
      "Фільтр за дисципліною та прямий перехід: оберіть потрібний предмет у випадаючому списку й натисніть на картку завдання, щоб одразу відкрити його в Google Classroom.",
    ],
  },
  {
    id: "st-5-grades",
    tabLabel: "Оцінки",
    title: "5. Авто-підрахунок середнього бала (GPA) та конвертація шкал",
    phaseLabels: ["1. Вкладка Оцінки", "2. Перерахунок шкали", "3. Деталізація робіт ✓"],
    points: [
      "Середній бал у реальному часі: вкладка «Оцінки» автоматично рахує ваш поточний середній бал з кожного предмета та загальну статистику перевірених робіт.",
      "Авто-конвертація 100 → 12 / 5 балів: якщо викладач виставляє оцінки у 100-бальній шкалі Classroom, алгоритм автоматично переводить їх у стандартну 12-бальну або 5-бальну систему.",
      "Повна відомість за семестр: натисніть на картку будь-якої дисципліни, щоб розгорнути список усіх оцінених робіт із датами та прямими посиланнями на Classroom.",
    ],
  },
  {
    id: "st-7-teacher-jump",
    tabLabel: "Викладач",
    title: "6. Миттєвий перехід у розклад викладача та повернення назад",
    phaseLabels: ["1. Клік по прізвищу", "2. Розклад викладача", "3. Повернення назад ✓"],
    points: [
      "Перехід у 1 клік із картки пари: натисніть на прізвище будь-якого викладача на парі, щоб одразу відкрити його розклад на поточний день або тиждень.",
      "Швидкий пошук аудиторії: ви миттєво побачите, з якою групою та в якому кабінеті зараз перебуває викладач або коли в нього вільне вікно для консультації.",
      "Банер повернення та швидкий пошук: кнопка «← До групи ...» зверху повертає вас у свій розклад, а останні переглянуті викладачі зберігаються у швидких чіпсах пошуку.",
    ],
  },
];

const TEACHER_STEPS: GuideStepMeta[] = [
  {
    id: "tc-1-pin",
    tabLabel: "PIN-доступ",
    title: "1. PIN-код викладача: розблокування всіх онлайн-пар",
    phaseLabels: ["1. Захист від гостей", "2. Введення PIN-коду", "3. Повний доступ ✓"],
    points: [
      "Захист посилань від сторонніх гостей: за замовчуванням усі кнопки Google Meet та Zoom закриті бейджем «🔒», щоб сторонні особи не могли заходити на заняття.",
      "Одноразове введення PIN-коду: натисніть на замочок «🔒» або відкрийте Налаштування та введіть PIN-код викладача — доступ збережеться у вашому браузері та PWA.",
      "Перехід на пари та до груп у 1 клік: після активації PIN-коду вам відкриті посилання всіх груп, а клік по шифру групи на картці пари миттєво показує розклад цієї групи.",
    ],
  },
  {
    id: "tc-4-stats",
    tabLabel: "Статистика",
    title: "2. Статистика вичитаних пар, годин та виконання навантаження",
    phaseLabels: ["1. Зведення семестру", "2. Вибір дисципліни", "3. Години по групах ✓"],
    points: [
      "Автоматичний облік за семестр: розділ «Статистика» підраховує фактично вичитані пари та академічні години від початку семестру до обраної дати.",
      "Точне врахування замін і скасувань: проведені вами разові заміни автоматично додаються до вашого активу, а скасовані чи перенесені заняття — віднімаються.",
      "Деталізація за предметами та групами: переглядайте точну кількість проведених пар і годин окремо по кожній дисципліні та кожній навчальній групі.",
    ],
  },
  {
    id: "tc-5-radar",
    tabLabel: "Заміни",
    title: "3. Радар замін, перенесень та швидкий експорт у Telegram",
    phaseLabels: ["1. Звідки перенесено", "2. Перехід на день", "3. Картка заміни ✓"],
    points: [
      "Точна адреса перенесення: на місці перенесеної пари завжди відображається підказка з новим днем та слотом («↪ Перенесено → Четвер, 3 пара»).",
      "Помітні маркери замін та подій: призначені заміни виділяються акцентною рамкою та бейджем «⚡ Заміна», а іспити й консультації — відповідними статусами сесії.",
      "Швидка відправка студентам: кнопки біля дати дозволяють за 1 клік скопіювати стильний PNG-скріншот або готовий текст розкладу для Telegram-чату групи.",
    ],
  },
];

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
      className="shrink-0 text-sys-status-denomText"
    >
      <path d="M16 4h2a2 2 0 0 1 2 2v14l-8-4-8 4V6a2 2 0 0 1 2-2h2" />
      <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
    </svg>
  );
}

/**
 * Плавний курсор, який точно наводиться на елементи, виконує клік із хвилею,
 * а на фінальній стадії (hidden = true) плавно зникає, щоб не затуляти фінальний інтерфейс.
 */
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
            animate={{ scale: 2.3, opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.44, ease: "easeOut" }}
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
}: GuideHubModalProps) {
  const router = useRouter();
  const { isLinked, linkedEmail } = useClassroomSubmissions();
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

  // Анімація плавно доходить до фінальної 3-ї фази (FINAL_MS) і зупиняється на ній,
  // щоб сцена закінчувалася логічним фіналом без миттєвого скидання назад
  useEffect(() => {
    if (!isOpen || isPaused || elapsedMs >= FINAL_MS) return;
    const timer = setInterval(() => {
      setElapsedMs((prev) => Math.min(FINAL_MS, prev + TICK_MS));
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [isOpen, isPaused, elapsedMs, stepIdx, role]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === " ") {
        e.preventDefault();
        if (elapsedMs >= FINAL_MS) {
          setElapsedMs(0);
          setIsPaused(false);
        } else {
          setIsPaused((p) => !p);
        }
      }
      if (e.key === "ArrowRight") {
        setSlideDir(1);
        setStepIdx((c) => Math.min(stepsCount - 1, c + 1));
        setElapsedMs(0);
        setIsPaused(false);
      }
      if (e.key === "ArrowLeft") {
        setSlideDir(-1);
        setStepIdx((c) => Math.max(0, c - 1));
        setElapsedMs(0);
        setIsPaused(false);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose, stepsCount, elapsedMs]);

  if (!isOpen) return null;

  const safeIdx = stepIdx < stepsCount ? stepIdx : 0;
  const activeStep = steps[safeIdx] ?? steps[0];

  /**
   * 6 стадій 3-актного сценарію (0..6400 мс):
   * - stage 0 (0..900 мс): Фаза 1 (Початковий стан, курсор у стартовій точці)
   * - stage 1 (900..1800 мс): Фаза 1 (Курсор навівся на 1-шу кнопку — hover)
   * - stage 2 (1800..2400 мс): Фаза 1 (Клік по 1-й кнопці — ripple)
   * - stage 3 (2400..3800 мс): Фаза 2 (Відкрився 2-й стан, курсор наводиться на 2-гу ціль)
   * - stage 4 (3800..4400 мс): Фаза 2 (Клік по 2-й цілі — ripple)
   * - stage 5 (4400..6400 мс): Фаза 3 (Фінальний результат! Курсор плавно зникає на >= 5100 мс, сцена фіксується)
   */
  const stage =
    elapsedMs < 900
      ? 0
      : elapsedMs < 1800
      ? 1
      : elapsedMs < 2400
      ? 2
      : elapsedMs < 3800
      ? 3
      : elapsedMs < 4400
      ? 4
      : 5;

  const activePhaseIdx: 0 | 1 | 2 = stage <= 2 ? 0 : stage <= 4 ? 1 : 2;
  const isCursorHidden = elapsedMs >= 5100;
  const isClicking = stage === 2 || stage === 4;

  const jumpToPhase = (phase: 0 | 1 | 2) => {
    setIsPaused(false);
    if (phase === 0) setElapsedMs(0);
    else if (phase === 1) setElapsedMs(2450);
    else setElapsedMs(4500);
  };

  const goToStep = (nextIdx: number) => {
    startTransition(() => {
      setSlideDir(nextIdx >= safeIdx ? 1 : -1);
      setStepIdx(nextIdx);
      setElapsedMs(0);
      setIsPaused(false);
    });
  };

  const handleRoleChange = (nextRole: "student" | "teacher") => {
    if (nextRole === role) return;
    startTransition(() => {
      setSlideDir(nextRole === "teacher" ? 1 : -1);
      setRole(nextRole);
      setStepIdx(0);
      setElapsedMs(0);
      setIsPaused(false);
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
        className="w-full sm:max-w-[540px] max-h-[94dvh] sm:max-h-[90vh] flex flex-col rounded-t-2xl sm:rounded-2xl border border-sys-border bg-sys-card text-sys-text-primary shadow-2xl overflow-hidden select-none"
      >
        {/* =========================================================
            1. HEADER + ROLE SWITCHER + MANUAL FEATURE TABS
           ========================================================= */}
        <div className="px-4 pt-3.5 pb-2.5 bg-sys-surface border-b border-sys-border space-y-2.5 shrink-0">
          <div className="flex items-center justify-between gap-2">
            <h2 id="guide-title" className="text-sm sm:text-base font-bold text-sys-text-primary truncate">
              Як користуватися розкладом
            </h2>

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

          {/* Вкладки функцій (перемикаються вручну) */}
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar rounded-xl border border-sys-border bg-sys-bg p-1 text-[11px] font-semibold">
            {steps.map((s, idx) => {
              const isCurrent = idx === safeIdx;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => goToStep(idx)}
                  className={`shrink-0 flex-1 py-1.5 px-2 rounded-lg transition-colors duration-150 cursor-pointer whitespace-nowrap ${
                    isCurrent
                      ? "bg-sys-card text-sys-accent font-bold border border-sys-border shadow-2xs"
                      : "text-sys-text-secondary hover:text-sys-text-primary"
                  }`}
                >
                  {s.tabLabel}
                </button>
              );
            })}
          </div>
        </div>

        {/* =========================================================
            2. 3-PHASE INTERACTIVE STAGE + FULL FEATURE EXPLANATION
           ========================================================= */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
          <AnimatePresence mode="wait" initial={false} custom={slideDir}>
            <motion.div
              key={`${role}-${activeStep.id}`}
              custom={slideDir}
              initial={{ opacity: 0, x: slideDir * 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: slideDir * -16 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              className="space-y-4"
            >
              {/* STAGE CONTAINER (h-[264px]) */}
              <div className="relative mx-auto w-full h-[264px] rounded-2xl border border-sys-border bg-sys-bg p-3 flex flex-col justify-between overflow-hidden shadow-inner">
                {/* Верхня панель сцени: 3 клікабельні фази сценарію + кнопка Повторити */}
                <div className="relative z-40 flex items-center justify-between gap-1.5 border-b border-sys-border/60 pb-2 shrink-0">
                  <div className="flex items-center gap-1 min-w-0 overflow-x-auto no-scrollbar">
                    {activeStep.phaseLabels.map((pLabel, pIdx) => {
                      const isPhaseActive = activePhaseIdx === pIdx;
                      const isPhaseDone = activePhaseIdx > pIdx;
                      return (
                        <button
                          key={pLabel}
                          type="button"
                          onClick={() => jumpToPhase(pIdx as 0 | 1 | 2)}
                          className={`rounded-lg px-2 py-0.5 text-[10px] font-bold transition-colors cursor-pointer whitespace-nowrap border ${
                            isPhaseActive
                              ? "border-sys-accent/50 bg-sys-accent/15 text-sys-accent"
                              : isPhaseDone
                              ? "border-sys-status-okBg/35 bg-sys-status-okBg/10 text-sys-status-okText"
                              : "border-transparent bg-sys-card/70 text-sys-text-muted hover:text-sys-text-secondary"
                          }`}
                        >
                          {pLabel}
                        </button>
                      );
                    })}
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setElapsedMs(0);
                      setIsPaused(false);
                    }}
                    title="Повторити демонстрацію спочатку"
                    className="shrink-0 rounded-lg border border-sys-border bg-sys-card px-2 py-0.5 text-[10px] font-bold text-sys-text-secondary hover:text-sys-accent hover:border-sys-accent/40 active:scale-95 transition-colors cursor-pointer"
                  >
                    ↻ Повторити
                  </button>
                </div>

                {/* Центральна зона сцени */}
                <div className="relative flex-1 flex flex-col justify-center pt-1">
                  {/* =====================================================
                      СТУДЕНТ 0: ПОШТА @kre.dp.ua (3 ПОВНІ ФАЗИ)
                     ===================================================== */}
                  {role === "student" && safeIdx === 0 && (
                    <div className="relative w-full max-w-[420px] mx-auto">
                      <DemoCursor
                        x={stage === 0 ? "42%" : stage <= 2 ? "84%" : stage <= 4 ? "80%" : "86%"}
                        y={stage === 0 ? "76%" : stage <= 2 ? "26%" : stage <= 4 ? "54%" : "78%"}
                        clicking={isClicking}
                        hidden={isCursorHidden}
                      />

                      {activePhaseIdx === 0 && (
                        <div className="rounded-2xl border border-sys-border bg-sys-card p-3.5 shadow-sm space-y-2.5 animate-in fade-in duration-150">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="text-base font-black text-sys-text-primary leading-none">1</span>
                              <span className="text-sys-text-muted font-bold text-xs">·</span>
                              <span className="text-xs font-semibold text-sys-text-secondary">09:00–10:20</span>
                            </div>
                            <span
                              className={`inline-flex h-8 px-2.5 items-center gap-1.5 rounded-xl border text-xs font-bold transition-transform ${
                                stage >= 1
                                  ? "border-sys-status-warnBg/60 bg-sys-status-warnBg/25 text-sys-status-warnText ring-2 ring-sys-status-warnBg/30 scale-95"
                                  : "border-sys-status-warnBg/40 bg-sys-status-warnBg/15 text-sys-status-warnText"
                              }`}
                            >
                              <span>🔒</span>
                              <span>Meet</span>
                            </span>
                          </div>
                          <div>
                            <div className="text-sm font-bold text-sys-text-subject">Вища математика</div>
                            <div className="flex items-center gap-1.5 text-xs text-sys-text-secondary mt-1">
                              <UserSvg />
                              <span>Іваненко О.М.</span>
                            </div>
                          </div>
                          <div className="flex items-center justify-between rounded-xl border border-dashed border-sys-border bg-sys-bg/60 px-3 py-2 text-[11px] text-sys-text-muted">
                            <span>🔒 Дзвінок і завдання приховані</span>
                            <span className="font-bold text-sys-accent">Натисніть 🔒 Meet →</span>
                          </div>
                        </div>
                      )}

                      {activePhaseIdx === 1 && (
                        <div className="rounded-2xl border border-sys-accent/45 bg-sys-card p-3.5 shadow-md space-y-2.5 animate-in fade-in duration-150">
                          <div className="flex items-center justify-between border-b border-sys-border/60 pb-2">
                            <span className="text-xs font-bold text-sys-text-primary">
                              Оберіть корпоративний акаунт @kre.dp.ua
                            </span>
                            <span className="rounded-md border border-sys-status-okBg/35 bg-sys-status-okBg/15 px-1.5 py-0.5 text-[10px] font-bold text-sys-status-okText">
                              Без галочок • Лише читання
                            </span>
                          </div>

                          <div
                            className={`flex items-center justify-between rounded-xl border px-3 py-2 transition-colors ${
                              stage === 4
                                ? "border-sys-accent bg-sys-accent/20"
                                : "border-sys-accent/50 bg-sys-accent/10"
                            }`}
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sys-accentSolid text-white font-bold text-xs">
                                С
                              </span>
                              <div className="min-w-0">
                                <p className="text-xs font-bold text-sys-text-primary truncate">Студент Коледжу</p>
                                <p className="text-[11px] font-semibold text-sys-accent truncate">student@kre.dp.ua</p>
                              </div>
                            </div>
                            <span className="rounded-lg bg-sys-accent px-2.5 py-1 text-[11px] font-bold text-white shrink-0">
                              Продовжити →
                            </span>
                          </div>

                          <div className="flex items-center justify-between text-[11px] text-sys-text-secondary px-1">
                            <span>✓ Авто-визначення групи 85</span>
                            <span>✓ Посилання Meet/Zoom</span>
                            <span>✓ ДЗ і оцінки</span>
                          </div>
                        </div>
                      )}

                      {activePhaseIdx === 2 && (
                        <div className="rounded-2xl border border-sys-border bg-sys-card p-3 shadow-sm space-y-2 animate-in fade-in duration-150">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5">
                              <span className="text-base font-black text-sys-text-primary leading-none">1</span>
                              <span className="text-sys-text-muted font-bold text-xs">·</span>
                              <span className="text-xs font-semibold text-sys-text-secondary">09:00–10:20</span>
                              <span className="rounded-md border border-sys-status-okBg/35 bg-sys-status-okBg/15 px-1.5 py-0.5 text-[10px] font-bold text-sys-status-okText">
                                ✓ ПК ↔ Телефон
                              </span>
                            </div>

                            <span className="inline-flex h-7 px-2.5 items-center gap-1.5 rounded-lg border border-sys-status-okBg/45 bg-sys-status-okBg/15 text-sys-status-okText text-xs font-bold shadow-2xs">
                              <PlatformSvg platform="meet" />
                              <span>Meet ↗</span>
                            </span>
                          </div>

                          <div className="text-sm font-bold text-sys-text-subject leading-tight">
                            Вища математика · <span className="text-xs font-medium text-sys-text-secondary">Іваненко О.М.</span>
                          </div>

                          <div className="flex items-center justify-between rounded-xl bg-sys-bg/80 border border-sys-status-denomBg/40 px-3 py-1.5 text-xs">
                            <div className="flex items-center gap-2 min-w-0">
                              <ClipboardSvg />
                              <span className="font-semibold text-sys-text-primary truncate">
                                Практична робота №5
                              </span>
                            </div>
                            <span className="text-sys-status-denomText font-bold shrink-0 ml-2">
                              до 15 лист. ↗
                            </span>
                          </div>

                          <div className="flex items-center justify-between text-[10px] font-semibold text-sys-status-okText px-1">
                            <span>✓ Дзвінки відкрито</span>
                            <span>✓ ДЗ прикріплено до пар</span>
                            <span>✓ Фонове оновлення 10 хв</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* =====================================================
                      СТУДЕНТ 1: ФІЛЬТР ПІДГРУПИ (3 ПОВНІ ФАЗИ)
                     ===================================================== */}
                  {role === "student" && safeIdx === 1 && (
                    <div className="relative w-full max-w-[420px] mx-auto">
                      <DemoCursor
                        x={stage === 0 ? "65%" : stage <= 2 ? "18%" : stage <= 4 ? "78%" : "85%"}
                        y={stage === 0 ? "82%" : stage <= 2 ? "52%" : stage <= 4 ? "24%" : "78%"}
                        clicking={isClicking}
                        hidden={isCursorHidden}
                      />

                      <div className="rounded-2xl border border-sys-border bg-sys-card p-3.5 shadow-sm space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-base font-black text-sys-text-primary leading-none">2</span>
                            <span className="text-sys-text-muted font-bold text-xs">·</span>
                            <span className="text-xs font-semibold text-sys-text-secondary">10:40–12:00</span>
                          </div>
                          {activePhaseIdx >= 1 ? (
                            <span className="inline-flex h-7 px-2.5 items-center gap-1.5 rounded-lg border border-sys-status-okBg/45 bg-sys-status-okBg/15 text-sys-status-okText text-xs font-bold">
                              <PlatformSvg platform="meet" />
                              <span>Meet ↗</span>
                            </span>
                          ) : (
                            <span className="text-[11px] font-semibold text-sys-text-muted">
                              Показано обидві підгрупи
                            </span>
                          )}
                        </div>

                        <div className="text-sm font-bold text-sys-text-subject leading-snug">
                          Іноземна мова (за проф. спрямуванням)
                        </div>

                        {/* Рядок 1 підгрупи */}
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className={`inline-flex shrink-0 items-center gap-1.5 h-6 px-2 rounded-md border text-xs font-bold transition-colors ${
                                activePhaseIdx >= 1
                                  ? "border-sys-accent/50 bg-sys-accent/15 text-sys-accent"
                                  : stage >= 1
                                  ? "border-sys-accent bg-sys-accent/10 text-sys-text-primary ring-2 ring-sys-accent/30"
                                  : "bg-sys-bg border-sys-border text-sys-text-secondary"
                              }`}
                            >
                              <span className={`h-1.5 w-1.5 rounded-full ${activePhaseIdx >= 1 ? "bg-sys-accent" : "bg-sys-text-muted"}`} />
                              <span>1 підгр.</span>
                            </span>
                            <UserSvg />
                            <span className="text-xs font-semibold text-sys-text-primary truncate">
                              Токарєва О.В.
                            </span>
                          </div>

                          {activePhaseIdx === 0 && (
                            <span className="inline-flex h-6 px-2 items-center gap-1 rounded-md border border-sys-status-okBg/40 bg-sys-status-okBg/15 text-sys-status-okText text-[11px] font-bold">
                              <PlatformSvg platform="meet" />
                              <span>Meet ↗</span>
                            </span>
                          )}
                        </div>

                        {/* Рядок 2 підгрупи (приховується після кліку) */}
                        {activePhaseIdx === 0 ? (
                          <div className="flex items-center justify-between gap-2 pt-0.5">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="inline-flex shrink-0 items-center gap-1.5 h-6 px-2 rounded-md border border-sys-border bg-sys-bg text-xs font-semibold text-sys-text-secondary">
                                <span className="h-1.5 w-1.5 rounded-full bg-sys-text-muted" />
                                <span>2 підгр.</span>
                              </span>
                              <UserSvg />
                              <span className="text-xs font-medium text-sys-text-secondary truncate">
                                Хочинська О.С.
                              </span>
                            </div>
                            <span className="shrink-0 rounded-md border border-sys-border bg-sys-bg px-2 py-0.5 text-[11px] font-semibold text-sys-text-secondary">
                              🚪 ауд. 204
                            </span>
                          </div>
                        ) : activePhaseIdx === 1 ? (
                          <div className="rounded-xl border border-sys-status-denomBg/40 bg-sys-bg/80 px-3 py-1.5 flex items-center justify-between text-xs animate-in fade-in duration-150">
                            <span className="font-semibold text-sys-text-primary truncate">
                              📋 ДЗ (1 підгр.): Тест Grammar Unit 4
                            </span>
                            <span className="font-bold text-sys-status-denomText shrink-0 ml-2">до 14 лист. ↗</span>
                          </div>
                        ) : (
                          <div className="space-y-1.5 animate-in fade-in duration-150">
                            <div className="rounded-xl border border-sys-status-denomBg/40 bg-sys-bg/80 px-3 py-1.5 flex items-center justify-between text-xs">
                              <span className="font-semibold text-sys-text-primary truncate">
                                📋 ДЗ (1 підгр.): Тест Grammar Unit 4
                              </span>
                              <span className="font-bold text-sys-status-denomText shrink-0 ml-2">до 14 лист. ↗</span>
                            </div>
                            <div className="flex items-center justify-between text-[10px] font-semibold text-sys-status-okText px-1">
                              <span>✓ Чужу підгрупу та її ДЗ приховано</span>
                              <span>✓ Клік по бейджу повертає «Обидві»</span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* =====================================================
                      СТУДЕНТ 2: АВТО-КОД ZOOM ТА КОПІЮВАННЯ ПАРОЛЯ (3 ФАЗИ)
                     ===================================================== */}
                  {role === "student" && safeIdx === 2 && (
                    <div className="relative w-full max-w-[420px] mx-auto">
                      <DemoCursor
                        x={stage === 0 ? "32%" : stage <= 2 ? "76%" : stage <= 4 ? "76%" : "85%"}
                        y={stage === 0 ? "76%" : stage <= 2 ? "34%" : stage <= 4 ? "34%" : "78%"}
                        clicking={isClicking}
                        hidden={isCursorHidden}
                      />

                      {activePhaseIdx === 0 && (
                        <div className="rounded-2xl border border-sys-border bg-sys-card p-3.5 shadow-sm space-y-2 animate-in fade-in duration-150">
                          <div className="text-[11px] font-bold text-sys-text-secondary">
                            Оголошення викладача в Google Classroom:
                          </div>
                          <div className="rounded-xl border border-sys-border bg-sys-bg p-2.5 text-xs font-mono text-sys-text-primary space-y-0.5">
                            <div>Шановні студенти, пара у Zoom:</div>
                            <div className="text-sys-accent font-bold">
                              Ідентифікатор: 842 190 4411 • Код доступу: dfkr26
                            </div>
                          </div>
                          <div className="flex items-center justify-between text-[11px] font-semibold text-sys-status-okText px-1">
                            <span>↓ Система сама перетворює текст на кнопку з паролем</span>
                          </div>
                        </div>
                      )}

                      {activePhaseIdx === 1 && (
                        <div className="rounded-2xl border border-sys-border bg-sys-card p-3.5 shadow-sm space-y-2.5 animate-in fade-in duration-150">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="text-base font-black text-sys-text-primary leading-none">3</span>
                              <span className="text-sys-text-muted font-bold text-xs">·</span>
                              <span className="text-xs font-semibold text-sys-text-secondary">12:30–13:50</span>
                              <span className="rounded-full border border-sys-status-okBg/40 bg-sys-status-okBg/15 px-2 py-0.5 text-[10px] font-bold text-sys-status-okText">
                                ● Жива пара
                              </span>
                            </div>

                            <span
                              className={`inline-flex h-8 px-2.5 items-center gap-1.5 rounded-xl border text-xs font-bold transition-transform ${
                                stage === 4
                                  ? "border-sys-status-infoBg bg-sys-status-infoBg/25 text-sys-status-infoText scale-95 ring-2 ring-sys-status-infoBg/35"
                                  : "border-sys-status-infoBg/50 bg-sys-status-infoBg/15 text-sys-status-infoText"
                              }`}
                            >
                              <PlatformSvg platform="zoom" />
                              <span>Zoom · код: dfkr26 ↗</span>
                            </span>
                          </div>

                          <div>
                            <div className="text-sm font-bold text-sys-text-subject">
                              Електроніка та мікросхемотехніка
                            </div>
                            <div className="flex items-center gap-1.5 text-xs text-sys-text-secondary mt-1">
                              <UserSvg />
                              <span>Філімончук А.В.</span>
                            </div>
                          </div>
                        </div>
                      )}

                      {activePhaseIdx === 2 && (
                        <div className="space-y-2 animate-in fade-in duration-150">
                          <div className="flex items-center justify-center gap-2 rounded-xl border border-sys-status-okBg/45 bg-sys-status-okBg/15 px-3 py-2 text-xs font-bold text-sys-status-okText shadow-2xs">
                            <span>✓</span>
                            <span>Код доступу Zoom (dfkr26) автоматично скопійовано!</span>
                          </div>

                          <div className="rounded-2xl border border-sys-border bg-sys-card p-3 flex items-center justify-between gap-3 text-xs">
                            <div className="space-y-0.5 min-w-0">
                              <div className="font-bold text-sys-text-primary">
                                Додаток Zoom відкривається автоматично
                              </div>
                              <div className="text-[11px] text-sys-text-secondary">
                                Пароль <strong className="text-sys-accent">dfkr26</strong> вже у вашому буфері обміну — просто натисніть «Вставити»
                              </div>
                            </div>
                            <span className="shrink-0 rounded-xl bg-sys-accent px-3 py-1.5 text-[11px] font-bold text-white">
                              Вставити ✓
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* =====================================================
                      СТУДЕНТ 3: ЄДИНИЙ СПИСОК ЗАВДАНЬ (3 ФАЗИ)
                     ===================================================== */}
                  {role === "student" && safeIdx === 3 && (
                    <div className="relative w-full max-w-[420px] mx-auto space-y-2">
                      <DemoCursor
                        x={stage === 0 ? "18%" : stage <= 2 ? "50%" : stage <= 4 ? "75%" : "85%"}
                        y={stage === 0 ? "18%" : stage <= 2 ? "18%" : stage <= 4 ? "46%" : "78%"}
                        clicking={isClicking}
                        hidden={isCursorHidden}
                      />

                      {/* Перемикач: До здачі | Борги | Здано */}
                      <div className="relative grid grid-cols-3 rounded-xl border border-sys-border bg-sys-card p-1 text-xs font-semibold isolate">
                        <div
                          className="absolute top-1 bottom-1 transition-transform duration-200 ease-out transform-gpu z-0"
                          style={{
                            left: "4px",
                            width: "calc((100% - 8px) / 3)",
                            transform: `translate3d(${activePhaseIdx >= 1 ? "100%" : "0%"}, 0, 0)`,
                          }}
                        >
                          <div
                            className={`h-full w-full rounded-lg shadow-2xs ${
                              activePhaseIdx >= 1 ? "bg-sys-destructive" : "bg-sys-accentSolid"
                            }`}
                          />
                        </div>
                        <div className={`relative z-10 text-center py-1 ${activePhaseIdx === 0 ? "text-white font-bold" : "text-sys-text-secondary"}`}>
                          До здачі 3
                        </div>
                        <div className={`relative z-10 text-center py-1 ${activePhaseIdx >= 1 ? "text-white font-bold" : "text-sys-status-dangerText"}`}>
                          Борги 1
                        </div>
                        <div className="relative z-10 text-center py-1 text-sys-text-secondary">
                          Здано 14
                        </div>
                      </div>

                      {/* Фільтр за предметом */}
                      <div
                        className={`flex items-center justify-between rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors ${
                          activePhaseIdx === 2
                            ? "border-sys-accent/50 bg-sys-accent/10 text-sys-accent"
                            : "border-sys-border bg-sys-card text-sys-text-secondary"
                        }`}
                      >
                        <span>
                          {activePhaseIdx === 2 ? "Фільтр: Вища математика ✓" : "Усі предмети (6 дисциплін)"}
                        </span>
                        <span>▾</span>
                      </div>

                      {/* Картка завдання відповідно до фази */}
                      {activePhaseIdx === 0 ? (
                        <div className="rounded-xl bg-sys-card border border-sys-status-warnBg/45 p-2.5 shadow-2xs space-y-1">
                          <div className="flex items-center justify-between text-xs font-bold text-sys-text-primary">
                            <span>Лабораторна робота №4</span>
                            <span className="text-sys-status-warnText">Завтра ↗</span>
                          </div>
                          <p className="text-[11px] text-sys-text-secondary">
                            Комп&apos;ютерна схемотехніка · Іваненко О.М.
                          </p>
                        </div>
                      ) : (
                        <div className="rounded-xl bg-sys-card border border-sys-status-dangerBg/45 p-2.5 shadow-2xs space-y-1 animate-in fade-in duration-150">
                          <div className="flex items-center justify-between text-xs font-bold text-sys-text-primary">
                            <span>Практична робота №2 (з минулого місяця)</span>
                            <span className="text-sys-status-dangerText">Борг · 4 дні ↗</span>
                          </div>
                          <div className="flex items-center justify-between text-[11px] text-sys-text-secondary">
                            <span>Вища математика · Петренко І.В.</span>
                            {activePhaseIdx === 2 && (
                              <span className="font-bold text-sys-status-okText">✓ Відкривається в Classroom</span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* =====================================================
                      СТУДЕНТ 4: ОЦІНКИ ТА СЕРЕДНІЙ БАЛ (3 ФАЗИ)
                     ===================================================== */}
                  {role === "student" && safeIdx === 4 && (
                    <div className="relative w-full max-w-[420px] mx-auto space-y-2">
                      <DemoCursor
                        x={stage === 0 ? "24%" : stage <= 2 ? "74%" : stage <= 4 ? "62%" : "86%"}
                        y={stage === 0 ? "18%" : stage <= 2 ? "18%" : stage <= 4 ? "54%" : "78%"}
                        clicking={isClicking}
                        hidden={isCursorHidden}
                      />

                      <div className="relative grid grid-cols-2 rounded-xl border border-sys-border bg-sys-card p-1 text-xs font-semibold isolate">
                        <div
                          className="absolute top-1 bottom-1 transition-transform duration-200 ease-out transform-gpu z-0"
                          style={{
                            left: "4px",
                            width: "calc((100% - 8px) / 2)",
                            transform: `translate3d(${activePhaseIdx >= 1 ? "100%" : "0%"}, 0, 0)`,
                          }}
                        >
                          <div className="h-full w-full rounded-lg bg-sys-accentSolid shadow-2xs" />
                        </div>
                        <div className={`relative z-10 text-center py-1 ${activePhaseIdx === 0 ? "text-white font-bold" : "text-sys-text-secondary"}`}>
                          📋 Завдання
                        </div>
                        <div className={`relative z-10 text-center py-1 ${activePhaseIdx >= 1 ? "text-white font-bold" : "text-sys-text-secondary"}`}>
                          📊 Оцінки (GPA)
                        </div>
                      </div>

                      <div className="rounded-2xl border border-sys-border bg-sys-card p-3 shadow-sm space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-sm font-bold text-sys-text-primary truncate">
                              Вища математика
                            </div>
                            <div className="text-[11px] text-sys-text-secondary">
                              Оцінено робіт: 6 • Авто-перерахунок 100 → 12 б.
                            </div>
                          </div>

                          <div className="shrink-0 rounded-xl border border-sys-status-okBg/45 bg-sys-status-okBg/15 px-3 py-1 text-right">
                            <div className="text-[10px] font-bold uppercase text-sys-status-okText">
                              Середній
                            </div>
                            <div className="text-base font-black leading-none text-sys-status-okText mt-0.5">
                              11.0
                            </div>
                          </div>
                        </div>

                        {activePhaseIdx < 2 ? (
                          <div className="flex items-center justify-between rounded-lg bg-sys-bg px-2.5 py-1.5 text-xs border border-sys-border">
                            <span className="font-medium text-sys-text-secondary">
                              Натисніть на предмет, щоб розгорнути всі оцінки
                            </span>
                            <span className="font-bold text-sys-accent">Розгорнути ▾</span>
                          </div>
                        ) : (
                          <div className="space-y-1 pt-1 border-t border-sys-border/60 text-xs animate-in fade-in duration-150">
                            <div className="flex items-center justify-between rounded-lg bg-sys-bg px-2.5 py-1">
                              <span className="font-medium text-sys-text-primary">Контрольна робота №1</span>
                              <span className="font-bold text-sys-status-okText">95/100 → 11 б. ↗</span>
                            </div>
                            <div className="flex items-center justify-between rounded-lg bg-sys-bg px-2.5 py-1">
                              <span className="font-medium text-sys-text-primary">Практична робота №4</span>
                              <span className="font-bold text-sys-status-okText">92/100 → 11 б. ↗</span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* =====================================================
                      СТУДЕНТ 5 (#7): ПЕРЕХІД У РОЗКЛАД ВИКЛАДАЧА (3 ФАЗИ)
                     ===================================================== */}
                  {role === "student" && safeIdx === 5 && (
                    <div className="relative w-full max-w-[420px] mx-auto">
                      <DemoCursor
                        x={stage === 0 ? "72%" : stage <= 2 ? "28%" : stage <= 4 ? "82%" : "86%"}
                        y={stage === 0 ? "28%" : stage <= 2 ? "74%" : stage <= 4 ? "22%" : "78%"}
                        clicking={isClicking}
                        hidden={isCursorHidden}
                      />

                      {activePhaseIdx === 0 && (
                        <div className="rounded-2xl border border-sys-border bg-sys-card p-3.5 shadow-sm space-y-2.5 animate-in fade-in duration-150">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-base font-black text-sys-text-primary leading-none">2</span>
                              <span className="text-sys-text-muted font-bold text-xs">·</span>
                              <span className="text-xs font-semibold text-sys-text-secondary">10:40–12:00</span>
                            </div>
                            <span className="rounded-lg border border-sys-border bg-sys-bg px-2.5 py-1 text-xs font-semibold text-sys-text-secondary">
                              🚪 ауд. 305
                            </span>
                          </div>

                          <div className="text-sm font-bold text-sys-text-subject">
                            Комп&apos;ютерна схемотехніка
                          </div>

                          <div className="flex items-center justify-between gap-2 text-xs">
                            <div className="flex items-center gap-1.5">
                              <UserSvg />
                              <span
                                className={`font-bold rounded-md px-2 py-0.5 transition-colors ${
                                  stage >= 1
                                    ? "bg-sys-accent/20 text-sys-accent ring-1 ring-sys-accent/50 underline underline-offset-2"
                                    : "text-sys-text-primary"
                                }`}
                              >
                                Іваненко О.М.
                              </span>
                            </div>
                            <span className="text-[11px] text-sys-text-muted">Клік по прізвищу →</span>
                          </div>
                        </div>
                      )}

                      {activePhaseIdx === 1 && (
                        <div className="space-y-2 animate-in fade-in duration-150">
                          <div className="flex items-center justify-between rounded-xl border border-sys-accent/40 bg-sys-accent/10 px-3 py-2 text-xs">
                            <span className="text-sys-text-secondary truncate mr-2">
                              Викладач: <strong className="text-sys-text-primary">Іваненко О.М.</strong>
                            </span>
                            <span
                              className={`shrink-0 rounded-lg bg-sys-accent px-2.5 py-1 text-[11px] font-bold text-white transition-transform ${
                                stage === 4 ? "scale-95 ring-2 ring-sys-accent/50" : ""
                              }`}
                            >
                              ← До групи 85
                            </span>
                          </div>

                          <div className="rounded-xl border border-sys-border bg-sys-card p-3 space-y-1.5 text-xs">
                            <div className="flex justify-between">
                              <span className="font-semibold text-sys-text-secondary">1 пара (09:00) • Група 79</span>
                              <span className="font-bold text-sys-text-primary">ауд. 305</span>
                            </div>
                            <div className="flex justify-between pt-1 border-t border-sys-border/60">
                              <span className="font-bold text-sys-accent">2 пара (10:40) • Група 85 (Ваша)</span>
                              <span className="font-bold text-sys-accent">ауд. 305</span>
                            </div>
                          </div>
                        </div>
                      )}

                      {activePhaseIdx === 2 && (
                        <div className="rounded-2xl border border-sys-border bg-sys-card p-3.5 shadow-sm space-y-2 animate-in fade-in duration-150">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-sys-status-okText">
                              ✓ Миттєве повернення у розклад вашої групи
                            </span>
                            <span className="rounded-md border border-sys-border bg-sys-bg px-2 py-0.5 text-[10px] font-bold text-sys-text-secondary">
                              Гаряча клавіша: / або Ctrl+K
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                            <span className="text-[11px] text-sys-text-muted">Нещодавні:</span>
                            <span className="rounded-lg border border-sys-accent/40 bg-sys-accent/15 px-2 py-0.5 text-[11px] font-bold text-sys-accent">
                              Група 85 ✓
                            </span>
                            <span className="rounded-lg border border-sys-border bg-sys-bg px-2 py-0.5 text-[11px] font-semibold text-sys-text-secondary">
                              Іваненко О.М.
                            </span>
                            <span className="rounded-lg border border-sys-border bg-sys-bg px-2 py-0.5 text-[11px] font-semibold text-sys-text-secondary">
                              Токарєва О.В.
                            </span>
                          </div>
                          <p className="text-[11px] text-sys-text-secondary leading-snug">
                            Ви завжди знаєте, у якій аудиторії зараз викладач, і повертаєтесь до своєї групи в 1 клік.
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* =====================================================
                      ВИКЛАДАЧ 0 (#1): PIN-КОД ДЛЯ РОЗБЛОКУВАННЯ ПАР (3 ФАЗИ)
                     ===================================================== */}
                  {role === "teacher" && safeIdx === 0 && (
                    <div className="relative w-full max-w-[420px] mx-auto">
                      <DemoCursor
                        x={stage === 0 ? "38%" : stage <= 2 ? "84%" : stage <= 4 ? "82%" : "86%"}
                        y={stage === 0 ? "75%" : stage <= 2 ? "26%" : stage <= 4 ? "66%" : "78%"}
                        clicking={isClicking}
                        hidden={isCursorHidden}
                      />

                      {activePhaseIdx === 0 && (
                        <div className="rounded-2xl border border-sys-border bg-sys-card p-3.5 shadow-sm space-y-2.5 animate-in fade-in duration-150">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-sys-text-secondary">1 пара · 09:00–10:20</span>
                            <span
                              className={`inline-flex h-8 px-2.5 items-center gap-1.5 rounded-xl border text-xs font-bold transition-transform ${
                                stage >= 1
                                  ? "border-sys-status-warnBg/60 bg-sys-status-warnBg/25 text-sys-status-warnText scale-95 ring-2 ring-sys-status-warnBg/30"
                                  : "border-sys-status-warnBg/40 bg-sys-status-warnBg/15 text-sys-status-warnText"
                              }`}
                            >
                              <span>🔒</span>
                              <span>Zoom</span>
                            </span>
                          </div>
                          <div className="text-sm font-bold text-sys-text-subject">Комп&apos;ютерна схемотехніка</div>
                          <div className="text-xs text-sys-text-secondary">Група: 85 (КІ-24-2/9)</div>
                        </div>
                      )}

                      {activePhaseIdx === 1 && (
                        <div className="rounded-2xl border border-sys-accent/45 bg-sys-card p-3.5 shadow-md space-y-2.5 animate-in fade-in duration-150">
                          <div className="text-xs font-bold text-sys-text-primary">
                            Введіть PIN-код викладача (один раз на цьому пристрої):
                          </div>
                          <div className="flex items-center justify-between gap-2 rounded-xl border border-sys-accent/50 bg-sys-bg px-3 py-2 text-xs">
                            <span className="font-mono text-sm font-black tracking-widest text-sys-text-primary">
                              ••••
                            </span>
                            <span
                              className={`rounded-lg bg-sys-accent px-3 py-1 text-[11px] font-bold text-white transition-transform ${
                                stage === 4 ? "scale-95" : ""
                              }`}
                            >
                              Підтвердити →
                            </span>
                          </div>
                          <div className="text-[11px] text-sys-text-secondary">
                            PIN-код захищає онлайн-пари коледжу від сторонніх гостей.
                          </div>
                        </div>
                      )}

                      {activePhaseIdx === 2 && (
                        <div className="rounded-2xl border border-sys-border bg-sys-card p-3.5 shadow-sm space-y-2 animate-in fade-in duration-150">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-sys-text-secondary">1 пара · 09:00–10:20</span>
                            <span className="inline-flex h-8 px-2.5 items-center gap-1.5 rounded-xl border border-sys-status-infoBg/45 bg-sys-status-infoBg/15 text-sys-status-infoText text-xs font-bold">
                              <PlatformSvg platform="zoom" />
                              <span>Zoom · код: dfkr ↗</span>
                            </span>
                          </div>
                          <div className="text-sm font-bold text-sys-text-subject">Комп&apos;ютерна схемотехніка</div>
                          <div className="flex items-center justify-between rounded-xl border border-sys-status-okBg/40 bg-sys-status-okBg/10 px-3 py-1.5 text-xs font-semibold text-sys-status-okText">
                            <span>✓ Усі посилання Meet та Zoom відкрито для всіх груп</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* =====================================================
                      ВИКЛАДАЧ 1 (#4): СТАТИСТИКА ВИЧИТАНИХ ГОДИН (3 ФАЗИ)
                     ===================================================== */}
                  {role === "teacher" && safeIdx === 1 && (
                    <div className="relative w-full max-w-[420px] mx-auto space-y-2">
                      <DemoCursor
                        x={stage === 0 ? "25%" : stage <= 2 ? "65%" : stage <= 4 ? "65%" : "86%"}
                        y={stage === 0 ? "24%" : stage <= 2 ? "64%" : stage <= 4 ? "78%" : "82%"}
                        clicking={isClicking}
                        hidden={isCursorHidden}
                      />

                      <div className="grid grid-cols-2 gap-2">
                        <div className="rounded-xl border border-sys-border bg-sys-card px-3 py-2">
                          <div className="text-[10px] font-bold uppercase text-sys-text-muted">Вичитано за семестр</div>
                          <div className="text-sm font-black text-sys-accent mt-0.5">48 пар • 96 год</div>
                        </div>
                        <div className="rounded-xl border border-sys-border bg-sys-card px-3 py-2">
                          <div className="text-[10px] font-bold uppercase text-sys-text-muted">Заміни / Перенесення</div>
                          <div className="text-sm font-black text-sys-status-okText mt-0.5">+4 пари враховано</div>
                        </div>
                      </div>

                      <div className="rounded-xl border border-sys-border bg-sys-card p-3 space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-bold text-sys-text-primary">Комп&apos;ютерна схемотехніка</span>
                          <span className="font-bold text-sys-accent">34 пари (68 год) ▾</span>
                        </div>

                        {activePhaseIdx === 0 ? (
                          <div className="text-[11px] text-sys-text-secondary">
                            Натисніть на предмет, щоб переглянути розбивку годин по кожній групі
                          </div>
                        ) : (
                          <div className="space-y-1 pt-1 border-t border-sys-border/60 text-[11px] animate-in fade-in duration-150">
                            <div className="flex items-center justify-between px-1">
                              <span className="text-sys-text-secondary">Група 85 (КІ-24-1/9)</span>
                              <span className="font-bold text-sys-text-primary">18 пар • 36 год</span>
                            </div>
                            <div
                              className={`flex items-center justify-between rounded-lg px-2 py-1 ${
                                activePhaseIdx === 2
                                  ? "bg-sys-status-okBg/15 text-sys-status-okText font-bold"
                                  : "bg-sys-accent/15 text-sys-accent font-bold"
                              }`}
                            >
                              <span>Група 86 (КІ-24-2/9)</span>
                              <span>16 пар • 32 год ✓</span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* =====================================================
                      ВИКЛАДАЧ 2 (#5): РАДАР ЗАМІН ТА ПЕРЕНЕСЕНЬ (3 ФАЗИ)
                     ===================================================== */}
                  {role === "teacher" && safeIdx === 2 && (
                    <div className="relative w-full max-w-[420px] mx-auto space-y-2">
                      <DemoCursor
                        x={stage === 0 ? "48%" : stage <= 2 ? "70%" : stage <= 4 ? "86%" : "88%"}
                        y={stage === 0 ? "18%" : stage <= 2 ? "18%" : stage <= 4 ? "54%" : "78%"}
                        clicking={isClicking}
                        hidden={isCursorHidden}
                      />

                      <div className="relative flex h-9 w-full rounded-xl border border-sys-border bg-sys-card overflow-hidden text-xs">
                        <div
                          className="absolute bottom-0 left-0 h-[2.5px] bg-sys-accent transition-transform duration-200 ease-out"
                          style={{
                            width: "20%",
                            transform: `translateX(${(activePhaseIdx >= 1 ? 3 : 2) * 100}%)`,
                          }}
                        />
                        {["Пн 10", "Вт 11", "Ср 12", "Чт 13", "Пт 14"].map((d, i) => {
                          const active = (activePhaseIdx >= 1 ? 3 : 2) === i;
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

                      {activePhaseIdx === 0 ? (
                        <div className="rounded-2xl border border-sys-status-dangerBg/45 border-dashed bg-sys-card p-3 space-y-1.5 animate-in fade-in duration-150">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-sys-text-secondary">3 пара · Середа</span>
                            <span className="rounded-md px-2 py-0.5 text-[11px] font-bold border border-sys-status-warnBg/45 bg-sys-status-warnBg/15 text-sys-status-warnText">
                              ↪ Перенесено → Четвер, 3 пара
                            </span>
                          </div>
                          <div className="text-sm font-bold line-through text-sys-text-muted">
                            Мікропроцесорні системи
                          </div>
                          <div className="text-xs text-sys-text-secondary">Група 85</div>
                        </div>
                      ) : (
                        <div className="rounded-2xl border border-sys-warning/50 ring-1 ring-sys-warning/50 bg-sys-card p-3 space-y-1.5 animate-in fade-in duration-150">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-sys-text-secondary">3 пара · Четвер (12:30)</span>
                            <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold bg-sys-warning uppercase text-sys-warningText">
                              ⚡ Заміна
                            </span>
                          </div>
                          <div className="text-sm font-bold text-sys-text-subject">
                            Мікропроцесорні системи
                          </div>
                          <div className="flex items-center justify-between text-xs text-sys-text-secondary">
                            <span>Група 85 • 🚪 ауд. 305</span>
                            {activePhaseIdx === 2 && (
                              <span className="font-bold text-sys-status-okText">
                                ✓ Готово до відправки в Telegram
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* =====================================================
                  3. ПОВНИЙ ОПИС ФУНКЦІЇ + ШВИДКА ДІЯ ПРЯМО З СЛАЙДУ
                 ===================================================== */}
              <div className="space-y-3 px-0.5">
                <h3 className="text-sm sm:text-base font-bold text-sys-text-primary leading-snug">
                  {activeStep.title}
                </h3>

                <ul className="space-y-2 text-xs text-sys-text-secondary leading-relaxed">
                  {activeStep.points.map((pt, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-sys-accent shrink-0" />
                      <span>{pt}</span>
                    </li>
                  ))}
                </ul>

                {role === "student" && safeIdx === 0 && (
                  <div className="flex items-center justify-between rounded-xl border border-sys-border bg-sys-bg px-3 py-2 text-xs">
                    <span className="font-semibold text-sys-text-secondary truncate mr-2">
                      {isLinked ? `✓ Пошту прив'язано: ${linkedEmail}` : "Пошту @kre.dp.ua ще не підключено"}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        setTimeout(() => window.dispatchEvent(new CustomEvent("trigger-classroom-sync")), 120);
                      }}
                      className="shrink-0 rounded-lg bg-sys-accent px-3 py-1.5 text-[11px] font-bold text-white hover:opacity-95 active:scale-95 transition-opacity cursor-pointer"
                    >
                      {isLinked ? "Синхронізувати" : "Прив'язати →"}
                    </button>
                  </div>
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
                              : "bg-sys-card text-sys-text-secondary border border-sys-border hover:text-sys-text-primary"
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
                    className="w-full rounded-xl bg-sys-accent py-2.5 text-xs font-bold text-white hover:opacity-95 active:scale-[0.99] transition-opacity cursor-pointer"
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
                    className="w-full rounded-xl bg-sys-accent/15 border border-sys-accent/35 py-2 text-xs font-bold text-sys-accent hover:bg-sys-accent/25 active:scale-[0.99] transition-colors cursor-pointer"
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
            disabled={safeIdx === 0}
            onClick={() => goToStep(Math.max(0, safeIdx - 1))}
            className="rounded-xl border border-sys-border bg-sys-card px-3.5 py-2 text-xs font-semibold text-sys-text-secondary hover:text-sys-text-primary disabled:opacity-40 disabled:pointer-events-none active:scale-95 transition-colors cursor-pointer"
          >
            ← Назад
          </button>

          <span className="text-xs font-semibold text-sys-text-muted">
            Розділ {safeIdx + 1} із {stepsCount}
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
