"use client";

import React, { useEffect, useLayoutEffect, useState } from "react";
import { TransitionLink } from "@/components/navigation/NavigationTransitionProvider";
import { SubpageHeader } from "@/components/navigation/SubpageHeader";
import dynamic from "next/dynamic";
import { AppearanceStudioSection } from "@/components/settings/AppearanceStudioSection";
import { useUserSettings } from "../../lib/useUserSettings";
import { useClassroomSubmissions } from "../../lib/useClassroomSubmissions";
import { ClassroomRelinkBanner } from "../../components/ClassroomRelinkBanner";
import { useTeacherAccess } from "../../lib/useTeacherAccess";
import { useAuth } from "../../lib/auth";
import { useToast } from "../../components/ToastProvider";
import { requestClassroomAuth } from "../../lib/classroomAuth";
import { resolveEffectiveScheduleMode } from "../../lib/navigation";
import { useMobileNav } from "../../lib/useMobileNav";
import { api } from "../../lib/api";
import { checkScheduleHasSubgroups, extractSubgroupTeacherHints, SubgroupTeacherHint } from "../../lib/format";
import {
  BarChartIcon,
  BellIcon,
  CalendarIcon,
  ChevronRightIcon,
  GraduationCapIcon,
  LightbulbIcon,
  LinkIcon,
  NetworkIcon,
  ShieldIcon,
  UserCheckIcon,
} from "../../components/ui/Icons";

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

const preloadGuideHubModal = () => {
  void import("../../components/GuideHubModal");
};

const GuideHubModal = dynamic(
  () => import("../../components/GuideHubModal").then((m) => m.GuideHubModal),
  { ssr: false }
);

const ROLE_NAMES: Record<string, string> = {
  admin: "Адміністратор",
  editor: "Редактор",
  viewer: "Перегляд",
  teacher: "Викладач",
};

export default function SettingsPage() {
  const { settings, updateSetting } = useUserSettings();
  const { isLinked, linkedEmail, needsRelink, unlink } = useClassroomSubmissions();
  const { isTeacherUnlocked, unlockTeacher, lockTeacher } = useTeacherAccess();
  const auth = useAuth();
  const { showToast } = useToast();
  const [isLinkingClassroom, setIsLinkingClassroom] = useState(false);
  const [showGuideModal, setShowGuideModal] = useState(false);
  const [showGuideMounted, setShowGuideMounted] = useState(false);
  if (showGuideModal && !showGuideMounted) {
    setShowGuideMounted(true);
  }

  const [groupHasSubgroups, setGroupHasSubgroups] = useState<boolean>(false);
  const [subgroupHints, setSubgroupHints] = useState<{ sub1: SubgroupTeacherHint[]; sub2: SubgroupTeacherHint[] }>({ sub1: [], sub2: [] });

  // Синхронно читаємо кеш підгруп до першого кадру (0 CLS під час View Transition)
  useIsomorphicLayoutEffect(() => {
    try {
      const gid =
        Number(localStorage.getItem("schedule:groupId")) ||
        Number(localStorage.getItem("schedule:classroom_linked_group_id"));
      if (!gid) return;

      const cachedFlag = localStorage.getItem(`schedule:has_subgroups:${gid}`);
      if (cachedFlag !== null) {
        setGroupHasSubgroups(cachedFlag === "1");
      }

      const cachedHintsRaw = localStorage.getItem(`schedule:subgroup_hints:${gid}`);
      if (cachedHintsRaw) {
        const parsed = JSON.parse(cachedHintsRaw);
        if (parsed && Array.isArray(parsed.sub1) && Array.isArray(parsed.sub2)) {
          setSubgroupHints(parsed);
        }
      }
    } catch {}
  }, []);

  useEffect(() => {
    const gid =
      Number(localStorage.getItem("schedule:groupId")) ||
      Number(localStorage.getItem("schedule:classroom_linked_group_id"));
    if (!gid) return;

    const cachedFlag = localStorage.getItem(`schedule:has_subgroups:${gid}`);
    const cachedHintsRaw = localStorage.getItem(`schedule:subgroup_hints:${gid}`);
    if (cachedFlag !== null && cachedHintsRaw) {
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      api.week(gid)
        .then((data) => {
          if (cancelled) return;
          if (Array.isArray(data) && data.length > 0) {
            const allLessons = data.flatMap((d) => d.lessons || []);
            const has = checkScheduleHasSubgroups(allLessons);
            const hints = extractSubgroupTeacherHints(allLessons);
            setGroupHasSubgroups(has);
            setSubgroupHints(hints);
            try {
              localStorage.setItem(`schedule:has_subgroups:${gid}`, has ? "1" : "0");
              localStorage.setItem(`schedule:subgroup_hints:${gid}`, JSON.stringify(hints));
            } catch {}
          }
        })
        .catch(() => {});
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  const {
    setHideTasksTab,
    scheduleMode: navScheduleMode,
    setScheduleMode: setNavScheduleMode,
    setHomeTab,
    urlSearch,
  } = useMobileNav();
  const [scheduleMode, setScheduleMode] = useState<"student" | "teacher">(navScheduleMode);

  useIsomorphicLayoutEffect(() => {
    if (typeof window === "undefined") return;
    const rawSearch = urlSearch || window.location.search;
    let cached: string | null = null;
    try {
      cached = localStorage.getItem("schedule:mode");
    } catch {}
    const resolved = resolveEffectiveScheduleMode(rawSearch, cached);

    setScheduleMode(resolved);
    setHideTasksTab(resolved === "teacher");
    setNavScheduleMode(resolved);
  }, [urlSearch, setHideTasksTab, setNavScheduleMode]);

  const [pinInput, setPinInput] = useState("");
  const [showPinInput, setShowPinInput] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinSuccess, setPinSuccess] = useState(false);
  const [isVerifyingPin, setIsVerifyingPin] = useState(false);

  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pinInput.trim()) return;
    setPinError(null);
    setPinSuccess(false);
    setIsVerifyingPin(true);
    const res = await unlockTeacher(pinInput.trim());
    setIsVerifyingPin(false);
    if (res.success) {
      setPinInput("");
      setPinSuccess(true);
      setTimeout(() => setPinSuccess(false), 3000);
    } else {
      setPinError("Невірний PIN-код. Перевірте й спробуйте ще раз.");
    }
  };

  const handleClassroomLinkClick = async () => {
    if (isLinkingClassroom) return;
    setIsLinkingClassroom(true);
    try {
      const cachedGroupId = typeof window !== "undefined"
        ? (Number(localStorage.getItem("schedule:groupId")) || Number(localStorage.getItem("schedule:classroom_linked_group_id")) || undefined)
        : undefined;

      await requestClassroomAuth({
        groupId: cachedGroupId,
        onSuccess: (res) => {
          const parts = [`підтягнуто ${res.synced_links} онлайн-пар`];
          if (res.synced_tasks > 0) parts.push(`${res.synced_tasks} завдань`);
          const groupPrefix = res.group_name ? `Група ${res.group_name}: ` : "";
          showToast(`${groupPrefix}Classroom успішно прив'язано (${parts.join(", ")})!`, "success");

          if (res.group_id) {
            const newGid = Number(res.group_id);
            if (cachedGroupId && newGid !== cachedGroupId) {
              showToast(`Групу автоматично визначено як «${res.group_name || newGid}» за курсами Classroom`, "info");
            }
            api.week(newGid).then((data) => {
              if (Array.isArray(data) && data.length > 0) {
                const allLessons = data.flatMap((d) => d.lessons || []);
                const has = checkScheduleHasSubgroups(allLessons);
                setGroupHasSubgroups(has);
                try {
                  localStorage.setItem(`schedule:has_subgroups:${newGid}`, has ? "1" : "0");
                } catch {}
              }
            }).catch(() => {});
          }
        },
      });
    } catch (err: any) {
      showToast(err?.message || "Не вдалося прив'язати Classroom", "error");
    } finally {
      setIsLinkingClassroom(false);
    }
  };

  const isStudent = scheduleMode === "student";
  const isTeacher = scheduleMode === "teacher";
  const roleLabel = (auth?.user && (ROLE_NAMES[auth.user.role] || auth.user.role)) || "";

  return (
    <div className="min-h-screen bg-sys-bg text-sys-text-primary">
      <SubpageHeader
        title="Налаштування"
        subtitle="Параметри пристрою, інтеграції та сервіси"
        backHref="/"
        onBackClick={() => setHomeTab("schedule")}
        maxWidthClass="max-w-4xl"
        rightSlot={
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-sys-border bg-sys-bg px-2.5 py-1 text-xs font-semibold text-sys-text-secondary whitespace-nowrap">
            {scheduleMode === "teacher" ? (
              <>
                <UserCheckIcon className="h-3.5 w-3.5 text-sys-accent" />
                <span>Викладач</span>
              </>
            ) : (
              <>
                <GraduationCapIcon className="h-3.5 w-3.5 text-sys-accent" />
                <span>Студент</span>
              </>
            )}
          </span>
        }
      />

      {/* Main Settings Container */}
      <main
        id="main-content"
        tabIndex={-1}
        className="vt-main-content focus:outline-none max-w-4xl mx-auto px-4 py-6 sm:py-8 space-y-5 pb-28 lg:pb-12"
      >
        <p className="text-xs sm:text-sm text-sys-text-secondary">
          Параметри інтерфейсу й розкладу зберігаються на цьому пристрої.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5 items-start">
          {/* Left Column: Schedule Preferences + Account Access + Admin */}
          <div className="space-y-4 sm:space-y-5 min-w-0">
            {/* Section 1: Розклад */}
            <section className="rounded-2xl border border-sys-border bg-sys-card p-4 sm:p-5 shadow-xs space-y-4">
              <div className="flex items-center gap-2 pb-2.5 border-b border-sys-border/60">
                <CalendarIcon className="h-4 w-4 text-sys-accent" />
                <h2 className="text-xs font-bold uppercase tracking-wider text-sys-text-secondary">
                  Розклад
                </h2>
              </div>

              {/* 1.1 Setting: Моя підгрупа (для студентів при наявності підгруп у групи) */}
              {isStudent && groupHasSubgroups && (
                <>
                  <div className="space-y-2 py-0.5">
                    <span className="font-semibold text-xs sm:text-sm text-sys-text-primary">
                      Моя підгрупа
                    </span>
                    <p className="text-xs text-sys-text-secondary leading-relaxed">
                      Фільтрує пари з поділом на 1 або 2 підгрупу. Перемкнути на «Обидві» можна прямо з картки пари.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => updateSetting("defaultSubgroup", 1)}
                        className={`spring-press p-3 rounded-xl border text-left transition-colors cursor-pointer min-w-0 ${
                          settings.defaultSubgroup === 1
                            ? "bg-sys-accent text-white border-sys-accent shadow-xs"
                            : "bg-sys-bg/70 border-sys-border text-sys-text-primary hover:border-sys-accent/45"
                        }`}
                      >
                        <div className="text-xs font-bold">1 підгрупа</div>
                        {subgroupHints.sub1.length > 0 ? (
                          <div className={`text-[11px] mt-0.5 leading-snug break-words [text-wrap:pretty] ${settings.defaultSubgroup === 1 ? "text-white/90 font-medium" : "text-sys-text-secondary"}`}>
                            {subgroupHints.sub1.map((h) => `${h.teacher} (${h.subject})`).join(" • ")}
                          </div>
                        ) : (
                          <div className={`text-[11px] mt-0.5 leading-snug ${settings.defaultSubgroup === 1 ? "text-white/90 font-medium" : "text-sys-text-muted"}`}>
                            Перша половина групи
                          </div>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => updateSetting("defaultSubgroup", 2)}
                        className={`spring-press p-3 rounded-xl border text-left transition-colors cursor-pointer min-w-0 ${
                          settings.defaultSubgroup === 2
                            ? "bg-sys-accent text-white border-sys-accent shadow-xs"
                            : "bg-sys-bg/70 border-sys-border text-sys-text-primary hover:border-sys-accent/45"
                        }`}
                      >
                        <div className="text-xs font-bold">2 підгрупа</div>
                        {subgroupHints.sub2.length > 0 ? (
                          <div className={`text-[11px] mt-0.5 leading-snug break-words [text-wrap:pretty] ${settings.defaultSubgroup === 2 ? "text-white/90 font-medium" : "text-sys-text-secondary"}`}>
                            {subgroupHints.sub2.map((h) => `${h.teacher} (${h.subject})`).join(" • ")}
                          </div>
                        ) : (
                          <div className={`text-[11px] mt-0.5 leading-snug ${settings.defaultSubgroup === 2 ? "text-white/90 font-medium" : "text-sys-text-muted"}`}>
                            Друга половина групи
                          </div>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => updateSetting("defaultSubgroup", "all")}
                        className={`spring-press p-3 rounded-xl border text-left transition-colors cursor-pointer min-w-0 ${
                          settings.defaultSubgroup === "all" || settings.defaultSubgroup === null
                            ? "bg-sys-accent text-white border-sys-accent shadow-xs"
                            : "bg-sys-bg/70 border-sys-border text-sys-text-primary hover:border-sys-accent/45"
                        }`}
                      >
                        <div className="text-xs font-bold">Обидві підгрупи</div>
                        <div className={`text-[11px] mt-0.5 leading-snug break-words [text-wrap:pretty] ${settings.defaultSubgroup === "all" || settings.defaultSubgroup === null ? "text-white/90 font-medium" : "text-sys-text-secondary"}`}>
                          Показувати викладачів обох підгруп
                        </div>
                      </button>
                    </div>
                  </div>
                  <div className="h-px bg-sys-border/40" />
                </>
              )}

              {/* 1.2 Setting: Початковий вигляд */}
              <div className="space-y-2 py-0.5">
                <span className="font-semibold text-xs sm:text-sm text-sys-text-primary">
                  Початковий вигляд
                </span>
                <p className="text-xs text-sys-text-secondary leading-relaxed">
                  Що відкривати першим на широких екранах (≥ 1024 px). На телефонах і вузьких екранах завжди відкривається розклад на день.
                </p>
                <div
                  role="group"
                  aria-label="Початковий вигляд"
                  className="relative grid grid-cols-2 rounded-xl border border-sys-border bg-sys-bg p-1 text-xs isolate select-none"
                >
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute top-1 bottom-1 left-1 z-0 rounded-lg bg-sys-accentSolid shadow-xs transition-transform duration-base [transition-timing-function:var(--ease-spring-snappy)] transform-gpu"
                    style={{
                      width: "calc((100% - 8px) / 2)",
                      transform: `translate3d(${settings.defaultViewDesktop === "week" ? "100%" : "0%"}, 0, 0)`,
                    }}
                  />
                  <button
                    type="button"
                    aria-pressed={settings.defaultViewDesktop === "today"}
                    onClick={() => updateSetting("defaultViewDesktop", "today")}
                    className={`relative z-10 py-1.5 px-2 rounded-lg font-semibold text-center transition-colors duration-fast ease-smooth cursor-pointer active:scale-[0.98] ${
                      settings.defaultViewDesktop === "today"
                        ? "text-white font-bold"
                        : "text-sys-text-secondary hover:text-sys-text-primary"
                    }`}
                  >
                    День
                  </button>
                  <button
                    type="button"
                    aria-pressed={settings.defaultViewDesktop === "week"}
                    onClick={() => updateSetting("defaultViewDesktop", "week")}
                    className={`relative z-10 py-1.5 px-2 rounded-lg font-semibold text-center transition-colors duration-fast ease-smooth cursor-pointer active:scale-[0.98] ${
                      settings.defaultViewDesktop === "week"
                        ? "text-white font-bold"
                        : "text-sys-text-secondary hover:text-sys-text-primary"
                    }`}
                  >
                    Тиждень
                  </button>
                </div>
              </div>

              <div className="h-px bg-sys-border/40" />

              {/* 1.3 Toggle: Завдання (ДЗ) на картках пар */}
              <div className="flex items-start justify-between gap-4 py-0.5">
                <div className="space-y-0.5 min-w-0 pr-2">
                  <span className="font-semibold text-xs sm:text-sm text-sys-text-primary">
                    Завдання (ДЗ) на картках пар
                  </span>
                  <p className="text-xs text-sys-text-secondary leading-relaxed">
                    Показує або приховує блок завдань з Classroom усередині карток пар; окрема вкладка «Завдання» лишається доступною.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-label="Показувати завдання з Classroom на картках пар"
                  aria-checked={settings.showHomeworkBadges}
                  onClick={() => updateSetting("showHomeworkBadges", !settings.showHomeworkBadges)}
                  className={`spring-press relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    settings.showHomeworkBadges ? "bg-sys-accentSolid" : "bg-sys-elevatedBorder"
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                      settings.showHomeworkBadges ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>
            </section>

            {/* Section 2: Google Classroom (для студентів) */}
            {isStudent && (
              <section className="rounded-2xl border border-sys-border bg-sys-card p-4 sm:p-5 shadow-xs space-y-4">
                <div className="flex items-center gap-2 pb-2.5 border-b border-sys-border/60">
                  <GraduationCapIcon className="h-4 w-4 text-sys-accent" />
                  <h2 className="text-xs font-bold uppercase tracking-wider text-sys-text-secondary">
                    Google Classroom
                  </h2>
                </div>

                <ClassroomRelinkBanner />

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-sys-border/80 bg-sys-bg/70 p-3.5 text-xs">
                  <div className="space-y-0.5 min-w-0">
                    <span className="text-xs font-semibold text-sys-text-secondary">Студентська пошта Google</span>
                    {isLinked && linkedEmail ? (
                      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-bold text-sys-text-primary min-w-0">
                        <span
                          className={`h-2 w-2 rounded-full shrink-0 ${
                            needsRelink ? "bg-amber-500 animate-pulse" : "bg-emerald-500"
                          }`}
                        />
                        <span
                          className={`font-semibold shrink-0 ${
                            needsRelink
                              ? "text-amber-700 dark:text-amber-400"
                              : "text-emerald-700 dark:text-emerald-400"
                          }`}
                        >
                          {needsRelink ? "Потрібна повторна прив'язка ·" : "Прив'язано ·"}
                        </span>
                        <span className="break-all sm:truncate min-w-0">{linkedEmail}</span>
                      </div>
                    ) : (
                      <div className="text-sys-text-muted font-medium">Не прив&apos;язано</div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {isLinked ? (
                      <>
                        {needsRelink && (
                          <button
                            type="button"
                            onClick={handleClassroomLinkClick}
                            disabled={isLinkingClassroom}
                            className="spring-press rounded-lg bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 text-xs font-bold transition-colors cursor-pointer disabled:opacity-50 shadow-xs"
                          >
                            {isLinkingClassroom ? "Підключення..." : "Оновити"}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={unlink}
                          className="spring-press rounded-lg bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 px-3 py-1.5 text-xs font-semibold text-rose-700 dark:text-rose-400 transition-colors cursor-pointer"
                        >
                          Відв&apos;язати
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={handleClassroomLinkClick}
                        disabled={isLinkingClassroom}
                        className="spring-press rounded-lg bg-sys-accent hover:brightness-110 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors cursor-pointer disabled:opacity-50 shadow-xs"
                      >
                        {isLinkingClassroom ? "Підключення..." : "Прив'язати Classroom"}
                      </button>
                    )}
                  </div>
                </div>
                <p className="text-xs text-sys-text-secondary leading-relaxed">
                  Прив&apos;язка корпоративної пошти @kre.dp.ua відкриває посилання Meet/Zoom, підтягує дедлайни завдань, статуси здачі та оцінки.
                </p>
              </section>
            )}

            {/* Section 4: Доступ викладача (для викладачів) */}
            {isTeacher && (
              <section className="rounded-2xl border border-sys-border bg-sys-card p-4 sm:p-5 shadow-xs space-y-4">
                <div className="flex items-center gap-2 pb-2.5 border-b border-sys-border/60">
                  <UserCheckIcon className="h-4 w-4 text-sys-accent" />
                  <h2 className="text-xs font-bold uppercase tracking-wider text-sys-text-secondary">
                    Доступ викладача
                  </h2>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-sys-border/80 bg-sys-bg/70 p-3.5 text-xs">
                  <div className="space-y-0.5 min-w-0">
                    <span className="text-xs font-semibold text-sys-text-secondary">Статус доступу</span>
                    {isTeacherUnlocked ? (
                      <div className="flex items-center gap-1.5 font-bold text-emerald-700 dark:text-emerald-400">
                        <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
                        <span>Активовано · посилання Meet/Zoom відкрито</span>
                      </div>
                    ) : (
                      <div className="text-sys-text-muted font-medium">Не активовано</div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {isTeacherUnlocked && (
                      <button
                        type="button"
                        onClick={lockTeacher}
                        className="spring-press rounded-lg bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 px-3 py-1.5 text-xs font-semibold text-rose-700 dark:text-rose-400 transition-colors cursor-pointer"
                      >
                        Скинути PIN-доступ
                      </button>
                    )}
                  </div>
                </div>

                {!isTeacherUnlocked && (
                  <form onSubmit={handlePinSubmit} className="space-y-2 pt-0.5">
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <input
                          type={showPinInput ? "text" : "password"}
                          placeholder="PIN-код викладача"
                          value={pinInput}
                          onChange={(e) => {
                            setPinInput(e.target.value);
                            if (pinError) setPinError(null);
                          }}
                          className={`w-full h-10 px-3 pr-9 rounded-xl border bg-sys-bg text-xs text-sys-text-primary placeholder:text-sys-text-muted focus:outline-hidden focus:ring-2 ${
                            pinError ? "border-rose-500/50 focus:ring-rose-500/20" : "border-sys-border focus:border-sys-accent focus:ring-sys-accent/20"
                          }`}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPinInput(!showPinInput)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-sys-text-muted hover:text-sys-text-primary p-1 transition-colors cursor-pointer"
                          title={showPinInput ? "Приховати PIN" : "Показати PIN"}
                        >
                          {showPinInput ? (
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                              <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                              <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                              <line x1="2" x2="22" y1="2" y2="22" />
                            </svg>
                          ) : (
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                              <circle cx="12" cy="12" r="3" />
                            </svg>
                          )}
                        </button>
                      </div>
                      <button
                        type="submit"
                        disabled={isVerifyingPin || !pinInput.trim()}
                        className="spring-press h-10 px-4 rounded-xl bg-sys-accent text-white font-semibold text-xs hover:brightness-110 disabled:opacity-50 transition-colors duration-fast ease-smooth shrink-0 cursor-pointer shadow-xs"
                      >
                        {isVerifyingPin ? "Перевірка…" : "Активувати"}
                      </button>
                    </div>
                    {pinError && <p className="text-xs text-rose-700 dark:text-rose-400 font-medium">{pinError}</p>}
                    {pinSuccess && <p className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">Доступ викладача активовано.</p>}
                  </form>
                )}

                <p className="text-xs text-sys-text-secondary leading-relaxed">
                  PIN-код відкриває посилання на онлайн-пари (Meet/Zoom) для всіх груп на цьому пристрої без прив&apos;язки Classroom. Код видає адміністратор.
                </p>
              </section>
            )}

            {/* Section 6: Адміністрування */}
            <section className="rounded-2xl border border-sys-border bg-sys-card p-4 sm:p-5 shadow-xs space-y-3">
              <div className="flex items-center gap-2 pb-2.5 border-b border-sys-border/60">
                <ShieldIcon className="h-4 w-4 text-sys-accent" />
                <h2 className="text-xs font-bold uppercase tracking-wider text-sys-text-secondary">
                  Адміністрування
                </h2>
              </div>

              {auth?.user ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs">
                    <div className="min-w-0">
                      <div className="font-bold text-emerald-800 dark:text-emerald-400 truncate">Увійшли як {auth.user.username}</div>
                      <div className="text-sys-text-secondary text-[11px]">Роль: {roleLabel}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => auth.logout()}
                      className="spring-press shrink-0 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 px-3 py-1.5 text-xs font-semibold text-rose-700 dark:text-rose-400 transition-colors cursor-pointer"
                    >
                      Вийти
                    </button>
                  </div>
                  <TransitionLink
                    href="/admin"
                    className="spring-press flex items-center justify-center gap-2 rounded-xl bg-sys-accent px-4 py-2.5 text-xs font-bold text-white hover:brightness-110 transition-colors"
                  >
                    <span>Панель керування розкладом</span>
                    <ChevronRightIcon className="h-3.5 w-3.5" />
                  </TransitionLink>
                </div>
              ) : (
                <TransitionLink
                  href="/login"
                  className="spring-press flex items-center justify-between gap-3 rounded-xl border border-sys-border/80 bg-sys-bg/70 p-3 text-xs hover:border-sys-accent/45 hover:bg-sys-bg transition-colors duration-fast ease-smooth group"
                >
                  <span className="flex flex-col min-w-0">
                    <span className="font-semibold text-sys-text-primary text-xs sm:text-sm leading-snug">
                      Увійти до панелі керування
                    </span>
                    <span className="text-[11px] text-sys-text-secondary leading-snug">
                      Керування розкладом, замінами, імпортом та налаштуваннями коледжу
                    </span>
                  </span>
                  <ChevronRightIcon className="h-4 w-4 text-sys-text-muted group-hover:text-sys-accent group-hover:translate-x-0.5 transition-transform shrink-0" />
                </TransitionLink>
              )}
            </section>
          </div>

          {/* Right Column: Appearance Studio + Unified App Services */}
          <div className="space-y-4 sm:space-y-5 min-w-0">
            {/* Section 3: Студія оформлення */}
            <AppearanceStudioSection />

            {/* Section 5: Розділи та сервіси */}
            <section className="rounded-2xl border border-sys-border bg-sys-card p-4 sm:p-5 shadow-xs space-y-3">
              <div className="flex items-center gap-2 pb-2.5 border-b border-sys-border/60">
                <LinkIcon className="h-4 w-4 text-sys-accent" />
                <h2 className="text-xs font-bold uppercase tracking-wider text-sys-text-secondary">
                  Розділи та сервіси
                </h2>
              </div>

              <div className="space-y-2 text-xs">
                <button
                  type="button"
                  onPointerEnter={preloadGuideHubModal}
                  onTouchStart={preloadGuideHubModal}
                  onFocus={preloadGuideHubModal}
                  onClick={() => {
                    preloadGuideHubModal();
                    setShowGuideMounted(true);
                    setShowGuideModal(true);
                  }}
                  className="spring-press w-full flex items-center justify-between gap-3 rounded-xl border border-sys-accent/35 bg-sys-accent/10 p-3 hover:border-sys-accent/60 hover:bg-sys-accent/15 transition-colors duration-fast ease-smooth group text-left cursor-pointer"
                >
                  <span className="flex items-center gap-3 min-w-0 flex-1">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-sys-accent/25 bg-sys-card text-sys-accent">
                      <LightbulbIcon className="h-4 w-4" />
                    </span>
                    <span className="flex flex-col min-w-0">
                      <span className="font-semibold text-sys-text-primary text-xs sm:text-sm leading-snug">
                        Гід та довідник можливостей
                      </span>
                      <span className="text-[11px] text-sys-text-secondary leading-snug">
                        Покрокова шпаргалка: Classroom, Meet/Zoom, підгрупи, оцінки й заміни
                      </span>
                    </span>
                  </span>
                  <ChevronRightIcon className="h-4 w-4 text-sys-accent group-hover:translate-x-0.5 transition-transform shrink-0" />
                </button>

                <TransitionLink
                  href="/atlas"
                  className="spring-press flex items-center justify-between gap-3 rounded-xl border border-sys-border/80 bg-sys-bg/70 p-3 hover:border-sys-accent/45 hover:bg-sys-bg transition-colors duration-fast ease-smooth group text-left"
                >
                  <span className="flex items-center gap-3 min-w-0 flex-1">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-sys-border/70 bg-sys-card text-sys-text-secondary group-hover:text-sys-accent transition-colors">
                      <NetworkIcon className="h-4 w-4" />
                    </span>
                    <span className="flex flex-col min-w-0">
                      <span className="font-semibold text-sys-text-primary text-xs sm:text-sm leading-snug">
                        Атлас ДФКР
                      </span>
                      <span className="text-[11px] text-sys-text-secondary leading-snug">
                        Мапа орбіт груп і викладачів, порівняння спільних пар та кабінети
                      </span>
                    </span>
                  </span>
                  <ChevronRightIcon className="h-4 w-4 text-sys-text-muted group-hover:text-sys-accent group-hover:translate-x-0.5 transition-transform shrink-0" />
                </TransitionLink>

                <TransitionLink
                  href="/bells"
                  className="spring-press flex items-center justify-between gap-3 rounded-xl border border-sys-border/80 bg-sys-bg/70 p-3 hover:border-sys-accent/45 hover:bg-sys-bg transition-colors duration-fast ease-smooth group text-left"
                >
                  <span className="flex items-center gap-3 min-w-0 flex-1">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-sys-border/70 bg-sys-card text-sys-text-secondary group-hover:text-sys-accent transition-colors">
                      <BellIcon className="h-4 w-4" />
                    </span>
                    <span className="flex flex-col min-w-0">
                      <span className="font-semibold text-sys-text-primary text-xs sm:text-sm leading-snug">
                        Розклад дзвінків
                      </span>
                      <span className="text-[11px] text-sys-text-secondary leading-snug">
                        Час пар і перерв для стандартних (80 хв) та скорочених (50 хв) днів
                      </span>
                    </span>
                  </span>
                  <ChevronRightIcon className="h-4 w-4 text-sys-text-muted group-hover:text-sys-accent group-hover:translate-x-0.5 transition-transform shrink-0" />
                </TransitionLink>

                <TransitionLink
                  href={scheduleMode === "teacher" ? "/statistics?mode=teacher" : "/statistics"}
                  className="spring-press flex items-center justify-between gap-3 rounded-xl border border-sys-border/80 bg-sys-bg/70 p-3 hover:border-sys-accent/45 hover:bg-sys-bg transition-colors duration-fast ease-smooth group text-left"
                >
                  <span className="flex items-center gap-3 min-w-0 flex-1">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-sys-border/70 bg-sys-card text-sys-text-secondary group-hover:text-sys-accent transition-colors">
                      <BarChartIcon className="h-4 w-4" />
                    </span>
                    <span className="flex flex-col min-w-0">
                      <span className="font-semibold text-sys-text-primary text-xs sm:text-sm leading-snug">
                        Статистика занять
                      </span>
                      <span className="text-[11px] text-sys-text-secondary leading-snug">
                        Вичитані пари й академічні години з початку семестру
                      </span>
                    </span>
                  </span>
                  <ChevronRightIcon className="h-4 w-4 text-sys-text-muted group-hover:text-sys-accent group-hover:translate-x-0.5 transition-transform shrink-0" />
                </TransitionLink>

                <TransitionLink
                  href="/educational-process"
                  className="spring-press flex items-center justify-between gap-3 rounded-xl border border-sys-border/80 bg-sys-bg/70 p-3 hover:border-sys-accent/45 hover:bg-sys-bg transition-colors duration-fast ease-smooth group text-left"
                >
                  <span className="flex items-center gap-3 min-w-0 flex-1">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-sys-border/70 bg-sys-card text-sys-text-secondary group-hover:text-sys-accent transition-colors">
                      <CalendarIcon className="h-4 w-4" />
                    </span>
                    <span className="flex flex-col min-w-0">
                      <span className="font-semibold text-sys-text-primary text-xs sm:text-sm leading-snug">
                        Графік навчального процесу
                      </span>
                      <span className="text-[11px] text-sys-text-secondary leading-snug">
                        Періоди навчання, сесій, канікул, практик та атестації за групами
                      </span>
                    </span>
                  </span>
                  <ChevronRightIcon className="h-4 w-4 text-sys-text-muted group-hover:text-sys-accent group-hover:translate-x-0.5 transition-transform shrink-0" />
                </TransitionLink>
              </div>
            </section>
          </div>
        </div>

        {showGuideMounted && (
          <GuideHubModal
            isOpen={showGuideModal}
            groupId={
              typeof window !== "undefined"
                ? Number(localStorage.getItem("schedule:groupId")) ||
                  Number(localStorage.getItem("schedule:classroom_linked_group_id")) ||
                  undefined
                : undefined
            }
            teacherId={
              typeof window !== "undefined"
                ? Number(localStorage.getItem("schedule:teacherId")) || undefined
                : undefined
            }
            mode={
              typeof window !== "undefined"
                ? (localStorage.getItem("schedule:mode") as "student" | "teacher") || "student"
                : "student"
            }
            onClose={() => setShowGuideModal(false)}
          />
        )}
      </main>
    </div>
  );
}
