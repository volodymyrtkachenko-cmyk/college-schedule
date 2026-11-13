"use client";

import { useEffect, useState, useMemo } from "react";
import { m, AnimatePresence } from "framer-motion";
import { AppDialog } from "./ui/AppDialog";
import { useUserSettings } from "../lib/useUserSettings";
import { useTheme, ACCENT_OPTIONS, AccentColor } from "../lib/useTheme";
import { useClassroomSubmissions } from "../lib/useClassroomSubmissions";
import { requestClassroomAuth } from "../lib/classroomAuth";
import { api, ScheduleResponse } from "../lib/api";
import { checkScheduleHasSubgroups, extractSubgroupTeacherHints } from "../lib/format";
import { CheckIcon, LockIcon, MoonIcon, SunIcon } from "./ui/Icons";

export interface StudentOnboardingModalProps {
  groupId: number;
  onClose: () => void;
  onComplete: (finalGroupId?: number | null) => void;
}

interface OnboardingStep {
  id: "subgroups" | "appearance" | "classroom";
  tabLabel: string;
  title: string;
  subtitle: string;
}

export function StudentOnboardingModal({
  groupId,
  onComplete,
}: StudentOnboardingModalProps) {
  const { settings, updateSetting } = useUserSettings();
  const { resolvedTheme, setTheme, accent, setAccent } = useTheme();
  const { isLinked, linkedEmail } = useClassroomSubmissions();

  const [activeGroupId, setActiveGroupId] = useState<number>(groupId);
  const [weekSchedule, setWeekSchedule] = useState<ScheduleResponse[]>([]);
  const [hasSubgroups, setHasSubgroups] = useState<boolean>(true);

  const [chosenSubgroup, setChosenSubgroup] = useState<1 | 2 | "all">(
    settings.defaultSubgroup === 1 || settings.defaultSubgroup === 2
      ? settings.defaultSubgroup
      : "all"
  );

  const subgroupHints = useMemo(() => {
    const allLessons = weekSchedule.flatMap((day) => day.lessons || []);
    return extractSubgroupTeacherHints(allLessons);
  }, [weekSchedule]);

  const [isLinkingClassroom, setIsLinkingClassroom] = useState(false);
  const [classroomSuccess, setClassroomSuccess] = useState(false);
  const [classroomError, setClassroomError] = useState("");
  const [groupSwitchNotice, setGroupSwitchNotice] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    api
      .week(activeGroupId)
      .then((data) => {
        if (!isMounted || !Array.isArray(data)) return;
        setWeekSchedule(data);
        const allLessons = data.flatMap((day) => day.lessons || []);
        setHasSubgroups(checkScheduleHasSubgroups(allLessons));
      })
      .catch(() => {});
    return () => {
      isMounted = false;
    };
  }, [activeGroupId]);

  const steps: OnboardingStep[] = useMemo(() => {
    const list: OnboardingStep[] = [];
    if (hasSubgroups) {
      list.push({
        id: "subgroups",
        tabLabel: "1. Підгрупа",
        title: "Оберіть свою підгрупу",
        subtitle: "Чужий викладач і чужий кабінет автоматично сховаються з карток пар.",
      });
    }
    list.push(
      {
        id: "appearance",
        tabLabel: hasSubgroups ? "2. Тема" : "1. Тема",
        title: "Тема та акцент",
        subtitle: "Оберіть зручне оформлення для щоденного користування.",
      },
      {
        id: "classroom",
        tabLabel: hasSubgroups ? "3. Classroom" : "2. Classroom",
        title: "Пошта @kre.dp.ua",
        subtitle: "Відкриває посилання на онлайн-пари (Meet / Zoom), завдання та оцінки.",
      }
    );
    return list;
  }, [hasSubgroups]);

  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  useEffect(() => {
    if (currentStepIndex >= steps.length) {
      setCurrentStepIndex(Math.max(0, steps.length - 1));
    }
  }, [steps.length, currentStepIndex]);

  const currentStep = steps[currentStepIndex] || steps[0];

  const handleSubgroupSelect = (val: 1 | 2 | "all") => {
    setChosenSubgroup(val);
    updateSetting("defaultSubgroup", val);
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
              setGroupSwitchNotice(`Перемкнуто на вашу групу «${res.group_name || detectedId}».`);
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

  const handleFinish = () => {
    onComplete(activeGroupId);
  };

  const sub1Teacher = subgroupHints.sub1[0]?.teacher || "Токарєва О.В.";
  const sub2Teacher = subgroupHints.sub2[0]?.teacher || "Хочинська О.С.";
  const isClassroomReady = isLinked || classroomSuccess;

  return (
    <AppDialog
      isOpen
      onClose={handleFinish}
      variant="sheet"
      maxWidth="480px"
      closeDisabled={isLinkingClassroom}
      labelledBy="onboarding-title"
    >
      <div className="w-full max-h-[92dvh] flex flex-col rounded-t-2xl sm:rounded-2xl border border-sys-border bg-sys-card text-sys-text-primary shadow-2xl overflow-hidden select-none">
        <header className="px-4 pt-3.5 pb-2.5 bg-sys-surface border-b border-sys-border space-y-2.5 shrink-0">
          <div className="flex items-center justify-between gap-2">
            <h2 id="onboarding-title" className="text-sm sm:text-base font-bold text-sys-text-primary">
              Швидке налаштування
            </h2>
            <button
              type="button"
              onClick={handleFinish}
              className="rounded-lg border border-sys-border bg-sys-bg px-2.5 py-1 text-xs font-semibold text-sys-text-secondary hover:text-sys-text-primary transition-colors cursor-pointer"
            >
              Пропустити
            </button>
          </div>

          <div
            className="grid gap-1 rounded-xl border border-sys-border bg-sys-bg p-1 text-[11px] font-semibold"
            style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
          >
            {steps.map((s, idx) => {
              const isCurrent = idx === currentStepIndex;
              const isDone = idx < currentStepIndex;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setCurrentStepIndex(idx)}
                  className={`py-1.5 px-2 rounded-lg transition-colors cursor-pointer truncate inline-flex items-center justify-center gap-1 ${
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

        <main className="flex-1 overflow-y-auto overflow-x-clip [scrollbar-gutter:stable] custom-scrollbar p-4">
          <AnimatePresence mode="wait" initial={false}>
            <m.div
              key={currentStep.id}
              initial={{ opacity: 0, x: 14 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -14 }}
              transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
              className="space-y-4"
            >
              {/* Живий прев'ю-макет реальної LessonCard */}
              <div className="rounded-2xl border border-sys-border bg-sys-bg p-3.5 shadow-inner min-h-[164px] flex flex-col justify-center">
                <div className="rounded-2xl border border-sys-border bg-sys-card p-3.5 shadow-sm space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-base font-black text-sys-text-primary leading-none">2</span>
                      <span className="text-sys-text-muted font-bold text-xs">·</span>
                      <span className="text-xs font-semibold text-sys-text-secondary">10:40–12:00</span>
                    </div>

                    {currentStep.id === "classroom" && !isClassroomReady ? (
                      <span className="inline-flex h-7 px-2.5 items-center gap-1.5 rounded-lg border border-sys-status-warnBg/45 bg-sys-status-warnBg/15 text-sys-status-warnText text-xs font-bold">
                        <LockIcon className="h-3 w-3 shrink-0" />
                        <span>Meet</span>
                      </span>
                    ) : (
                      <span className="inline-flex h-7 px-2.5 items-center gap-1.5 rounded-lg border border-sys-status-okBg/45 bg-sys-status-okBg/15 text-sys-status-okText text-xs font-bold">
                        <span>Meet ↗</span>
                      </span>
                    )}
                  </div>

                  <div className="text-sm font-semibold text-sys-text-subject leading-snug">
                    Іноземна мова (за проф. спрямуванням)
                  </div>

                  {(chosenSubgroup === "all" || chosenSubgroup === 1) && (
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={`inline-flex items-center gap-1.5 h-6 px-2 rounded-md border font-semibold ${
                            chosenSubgroup === 1
                              ? "border-sys-accent/35 bg-sys-accent/15 text-sys-accent"
                              : "border-sys-border bg-sys-bg text-sys-text-secondary"
                          }`}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full ${chosenSubgroup === 1 ? "bg-sys-accent" : "bg-sys-text-muted/60"}`} />
                          <span>1 підгр.</span>
                        </span>
                        <span className="font-medium text-sys-text-secondary truncate">{sub1Teacher}</span>
                      </div>
                      <span className="text-xs font-semibold text-sys-text-secondary">ауд. 302</span>
                    </div>
                  )}

                  {(chosenSubgroup === "all" || chosenSubgroup === 2) && (
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={`inline-flex items-center gap-1.5 h-6 px-2 rounded-md border font-semibold ${
                            chosenSubgroup === 2
                              ? "border-sys-accent/35 bg-sys-accent/15 text-sys-accent"
                              : "border-sys-border bg-sys-bg text-sys-text-secondary"
                          }`}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full ${chosenSubgroup === 2 ? "bg-sys-accent" : "bg-sys-text-muted/60"}`} />
                          <span>2 підгр.</span>
                        </span>
                        <span className="font-medium text-sys-text-secondary truncate">{sub2Teacher}</span>
                      </div>
                      <span className="text-xs font-semibold text-sys-text-secondary">ауд. 204</span>
                    </div>
                  )}

                  {currentStep.id === "classroom" && isClassroomReady && (
                    <div
                      className="flex items-center justify-between rounded-xl bg-sys-bg/60 border border-sys-border px-3 py-2 text-xs"
                      style={{ boxShadow: "inset 3px 0 0 #8b5cf6" }}
                    >
                      <span className="font-semibold text-sys-text-primary truncate">Практична робота №5</span>
                      <span className="font-medium text-sys-status-denomText shrink-0 ml-2">до 15 лист. ↗</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Керування кроком */}
              <div className="space-y-3 min-h-[166px]">
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-sys-text-primary">{currentStep.title}</h3>
                  <p className="text-xs text-sys-text-secondary mt-0.5 leading-relaxed">{currentStep.subtitle}</p>
                </div>

                {currentStep.id === "subgroups" && (
                  <div className="grid grid-cols-3 gap-2">
                    {(
                      [
                        { val: 1 as const, label: "1 підгр.", hint: sub1Teacher },
                        { val: 2 as const, label: "2 підгр.", hint: sub2Teacher },
                        { val: "all" as const, label: "Обидві", hint: "Усі викладачі" },
                      ]
                    ).map((opt) => {
                      const active = chosenSubgroup === opt.val;
                      return (
                        <button
                          key={String(opt.val)}
                          type="button"
                          onClick={() => handleSubgroupSelect(opt.val)}
                          className={`rounded-xl border p-2.5 text-left transition-colors cursor-pointer ${
                            active
                              ? "border-sys-accent bg-sys-accent/15 ring-1 ring-sys-accent/50"
                              : "border-sys-border bg-sys-bg hover:border-sys-accent/40"
                          }`}
                        >
                          <div className={`inline-flex items-center gap-1 text-xs font-bold ${active ? "text-sys-accent" : "text-sys-text-primary"}`}>
                            {active && <CheckIcon className="h-3.5 w-3.5 shrink-0" />}
                            <span>{opt.label}</span>
                          </div>
                          <div className="text-[11px] text-sys-text-secondary truncate mt-0.5">{opt.hint}</div>
                        </button>
                      );
                    })}
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

                {currentStep.id === "classroom" && (
                  <div className="space-y-2">
                    {isClassroomReady ? (
                      <div className="rounded-xl border border-sys-status-okBg/45 bg-sys-status-okBg/15 p-3 text-xs font-bold text-sys-status-okText space-y-1">
                        <div className="inline-flex items-center gap-1.5">
                          <CheckIcon className="h-3.5 w-3.5 shrink-0" />
                          <span>Classroom підключено ({linkedEmail || "активно"})</span>
                        </div>
                        {groupSwitchNotice && (
                          <div className="text-[11px] font-semibold text-sys-status-warnText">{groupSwitchNotice}</div>
                        )}
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={handleClassroomAuth}
                        disabled={isLinkingClassroom}
                        className="w-full rounded-xl bg-sys-accent py-2.5 px-4 text-xs font-bold text-white hover:opacity-95 active:scale-[0.99] transition-opacity disabled:opacity-50 cursor-pointer"
                      >
                        {isLinkingClassroom ? "Підключення..." : "Прив'язати пошту @kre.dp.ua →"}
                      </button>
                    )}

                    <div className="min-h-[18px]">
                      {classroomError && (
                        <p className="text-xs font-semibold text-sys-status-dangerText text-center" role="alert">
                          {classroomError}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </m.div>
          </AnimatePresence>
        </main>

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
