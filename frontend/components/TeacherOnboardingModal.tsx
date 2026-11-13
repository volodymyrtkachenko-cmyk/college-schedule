"use client";

import { useState } from "react";
import { AppDialog } from "./ui/AppDialog";
import { useTheme, ACCENT_OPTIONS, AccentColor } from "../lib/useTheme";
import { useTeacherAccess } from "../lib/useTeacherAccess";
import { CheckIcon, LockIcon, MoonIcon, SunIcon } from "./ui/Icons";

export interface TeacherOnboardingModalProps {
  teacherId: number;
  teacherName?: string;
  onClose: () => void;
  onComplete: (finalTeacherId?: number | null) => void;
}

interface OnboardingStep {
  id: "pin" | "appearance";
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
      title: "Вхід для викладача (PIN-код)",
      subtitle: "Введіть PIN-код один раз, щоб відкрити посилання на Meet та Zoom на всіх ваших заняттях.",
    },
    {
      id: "appearance",
      tabLabel: "2. Оформлення",
      title: "Тема та акцент",
      subtitle: "Оберіть темну або світлу тему та зручну кольорову палітру.",
    },
  ];

  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [slideDir, setSlideDir] = useState<1 | -1>(1);
  const [hasStepped, setHasStepped] = useState(false);

  const goToStep = (nextIndex: number) => {
    setSlideDir(nextIndex >= currentStepIndex ? 1 : -1);
    setHasStepped(true);
    setCurrentStepIndex(nextIndex);
  };
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
    <AppDialog
      isOpen
      onClose={handleFinish}
      variant="sheet"
      maxWidth="480px"
      closeDisabled={isVerifyingPin}
      labelledBy="teacher-onboarding-title"
    >
      <div className="w-full max-h-[92dvh] flex flex-col rounded-t-2xl sm:rounded-2xl border border-sys-border bg-sys-card text-sys-text-primary shadow-lg sm:shadow-2xl overflow-hidden select-none">
        <header className="px-4 pt-3.5 pb-2.5 bg-sys-surface border-b border-sys-border space-y-2.5 shrink-0">
          <div className="flex items-center justify-between gap-2">
            <h2 id="teacher-onboarding-title" className="text-sm sm:text-base font-bold text-sys-text-primary truncate">
              Налаштування викладача {teacherName ? `· ${teacherName}` : ""}
            </h2>
            <button
              type="button"
              onClick={handleFinish}
              className="rounded-lg border border-sys-border bg-sys-bg px-2.5 py-1 text-xs font-semibold text-sys-text-secondary hover:text-sys-text-primary transition-colors cursor-pointer shrink-0"
            >
              Пропустити
            </button>
          </div>

          <div className="grid grid-cols-2 gap-1 rounded-xl border border-sys-border bg-sys-bg p-1 text-[11px] font-semibold">
            {steps.map((s, idx) => {
              const isCurrent = idx === currentStepIndex;
              const isDone = idx < currentStepIndex;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => goToStep(idx)}
                  className={`py-1.5 px-2 rounded-lg transition-colors duration-200 cursor-pointer truncate inline-flex items-center justify-center gap-1 ${
                    isCurrent
                      ? "bg-sys-card text-sys-accent font-bold border border-sys-border shadow-2xs"
                      : isDone
                      ? "text-sys-status-okText font-bold"
                      : "text-sys-text-secondary hover:text-sys-text-primary"
                  }`}
                >
                  {isDone ? (
                    <>
                      <CheckIcon className="h-3 w-3 shrink-0" />
                      <span className="truncate">{s.tabLabel.split(". ")[1]}</span>
                    </>
                  ) : (
                    s.tabLabel
                  )}
                </button>
              );
            })}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto overflow-x-clip lg:[scrollbar-gutter:stable] custom-scrollbar p-4">
          <div
            key={currentStep.id}
            data-slide-dir={hasStepped ? (slideDir >= 0 ? "next" : "prev") : undefined}
            className="guide-step-slide space-y-4"
          >
            {/* Живий прев'ю-макет реальної LessonCard викладача */}
            <div className="rounded-2xl border border-sys-border bg-sys-bg p-3.5">
                <div className="rounded-2xl border border-sys-border bg-sys-card p-3.5 shadow-sm space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-base font-black text-sys-text-primary leading-none">1</span>
                      <span className="text-sys-text-muted font-bold text-xs">·</span>
                      <span className="text-xs font-semibold text-sys-text-secondary">09:00–10:20</span>
                    </div>
                    {isUnlocked ? (
                      <span className="inline-flex h-8 px-2.5 items-center gap-1.5 rounded-lg border border-sys-status-infoBg/50 bg-sys-status-infoBg/15 text-sys-status-infoText text-xs font-bold">
                        <span>Zoom ↗</span>
                      </span>
                    ) : (
                      <span className="inline-flex h-8 px-2.5 items-center gap-1.5 rounded-lg border border-sys-status-warnBg/45 bg-sys-status-warnBg/15 text-sys-status-warnText text-xs font-bold">
                        <LockIcon className="h-3 w-3 shrink-0" />
                        <span>Zoom</span>
                      </span>
                    )}
                  </div>

                  <div className="text-sm font-semibold text-sys-text-subject">
                    Комп&apos;ютерна схемотехніка
                  </div>

                  <div className="flex items-center justify-between text-xs text-sys-text-secondary">
                    <span>Група: <strong className="font-semibold text-sys-text-primary">85</strong></span>
                    <span>ауд. 305</span>
                  </div>
                </div>
              </div>

              <div className="space-y-3 min-h-[146px]">
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-sys-text-primary">{currentStep.title}</h3>
                  <p className="text-xs text-sys-text-secondary mt-0.5 leading-relaxed">{currentStep.subtitle}</p>
                </div>

                {currentStep.id === "pin" && (
                  <div>
                    {isUnlocked ? (
                      <div className="inline-flex w-full items-center gap-1.5 rounded-xl border border-sys-status-okBg/45 bg-sys-status-okBg/15 p-3 text-xs font-bold text-sys-status-okText">
                        <CheckIcon className="h-3.5 w-3.5 shrink-0" />
                        <span>Доступ викладача активовано! Усі посилання на пари відкриті.</span>
                      </div>
                    ) : (
                      <form onSubmit={handleVerifyPin} className="space-y-2">
                        <div className="flex gap-2">
                          <input
                            type="password"
                            inputMode="text"
                            autoComplete="off"
                            placeholder="Введіть PIN..."
                            value={pinInput}
                            onChange={(e) => {
                              setPinInput(e.target.value);
                              setPinError("");
                            }}
                            className="flex-1 h-10 rounded-xl border border-sys-border bg-sys-bg px-3.5 text-xs font-mono tracking-wider text-sys-text-primary placeholder:text-sys-text-muted focus:border-sys-accent focus:outline-none"
                          />
                          <button
                            type="submit"
                            disabled={isVerifyingPin || !pinInput.trim()}
                            className="rounded-xl bg-sys-accent px-4 text-xs font-bold text-white hover:opacity-95 active:scale-95 transition-opacity disabled:opacity-40 cursor-pointer"
                          >
                            {isVerifyingPin ? "Перевірка..." : "Розблокувати"}
                          </button>
                        </div>
                        <div className="min-h-[18px]">
                          {pinError && (
                            <p className="text-xs font-semibold text-sys-status-dangerText" role="alert">
                              {pinError}
                            </p>
                          )}
                        </div>
                      </form>
                    )}
                  </div>
                )}

                {currentStep.id === "appearance" && (
                  <div className="space-y-2.5">
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
                        <MoonIcon className="h-3.5 w-3.5" />
                        <span>Темна</span>
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
                        <SunIcon className="h-3.5 w-3.5" />
                        <span>Світла</span>
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
            </div>
          </div>
        </main>

        <footer className="flex items-center justify-between gap-2 px-4 py-3 border-t border-sys-border bg-sys-surface shrink-0">
          <button
            type="button"
            onClick={() => goToStep(Math.max(0, currentStepIndex - 1))}
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
                goToStep(currentStepIndex + 1);
              } else {
                handleFinish();
              }
            }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-sys-accent px-4 py-2 text-xs font-bold text-white hover:opacity-95 active:scale-95 transition-opacity cursor-pointer"
          >
            {currentStepIndex === steps.length - 1 ? (
              <>
                <span>До розкладу</span>
                <CheckIcon className="h-3.5 w-3.5" />
              </>
            ) : (
              <span>Далі →</span>
            )}
          </button>
        </footer>
      </div>
    </AppDialog>
  );
}
