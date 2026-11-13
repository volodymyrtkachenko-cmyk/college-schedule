"use client";

import React, { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useClassroomSubmissions } from "../lib/useClassroomSubmissions";
import { useTeacherAccess } from "../lib/useTeacherAccess";
import { useUserSettings } from "../lib/useUserSettings";
import { useMobileNav } from "../lib/useMobileNav";
import { buildGuideTasksHref, isScheduleRoutePath } from "../lib/navigation";
import { AppDialog } from "./ui/AppDialog";
import { CheckIcon, CloseIcon } from "./ui/Icons";
import { GuideDemoStage } from "./GuideDemoStage";

export interface GuideHubModalProps {
  isOpen?: boolean;
  onClose: () => void;
  initialRole?: "student" | "teacher";
  mode?: "student" | "teacher";
  groupId?: number | null;
  teacherId?: number | null;
  /** Назва обраної групи (з довідника) — лише для бейджа в шапці */
  groupName?: string | null;
  /** ПІБ обраного викладача (з довідника) — лише для бейджа в шапці */
  teacherName?: string | null;
  /** Реальні лічильники з useTaskGroups (null, якщо Classroom не прив'язано) */
  taskCounts?: { pending: number; overdue: number; done: number } | null;
}

interface GuideStepMeta {
  id: string;
  tabLabel: string;
  title: string;
  points: [string, string];
}

const STUDENT_STEPS: GuideStepMeta[] = [
  {
    id: "st-1-classroom",
    tabLabel: "Classroom",
    title: "1. Пошта @kre.dp.ua: відкриття Meet/Zoom та ДЗ",
    points: [
      "Натисніть на закритий бейдж «Meet / Zoom» або кнопку Classroom у шапці й оберіть свій акаунт @kre.dp.ua.",
      "Обмеження доступу зникне, до карток пар підтягнуться актуальні домашні завдання, а дані синхронізуються між ПК і телефоном.",
    ],
  },
  {
    id: "st-2-subgroup",
    tabLabel: "Підгрупи",
    title: "2. Фільтр своєї підгрупи в 1 клік",
    points: [
      "Натисніть на бейдж «1 підгр.» або «2 підгр.» прямо на картці пари — другий викладач і чужий кабінет сховаються.",
      "Повторний клік по бейджу підгрупи миттєво повертає показ обох підгруп.",
    ],
  },
  {
    id: "st-3-zoom",
    tabLabel: "Код Zoom",
    title: "3. Автокопіювання пароля Zoom при кліку",
    points: [
      "Система сама знаходить ID та пароль у тексті викладача з Classroom і створює кнопку «Zoom ↗».",
      "При натисканні на «Zoom ↗» пароль конференції автоматично копіюється в буфер обміну.",
    ],
  },
  {
    id: "st-4-tasks",
    tabLabel: "Завдання",
    title: "4. Усі завдання в одному списку без гортання тижнів",
    points: [
      "У вкладці «Завдання» роботи поділені на «До здачі», «Борги» та «Здано», щоб старі борги не губилися.",
      "Фільтр «Усі предмети» дозволяє залишити завдання лише з потрібної дисципліни.",
    ],
  },
  {
    id: "st-5-grades",
    tabLabel: "Оцінки",
    title: "5. Середній бал та всі оцінки за семестр",
    points: [
      "Вкладка «Оцінки» автоматично рахує загальний середній бал (за 5-бальною та 12-бальною шкалами).",
      "Натисніть на предмет, щоб переглянути всі оцінені роботи з автоматичним перерахунком зі 100-бальної шкали.",
    ],
  },
  {
    id: "st-7-teacher-jump",
    tabLabel: "Викладач",
    title: "6. Швидкий перехід у розклад викладача",
    points: [
      "Натисніть на прізвище викладача на картці пари, щоб побачити його розклад та аудиторію на сьогодні.",
      "Кнопка «← До ...» у верхній плашці поверне вас назад до розкладу своєї групи.",
    ],
  },
];

const TEACHER_STEPS: GuideStepMeta[] = [
  {
    id: "tc-1-pin",
    tabLabel: "PIN-код",
    title: "1. PIN-код для відкриття посилань Meet та Zoom",
    points: [
      "Натисніть на закритий бейдж «Zoom / Meet» або кнопку «Вхід викладача» у шапці та введіть PIN-код один раз.",
      "Усі посилання на онлайн-пари відкриються на цьому пристрої для всіх навчальних груп.",
    ],
  },
  {
    id: "tc-4-stats",
    tabLabel: "Статистика",
    title: "2. Статистика проведених пар та годин",
    points: [
      "Сторінка «Статистика» автоматично рахує вичитані академічні години та пари від початку семестру.",
      "Доступний розподіл навантаження за кожною дисципліною та кожною навчальною групою.",
    ],
  },
  {
    id: "tc-5-radar",
    tabLabel: "Заміни",
    title: "3. Позначки замін та перенесень у розкладі",
    points: [
      "Перенесені заняття підписуються новою датою й номером пари («Перенесено → Четвер, 3 пара»).",
      "Призначені разові заміни виділяються жовтою рамкою та бейджем «Заміна».",
    ],
  },
];

export function GuideHubModal({
  isOpen = true,
  onClose,
  initialRole,
  mode,
  groupName = null,
  teacherName = null,
  taskCounts = null,
}: GuideHubModalProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { setHomeTab } = useMobileNav();
  const { isLinked, linkedEmail } = useClassroomSubmissions();
  const { isTeacherUnlocked } = useTeacherAccess();
  const { settings, updateSetting } = useUserSettings();

  const [role, setRole] = useState<"student" | "teacher">(initialRole ?? mode ?? "student");
  const [stepIdx, setStepIdx] = useState(0);
  const [slideDir, setSlideDir] = useState(1);
  const [hasStepped, setHasStepped] = useState(false);

  const steps = role === "student" ? STUDENT_STEPS : TEACHER_STEPS;
  const stepsCount = steps.length;

  useEffect(() => {
    if (!isOpen || typeof window === "undefined") return;
    setStepIdx(0);
    setHasStepped(false);
    try {
      const storedMode = window.localStorage.getItem("schedule:mode");
      if (!initialRole && !mode && (storedMode === "student" || storedMode === "teacher")) {
        setRole(storedMode);
      } else if (mode || initialRole) {
        setRole(initialRole ?? mode ?? "student");
      }
    } catch {}
  }, [isOpen, initialRole, mode]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") {
        setHasStepped(true);
        setSlideDir(1);
        setStepIdx((c) => Math.min(stepsCount - 1, c + 1));
      }
      if (e.key === "ArrowLeft") {
        setHasStepped(true);
        setSlideDir(-1);
        setStepIdx((c) => Math.max(0, c - 1));
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, stepsCount]);

  const safeIdx = stepIdx < stepsCount ? stepIdx : 0;
  const activeStep = steps[safeIdx] ?? steps[0];

  const goToStep = (nextIdx: number) => {
    if (nextIdx === safeIdx) return;
    setHasStepped(true);
    setSlideDir(nextIdx > safeIdx ? 1 : -1);
    setStepIdx(nextIdx);
  };

  const handleRoleChange = (nextRole: "student" | "teacher") => {
    if (nextRole === role) return;
    setHasStepped(true);
    setSlideDir(nextRole === "teacher" ? 1 : -1);
    setRole(nextRole);
    setStepIdx(0);
  };

  return (
    <AppDialog
      isOpen={isOpen}
      onClose={onClose}
      variant="sheet"
      maxWidth="500px"
      labelledBy="guide-title"
    >
      <div className="w-full max-h-[92dvh] flex flex-col rounded-t-2xl sm:rounded-2xl border border-sys-border bg-sys-card text-sys-text-primary shadow-lg sm:shadow-2xl overflow-hidden select-none">
        {/* 1. ШАПКА + ПЕРЕМИКАЧ РОЛІ + ВКЛАДКИ */}
        <div className="px-4 pt-3.5 pb-2.5 bg-sys-surface border-b border-sys-border space-y-2.5 shrink-0">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 min-h-[36px] flex flex-col justify-center">
              <h2 id="guide-title" className="text-sm sm:text-base font-bold text-sys-text-primary truncate">
                Як користуватися розкладом
              </h2>
              {(role === "student" ? groupName : teacherName) && (
                <p className="text-[11px] font-medium text-sys-text-secondary truncate">
                  {role === "student"
                    ? `Група ${groupName}${settings.defaultSubgroup !== "all" ? ` · ${settings.defaultSubgroup} підгр.` : ""}`
                    : `Викладач: ${teacherName}`}
                </p>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <div className="relative inline-grid grid-cols-2 rounded-lg border border-sys-border bg-sys-bg p-0.5 text-xs font-semibold isolate">
                <div
                  aria-hidden="true"
                  className="absolute top-0.5 bottom-0.5 pointer-events-none transition-transform duration-200 ease-out transform-gpu will-change-transform z-0"
                  style={{
                    left: "2px",
                    width: "calc((100% - 4px) / 2)",
                    transform: `translate3d(${role === "teacher" ? "100%" : "0%"}, 0, 0)`,
                  }}
                >
                  <div className="h-full w-full rounded-md bg-sys-accentSolid shadow-2xs" />
                </div>
                <button
                  type="button"
                  onClick={() => handleRoleChange("student")}
                  className={`relative z-10 px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                    role === "student" ? "text-white font-bold" : "text-sys-text-secondary hover:text-sys-text-primary"
                  }`}
                >
                  Студент
                </button>
                <button
                  type="button"
                  onClick={() => handleRoleChange("teacher")}
                  className={`relative z-10 px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                    role === "teacher" ? "text-white font-bold" : "text-sys-text-secondary hover:text-sys-text-primary"
                  }`}
                >
                  Викладач
                </button>
              </div>

              <button
                type="button"
                onClick={onClose}
                aria-label="Закрити"
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-sys-border bg-sys-bg text-sys-text-secondary hover:text-sys-text-primary active:scale-95 transition-colors cursor-pointer"
              >
                <CloseIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div
            role="tablist"
            aria-label="Розділи гіду"
            className="flex items-center gap-1 overflow-x-auto no-scrollbar rounded-xl border border-sys-border bg-sys-bg p-1 text-[11px] font-semibold"
          >
            {steps.map((s, idx) => {
              const isCurrent = idx === safeIdx;
              const isConfigured =
                role === "student"
                  ? (idx === 0 && isLinked) || (idx === 1 && settings.defaultSubgroup !== "all")
                  : idx === 0 && isTeacherUnlocked;
              return (
                <button
                  key={s.id}
                  type="button"
                  role="tab"
                  aria-selected={isCurrent}
                  onClick={() => goToStep(idx)}
                  className={`shrink-0 flex-1 inline-flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg transition-colors duration-150 cursor-pointer whitespace-nowrap ${
                    isCurrent
                      ? "bg-sys-card text-sys-accent font-bold border border-sys-border shadow-2xs"
                      : "text-sys-text-secondary hover:text-sys-text-primary"
                  }`}
                >
                  <span>{s.tabLabel}</span>
                  {isConfigured && <CheckIcon className="h-3 w-3 text-sys-status-okText shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* 2. СТАБІЛЬНА СЦЕНА + ОПИС БЕЗ СТРИБКІВ РОЗМІРУ */}
        <div className="flex-1 overflow-y-auto overflow-x-clip lg:[scrollbar-gutter:stable] custom-scrollbar p-4">
          <div
            key={`${role}-${activeStep.id}`}
            data-slide-dir={hasStepped ? (slideDir >= 0 ? "next" : "prev") : undefined}
            className="guide-step-slide space-y-3.5"
          >
            <GuideDemoStage role={role} stepIdx={safeIdx} isOpen={isOpen} />

              {/* 3. ЛАКОНІЧНИЙ ОПИС + РЕЗЕРВОВАНИЙ СЛОТ ШВИДКОЇ ДІЇ */}
              <div className="space-y-2.5 px-0.5 flex flex-col justify-between min-h-[168px]">
                <div className="space-y-2">
                  <h3 className="text-sm sm:text-base font-bold text-sys-text-primary leading-snug">
                    {activeStep.title}
                  </h3>

                  <ul className="space-y-1.5 text-xs text-sys-text-secondary leading-relaxed">
                    <li className="flex items-start gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-sys-accent shrink-0" />
                      <span>{activeStep.points[0]}</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-sys-accent shrink-0" />
                      <span>{activeStep.points[1]}</span>
                    </li>
                  </ul>
                </div>

                <div className="min-h-[44px] flex items-center">
                  {role === "student" && safeIdx === 0 && (
                    <div className="w-full flex items-center justify-between rounded-xl border border-sys-border bg-sys-bg px-3 py-2 text-xs">
                      <span className="inline-flex items-center gap-1.5 font-semibold text-sys-text-secondary truncate mr-2">
                        {isLinked ? (
                          <>
                            <CheckIcon className="h-3.5 w-3.5 text-sys-status-okText shrink-0" />
                            <span className="truncate">Підключено: {linkedEmail}</span>
                          </>
                        ) : (
                          <span>Пошту @kre.dp.ua ще не прив&apos;язано</span>
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          setTimeout(() => window.dispatchEvent(new CustomEvent("trigger-classroom-sync")), 120);
                        }}
                        className="shrink-0 rounded-lg bg-sys-accent px-3 py-1.5 text-[11px] font-bold text-white hover:opacity-95 active:scale-95 transition-opacity cursor-pointer"
                      >
                        {isLinked ? "Оновити" : "Прив'язати →"}
                      </button>
                    </div>
                  )}

                  {role === "student" && safeIdx === 1 && (
                    <div className="w-full flex items-center justify-between rounded-xl border border-sys-border bg-sys-bg px-3 py-2 text-xs">
                      <span className="font-semibold text-sys-text-secondary">Ваша підгрупа:</span>
                      <div className="inline-flex gap-1">
                        {(["all", 1, 2] as const).map((sub) => (
                          <button
                            key={String(sub)}
                            type="button"
                            onClick={() => updateSetting("defaultSubgroup", sub)}
                            className={`rounded-lg px-2.5 py-1 text-[11px] font-bold transition-colors cursor-pointer ${
                              settings.defaultSubgroup === sub
                                ? "bg-sys-accent text-white"
                                : "bg-sys-card text-sys-text-secondary border border-sys-border hover:text-sys-text-primary"
                            }`}
                          >
                            {sub === "all" ? "Обидві" : `${sub} підгр.`}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {role === "student" && (safeIdx === 3 || safeIdx === 4) && (
                    <div className="w-full flex items-center justify-between gap-2 rounded-xl border border-sys-border bg-sys-bg px-3 py-2 text-xs">
                      <span className="font-semibold text-sys-text-secondary truncate">
                        {taskCounts ? (
                          <>
                            У вас зараз: <span className="text-sys-text-primary">{taskCounts.pending} до здачі</span>
                            {" · "}
                            <span className={taskCounts.overdue > 0 ? "text-sys-status-dangerText" : ""}>
                              {taskCounts.overdue} борг.
                            </span>
                            {" · "}
                            <span className="text-sys-status-okText">{taskCounts.done} здано</span>
                          </>
                        ) : (
                          "Прив'яжіть @kre.dp.ua, щоб бачити свої завдання"
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          const subtab = safeIdx === 4 ? "grades" : "tasks";
                          const onStudentScheduleRoute =
                            isScheduleRoutePath(pathname) &&
                            !pathname?.startsWith("/teacher/") &&
                            mode !== "teacher";
                          onClose();
                          if (onStudentScheduleRoute) {
                            setHomeTab("tasks");
                            window.dispatchEvent(
                              new CustomEvent("schedule:open-tasks-panel", {
                                detail: { subtab },
                              })
                            );
                          } else {
                            router.push(buildGuideTasksHref(subtab));
                          }
                        }}
                        className="shrink-0 rounded-lg bg-sys-accent px-3 py-1.5 text-[11px] font-bold text-white hover:opacity-95 active:scale-95 transition-opacity cursor-pointer"
                      >
                        Відкрити →
                      </button>
                    </div>
                  )}

                  {role === "teacher" && safeIdx === 0 && isTeacherUnlocked && (
                    <div className="w-full inline-flex items-center gap-1.5 rounded-xl border border-sys-border bg-sys-bg px-3 py-2 text-xs font-semibold text-sys-status-okText">
                      <CheckIcon className="h-3.5 w-3.5 shrink-0" />
                      <span>Доступ до посилань на цьому пристрої відкрито</span>
                    </div>
                  )}

                  {role === "teacher" && safeIdx === 0 && !isTeacherUnlocked && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        if (pathname?.startsWith("/settings")) {
                          router.replace("/settings?mode=teacher");
                        } else {
                          router.push("/settings?mode=teacher");
                        }
                      }}
                      className="w-full rounded-xl bg-sys-accent py-2 text-xs font-bold text-white hover:opacity-95 active:scale-[0.99] transition-opacity cursor-pointer"
                    >
                      Ввести PIN-код викладача →
                    </button>
                  )}

                  {role === "teacher" && safeIdx === 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        router.push("/statistics?mode=teacher");
                      }}
                      className="w-full rounded-xl bg-sys-accent/15 border border-sys-accent/35 py-2 text-xs font-bold text-sys-accent hover:bg-sys-accent/25 active:scale-[0.99] transition-colors cursor-pointer"
                    >
                      Відкрити сторінку Статистики →
                    </button>
                  )}
                </div>
              </div>
          </div>
        </div>

        {/* 4. НИЖНЯ НАВІГАЦІЯ */}
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-sys-border bg-sys-surface shrink-0">
          <button
            type="button"
            disabled={safeIdx === 0}
            onClick={() => goToStep(Math.max(0, safeIdx - 1))}
            className="rounded-xl border border-sys-border bg-sys-card px-3.5 py-2 text-xs font-semibold text-sys-text-secondary hover:text-sys-text-primary disabled:opacity-40 disabled:pointer-events-none active:scale-95 transition-colors cursor-pointer"
          >
            ← Назад
          </button>

          <span className="text-xs font-semibold text-sys-text-muted">
            {safeIdx + 1} / {stepsCount}
          </span>

          <button
            type="button"
            onClick={() => {
              if (safeIdx === stepsCount - 1) {
                onClose();
              } else {
                goToStep(safeIdx + 1);
              }
            }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-sys-accent px-4 py-2 text-xs font-bold text-white hover:opacity-95 active:scale-95 transition-opacity cursor-pointer"
          >
            {safeIdx === stepsCount - 1 ? (
              <>
                <span>Зрозуміло</span>
                <CheckIcon className="h-3.5 w-3.5" />
              </>
            ) : (
              <span>Далі →</span>
            )}
          </button>
        </div>
      </div>
    </AppDialog>
  );
}
