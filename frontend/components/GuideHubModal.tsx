"use client";

import React, { useEffect, useState, startTransition } from "react";
import { useRouter } from "next/navigation";
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

interface PromoScene {
  id: string;
  badge: string;
  title: string;
  caption: string;
}

const SCENE_DURATION_MS = 5600;
const TICK_MS = 80;

const STUDENT_SCENES: PromoScene[] = [
  {
    id: "st-sync",
    badge: "01 • Автоматика",
    title: "Підключи @kre.dp.ua один раз — все інше робить сервер",
    caption:
      "Кожні 10 хвилин система сама перевіряє Google Classroom і додає нові посилання на пари, завдання та оцінки на всі ваші пристрої.",
  },
  {
    id: "st-subgroup",
    badge: "02 • Персоналізація",
    title: "Лише ваша підгрупа, ваш викладач і ваш кабінет",
    caption:
      "Один тап по бейджу «1 підгр.» або «2 підгр.» на картці пари прибирає чужу підгрупу та чужі завдання з усього розкладу.",
  },
  {
    id: "st-zoom",
    badge: "03 • Розумні дзвінки",
    title: "Авто-посилання Zoom та миттєве копіювання коду",
    caption:
      "Навіть якщо викладач скинув лише текстовий ID та пароль, сайт сам створить кнопку Zoom і скопіює код доступу при кліку.",
  },
  {
    id: "st-tasks",
    badge: "04 • Контроль навчання",
    title: "Усі дедлайни, борги та середній бал без гортання тижнів",
    caption:
      "Жодних прихованих списків: усі завдання поділені на «До здачі», «Борги» і «Здано», а оцінки автоматично переводяться у 12/5-бальну шкалу.",
  },
  {
    id: "st-offline",
    badge: "05 • Автономність",
    title: "Миттєвий запуск під час блекаутів та слабкого 2G",
    caption:
      "Розклад і завдання кешуються в пам'яті телефона. Додайте сайт на головний екран — і він відкриватиметься навіть без інтернету.",
  },
];

const TEACHER_SCENES: PromoScene[] = [
  {
    id: "tc-pin",
    badge: "01 • Захищений доступ",
    title: "Єдиний PIN-ключ до всіх онлайн-пар коледжу",
    caption:
      "Посилання приховані від сторонніх гостей замочком 🔒. Введіть PIN викладача один раз — і заходьте на Meet та Zoom у будь-якій групі.",
  },
  {
    id: "tc-jump",
    badge: "02 • Швидка навігація",
    title: "Перехід у розклад будь-якої групи прямо з картки пари",
    caption:
      "Натисніть на номер групи на своїй парі, щоб миттєво подивитися її повний розклад на день або тиждень і повернутися назад у 1 клік.",
  },
  {
    id: "tc-share",
    badge: "03 • Для кураторів",
    title: "Генерація красивої PNG-картинки розкладу для Telegram",
    caption:
      "Більше не треба робити скріншоти: одна кнопка створює чітку картку розкладу дня або готовий текст для чату зі студентами.",
  },
  {
    id: "tc-smart",
    badge: "04 • Розумний таймлайн",
    title: "Авто-перехід на завтра після 15:20 та події сесії",
    caption:
      "Після закінчення 4-ї пари розклад сам показує пари на завтра, підсвічуючи разові заміни, перенесення, іспити та консультації.",
  },
  {
    id: "tc-offline",
    badge: "05 • Автономність",
    title: "Ваш розклад завжди під рукою — навіть без світла",
    caption:
      "Встановіть веб-додаток на смартфон за 5 секунд: він працює без інтернету та миттєво синхронізує зміни при появі мережі.",
  },
];

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
  const [sceneIdx, setSceneIdx] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  // Читаємо поточний режим при відкритті
  useEffect(() => {
    if (!isOpen || typeof window === "undefined") return;
    setSceneIdx(0);
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

  // Автоматичний таймер Story-плеєра
  useEffect(() => {
    if (!isOpen || isPaused) return;
    const timer = setInterval(() => {
      setElapsedMs((prev) => {
        const next = prev + TICK_MS;
        if (next >= SCENE_DURATION_MS) {
          setSceneIdx((cur) => (cur + 1) % 5);
          return 0;
        }
        return next;
      });
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [isOpen, isPaused]);

  // Клавіатурна навігація
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === " ") {
        e.preventDefault();
        setIsPaused((p) => !p);
      }
      if (e.key === "ArrowRight") {
        setSceneIdx((c) => (c + 1) % 5);
        setElapsedMs(0);
      }
      if (e.key === "ArrowLeft") {
        setSceneIdx((c) => (c - 1 + 5) % 5);
        setElapsedMs(0);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const scenes = role === "student" ? STUDENT_SCENES : TEACHER_SCENES;
  const activeScene = scenes[sceneIdx] ?? scenes[0];
  const progressRatio = Math.min(1, elapsedMs / SCENE_DURATION_MS);

  // Внутрішня фаза сцени: 0 -> 1 -> 2 -> 3 (змінюється кожні ~1.35 сек для анімації дій у кадрі)
  const subPhase = Math.min(3, Math.floor((elapsedMs / SCENE_DURATION_MS) * 4));

  const jumpToScene = (idx: number) => {
    startTransition(() => {
      setSceneIdx(idx);
      setElapsedMs(0);
    });
  };

  const switchRole = (nextRole: "student" | "teacher") => {
    startTransition(() => {
      setRole(nextRole);
      setSceneIdx(0);
      setElapsedMs(0);
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/85 sm:bg-black/75 sm:backdrop-blur-xs p-0 sm:p-4 animate-in fade-in duration-150"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="promo-reel-title"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-lg max-h-[94dvh] sm:max-h-[88vh] flex flex-col rounded-t-3xl sm:rounded-3xl border border-sys-border bg-sys-card text-sys-text-primary shadow-2xl overflow-hidden select-none"
      >
        {/* =========================================================
            STORY PROGRESS BARS + TOP HEADER
           ========================================================= */}
        <div className="px-4 pt-3.5 pb-3 bg-sys-surface border-b border-sys-border space-y-3 shrink-0">
          {/* 5 Story Progress Bars */}
          <div className="grid grid-cols-5 gap-1.5" role="tablist" aria-label="Сцени промо-ролика">
            {scenes.map((s, idx) => {
              const scale = idx < sceneIdx ? 1 : idx === sceneIdx ? progressRatio : 0;
              return (
                <button
                  key={s.id}
                  type="button"
                  role="tab"
                  aria-selected={idx === sceneIdx}
                  aria-label={s.title}
                  onClick={() => jumpToScene(idx)}
                  className="group py-1 cursor-pointer focus:outline-none"
                >
                  <div className="h-1.5 w-full rounded-full bg-sys-border/80 overflow-hidden">
                    <div
                      className="h-full w-full bg-sys-accent origin-left transform-gpu will-change-transform transition-transform duration-75 ease-linear"
                      style={{ transform: `scaleX(${scale})` }}
                    />
                  </div>
                </button>
              );
            })}
          </div>

          {/* Role Toggle + Play/Pause + Close */}
          <div className="flex items-center justify-between gap-2">
            {/* Role Pill Switcher */}
            <div className="relative inline-grid grid-cols-2 rounded-xl border border-sys-border bg-sys-bg p-0.5 text-xs font-semibold isolate">
              <div
                aria-hidden="true"
                className="absolute top-0.5 bottom-0.5 pointer-events-none transition-transform duration-150 ease-out transform-gpu will-change-transform z-0"
                style={{
                  left: "2px",
                  width: "calc((100% - 4px) / 2)",
                  transform: `translate3d(${role === "teacher" ? "100%" : "0%"}, 0, 0)`,
                }}
              >
                <div className="h-full w-full rounded-lg bg-sys-accentSolid shadow-2xs" />
              </div>
              <button
                type="button"
                onClick={() => switchRole("student")}
                className={`relative z-10 px-3 py-1 rounded-lg transition-colors cursor-pointer ${
                  role === "student" ? "text-white font-bold" : "text-sys-text-secondary hover:text-sys-text-primary"
                }`}
              >
                🎓 Студент
              </button>
              <button
                type="button"
                onClick={() => switchRole("teacher")}
                className={`relative z-10 px-3 py-1 rounded-lg transition-colors cursor-pointer ${
                  role === "teacher" ? "text-white font-bold" : "text-sys-text-secondary hover:text-sys-text-primary"
                }`}
              >
                👨‍🏫 Викладач
              </button>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setIsPaused((p) => !p)}
                title={isPaused ? "Продовжити" : "Пауза"}
                aria-label={isPaused ? "Продовжити показ" : "Поставити на паузу"}
                className="flex h-8 px-2.5 items-center gap-1 rounded-lg border border-sys-border bg-sys-bg text-xs font-semibold text-sys-text-secondary hover:text-sys-text-primary active:scale-95 transition-all cursor-pointer"
              >
                <span>{isPaused ? "▶" : "⏸"}</span>
                <span className="hidden sm:inline">{isPaused ? "Грати" : "Пауза"}</span>
              </button>
              <button
                type="button"
                onClick={onClose}
                aria-label="Закрити"
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-sys-border bg-sys-bg text-sys-text-secondary hover:text-sys-text-primary active:scale-95 transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>
          </div>
        </div>

        {/* =========================================================
            ANIMATED STAGE (DYNAMIC VISUAL SHOWCASE)
           ========================================================= */}
        <div
          onClick={() => setIsPaused((p) => !p)}
          title="Натисніть на сцену, щоб поставити на паузу / продовжити"
          className="relative mx-4 mt-4 h-[230px] sm:h-[245px] rounded-2xl border border-sys-border bg-sys-bg overflow-hidden flex flex-col items-center justify-center p-4 cursor-pointer shrink-0"
          style={{
            backgroundImage:
              "radial-gradient(circle at 50% 0%, rgb(var(--sys-accent) / 0.14), transparent 70%)",
          }}
        >
          {/* ---------------- STUDENT SCENE 1: AUTO-SYNC ---------------- */}
          {role === "student" && sceneIdx === 0 && (
            <div className="w-full max-w-sm space-y-2.5">
              {/* Account pill */}
              <div className="flex items-center justify-between rounded-xl border border-sys-border bg-sys-card px-3 py-2 shadow-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-bold">
                    G
                  </span>
                  <span className="text-xs font-bold text-sys-text-primary truncate">
                    student@kre.dp.ua
                  </span>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold transition-all duration-300 ${
                    subPhase >= 1
                      ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                      : "bg-sys-accent/20 text-sys-accent"
                  }`}
                >
                  {subPhase === 0 ? "🔄 Пошук курсів..." : "✓ Синхронізовано"}
                </span>
              </div>

              {/* Animated Lesson Card receiving Meet & HW automatically */}
              <div className="rounded-xl border border-sys-border bg-sys-card p-3 shadow-sm space-y-2 transition-all duration-300">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <span className="text-[10px] font-bold text-sys-accent uppercase">1 пара • 09:00</span>
                    <p className="text-xs sm:text-sm font-bold text-sys-text-primary">Вища математика</p>
                  </div>

                  {/* Meet badge pops in at subPhase >= 1 */}
                  <div
                    className={`transition-all duration-300 transform-gpu ${
                      subPhase >= 1 ? "opacity-100 scale-100" : "opacity-0 scale-75"
                    }`}
                  >
                    <span className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/20 px-2.5 py-1 text-xs font-bold text-emerald-300 shadow-xs">
                      📹 Meet ↗
                    </span>
                  </div>
                </div>

                {/* Homework strip pops in at subPhase >= 2 */}
                <div
                  className={`flex items-center justify-between rounded-lg border border-purple-500/30 bg-purple-500/10 px-2.5 py-1.5 text-[11px] transition-all duration-300 transform-gpu ${
                    subPhase >= 2 ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
                  }`}
                >
                  <span className="font-semibold text-sys-text-primary truncate">
                    📋 Практична робота №5
                  </span>
                  <span className="text-purple-300 font-bold shrink-0 ml-2">до завтра ↗</span>
                </div>
              </div>

              {/* Multi-device sync indicator at subPhase === 3 */}
              <div
                className={`flex items-center justify-center gap-2 text-[11px] font-semibold text-emerald-400 transition-opacity duration-300 ${
                  subPhase >= 3 ? "opacity-100" : "opacity-0"
                }`}
              >
                <span>💻 ПК</span>
                <span>⟷</span>
                <span>📱 Смартфон (оновлено у фоні)</span>
              </div>
            </div>
          )}

          {/* ---------------- STUDENT SCENE 2: SUBGROUP FILTER ---------------- */}
          {role === "student" && sceneIdx === 1 && (
            <div className="w-full max-w-sm space-y-2.5">
              <div className="rounded-xl border border-sys-border bg-sys-card p-3.5 shadow-sm space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs sm:text-sm font-bold text-sys-text-primary">
                    Іноземна мова (за проф. спрямуванням)
                  </span>
                  <span className="text-[10px] font-semibold text-sys-text-muted shrink-0">2 пара</span>
                </div>

                {/* Subgroup 1 row (Selected in subPhase 1 & 2) */}
                <div className="flex items-center justify-between gap-2 rounded-lg bg-sys-bg/60 p-2 border border-sys-border/60">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`relative inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-bold transition-all duration-300 ${
                        subPhase === 1 || subPhase === 2
                          ? "border-sys-accent bg-sys-accent text-white scale-105 shadow-xs"
                          : "border-sys-border bg-sys-card text-sys-text-secondary"
                      }`}
                    >
                      <span>1 підгр.</span>
                      {subPhase === 1 && (
                        <span className="absolute -right-1 -top-1 flex h-3 w-3">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sys-accent opacity-75" />
                          <span className="relative inline-flex rounded-full h-3 w-3 bg-white" />
                        </span>
                      )}
                    </span>
                    <span className="text-xs font-medium text-sys-text-primary truncate">
                      Токарєва О.В.
                    </span>
                  </div>
                  <span className="rounded-md border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[11px] font-bold text-emerald-400">
                    Meet ↗
                  </span>
                </div>

                {/* Subgroup 2 row (Collapses when Subgroup 1 is active) */}
                <div
                  className={`flex items-center justify-between gap-2 rounded-lg bg-sys-bg/40 p-2 border border-sys-border/40 transition-all duration-300 transform-gpu ${
                    subPhase === 1 || subPhase === 2
                      ? "opacity-20 scale-95 line-through"
                      : "opacity-100 scale-100"
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="rounded-md border border-sys-border bg-sys-card px-2 py-0.5 text-xs font-semibold text-sys-text-muted">
                      2 підгр.
                    </span>
                    <span className="text-xs text-sys-text-muted truncate">Хочинська І.В.</span>
                  </div>
                  <span className="text-[11px] text-sys-text-muted">ауд. 204</span>
                </div>
              </div>

              <div className="text-center text-[11px] font-semibold text-sys-accent">
                {subPhase === 1 || subPhase === 2
                  ? "✨ Показано лише 1-шу підгрупу та її завдання!"
                  : "Натисніть на свою підгрупу прямо на картці пари"}
              </div>
            </div>
          )}

          {/* ---------------- STUDENT SCENE 3: ZOOM AUTO-LINK & PASSCODE ---------------- */}
          {role === "student" && sceneIdx === 2 && (
            <div className="w-full max-w-sm space-y-2.5">
              {/* Step 1: Raw teacher message morphing into smart button */}
              <div className="rounded-xl border border-sys-border bg-sys-card p-3 shadow-xs space-y-2">
                <div className="flex items-center justify-between text-[10px] text-sys-text-muted">
                  <span>Повідомлення викладача в Classroom:</span>
                  <span className="text-sys-accent font-bold">Авто-розпізнавання</span>
                </div>
                <div className="rounded-lg bg-sys-bg px-2.5 py-1.5 font-mono text-[11px] text-sys-text-secondary">
                  Ідентифікатор: <span className="text-sys-text-primary font-bold">823 4567 8901</span> • Код:{" "}
                  <span className="text-sky-400 font-bold">dfkr</span>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <span className="text-xs font-bold text-sys-text-primary">Електроніка</span>
                  <div
                    className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold transition-all duration-300 transform-gpu ${
                      subPhase >= 1
                        ? "border-sky-400 bg-sky-500/25 text-sky-200 scale-105 shadow-sm"
                        : "border-sys-border bg-sys-bg text-sys-text-secondary"
                    }`}
                  >
                    <span>📹 Zoom · код: dfkr ↗</span>
                  </div>
                </div>
              </div>

              {/* Step 2: Toast notification on click */}
              <div
                className={`rounded-xl border border-emerald-500/40 bg-emerald-500/20 px-3 py-2 text-xs font-bold text-emerald-300 flex items-center justify-center gap-2 shadow-md transition-all duration-300 transform-gpu ${
                  subPhase >= 2 ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3"
                }`}
              >
                <span>✓</span>
                <span>Код доступу Zoom (dfkr) скопійовано в буфер!</span>
              </div>
            </div>
          )}

          {/* ---------------- STUDENT SCENE 4: TASKS & GRADES ---------------- */}
          {role === "student" && sceneIdx === 3 && (
            <div className="w-full max-w-sm space-y-2.5">
              {/* Top 3 Pills */}
              <div className="grid grid-cols-3 gap-1 rounded-xl border border-sys-border bg-sys-card p-1 text-[11px] font-bold">
                <div
                  className={`rounded-lg py-1.5 text-center transition-colors duration-200 ${
                    subPhase <= 1 ? "bg-sys-accentSolid text-white" : "text-sys-text-secondary"
                  }`}
                >
                  До здачі (3)
                </div>
                <div
                  className={`rounded-lg py-1.5 text-center transition-colors duration-200 ${
                    subPhase === 2 ? "bg-rose-600 text-white" : "text-rose-400"
                  }`}
                >
                  Борги (1)
                </div>
                <div
                  className={`rounded-lg py-1.5 text-center transition-colors duration-200 ${
                    subPhase === 3 ? "bg-emerald-600 text-white" : "text-emerald-400"
                  }`}
                >
                  Здано (18)
                </div>
              </div>

              {/* Dynamic Content Box */}
              <div className="rounded-xl border border-sys-border bg-sys-card p-3 shadow-xs space-y-2">
                {subPhase <= 1 && (
                  <div className="space-y-1.5 animate-in fade-in duration-150">
                    <div className="flex items-center justify-between text-xs font-bold">
                      <span className="text-sys-text-primary">Лабораторна робота №4</span>
                      <span className="text-amber-400">Завтра</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-sys-text-secondary">
                      <span>Комп&apos;ютерна схемотехніка</span>
                      <span>Без перемикання тижнів ✓</span>
                    </div>
                  </div>
                )}

                {subPhase === 2 && (
                  <div className="space-y-1.5 animate-in fade-in duration-150">
                    <div className="flex items-center justify-between text-xs font-bold">
                      <span className="text-sys-text-primary">Практичне завдання №2</span>
                      <span className="text-rose-400">прострочено 4 дні</span>
                    </div>
                    <p className="text-[11px] text-sys-text-secondary">
                      Усі нездані роботи за семестр зібрані в одному місці
                    </p>
                  </div>
                )}

                {subPhase === 3 && (
                  <div className="flex items-center justify-between gap-2 animate-in fade-in duration-150">
                    <div>
                      <p className="text-xs font-bold text-sys-text-primary">Середній бал за семестр</p>
                      <p className="text-[11px] text-sys-text-secondary">94/100 → авто-перерахунок у 12-бальну</p>
                    </div>
                    <span className="rounded-xl bg-emerald-500/20 border border-emerald-500/40 px-3 py-1.5 text-sm font-black text-emerald-300">
                      11 балів
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ---------------- TEACHER SCENE 1: PIN UNLOCK ---------------- */}
          {role === "teacher" && sceneIdx === 0 && (
            <div className="w-full max-w-sm space-y-2.5">
              {/* PIN Input Animation */}
              <div className="flex items-center justify-between rounded-xl border border-sys-border bg-sys-card px-3.5 py-2">
                <span className="text-xs font-bold text-sys-text-secondary">PIN викладача:</span>
                <div className="flex items-center gap-1.5">
                  {[0, 1, 2, 3].map((dot) => (
                    <span
                      key={dot}
                      className={`h-2.5 w-2.5 rounded-full transition-all duration-200 ${
                        subPhase >= 1 ? "bg-emerald-400 scale-110" : "bg-sys-border"
                      }`}
                    />
                  ))}
                  <span
                    className={`ml-1.5 text-[11px] font-bold ${
                      subPhase >= 1 ? "text-emerald-400" : "text-amber-400"
                    }`}
                  >
                    {subPhase >= 1 ? "Відкрито ✓" : "Введення..."}
                  </span>
                </div>
              </div>

              {/* Lesson cards unlocking */}
              <div className="space-y-2">
                {[
                  { grp: "Група КІ-24-2/9-85", plat: "Meet", tone: "emerald" },
                  { grp: "Група ТР-25-1/9-87", plat: "Zoom", tone: "sky" },
                ].map((item, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between rounded-xl border border-sys-border bg-sys-card px-3 py-2 shadow-2xs"
                  >
                    <span className="text-xs font-bold text-sys-text-primary">{item.grp}</span>
                    {subPhase >= 1 ? (
                      <span
                        className={`rounded-lg border px-2.5 py-1 text-xs font-bold animate-in zoom-in-95 duration-200 ${
                          item.tone === "emerald"
                            ? "border-emerald-500/40 bg-emerald-500/20 text-emerald-300"
                            : "border-sky-500/40 bg-sky-500/20 text-sky-300"
                        }`}
                      >
                        📹 {item.plat} ↗
                      </span>
                    ) : (
                      <span className="rounded-lg border border-amber-500/40 bg-amber-500/15 px-2.5 py-1 text-xs font-bold text-amber-300">
                        🔒 {item.plat}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ---------------- TEACHER SCENE 2: QUICK JUMP TO GROUP ---------------- */}
          {role === "teacher" && sceneIdx === 1 && (
            <div className="w-full max-w-sm space-y-2.5">
              {subPhase <= 1 ? (
                <div className="rounded-xl border border-sys-border bg-sys-card p-3.5 space-y-2.5 shadow-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase text-sys-accent">Розклад викладача</span>
                    <span className="text-[11px] text-sys-text-muted">2 пара • ауд. 305</span>
                  </div>
                  <p className="text-sm font-bold text-sys-text-primary">Комп&apos;ютерна схемотехніка</p>
                  <div className="flex items-center justify-between pt-1">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-bold transition-all duration-300 ${
                        subPhase === 1
                          ? "border-sys-accent bg-sys-accent text-white scale-105 shadow-sm"
                          : "border-sys-accent/40 bg-sys-accent/10 text-sys-accent"
                      }`}
                    >
                      <span>👥 Група: КІ-24-2/9-85 · 1 підгр.</span>
                    </span>
                    <span className="text-[11px] text-sys-text-muted">👈 Клік</span>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-sys-accent/50 bg-sys-card p-3 space-y-2 shadow-md animate-in fade-in duration-200">
                  <div className="flex items-center justify-between rounded-lg bg-sys-accent/15 px-2.5 py-1.5">
                    <span className="text-xs font-bold text-sys-text-primary">
                      Група <span className="text-sys-accent">КІ-24-2/9-85</span>
                    </span>
                    <span className="rounded-md bg-sys-accent px-2 py-0.5 text-[10px] font-bold text-white">
                      ← До викладача
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                    <div className="rounded-lg bg-sys-bg p-2 border border-sys-border/60">
                      <span className="text-sys-text-muted">1 пара:</span>{" "}
                      <strong className="text-sys-text-primary">Вища матем.</strong>
                    </div>
                    <div className="rounded-lg bg-sys-bg p-2 border border-sys-accent/40">
                      <span className="text-sys-accent">2 пара:</span>{" "}
                      <strong className="text-sys-text-primary">Схемотехніка</strong>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ---------------- TEACHER SCENE 3: PNG & TELEGRAM SHARE ---------------- */}
          {role === "teacher" && sceneIdx === 2 && (
            <div className="w-full max-w-sm space-y-2.5">
              <div className="flex items-center justify-between rounded-xl border border-sys-border bg-sys-card px-3.5 py-2.5">
                <div>
                  <p className="text-xs font-bold text-sys-text-primary">Четвер, 12 листопада</p>
                  <p className="text-[10px] text-sys-text-secondary">Експорт розкладу дня в 1 клік</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <span
                    className={`flex h-9 w-9 items-center justify-center rounded-xl border text-sm transition-all duration-300 ${
                      subPhase >= 1
                        ? "border-sys-accent bg-sys-accent text-white scale-110 shadow-sm"
                        : "border-sys-border bg-sys-bg text-sys-text-secondary"
                    }`}
                  >
                    🖼️
                  </span>
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-sys-border bg-sys-bg text-sm">
                    📋
                  </span>
                </div>
              </div>

              {/* Generated PNG Card Preview */}
              <div
                className={`rounded-xl border border-emerald-500/40 bg-emerald-500/15 p-3 text-xs transition-all duration-300 transform-gpu ${
                  subPhase >= 1 ? "opacity-100 translate-y-0" : "opacity-40 translate-y-2"
                }`}
              >
                <div className="flex items-center justify-between font-bold text-emerald-300">
                  <span>✓ PNG-картинку розкладу згенеровано!</span>
                  <span>1080×1350</span>
                </div>
                <p className="text-[11px] text-sys-text-secondary mt-1">
                  Готово до вставки (Ctrl+V) у Telegram-чат кураторської групи або збереження в телефон.
                </p>
              </div>
            </div>
          )}

          {/* ---------------- TEACHER SCENE 4: 15:20 AUTO-TOMORROW & EVENTS ---------------- */}
          {role === "teacher" && sceneIdx === 3 && (
            <div className="w-full max-w-sm space-y-2.5">
              <div className="flex items-center justify-between rounded-xl border border-sys-border bg-sys-card px-3 py-2 text-xs">
                <span className="font-semibold text-sys-text-secondary">Час після 4-ї пари:</span>
                <span className="rounded-lg bg-sys-accent/20 border border-sys-accent/40 px-2.5 py-0.5 font-mono font-bold text-sys-accent">
                  {subPhase === 0 ? "15:19 • Сьогодні" : "15:20 → Авто-перехід на Завтра"}
                </span>
              </div>

              <div className="rounded-xl border border-sys-border bg-sys-card p-3 space-y-2 shadow-xs">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-sys-text-primary">
                    {subPhase === 0 ? "Середа (пари завершено)" : "Четвер (розклад на завтра)"}
                  </span>
                  <div className="flex items-center gap-1">
                    <span className="rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-950">
                      ⚡ Заміна
                    </span>
                    <span className="rounded border border-rose-500/40 bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-bold text-rose-300">
                      📝 Іспит
                    </span>
                  </div>
                </div>
                <p className="text-[11px] text-sys-text-secondary">
                  Усі разові заміни, перенесення та сесійні події миттєво синхронізуються з базою коледжу.
                </p>
              </div>
            </div>
          )}

          {/* ---------------- SHARED SCENE 5: OFFLINE PWA ---------------- */}
          {sceneIdx === 4 && (
            <div className="w-full max-w-sm space-y-2.5">
              <div className="flex items-center justify-between rounded-xl border border-amber-500/40 bg-amber-500/15 px-3 py-2 text-xs font-bold text-amber-300">
                <span className="flex items-center gap-1.5">
                  <span>📡</span>
                  <span>Немає інтернету • Офлайн-режим</span>
                </span>
                <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] text-emerald-300">
                  Завантажено за 0.15 с
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div className="rounded-xl border border-sys-border bg-sys-card p-2.5 space-y-1">
                  <p className="font-bold text-sys-text-primary">🍎 iPhone (Safari)</p>
                  <p className="text-sys-text-secondary leading-snug">
                    Натисніть <strong>«Поділитися»</strong> → <strong>«На початковий екран»</strong>
                  </p>
                </div>
                <div className="rounded-xl border border-sys-border bg-sys-card p-2.5 space-y-1">
                  <p className="font-bold text-sys-text-primary">🤖 Android (Chrome)</p>
                  <p className="text-sys-text-secondary leading-snug">
                    Меню <strong>«⋮»</strong> → <strong>«Встановити додаток»</strong>
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* =========================================================
            SCENE DESCRIPTION & QUICK ACTION BAR
           ========================================================= */}
        <div className="p-4 space-y-3.5">
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-sys-accent">
                {activeScene.badge}
              </span>
              <span className="text-[11px] text-sys-text-muted">
                {sceneIdx + 1} / {scenes.length}
              </span>
            </div>
            <h3 id="promo-reel-title" className="text-base font-bold text-sys-text-primary leading-snug">
              {activeScene.title}
            </h3>
            <p className="text-xs text-sys-text-secondary leading-relaxed">
              {activeScene.caption}
            </p>
          </div>

          {/* Contextual Instant Action inside current scene */}
          {role === "student" && sceneIdx === 0 && !isLinked && (
            <button
              type="button"
              onClick={() => {
                onClose();
                setTimeout(() => window.dispatchEvent(new CustomEvent("trigger-classroom-sync")), 120);
              }}
              className="w-full rounded-xl bg-sys-accent py-2.5 text-xs font-bold text-white shadow-sm hover:opacity-95 active:scale-[0.99] transition-all cursor-pointer"
            >
              🎓 Прив&apos;язати пошту @kre.dp.ua зараз →
            </button>
          )}

          {role === "student" && sceneIdx === 1 && (
            <div className="flex items-center justify-between rounded-xl border border-sys-border bg-sys-bg px-3 py-2 text-xs">
              <span className="font-semibold text-sys-text-secondary">Обрати свою підгрупу зараз:</span>
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

          {role === "teacher" && sceneIdx === 0 && !isTeacherUnlocked && (
            <button
              type="button"
              onClick={() => {
                onClose();
                router.push("/settings?mode=teacher");
              }}
              className="w-full rounded-xl bg-sys-accent py-2.5 text-xs font-bold text-white shadow-sm hover:opacity-95 active:scale-[0.99] transition-all cursor-pointer"
            >
              🔑 Ввести PIN-код викладача в Налаштуваннях →
            </button>
          )}

          {/* Bottom Controls: Prev / Dots / Next */}
          <div className="flex items-center justify-between gap-2 pt-1 border-t border-sys-border/60">
            <button
              type="button"
              onClick={() => jumpToScene((sceneIdx - 1 + scenes.length) % scenes.length)}
              className="rounded-xl border border-sys-border bg-sys-bg px-3.5 py-2 text-xs font-semibold text-sys-text-secondary hover:text-sys-text-primary active:scale-95 transition-all cursor-pointer"
            >
              ← Попередня
            </button>

            <button
              type="button"
              onClick={onClose}
              className="text-xs font-semibold text-sys-text-muted hover:text-sys-text-primary px-2 py-1 cursor-pointer"
            >
              Закрити
            </button>

            <button
              type="button"
              onClick={() => {
                if (sceneIdx === scenes.length - 1) {
                  onClose();
                } else {
                  jumpToScene(sceneIdx + 1);
                }
              }}
              className="rounded-xl bg-sys-accent px-4 py-2 text-xs font-bold text-white hover:opacity-95 active:scale-95 transition-all cursor-pointer"
            >
              {sceneIdx === scenes.length - 1 ? "Готово ✓" : "Далі →"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
