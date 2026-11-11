"use client";

import React, { useEffect, useMemo, useState, startTransition } from "react";
import { useRouter } from "next/navigation";
import { useClassroomSubmissions } from "../lib/useClassroomSubmissions";
import { useTeacherAccess } from "../lib/useTeacherAccess";
import { useUserSettings } from "../lib/useUserSettings";

export interface GuideHubModalProps {
  isOpen?: boolean;
  onClose: () => void;
  initialRole?: "student" | "teacher";
  mode?: "student" | "teacher";
  groupId?: number | null;
  teacherId?: number | null;
}

type GuideSection = "quickstart" | "cards" | "classroom" | "pwa";

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
  const [section, setSection] = useState<GuideSection>("quickstart");
  const [groupName, setGroupName] = useState<string | null>(null);
  const [teacherName, setTeacherName] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || typeof window === "undefined") return;
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
  }, [isOpen, initialRole, mode, groupId, teacherId]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const readinessSteps = useMemo(() => {
    if (role === "teacher") {
      return [
        {
          done: Boolean(teacherName),
          title: teacherName ? `Профіль: ${teacherName}` : "Оберіть своє прізвище у шапці",
          desc: "Ваш розклад автоматично зберігається для миттєвого відкриття",
        },
        {
          done: isTeacherUnlocked,
          title: isTeacherUnlocked ? "PIN-доступ викладача активний" : "Введіть PIN-код викладача",
          desc: "Відкриває прямі посилання на Google Meet та Zoom на всіх парах",
          actionLabel: isTeacherUnlocked ? null : "Увійти в Налаштуваннях",
          onAction: () => {
            onClose();
            router.push("/settings?mode=teacher");
          },
        },
      ];
    }

    return [
      {
        done: Boolean(groupName),
        title: groupName ? `Група обрана: ${groupName}` : "Оберіть свою навчальну групу",
        desc: "Натисніть на назву групи у верхній панелі сайту",
      },
      {
        done: isLinked,
        title: isLinked
          ? `Classroom прив'язано (${linkedEmail})`
          : "Прив'яжіть пошту @kre.dp.ua",
        desc: "Відкриває доступ до посилань Meet/Zoom, ваших ДЗ та оцінок у фоні",
        actionLabel: isLinked ? null : "Прив'язати в 1 клік",
        onAction: () => {
          onClose();
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent("trigger-classroom-sync"));
          }, 120);
        },
      },
      {
        done: settings.defaultSubgroup === 1 || settings.defaultSubgroup === 2,
        title:
          settings.defaultSubgroup === 1 || settings.defaultSubgroup === 2
            ? `Обрана ${settings.defaultSubgroup}-ша підгрупа`
            : "Показано обидві підгрупи",
        desc: "Можна перемкнути прямо тут або кліком по «1 підгр. / 2 підгр.» на картці пари",
      },
    ];
  }, [role, groupName, teacherName, isLinked, linkedEmail, isTeacherUnlocked, settings.defaultSubgroup, onClose, router]);

  if (!isOpen) return null;

  const sections: { id: GuideSection; label: string; icon: string }[] = [
    { id: "quickstart", label: "Старт", icon: "⚡" },
    { id: "cards", label: "Картки пар", icon: "🎴" },
    { id: "classroom", label: role === "teacher" ? "Онлайн і PIN" : "Classroom і ДЗ", icon: "🎓" },
    { id: "pwa", label: "Додаток", icon: "📲" },
  ];

  const sectionIndex = sections.findIndex((s) => s.id === section);

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
        className="w-full sm:max-w-xl max-h-[90dvh] sm:max-h-[85vh] flex flex-col rounded-t-2xl sm:rounded-2xl border border-sys-border bg-sys-card text-sys-text-primary shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-4 py-3.5 border-b border-sys-border bg-sys-surface shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sys-accent/15 border border-sys-accent/30 text-sys-accent font-bold text-base">
              ?
            </div>
            <div className="min-w-0">
              <h2 id="guide-modal-title" className="text-base font-bold leading-tight truncate">
                Довідник та швидке налаштування
              </h2>
              <p className="text-xs text-sys-text-secondary truncate mt-0.5">
                Усі можливості розкладу ДФКР без зайвих рухів
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

        {/* Role & Section Switchers */}
        <div className="px-4 pt-3 pb-2.5 border-b border-sys-border/60 bg-sys-card space-y-2.5 shrink-0">
          {/* Role Switcher: Студент vs Викладач */}
          <div className="relative grid grid-cols-2 rounded-xl border border-sys-border bg-sys-bg p-1 text-xs font-semibold select-none isolate">
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
              onClick={() => startTransition(() => setRole("student"))}
              className={`relative z-10 py-1.5 rounded-lg transition-colors duration-150 cursor-pointer ${
                role === "student" ? "text-white font-bold" : "text-sys-text-secondary hover:text-sys-text-primary"
              }`}
            >
              🎓 Я студент
            </button>
            <button
              type="button"
              onClick={() => startTransition(() => setRole("teacher"))}
              className={`relative z-10 py-1.5 rounded-lg transition-colors duration-150 cursor-pointer ${
                role === "teacher" ? "text-white font-bold" : "text-sys-text-secondary hover:text-sys-text-primary"
              }`}
            >
              👨‍🏫 Я викладач
            </button>
          </div>

          {/* 4 Section Tabs */}
          <div className="relative grid grid-cols-4 rounded-xl border border-sys-border bg-sys-bg p-1 text-xs font-semibold select-none isolate">
            <div
              aria-hidden="true"
              className="absolute top-1 bottom-1 pointer-events-none transition-transform duration-150 ease-out transform-gpu will-change-transform z-0"
              style={{
                left: "4px",
                width: "calc((100% - 8px) / 4)",
                transform: `translate3d(calc(${Math.max(0, sectionIndex)} * 100%), 0, 0)`,
              }}
            >
              <div className="h-full w-full rounded-lg bg-sys-card border border-sys-border shadow-2xs" />
            </div>
            {sections.map((s) => {
              const active = section === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => startTransition(() => setSection(s.id))}
                  className={`relative z-10 flex items-center justify-center gap-1 py-1.5 px-1 rounded-lg transition-colors duration-150 cursor-pointer truncate ${
                    active ? "text-sys-accent font-bold" : "text-sys-text-secondary hover:text-sys-text-primary"
                  }`}
                >
                  <span>{s.icon}</span>
                  <span className="truncate">{s.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-3.5 text-xs leading-relaxed">
          {section === "quickstart" && (
            <>
              <div className="rounded-xl border border-sys-border bg-sys-bg/60 p-3.5 space-y-2.5">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-sys-text-secondary">
                    Ваш статус налаштування
                  </h3>
                  <span className="text-[11px] font-semibold text-sys-accent">
                    {readinessSteps.filter((s) => s.done).length} із {readinessSteps.length} готово
                  </span>
                </div>

                <div className="space-y-2">
                  {readinessSteps.map((step, idx) => (
                    <div
                      key={idx}
                      className={`flex items-start justify-between gap-2.5 rounded-xl border p-2.5 ${
                        step.done
                          ? "border-emerald-500/30 bg-emerald-500/5"
                          : "border-sys-border bg-sys-card"
                      }`}
                    >
                      <div className="flex items-start gap-2.5 min-w-0">
                        <span
                          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                            step.done
                              ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400"
                              : "bg-amber-500/20 text-amber-700 dark:text-amber-300"
                          }`}
                        >
                          {step.done ? "✓" : idx + 1}
                        </span>
                        <div className="min-w-0">
                          <p className="font-semibold text-sys-text-primary">{step.title}</p>
                          <p className="text-sys-text-secondary text-[11px] mt-0.5">{step.desc}</p>
                        </div>
                      </div>

                      {step.actionLabel && step.onAction && (
                        <button
                          type="button"
                          onClick={step.onAction}
                          className="shrink-0 rounded-lg bg-sys-accent px-2.5 py-1.5 text-[11px] font-semibold text-white active:scale-95 transition-transform cursor-pointer"
                        >
                          {step.actionLabel}
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                {/* Quick Subgroup Selector right inside the Guide for Students */}
                {role === "student" && (
                  <div className="pt-1 flex items-center justify-between gap-2 border-t border-sys-border/50">
                    <span className="font-semibold text-sys-text-secondary">Моя підгрупа:</span>
                    <div className="inline-flex items-center gap-1 rounded-lg border border-sys-border bg-sys-card p-0.5">
                      {(["all", 1, 2] as const).map((sub) => {
                        const isSel = settings.defaultSubgroup === sub;
                        return (
                          <button
                            key={String(sub)}
                            type="button"
                            onClick={() => updateSetting("defaultSubgroup", sub)}
                            className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                              isSel
                                ? "bg-sys-accent text-white font-bold"
                                : "text-sys-text-secondary hover:text-sys-text-primary"
                            }`}
                          >
                            {sub === "all" ? "Обидві" : `${sub} підгр.`}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-sys-border bg-sys-bg/40 p-3.5 space-y-2">
                <h4 className="font-bold text-sys-text-primary">💡 Корисні фішки на щодень</h4>
                <ul className="space-y-1.5 text-sys-text-secondary">
                  <li>
                    • <strong>Автоперехід на завтра:</strong> у будні після <strong>15:20</strong> (коли закінчилася 4-та пара) розклад сам відкриває пари на завтрашній день.
                  </li>
                  <li>
                    • <strong>Миттєвий перегляд іншої групи чи викладача:</strong> натисніть на ім&apos;я викладача або номер групи прямо на картці пари — розклад перемкнеться з кнопкою повернення назад.
                  </li>
                  <li>
                    • <strong>Поділитися розкладом:</strong> біля дати дня є кнопки копіювання красивої PNG-картинки розкладу або готового тексту для Telegram-чату групи.
                  </li>
                </ul>
              </div>
            </>
          )}

          {section === "cards" && (
            <div className="space-y-2.5">
              <div className="rounded-xl border border-sys-border bg-sys-bg/50 p-3.5 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-sys-text-primary">1. Підгрупи та кабінети</span>
                  <span className="rounded-md border border-sys-accent/40 bg-sys-accent/15 px-2 py-0.5 text-[11px] font-bold text-sys-accent">
                    1 підгр. / 2 підгр.
                  </span>
                </div>
                <p className="text-sys-text-secondary">
                  Якщо пара ділиться на дві підгрупи, біля кожного викладача показується його власний кабінет або кнопка онлайн-дзвінка. Натисніть на бейдж <strong>«1 підгр.»</strong> або <strong>«2 підгр.»</strong> прямо на картці пари, щоб приховати чужу підгрупу у всьому розкладі.
                </p>
              </div>

              <div className="rounded-xl border border-sys-border bg-sys-bg/50 p-3.5 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-sys-text-primary">2. Кнопки Google Meet та Zoom з кодом</span>
                  <span className="rounded-md border border-sky-500/40 bg-sky-500/15 px-2 py-0.5 text-[11px] font-bold text-sky-400">
                    Zoom · код: dfkr ↗
                  </span>
                </div>
                <p className="text-sys-text-secondary">
                  Якщо викладач опублікував у Classroom лише Ідентифікатор (ID) та Код доступу Zoom — сайт сам створить пряме посилання на конференцію, покаже пароль на кнопці та <strong>автоматично скопіює код у буфер обміну</strong> при кліку.
                </p>
              </div>

              <div className="rounded-xl border border-sys-border bg-sys-bg/50 p-3.5 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-sys-text-primary">3. Заміни, перенесення та сесія</span>
                  <span className="rounded-md bg-amber-500 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-950">
                    ⚡ Заміна
                  </span>
                </div>
                <p className="text-sys-text-secondary">
                  Разові заміни підсвічуються жовтим бейджем, перенесені пари показують новий день і номер пари (<em>«Перенесено → Четвер, 3 пара»</em>), а під час сесії на картках з&apos;являються мітки <strong>Екзамен, Залік, Консультація</strong>.
                </p>
              </div>
            </div>
          )}

          {section === "classroom" && (
            <div className="space-y-2.5">
              {role === "student" ? (
                <>
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 space-y-1.5">
                    <h4 className="font-bold text-emerald-700 dark:text-emerald-300">
                      🔄 Підключи один раз — оновлюється само у фоні
                    </h4>
                    <p className="text-sys-text-secondary">
                      При вході через коледжну пошту <strong>@kre.dp.ua</strong> сайт запитує доступ <strong>тільки до читання Google Classroom</strong> (без жодних галочок і без доступу до сторонніх сервісів). Після цього сервер сам перевіряє нові посилання на пари кожні 10 хвилин під час занять.
                    </p>
                  </div>

                  <div className="rounded-xl border border-sys-border bg-sys-bg/50 p-3.5 space-y-1.5">
                    <h4 className="font-bold text-sys-text-primary">
                      📋 Оновлена вкладка «Завдання» та «Оцінки»
                    </h4>
                    <p className="text-sys-text-secondary">
                      Більше не треба гортати тижні! Усі ваші завдання зібрані у 3 вкладки:
                    </p>
                    <ul className="space-y-1 text-sys-text-secondary pt-1">
                      <li>• <strong>До здачі:</strong> всі актуальні завдання за дедлайнами + завдання без терміну здачі.</li>
                      <li>• <strong>Борги:</strong> всі нездані роботи, термін яких минув.</li>
                      <li>• <strong>Здано:</strong> ваші виконані та оцінені роботи (від найновіших до найстаріших).</li>
                    </ul>
                  </div>
                </>
              ) : (
                <>
                  <div className="rounded-xl border border-sys-border bg-sys-bg/50 p-3.5 space-y-1.5">
                    <h4 className="font-bold text-sys-text-primary">
                      🔑 Доступ викладача до онлайн-пар (PIN-код)
                    </h4>
                    <p className="text-sys-text-secondary">
                      Посилання на Google Meet та Zoom захищені від сторонніх гостей замочком <strong>🔒 Онлайн</strong>. Введіть єдиний PIN-код викладача у <strong>Налаштуваннях</strong> (або при кліку на замочок), щоб бачити прямі посилання на дзвінки у всіх групах.
                    </p>
                  </div>

                  <div className="rounded-xl border border-sys-border bg-sys-bg/50 p-3.5 space-y-1.5">
                    <h4 className="font-bold text-sys-text-primary">
                      📊 Статистика вичитаних годин
                    </h4>
                    <p className="text-sys-text-secondary">
                      У розділі <strong>«Статистика»</strong> викладач може переглянути кількість проведених годин та пар за семестр у розрізі кожної дисципліни та кожної навчальної групи.
                    </p>
                  </div>
                </>
              )}
            </div>
          )}

          {section === "pwa" && (
            <div className="space-y-2.5">
              <div className="rounded-xl border border-sys-border bg-sys-bg/50 p-3.5 space-y-1.5">
                <h4 className="font-bold text-sys-text-primary">
                  📡 Автономна робота без світла та інтернету
                </h4>
                <p className="text-sys-text-secondary">
                  Сайт автоматично кешує ваш поточний і сусідні тижні розкладу в пам&apos;яті смартфона. Під час блекаутів або слабкого мобільного зв&apos;язку (2G/EDGE) розклад відкривається миттєво зі збереженої копії.
                </p>
              </div>

              <div className="rounded-xl border border-sys-border bg-sys-bg/50 p-3.5 space-y-2">
                <h4 className="font-bold text-sys-text-primary">
                  📱 Як встановити розклад як додаток на телефон
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                  <div className="rounded-lg border border-sys-border bg-sys-card p-2.5">
                    <p className="font-bold text-sys-text-primary mb-1">🍎 iPhone (Safari)</p>
                    <p className="text-sys-text-secondary text-[11px]">
                      Натисніть кнопку <strong>«Поділитися»</strong> (квадрат зі стрілкою вгору внизу браузера) → оберіть <strong>«На початковий екран»</strong>.
                    </p>
                  </div>
                  <div className="rounded-lg border border-sys-border bg-sys-card p-2.5">
                    <p className="font-bold text-sys-text-primary mb-1">🤖 Android (Chrome)</p>
                    <p className="text-sys-text-secondary text-[11px]">
                      Натисніть меню <strong>«⋮»</strong> у правому верхньому куті браузера → <strong>«Додати на головний екран»</strong> (або «Встановити додаток»).
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-sys-border bg-sys-surface shrink-0">
          <button
            type="button"
            onClick={() => {
              onClose();
              router.push(`/settings?mode=${role}`);
            }}
            className="text-xs font-semibold text-sys-accent hover:underline cursor-pointer"
          >
            Перейти в Налаштування →
          </button>

          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-sys-accent px-4 py-2 text-xs font-bold text-white hover:opacity-95 active:scale-95 transition-all cursor-pointer"
          >
            Зрозуміло
          </button>
        </div>
      </div>
    </div>
  );
}
