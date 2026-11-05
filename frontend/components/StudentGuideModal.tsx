"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

export interface StudentGuideModalProps {
  isOnboarding?: boolean;
  onClose: () => void;
  onComplete?: () => void;
}

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

  const totalSteps = 6;

  const handleNext = () => {
    if (currentStep < totalSteps - 1) {
      setCurrentStep((prev) => prev + 1);
    } else {
      if (isOnboarding && onComplete) {
        onComplete();
      } else {
        onClose();
      }
    }
  };

  const handlePrev = () => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1);
    }
  };

  const handleFinishEarly = () => {
    if (isOnboarding && onComplete) {
      onComplete();
    } else {
      onClose();
    }
  };

  // Demo 1 State (Subgroup toggle directly on card)
  const [demoSubgroup, setDemoSubgroup] = useState<null | 1 | 2>(null);

  // Demo 2 State (Day tabs)
  const [demoDay, setDemoDay] = useState<"Пн" | "Вт" | "Ср" | "Чт" | "Пт">("Пн");

  // Demo 3 State (Online meet lock)
  const [demoLinked, setDemoLinked] = useState(false);
  const [demoToast, setDemoToast] = useState("");

  // Demo 4 State (Homework accordion)
  const [demoActiveHwOpen, setDemoActiveHwOpen] = useState(false);
  const [demoDoneHwOpen, setDemoDoneHwOpen] = useState(false);

  // Demo 5 State (Accent preview)
  const [demoAccent, setDemoAccent] = useState<"ocean" | "emerald" | "amethyst" | "amber" | "sakura" | "lagoon">("ocean");

  // Demo 6 State (PWA install feedback)
  const [pwaFeedback, setPwaFeedback] = useState("");

  const accentColors = {
    ocean: { bg: "bg-sky-500", text: "text-sky-400", border: "border-sky-500/40", soft: "bg-sky-500/15" },
    emerald: { bg: "bg-emerald-500", text: "text-emerald-400", border: "border-emerald-500/40", soft: "bg-emerald-500/15" },
    amethyst: { bg: "bg-purple-500", text: "text-purple-400", border: "border-purple-500/40", soft: "bg-purple-500/15" },
    amber: { bg: "bg-amber-500", text: "text-amber-400", border: "border-amber-500/40", soft: "bg-amber-500/15" },
    sakura: { bg: "bg-rose-500", text: "text-rose-400", border: "border-rose-500/40", soft: "bg-rose-500/15" },
    lagoon: { bg: "bg-teal-500", text: "text-teal-400", border: "border-teal-500/40", soft: "bg-teal-500/15" },
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3 sm:p-6 backdrop-blur-md overflow-hidden animate-in fade-in duration-200">
      <div className="relative flex flex-col w-full max-w-4xl max-h-[92vh] sm:max-h-[85vh] rounded-3xl border border-sys-border bg-sys-card text-sys-text-primary shadow-2xl overflow-hidden">
        
        {/* Top Header: Logo + Step Indicator Dots + Close/Skip */}
        <header className="flex items-center justify-between border-b border-sys-border/50 px-5 py-3.5 bg-sys-card/90 shrink-0">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-sys-accent/15 text-sys-accent font-black text-xs tracking-wider">
              ДФКР
            </span>
            <div className="flex items-center gap-1.5">
              {Array.from({ length: totalSteps }).map((_, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setCurrentStep(idx)}
                  className={`h-1.5 rounded-full transition-all duration-200 ${
                    idx === currentStep
                      ? "w-6 bg-sys-accent"
                      : idx < currentStep
                      ? "w-2.5 bg-sys-accent/40"
                      : "w-2.5 bg-sys-border"
                  }`}
                  aria-label={`Крок ${idx + 1}`}
                />
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="hidden sm:inline-block text-[11px] font-semibold text-sys-text-muted">
              {isDesktop ? "💻 Для комп'ютера" : "📱 Для смартфона"}
            </span>
            {isOnboarding ? (
              <button
                type="button"
                onClick={handleFinishEarly}
                className="rounded-xl px-3 py-1.5 text-xs font-semibold text-sys-text-secondary hover:text-sys-text-primary hover:bg-sys-bg transition-colors"
              >
                Пропустити
              </button>
            ) : (
              <button
                type="button"
                onClick={onClose}
                aria-label="Закрити"
                className="flex h-8 w-8 items-center justify-center rounded-xl text-sys-text-secondary hover:text-sys-text-primary hover:bg-sys-bg transition-colors"
              >
                ✕
              </button>
            )}
          </div>
        </header>

        {/* Content Body: 2-column layout on Desktop, stacked on Mobile */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-7 custom-scrollbar">
          <AnimatePresence mode="wait">
            {/* STEP 0: Subgroups & Group */}
            {currentStep === 0 && (
              <motion.div
                key="step0"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.18 }}
                className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center"
              >
                {/* Left: Text */}
                <div className="md:col-span-5 space-y-3.5">
                  <span className="text-xs font-bold uppercase tracking-wider text-sys-accent">01 · Твоя група</span>
                  <h3 className="text-2xl font-black text-sys-text-primary tracking-tight leading-tight">
                    Група та підгрупи
                  </h3>
                  <p className="text-xs sm:text-sm text-sys-text-secondary leading-relaxed">
                    Розклад одразу налаштовується під твою групу та запам'ятовує твій вибір.
                  </p>

                  <div className="space-y-2.5 pt-1 text-xs sm:text-sm text-sys-text-secondary">
                    <div className="flex items-start gap-2.5">
                      <span className="text-sys-accent font-bold mt-0.5">✦</span>
                      <span>
                        <strong>Підгрупи:</strong> натискай кнопки <span className="font-semibold text-sky-400">1 підгр.</span> чи <span className="font-semibold text-indigo-400">2 підгр.</span> прямо в парі — чужий викладач та аудиторія зникнуть.
                      </span>
                    </div>
                    <div className="flex items-start gap-2.5">
                      <span className="text-sys-accent font-bold mt-0.5">✦</span>
                      <span>
                        {isDesktop ? (
                          <><strong>Зміна розкладу:</strong> у лівому кутку шапки є селектор з пошуком інших груп або викладачів.</>
                        ) : (
                          <><strong>Зміна розкладу:</strong> натисни на назву своєї групи в шапці вгорі, щоб глянути викладача.</>
                        )}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Right: Live Interactive Card (looks like the real app) */}
                <div className="md:col-span-7 flex flex-col items-center justify-center">
                  <div className="w-full max-w-md rounded-2xl border border-sys-border bg-sys-bg p-4 sm:p-5 shadow-lg space-y-3">
                    <div className="flex items-center justify-between text-xs font-bold text-sys-text-muted pb-1 border-b border-sys-border/40">
                      <span>1 пара · 09:00–10:20</span>
                      <span className="text-[11px] font-normal">Група [приклад]</span>
                    </div>

                    <div className="font-bold text-base text-sys-text-primary leading-snug">
                      [Предмет з поділом на підгрупи]
                    </div>

                    {/* Subgroup rows with direct interactive buttons */}
                    <div className="space-y-2 pt-1">
                      {(demoSubgroup === null || demoSubgroup === 1) && (
                        <div className="flex items-center justify-between gap-2 p-2 rounded-xl bg-sys-card border border-sys-border/60">
                          <div className="flex items-center gap-2 min-w-0">
                            <button
                              type="button"
                              onClick={() => setDemoSubgroup(demoSubgroup === 1 ? null : 1)}
                              className={`rounded-lg px-2 py-0.5 text-xs font-bold border transition-all ${
                                demoSubgroup === 1
                                  ? "bg-sky-500/20 text-sky-400 border-sky-500/50"
                                  : "bg-sys-bg border-sys-border text-slate-400 hover:text-sky-300"
                              }`}
                            >
                              1 підгр.
                            </button>
                            <span className="text-xs font-medium text-sys-text-secondary truncate">
                              [Викладач 1 — приклад]
                            </span>
                          </div>
                          <span className="rounded-md border border-sys-border bg-sys-bg px-2 py-0.5 text-xs text-sys-text-muted shrink-0">
                            ауд. 101
                          </span>
                        </div>
                      )}

                      {(demoSubgroup === null || demoSubgroup === 2) && (
                        <div className="flex items-center justify-between gap-2 p-2 rounded-xl bg-sys-card border border-sys-border/60">
                          <div className="flex items-center gap-2 min-w-0">
                            <button
                              type="button"
                              onClick={() => setDemoSubgroup(demoSubgroup === 2 ? null : 2)}
                              className={`rounded-lg px-2 py-0.5 text-xs font-bold border transition-all ${
                                demoSubgroup === 2
                                  ? "bg-indigo-500/20 text-indigo-400 border-indigo-500/50"
                                  : "bg-sys-bg border-sys-border text-slate-400 hover:text-indigo-300"
                              }`}
                            >
                              2 підгр.
                            </button>
                            <span className="text-xs font-medium text-sys-text-secondary truncate">
                              [Викладач 2 — приклад]
                            </span>
                          </div>
                          <span className="rounded-md border border-sys-border bg-sys-bg px-2 py-0.5 text-xs text-sys-text-muted shrink-0">
                            ауд. 102
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="text-[11px] text-center text-sys-text-muted pt-1">
                      👆 Натискай на кнопки підгруп для фільтрації
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {/* STEP 1: Live Lesson & Bell Schedule */}
            {currentStep === 1 && (
              <motion.div
                key="step1"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.18 }}
                className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center"
              >
                {/* Left: Text */}
                <div className="md:col-span-5 space-y-3.5">
                  <span className="text-xs font-bold uppercase tracking-wider text-sys-accent">02 · Розклад занять</span>
                  <h3 className="text-2xl font-black text-sys-text-primary tracking-tight leading-tight">
                    Дні та «жива» пара
                  </h3>
                  <p className="text-xs sm:text-sm text-sys-text-secondary leading-relaxed">
                    Застосунок відстежує київський час і підсвічує активну пару.
                  </p>

                  <div className="space-y-2.5 pt-1 text-xs sm:text-sm text-sys-text-secondary">
                    <div className="flex items-start gap-2.5">
                      <span className="text-sys-accent font-bold mt-0.5">✦</span>
                      <span>
                        <strong>Жива пара:</strong> під час уроку картка підсвічується статусом <span className="font-semibold text-sys-accent">ще N хв</span> та лінією прогресу.
                      </span>
                    </div>
                    <div className="flex items-start gap-2.5">
                      <span className="text-sys-accent font-bold mt-0.5">✦</span>
                      <span>
                        {isDesktop ? (
                          <><strong>Вигляд «День / Тиждень»:</strong> перемикайся тумблером між детальним днем і повною сіткою 5 днів одразу.</>
                        ) : (
                          <><strong>Дні тижня:</strong> гортай дні свайпами або кнопками Пн–Пт. Стрілки перемикають чисельник і знаменник.</>
                        )}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Right: Live Interactive Card with Day Tabs */}
                <div className="md:col-span-7 flex flex-col items-center justify-center">
                  <div className="w-full max-w-md rounded-2xl border border-sys-border bg-sys-bg p-4 sm:p-5 shadow-lg space-y-3">
                    {/* Day switcher strip */}
                    <div className="grid grid-cols-5 gap-1.5 pb-1">
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

                    {/* Lesson Card Preview */}
                    {demoDay === "Пн" && (
                      <div className="relative rounded-2xl border border-sys-accent/60 bg-gradient-to-r from-sys-accent/10 via-sys-card to-sys-card p-4 space-y-2.5 shadow-[0_0_20px_rgba(56,189,248,0.12)]">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-black text-sys-accent">1 · 09:00–10:20</span>
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-sys-accent/20 border border-sys-accent/40 px-2.5 py-0.5 text-xs font-bold text-sys-accent">
                            <span className="h-2 w-2 rounded-full bg-sys-accent animate-pulse" />
                            ще 25 хв
                          </span>
                        </div>
                        <div className="font-bold text-base text-sys-text-primary">[Поточна пара — триває зараз]</div>
                        <div className="text-xs text-sys-text-secondary">[ПІБ викладача — приклад]</div>
                        <div className="h-1 w-full rounded-full bg-sys-accent/20 overflow-hidden">
                          <div className="h-full bg-sys-accent rounded-full w-2/3" />
                        </div>
                      </div>
                    )}

                    {demoDay === "Вт" && (
                      <div className="rounded-2xl border border-sys-border bg-sys-card p-4 space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-bold text-sys-text-secondary">1 · 09:00–10:20</span>
                          <span className="rounded-md bg-amber-500/20 text-amber-400 font-bold px-2 py-0.5 text-xs">Заміна</span>
                        </div>
                        <div className="font-bold text-base text-sys-text-primary">[Предмет заміни — приклад]</div>
                        <div className="text-xs text-sys-text-secondary">[Викладач — приклад]</div>
                      </div>
                    )}

                    {demoDay === "Ср" && (
                      <div className="rounded-2xl border border-sys-border bg-sys-card p-4 space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-bold text-sys-text-secondary">2 · 10:40–12:00</span>
                          <span className="text-xs font-semibold text-sys-text-muted">ауд. 204</span>
                        </div>
                        <div className="font-bold text-base text-sys-text-primary">[Стандартна лекція]</div>
                        <div className="text-xs text-sys-text-secondary">[Викладач — приклад]</div>
                      </div>
                    )}

                    {demoDay === "Чт" && (
                      <div className="rounded-2xl border border-sys-border bg-sys-card p-4 space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-bold text-sys-text-secondary">1 · 09:00–09:50</span>
                          <span className="rounded-md bg-blue-500/20 text-blue-400 font-bold px-2 py-0.5 text-xs">⏱ 50 хв</span>
                        </div>
                        <div className="font-bold text-base text-sys-text-primary">[Скорочений день]</div>
                        <div className="text-xs text-sys-text-secondary">[Викладач — приклад]</div>
                      </div>
                    )}

                    {demoDay === "Пт" && (
                      <div className="py-6 text-center text-sys-text-muted text-xs font-semibold">
                        🎉 Пар немає · Розклад на цей день вільний
                      </div>
                    )}

                    <div className="text-[11px] text-center text-sys-text-muted">
                      👆 Натискай дні, щоб подивитися різні статуси занять
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {/* STEP 2: Online Meetings */}
            {currentStep === 2 && (
              <motion.div
                key="step2"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.18 }}
                className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center"
              >
                {/* Left: Text */}
                <div className="md:col-span-5 space-y-3.5">
                  <span className="text-xs font-bold uppercase tracking-wider text-sys-accent">03 · Дистанційні пари</span>
                  <h3 className="text-2xl font-black text-sys-text-primary tracking-tight leading-tight">
                    Онлайн-пари та Meet
                  </h3>
                  <p className="text-xs sm:text-sm text-sys-text-secondary leading-relaxed">
                    Прямі посилання на відеодзвінки доступні лише студентам своєї групи.
                  </p>

                  <div className="space-y-2.5 pt-1 text-xs sm:text-sm text-sys-text-secondary">
                    <div className="flex items-start gap-2.5">
                      <span className="text-sys-accent font-bold mt-0.5">✦</span>
                      <span>
                        <strong>Замок:</strong> якщо пошту не підключено, відображається захищена кнопка <span className="font-semibold text-slate-300">🔒 Meet</span>.
                      </span>
                    </div>
                    <div className="flex items-start gap-2.5">
                      <span className="text-sys-accent font-bold mt-0.5">✦</span>
                      <span>
                        <strong>Розблокування:</strong> натисни на кнопку замка або на <span className="font-semibold text-sys-accent">Прив'язати Classroom</span> у шапці та увійди зі студентського Google-акаунта.
                      </span>
                    </div>
                  </div>
                </div>

                {/* Right: Live Interactive Card */}
                <div className="md:col-span-7 flex flex-col items-center justify-center">
                  <div className="w-full max-w-md rounded-2xl border border-sys-border bg-sys-bg p-4 sm:p-5 shadow-lg space-y-3">
                    {/* Switcher to simulate linked / unlinked state */}
                    <div className="flex items-center justify-between pb-2 border-b border-sys-border/40">
                      <span className="text-xs font-bold text-sys-text-secondary">Статус акаунта:</span>
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

                    {/* Lesson Card with Meet button */}
                    <div className="rounded-2xl border border-sys-border bg-sys-card p-4 space-y-3">
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

                      <div className="font-bold text-base text-sys-text-primary">[Дистанційна пара — приклад]</div>
                      <div className="text-xs text-sys-text-secondary">[ПІБ викладача — приклад]</div>

                      {demoToast && (
                        <div className="rounded-xl border border-sys-border/80 bg-sys-bg p-2.5 text-xs text-sys-text-primary font-medium animate-in fade-in">
                          {demoToast}
                        </div>
                      )}
                    </div>

                    <div className="text-[11px] text-center text-sys-text-muted">
                      👆 Натискай на кнопку Meet, щоб побачити поведінку
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {/* STEP 3: Homework & Classroom */}
            {currentStep === 3 && (
              <motion.div
                key="step3"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.18 }}
                className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center"
              >
                {/* Left: Text */}
                <div className="md:col-span-5 space-y-3.5">
                  <span className="text-xs font-bold uppercase tracking-wider text-sys-accent">04 · Завдання</span>
                  <h3 className="text-2xl font-black text-sys-text-primary tracking-tight leading-tight">
                    Домашні завдання
                  </h3>
                  <p className="text-xs sm:text-sm text-sys-text-secondary leading-relaxed">
                    Завдання та оцінки підтягуються з Classroom автоматично без ручних позначок.
                  </p>

                  <div className="space-y-2.5 pt-1 text-xs sm:text-sm text-sys-text-secondary">
                    <div className="flex items-start gap-2.5">
                      <span className="text-sys-accent font-bold mt-0.5">✦</span>
                      <span>
                        <strong>ДЗ на парі:</strong> активні завдання видно прямо під предметом із дедлайнами.
                      </span>
                    </div>
                    <div className="flex items-start gap-2.5">
                      <span className="text-sys-accent font-bold mt-0.5">✦</span>
                      <span>
                        <strong>Здані роботи:</strong> коли завдання здано в Classroom, плашка стає зеленою (<span className="font-semibold text-emerald-400">Усе здано</span>), де можна побачити оцінку.
                      </span>
                    </div>
                  </div>
                </div>

                {/* Right: Live Interactive Card with Homework Accordions */}
                <div className="md:col-span-7 flex flex-col items-center justify-center">
                  <div className="w-full max-w-md rounded-2xl border border-sys-border bg-sys-bg p-4 sm:p-5 shadow-lg space-y-3">
                    <div className="rounded-2xl border border-sys-border bg-sys-card p-4 space-y-2.5">
                      <div className="flex items-center justify-between text-xs font-bold text-sys-text-secondary">
                        <span>3 · 12:30–13:50</span>
                        <span className="text-sys-text-muted font-normal">ауд. 101</span>
                      </div>
                      <div className="font-bold text-base text-sys-text-primary">[Назва предмета — приклад]</div>

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
                        <div className="rounded-xl border border-sys-border bg-sys-bg p-2 space-y-1.5 text-xs animate-in fade-in">
                          <div className="flex justify-between py-0.5">
                            <span className="text-sys-text-secondary">[Практична робота №4]</span>
                            <span className="text-amber-400 font-bold">Сьогодні ↗</span>
                          </div>
                          <div className="flex justify-between py-0.5">
                            <span className="text-sys-text-secondary">[Тест до теми]</span>
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
                          <span className="text-sys-text-secondary">[Лабораторна №3]</span>
                          <span className="text-emerald-400 font-bold">Оцінка: 11/12 ↗</span>
                        </div>
                      )}
                    </div>

                    <div className="text-[11px] text-center text-sys-text-muted">
                      👆 Натискай на плашки, щоб розкрити список завдань
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {/* STEP 4: Personalization & Themes */}
            {currentStep === 4 && (
              <motion.div
                key="step4"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.18 }}
                className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center"
              >
                {/* Left: Text */}
                <div className="md:col-span-5 space-y-3.5">
                  <span className="text-xs font-bold uppercase tracking-wider text-sys-accent">05 · Персоналізація</span>
                  <h3 className="text-2xl font-black text-sys-text-primary tracking-tight leading-tight">
                    Теми та палітри
                  </h3>
                  <p className="text-xs sm:text-sm text-sys-text-secondary leading-relaxed">
                    У налаштуваннях можна налаштувати тему та закріпити свою підгрупу.
                  </p>

                  <div className="space-y-2.5 pt-1 text-xs sm:text-sm text-sys-text-secondary">
                    <div className="flex items-start gap-2.5">
                      <span className="text-sys-accent font-bold mt-0.5">✦</span>
                      <span>
                        <strong>Закріпи підгрупу:</strong> обери підгрупу раз у налаштуваннях, і пари фільтруватимуться автоматично.
                      </span>
                    </div>
                    <div className="flex items-start gap-2.5">
                      <span className="text-sys-accent font-bold mt-0.5">✦</span>
                      <span>
                        <strong>6 кольорів:</strong> обирай колірний акцент під настрій — від спокійного Океану до яскравого Бурштину.
                      </span>
                    </div>
                  </div>
                </div>

                {/* Right: Live Interactive Palette Preview */}
                <div className="md:col-span-7 flex flex-col items-center justify-center">
                  <div className="w-full max-w-md rounded-2xl border border-sys-border bg-sys-bg p-4 sm:p-5 shadow-lg space-y-3">
                    <div className="text-xs font-bold text-sys-text-secondary pb-1 border-b border-sys-border/40">
                      Обери кольорову палітру:
                    </div>

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

                    {/* Preview card styled with selected palette */}
                    <div className={`rounded-2xl border ${accentColors[demoAccent].border} bg-sys-card p-3.5 space-y-1.5 transition-colors duration-200`}>
                      <div className="flex items-center justify-between text-xs">
                        <span className={`font-black ${accentColors[demoAccent].text}`}>Прев'ю розкладу</span>
                        <span className={`rounded-full ${accentColors[demoAccent].soft} ${accentColors[demoAccent].text} px-2 py-0.5 text-[10px] font-bold`}>
                          Акцент
                        </span>
                      </div>
                      <div className="text-xs text-sys-text-secondary">
                        Колір кнопок, живої пари та акцентів розкладу миттєво підлаштується.
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {/* STEP 5: PWA & Offline */}
            {currentStep === 5 && (
              <motion.div
                key="step5"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.18 }}
                className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center"
              >
                {/* Left: Text */}
                <div className="md:col-span-5 space-y-3.5">
                  <span className="text-xs font-bold uppercase tracking-wider text-sys-accent">06 · Додаток PWA</span>
                  <h3 className="text-2xl font-black text-sys-text-primary tracking-tight leading-tight">
                    Робота без інтернету
                  </h3>
                  <p className="text-xs sm:text-sm text-sys-text-secondary leading-relaxed">
                    Розклад зберігається на пристрої та відкривається навіть без мережі.
                  </p>

                  <div className="space-y-2.5 pt-1 text-xs sm:text-sm text-sys-text-secondary">
                    <div className="flex items-start gap-2.5">
                      <span className="text-sys-accent font-bold mt-0.5">✦</span>
                      <span>
                        <strong>Автономність:</strong> тижні, які ти відкривав, зберігаються на пристрої й доступні офлайн.
                      </span>
                    </div>
                    <div className="flex items-start gap-2.5">
                      <span className="text-sys-accent font-bold mt-0.5">✦</span>
                      <span>
                        <strong>Додай на екран:</strong> розклад запускатиметься як окремий додаток без зайвих вкладок.
                      </span>
                    </div>
                  </div>
                </div>

                {/* Right: Live Interactive Card */}
                <div className="md:col-span-7 flex flex-col items-center justify-center">
                  <div className="w-full max-w-md rounded-2xl border border-sys-border bg-sys-bg p-4 sm:p-5 shadow-lg space-y-3">
                    <div className="rounded-2xl border border-sys-border bg-sys-card p-4 space-y-2.5">
                      <div className="text-xs font-bold text-sys-text-primary">
                        {isDesktop ? "💻 Комп'ютер (Chrome / Edge):" : "📱 Мобільний телефон:"}
                      </div>
                      <p className="text-xs text-sys-text-secondary leading-relaxed">
                        {isDesktop ? (
                          <>Натисни на іконку встановлення додатка справа в адресному рядку браузера — розклад закріпиться на панелі завдань.</>
                        ) : (
                          <>На <strong>iPhone</strong> натисни «Поділитися» ⎋ → «На початковий екран» ⊞. На <strong>Android</strong> скористайся меню Chrome (⋮).</>
                        )}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => setPwaFeedback(isDesktop ? "Значок додатка знаходиться праворуч в адресному рядку браузера." : "Використовуй меню браузера для додавання на екран.")}
                      className="w-full rounded-xl bg-sys-accent px-4 py-2.5 text-xs font-bold text-slate-900 hover:opacity-90 active:scale-95 transition-all shadow-md"
                    >
                      Перевірити встановлення
                    </button>

                    {pwaFeedback && (
                      <div className="rounded-xl border border-sys-border bg-sys-card p-2.5 text-xs text-sys-text-primary text-center font-medium animate-in fade-in">
                        {pwaFeedback}
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer Navigation */}
        <footer className="flex items-center justify-between border-t border-sys-border/50 px-5 py-3.5 bg-sys-card/90 shrink-0">
          <button
            type="button"
            onClick={handlePrev}
            disabled={currentStep === 0}
            className="rounded-xl border border-sys-border bg-sys-bg px-4 py-2 text-xs sm:text-sm font-bold text-sys-text-secondary hover:text-sys-text-primary disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
          >
            Назад
          </button>

          <span className="text-xs font-bold text-sys-text-muted">
            {currentStep + 1} / {totalSteps}
          </span>

          <button
            type="button"
            onClick={handleNext}
            className="rounded-xl bg-sys-accent px-5 py-2 text-xs sm:text-sm font-bold text-slate-900 hover:opacity-90 active:scale-95 transition-all shadow-md"
          >
            {currentStep === totalSteps - 1
              ? (isOnboarding ? "Перейти до розкладу" : "Зрозуміло")
              : "Далі →"}
          </button>
        </footer>

      </div>
    </div>
  );
}
