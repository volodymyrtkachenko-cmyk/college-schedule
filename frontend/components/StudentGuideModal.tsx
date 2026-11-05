"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

export interface StudentGuideModalProps {
  isOnboarding?: boolean;
  onClose: () => void;
  onComplete?: () => void;
}

interface StepItem {
  id: string;
  shortTitle: string;
  icon: string;
  fullTitle: string;
  subtitle: string;
}

const STEPS: StepItem[] = [
  {
    id: "subgroups",
    shortTitle: "Група і підгрупи",
    icon: "👥",
    fullTitle: "Твоя група та підгрупи",
    subtitle: "Розклад одразу налаштовується під твою групу та фільтрує потрібні пари.",
  },
  {
    id: "schedule",
    shortTitle: "Розклад і дзвінки",
    icon: "⏱️",
    fullTitle: "Дні тижня та «жива» пара",
    subtitle: "Застосунок відстежує київський час і підсвічує пару, яка триває зараз.",
  },
  {
    id: "online",
    shortTitle: "Онлайн-пари",
    icon: "💻",
    fullTitle: "Дистанційні пари та Meet",
    subtitle: "Прямі посилання на відеодзвінки захищені й доступні студентам своєї групи.",
  },
  {
    id: "homework",
    shortTitle: "Завдання Classroom",
    icon: "📋",
    fullTitle: "Домашні завдання та оцінки",
    subtitle: "Завдання синхронізуються з Classroom автоматично без ручних позначок.",
  },
  {
    id: "personalization",
    shortTitle: "Теми і кольори",
    icon: "🎨",
    fullTitle: "Налаштування та кольори",
    subtitle: "Підбирай світлий/темний режим та один із 6 колірних акцентів під настрій.",
  },
  {
    id: "install",
    shortTitle: "Встановлення PWA",
    icon: "📲",
    fullTitle: "Додаток та робота офлайн",
    subtitle: "Розклад зберігається на пристрої й відкривається навіть без доступу до інтернету.",
  },
];

export function StudentGuideModal({ isOnboarding = false, onClose, onComplete }: StudentGuideModalProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [isDesktop, setIsDesktop] = useState(false);

  // Auto-detect screen size
  useEffect(() => {
    const checkScreen = () => {
      setIsDesktop(window.innerWidth >= 768);
    };
    checkScreen();
    window.addEventListener("resize", checkScreen);
    return () => window.removeEventListener("resize", checkScreen);
  }, []);

  const totalSteps = STEPS.length;

  const handleNext = () => {
    if (currentStep < totalSteps - 1) {
      setCurrentStep((prev) => prev + 1);
    } else {
      handleFinish();
    }
  };

  const handlePrev = () => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1);
    }
  };

  const handleFinish = () => {
    if (isOnboarding && onComplete) {
      onComplete();
    } else {
      onClose();
    }
  };

  // Demo 1 State (Subgroup: null = both, 1 = 1st, 2 = 2nd)
  const [demoSubgroup, setDemoSubgroup] = useState<null | 1 | 2>(null);

  // Demo 2 State (Day tabs)
  const [demoDay, setDemoDay] = useState<"Пн" | "Вт" | "Ср" | "Чт" | "Пт">("Пн");

  // Demo 3 State (Online meet link)
  const [demoLinked, setDemoLinked] = useState(false);
  const [demoToast, setDemoToast] = useState("");

  // Demo 4 State (Homework accordion)
  const [demoActiveHwOpen, setDemoActiveHwOpen] = useState(false);
  const [demoDoneHwOpen, setDemoDoneHwOpen] = useState(false);

  // Demo 5 State (Accent preview)
  const [demoAccent, setDemoAccent] = useState<"ocean" | "emerald" | "amethyst" | "amber" | "sakura" | "lagoon">("ocean");

  // Demo 6 State (Real PWA Install Prompt)
  const [pwaPrompt, setPwaPrompt] = useState<any>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [pwaFeedback, setPwaFeedback] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;

    const standalone =
      ("standalone" in window.navigator && (window.navigator as any).standalone === true) ||
      window.matchMedia("(display-mode: standalone)").matches;
    setIsStandalone(standalone);

    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent || "");
    setIsIos(ios);

    const handleBeforeInstall = (e: any) => {
      e.preventDefault();
      setPwaPrompt(e);
      (window as any).__pwaInstallEvent = e;
    };

    if ((window as any).__pwaInstallEvent) {
      setPwaPrompt((window as any).__pwaInstallEvent);
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    return () => window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
  }, []);

  const handleInstallClick = async () => {
    if (pwaPrompt) {
      try {
        await pwaPrompt.prompt();
        setPwaPrompt(null);
        (window as any).__pwaInstallEvent = null;
        setPwaFeedback("Дякуємо за встановлення! Додаток додано на ваш пристрій.");
      } catch (err) {
        console.error("Install prompt error:", err);
      }
    } else if (isStandalone) {
      setPwaFeedback("Застосунок уже встановлено на цьому пристрої! 👍");
    } else if (isIos) {
      setPwaFeedback("На iPhone натисніть «Поділитися» ⎋ у нижній панелі Safari, а потім — «На початковий екран» ⊞.");
    } else if (isDesktop) {
      setPwaFeedback("Натисніть на іконку ⊕ праворуч в адресному рядку браузера (Chrome / Edge), щоб закріпити розклад.");
    } else {
      setPwaFeedback("Відкрийте меню браузера (⋮) та оберіть «Встановити додаток» або «Додати на головний екран».");
    }
  };

  const accentColors = {
    ocean: { text: "text-sky-400", border: "border-sky-500/40", soft: "bg-sky-500/15" },
    emerald: { text: "text-emerald-400", border: "border-emerald-500/40", soft: "bg-emerald-500/15" },
    amethyst: { text: "text-purple-400", border: "border-purple-500/40", soft: "bg-purple-500/15" },
    amber: { text: "text-amber-400", border: "border-amber-500/40", soft: "bg-amber-500/15" },
    sakura: { text: "text-rose-400", border: "border-rose-500/40", soft: "bg-rose-500/15" },
    lagoon: { text: "text-teal-400", border: "border-teal-500/40", soft: "bg-teal-500/15" },
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-2 sm:p-5 backdrop-blur-md overflow-hidden animate-in fade-in duration-150">
      <div className="relative flex flex-col w-full max-w-4xl max-h-[94vh] sm:max-h-[88vh] rounded-3xl border border-sys-border bg-sys-card text-sys-text-primary shadow-2xl overflow-hidden">
        
        {/* Top Header */}
        <header className="flex items-center justify-between border-b border-sys-border/50 px-4 sm:px-6 py-3.5 bg-sys-card shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-sys-accent/15 text-lg">
              🎓
            </span>
            <div>
              <h2 className="text-sm sm:text-base font-bold leading-tight text-sys-text-primary">
                Гід студента
              </h2>
              <p className="text-[11px] text-sys-text-secondary">
                Розклад занять ДФКР
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isOnboarding ? (
              <button
                type="button"
                onClick={handleFinish}
                className="rounded-xl px-3 py-1.5 text-xs font-semibold text-sys-text-secondary hover:text-sys-text-primary hover:bg-sys-bg transition-colors"
              >
                Пропустити
              </button>
            ) : (
              <button
                type="button"
                onClick={onClose}
                aria-label="Закрити"
                className="flex h-8 w-8 items-center justify-center rounded-xl text-sys-text-secondary hover:text-sys-text-primary hover:bg-sys-bg transition-colors font-bold"
              >
                ✕
              </button>
            )}
          </div>
        </header>

        {/* Mobile Horizontal Section Tabs Strip (scrollable on small screens) */}
        <div className="md:hidden flex items-center gap-1.5 overflow-x-auto px-4 py-2 border-b border-sys-border/40 bg-sys-bg/60 shrink-0 no-scrollbar">
          {STEPS.map((step, idx) => (
            <button
              key={step.id}
              type="button"
              onClick={() => setCurrentStep(idx)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                currentStep === idx
                  ? "bg-sys-accent text-slate-900 shadow-xs font-bold"
                  : "bg-sys-card border border-sys-border text-sys-text-secondary hover:text-sys-text-primary"
              }`}
            >
              <span>{step.icon}</span>
              <span>{step.shortTitle}</span>
            </button>
          ))}
        </div>

        {/* Main Body Area: Sidebar (Desktop) + Content/Preview (Right) */}
        <div className="flex-1 flex overflow-hidden">
          
          {/* Desktop Left Sidebar: Direct Clickable Sections */}
          <aside className="hidden md:flex flex-col w-60 border-r border-sys-border/50 bg-sys-bg/40 p-3 space-y-1 shrink-0 overflow-y-auto">
            <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-sys-text-muted">
              Розділи інструкції
            </div>
            {STEPS.map((step, idx) => {
              const isActive = currentStep === idx;
              return (
                <button
                  key={step.id}
                  type="button"
                  onClick={() => setCurrentStep(idx)}
                  className={`flex items-center gap-2.5 w-full text-left px-3 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                    isActive
                      ? "bg-sys-accent/15 text-sys-accent font-bold border border-sys-accent/40 shadow-xs"
                      : "text-sys-text-secondary hover:text-sys-text-primary hover:bg-sys-card/70 border border-transparent"
                  }`}
                >
                  <span className="text-base shrink-0">{step.icon}</span>
                  <span className="truncate">{step.shortTitle}</span>
                </button>
              );
            })}
          </aside>

          {/* Right Content Area: Explanation & Interactive Preview */}
          <main className="flex-1 overflow-y-auto p-4 sm:p-6 custom-scrollbar flex flex-col justify-between">
            <AnimatePresence mode="wait">
              {/* STEP 0: Subgroups & Group */}
              {currentStep === 0 && (
                <motion.div
                  key="step0"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.15 }}
                  className="space-y-4"
                >
                  <div>
                    <h3 className="text-xl sm:text-2xl font-black text-sys-text-primary tracking-tight">
                      {STEPS[0].fullTitle}
                    </h3>
                    <p className="text-xs sm:text-sm text-sys-text-secondary mt-1">
                      {STEPS[0].subtitle}
                    </p>
                  </div>

                  {/* Bullet points */}
                  <div className="space-y-2 text-xs sm:text-sm text-sys-text-secondary">
                    <div className="flex items-start gap-2">
                      <span className="text-sys-accent font-bold mt-0.5">✦</span>
                      <span>
                        <strong>Фільтрація підгрупи:</strong> натискай кнопку <span className="font-semibold text-sky-400">1 підгр.</span> або <span className="font-semibold text-indigo-400">2 підгр.</span> прямо в картці пари — чужий викладач та аудиторія зникнуть.
                      </span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-sys-accent font-bold mt-0.5">✦</span>
                      <span>
                        <strong>Зміна групи або викладача:</strong> натисни на назву групи в шапці зверху, щоб відкрити пошук інших груп чи викладачів.
                      </span>
                    </div>
                  </div>

                  {/* Preview Card matching real LessonCard.tsx */}
                  <div className="rounded-2xl border border-sys-border bg-sys-bg p-4 sm:p-5 shadow-lg space-y-3">
                    <div className="flex items-start justify-between gap-4">
                      {/* Time Column */}
                      <div className="flex flex-col items-start pr-3 border-r border-sys-border/50 shrink-0">
                        <span className="text-2xl font-black leading-none text-sys-text-primary">1</span>
                        <span className="text-xs font-bold text-sys-text-primary mt-1">09:00</span>
                        <span className="text-[11px] text-sys-text-muted">10:20</span>
                      </div>

                      {/* Main Info */}
                      <div className="flex-1 min-w-0 space-y-2">
                        <div className="font-bold text-base text-sys-text-primary leading-tight">
                          Комп'ютерні мережі
                        </div>

                        {/* Dual Teachers List exactly as in LessonCard.tsx */}
                        <div className="flex flex-col gap-2 pt-0.5">
                          {(demoSubgroup === null || demoSubgroup === 1) && (
                            <div className="flex items-center justify-between gap-2 w-full">
                              <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                                <button
                                  type="button"
                                  onClick={() => setDemoSubgroup(demoSubgroup === 1 ? null : 1)}
                                  className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-bold border transition-colors ${
                                    demoSubgroup === 1
                                      ? "bg-sky-500/20 text-sky-400 border-sky-500/40"
                                      : "bg-sys-card border-sys-border text-slate-400 hover:text-slate-200"
                                  }`}
                                  title="Натисніть для фільтрації"
                                >
                                  1 підгр.
                                </button>
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-sys-text-muted shrink-0">
                                  <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                                  <circle cx="12" cy="7" r="4" />
                                </svg>
                                <span className="text-xs sm:text-sm font-medium text-sys-text-secondary truncate">
                                  Токарєва О.В.
                                </span>
                              </div>
                              <span className="shrink-0 rounded-md border border-sys-border bg-sys-card px-2 py-1 text-xs font-semibold text-sys-text-secondary">
                                ауд. 101
                              </span>
                            </div>
                          )}

                          {(demoSubgroup === null || demoSubgroup === 2) && (
                            <div className="flex items-center justify-between gap-2 w-full">
                              <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                                <button
                                  type="button"
                                  onClick={() => setDemoSubgroup(demoSubgroup === 2 ? null : 2)}
                                  className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-bold border transition-colors ${
                                    demoSubgroup === 2
                                      ? "bg-indigo-500/20 text-indigo-400 border-indigo-500/40"
                                      : "bg-sys-card border-sys-border text-slate-400 hover:text-slate-200"
                                  }`}
                                  title="Натисніть для фільтрації"
                                >
                                  2 підгр.
                                </button>
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-sys-text-muted shrink-0">
                                  <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                                  <circle cx="12" cy="7" r="4" />
                                </svg>
                                <span className="text-xs sm:text-sm font-medium text-sys-text-secondary truncate">
                                  Хочинська В.В.
                                </span>
                              </div>
                              <span className="shrink-0 rounded-md border border-sys-border bg-sys-card px-2 py-1 text-xs font-semibold text-sys-text-secondary">
                                ауд. 102
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="text-[11px] text-center text-sys-text-muted pt-1">
                      {demoSubgroup !== null ? (
                        <button
                          type="button"
                          onClick={() => setDemoSubgroup(null)}
                          className="text-sys-accent underline hover:opacity-80"
                        >
                          Скинути фільтр і показати обидві підгрупи
                        </button>
                      ) : (
                        "👆 Натискай на кнопки «1 підгр.» чи «2 підгр.» прямо на картці"
                      )}
                    </div>
                  </div>
                </motion.div>
              )}

              {/* STEP 1: Live Lesson & Bell Schedule */}
              {currentStep === 1 && (
                <motion.div
                  key="step1"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.15 }}
                  className="space-y-4"
                >
                  <div>
                    <h3 className="text-xl sm:text-2xl font-black text-sys-text-primary tracking-tight">
                      {STEPS[1].fullTitle}
                    </h3>
                    <p className="text-xs sm:text-sm text-sys-text-secondary mt-1">
                      {STEPS[1].subtitle}
                    </p>
                  </div>

                  <div className="space-y-2 text-xs sm:text-sm text-sys-text-secondary">
                    <div className="flex items-start gap-2">
                      <span className="text-sys-accent font-bold mt-0.5">✦</span>
                      <span>
                        <strong>Жива пара:</strong> заняття, яке триває зараз, підсвічується плашкою <span className="font-semibold text-sys-accent">ще N хв</span> та лінією часу внизу картки.
                      </span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-sys-accent font-bold mt-0.5">✦</span>
                      <span>
                        <strong>Статуси:</strong> заміни позначаються помаранчевим бейджем <span className="font-semibold text-amber-400">Заміна</span>, а скорочені пари — <span className="font-semibold text-blue-400">⏱ 50 хв</span>.
                      </span>
                    </div>
                  </div>

                  {/* Day strip & Card */}
                  <div className="rounded-2xl border border-sys-border bg-sys-bg p-4 space-y-3 shadow-lg">
                    <div className="grid grid-cols-5 gap-1.5">
                      {(["Пн", "Вт", "Ср", "Чт", "Пт"] as const).map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setDemoDay(d)}
                          className={`rounded-xl py-1.5 text-xs font-bold border transition-all ${
                            demoDay === d
                              ? "bg-sys-accent text-slate-900 border-sys-accent shadow-xs"
                              : "bg-sys-card border-sys-border text-sys-text-secondary hover:border-sys-accent/40"
                          }`}
                        >
                          {d}
                        </button>
                      ))}
                    </div>

                    {demoDay === "Пн" && (
                      <div className="relative rounded-2xl border border-sys-accent/60 bg-gradient-to-r from-sys-accent/10 via-sys-card to-sys-card p-4 space-y-2 shadow-[0_0_20px_rgba(56,189,248,0.12)]">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-black text-sys-accent">1 · 09:00–10:20</span>
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-sys-accent/20 border border-sys-accent/40 px-2.5 py-0.5 text-xs font-bold text-sys-accent">
                            <span className="h-2 w-2 rounded-full bg-sys-accent animate-pulse" />
                            ще 25 хв
                          </span>
                        </div>
                        <div className="font-bold text-base text-sys-text-primary">Програмування та алгоритми</div>
                        <div className="text-xs text-sys-text-secondary">Іванов І.І. · ауд. 201</div>
                        <div className="h-1 w-full rounded-full bg-sys-accent/20 overflow-hidden mt-1">
                          <div className="h-full bg-sys-accent rounded-full w-3/5" />
                        </div>
                      </div>
                    )}

                    {demoDay === "Вт" && (
                      <div className="rounded-2xl border border-sys-border bg-sys-card p-4 space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-bold text-sys-text-secondary">1 · 09:00–10:20</span>
                          <span className="rounded-md bg-amber-500/20 text-amber-400 font-bold px-2 py-0.5 text-xs">Заміна</span>
                        </div>
                        <div className="font-bold text-base text-sys-text-primary">Бази даних та SQL</div>
                        <div className="text-xs text-sys-text-secondary">Петренко П.П. · ауд. 305</div>
                      </div>
                    )}

                    {demoDay === "Ср" && (
                      <div className="rounded-2xl border border-sys-border bg-sys-card p-4 space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-bold text-sys-text-secondary">2 · 10:40–12:00</span>
                          <span className="text-xs font-semibold text-sys-text-muted">ауд. 104</span>
                        </div>
                        <div className="font-bold text-base text-sys-text-primary">Вища математика</div>
                        <div className="text-xs text-sys-text-secondary">Сидоренко С.С.</div>
                      </div>
                    )}

                    {demoDay === "Чт" && (
                      <div className="rounded-2xl border border-sys-border bg-sys-card p-4 space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-bold text-sys-text-secondary">1 · 09:00–09:50</span>
                          <span className="rounded-md bg-blue-500/20 text-blue-400 font-bold px-2 py-0.5 text-xs">⏱ 50 хв</span>
                        </div>
                        <div className="font-bold text-base text-sys-text-primary">Скорочений день занять</div>
                        <div className="text-xs text-sys-text-secondary">Ковальчук К.К. · ауд. 101</div>
                      </div>
                    )}

                    {demoDay === "Пт" && (
                      <div className="py-6 text-center text-sys-text-muted text-xs font-semibold">
                        🎉 Пар немає · Розклад на цей день вільний
                      </div>
                    )}
                  </div>
                </motion.div>
              )}

              {/* STEP 2: Online Meetings */}
              {currentStep === 2 && (
                <motion.div
                  key="step2"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.15 }}
                  className="space-y-4"
                >
                  <div>
                    <h3 className="text-xl sm:text-2xl font-black text-sys-text-primary tracking-tight">
                      {STEPS[2].fullTitle}
                    </h3>
                    <p className="text-xs sm:text-sm text-sys-text-secondary mt-1">
                      {STEPS[2].subtitle}
                    </p>
                  </div>

                  <div className="space-y-2 text-xs sm:text-sm text-sys-text-secondary">
                    <div className="flex items-start gap-2">
                      <span className="text-sys-accent font-bold mt-0.5">✦</span>
                      <span>
                        <strong>Захист посилань:</strong> без підключеного Google Classroom замість лінка відображається замок <span className="font-semibold text-slate-300">🔒 Meet</span>.
                      </span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-sys-accent font-bold mt-0.5">✦</span>
                      <span>
                        <strong>Розблокування в 1 клік:</strong> натисни на кнопку <span className="font-semibold text-sys-accent">Прив'язати Classroom</span> у шапці — кнопки стануть зеленими <span className="font-semibold text-emerald-400">Meet ↗</span>.
                      </span>
                    </div>
                  </div>

                  {/* Card with Meet Toggle */}
                  <div className="rounded-2xl border border-sys-border bg-sys-bg p-4 space-y-3 shadow-lg">
                    <div className="flex items-center justify-between pb-2 border-b border-sys-border/40">
                      <span className="text-xs font-bold text-sys-text-secondary">Студентська пошта:</span>
                      <button
                        type="button"
                        onClick={() => { setDemoLinked((prev) => !prev); setDemoToast(""); }}
                        className={`rounded-xl px-3 py-1.5 text-xs font-bold border transition-all ${
                          demoLinked
                            ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/50"
                            : "bg-sys-card text-sys-text-muted border-sys-border"
                        }`}
                      >
                        {demoLinked ? "✓ Classroom прив'язано" : "🔒 Не прив'язано"}
                      </button>
                    </div>

                    <div className="rounded-2xl border border-sys-border bg-sys-card p-4 space-y-2.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-sys-text-secondary">2 · 10:40–12:00</span>
                        {demoLinked ? (
                          <button
                            type="button"
                            onClick={() => setDemoToast("Відеоконференція Google Meet відкривається у новій вкладці.")}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500/15 border border-emerald-500/40 px-3 py-1 text-xs font-bold text-emerald-400 hover:bg-emerald-500/25 active:scale-95 transition-all shadow-xs"
                          >
                            Meet ↗
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setDemoToast("Для перегляду онлайн-пари прив'яжіть Google Classroom цієї групи")}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-sys-bg border border-sys-border px-3 py-1 text-xs font-bold text-sys-text-muted hover:border-sys-accent/40 active:scale-95 transition-all"
                          >
                            🔒 Meet
                          </button>
                        )}
                      </div>
                      <div className="font-bold text-base text-sys-text-primary">Комп'ютерна графіка (Онлайн)</div>
                      <div className="text-xs text-sys-text-secondary">Хочинська В.В.</div>

                      {demoToast && (
                        <div className="rounded-xl border border-sys-border bg-sys-bg p-2.5 text-xs text-sys-text-primary font-medium animate-in fade-in">
                          {demoToast}
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}

              {/* STEP 3: Homework & Classroom */}
              {currentStep === 3 && (
                <motion.div
                  key="step3"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.15 }}
                  className="space-y-4"
                >
                  <div>
                    <h3 className="text-xl sm:text-2xl font-black text-sys-text-primary tracking-tight">
                      {STEPS[3].fullTitle}
                    </h3>
                    <p className="text-xs sm:text-sm text-sys-text-secondary mt-1">
                      {STEPS[3].subtitle}
                    </p>
                  </div>

                  <div className="space-y-2 text-xs sm:text-sm text-sys-text-secondary">
                    <div className="flex items-start gap-2">
                      <span className="text-sys-accent font-bold mt-0.5">✦</span>
                      <span>
                        <strong>ДЗ на картці:</strong> активні завдання з дедлайнами відображаються прямо під назвою предмета.
                      </span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-sys-accent font-bold mt-0.5">✦</span>
                      <span>
                        <strong>Оцінки:</strong> після здачі роботи плашка стає зеленою (<span className="font-semibold text-emerald-400">Усе здано</span>), де можна побачити оцінку викладача.
                      </span>
                    </div>
                  </div>

                  {/* Card with Accordions */}
                  <div className="rounded-2xl border border-sys-border bg-sys-bg p-4 space-y-2.5 shadow-lg">
                    <div className="rounded-2xl border border-sys-border bg-sys-card p-4 space-y-2.5">
                      <div className="flex items-center justify-between text-xs font-bold text-sys-text-secondary">
                        <span>3 · 12:30–13:50</span>
                        <span className="text-sys-text-muted font-normal">ауд. 101</span>
                      </div>
                      <div className="font-bold text-base text-sys-text-primary">Операційні системи</div>

                      {/* Active tasks accordion */}
                      <button
                        type="button"
                        onClick={() => setDemoActiveHwOpen((prev) => !prev)}
                        className="w-full flex items-center justify-between rounded-xl border border-purple-500/30 bg-purple-500/10 px-3 py-2 text-xs font-bold text-purple-400 hover:bg-purple-500/15 transition-colors"
                      >
                        <span>2 завдання · Сьогодні</span>
                        <span>{demoActiveHwOpen ? "▴" : "▾"}</span>
                      </button>
                      {demoActiveHwOpen && (
                        <div className="rounded-xl border border-sys-border bg-sys-bg p-2 space-y-1 text-xs animate-in fade-in">
                          <div className="flex justify-between py-0.5">
                            <span className="text-sys-text-secondary">Практична робота №4</span>
                            <span className="text-amber-400 font-bold">Сьогодні ↗</span>
                          </div>
                          <div className="flex justify-between py-0.5">
                            <span className="text-sys-text-secondary">Тест: процеси та потоки</span>
                            <span className="text-purple-300">до 28 жовт. ↗</span>
                          </div>
                        </div>
                      )}

                      {/* Completed tasks accordion */}
                      <button
                        type="button"
                        onClick={() => setDemoDoneHwOpen((prev) => !prev)}
                        className="w-full flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-400 hover:bg-emerald-500/15 transition-colors"
                      >
                        <span>✓ Здано: 1 завдання</span>
                        <span>{demoDoneHwOpen ? "▴" : "▾"}</span>
                      </button>
                      {demoDoneHwOpen && (
                        <div className="rounded-xl border border-sys-border bg-sys-bg p-2 text-xs flex justify-between animate-in fade-in">
                          <span className="text-sys-text-secondary">Лабораторна робота №3</span>
                          <span className="text-emerald-400 font-bold">Оцінка: 12/12 ↗</span>
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}

              {/* STEP 4: Personalization & Themes */}
              {currentStep === 4 && (
                <motion.div
                  key="step4"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.15 }}
                  className="space-y-4"
                >
                  <div>
                    <h3 className="text-xl sm:text-2xl font-black text-sys-text-primary tracking-tight">
                      {STEPS[4].fullTitle}
                    </h3>
                    <p className="text-xs sm:text-sm text-sys-text-secondary mt-1">
                      {STEPS[4].subtitle}
                    </p>
                  </div>

                  <div className="space-y-2 text-xs sm:text-sm text-sys-text-secondary">
                    <div className="flex items-start gap-2">
                      <span className="text-sys-accent font-bold mt-0.5">✦</span>
                      <span>
                        <strong>Постійна підгрупа:</strong> обери свою підгрупу один раз у налаштуваннях, і розклад завжди відкриватиметься тільки з твоїми викладачами.
                      </span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-sys-accent font-bold mt-0.5">✦</span>
                      <span>
                        <strong>Палітри оформлення:</strong> перемикай тему оформления прямо в налаштуваннях застосунку.
                      </span>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-sys-border bg-sys-bg p-4 space-y-3 shadow-lg">
                    <div className="grid grid-cols-3 gap-2">
                      {(
                        [
                          { id: "ocean", name: "Океан", color: "#38bdf8" },
                          { id: "emerald", name: "Смарагд", color: "#10b981" },
                          { id: "amethyst", name: "Аметист", color: "#a855f7" },
                          { id: "amber", name: "Бурштин", color: "#f59e0b" },
                          { id: "sakura", name: "Сакура", color: "#f43f5e" },
                          { id: "lagoon", name: "Лагуна", color: "#14b8a6" },
                        ] as const
                      ).map((pal) => (
                        <button
                          key={pal.id}
                          type="button"
                          onClick={() => setDemoAccent(pal.id)}
                          className={`flex items-center gap-2 rounded-xl p-2.5 text-xs font-bold border transition-all ${
                            demoAccent === pal.id
                              ? `${accentColors[pal.id].soft} ${accentColors[pal.id].border} ${accentColors[pal.id].text}`
                              : "bg-sys-card border-sys-border text-sys-text-secondary hover:border-sys-accent/40"
                          }`}
                        >
                          <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: pal.color }} />
                          <span>{pal.name}</span>
                        </button>
                      ))}
                    </div>

                    <div className={`rounded-2xl border ${accentColors[demoAccent].border} bg-sys-card p-3.5 space-y-1 transition-colors duration-200`}>
                      <div className="flex items-center justify-between text-xs">
                        <span className={`font-black ${accentColors[demoAccent].text}`}>Прев'ю теми</span>
                        <span className={`rounded-full ${accentColors[demoAccent].soft} ${accentColors[demoAccent].text} px-2 py-0.5 text-[10px] font-bold`}>
                          Акцент
                        </span>
                      </div>
                      <div className="text-xs text-sys-text-secondary">
                        Усі кнопки та активні елементи розкладу змінять колір.
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* STEP 5: PWA & Offline */}
              {currentStep === 5 && (
                <motion.div
                  key="step5"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.15 }}
                  className="space-y-4"
                >
                  <div>
                    <h3 className="text-xl sm:text-2xl font-black text-sys-text-primary tracking-tight">
                      {STEPS[5].fullTitle}
                    </h3>
                    <p className="text-xs sm:text-sm text-sys-text-secondary mt-1">
                      {STEPS[5].subtitle}
                    </p>
                  </div>

                  <div className="space-y-2 text-xs sm:text-sm text-sys-text-secondary">
                    <div className="flex items-start gap-2">
                      <span className="text-sys-accent font-bold mt-0.5">✦</span>
                      <span>
                        <strong>Офлайн-режим:</strong> відкритий розклад автоматично кешується на пристрої й відкривається навіть без інтернету.
                      </span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-sys-accent font-bold mt-0.5">✦</span>
                      <span>
                        <strong>Встановлення:</strong> додай застосунок на робочий стіл, щоб запускати його в один клік як справжній додаток.
                      </span>
                    </div>
                  </div>

                  {/* Real install action box */}
                  <div className="rounded-2xl border border-sys-border bg-sys-bg p-4 sm:p-5 space-y-3 shadow-lg">
                    <div className="rounded-xl border border-sys-border bg-sys-card p-3 space-y-1.5 text-xs text-sys-text-secondary leading-relaxed">
                      <div className="font-bold text-sys-text-primary text-xs sm:text-sm">
                        {isStandalone
                          ? "✓ Застосунок уже встановлено"
                          : isIos
                          ? "🍎 Встановлення на iPhone / iPad"
                          : isDesktop
                          ? "💻 Встановлення на комп'ютер"
                          : "🤖 Встановлення на Android"}
                      </div>
                      <p>
                        {isStandalone
                          ? "Ви вже використовуєте розклад як автономний додаток."
                          : isIos
                          ? "У нижній панелі Safari натисніть «Поділитися» ⎋, а потім — «На початковий екран» ⊞."
                          : isDesktop
                          ? "Натисніть кнопку нижче або іконку встановлення в адресному рядку браузера."
                          : "Натисніть кнопку нижче або скористайтеся меню браузера (⋮) → «Встановити додаток»."}
                      </p>
                    </div>

                    {!isStandalone && (
                      <button
                        type="button"
                        onClick={handleInstallClick}
                        className="w-full flex items-center justify-center gap-2 rounded-xl bg-sys-accent px-4 py-3 text-sm font-bold text-slate-900 hover:opacity-95 active:scale-95 transition-all shadow-md"
                      >
                        <span>📲 Встановити додаток</span>
                      </button>
                    )}

                    {pwaFeedback && (
                      <div className="rounded-xl border border-sys-border bg-sys-card p-3 text-xs text-sys-text-primary text-center font-medium animate-in fade-in">
                        {pwaFeedback}
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Bottom Step Navigation Bar */}
            <footer className="flex items-center justify-between border-t border-sys-border/50 pt-4 mt-6 shrink-0">
              <button
                type="button"
                onClick={handlePrev}
                disabled={currentStep === 0}
                className="rounded-xl border border-sys-border bg-sys-bg px-4 py-2 text-xs sm:text-sm font-bold text-sys-text-secondary hover:text-sys-text-primary disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
              >
                ← Назад
              </button>

              <span className="text-xs font-bold text-sys-text-muted">
                {currentStep + 1} з {totalSteps}
              </span>

              <button
                type="button"
                onClick={handleNext}
                className="rounded-xl bg-sys-accent px-5 py-2 text-xs sm:text-sm font-bold text-slate-900 hover:opacity-95 active:scale-95 transition-all shadow-md"
              >
                {currentStep === totalSteps - 1
                  ? (isOnboarding ? "Перейти до розкладу" : "Зрозуміло")
                  : "Далі →"}
              </button>
            </footer>
          </main>

        </div>

      </div>
    </div>
  );
}
