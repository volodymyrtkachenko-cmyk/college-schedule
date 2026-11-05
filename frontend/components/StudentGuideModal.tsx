"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useUserSettings } from "../lib/useUserSettings";
import { useTheme, ACCENT_OPTIONS, AccentColor } from "../lib/useTheme";
import { useClassroomSubmissions } from "../lib/useClassroomSubmissions";
import { requestClassroomAuth } from "../lib/classroomAuth";

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

const ONBOARDING_STEPS: StepItem[] = [
  {
    id: "subgroups",
    shortTitle: "Підгрупа",
    icon: "👥",
    fullTitle: "Обери свою підгрупу",
    subtitle: "Якщо предмет ділиться на підгрупи, розклад показуватиме твого викладача.",
  },
  {
    id: "appearance",
    shortTitle: "Оформлення",
    icon: "🎨",
    fullTitle: "Тема та улюблений колір",
    subtitle: "Обирай світлу або темну тему та свій улюблений кольоровий акцент.",
  },
  {
    id: "schedule",
    shortTitle: "Дзвінки та пари",
    icon: "⏱️",
    fullTitle: "Розклад дзвінків та «жива» пара",
    subtitle: "Як влаштовані 4 пари та швидке підключення до відеоуроків.",
  },
  {
    id: "classroom",
    shortTitle: "Classroom",
    icon: "📋",
    fullTitle: "Google Classroom та оцінки",
    subtitle: "Синхронізація завдань, перегляд дедлайнів та особистих оцінок.",
  },
  {
    id: "install",
    shortTitle: "Додаток PWA",
    icon: "📲",
    fullTitle: "Встановлення на пристрій",
    subtitle: "Додай розклад на екран смартфона чи ПК для роботи без інтернету.",
  },
];

const GUIDE_STEPS: StepItem[] = [
  {
    id: "subgroups",
    shortTitle: "Група і підгрупи",
    icon: "👥",
    fullTitle: "Твоя група та підгрупи",
    subtitle: "Як налаштувати показ потрібних викладачів та перемикати групи.",
  },
  {
    id: "schedule",
    shortTitle: "Розклад і дзвінки",
    icon: "⏱️",
    fullTitle: "Дні тижня та «жива» пара",
    subtitle: "Розклад дзвінків, відстеження поточної пари та скорочені дні.",
  },
  {
    id: "online",
    shortTitle: "Онлайн-пари",
    icon: "💻",
    fullTitle: "Відеодзвінки та Meet / Zoom",
    subtitle: "Захищені посилання на онлайн-пари та перехід в один клік.",
  },
  {
    id: "homework",
    shortTitle: "Classroom і ДЗ",
    icon: "📋",
    fullTitle: "Домашні завдання та оцінки",
    subtitle: "Автоматична синхронізація дедлайнів, статус здачі та бали.",
  },
  {
    id: "appearance",
    shortTitle: "Теми і кольори",
    icon: "🎨",
    fullTitle: "Теми та колірні акценти",
    subtitle: "Зміна світлого/темного режиму та вибір однієї з 6 колірних тем.",
  },
  {
    id: "install",
    shortTitle: "Встановлення PWA",
    icon: "📲",
    fullTitle: "Додаток та робота офлайн",
    subtitle: "Як встановити розклад на смартфон чи ПК та переглядати пари офлайн.",
  },
];

export function StudentGuideModal({ isOnboarding = false, onClose, onComplete }: StudentGuideModalProps) {
  const { settings, updateSetting } = useUserSettings();
  const { theme, resolvedTheme, setTheme, accent, setAccent } = useTheme();
  const { isLinked, linkedEmail } = useClassroomSubmissions();

  const steps = isOnboarding ? ONBOARDING_STEPS : GUIDE_STEPS;
  const totalSteps = steps.length;
  const [currentStep, setCurrentStep] = useState(0);

  // Responsive state
  const [isDesktop, setIsDesktop] = useState(false);

  // Subgroup selection
  const initialSubgroup: 1 | 2 | null =
    settings.defaultSubgroup === 1 || settings.defaultSubgroup === 2
      ? settings.defaultSubgroup
      : null;
  const [chosenSubgroup, setChosenSubgroup] = useState<1 | 2 | null>(initialSubgroup);
  const [demoSubgroup, setDemoSubgroup] = useState<1 | 2 | null>(initialSubgroup);

  // Schedule demo
  const [demoDay, setDemoDay] = useState<"Пн" | "Вт" | "Ср" | "Чт" | "Пт">("Пн");

  // Online meet demo
  const [demoLinked, setDemoLinked] = useState(isLinked);
  const [demoToast, setDemoToast] = useState("");

  // Classroom demo
  const [demoActiveHwOpen, setDemoActiveHwOpen] = useState(false);
  const [demoDoneHwOpen, setDemoDoneHwOpen] = useState(false);
  const [isLinkingClassroom, setIsLinkingClassroom] = useState(false);
  const [classroomSuccess, setClassroomSuccess] = useState(false);
  const [classroomError, setClassroomError] = useState("");

  // PWA Install state
  const [pwaPrompt, setPwaPrompt] = useState<any>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [pwaFeedback, setPwaFeedback] = useState("");

  // Initialize PWA and screen detection
  useEffect(() => {
    if (typeof window === "undefined") return;

    const checkStandalone = () => {
      const standalone =
        ("standalone" in window.navigator && (window.navigator as any).standalone === true) ||
        window.matchMedia("(display-mode: standalone)").matches;
      setIsStandalone(standalone);
    };
    checkStandalone();

    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent || "");
    setIsIos(ios);

    const checkScreen = () => {
      setIsDesktop(window.innerWidth >= 768);
    };
    checkScreen();
    window.addEventListener("resize", checkScreen);

    // Capture saved prompt event from head script if available
    if ((window as any).__pwaInstallEvent) {
      setPwaPrompt((window as any).__pwaInstallEvent);
    }

    const onInstallReady = (e: any) => {
      setPwaPrompt(e.detail || (window as any).__pwaInstallEvent);
    };

    const onBeforeInstall = (e: any) => {
      e.preventDefault();
      (window as any).__pwaInstallEvent = e;
      setPwaPrompt(e);
    };

    const onAppInstalled = () => {
      setIsStandalone(true);
      setPwaPrompt(null);
      if (typeof window !== "undefined") (window as any).__pwaInstallEvent = null;
      setPwaFeedback("✅ Додаток успішно встановлено!");
    };

    window.addEventListener("pwa-install-ready", onInstallReady);
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onAppInstalled);
    window.addEventListener("pwa-installed", onAppInstalled);

    return () => {
      window.removeEventListener("resize", checkScreen);
      window.removeEventListener("pwa-install-ready", onInstallReady);
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onAppInstalled);
      window.removeEventListener("pwa-installed", onAppInstalled);
    };
  }, []);

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

  const handleSubgroupSelect = (subgroup: 1 | 2 | null) => {
    setChosenSubgroup(subgroup);
    setDemoSubgroup(subgroup);
    updateSetting("defaultSubgroup", subgroup);
  };

  const handleClassroomAuth = async () => {
    if (isLinkingClassroom) return;
    setIsLinkingClassroom(true);
    setClassroomError("");
    try {
      const cachedGroupId = typeof window !== "undefined"
        ? (Number(localStorage.getItem("schedule:groupId")) || Number(localStorage.getItem("schedule:classroom_linked_group_id")) || undefined)
        : undefined;

      await requestClassroomAuth({
        groupId: cachedGroupId,
        onSuccess: () => {
          setIsLinkingClassroom(false);
          setClassroomSuccess(true);
          setDemoLinked(true);
        },
        onError: (err) => {
          setIsLinkingClassroom(false);
          setClassroomError(err.message || "Не вдалося підключити Google Classroom.");
        },
      });
    } catch (err: any) {
      setIsLinkingClassroom(false);
      setClassroomError(err.message || "Помилка підключення Google Classroom.");
    }
  };

  const handleInstallClick = async () => {
    const promptToUse = pwaPrompt || (typeof window !== "undefined" ? (window as any).__pwaInstallEvent : null);
    if (promptToUse && typeof promptToUse.prompt === "function") {
      try {
        await promptToUse.prompt();
        const choice = await promptToUse.userChoice;
        if (choice?.outcome === "accepted") {
          setIsStandalone(true);
          setPwaPrompt(null);
          if (typeof window !== "undefined") (window as any).__pwaInstallEvent = null;
          setPwaFeedback("✅ Чудово! Додаток додано на ваш пристрій.");
        } else {
          setPwaFeedback("Встановлення відкладено. Ви завжди можете встановити додаток пізніше в налаштуваннях.");
        }
      } catch (err) {
        console.error("Install prompt error:", err);
      }
    } else if (isStandalone) {
      setPwaFeedback("✅ Застосунок уже встановлено на цьому пристрої! 👍");
    } else if (isIos) {
      setPwaFeedback("На iPhone натисніть «Поділитися» ⎋ у нижній панелі Safari, а потім — «На початковий екран» ⊞.");
    } else if (isDesktop) {
      setPwaFeedback("Натисніть на іконку ⊕ праворуч в адресному рядку браузера (Chrome / Edge), щоб закріпити розклад.");
    } else {
      setPwaFeedback("Відкрийте меню браузера (⋮) та оберіть «Встановити додаток» або «Додати на головний екран».");
    }
  };

  const currentStepData = steps[currentStep] || steps[0];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-2 sm:p-5 backdrop-blur-md overflow-hidden animate-in fade-in duration-150">
      <div className="relative flex flex-col w-full max-w-4xl h-[92vh] sm:h-[620px] max-h-[720px] rounded-3xl border border-sys-border bg-sys-card text-sys-text-primary shadow-2xl overflow-hidden">
        
        {/* Top Header */}
        <header className="flex items-center justify-between border-b border-sys-border/50 px-4 sm:px-6 py-3.5 bg-sys-card shrink-0">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-sys-accent/15 text-lg shadow-xs">
              {isOnboarding ? "✨" : "🎓"}
            </span>
            <div>
              <h2 className="text-sm sm:text-base font-bold leading-tight text-sys-text-primary">
                {isOnboarding ? "Швидке налаштування розкладу" : "Гід студента"}
              </h2>
              <p className="text-[11px] text-sys-text-secondary">
                {isOnboarding ? "Персоналізуй розклад під себе" : "Довідник та підказки щодо розкладу"}
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
                className="flex h-8 w-8 items-center justify-center rounded-xl text-sys-text-secondary hover:text-sys-text-primary hover:bg-sys-bg transition-colors font-bold text-sm"
              >
                ✕
              </button>
            )}
          </div>
        </header>

        {/* Mobile Horizontal Section Tabs Strip (scrollable) */}
        <div className="md:hidden flex items-center gap-1.5 overflow-x-auto px-4 py-2 border-b border-sys-border/40 bg-sys-bg/60 shrink-0 no-scrollbar">
          {steps.map((step, idx) => (
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

        {/* Main Body Area: Sidebar (Desktop) + Content (Right) */}
        <div className="flex-1 flex overflow-hidden min-h-0">
          
          {/* Desktop Left Sidebar: Direct Clickable Sections */}
          <aside className="hidden md:flex flex-col w-60 border-r border-sys-border/50 bg-sys-bg/40 p-3 space-y-1 shrink-0 overflow-y-auto">
            <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-sys-text-muted">
              {isOnboarding ? "Кроки налаштування" : "Розділи гіда"}
            </div>
            {steps.map((step, idx) => {
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

          {/* Right Column: Scrollable Content + Stationary Bottom Footer */}
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
            
            {/* Scrollable Content Area */}
            <main className="flex-1 overflow-y-auto p-4 sm:p-6 custom-scrollbar">
              <AnimatePresence initial={false}>
                
                {/* STEP: SUBGROUPS */}
                {currentStepData.id === "subgroups" && (
                  <motion.div
                    key="subgroups"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.12 }}
                    className="space-y-4"
                  >
                  <div>
                    <h3 className="text-xl sm:text-2xl font-black text-sys-text-primary tracking-tight">
                      {currentStepData.fullTitle}
                    </h3>
                    <p className="text-xs sm:text-sm text-sys-text-secondary mt-1">
                      {currentStepData.subtitle}
                    </p>
                  </div>

                  {/* Onboarding Mode: Real Setting Selector */}
                  {isOnboarding ? (
                    <div className="rounded-2xl border border-sys-border/80 bg-sys-bg p-4 space-y-3 shadow-xs">
                      <div className="text-xs font-bold text-sys-text-primary">
                        Обери свою підгрупу:
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <button
                          type="button"
                          onClick={() => handleSubgroupSelect(1)}
                          className={`rounded-xl py-2.5 px-3 text-xs sm:text-sm font-bold border transition-all ${
                            chosenSubgroup === 1
                              ? "bg-sys-accent text-slate-900 border-sys-accent shadow-sm scale-[1.02]"
                              : "bg-sys-card border-sys-border text-sys-text-secondary hover:text-sys-text-primary"
                          }`}
                        >
                          1 підгрупа
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSubgroupSelect(2)}
                          className={`rounded-xl py-2.5 px-3 text-xs sm:text-sm font-bold border transition-all ${
                            chosenSubgroup === 2
                              ? "bg-sys-accent text-slate-900 border-sys-accent shadow-sm scale-[1.02]"
                              : "bg-sys-card border-sys-border text-sys-text-secondary hover:text-sys-text-primary"
                          }`}
                        >
                          2 підгрупа
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSubgroupSelect(null)}
                          className={`rounded-xl py-2.5 px-3 text-xs sm:text-sm font-bold border transition-all ${
                            chosenSubgroup === null
                              ? "bg-sys-accent text-slate-900 border-sys-accent shadow-sm scale-[1.02]"
                              : "bg-sys-card border-sys-border text-sys-text-secondary hover:text-sys-text-primary"
                          }`}
                        >
                          Обидві
                        </button>
                      </div>
                      <div className="text-[11px] text-sys-text-muted flex items-center gap-1.5 pt-0.5">
                        <span className="text-sys-accent font-bold">✓</span>
                        <span>
                          {chosenSubgroup
                            ? `Налаштовано: показуватиметься тільки ${chosenSubgroup}-а підгрупа.`
                            : "Налаштовано: показуватимуться всі викладачі обох підгруп."}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2 text-xs sm:text-sm text-sys-text-secondary">
                      <div className="flex items-start gap-2">
                        <span className="text-sys-accent font-bold mt-0.5">✦</span>
                        <span>
                          <strong>Фільтрація підгрупи:</strong> натискай кнопки <span className="font-semibold text-sky-400">1 підгр.</span> або <span className="font-semibold text-indigo-400">2 підгр.</span> прямо в картці пари — чужий викладач та аудиторія зникнуть.
                        </span>
                      </div>
                      <div className="flex items-start gap-2">
                        <span className="text-sys-accent font-bold mt-0.5">✦</span>
                        <span>
                          <strong>Зміна групи або викладача:</strong> у верхньому кутку є вибір групи з миттєвим пошуком та закріпленням (📌).
                        </span>
                      </div>
                    </div>
                  )}

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
                          Скинути фільтр у картці й показати обидві підгрупи
                        </button>
                      ) : (
                        "👆 Натискай на кнопки «1 підгр.» чи «2 підгр.» прямо на картці"
                      )}
                    </div>
                  </div>
                </motion.div>
              )}

              {/* STEP: APPEARANCE (THEME & ACCENT) */}
              {currentStepData.id === "appearance" && (
                <motion.div
                  key="appearance"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.12 }}
                  className="space-y-4"
                >
                  <div>
                    <h3 className="text-xl sm:text-2xl font-black text-sys-text-primary tracking-tight">
                      {currentStepData.fullTitle}
                    </h3>
                    <p className="text-xs sm:text-sm text-sys-text-secondary mt-1">
                      {currentStepData.subtitle}
                    </p>
                  </div>

                  {/* Theme Mode Switcher */}
                  <div className="rounded-2xl border border-sys-border/80 bg-sys-bg p-4 space-y-3 shadow-xs">
                    <div className="text-xs font-bold text-sys-text-primary">
                      Режим теми:
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setTheme("dark")}
                        className={`flex items-center justify-center gap-2 rounded-xl py-2.5 px-3 text-xs sm:text-sm font-bold border transition-all ${
                          resolvedTheme === "dark"
                            ? "bg-sys-accent text-slate-900 border-sys-accent shadow-xs scale-[1.02]"
                            : "bg-sys-card border-sys-border text-sys-text-secondary hover:text-sys-text-primary"
                        }`}
                      >
                        <span>🌙</span>
                        <span>Темна</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setTheme("light")}
                        className={`flex items-center justify-center gap-2 rounded-xl py-2.5 px-3 text-xs sm:text-sm font-bold border transition-all ${
                          resolvedTheme === "light"
                            ? "bg-sys-accent text-slate-900 border-sys-accent shadow-xs scale-[1.02]"
                            : "bg-sys-card border-sys-border text-sys-text-secondary hover:text-sys-text-primary"
                        }`}
                      >
                        <span>☀️</span>
                        <span>Світла</span>
                      </button>
                    </div>

                    {/* Accent Colors Palette */}
                    <div className="pt-2">
                      <div className="text-xs font-bold text-sys-text-primary mb-2">
                        Колірний акцент:
                      </div>
                      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                        {ACCENT_OPTIONS.map((opt) => {
                          const isSelected = accent === opt.id;
                          return (
                            <button
                              key={opt.id}
                              type="button"
                              onClick={() => setAccent(opt.id as AccentColor)}
                              className={`flex flex-col items-center gap-1.5 rounded-xl p-2.5 border transition-all ${
                                isSelected
                                  ? "border-sys-accent bg-sys-accent/15 shadow-xs scale-105"
                                  : "border-sys-border bg-sys-card hover:border-sys-border/80 text-sys-text-secondary"
                              }`}
                            >
                              <span
                                className="h-5 w-5 rounded-full shadow-xs"
                                style={{ backgroundColor: opt.colorHex }}
                              />
                              <span className="text-[11px] font-bold truncate">
                                {opt.label}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Real-time Theme Preview Card */}
                  <div className="rounded-2xl border border-sys-accent/50 bg-sys-card p-4 space-y-2 shadow-lg">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-sys-accent">Прев'ю інтерфейсу</span>
                      <span className="rounded-full bg-sys-accent/20 text-sys-accent px-2 py-0.5 text-[10px] font-bold">
                        Активний стиль
                      </span>
                    </div>
                    <div className="text-xs text-sys-text-secondary">
                      Інтерфейс розкладу, кнопок та карток автоматично застосовує твої налаштування.
                    </div>
                  </div>
                </motion.div>
              )}

              {/* STEP: SCHEDULE & LIVE LESSON */}
              {currentStepData.id === "schedule" && (
                <motion.div
                  key="schedule"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.12 }}
                  className="space-y-4"
                >
                  <div>
                    <h3 className="text-xl sm:text-2xl font-black text-sys-text-primary tracking-tight">
                      {currentStepData.fullTitle}
                    </h3>
                    <p className="text-xs sm:text-sm text-sys-text-secondary mt-1">
                      {currentStepData.subtitle}
                    </p>
                  </div>

                  <div className="space-y-2 text-xs sm:text-sm text-sys-text-secondary">
                    <div className="flex items-start gap-2">
                      <span className="text-sys-accent font-bold mt-0.5">✦</span>
                      <span>
                        <strong>4 пари на день:</strong> 1 пара (09:00), 2 пара (10:40), 3 пара (12:30), 4 пара (14:00).
                      </span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-sys-accent font-bold mt-0.5">✦</span>
                      <span>
                        <strong>«Жива» пара:</strong> заняття, яке триває зараз, підсвічується плашкою <span className="font-semibold text-sys-accent">● ще N хв</span> та лінією часу внизу.
                      </span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-sys-accent font-bold mt-0.5">✦</span>
                      <span>
                        <strong>Відеоуроки:</strong> якщо пара дистанційна, у картці з'являється пряме посилання на відеоконференцію.
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

              {/* STEP: ONLINE MEETINGS (GUIDE ONLY) */}
              {currentStepData.id === "online" && (
                <motion.div
                  key="online"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.12 }}
                  className="space-y-4"
                >
                  <div>
                    <h3 className="text-xl sm:text-2xl font-black text-sys-text-primary tracking-tight">
                      {currentStepData.fullTitle}
                    </h3>
                    <p className="text-xs sm:text-sm text-sys-text-secondary mt-1">
                      {currentStepData.subtitle}
                    </p>
                  </div>

                  <div className="space-y-2 text-xs sm:text-sm text-sys-text-secondary">
                    <div className="flex items-start gap-2">
                      <span className="text-sys-accent font-bold mt-0.5">✦</span>
                      <span>
                        <strong>Захист посилань:</strong> студенти своєї групи переходять на відеоуроки через пряму кнопку <span className="font-semibold text-emerald-400">Meet ↗</span> або <span className="font-semibold text-blue-400">Zoom ↗</span>.
                      </span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-sys-accent font-bold mt-0.5">✦</span>
                      <span>
                        <strong>Для гостей:</strong> посилання захищені позначкою <span className="font-semibold text-slate-300">🔒 Meet</span> для безпеки навчального процесу.
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

              {/* STEP: CLASSROOM (ONBOARDING & GUIDE) */}
              {(currentStepData.id === "classroom" || currentStepData.id === "homework") && (
                <motion.div
                  key="classroom"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.12 }}
                  className="space-y-4"
                >
                  <div>
                    <h3 className="text-xl sm:text-2xl font-black text-sys-text-primary tracking-tight">
                      {currentStepData.fullTitle}
                    </h3>
                    <p className="text-xs sm:text-sm text-sys-text-secondary mt-1">
                      {currentStepData.subtitle}
                    </p>
                  </div>

                  {/* Interactive Connect Button for Onboarding */}
                  {isOnboarding && (
                    <div className="rounded-2xl border border-sys-border/80 bg-sys-bg p-4 space-y-3 shadow-xs">
                      {isLinked || classroomSuccess ? (
                        <div className="flex items-center gap-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-emerald-400 font-bold text-xs sm:text-sm">
                          <span className="text-lg">✅</span>
                          <div>
                            <div>Google Classroom успішно підключено!</div>
                            <div className="text-xs font-normal text-emerald-300/80">
                              {linkedEmail || "Студентський акаунт активний"}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <button
                            type="button"
                            onClick={handleClassroomAuth}
                            disabled={isLinkingClassroom}
                            className="w-full flex items-center justify-center gap-2 rounded-xl bg-sys-accent px-4 py-2.5 text-xs sm:text-sm font-bold text-slate-900 hover:opacity-95 active:scale-95 transition-all shadow-xs disabled:opacity-50"
                          >
                            <span>🔗</span>
                            <span>{isLinkingClassroom ? "Підключення..." : "Підключити студентську пошту Classroom"}</span>
                          </button>
                          {classroomError && (
                            <p className="text-xs text-rose-400 text-center">{classroomError}</p>
                          )}
                          <p className="text-[11px] text-sys-text-muted text-center">
                            Це необов'язково. Ви можете підключити Classroom пізніше в налаштуваннях.
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Accordion Demo */}
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

              {/* STEP: PWA INSTALLATION */}
              {currentStepData.id === "install" && (
                <motion.div
                  key="install"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.12 }}
                  className="space-y-4"
                >
                  <div>
                    <h3 className="text-xl sm:text-2xl font-black text-sys-text-primary tracking-tight">
                      {currentStepData.fullTitle}
                    </h3>
                    <p className="text-xs sm:text-sm text-sys-text-secondary mt-1">
                      {currentStepData.subtitle}
                    </p>
                  </div>

                  <div className="space-y-2 text-xs sm:text-sm text-sys-text-secondary">
                    <div className="flex items-start gap-2">
                      <span className="text-sys-accent font-bold mt-0.5">✦</span>
                      <span>
                        <strong>Офлайн-режим:</strong> уже відкритий розклад зберігається на пристрої й відкривається навіть без підключення до інтернету.
                      </span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-sys-accent font-bold mt-0.5">✦</span>
                      <span>
                        <strong>Швидкий запуск:</strong> розклад запускається як окремий додаток без адресної панелі браузера.
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
          </main>

          {/* Stationary Persistent Bottom Navigation Footer */}
          <footer className="flex items-center justify-between border-t border-sys-border/50 px-4 sm:px-6 py-3.5 bg-sys-card shrink-0">
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
                ? (isOnboarding ? "🚀 Перейти до розкладу" : "Зрозуміло ✓")
                : "Далі →"}
            </button>
          </footer>

        </div>

      </div>

    </div>
  </div>
);
}
