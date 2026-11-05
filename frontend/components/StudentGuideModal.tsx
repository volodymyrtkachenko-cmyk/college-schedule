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

  // Demo 1 State (Subgroup)
  const [demoSubgroup, setDemoSubgroup] = useState<"all" | "1" | "2">("all");

  // Demo 2 State (Day tabs)
  const [demoDay, setDemoDay] = useState<"Пн" | "Вт" | "Ср" | "Чт" | "Пт">("Пн");

  // Demo 3 State (Online meet lock)
  const [demoLinked, setDemoLinked] = useState(false);
  const [demoToast, setDemoToast] = useState("");

  // Demo 4 State (Homework accordion)
  const [demoActiveHwOpen, setDemoActiveHwOpen] = useState(false);
  const [demoDoneHwOpen, setDemoDoneHwOpen] = useState(false);

  // Demo 6 State (Install feedback)
  const [pwaFeedback, setPwaFeedback] = useState("");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 sm:p-5 backdrop-blur-sm overflow-hidden animate-in fade-in duration-200">
      <div className="relative flex flex-col w-full max-w-xl max-h-[92vh] sm:max-h-[88vh] rounded-2xl border border-sys-border bg-sys-bg text-sys-text-primary shadow-2xl overflow-hidden">
        
        {/* Header */}
        <header className="flex items-center justify-between border-b border-sys-border/60 px-4 py-3 bg-sys-card shrink-0">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-sys-accent/15 text-sys-accent font-black text-xs">
              ДФКР
            </span>
            <div>
              <h2 className="text-sm font-bold leading-tight">Гід студента</h2>
              <p className="text-[11px] text-sys-text-secondary">
                {isDesktop ? "Версія для комп'ютера" : "Версія для смартфона"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isOnboarding ? (
              <button
                type="button"
                onClick={handleFinishEarly}
                className="rounded-lg px-2.5 py-1 text-xs font-semibold text-sys-text-secondary hover:text-sys-text-primary hover:bg-sys-bg transition-colors"
              >
                Пропустити
              </button>
            ) : (
              <button
                type="button"
                onClick={onClose}
                aria-label="Закрити"
                className="flex h-7 w-7 items-center justify-center rounded-lg text-sys-text-secondary hover:text-sys-text-primary hover:bg-sys-bg transition-colors"
              >
                ✕
              </button>
            )}
          </div>
        </header>

        {/* Progress bar */}
        <div className="px-4 pt-3 pb-2 bg-sys-card/50 border-b border-sys-border/40 shrink-0">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="font-bold text-sys-accent">Крок {currentStep + 1} із {totalSteps}</span>
            <span className="text-[11px] text-sys-text-muted">{Math.round(((currentStep + 1) / totalSteps) * 100)}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-sys-border/60 overflow-hidden">
            <div
              className="h-full rounded-full bg-sys-accent transition-all duration-300 ease-out"
              style={{ width: `${((currentStep + 1) / totalSteps) * 100}%` }}
            />
          </div>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          <AnimatePresence mode="wait">
            {currentStep === 0 && (
              <motion.div
                key="step0"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className="space-y-3"
              >
                <div>
                  <span className="inline-block rounded-full bg-sys-accent/15 border border-sys-accent/30 px-2 py-0.5 text-[11px] font-bold text-sys-accent mb-1.5">
                    Крок 1 із 6 · Початок
                  </span>
                  <h3 className="text-lg font-bold">Перший вхід та вибір групи</h3>
                  <p className="text-xs sm:text-sm text-sys-text-secondary">
                    Застосунок запам'ятовує твою групу з першого разу — обирати її щодня не потрібно.
                  </p>
                </div>

                <ul className="space-y-2 text-xs sm:text-sm text-sys-text-secondary">
                  <li className="flex items-start gap-2">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-sys-accent/15 text-sys-accent font-bold text-xs mt-0.5">1</span>
                    <div>
                      <strong>Перший вхід:</strong> на екрані <span className="rounded bg-sys-card border border-sys-border px-1.5 py-0.5 font-semibold text-sys-text-primary">Вітаємо в ДФКР</span> обирай <span className="rounded bg-sys-card border border-sys-border px-1.5 py-0.5 font-semibold text-sys-text-primary">Студент</span> та знаходь свою групу.
                    </div>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-sys-accent/15 text-sys-accent font-bold text-xs mt-0.5">2</span>
                    <div>
                      {isDesktop ? (
                        <><strong>Перемикання та закріплення:</strong> у лівому кутку шапки є селектор <span className="rounded bg-sys-card border border-sys-border px-1.5 py-0.5 font-semibold text-sys-text-primary">Група: [Назва] ▼</span> із пошуком груп, викладачів та кнопкою закріплення.</>
                      ) : (
                        <><strong>Зміна розкладу:</strong> щоб переглянути іншу групу або розклад викладача, натисни на назву групи <span className="rounded bg-sys-card border border-sys-border px-1.5 py-0.5 font-semibold text-sys-text-primary">[Назва ▼]</span> у центрі шапки.</>
                      )}
                    </div>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-sys-accent/15 text-sys-accent font-bold text-xs mt-0.5">3</span>
                    <div>
                      <strong>Підгрупи:</strong> якщо предмет ділиться на підгрупи, кнопки <span className="rounded bg-sys-card border border-sys-border px-1.5 py-0.5 font-semibold text-sys-text-primary">1 підгр.</span> та <span className="rounded bg-sys-card border border-sys-border px-1.5 py-0.5 font-semibold text-sys-text-primary">2 підгр.</span> у картці пари миттєво приховують чужого викладача.
                    </div>
                  </li>
                </ul>

                {/* Demo 1 */}
                <div className="rounded-xl border border-sys-border bg-sys-card/60 p-3 space-y-2">
                  <div className="flex items-center justify-between text-[11px] pb-1 border-b border-sys-border/50">
                    <span className="font-bold text-sys-accent uppercase tracking-wider">Спробуй · Вибір підгрупи</span>
                    <span className="text-sys-text-muted">Клікни на підгрупу</span>
                  </div>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => setDemoSubgroup("all")}
                      className={`rounded-lg px-2.5 py-1 text-xs font-semibold border transition-colors ${demoSubgroup === "all" ? "bg-sys-accent/20 border-sys-accent text-sys-accent" : "border-sys-border text-sys-text-muted"}`}
                    >
                      Обидві
                    </button>
                    <button
                      type="button"
                      onClick={() => setDemoSubgroup("1")}
                      className={`rounded-lg px-2.5 py-1 text-xs font-semibold border transition-colors ${demoSubgroup === "1" ? "bg-sky-500/20 border-sky-500 text-sky-400" : "border-sys-border text-sys-text-muted"}`}
                    >
                      1 підгр.
                    </button>
                    <button
                      type="button"
                      onClick={() => setDemoSubgroup("2")}
                      className={`rounded-lg px-2.5 py-1 text-xs font-semibold border transition-colors ${demoSubgroup === "2" ? "bg-indigo-500/20 border-indigo-500 text-indigo-400" : "border-sys-border text-sys-text-muted"}`}
                    >
                      2 підгр.
                    </button>
                  </div>

                  <div className="rounded-lg border border-sys-border bg-sys-bg p-2.5 text-xs space-y-1.5">
                    <div className="flex justify-between text-sys-text-muted font-bold text-[11px]">
                      <span>1 · 09:00–10:20</span>
                      <span>Група [приклад]</span>
                    </div>
                    <div className="font-bold text-sys-text-primary text-xs sm:text-sm">[Предмет з підгрупами — приклад]</div>
                    {(demoSubgroup === "all" || demoSubgroup === "1") && (
                      <div className="flex items-center justify-between py-0.5">
                        <span className="text-sky-400 font-semibold">1 підгр. · [Викладач 1 — приклад]</span>
                        <span className="rounded border border-sys-border px-1.5 py-0.5 text-[10px] text-sys-text-secondary">ауд. 1</span>
                      </div>
                    )}
                    {(demoSubgroup === "all" || demoSubgroup === "2") && (
                      <div className="flex items-center justify-between py-0.5">
                        <span className="text-indigo-400 font-semibold">2 підгр. · [Викладач 2 — приклад]</span>
                        <span className="rounded border border-sys-border px-1.5 py-0.5 text-[10px] text-sys-text-secondary">ауд. 2</span>
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            )}

            {currentStep === 1 && (
              <motion.div
                key="step1"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className="space-y-3"
              >
                <div>
                  <span className="inline-block rounded-full bg-sys-accent/15 border border-sys-accent/30 px-2 py-0.5 text-[11px] font-bold text-sys-accent mb-1.5">
                    Крок 2 із 6 · Розклад
                  </span>
                  <h3 className="text-lg font-bold">Дні, тижні та «жива» пара</h3>
                  <p className="text-xs sm:text-sm text-sys-text-secondary">
                    Розклад визначає поточний час за Києвом, показує пари та перерви.
                  </p>
                </div>

                <ul className="space-y-2 text-xs sm:text-sm text-sys-text-secondary">
                  <li className="flex items-start gap-2">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-sys-accent/15 text-sys-accent font-bold text-xs mt-0.5">1</span>
                    <div>
                      {isDesktop ? (
                        <><strong>Вигляд «День» або «Тиждень»</strong>: перемикайся тумблером <span className="rounded bg-sys-card border border-sys-border px-1.5 py-0.5 font-semibold text-sys-text-primary">День</span> | <span className="rounded bg-sys-card border border-sys-border px-1.5 py-0.5 font-semibold text-sys-text-primary">Тиждень</span> між одним днем і повною сіткою 5 днів одразу.</>
                      ) : (
                        <><strong>Дні та тижні:</strong> перемикай дні кнопками <span className="rounded bg-sys-card border border-sys-border px-1.5 py-0.5 font-semibold text-sys-text-primary">Пн</span>–<span className="rounded bg-sys-card border border-sys-border px-1.5 py-0.5 font-semibold text-sys-text-primary">Пт</span> або свайпами. Стрілки <span className="rounded bg-sys-card border border-sys-border px-1.5 py-0.5 font-semibold text-sys-text-primary">‹</span> і <span className="rounded bg-sys-card border border-sys-border px-1.5 py-0.5 font-semibold text-sys-text-primary">›</span> перемикають тиждень.</>
                      )}
                    </div>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-sys-accent/15 text-sys-accent font-bold text-xs mt-0.5">2</span>
                    <div>
                      <strong>Дзвінки та жива пара:</strong> стандартні пари тривають з 09:00, 10:40, 12:30 та 14:00 (у скорочений день — бейдж <span className="rounded bg-sys-card border border-sys-border px-1.5 py-0.5 font-semibold text-sys-text-primary">50 хв</span>). Поточна пара підсвічується плашкою <span className="rounded bg-sys-card border border-sys-border px-1.5 py-0.5 font-semibold text-sys-text-primary">ще N хв</span>.
                    </div>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-sys-accent/15 text-sys-accent font-bold text-xs mt-0.5">3</span>
                    <div>
                      <strong>Зміни та копіювання:</strong> заміни та скасування позначені бейджами <span className="rounded bg-sys-card border border-sys-border px-1.5 py-0.5 font-semibold text-sys-text-primary">Заміна</span> або <span className="rounded bg-sys-card border border-sys-border px-1.5 py-0.5 font-semibold text-sys-text-primary">Скасовано</span>. Кнопки <span className="rounded bg-sys-card border border-sys-border px-1.5 py-0.5 font-semibold text-sys-text-primary">Зберегти картинку</span> та <span className="rounded bg-sys-card border border-sys-border px-1.5 py-0.5 font-semibold text-sys-text-primary">Поділитися</span> копіюють розклад.
                    </div>
                  </li>
                </ul>

                {/* Demo 2 */}
                <div className="rounded-xl border border-sys-border bg-sys-card/60 p-3 space-y-2">
                  <div className="flex items-center justify-between text-[11px] pb-1 border-b border-sys-border/50">
                    <span className="font-bold text-sys-accent uppercase tracking-wider">Спробуй · Перемикання днів</span>
                    <span className="text-sys-text-muted">Обери день</span>
                  </div>
                  <div className="grid grid-cols-5 gap-1.5">
                    {(["Пн", "Вт", "Ср", "Чт", "Пт"] as const).map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setDemoDay(d)}
                        className={`rounded-lg py-1.5 text-xs font-bold border transition-colors ${demoDay === d ? "bg-sys-accent/20 border-sys-accent text-sys-accent" : "border-sys-border text-sys-text-muted"}`}
                      >
                        {d}
                      </button>
                    ))}
                  </div>

                  <div className="rounded-lg border border-sys-border bg-sys-bg p-2.5 text-xs space-y-1">
                    {demoDay === "Пн" && (
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-sys-text-secondary">1 · 09:00–10:20</span>
                          <span className="rounded-full bg-sys-accent/15 border border-sys-accent/30 px-2 py-0.5 text-[10px] font-bold text-sys-accent">ще 25 хв</span>
                        </div>
                        <div className="font-bold text-sys-text-primary">[Предмет 1 — приклад]</div>
                      </div>
                    )}
                    {demoDay === "Вт" && (
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-sys-text-secondary">1 · 09:00–10:20</span>
                          <span className="rounded bg-amber-500/20 text-amber-400 font-bold px-1.5 py-0.5 text-[10px]">Заміна</span>
                        </div>
                        <div className="font-bold text-sys-text-primary">[Предмет 2 — приклад]</div>
                      </div>
                    )}
                    {demoDay === "Ср" && (
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-sys-text-secondary">2 · 10:40–12:00</span>
                          <span className="text-sys-text-muted text-[11px]">ауд. 102</span>
                        </div>
                        <div className="font-bold text-sys-text-primary">[Предмет 3 — приклад]</div>
                      </div>
                    )}
                    {demoDay === "Чт" && (
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-sys-text-secondary">1 · 09:00–09:50</span>
                          <span className="rounded bg-blue-500/20 text-blue-400 font-bold px-1.5 py-0.5 text-[10px]">50 хв</span>
                        </div>
                        <div className="font-bold text-sys-text-primary">[Скорочена пара — приклад]</div>
                      </div>
                    )}
                    {demoDay === "Пт" && (
                      <div className="py-2 text-center text-sys-text-muted font-medium">
                        Пар немає · Розклад вільний
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            )}

            {currentStep === 2 && (
              <motion.div
                key="step2"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className="space-y-3"
              >
                <div>
                  <span className="inline-block rounded-full bg-sys-accent/15 border border-sys-accent/30 px-2 py-0.5 text-[11px] font-bold text-sys-accent mb-1.5">
                    Крок 3 із 6 · Онлайн-пари
                  </span>
                  <h3 className="text-lg font-bold">Онлайн-пари та безпека посилань</h3>
                  <p className="text-xs sm:text-sm text-sys-text-secondary">
                    Посилання на пари (Meet / Zoom) відкриті лише для студентів своєї групи.
                  </p>
                </div>

                <ul className="space-y-2 text-xs sm:text-sm text-sys-text-secondary">
                  <li className="flex items-start gap-2">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-sys-accent/15 text-sys-accent font-bold text-xs mt-0.5">1</span>
                    <div>
                      <strong>Захищені посилання:</strong> якщо студентську пошту не підключено, відображається кнопка із замком <span className="rounded bg-sys-card border border-sys-border px-1.5 py-0.5 font-semibold text-sys-text-primary">🔒 Meet</span> або <span className="rounded bg-sys-card border border-sys-border px-1.5 py-0.5 font-semibold text-sys-text-primary">🔒 Zoom</span>.
                    </div>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-sys-accent/15 text-sys-accent font-bold text-xs mt-0.5">2</span>
                    <div>
                      <strong>Як розблокувати:</strong> натисни на <span className="rounded bg-sys-card border border-sys-border px-1.5 py-0.5 font-semibold text-sys-text-primary">🔒 Meet</span> або на кнопку <span className="rounded bg-sys-card border border-sys-border px-1.5 py-0.5 font-semibold text-sys-text-primary">Прив'язати Classroom</span> у шапці та увійди під своїм студентським Google-акаунтом.
                    </div>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-sys-accent/15 text-sys-accent font-bold text-xs mt-0.5">3</span>
                    <div>
                      <strong>Вхід в один клік:</strong> після входу посилання стає зеленим (<span className="rounded bg-emerald-500/15 border border-emerald-500/30 px-1.5 py-0.5 font-semibold text-emerald-400">Meet ↗</span> / <span className="rounded bg-emerald-500/15 border border-emerald-500/30 px-1.5 py-0.5 font-semibold text-emerald-400">Zoom ↗</span>), а дзвінок відкривається миттєво.
                    </div>
                  </li>
                </ul>

                {/* Demo 3 */}
                <div className="rounded-xl border border-sys-border bg-sys-card/60 p-3 space-y-2">
                  <div className="flex items-center justify-between text-[11px] pb-1 border-b border-sys-border/50">
                    <span className="font-bold text-sys-accent uppercase tracking-wider">Спробуй · Розблокування</span>
                    <span className="text-sys-text-muted">Перемкни статус</span>
                  </div>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => { setDemoLinked(false); setDemoToast(""); }}
                      className={`rounded-lg px-2.5 py-1 text-xs font-semibold border transition-colors ${!demoLinked ? "bg-sys-accent/20 border-sys-accent text-sys-accent" : "border-sys-border text-sys-text-muted"}`}
                    >
                      Не прив'язано (🔒)
                    </button>
                    <button
                      type="button"
                      onClick={() => { setDemoLinked(true); setDemoToast(""); }}
                      className={`rounded-lg px-2.5 py-1 text-xs font-semibold border transition-colors ${demoLinked ? "bg-emerald-500/20 border-emerald-500 text-emerald-400" : "border-sys-border text-sys-text-muted"}`}
                    >
                      Classroom прив'язано (✓)
                    </button>
                  </div>

                  <div className="rounded-lg border border-sys-border bg-sys-bg p-2.5 text-xs space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-sys-text-secondary">2 · 10:40–12:00</span>
                      {demoLinked ? (
                        <button
                          type="button"
                          onClick={() => setDemoToast("Відеоконференція Google Meet відкривається у новій вкладці.")}
                          className="rounded-lg bg-emerald-500/15 border border-emerald-500/40 px-2 py-0.5 text-xs font-bold text-emerald-400 hover:bg-emerald-500/25 transition-colors"
                        >
                          Meet ↗
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setDemoToast("Для перегляду онлайн-пари прив'яжіть Google Classroom цієї групи")}
                          className="rounded-lg bg-sys-card border border-sys-border px-2 py-0.5 text-xs font-bold text-sys-text-muted hover:border-sys-accent/40 transition-colors"
                        >
                          🔒 Meet
                        </button>
                      )}
                    </div>
                    <div className="font-bold text-sys-text-primary">[Дистанційна пара — приклад]</div>
                    {demoToast && (
                      <div className="rounded-md border border-sys-border bg-sys-card p-2 text-[11px] font-semibold text-sys-text-primary animate-in fade-in">
                        {demoToast}
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            )}

            {currentStep === 3 && (
              <motion.div
                key="step3"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className="space-y-3"
              >
                <div>
                  <span className="inline-block rounded-full bg-sys-accent/15 border border-sys-accent/30 px-2 py-0.5 text-[11px] font-bold text-sys-accent mb-1.5">
                    Крок 4 із 6 · Завдання
                  </span>
                  <h3 className="text-lg font-bold">Домашні завдання з Classroom</h3>
                  <p className="text-xs sm:text-sm text-sys-text-secondary">
                    Завдання підтягуються з Google Classroom автоматично без ручних позначок.
                  </p>
                </div>

                <ul className="space-y-2 text-xs sm:text-sm text-sys-text-secondary">
                  <li className="flex items-start gap-2">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-sys-accent/15 text-sys-accent font-bold text-xs mt-0.5">1</span>
                    <div>
                      <strong>ДЗ прямо на картці пари:</strong> активні завдання видно під предметом. Натисни <span className="rounded bg-sys-card border border-sys-border px-1.5 py-0.5 font-semibold text-sys-text-primary">2 завдання ▾</span>, щоб розгорнути список робіт і дедлайни.
                    </div>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-sys-accent/15 text-sys-accent font-bold text-xs mt-0.5">2</span>
                    <div>
                      <strong>Здані роботи та оцінки:</strong> коли робота здана в Classroom, плашка стає зеленою — <span className="rounded bg-emerald-500/15 border border-emerald-500/30 px-1.5 py-0.5 font-semibold text-emerald-400">Усе здано</span> або <span className="rounded bg-emerald-500/15 border border-emerald-500/30 px-1.5 py-0.5 font-semibold text-emerald-400">Здано: N завдання ▾</span>. Клікни, щоб переглянути бал.
                    </div>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-sys-accent/15 text-sys-accent font-bold text-xs mt-0.5">3</span>
                    <div>
                      {isDesktop ? (
                        <><strong>Бічна панель завдань:</strong> праворуч від розкладу завжди відкритий список ДЗ із секціями <span className="font-semibold text-sys-text-primary">Прострочено</span>, <span className="font-semibold text-sys-text-primary">Активні</span> та вкладкою <span className="font-semibold text-sys-text-primary">Оцінки</span>.</>
                      ) : (
                        <><strong>Вкладка «Завдання»:</strong> у нижньому меню застосунку є повний список завдань із фільтрами та вкладка <span className="rounded bg-sys-card border border-sys-border px-1.5 py-0.5 font-semibold text-sys-text-primary">📊 Оцінки</span> із середнім балом.</>
                      )}
                    </div>
                  </li>
                </ul>

                <div className="rounded-xl border border-sys-border/60 bg-sys-card/40 p-2.5 text-xs text-sys-text-secondary">
                  💡 <strong>Синхронізація:</strong> статус оновлюється автоматично при поверненні у вкладку розкладу або кожні 15 хвилин (а також миттєво кнопкою <span className="font-semibold text-sys-text-primary">Classroom</span> у шапці).
                </div>

                {/* Demo 4 */}
                <div className="rounded-xl border border-sys-border bg-sys-card/60 p-3 space-y-2">
                  <div className="flex items-center justify-between text-[11px] pb-1 border-b border-sys-border/50">
                    <span className="font-bold text-sys-accent uppercase tracking-wider">Спробуй · Розгортання ДЗ</span>
                    <span className="text-sys-text-muted">Натисни на плашки</span>
                  </div>

                  <div className="rounded-lg border border-sys-border bg-sys-bg p-2.5 text-xs space-y-2">
                    <div className="font-bold text-sys-text-primary">[Назва предмета — приклад]</div>

                    <button
                      type="button"
                      onClick={() => setDemoActiveHwOpen((prev) => !prev)}
                      className="w-full flex items-center justify-between rounded-lg border border-purple-500/30 bg-purple-500/10 px-2.5 py-1.5 text-xs font-bold text-purple-400"
                    >
                      <span>2 завдання · Сьогодні</span>
                      <span>{demoActiveHwOpen ? "▴" : "▾"}</span>
                    </button>
                    {demoActiveHwOpen && (
                      <div className="rounded-md border border-sys-border bg-sys-card p-2 space-y-1 text-[11px]">
                        <div className="flex justify-between">
                          <span>[Практична №4 — приклад]</span>
                          <span className="text-amber-400 font-bold">Сьогодні ↗</span>
                        </div>
                        <div className="flex justify-between">
                          <span>[Тест — приклад]</span>
                          <span className="text-purple-300">до 28 жовт. ↗</span>
                        </div>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => setDemoDoneHwOpen((prev) => !prev)}
                      className="w-full flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-xs font-bold text-emerald-400"
                    >
                      <span>✓ Здано: 1 завдання</span>
                      <span>{demoDoneHwOpen ? "▴" : "▾"}</span>
                    </button>
                    {demoDoneHwOpen && (
                      <div className="rounded-md border border-sys-border bg-sys-card p-2 text-[11px] flex justify-between">
                        <span>[Практична №3 — приклад]</span>
                        <span className="text-emerald-400 font-bold">Оцінка: 11/12 ↗</span>
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            )}

            {currentStep === 4 && (
              <motion.div
                key="step4"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className="space-y-3"
              >
                <div>
                  <span className="inline-block rounded-full bg-sys-accent/15 border border-sys-accent/30 px-2 py-0.5 text-[11px] font-bold text-sys-accent mb-1.5">
                    Крок 5 із 6 · Налаштування
                  </span>
                  <h3 className="text-lg font-bold">Налаштування та теми оформлення</h3>
                  <p className="text-xs sm:text-sm text-sys-text-secondary">
                    У вкладці <strong>«Налаштування»</strong> (іконка шестерні) можна персоналізувати розклад.
                  </p>
                </div>

                <ul className="space-y-2 text-xs sm:text-sm text-sys-text-secondary">
                  <li className="flex items-start gap-2">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-sys-accent/15 text-sys-accent font-bold text-xs mt-0.5">1</span>
                    <div>
                      <strong>Закріплення підгрупи:</strong> обери параметр <span className="rounded bg-sys-card border border-sys-border px-1.5 py-0.5 font-semibold text-sys-text-primary">Моя підгрупа</span> (<span className="rounded bg-sys-card border border-sys-border px-1.5 py-0.5 font-semibold text-sys-text-primary">1 підгрупа</span> чи <span className="rounded bg-sys-card border border-sys-border px-1.5 py-0.5 font-semibold text-sys-text-primary">2 підгрупа</span>), щоб розклад одразу фільтрував потрібні пари.
                    </div>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-sys-accent/15 text-sys-accent font-bold text-xs mt-0.5">2</span>
                    <div>
                      <strong>Тема й кольори:</strong> вибирай темний або світлий режим та одну із 6 акцентних палітр (<span className="rounded bg-sys-card border border-sys-border px-1.5 py-0.5 font-semibold text-sys-text-primary">Океан</span>, <span className="rounded bg-sys-card border border-sys-border px-1.5 py-0.5 font-semibold text-sys-text-primary">Смарагд</span> тощо).
                    </div>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-sys-accent/15 text-sys-accent font-bold text-xs mt-0.5">3</span>
                    <div>
                      <strong>Корисні посилання:</strong> переглядай статистику вичитаних годин та семестровий графік сесій і канікул.
                    </div>
                  </li>
                </ul>

                <div className="rounded-xl border border-sys-border bg-sys-card/60 p-3 text-xs space-y-1.5">
                  <span className="font-bold text-sys-text-primary text-[11px] uppercase tracking-wider block">Палітри оформлення</span>
                  <div className="grid grid-cols-3 gap-1.5">
                    <div className="rounded-md border border-sys-border bg-sys-bg p-2 text-center text-[11px] font-semibold text-sky-400">Океан</div>
                    <div className="rounded-md border border-sys-border bg-sys-bg p-2 text-center text-[11px] font-semibold text-emerald-400">Смарагд</div>
                    <div className="rounded-md border border-sys-border bg-sys-bg p-2 text-center text-[11px] font-semibold text-purple-400">Аметист</div>
                    <div className="rounded-md border border-sys-border bg-sys-bg p-2 text-center text-[11px] font-semibold text-amber-400">Бурштин</div>
                    <div className="rounded-md border border-sys-border bg-sys-bg p-2 text-center text-[11px] font-semibold text-rose-400">Сакура</div>
                    <div className="rounded-md border border-sys-border bg-sys-bg p-2 text-center text-[11px] font-semibold text-teal-400">Лагуна</div>
                  </div>
                </div>
              </motion.div>
            )}

            {currentStep === 5 && (
              <motion.div
                key="step5"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className="space-y-3"
              >
                <div>
                  <span className="inline-block rounded-full bg-sys-accent/15 border border-sys-accent/30 px-2 py-0.5 text-[11px] font-bold text-sys-accent mb-1.5">
                    Крок 6 із 6 · PWA та Офлайн
                  </span>
                  <h3 className="text-lg font-bold">Встановлення та робота без зв'язку</h3>
                  <p className="text-xs sm:text-sm text-sys-text-secondary">
                    Застосунок працює як швидкий додаток на телефоні та комп'ютері.
                  </p>
                </div>

                <ul className="space-y-2 text-xs sm:text-sm text-sys-text-secondary">
                  <li className="flex items-start gap-2">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-sys-accent/15 text-sys-accent font-bold text-xs mt-0.5">1</span>
                    <div>
                      <strong>Робота офлайн:</strong> зберігаються дні та тижні, які ти вже відкривав з інтернетом (застосунок також фоново завантажує наступний тиждень). Без інтернету світиться плашка <span className="rounded bg-sys-card border border-sys-border px-1.5 py-0.5 font-semibold text-sys-text-primary">📡 Немає підключення до інтернету...</span>.
                    </div>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-sys-accent/15 text-sys-accent font-bold text-xs mt-0.5">2</span>
                    <div>
                      {isDesktop ? (
                        <><strong>Комп'ютер (Chrome / Edge):</strong> натисни на іконку встановлення додатка справа в адресному рядку браузера — розклад закріпиться на панелі завдань.</>
                      ) : (
                        <><strong>Встановлення на телефон:</strong> на Android натисни <span className="font-semibold text-sys-text-primary">«Встановити»</span> на банері або в меню Chrome. На iPhone у Safari натисни кнопку <span className="font-semibold text-sys-text-primary">«Поділитися» ⎋</span>, а потім — <span className="font-semibold text-sys-text-primary">«На початковий екран» ⊞</span>.</>
                      )}
                    </div>
                  </li>
                </ul>

                {/* Demo 6 */}
                <div className="rounded-xl border border-sys-border bg-sys-card/60 p-3 space-y-2">
                  <div className="flex items-center justify-between text-[11px] pb-1 border-b border-sys-border/50">
                    <span className="font-bold text-sys-accent uppercase tracking-wider">Підказка</span>
                    <span className="text-sys-text-muted">{isDesktop ? "Комп'ютер" : "Смартфон"}</span>
                  </div>

                  <div className="rounded-lg border border-sys-border bg-sys-bg p-2.5 text-xs text-sys-text-secondary leading-relaxed">
                    {isDesktop ? (
                      <p>У браузері комп'ютера з'являється кнопка <strong>«Встановити розклад»</strong> прямо біля зірочки закладок в адресному рядку.</p>
                    ) : (
                      <p>Для збереження на головний екран скористайся меню браузера — застосунок відкриватиметься миттєво без адресного рядка.</p>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => setPwaFeedback(isDesktop ? "Натисніть на значок встановлення в адресному рядку вашого браузера." : "Використовуйте меню браузера (на iPhone: Поділитися ⎋ → На початковий екран ⊞).")}
                    className="w-full rounded-lg bg-sys-accent px-3 py-2 text-xs font-bold text-slate-900 hover:opacity-90 active:scale-[0.99] transition-all"
                  >
                    Перевірити встановлення
                  </button>
                  {pwaFeedback && (
                    <div className="rounded-md border border-sys-border bg-sys-card p-2 text-[11px] font-semibold text-sys-text-primary animate-in fade-in">
                      {pwaFeedback}
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer Navigation */}
        <footer className="flex items-center justify-between border-t border-sys-border/60 px-4 py-3 bg-sys-card shrink-0">
          <button
            type="button"
            onClick={handlePrev}
            disabled={currentStep === 0}
            className="rounded-xl border border-sys-border bg-sys-bg px-3.5 py-2 text-xs sm:text-sm font-bold text-sys-text-secondary hover:text-sys-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            Назад
          </button>

          <span className="text-xs font-bold text-sys-text-muted">
            {currentStep + 1} / {totalSteps}
          </span>

          <button
            type="button"
            onClick={handleNext}
            className="rounded-xl bg-sys-accent px-4 py-2 text-xs sm:text-sm font-bold text-slate-900 hover:opacity-90 active:scale-95 transition-all"
          >
            {currentStep === totalSteps - 1
              ? (isOnboarding ? "Перейти до розкладу" : "Зрозуміло")
              : "Далі"}
          </button>
        </footer>

      </div>
    </div>
  );
}
