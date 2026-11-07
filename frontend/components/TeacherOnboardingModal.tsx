"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTheme, ACCENT_OPTIONS, AccentColor } from "../lib/useTheme";
import { useTeacherAccess } from "../lib/useTeacherAccess";

export interface TeacherOnboardingModalProps {
  teacherId: number;
  teacherName?: string;
  onClose: () => void;
  onComplete: (finalTeacherId?: number | null) => void;
}

interface OnboardingStep {
  id: "pin" | "appearance" | "overview";
  title: string;
  subtitle: string;
  icon: string;
}

export function TeacherOnboardingModal({
  teacherId,
  teacherName,
  onClose,
  onComplete,
}: TeacherOnboardingModalProps) {
  const { resolvedTheme, setTheme, accent, setAccent } = useTheme();
  const { isTeacherUnlocked, unlockTeacher } = useTeacherAccess();

  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState("");
  const [pinSuccess, setPinSuccess] = useState(isTeacherUnlocked);
  const [isVerifyingPin, setIsVerifyingPin] = useState(false);

  const steps: OnboardingStep[] = [
    {
      id: "pin",
      title: "Персональний PIN-код",
      subtitle: "Введіть PIN-код викладача, щоб розблокувати онлайн-посилання Meet та Zoom на всіх ваших заняттях.",
      icon: "🔒",
    },
    {
      id: "appearance",
      title: "Тема та колірний акцент",
      subtitle: "Обирайте темну або світлу тему та зручний колірний стиль для щоденного перегляду.",
      icon: "🎨",
    },
    {
      id: "overview",
      title: "Ключові можливості розкладу",
      subtitle: "Короткий огляд головних функцій, адаптованих спеціально для викладачів.",
      icon: "⚡",
    },
  ];

  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const currentStep = steps[currentStepIndex] || steps[0];

  const handleVerifyPin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!pinInput.trim()) {
      setPinError("Введіть PIN-код викладача");
      return;
    }

    setIsVerifyingPin(true);
    setPinError("");

    try {
      const res = await unlockTeacher(pinInput.trim());
      setIsVerifyingPin(false);
      if (res.success) {
        setPinSuccess(true);
      } else {
        setPinError(res.error || "Невірний PIN-код викладача");
      }
    } catch {
      setIsVerifyingPin(false);
      setPinError("Помилка перевірки. Спробуйте пізніше.");
    }
  };

  const handleNext = () => {
    if (currentStepIndex < steps.length - 1) {
      setCurrentStepIndex((prev) => prev + 1);
    } else {
      handleFinish();
    }
  };

  const handlePrev = () => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex((prev) => prev - 1);
    }
  };

  const handleFinish = () => {
    onComplete(teacherId);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-5 backdrop-blur-md overflow-hidden animate-in fade-in duration-150">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="teacher-onboarding-title"
        className="relative flex flex-col w-full max-w-lg rounded-3xl border border-sys-border bg-sys-card text-sys-text-primary shadow-2xl overflow-hidden"
      >
        {/* Top Header */}
        <header className="flex items-center justify-between border-b border-sys-border/50 px-5 py-4 bg-sys-card shrink-0">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-sys-accent/15 text-lg shadow-xs"
            >
              {currentStep.icon}
            </span>
            <div>
              <h2
                id="teacher-onboarding-title"
                className="text-sm sm:text-base font-bold leading-tight text-sys-text-primary truncate max-w-[240px]"
              >
                Налаштування викладача
              </h2>
              <p className="text-[11px] text-sys-text-secondary truncate max-w-[240px]">
                Крок {currentStepIndex + 1} з {steps.length} {teacherName ? `· ${teacherName}` : ""}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleFinish}
            className="rounded-xl px-3 py-1.5 text-xs font-semibold text-sys-text-secondary hover:text-sys-text-primary hover:bg-sys-bg transition-colors"
          >
            Пропустити
          </button>
        </header>

        {/* Content Area */}
        <main className="p-5 sm:p-6 space-y-4 min-h-[300px] flex flex-col justify-center">
          <AnimatePresence mode="wait">
            {currentStep.id === "pin" && (
              <motion.div
                key="pin"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.15 }}
                className="space-y-4"
              >
                <div>
                  <h3 className="text-lg sm:text-xl font-black text-sys-text-primary tracking-tight">
                    {currentStep.title}
                  </h3>
                  <p className="text-xs sm:text-sm text-sys-text-secondary mt-1 leading-relaxed">
                    {currentStep.subtitle}
                  </p>
                </div>

                <div className="rounded-2xl border border-sys-border bg-sys-bg p-4 space-y-3 shadow-xs">
                  {pinSuccess ? (
                    <div className="flex items-center gap-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-emerald-700 dark:text-emerald-400 font-bold text-xs sm:text-sm">
                      <span className="text-xl">✅</span>
                      <div>
                        <div>PIN-код успішно підтверджено!</div>
                        <div className="text-xs font-normal text-emerald-700/80 dark:text-emerald-300/80">
                          Усі посилання на онлайн-пари (Google Meet та Zoom) розблоковано.
                        </div>
                      </div>
                    </div>
                  ) : (
                    <form onSubmit={handleVerifyPin} className="space-y-3">
                      <div className="space-y-1.5">
                        <label
                          htmlFor="teacher-pin-input"
                          className="text-xs font-bold text-sys-text-primary flex items-center justify-between"
                        >
                          <span>PIN-код викладача:</span>
                          <span className="text-[11px] text-sys-text-muted font-normal">
                            Наприклад: 4 цифри
                          </span>
                        </label>
                        <div className="flex gap-2">
                          <input
                            id="teacher-pin-input"
                            type="password"
                            inputMode="numeric"
                            autoComplete="off"
                            maxLength={10}
                            placeholder="Введіть PIN..."
                            value={pinInput}
                            onChange={(e) => {
                              setPinInput(e.target.value);
                              setPinError("");
                            }}
                            className="flex-1 h-11 rounded-xl border border-sys-border bg-sys-card px-3.5 text-sm font-mono tracking-wider text-sys-text-primary placeholder:text-sys-text-muted focus:border-sys-accent focus:ring-2 focus:ring-sys-accent focus:outline-none"
                          />
                          <button
                            type="submit"
                            disabled={isVerifyingPin || !pinInput.trim()}
                            className="rounded-xl bg-sys-accent px-4 text-xs font-bold text-white shadow-xs hover:opacity-95 active:scale-95 transition-all disabled:opacity-40"
                          >
                            {isVerifyingPin ? "Перевірка..." : "Підтвердити"}
                          </button>
                        </div>
                      </div>

                      {pinError && (
                        <p className="text-xs text-rose-600 dark:text-rose-400 font-medium">
                          {pinError}
                        </p>
                      )}

                      <p className="text-[11px] text-sys-text-muted leading-relaxed">
                        Не знаєте свій PIN-код? Його можна дізнатися в адміністрації або ввести пізніше в Налаштуваннях.
                      </p>
                    </form>
                  )}
                </div>
              </motion.div>
            )}

            {currentStep.id === "appearance" && (
              <motion.div
                key="appearance"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.15 }}
                className="space-y-4"
              >
                <div>
                  <h3 className="text-lg sm:text-xl font-black text-sys-text-primary tracking-tight">
                    {currentStep.title}
                  </h3>
                  <p className="text-xs sm:text-sm text-sys-text-secondary mt-1">
                    {currentStep.subtitle}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setTheme("dark")}
                    className={`flex items-center justify-center gap-2 rounded-2xl py-3 px-3 text-xs sm:text-sm font-bold border transition-all ${
                      resolvedTheme === "dark"
                        ? "bg-sys-accent text-white border-sys-accent shadow-md scale-[1.02]"
                        : "bg-sys-bg border-sys-border text-sys-text-secondary hover:text-sys-text-primary"
                    }`}
                  >
                    <span>🌙</span>
                    <span>Темна тема</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setTheme("light")}
                    className={`flex items-center justify-center gap-2 rounded-2xl py-3 px-3 text-xs sm:text-sm font-bold border transition-all ${
                      resolvedTheme === "light"
                        ? "bg-sys-accent text-white border-sys-accent shadow-md scale-[1.02]"
                        : "bg-sys-bg border-sys-border text-sys-text-secondary hover:text-sys-text-primary"
                    }`}
                  >
                    <span>☀️</span>
                    <span>Світла тема</span>
                  </button>
                </div>

                <div className="space-y-2 pt-1">
                  <div className="text-xs font-bold text-sys-text-primary">
                    Колірний акцент інтерфейсу:
                  </div>
                  <div className="grid grid-cols-6 gap-2">
                    {ACCENT_OPTIONS.map((opt) => {
                      const isSelected = accent === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setAccent(opt.id as AccentColor)}
                          className={`flex flex-col items-center gap-1.5 rounded-xl p-2 border transition-all ${
                            isSelected
                              ? "border-sys-accent bg-sys-accent/15 shadow-xs scale-105"
                              : "border-sys-border bg-sys-bg hover:border-sys-border/80 text-sys-text-secondary"
                          }`}
                        >
                          <span
                            className="h-5 w-5 rounded-full shadow-xs"
                            style={{ backgroundColor: opt.colorHex }}
                          />
                          <span className="text-[10px] font-bold truncate">
                            {opt.label.split(" ")[0]}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </motion.div>
            )}

            {currentStep.id === "overview" && (
              <motion.div
                key="overview"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.15 }}
                className="space-y-3.5"
              >
                <div>
                  <h3 className="text-lg sm:text-xl font-black text-sys-text-primary tracking-tight">
                    {currentStep.title}
                  </h3>
                  <p className="text-xs sm:text-sm text-sys-text-secondary mt-1 leading-relaxed">
                    {currentStep.subtitle}
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="rounded-xl border border-sys-border bg-sys-bg p-3 flex items-start gap-3 shadow-xs">
                    <span className="text-lg shrink-0 mt-0.5">🔴</span>
                    <div>
                      <div className="text-xs sm:text-sm font-bold text-sys-text-primary">
                        «Жива» пара викладача
                      </div>
                      <div className="text-[11px] text-sys-text-secondary leading-relaxed mt-0.5">
                        Поточне заняття виділяється автоматично: показує точний таймер перерви, аудиторію та закріплену групу.
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-sys-border bg-sys-bg p-3 flex items-start gap-3 shadow-xs">
                    <span className="text-lg shrink-0 mt-0.5">👥</span>
                    <div>
                      <div className="text-xs sm:text-sm font-bold text-sys-text-primary">
                        Групи та потоки
                      </div>
                      <div className="text-[11px] text-sys-text-secondary leading-relaxed mt-0.5">
                        У розкладі чітко видно групу студентів. Спільні лекції об'єднуються, а номер кабінету вказано для кожної пари.
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-sys-border bg-sys-bg p-3 flex items-start gap-3 shadow-xs">
                    <span className="text-lg shrink-0 mt-0.5">📊</span>
                    <div>
                      <div className="text-xs sm:text-sm font-bold text-sys-text-primary">
                        Академічні години та навантаження
                      </div>
                      <div className="text-[11px] text-sys-text-secondary leading-relaxed mt-0.5">
                        Розділ «Статистика» автоматично підраховує вичитані години за всіма предметами та семестровим планом.
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        {/* Persistent Bottom Footer */}
        <footer className="flex items-center justify-between border-t border-sys-border/50 px-5 py-4 bg-sys-card shrink-0">
          <button
            type="button"
            onClick={handlePrev}
            disabled={currentStepIndex === 0}
            className="rounded-xl border border-sys-border bg-sys-bg px-4 py-2 text-xs sm:text-sm font-bold text-sys-text-secondary hover:text-sys-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            ← Назад
          </button>

          {/* Dots Indicator */}
          <div className="flex items-center gap-1.5">
            {steps.map((s, idx) => (
              <span
                key={s.id}
                className={`h-2 rounded-full transition-all duration-200 ${
                  idx === currentStepIndex
                    ? "w-6 bg-sys-accent"
                    : "w-2 bg-sys-border hover:bg-sys-text-muted"
                }`}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={handleNext}
            className="rounded-xl bg-sys-accent px-5 py-2 text-xs sm:text-sm font-bold text-white hover:opacity-95 active:scale-95 transition-all shadow-md"
          >
            {currentStepIndex === steps.length - 1 ? "🚀 До розкладу" : "Далі →"}
          </button>
        </footer>
      </div>
    </div>
  );
}
