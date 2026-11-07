"use client";

import { useEffect, useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useUserSettings } from "../lib/useUserSettings";
import { useTheme, ACCENT_OPTIONS, AccentColor } from "../lib/useTheme";
import { useClassroomSubmissions } from "../lib/useClassroomSubmissions";
import { requestClassroomAuth } from "../lib/classroomAuth";
import { api, ScheduleResponse } from "../lib/api";
import { checkScheduleHasSubgroups, extractSubgroupTeacherHints } from "../lib/format";

export interface StudentOnboardingModalProps {
  groupId: number;
  onClose: () => void;
  onComplete: (finalGroupId?: number | null) => void;
}

interface OnboardingStep {
  id: "subgroups" | "appearance" | "classroom";
  title: string;
  subtitle: string;
  icon: string;
}

export function StudentOnboardingModal({
  groupId,
  onClose,
  onComplete,
}: StudentOnboardingModalProps) {
  const { settings, updateSetting } = useUserSettings();
  const { resolvedTheme, setTheme, accent, setAccent } = useTheme();
  const { isLinked, linkedEmail } = useClassroomSubmissions();

  const [activeGroupId, setActiveGroupId] = useState<number>(groupId);
  const [weekSchedule, setWeekSchedule] = useState<ScheduleResponse[]>([]);
  const [hasSubgroups, setHasSubgroups] = useState<boolean>(true);

  // Subgroup selection
  const [chosenSubgroup, setChosenSubgroup] = useState<1 | 2 | "all" | null>(
    settings.defaultSubgroup === 1 || settings.defaultSubgroup === 2
      ? settings.defaultSubgroup
      : settings.defaultSubgroup === "all"
        ? "all"
        : null
  );

  const subgroupHints = useMemo(() => {
    const allLessons = weekSchedule.flatMap((day) => day.lessons || []);
    return extractSubgroupTeacherHints(allLessons);
  }, [weekSchedule]);

  // Classroom auth
  const [isLinkingClassroom, setIsLinkingClassroom] = useState(false);
  const [classroomSuccess, setClassroomSuccess] = useState(false);
  const [classroomError, setClassroomError] = useState("");
  const [groupSwitchNotice, setGroupSwitchNotice] = useState<string | null>(null);

  // Fetch schedule to check subgroups
  useEffect(() => {
    let isMounted = true;
    api.week(activeGroupId)
      .then((data) => {
        if (!isMounted || !Array.isArray(data)) return;
        setWeekSchedule(data);
        const allLessons = data.flatMap((day) => day.lessons || []);
        const split = checkScheduleHasSubgroups(allLessons);
        setHasSubgroups(split);
      })
      .catch(() => {});
    return () => {
      isMounted = false;
    };
  }, [activeGroupId]);

  // Steps definition
  const steps: OnboardingStep[] = useMemo(() => {
    const list: OnboardingStep[] = [];
    if (hasSubgroups) {
      list.push({
        id: "subgroups",
        title: "Обери свою підгрупу",
        subtitle: "Розклад автоматично показуватиме твою підгрупу та потрібного викладача.",
        icon: "👥",
      });
    }
    list.push(
      {
        id: "appearance",
        title: "Тема та улюблений колір",
        subtitle: "Обирай режим та колірний акцент, який тобі до вподоби.",
        icon: "🎨",
      },
      {
        id: "classroom",
        title: "Google Classroom",
        subtitle: "Підключи студентську пошту для синхронізації домашніх завдань та оцінок.",
        icon: "📋",
      }
    );
    return list;
  }, [hasSubgroups]);

  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  // Keep step index within bounds if steps change
  useEffect(() => {
    if (currentStepIndex >= steps.length) {
      setCurrentStepIndex(Math.max(0, steps.length - 1));
    }
  }, [steps.length, currentStepIndex]);

  const currentStep = steps[currentStepIndex] || steps[0];

  const handleSubgroupSelect = (val: 1 | 2 | "all" | null) => {
    setChosenSubgroup(val);
    updateSetting("defaultSubgroup", val ?? "all");
  };

  const handleClassroomAuth = async () => {
    if (isLinkingClassroom) return;
    setIsLinkingClassroom(true);
    setClassroomError("");
    setGroupSwitchNotice(null);

    try {
      await requestClassroomAuth({
        groupId: activeGroupId,
        onSuccess: (res: any) => {
          setIsLinkingClassroom(false);
          setClassroomSuccess(true);
          if (res?.group_id) {
            const detectedId = Number(res.group_id);
            if (detectedId && detectedId !== activeGroupId) {
              setGroupSwitchNotice(
                `Твою реальну групу визначено як «${res.group_name || detectedId}» за курсами Classroom.`
              );
              setActiveGroupId(detectedId);
              try {
                localStorage.setItem("schedule:groupId", String(detectedId));
                localStorage.setItem("schedule:classroom_linked_group_id", String(detectedId));
              } catch {}
            }
          }
        },
        onError: (err: any) => {
          setIsLinkingClassroom(false);
          setClassroomError(err?.message || "Не вдалося підключити Google Classroom.");
        },
      });
    } catch (err: any) {
      setIsLinkingClassroom(false);
      setClassroomError(err?.message || "Помилка підключення Google Classroom.");
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
    onComplete(activeGroupId);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-5 backdrop-blur-md overflow-hidden animate-in fade-in duration-150">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        className="relative flex flex-col w-full max-w-lg rounded-3xl border border-sys-border bg-sys-card text-sys-text-primary shadow-2xl overflow-hidden"
      >
        {/* Top Header */}
        <header className="flex items-center justify-between border-b border-sys-border/50 px-5 py-4 bg-sys-card shrink-0">
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-xl bg-sys-accent/15 text-lg shadow-xs">
              {currentStep.icon}
            </span>
            <div>
              <h2 id="onboarding-title" className="text-sm sm:text-base font-bold leading-tight text-sys-text-primary">
                Швидке налаштування
              </h2>
              <p className="text-[11px] text-sys-text-secondary">
                Крок {currentStepIndex + 1} з {steps.length}
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
        <main className="p-5 sm:p-6 space-y-5 min-h-[290px] flex flex-col justify-center">
          <AnimatePresence mode="wait">
            {currentStep.id === "subgroups" && (
              <motion.div
                key="subgroups"
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

                <div className="flex flex-col gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => handleSubgroupSelect(1)}
                    className={`flex items-center justify-between rounded-2xl py-3 px-4 border text-left transition-all ${
                      chosenSubgroup === 1
                        ? "bg-sys-accent text-white border-sys-accent shadow-md scale-[1.01]"
                        : "bg-sys-bg border-sys-border text-sys-text-primary hover:border-sys-accent/40"
                    }`}
                  >
                    <div className="min-w-0 pr-2">
                      <div className="font-bold text-sm">1 підгрупа</div>
                      {subgroupHints.sub1.length > 0 ? (
                        <div className={`text-xs mt-0.5 truncate ${chosenSubgroup === 1 ? "text-white/90 font-medium" : "text-sys-text-secondary"}`}>
                          {subgroupHints.sub1.map((h) => `${h.teacher} (${h.subject})`).join(" • ")}
                        </div>
                      ) : (
                        <div className={`text-xs mt-0.5 ${chosenSubgroup === 1 ? "text-white/90 font-medium" : "text-sys-text-muted"}`}>
                          Перша половина списку групи
                        </div>
                      )}
                    </div>
                    {chosenSubgroup === 1 && <span className="font-bold text-white shrink-0">✓</span>}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSubgroupSelect(2)}
                    className={`flex items-center justify-between rounded-2xl py-3 px-4 border text-left transition-all ${
                      chosenSubgroup === 2
                        ? "bg-sys-accent text-white border-sys-accent shadow-md scale-[1.01]"
                        : "bg-sys-bg border-sys-border text-sys-text-primary hover:border-sys-accent/40"
                    }`}
                  >
                    <div className="min-w-0 pr-2">
                      <div className="font-bold text-sm">2 підгрупа</div>
                      {subgroupHints.sub2.length > 0 ? (
                        <div className={`text-xs mt-0.5 truncate ${chosenSubgroup === 2 ? "text-white/90 font-medium" : "text-sys-text-secondary"}`}>
                          {subgroupHints.sub2.map((h) => `${h.teacher} (${h.subject})`).join(" • ")}
                        </div>
                      ) : (
                        <div className={`text-xs mt-0.5 ${chosenSubgroup === 2 ? "text-white/90 font-medium" : "text-sys-text-muted"}`}>
                          Друга половина списку групи
                        </div>
                      )}
                    </div>
                    {chosenSubgroup === 2 && <span className="font-bold text-white shrink-0">✓</span>}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSubgroupSelect("all")}
                    className={`flex items-center justify-between rounded-2xl py-3 px-4 border text-left transition-all ${
                      chosenSubgroup === "all" || chosenSubgroup === null
                        ? "bg-sys-accent text-white border-sys-accent shadow-md scale-[1.01]"
                        : "bg-sys-bg border-sys-border text-sys-text-primary hover:border-sys-accent/40"
                    }`}
                  >
                    <div className="min-w-0 pr-2">
                      <div className="font-bold text-sm">Обидві підгрупи</div>
                      <div className={`text-xs mt-0.5 ${chosenSubgroup === "all" || chosenSubgroup === null ? "text-white/90 font-medium" : "text-sys-text-secondary"}`}>
                        Показувати викладачів обох підгруп паралельно
                      </div>
                    </div>
                    {(chosenSubgroup === "all" || chosenSubgroup === null) && <span className="font-bold text-white shrink-0">✓</span>}
                  </button>
                </div>

                <div className="text-xs text-sys-text-secondary bg-sys-bg/60 border border-sys-border/60 rounded-xl p-3 flex items-center gap-2">
                  <span className="text-sys-accent font-bold">💡</span>
                  <span>
                    Ви завжди можете змінити підгрупу прямо в картці пари в один клік.
                  </span>
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
                    Колірний акцент:
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

            {currentStep.id === "classroom" && (
              <motion.div
                key="classroom"
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

                <div className="rounded-2xl border border-sys-border bg-sys-bg p-4 space-y-3 shadow-xs">
                  {isLinked || classroomSuccess ? (
                    <div className="flex items-center gap-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-emerald-700 dark:text-emerald-400 font-bold text-xs sm:text-sm">
                      <span className="text-xl">✅</span>
                      <div>
                        <div>Classroom успішно підключено!</div>
                        <div className="text-xs font-normal text-emerald-700/80 dark:text-emerald-300/80">
                          {linkedEmail || "Студентський акаунт синхронізовано"}
                        </div>
                        {groupSwitchNotice && (
                          <div className="text-xs font-semibold text-amber-800 dark:text-amber-300 mt-1">
                            {groupSwitchNotice}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      <button
                        type="button"
                        onClick={handleClassroomAuth}
                        disabled={isLinkingClassroom}
                        className="w-full flex items-center justify-center gap-2 rounded-xl bg-sys-accent px-4 py-3 text-xs sm:text-sm font-bold text-white hover:opacity-95 active:scale-95 transition-all shadow-md disabled:opacity-50"
                      >
                        <span>🔗</span>
                        <span>{isLinkingClassroom ? "Підключення..." : "Підключити студентську пошту"}</span>
                      </button>
                      {classroomError && (
                        <p className="text-xs text-rose-600 dark:text-rose-400 text-center font-medium">{classroomError}</p>
                      )}
                      <p className="text-[11px] text-sys-text-muted text-center leading-relaxed">
                        Необов'язково зараз. Розклад чудово працює і без пошти, а підключитися можна в будь-який момент у Налаштуваннях.
                      </p>
                    </div>
                  )}
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
