"use client";

import React, { useEffect, useState, startTransition } from "react";
import { useRouter } from "next/navigation";
import { useClassroomSubmissions } from "../lib/useClassroomSubmissions";
import { useTeacherAccess } from "../lib/useTeacherAccess";
import { useUserSettings } from "../lib/useUserSettings";
import { copyTextToClipboard } from "../lib/format";

export interface GuideHubModalProps {
  isOpen?: boolean;
  onClose: () => void;
  initialRole?: "student" | "teacher";
  mode?: "student" | "teacher";
  groupId?: number | null;
  teacherId?: number | null;
}

interface SlideMeta {
  id: string;
  shortLabel: string;
  icon: string;
  title: string;
  subtitle: string;
}

const STUDENT_SLIDES: SlideMeta[] = [
  {
    id: "st-setup",
    shortLabel: "Статус",
    icon: "🎯",
    title: "Готовність вашого профілю",
    subtitle: "Перевірте 3 базові налаштування для автоматичної роботи розкладу",
  },
  {
    id: "st-subgroups",
    shortLabel: "Підгрупи",
    icon: "👥",
    title: "Фільтр своєї підгрупи",
    subtitle: "Приберіть зайві кабінети, чужих викладачів та чужі завдання в 1 тап",
  },
  {
    id: "st-zoom",
    shortLabel: "Дзвінки",
    icon: "💻",
    title: "Google Meet та авто-код Zoom",
    subtitle: "Перехід на пару в один дотик із автоматичним копіюванням пароля",
  },
  {
    id: "st-tasks",
    shortLabel: "Завдання",
    icon: "📋",
    title: "Завдання та Оцінки Classroom",
    subtitle: "Усі актуальні дедлайни, борги та середній бал без гортання тижнів",
  },
  {
    id: "st-pwa",
    shortLabel: "Додаток",
    icon: "📲",
    title: "Робота без світла та встановлення",
    subtitle: "Додайте розклад на головний екран телефона для миттєвого доступу",
  },
];

const TEACHER_SLIDES: SlideMeta[] = [
  {
    id: "tc-setup",
    shortLabel: "Доступ",
    icon: "🔑",
    title: "Профіль викладача та PIN-код",
    subtitle: "Персональний розклад занять і прямий доступ до всіх онлайн-конференцій",
  },
  {
    id: "tc-jump",
    shortLabel: "Групи",
    icon: "🔄",
    title: "Миттєвий перехід до групи",
    subtitle: "Переглядайте повний розклад будь-якої навчальної групи прямо з картки пари",
  },
  {
    id: "tc-share",
    shortLabel: "Експорт",
    icon: "📤",
    title: "Відправка розкладу в Telegram",
    subtitle: "Генерація охайної PNG-картинки або тексту розкладу дня за 1 секунду",
  },
  {
    id: "tc-stats",
    shortLabel: "Години",
    icon: "📊",
    title: "Статистика вичитаних пар",
    subtitle: "Автоматичний підрахунок проведених занять та годин по групах і дисциплінах",
  },
  {
    id: "tc-pwa",
    shortLabel: "Додаток",
    icon: "📲",
    title: "Автономна робота під час відключень",
    subtitle: "Встановіть веб-додаток на смартфон — розклад працюватиме навіть без мережі",
  },
];

export function GuideHubModal({
  isOpen = true,
  onClose,
  initialRole,
  mode,
  groupId,
  teacherId,
}: GuideHubModalProps) {
  const router = useRouter();
  const { isLinked, linkedEmail } = useClassroomSubmissions();
  const { isTeacherUnlocked } = useTeacherAccess();
  const { settings, updateSetting } = useUserSettings();

  const [role, setRole] = useState<"student" | "teacher">(initialRole ?? mode ?? "student");
  const [stepIdx, setStepIdx] = useState<number>(0);

  // Інтерактивні стани для живих прев'ю всередині слайдів
  const [demoZoomCopied, setDemoZoomCopied] = useState(false);
  const [demoTaskTab, setDemoTaskTab] = useState<"pending" | "overdue" | "done">("pending");
  const [demoJumpActive, setDemoJumpActive] = useState(false);
  const [demoPinUnlocked, setDemoPinUnlocked] = useState(false);

  const [groupName, setGroupName] = useState<string | null>(null);
  const [teacherName, setTeacherName] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || typeof window === "undefined") return;
    setDemoZoomCopied(false);
    setDemoJumpActive(false);
    setDemoPinUnlocked(isTeacherUnlocked);
    try {
      const storedMode = window.localStorage.getItem("schedule:mode");
      if (!initialRole && !mode && (storedMode === "student" || storedMode === "teacher")) {
        setRole(storedMode);
      } else if (mode || initialRole) {
        setRole(initialRole ?? mode ?? "student");
      }

      const gid =
        groupId ||
        Number(window.localStorage.getItem("schedule:groupId")) ||
        Number(window.localStorage.getItem("schedule:classroom_linked_group_id")) ||
        null;
      const rawGroups = window.localStorage.getItem("schedule:groups");
      if (gid && rawGroups) {
        const parsedGroups = JSON.parse(rawGroups) as Array<{ id: number; name: string }>;
        const matched = parsedGroups.find((g) => Number(g.id) === gid);
        setGroupName(matched?.name ?? null);
      } else {
        setGroupName(null);
      }

      const tid = teacherId || Number(window.localStorage.getItem("schedule:teacherId")) || null;
      const rawTeachers = window.localStorage.getItem("schedule:teachers");
      if (tid && rawTeachers) {
        const parsedTeachers = JSON.parse(rawTeachers) as Array<{ id: number; name: string }>;
        const matchedT = parsedTeachers.find((t) => Number(t.id) === tid);
        setTeacherName(matchedT?.name ?? null);
      } else {
        setTeacherName(null);
      }
    } catch {}
  }, [isOpen, initialRole, mode, groupId, teacherId, isTeacherUnlocked]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setStepIdx((p) => Math.min(4, p + 1));
      if (e.key === "ArrowLeft") setStepIdx((p) => Math.max(0, p - 1));
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const slides = role === "student" ? STUDENT_SLIDES : TEACHER_SLIDES;
  const activeSlide = slides[stepIdx] ?? slides[0];

  const handleRoleSwitch = (nextRole: "student" | "teacher") => {
    startTransition(() => {
      setRole(nextRole);
      setStepIdx(0);
    });
  };

  const activeSubgroup = settings.defaultSubgroup;
  const currentSubgroup = activeSubgroup ?? "all";

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 sm:bg-black/70 sm:backdrop-blur-xs p-0 sm:p-4 animate-in fade-in duration-150"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="guide-modal-title"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-lg max-h-[92dvh] sm:max-h-[86vh] flex flex-col rounded-t-2xl sm:rounded-2xl border border-sys-border bg-sys-card text-sys-text-primary shadow-2xl overflow-hidden select-none"
      >
        {/* Top Header */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-sys-border bg-sys-surface shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-sys-accent/15 border border-sys-accent/30 text-sys-accent font-bold text-sm">
              {activeSlide.icon}
            </div>
            <div className="min-w-0">
              <h2 id="guide-modal-title" className="text-sm sm:text-base font-bold leading-tight truncate">
                Інтерактивний гід по розкладу
              </h2>
              <p className="text-[11px] text-sys-text-secondary truncate">
                Крок {stepIdx + 1} із {slides.length} • {role === "student" ? "Режим студента" : "Режим викладача"}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Закрити довідник"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-sys-border bg-sys-bg text-sys-text-secondary hover:text-sys-text-primary active:scale-95 transition-colors cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Navigation Bar: Role Switcher + 5 Step Tabs */}
        <div className="px-4 pt-2.5 pb-2 border-b border-sys-border/60 bg-sys-card space-y-2 shrink-0">
          {/* Role Switcher */}
          <div className="relative grid grid-cols-2 rounded-xl border border-sys-border bg-sys-bg p-1 text-xs font-semibold isolate">
            <div
              aria-hidden="true"
              className="absolute top-1 bottom-1 pointer-events-none transition-transform duration-150 ease-out transform-gpu will-change-transform z-0"
              style={{
                left: "4px",
                width: "calc((100% - 8px) / 2)",
                transform: `translate3d(${role === "teacher" ? "100%" : "0%"}, 0, 0)`,
              }}
            >
              <div className="h-full w-full rounded-lg bg-sys-accentSolid shadow-xs" />
            </div>
            <button
              type="button"
              onClick={() => handleRoleSwitch("student")}
              className={`relative z-10 py-1.5 rounded-lg transition-colors duration-150 cursor-pointer ${
                role === "student" ? "text-white font-bold" : "text-sys-text-secondary hover:text-sys-text-primary"
              }`}
            >
              🎓 Для студента
            </button>
            <button
              type="button"
              onClick={() => handleRoleSwitch("teacher")}
              className={`relative z-10 py-1.5 rounded-lg transition-colors duration-150 cursor-pointer ${
                role === "teacher" ? "text-white font-bold" : "text-sys-text-secondary hover:text-sys-text-primary"
              }`}
            >
              👨‍🏫 Для викладача
            </button>
          </div>

          {/* 5 Step Tabs (1 feature per tab) */}
          <div className="relative grid grid-cols-5 rounded-xl border border-sys-border bg-sys-bg p-1 text-[11px] font-semibold isolate">
            <div
              aria-hidden="true"
              className="absolute top-1 bottom-1 pointer-events-none transition-transform duration-150 ease-out transform-gpu will-change-transform z-0"
              style={{
                left: "4px",
                width: "calc((100% - 8px) / 5)",
                transform: `translate3d(calc(${stepIdx} * 100%), 0, 0)`,
              }}
            >
              <div className="h-full w-full rounded-lg bg-sys-card border border-sys-border shadow-2xs" />
            </div>
            {slides.map((s, idx) => {
              const isCurrent = idx === stepIdx;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => startTransition(() => setStepIdx(idx))}
                  className={`relative z-10 flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1 py-1 px-0.5 rounded-lg transition-colors duration-150 cursor-pointer truncate ${
                    isCurrent ? "text-sys-accent font-bold" : "text-sys-text-secondary hover:text-sys-text-primary"
                  }`}
                >
                  <span className="text-xs leading-none">{s.icon}</span>
                  <span className="truncate max-w-full text-[10px] sm:text-[11px]">{s.shortLabel}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Main Single-Feature Slide Body */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4">
          {/* Slide Header */}
          <div>
            <h3 className="text-base font-bold text-sys-text-primary leading-snug">
              {activeSlide.title}
            </h3>
            <p className="text-xs text-sys-text-secondary mt-0.5 leading-relaxed">
              {activeSlide.subtitle}
            </p>
          </div>

          {/* =========================================================
              STUDENT SLIDE 1: ГОТОВНІСТЬ ПРОФІЛЮ
             ========================================================= */}
          {role === "student" && stepIdx === 0 && (
            <div className="space-y-3">
              {/* Visual Readiness Card */}
              <div className="rounded-2xl border border-sys-border bg-sys-bg/70 p-3.5 space-y-2.5 shadow-inner">
                {/* Item 1: Group */}
                <div className={`flex items-center justify-between gap-2 rounded-xl border p-2.5 ${groupName ? "border-emerald-500/30 bg-emerald-500/5" : "border-sys-border bg-sys-card"}`}>
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${groupName ? "bg-emerald-500/20 text-emerald-500" : "bg-amber-500/20 text-amber-500"}`}>
                      {groupName ? "✓" : "1"}
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-sys-text-primary truncate">
                        {groupName ? `Група: ${groupName}` : "Групу ще не обрано"}
                      </p>
                      <p className="text-[11px] text-sys-text-secondary truncate">
                        Обирається у верхній панелі розкладу
                      </p>
                    </div>
                  </div>
                </div>

                {/* Item 2: Classroom */}
                <div className={`flex items-center justify-between gap-2 rounded-xl border p-2.5 ${isLinked ? "border-emerald-500/30 bg-emerald-500/5" : "border-sky-500/30 bg-sky-500/5"}`}>
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${isLinked ? "bg-emerald-500/20 text-emerald-500" : "bg-sky-500/20 text-sky-400"}`}>
                      {isLinked ? "✓" : "2"}
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-sys-text-primary truncate">
                        {isLinked ? "Google Classroom підключено" : "Прив'яжіть @kre.dp.ua"}
                      </p>
                      <p className="text-[11px] text-sys-text-secondary truncate">
                        {isLinked ? linkedEmail : "Для відкриття посилань Meet/Zoom і своїх ДЗ"}
                      </p>
                    </div>
                  </div>
                  {!isLinked && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        setTimeout(() => window.dispatchEvent(new CustomEvent("trigger-classroom-sync")), 120);
                      }}
                      className="shrink-0 rounded-lg bg-sys-accent px-2.5 py-1.5 text-[11px] font-bold text-white active:scale-95 transition-transform cursor-pointer"
                    >
                      Підключити
                    </button>
                  )}
                </div>

                {/* Item 3: Subgroup */}
                <div className="flex items-center justify-between gap-2 rounded-xl border border-sys-border bg-sys-card p-2.5">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sys-accent/15 text-sys-accent text-xs font-bold">
                      3
                    </span>
                    <span className="text-xs font-bold text-sys-text-primary">Ваша підгрупа:</span>
                  </div>
                  <div className="inline-flex rounded-lg border border-sys-border bg-sys-bg p-0.5 text-[11px] font-semibold">
                    {(["all", 1, 2] as const).map((sub) => {
                      const isSelected = currentSubgroup === sub;
                      return (
                        <button
                          key={String(sub)}
                          type="button"
                          onClick={() => updateSetting("defaultSubgroup", sub)}
                          className={`rounded-md px-2 py-1 transition-colors cursor-pointer ${
                            isSelected ? "bg-sys-accent text-white font-bold" : "text-sys-text-secondary hover:text-sys-text-primary"
                          }`}
                        >
                          {sub === "all" ? "Обидві" : `${sub} підгр.`}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <p className="text-xs text-sys-text-secondary leading-relaxed px-1">
                💡 <strong>Навіщо це потрібно:</strong> після одноразової прив&apos;язки пошти <strong>@kre.dp.ua</strong> розклад сам у фоні підтягує нові посилання на пари кожні 10 хвилин та синхронізує ваші особисті завдання між телефоном і комп&apos;ютером.
              </p>
            </div>
          )}

          {/* =========================================================
              STUDENT SLIDE 2: ПІДГРУПИ (ІНТЕРАКТИВНИЙ МАКЕТ КАРТКИ)
             ========================================================= */}
          {role === "student" && stepIdx === 1 && (
            <div className="space-y-3">
              {/* Interactive Visual Mockup of a Lesson Card */}
              <div className="rounded-2xl border border-sys-border bg-sys-bg/80 p-3.5 space-y-2.5">
                <div className="flex items-center justify-between text-[11px] text-sys-text-muted">
                  <span className="font-bold uppercase tracking-wider text-sys-accent">
                    👆 Спробуйте натиснути на кнопку підгрупи нижче:
                  </span>
                  <span>2 пара • 10:40–12:00</span>
                </div>

                <div className="rounded-xl border border-sys-border bg-sys-card p-3 shadow-xs space-y-2.5">
                  <div className="font-bold text-sm text-sys-text-primary">
                    Іноземна мова (за проф. спрямуванням)
                  </div>

                  <div className="space-y-2">
                    {(currentSubgroup === "all" || currentSubgroup === 1) && (
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <button
                            type="button"
                            onClick={() => updateSetting("defaultSubgroup", currentSubgroup === 1 ? "all" : 1)}
                            className={`inline-flex items-center gap-1.5 h-6 px-2 rounded-md border text-xs font-semibold cursor-pointer transition-all active:scale-95 ${
                              currentSubgroup === 1
                                ? "border-sys-accent/40 bg-sys-accent/15 text-sys-accent"
                                : "border-sys-border bg-sys-bg text-sys-text-secondary hover:border-sys-accent/40"
                            }`}
                          >
                            <span className={`h-1.5 w-1.5 rounded-full ${currentSubgroup === 1 ? "bg-sys-accent" : "bg-sys-text-muted"}`} />
                            <span>1 підгр.</span>
                          </button>
                          <span className="text-xs text-sys-text-secondary truncate">Токарєва О.В.</span>
                        </div>
                        <span className="rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1 text-xs font-bold text-emerald-400">
                          Meet ↗
                        </span>
                      </div>
                    )}

                    {(currentSubgroup === "all" || currentSubgroup === 2) && (
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <button
                            type="button"
                            onClick={() => updateSetting("defaultSubgroup", currentSubgroup === 2 ? "all" : 2)}
                            className={`inline-flex items-center gap-1.5 h-6 px-2 rounded-md border text-xs font-semibold cursor-pointer transition-all active:scale-95 ${
                              currentSubgroup === 2
                                ? "border-sys-accent/40 bg-sys-accent/15 text-sys-accent"
                                : "border-sys-border bg-sys-bg text-sys-text-secondary hover:border-sys-accent/40"
                            }`}
                          >
                            <span className={`h-1.5 w-1.5 rounded-full ${currentSubgroup === 2 ? "bg-sys-accent" : "bg-sys-text-muted"}`} />
                            <span>2 підгр.</span>
                          </button>
                          <span className="text-xs text-sys-text-secondary truncate">Хочинська І.В.</span>
                        </div>
                        <span className="rounded-lg border border-sky-500/40 bg-sky-500/15 px-2.5 py-1 text-xs font-bold text-sky-400">
                          Zoom ↗
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-sys-border bg-sys-bg/40 p-3 text-xs text-sys-text-secondary space-y-1.5">
                <p>
                  • <strong>Як це працює:</strong> натисніть на бейдж <strong>«1 підгр.»</strong> або <strong>«2 підгр.»</strong> прямо на картці будь-якої пари — чужа підгрупа сховається у всьому розкладі та в списку домашніх завдань.
                </p>
                <p>
                  • Повторний клік по обраній підгрупі знову показує обидві підгрупи.
                </p>
              </div>
            </div>
          )}

          {/* =========================================================
              STUDENT SLIDE 3: ОНЛАЙН-ДЗВІНКИ ТА АВТО-КОПІЮВАННЯ ZOOM
             ========================================================= */}
          {role === "student" && stepIdx === 2 && (
            <div className="space-y-3">
              {/* Interactive Visual Mockup of Zoom Passcode Copy */}
              <div className="rounded-2xl border border-sys-border bg-sys-bg/80 p-3.5 space-y-2.5">
                <div className="flex items-center justify-between text-[11px] text-sys-text-muted">
                  <span className="font-bold uppercase tracking-wider text-sky-400">
                    👆 Натисніть на кнопку Zoom для тесту:
                  </span>
                  <span>Живий приклад</span>
                </div>

                <div className="rounded-xl border border-sys-border bg-sys-card p-3 shadow-xs flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-sys-text-primary truncate">Електроніка та мікросхемотехніка</p>
                    <p className="text-xs text-sys-text-secondary mt-0.5 truncate">Філімончук Т.В. • Дистанційно</p>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      copyTextToClipboard("dfkr");
                      setDemoZoomCopied(true);
                      setTimeout(() => setDemoZoomCopied(false), 3000);
                    }}
                    className="shrink-0 inline-flex h-9 px-3 items-center gap-1.5 rounded-xl border border-sky-400/60 bg-sky-500/20 text-sky-200 font-bold text-xs active:scale-95 transition-all cursor-pointer shadow-xs"
                  >
                    <span>📹 Zoom · код: dfkr ↗</span>
                  </button>
                </div>

                {demoZoomCopied && (
                  <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-3 py-2 text-xs font-bold text-emerald-300 flex items-center gap-2 animate-in fade-in duration-150">
                    <span>✓</span>
                    <span>Код доступу Zoom (dfkr) скопійовано в буфер обміну!</span>
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-sys-border bg-sys-bg/40 p-3 text-xs text-sys-text-secondary space-y-1.5">
                <p>
                  • <strong>Авто-генерація посилання за ID:</strong> навіть якщо викладач написав у Classroom лише текстовий <em>Ідентифікатор</em> та <em>Код доступу</em> без посилання, сайт сам перетворить їх на кнопку <strong>Zoom</strong>.
                </p>
                <p>
                  • <strong>Авто-копіювання пароля:</strong> у момент кліку на кнопку пароль автоматично копіюється в буфер обміну телефона — у вікні Zoom достатньо натиснути «Вставити».
                </p>
              </div>
            </div>
          )}

          {/* =========================================================
              STUDENT SLIDE 4: ЗАВДАННЯ ТА ОЦІНКИ
             ========================================================= */}
          {role === "student" && stepIdx === 3 && (
            <div className="space-y-3">
              {/* Interactive Visual Mockup of the New Tasks TodoBoard */}
              <div className="rounded-2xl border border-sys-border bg-sys-bg/80 p-3.5 space-y-2.5">
                <div className="grid grid-cols-3 gap-1 rounded-xl border border-sys-border bg-sys-card p-1 text-xs font-semibold">
                  <button
                    type="button"
                    onClick={() => setDemoTaskTab("pending")}
                    className={`rounded-lg py-1.5 transition-colors cursor-pointer ${
                      demoTaskTab === "pending" ? "bg-sys-accentSolid text-white font-bold" : "text-sys-text-secondary"
                    }`}
                  >
                    До здачі (3)
                  </button>
                  <button
                    type="button"
                    onClick={() => setDemoTaskTab("overdue")}
                    className={`rounded-lg py-1.5 transition-colors cursor-pointer ${
                      demoTaskTab === "overdue" ? "bg-rose-600 text-white font-bold" : "text-rose-400"
                    }`}
                  >
                    Борги (1)
                  </button>
                  <button
                    type="button"
                    onClick={() => setDemoTaskTab("done")}
                    className={`rounded-lg py-1.5 transition-colors cursor-pointer ${
                      demoTaskTab === "done" ? "bg-emerald-600 text-white font-bold" : "text-sys-text-secondary"
                    }`}
                  >
                    Здано (14)
                  </button>
                </div>

                <div className="rounded-xl border border-sys-border bg-sys-card p-3 shadow-xs space-y-1">
                  {demoTaskTab === "pending" && (
                    <>
                      <div className="flex items-center justify-between text-xs font-bold text-sys-text-primary">
                        <span>Практична робота №4</span>
                        <span className="text-amber-400">Завтра</span>
                      </div>
                      <p className="text-[11px] text-sys-text-muted">Вища математика • Натисніть для відкриття в Classroom ↗</p>
                    </>
                  )}
                  {demoTaskTab === "overdue" && (
                    <>
                      <div className="flex items-center justify-between text-xs font-bold text-sys-text-primary">
                        <span>Лабораторна робота №2</span>
                        <span className="text-rose-400">прострочено 3 дні</span>
                      </div>
                      <p className="text-[11px] text-sys-text-muted">Схемотехніка • Зібрано всі хвости за семестр</p>
                    </>
                  )}
                  {demoTaskTab === "done" && (
                    <>
                      <div className="flex items-center justify-between text-xs font-bold text-sys-text-primary">
                        <span>Тестовий контроль теми 1</span>
                        <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-emerald-400">Оцінка: 11/12</span>
                      </div>
                      <p className="text-[11px] text-sys-text-muted">Відсортовано від найновіших до найстаріших публікацій</p>
                    </>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-sys-border bg-sys-bg/40 p-3 text-xs text-sys-text-secondary space-y-1.5">
                <p>
                  • <strong>Жодного перемикання тижнів:</strong> вкладка «Завдання» працює як єдиний список справ — у п&apos;ятницю ви одразу бачите завдання на наступний тиждень та завдання без дати.
                </p>
                <p>
                  • <strong>Вкладка «Оцінки»:</strong> автоматично рахує ваш поточний середній бал з кожного предмета та переводить 100-бальні оцінки у 12-бальну чи 5-бальну шкалу.
                </p>
              </div>
            </div>
          )}

          {/* =========================================================
              TEACHER SLIDE 1: ПРОФІЛЬ І PIN-ДОСТУП ВИКЛАДАЧА
             ========================================================= */}
          {role === "teacher" && stepIdx === 0 && (
            <div className="space-y-3">
              <div className="rounded-2xl border border-sys-border bg-sys-bg/80 p-3.5 space-y-2.5">
                <div className="flex items-center justify-between text-[11px] text-sys-text-muted">
                  <span className="font-bold uppercase tracking-wider text-sys-accent">
                    👆 Натисніть на замочок, щоб побачити різницю:
                  </span>
                  <span>Захист посилань</span>
                </div>

                <div className="rounded-xl border border-sys-border bg-sys-card p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-sys-text-primary truncate">Група КІ-24-2/9-85</p>
                    <p className="text-xs text-sys-text-secondary mt-0.5">1 пара • 09:00–10:20</p>
                  </div>

                  <button
                    type="button"
                    onClick={() => setDemoPinUnlocked((prev) => !prev)}
                    className={`shrink-0 inline-flex h-9 px-3 items-center gap-1.5 rounded-xl border font-bold text-xs active:scale-95 transition-all cursor-pointer ${
                      demoPinUnlocked
                        ? "border-emerald-500/50 bg-emerald-500/20 text-emerald-300"
                        : "border-amber-500/40 bg-amber-500/15 text-amber-300"
                    }`}
                  >
                    {demoPinUnlocked ? (
                      <>
                        <span>📹 Meet (відкрито) ↗</span>
                      </>
                    ) : (
                      <>
                        <span>🔒 Meet (захищено)</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-sys-border bg-sys-bg/40 p-3 text-xs text-sys-text-secondary space-y-2">
                <p>
                  • <strong>Чому посилання під замочком:</strong> щоб сторонні особи з інтернету не могли заходити на онлайн-пари коледжу.
                </p>
                <p>
                  • <strong>Як розблокувати:</strong> введіть єдиний <strong>PIN-код викладача</strong> у Налаштуваннях один раз — після цього на вашому пристрої будуть відкриті прямі посилання на Google Meet та Zoom для всіх груп.
                </p>
                {!isTeacherUnlocked && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      router.push("/settings?mode=teacher");
                    }}
                    className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-sys-accent px-3 py-1.5 text-xs font-bold text-white active:scale-95 transition-transform cursor-pointer"
                  >
                    Ввести PIN у Налаштуваннях →
                  </button>
                )}
              </div>
            </div>
          )}

          {/* =========================================================
              TEACHER SLIDE 2: МИТТЄВИЙ ПЕРЕХІД МІЖ ГРУПАМИ
             ========================================================= */}
          {role === "teacher" && stepIdx === 1 && (
            <div className="space-y-3">
              <div className="rounded-2xl border border-sys-border bg-sys-bg/80 p-3.5 space-y-2.5">
                <div className="flex items-center justify-between text-[11px] text-sys-text-muted">
                  <span className="font-bold uppercase tracking-wider text-sys-accent">
                    👆 Натисніть на назву групи на макеті:
                  </span>
                  <span>Швидкий перехід</span>
                </div>

                {demoJumpActive ? (
                  <div className="rounded-xl border border-sys-accent/40 bg-sys-accent/10 p-3 space-y-2 animate-in fade-in duration-150">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-sys-text-primary">
                        Перегляд групи: <span className="text-sys-accent">КІ-24-2/9-85</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setDemoJumpActive(false)}
                        className="rounded-lg bg-sys-accent px-2.5 py-1 text-[11px] font-bold text-white cursor-pointer active:scale-95"
                      >
                        ← До розкладу викладача
                      </button>
                    </div>
                    <p className="text-[11px] text-sys-text-secondary">
                      Ви миттєво бачите всі пари цієї групи на день або тиждень і можете повернутися назад однією кнопкою зверху.
                    </p>
                  </div>
                ) : (
                  <div className="rounded-xl border border-sys-border bg-sys-card p-3 space-y-2">
                    <p className="text-sm font-bold text-sys-text-primary">Комп&apos;ютерна схемотехніка</p>
                    <div className="flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => setDemoJumpActive(true)}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-sys-accent underline underline-offset-2 hover:opacity-80 cursor-pointer"
                      >
                        <span>👥 Група: КІ-24-2/9-85 · 1 підгр.</span>
                      </button>
                      <span className="rounded-md border border-sys-border bg-sys-bg px-2 py-0.5 text-xs text-sys-text-secondary">
                        ауд. 305
                      </span>
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-sys-border bg-sys-bg/40 p-3 text-xs text-sys-text-secondary space-y-1.5">
                <p>
                  • <strong>Як це допомагає викладачу:</strong> якщо потрібно призначити консультацію або перевірити, на якій парі зараз конкретна група — просто натисніть на номер групи на своїй картці пари.
                </p>
                <p>
                  • На картках двовикладацьких пар сайт автоматично підписує номер вашої підгрупи (<em>«1 підгр.»</em> або <em>«2 підгр.»</em>) та ваш власний кабінет.
                </p>
              </div>
            </div>
          )}

          {/* =========================================================
              TEACHER SLIDE 3: ЕКСПОРТ КАРТИНКОЮ ТА В TELEGRAM
             ========================================================= */}
          {role === "teacher" && stepIdx === 2 && (
            <div className="space-y-3">
              {/* Visual Mockup of Day Header Share Buttons */}
              <div className="rounded-2xl border border-sys-border bg-sys-bg/80 p-3.5 space-y-3">
                <div className="flex items-center justify-between rounded-xl border border-sys-border bg-sys-card px-3.5 py-2.5">
                  <div>
                    <span className="text-sm font-bold text-sys-text-primary">Четвер, 12 листопада</span>
                    <span className="ml-2 rounded-full border border-sys-accent/30 bg-sys-accent/10 px-2 py-0.5 text-[10px] font-bold text-sys-accent">
                      Очно
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-sys-accent/50 bg-sys-accent/15 text-sys-accent shadow-xs" title="PNG-картинка">
                      🖼️
                    </div>
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-sys-border bg-sys-bg text-sys-text-secondary" title="Текст для Telegram">
                      📋
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div className="rounded-xl border border-sys-border bg-sys-card p-2.5">
                    <p className="font-bold text-sys-text-primary mb-0.5">🖼️ Іконка картинки</p>
                    <p className="text-sys-text-secondary">
                      Генерує чітку PNG-картку розкладу дня та копіює її в буфер або зберігає у телефон.
                    </p>
                  </div>
                  <div className="rounded-xl border border-sys-border bg-sys-card p-2.5">
                    <p className="font-bold text-sys-text-primary mb-0.5">📋 Іконка буфера</p>
                    <p className="text-sys-text-secondary">
                      Копіює відформатований текст розкладу з часом, групами та кабінетами для Telegram.
                    </p>
                  </div>
                </div>
              </div>

              <p className="text-xs text-sys-text-secondary leading-relaxed px-1">
                💡 Зручно для кураторів груп: ви можете перемкнутися на свою кураторську групу й одним натисканням відправити студентам актуальний розклад із замінами на завтра у Telegram-чат.
              </p>
            </div>
          )}

          {/* =========================================================
              TEACHER SLIDE 4: СТАТИСТИКА ТА ОБЛІК ГОДИН
             ========================================================= */}
          {role === "teacher" && stepIdx === 3 && (
            <div className="space-y-3">
              {/* Visual Mockup of Statistics Workload */}
              <div className="rounded-2xl border border-sys-border bg-sys-bg/80 p-3.5 space-y-2.5">
                <div className="flex items-center justify-between text-xs font-bold text-sys-text-primary">
                  <span>📊 Виконання навантаження за семестр</span>
                  <span className="text-sys-accent">48 пар (96 год)</span>
                </div>

                <div className="space-y-2 rounded-xl border border-sys-border bg-sys-card p-3">
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px]">
                      <span className="font-semibold text-sys-text-primary">Вища математика (КІ-24-1/9-85)</span>
                      <span className="font-bold text-emerald-400">18 пар • 36 год</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-sys-bg overflow-hidden">
                      <div className="h-full w-3/4 rounded-full bg-emerald-500" />
                    </div>
                  </div>

                  <div className="space-y-1 pt-1">
                    <div className="flex justify-between text-[11px]">
                      <span className="font-semibold text-sys-text-primary">Дискретна математика (КІ-24-2/9-86)</span>
                      <span className="font-bold text-sys-accent">14 пар • 28 год</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-sys-bg overflow-hidden">
                      <div className="h-full w-1/2 rounded-full bg-sys-accent" />
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-sys-border bg-sys-bg/40 p-3 text-xs text-sys-text-secondary space-y-2">
                <p>
                  • У розділі <strong>«Статистика»</strong> автоматично враховуються всі проведені пари, разові заміни та скасування за вибраний період.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    router.push("/statistics");
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-sys-accent/15 border border-sys-accent/35 px-3 py-1.5 text-xs font-bold text-sys-accent hover:bg-sys-accent/25 transition-colors cursor-pointer"
                >
                  Відкрити сторінку Статистики →
                </button>
              </div>
            </div>
          )}

          {/* =========================================================
              SHARED SLIDE 5 (STUDENT & TEACHER): ДОДАТОК І ОФЛАЙН
             ========================================================= */}
          {stepIdx === 4 && (
            <div className="space-y-3">
              {/* Visual Mockup of Offline Banner + App Icon */}
              <div className="rounded-2xl border border-sys-border bg-sys-bg/80 p-3.5 space-y-2.5">
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-300 flex items-center gap-2">
                  <span>📡</span>
                  <span>Немає підключення • показано збережений розклад</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div className="rounded-xl border border-sys-border bg-sys-card p-3 space-y-1">
                    <p className="text-xs font-bold text-sys-text-primary">🍎 iPhone (Safari)</p>
                    <p className="text-[11px] text-sys-text-secondary leading-snug">
                      1. Натисніть <strong>«Поділитися»</strong> (квадрат зі стрілкою внизу).<br />
                      2. Оберіть <strong>«На початковий екран»</strong>.
                    </p>
                  </div>
                  <div className="rounded-xl border border-sys-border bg-sys-card p-3 space-y-1">
                    <p className="text-xs font-bold text-sys-text-primary">🤖 Android (Chrome)</p>
                    <p className="text-[11px] text-sys-text-secondary leading-snug">
                      1. Натисніть меню <strong>«⋮»</strong> у верхньому куті.<br />
                      2. Оберіть <strong>«Встановити додаток»</strong>.
                    </p>
                  </div>
                </div>
              </div>

              <p className="text-xs text-sys-text-secondary leading-relaxed px-1">
                💡 Під час відключень світла або слабкого мобільного зв&apos;язку (2G/EDGE) встановлений додаток відкривається за 0.2 секунди з автономної пам&apos;яті пристрою.
              </p>
            </div>
          )}
        </div>

        {/* Bottom Stepper Footer */}
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-sys-border bg-sys-surface shrink-0">
          <button
            type="button"
            disabled={stepIdx === 0}
            onClick={() => startTransition(() => setStepIdx((p) => Math.max(0, p - 1)))}
            className="rounded-xl border border-sys-border bg-sys-card px-3.5 py-2 text-xs font-semibold text-sys-text-secondary hover:text-sys-text-primary disabled:opacity-40 disabled:pointer-events-none active:scale-95 transition-all cursor-pointer"
          >
            ← Назад
          </button>

          {/* Progress Dots */}
          <div className="flex items-center gap-1.5" aria-hidden="true">
            {slides.map((s, idx) => (
              <button
                key={s.id}
                type="button"
                onClick={() => startTransition(() => setStepIdx(idx))}
                className={`h-2 rounded-full transition-all duration-150 cursor-pointer ${
                  idx === stepIdx ? "w-5 bg-sys-accent" : "w-2 bg-sys-border hover:bg-sys-text-muted"
                }`}
              />
            ))}
          </div>

          {stepIdx < slides.length - 1 ? (
            <button
              type="button"
              onClick={() => startTransition(() => setStepIdx((p) => Math.min(slides.length - 1, p + 1)))}
              className="rounded-xl bg-sys-accent px-4 py-2 text-xs font-bold text-white hover:opacity-95 active:scale-95 transition-all cursor-pointer"
            >
              Далі →
            </button>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500 active:scale-95 transition-all cursor-pointer"
            >
              Готово ✓
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
