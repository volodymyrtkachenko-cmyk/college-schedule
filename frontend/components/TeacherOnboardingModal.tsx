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
  tabLabel: string;
  title: string;
  subtitle: string;
}

export function TeacherOnboardingModal({
  teacherId,
  teacherName,
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
      tabLabel: "1. PIN-доступ",
      title: "Персональний PIN-код викладача",
      subtitle: "Введіть PIN-код один раз, щоб розблокувати прямі посилання на Google Meet та Zoom на всіх ваших заняттях.",
    },
    {
      id: "appearance",
      tabLabel: "2. Оформлення",
      title: "Тема та колірний акцент",
      subtitle: "Оберіть темну або світлу тему та зручну кольорову палітру для щоденної роботи.",
    },
    {
      id: "overview",
      tabLabel: "3. Можливості",
      title: "Інструменти для викладача",
      subtitle: "Автоматичний підрахунок вичитаних годин за семестр, радар замін та швидкий перехід до розкладу груп.",
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

  const handleFinish = () => {
    onComplete(teacherId);
  };

  const isUnlocked = pinSuccess || isTeacherUnlocked;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 sm:bg-black/70 sm:backdrop-blur-xs p-0 sm:p-4 animate-in fade-in duration-150">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="teacher-onboarding-title"
        className="w-full sm:max-w-[520px] max-h-[94dvh] sm:max-h-[90vh] flex flex-col rounded-t-2xl sm:rounded-2xl border border-sys-border bg-sys-card text-sys-text-primary shadow-2xl overflow-hidden select-none"
      >
        {/* HEADER */}
        <header className="px-4 pt-3.5 pb-2.5 bg-sys-surface border-b border-sys-border space-y-2.5 shrink-0">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h2 id="teacher-onboarding-title" className="text-sm sm:text-base font-bold text-sys-text-primary truncate">
                Налаштування викладача {teacherName ? `· ${teacherName}` : ""}
              </h2>
              <p className="text-[11px] text-sys-text-secondary">
                Крок {currentStepIndex + 1} із {steps.length}
              </p>
            </div>

            <button
              type="button"
              onClick={handleFinish}
              className="rounded-lg border border-sys-border bg-sys-bg px-2.5 py-1 text-xs font-semibold text-sys-text-secondary hover:text-sys-text-primary transition-colors cursor-pointer shrink-0"
            >
              Пропустити
            </button>
          </div>

          <div className="grid grid-cols-3 gap-1 rounded-xl border border-sys-border bg-sys-bg p-1 text-[11px] font-semibold">
            {steps.map((s, idx) => {
              const isCurrent = idx === currentStepIndex;
              const isDone = idx < currentStepIndex;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setCurrentStepIndex(idx)}
                  className={`py-1.5 px-2 rounded-lg transition-colors cursor-pointer truncate ${
                    isCurrent
                      ? "bg-sys-card text-sys-accent font-bold border border-sys-border shadow-2xs"
                      : isDone
                      ? "text-sys-status-okText font-bold"
                      : "text-sys-text-secondary hover:text-sys-text-primary"
                  }`}
                >
                  {isDone ? `✓ ${s.tabLabel.split(". ")[1]}` : s.tabLabel}
                </button>
              );
            })}
          </div>
        </header>

        {/* MAIN CONTENT WITH LIVE PREVIEW STAGE */}
        <main className="flex-1 overflow-y-auto custom-scrollbar p-4">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentStep.id}
              initial={{ opacity: 0, x: 14 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -14 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              className="space-y-4"
            >
              {/* LIVE STAGE */}
              <div className="rounded-2xl border border-sys-border bg-sys-bg p-3.5 shadow-inner space-y-2">
                <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-sys-text-muted">
                  <span>Живий вигляд вашого розкладу</span>
                  <span className={isUnlocked ? "text-sys-status-okText" : "text-sys-status-warnText"}>
                    {isUnlocked ? "Онлайн-пари розблоковано ✓" : "Онлайн-пари під замком 🔒"}
                  </span>
                </div>

                <div className="rounded-2xl border border-sys-border bg-sys-card p-3.5 shadow-sm space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-sys-text-secondary">
                      1 пара · 09:00–10:20
                    </span>
                    {isUnlocked ? (
                      <span className="inline-flex h-7 px-2.5 items-center gap-1.5 rounded-lg border border-sys-status-infoBg/45 bg-sys-status-infoBg/15 text-sys-status-infoText text-xs font-bold">
                        <span>Zoom · код: dfkr ↗</span>
                      </span>
                    ) : (
                      <span className="inline-flex h-7 px-2.5 items-center gap-1.5 rounded-lg border border-sys-status-warnBg/45 bg-sys-status-warnBg/15 text-sys-status-warnText text-xs font-bold">
                        <span>🔒 Zoom</span>
                      </span>
                    )}
                  </div>

                  <div className="text-sm font-bold text-sys-text-subject">
                    Комп&apos;ютерна схемотехніка
                  </div>

                  <div className="flex items-center justify-between text-xs text-sys-text-secondary">
                    <span>Група: <strong className="text-sys-accent underline underline-offset-2">85 (КІ-24-2/9)</strong></span>
                    <span>🚪 ауд. 305</span>
                  </div>
                </div>
              </div>

              {/* STEP CONTROLS */}
              <div className="space-y-3">
                <div>
                  <h3 className="text-base font-bold text-sys-text-primary">{currentStep.title}</h3>
                  <p className="text-xs text-sys-text-secondary mt-0.5 leading-relaxed">
                    {currentStep.subtitle}
                  </p>
                </div>

                {currentStep.id === "pin" && (
                  <div className="rounded-xl border border-sys-border bg-sys-bg p-3.5 space-y-2.5">
                    {isUnlocked ? (
                      <div className="rounded-xl border border-sys-status-okBg/45 bg-sys-status-okBg/15 p-3 text-xs font-bold text-sys-status-okText">
                        ✓ PIN-код викладача підтверджено! Усі посилання на Google Meet та Zoom відкриті.
                      </div>
                    ) : (
                      <form onSubmit={handleVerifyPin} className="space-y-2">
                        <div className="flex gap-2">
                          <input
                            type="password"
                            inputMode="text"
                            autoComplete="off"
                            placeholder="Введіть PIN-код викладача..."
                            value={pinInput}
                            onChange={(e) => {
                              setPinInput(e.target.value);
                              setPinError("");
                            }}
                            className="flex-1 h-10 rounded-xl border border-sys-border bg-sys-card px-3.5 text-xs font-mono tracking-wider text-sys-text-primary placeholder:text-sys-text-muted focus:border-sys-accent focus:outline-none"
                          />
                          <button
                            type="submit"
                            disabled={isVerifyingPin || !pinInput.trim()}
                            className="rounded-xl bg-sys-accent px-4 text-xs font-bold text-white hover:opacity-95 active:scale-95 transition-opacity disabled:opacity-40 cursor-pointer"
                          >
                            {isVerifyingPin ? "Перевірка..." : "Підтвердити"}
                          </button>
                        </div>
                        {pinError && (
                          <p className="text-xs font-semibold text-sys-status-dangerText">{pinError}</p>
                        )}
                      </form>
                    )}
                  </div>
                )}

                {currentStep.id === "appearance" && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setTheme("dark")}
                        className={`flex items-center justify-center gap-2 rounded-xl py-2.5 px-3 text-xs font-bold border transition-colors cursor-pointer ${
                          resolvedTheme === "dark"
                            ? "bg-sys-accent text-white border-sys-accent"
                            : "bg-sys-bg border-sys-border text-sys-text-secondary hover:text-sys-text-primary"
                        }`}
                      >
                        <span>🌙</span>
                        <span>Темна тема</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setTheme("light")}
                        className={`flex items-center justify-center gap-2 rounded-xl py-2.5 px-3 text-xs font-bold border transition-colors cursor-pointer ${
                          resolvedTheme === "light"
                            ? "bg-sys-accent text-white border-sys-accent"
                            : "bg-sys-bg border-sys-border text-sys-text-secondary hover:text-sys-text-primary"
                        }`}
                      >
                        <span>☀️</span>
                        <span>Світла тема</span>
                      </button>
                    </div>

                    <div className="grid grid-cols-6 gap-1.5">
                      {ACCENT_OPTIONS.map((opt) => {
                        const isSelected = accent === opt.id;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => setAccent(opt.id as AccentColor)}
                            className={`flex flex-col items-center gap-1 rounded-xl p-2 border transition-colors cursor-pointer ${
                              isSelected
                                ? "border-sys-accent bg-sys-accent/15"
                                : "border-sys-border bg-sys-bg text-sys-text-secondary hover:text-sys-text-primary"
                            }`}
                          >
                            <span className="h-4 w-4 rounded-full" style={{ backgroundColor: opt.colorHex }} />
                            <span className="text-[10px] font-bold truncate">{opt.label.split(" ")[0]}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {currentStep.id === "overview" && (
                  <div className="space-y-2 text-xs">
                    <div className="rounded-xl border border-sys-border bg-sys-bg p-3 flex items-start gap-2.5">
                      <span className="font-bold text-sys-accent">📊</span>
                      <div>
                        <div className="font-bold text-sys-text-primary">Статистика проведених пар та годин</div>
                        <div className="text-[11px] text-sys-text-secondary mt-0.5">
                          Автоматичний підрахунок вичитаних годин по кожній групі та предмету з урахуванням замін.
                        </div>
                      </div>
                    </div>
                    <div className="rounded-xl border border-sys-border bg-sys-bg p-3 flex items-start gap-2.5">
                      <span className="font-bold text-sys-status-warnText">⚡</span>
                      <div>
                        <div className="font-bold text-sys-text-primary">Радар замін та експорт у Telegram</div>
                        <div className="text-[11px] text-sys-text-secondary mt-0.5">
                          Наочні бейджі перенесень та генерація картинки розкладу на день або тиждень в 1 клік.
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </AnimatePresence>
        </main>

        {/* FOOTER */}
        <footer className="flex items-center justify-between gap-2 px-4 py-3 border-t border-sys-border bg-sys-surface shrink-0">
          <button
            type="button"
            onClick={() => setCurrentStepIndex((p) => Math.max(0, p - 1))}
            disabled={currentStepIndex === 0}
            className="rounded-xl border border-sys-border bg-sys-card px-3.5 py-2 text-xs font-semibold text-sys-text-secondary hover:text-sys-text-primary disabled:opacity-40 disabled:pointer-events-none active:scale-95 transition-colors cursor-pointer"
          >
            ← Назад
          </button>

          <span className="text-xs font-semibold text-sys-text-muted">
            {currentStepIndex + 1} / {steps.length}
          </span>

          <button
            type="button"
            onClick={() => {
              if (currentStepIndex < steps.length - 1) {
                setCurrentStepIndex((p) => p + 1);
              } else {
                handleFinish();
              }
            }}
            className="rounded-xl bg-sys-accent px-4 py-2 text-xs font-bold text-white hover:opacity-95 active:scale-95 transition-opacity cursor-pointer"
          >
            {currentStepIndex === steps.length - 1 ? "Відкрити розклад ✓" : "Далі →"}
          </button>
        </footer>
      </div>
    </div>
  );
}
