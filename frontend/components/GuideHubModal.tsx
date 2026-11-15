"use client";

import React, { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useClassroomSubmissions } from "../lib/useClassroomSubmissions";
import { useTeacherAccess } from "../lib/useTeacherAccess";
import { useUserSettings } from "../lib/useUserSettings";
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
  /** Реальні лічильники з useTaskGroups (залишено для зворотної сумісності пропсів) */
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
    id: "st-subject-hub",
    tabLabel: "Хаб пари",
    title: "1. Хаб пари: усе про предмет в 1 клік",
    points: [
      "Натисніть на назву будь-якої пари, щоб побачити зворотний відлік до наступного заняття, розклад за чисельником/знаменником та проведені години.",
      "Якщо прив'язано @kre.dp.ua, прямо тут збираються всі домашні завдання й оцінки саме з цього предмета.",
    ],
  },
  {
    id: "st-subgroups",
    tabLabel: "Підгрупи",
    title: "2. Фільтр своєї підгрупи прямо на парі",
    points: [
      "Натисніть на бейдж «1 підгр.» або «2 підгр.» на картці пари — чужий викладач і кабінет одразу сховаються.",
      "Повторний клік по бейджу повертає обидві підгрупи (на ПК також працюють клавіші 1, 2 і 0).",
    ],
  },
  {
    id: "st-zoom",
    tabLabel: "Код Zoom",
    title: "3. Автокопіювання пароля Zoom при кліку",
    points: [
      "Система сама знаходить посилання, ID та пароль в описах Classroom і створює кнопку «Zoom ↗» (прив'яжіть @kre.dp.ua, щоб розблокувати доступ).",
      "При натисканні на «Zoom ↗» код доступу автоматично копіюється в буфер обміну — залишається лише вставити його.",
    ],
  },
  {
    id: "st-teacher-jump",
    tabLabel: "Викладач",
    title: "4. Швидкий перехід у розклад викладача",
    points: [
      "Натисніть на прізвище викладача на картці пари — миттєво відкриється його розклад і кабінети на обраний день.",
      "Кнопка «← Повернутися до ...» у верхній плашці поверне вас назад до розкладу своєї групи в один клік.",
    ],
  },
  {
    id: "st-nav-gestures",
    tabLabel: "Навігація",
    title: "5. Клавіші на ПК, фокус і свайпи на телефоні",
    points: [
      "На комп'ютері перемикайте дні й тижні стрілками ← →, вигляд Дня/Тижня — D / W, «Сьогодні» — T, а пошук — Ctrl+K або /.",
      "На телефоні гортайте дні свайпом вліво чи вправо, а на ПК у режимі Дня можна згорнути бічну панель для фокусу.",
    ],
  },
];

const TEACHER_STEPS: GuideStepMeta[] = [
  {
    id: "tc-group-jump",
    tabLabel: "Групи",
    title: "1. Перехід до розкладу групи прямо з пари",
    points: [
      "Натисніть на номер групи на своїй картці пари — відкриється розклад цієї групи, щоб перевірити «вікна» чи інші заняття.",
      "Кнопка «← Повернутися до ...» у верхній плашці миттєво повертає вас до власного розкладу.",
    ],
  },
  {
    id: "tc-stats",
    tabLabel: "Статистика",
    title: "2. Підрахунок вичитаних годин і графік процесу",
    points: [
      "«Статистика» автоматично рахує проведені пари й академічні години від початку семестру за кожним предметом та групою.",
      "Розрахунок враховує дати семестру, сесії та канікули з розділу «Графік процесу», тож прогрес рахується точно.",
    ],
  },
  {
    id: "tc-changes",
    tabLabel: "Заміни",
    title: "3. Позначки замін, перенесень і хаб предмета",
    points: [
      "Перенесені пари підписані новим днем і часом («↪ Перенесено → ...»), а разові заміни виділені бейджем «⚡ Заміна».",
      "Клік по назві дисципліни відкриває її хаб: повторювані пари за тижнями, дату наступного заняття та вичитані години.",
    ],
  },
  {
    id: "tc-export-nav",
    tabLabel: "Експорт і ПК",
    title: "4. Картинка розкладу PNG, клавіші та свайпи",
    points: [
      "Натисніть «Зберегти картинку» у шапці дня чи тижня — розклад експортується в чіткий PNG, який зручно надіслати групі або колегам.",
      "На ПК працюють ← → (дні), D / W (День/Тиждень), T (Сьогодні) й Ctrl+K / / (пошук); на телефоні дні гортаються свайпом.",
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
}: GuideHubModalProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { isLinked, linkedEmail } = useClassroomSubmissions();
  const { isTeacherUnlocked } = useTeacherAccess();
  const { settings, updateSetting } = useUserSettings();

  const tabListRef = useRef<HTMLDivElement>(null);
  const [role, setRole] = useState<"student" | "teacher">(initialRole ?? mode ?? "student");
  const [stepIdx, setStepIdx] = useState(0);
  const [slideDir, setSlideDir] = useState(1);
  const [hasStepped, setHasStepped] = useState(false);

  const steps = role === "student" ? STUDENT_STEPS : TEACHER_STEPS;
  const stepsCount = steps.length;
  const safeIdx = stepIdx < stepsCount ? stepIdx : 0;
  const activeStep = steps[safeIdx] ?? steps[0];

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
    if (!isOpen || typeof window === "undefined") return;
    const activeTab = tabListRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!activeTab) return;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    activeTab.scrollIntoView({
      block: "nearest",
      inline: "nearest",
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }, [isOpen, role, safeIdx]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const focusInTabs = Boolean(
        document.activeElement && tabListRef.current?.contains(document.activeElement)
      );
      if (e.key === "ArrowRight") {
        e.preventDefault();
        setHasStepped(true);
        setSlideDir(1);
        setStepIdx((c) => Math.min(stepsCount - 1, c + 1));
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setHasStepped(true);
        setSlideDir(-1);
        setStepIdx((c) => Math.max(0, c - 1));
      } else if (focusInTabs && e.key === "Home") {
        e.preventDefault();
        setHasStepped(true);
        setSlideDir(-1);
        setStepIdx(0);
      } else if (focusInTabs && e.key === "End") {
        e.preventDefault();
        setHasStepped(true);
        setSlideDir(1);
        setStepIdx(stepsCount - 1);
      } else {
        return;
      }

      if (focusInTabs) {
        window.requestAnimationFrame(() => {
          tabListRef.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
        });
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, stepsCount]);

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
      <div className="w-full max-h-[92dvh] flex flex-col rounded-t-2xl sm:rounded-2xl border border-sys-border bg-sys-card text-sys-text-primary shadow-lg sm:shadow-2xl overflow-hidden select-none pb-safe">
        {/* 1. ШАПКА + ПЕРЕМИКАЧ РОЛІ + ВКЛАДКИ */}
        <div className="px-4 pt-2.5 sm:pt-3.5 pb-2.5 bg-sys-surface border-b border-sys-border space-y-2.5 shrink-0">
          <div className="mx-auto h-1 w-9 rounded-full bg-sys-border/80 sm:hidden" aria-hidden="true" />
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
                  className="absolute top-0.5 bottom-0.5 pointer-events-none transition-transform duration-base ease-spring transform-gpu will-change-transform z-0"
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
                  aria-pressed={role === "student"}
                  onClick={() => handleRoleChange("student")}
                  className={`relative z-10 px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                    role === "student" ? "text-sys-onAccent font-bold" : "text-sys-text-secondary hover:text-sys-text-primary"
                  }`}
                >
                  Студент
                </button>
                <button
                  type="button"
                  aria-pressed={role === "teacher"}
                  onClick={() => handleRoleChange("teacher")}
                  className={`relative z-10 px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                    role === "teacher" ? "text-sys-onAccent font-bold" : "text-sys-text-secondary hover:text-sys-text-primary"
                  }`}
                >
                  Викладач
                </button>
              </div>

              <button
                type="button"
                onClick={onClose}
                aria-label="Закрити"
                className="relative after:absolute after:-inset-1.5 after:content-[''] flex h-8 w-8 items-center justify-center rounded-lg border border-sys-border bg-sys-bg text-sys-text-secondary hover:text-sys-text-primary active:scale-95 transition-colors cursor-pointer"
              >
                <CloseIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div
            ref={tabListRef}
            role="tablist"
            aria-label="Розділи гіду"
            className="flex items-center gap-1 overflow-x-auto no-scrollbar rounded-xl border border-sys-border bg-sys-bg p-1 text-[11px] font-semibold"
          >
            {steps.map((s, idx) => {
              const isCurrent = idx === safeIdx;
              const isConfigured =
                role === "student"
                  ? (idx === 1 && settings.defaultSubgroup !== "all") || (idx === 2 && isLinked)
                  : false;
              return (
                <button
                  key={s.id}
                  id={`guide-tab-${s.id}`}
                  type="button"
                  role="tab"
                  aria-selected={isCurrent}
                  tabIndex={isCurrent ? 0 : -1}
                  onClick={() => goToStep(idx)}
                  className={`shrink-0 flex-1 inline-flex items-center justify-center gap-1 py-1.5 px-2.5 rounded-lg border transition-colors duration-200 cursor-pointer whitespace-nowrap ${
                    isCurrent
                      ? "bg-sys-card text-sys-accent font-bold border-sys-border border-b-2 border-b-sys-accent shadow-2xs"
                      : "border-transparent text-sys-text-secondary hover:text-sys-text-primary"
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
            id={`guide-panel-${activeStep.id}`}
            role="tabpanel"
            aria-labelledby={`guide-tab-${activeStep.id}`}
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
                    <div className="w-full flex items-center justify-between gap-2 rounded-xl border border-sys-border bg-sys-bg px-3 py-2 text-xs">
                      <span className="inline-flex items-center gap-1.5 font-semibold text-sys-text-secondary truncate">
                        {isLinked ? (
                          <>
                            <CheckIcon className="h-3.5 w-3.5 text-sys-status-okText shrink-0" />
                            <span className="truncate">У хабі відкрито ДЗ й оцінки ({linkedEmail})</span>
                          </>
                        ) : (
                          <span>Прив&apos;яжіть @kre.dp.ua для ДЗ й оцінок у хабі</span>
                        )}
                      </span>
                      {!isLinked && (
                        <button
                          type="button"
                          onClick={() => {
                            onClose();
                            setTimeout(() => window.dispatchEvent(new CustomEvent("trigger-classroom-sync")), 120);
                          }}
                          className="shrink-0 rounded-lg bg-sys-accentSolid px-3 py-1.5 text-[11px] font-bold text-sys-onAccent hover:opacity-95 active:scale-95 transition-opacity cursor-pointer"
                        >
                          Прив&apos;язати →
                        </button>
                      )}
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
                            aria-pressed={settings.defaultSubgroup === sub}
                            onClick={() => updateSetting("defaultSubgroup", sub)}
                            className={`rounded-lg px-2.5 py-1 text-[11px] font-bold transition-colors cursor-pointer ${
                              settings.defaultSubgroup === sub
                                ? "bg-sys-accentSolid text-sys-onAccent"
                                : "bg-sys-card text-sys-text-secondary border border-sys-border hover:text-sys-text-primary"
                            }`}
                          >
                            {sub === "all" ? "Обидві" : `${sub} підгр.`}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {role === "student" && safeIdx === 2 && (
                    <div className="w-full flex items-center justify-between gap-2 rounded-xl border border-sys-border bg-sys-bg px-3 py-2 text-xs">
                      <span className="inline-flex items-center gap-1.5 font-semibold text-sys-text-secondary truncate">
                        {isLinked ? (
                          <>
                            <CheckIcon className="h-3.5 w-3.5 text-sys-status-okText shrink-0" />
                            <span className="truncate">Доступ відкрито: {linkedEmail}</span>
                          </>
                        ) : (
                          <span>Потрібна пошта @kre.dp.ua для доступу до посилань</span>
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          setTimeout(() => window.dispatchEvent(new CustomEvent("trigger-classroom-sync")), 120);
                        }}
                        className="shrink-0 rounded-lg bg-sys-accentSolid px-3 py-1.5 text-[11px] font-bold text-sys-onAccent hover:opacity-95 active:scale-95 transition-opacity cursor-pointer"
                      >
                        {isLinked ? "Оновити" : "Прив'язати →"}
                      </button>
                    </div>
                  )}

                  {role === "student" && safeIdx === 3 && (
                    <div className="w-full rounded-xl border border-sys-border bg-sys-bg px-3 py-2 text-xs font-medium text-sys-text-secondary">
                      Працює і в режимі Дня, і в режимі Тижня без втрати обраної дати.
                    </div>
                  )}

                  {role === "student" && safeIdx === 4 && (
                    <div className="w-full rounded-xl border border-sys-border bg-sys-bg px-3 py-2 text-xs font-medium text-sys-text-secondary">
                      Через <kbd className="font-mono font-bold text-sys-text-primary">Ctrl+K</kbd> або{" "}
                      <kbd className="font-mono font-bold text-sys-text-primary">/</kbd> зручно шукати й групи, і викладачів.
                    </div>
                  )}

                  {role === "teacher" && safeIdx === 0 && isTeacherUnlocked && (
                    <div className="w-full inline-flex items-center gap-1.5 rounded-xl border border-sys-border bg-sys-bg px-3 py-2 text-xs font-semibold text-sys-status-okText">
                      <CheckIcon className="h-3.5 w-3.5 shrink-0" />
                      <span>Посилання Meet/Zoom на цьому пристрої відкрито</span>
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
                      className="w-full rounded-xl bg-sys-accentSolid py-2 text-xs font-bold text-sys-onAccent hover:opacity-95 active:scale-[0.99] transition-opacity cursor-pointer"
                    >
                      Ввести PIN-код викладача для посилань →
                    </button>
                  )}

                  {role === "teacher" && safeIdx === 1 && (
                    <div className="w-full flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          router.push("/statistics?mode=teacher");
                        }}
                        className="flex-1 rounded-xl bg-sys-accentSolid py-2 px-3 text-xs font-bold text-sys-onAccent hover:opacity-95 active:scale-[0.99] transition-opacity cursor-pointer"
                      >
                        Статистика →
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          router.push("/educational-process");
                        }}
                        className="flex-1 rounded-xl border border-sys-border bg-sys-bg py-2 px-3 text-xs font-semibold text-sys-text-secondary hover:text-sys-text-primary active:scale-[0.99] transition-colors cursor-pointer"
                      >
                        Графік процесу →
                      </button>
                    </div>
                  )}

                  {role === "teacher" && safeIdx === 2 && (
                    <div className="w-full rounded-xl border border-sys-border bg-sys-bg px-3 py-2 text-xs font-medium text-sys-text-secondary">
                      Натисніть на назву будь-якої дисципліни в розкладі, щоб відкрити її хаб.
                    </div>
                  )}

                  {role === "teacher" && safeIdx === 3 && (
                    <div className="w-full rounded-xl border border-sys-border bg-sys-bg px-3 py-2 text-xs font-medium text-sys-text-secondary">
                      Через <kbd className="font-mono font-bold text-sys-text-primary">Ctrl+K</kbd> або{" "}
                      <kbd className="font-mono font-bold text-sys-text-primary">/</kbd> зручно перемикатися між своїм розкладом і групами.
                    </div>
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
            className="inline-flex items-center gap-1.5 rounded-xl bg-sys-accentSolid px-4 py-2 text-xs font-bold text-sys-onAccent hover:opacity-95 active:scale-95 transition-opacity cursor-pointer"
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
