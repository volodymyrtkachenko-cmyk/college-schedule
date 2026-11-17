"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DesktopSpotlightGrid } from "@/components/navigation/DesktopSpotlightGrid";
import { SubpageHeader } from "@/components/navigation/SubpageHeader";
import { ChevronDownIcon, ChevronUpIcon, CloseIcon, SearchIcon } from "@/components/ui/Icons";
import {
  api,
  type EducationalProcessMatrix,
} from "@/lib/api";
import {
  getCurrentAcademicYear,
  readCacheSnapshot,
  writeCacheSnapshot,
} from "@/lib/cacheSnapshot";
import { KYIV_DATE_FMT } from "@/lib/date";
import {
  mergeProcessCells,
  MS_PER_DAY,
  parseUtcMidnightMs,
  partitionSemesterPeriods,
  pluralizeUk,
  resolveValidSemesters,
  summarizeProcessPeriods,
  type MergedPeriod,
} from "@/lib/educationalProcess";

const TYPE_CONFIG: Record<
  string,
  {
    name: string;
    badgeBg: string;
    badgeText: string;
    badgeBorder: string;
    dotClass: string;
    barClass: string;
  }
> = {
  session: {
    name: "Екзаменаційна сесія",
    badgeBg: "bg-rose-500/10 dark:bg-rose-500/15",
    badgeText: "text-rose-700 dark:text-rose-300",
    badgeBorder: "border-rose-500/30",
    dotClass: "bg-rose-500",
    barClass: "bg-rose-500 hover:bg-rose-400",
  },
  holiday: {
    name: "Канікули",
    badgeBg: "bg-emerald-500/10 dark:bg-emerald-500/15",
    badgeText: "text-emerald-700 dark:text-emerald-300",
    badgeBorder: "border-emerald-500/30",
    dotClass: "bg-emerald-500",
    barClass: "bg-emerald-500 hover:bg-emerald-400",
  },
  practice: {
    name: "Практика",
    badgeBg: "bg-amber-500/10 dark:bg-amber-500/15",
    badgeText: "text-amber-800 dark:text-amber-300",
    badgeBorder: "border-amber-500/30",
    dotClass: "bg-amber-500",
    barClass: "bg-amber-500 hover:bg-amber-400",
  },
  diploma: {
    name: "Дипломне проєктування",
    badgeBg: "bg-purple-500/10 dark:bg-purple-500/15",
    badgeText: "text-purple-700 dark:text-purple-300",
    badgeBorder: "border-purple-500/30",
    dotClass: "bg-purple-500",
    barClass: "bg-purple-500 hover:bg-purple-400",
  },
  attestation: {
    name: "Атестація",
    badgeBg: "bg-sky-500/10 dark:bg-sky-500/15",
    badgeText: "text-sky-700 dark:text-sky-300",
    badgeBorder: "border-sky-500/30",
    dotClass: "bg-sky-500",
    barClass: "bg-sky-500 hover:bg-sky-400",
  },
  theory: {
    name: "Теоретичне навчання",
    badgeBg: "bg-sys-bg",
    badgeText: "text-sys-text-secondary",
    badgeBorder: "border-sys-border",
    dotClass: "bg-slate-400",
    barClass: "bg-slate-300 dark:bg-slate-600/80 hover:bg-slate-400 dark:hover:bg-slate-500",
  },
};

const ACADEMIC_MONTH_LABELS = [
  "Вер",
  "Жовт",
  "Лист",
  "Груд",
  "Січ",
  "Лют",
  "Бер",
  "Квіт",
  "Трав",
  "Черв",
  "Лип",
  "Серп",
];

const MONTH_NAMES_UA = [
  "січ.",
  "лют.",
  "бер.",
  "квіт.",
  "трав.",
  "черв.",
  "лип.",
  "серп.",
  "вер.",
  "жовт.",
  "лист.",
  "груд.",
];

function formatDisplayDate(dateStr: string) {
  const ms = parseUtcMidnightMs(dateStr);
  if (Number.isNaN(ms)) return dateStr;
  const d = new Date(ms);
  const day = d.getUTCDate();
  const month = MONTH_NAMES_UA[d.getUTCMonth()] || "";
  const year = d.getUTCFullYear();
  return `${day} ${month} ${year}`;
}

function formatShortDate(dateStr: string) {
  const ms = parseUtcMidnightMs(dateStr);
  if (Number.isNaN(ms)) return dateStr;
  const d = new Date(ms);
  return `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function addDaysIso(dateStr: string, days: number): string {
  const ms = parseUtcMidnightMs(dateStr);
  if (Number.isNaN(ms)) return dateStr;
  return new Date(ms + days * MS_PER_DAY).toISOString().slice(0, 10);
}

interface SemesterMilestoneItem extends MergedPeriod {
  status: "past" | "current" | "upcoming";
  daysDiff: number;
}

function SemesterSection({
  title,
  subtitle,
  items,
  extraTopPadding = false,
}: {
  title: string;
  subtitle: string;
  items: SemesterMilestoneItem[];
  extraTopPadding?: boolean;
}) {
  if (items.length === 0) return null;

  return (
    <section aria-label={title} className={`space-y-3 ${extraTopPadding ? "pt-2" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-sys-border/60 pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="px-2 py-0.5 rounded-md bg-sys-bg border border-sys-border text-xs font-bold text-sys-text-primary">
            {title}
          </h2>
          <span className="text-xs text-sys-text-secondary font-medium">
            {subtitle}
          </span>
        </div>
        <span className="text-xs text-sys-text-muted">
          {pluralizeUk(items.length, ["етап", "етапи", "етапів"])}
        </span>
      </div>

      <DesktopSpotlightGrid className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {items.map((item, idx) => {
          const cfg = TYPE_CONFIG[item.period_type] || TYPE_CONFIG.theory;
          const isCurrent = item.status === "current";
          const isUpcoming = item.status === "upcoming";
          const isPast = item.status === "past";

          return (
            <div
              key={`${item.start_week}-${item.period_type}-${idx}`}
              className={`interactive-surface scroll-reveal-card rounded-2xl border p-4 flex flex-col justify-between shadow-xs ${
                isCurrent
                  ? "border-sys-accent bg-sys-accent/5 ring-1 ring-sys-accent/40"
                  : isUpcoming
                  ? "border-sys-border bg-sys-card hover:border-sys-border-elevated"
                  : "border-sys-border/50 bg-sys-card/50 opacity-65"
              }`}
            >
              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-semibold border ${cfg.badgeBg} ${cfg.badgeText} ${cfg.badgeBorder}`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${cfg.dotClass}`} />
                    <span>{cfg.name}</span>
                  </span>

                  {isCurrent && (
                    <span className="px-2 py-0.5 rounded-full bg-rose-600 text-white font-bold text-[10px] uppercase tracking-wide">
                      Зараз
                    </span>
                  )}
                  {isUpcoming && (
                    <span className="text-xs font-semibold text-sys-accent">
                      через {item.daysDiff} дн.
                    </span>
                  )}
                  {isPast && (
                    <span className="text-[11px] font-medium text-sys-text-muted">
                      Завершено
                    </span>
                  )}
                </div>

                <h3 className="text-sm sm:text-base font-bold text-sys-text-primary mt-1">
                  {item.name || cfg.name}
                </h3>
              </div>

              <div className="mt-4 pt-3 border-t border-sys-border/50 flex items-center justify-between gap-2 text-xs text-sys-text-secondary">
                <span className="truncate">
                  {formatDisplayDate(item.start_date)} — {formatDisplayDate(item.end_date)}
                </span>
                <span className="font-semibold text-sys-text-primary shrink-0">
                  {pluralizeUk(item.weeks_count, ["тиждень", "тижні", "тижнів"])}
                </span>
              </div>
            </div>
          );
        })}
      </DesktopSpotlightGrid>
    </section>
  );
}

export function EducationalProcessClient() {
  const selectedYear = useMemo(() => getCurrentAcademicYear(), []);

  const [matrix, setMatrix] = useState<EducationalProcessMatrix | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [savedGroupId, setSavedGroupId] = useState<number | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [activeCourseTab, setActiveCourseTab] = useState<number | "all">(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [showFullSchedule, setShowFullSchedule] = useState(false);
  const [activeTimelineIdx, setActiveTimelineIdx] = useState<number | null>(null);
  const hasInitializedGroupRef = useRef(false);

  useEffect(() => {
    try {
      const raw =
        window.localStorage.getItem("schedule:groupId") ||
        window.localStorage.getItem("schedule:classroom_linked_group_id");
      if (raw) {
        const parsed = Number(raw);
        if (!Number.isNaN(parsed) && parsed > 0) {
          setSavedGroupId(parsed);
          setSelectedGroupId(parsed);
        }
      }
    } catch {}
  }, []);

  useEffect(() => {
    const cacheKey = `edu-process:${selectedYear}`;
    const cached = readCacheSnapshot<EducationalProcessMatrix>(cacheKey);
    if (cached?.data) {
      setMatrix(cached.data);
      setLoading(false);
    } else {
      setLoading(true);
    }
    setError(null);

    let cancelled = false;
    api
      .educationalProcess<EducationalProcessMatrix>(selectedYear)
      .then((data) => {
        if (cancelled) return;
        writeCacheSnapshot(cacheKey, data);
        setMatrix(data);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error(err);
        if (!cached?.data) {
          setError("Не вдалося завантажити графік освітнього процесу.");
        }
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedYear]);

  const availableCourses = useMemo(() => {
    if (!matrix || !matrix.courses.length) return [1, 2, 3, 4];
    return [...matrix.courses]
      .filter((c) => c.groups.length > 0)
      .map((c) => c.course)
      .sort((a, b) => a - b);
  }, [matrix]);

  const allGroups = useMemo(() => {
    if (!matrix) return [];
    return matrix.courses
      .flatMap((c) =>
        c.groups.map((g) => ({
          id: g.group_id,
          name: g.group_name,
          course: c.course,
        }))
      )
      .sort((a, b) => {
        const numA = parseInt(a.name, 10);
        const numB = parseInt(b.name, 10);
        if (!Number.isNaN(numA) && !Number.isNaN(numB)) {
          return numA - numB;
        }
        return a.name.localeCompare(b.name);
      });
  }, [matrix]);

  useEffect(() => {
    if (allGroups.length === 0) return;

    const preferredId = selectedGroupId ?? savedGroupId;
    const matched = preferredId ? allGroups.find((g) => g.id === preferredId) : null;

    if (!matched) {
      const fallback =
        (savedGroupId ? allGroups.find((g) => g.id === savedGroupId) : null) ?? allGroups[0];
      setSelectedGroupId(fallback.id);
      setActiveCourseTab(fallback.course);
      hasInitializedGroupRef.current = true;
      return;
    }

    // Align the course tab to the user's active/saved group once matrix data loads
    if (!hasInitializedGroupRef.current) {
      hasInitializedGroupRef.current = true;
      setActiveCourseTab(matched.course);
      return;
    }

    if (activeCourseTab !== "all" && !availableCourses.includes(activeCourseTab)) {
      setActiveCourseTab(matched.course);
    }
  }, [allGroups, availableCourses, activeCourseTab, selectedGroupId, savedGroupId]);

  const currentGroupData = useMemo(() => {
    if (!matrix || !selectedGroupId) return null;
    for (const course of matrix.courses) {
      const g = course.groups.find((x) => x.group_id === selectedGroupId);
      if (g) {
        return {
          group: g,
          course: course.course,
          mergedPeriods: mergeProcessCells(g.cells, matrix.weeks),
        };
      }
    }
    return null;
  }, [matrix, selectedGroupId]);

  const visibleGroups = useMemo(() => {
    return allGroups.filter((g) => {
      const matchesCourse = activeCourseTab === "all" || g.course === activeCourseTab;
      const matchesSearch =
        !searchQuery.trim() ||
        g.name.toLowerCase().includes(searchQuery.trim().toLowerCase());
      return matchesCourse && matchesSearch;
    });
  }, [allGroups, activeCourseTab, searchQuery]);

  const todayIso = useMemo(() => {
    return KYIV_DATE_FMT.format(new Date());
  }, []);

  const realTimeStatus = useMemo(() => {
    if (!currentGroupData || !matrix || !matrix.weeks.length) return null;

    const todayMs = parseUtcMidnightMs(todayIso);
    const { mergedPeriods } = currentGroupData;

    let currentPeriod: MergedPeriod | null = null;
    for (const p of mergedPeriods) {
      const s = parseUtcMidnightMs(p.start_date);
      const e = parseUtcMidnightMs(p.end_date);
      if (todayMs >= s && todayMs <= e) {
        currentPeriod = p;
        break;
      }
    }

    let nextMilestone: { period: MergedPeriod; daysUntil: number } | null = null;
    for (const p of mergedPeriods) {
      if (p.period_type === "theory") continue;
      const s = parseUtcMidnightMs(p.start_date);
      if (s > todayMs) {
        const daysUntil = Math.round((s - todayMs) / MS_PER_DAY);
        nextMilestone = { period: p, daysUntil };
        break;
      }
    }

    const currentWeekObj = matrix.weeks.find((w) => {
      const s = parseUtcMidnightMs(w.start_date);
      const e = parseUtcMidnightMs(w.end_date);
      return todayMs >= s && todayMs <= e;
    });

    const firstWeek = matrix.weeks[0];
    const lastWeek = matrix.weeks[matrix.weeks.length - 1];
    let progressPercent = 0;
    if (firstWeek && lastWeek) {
      const startMs = parseUtcMidnightMs(firstWeek.start_date);
      const endMs = parseUtcMidnightMs(lastWeek.end_date) + MS_PER_DAY;
      if (todayMs >= endMs) {
        progressPercent = 100;
      } else if (todayMs > startMs) {
        progressPercent = Math.min(
          100,
          Math.max(0, Math.round(((todayMs - startMs) / (endMs - startMs)) * 100))
        );
      }
    }

    return {
      currentPeriod,
      nextMilestone,
      currentWeekNumber: currentWeekObj?.week_number ?? null,
      progressPercent,
    };
  }, [currentGroupData, matrix, todayIso]);

  const semesterMilestones = useMemo(() => {
    if (!currentGroupData) {
      return {
        semester1: [],
        semester2: [],
        sem1Subtitle: "Осінь — Зима (вересень – січень)",
        sem2Subtitle: "Весна — Літо (січень – серпень)",
      };
    }

    const todayMs = parseUtcMidnightMs(todayIso);
    const nonTheory = currentGroupData.mergedPeriods.filter((p) => p.period_type !== "theory");

    const formatItem = (p: MergedPeriod) => {
      const s = parseUtcMidnightMs(p.start_date);
      const e = parseUtcMidnightMs(p.end_date);
      let status: "past" | "current" | "upcoming" = "upcoming";
      let daysDiff = 0;

      if (todayMs > e) {
        status = "past";
      } else if (todayMs >= s && todayMs <= e) {
        status = "current";
      } else {
        status = "upcoming";
        daysDiff = Math.round((s - todayMs) / MS_PER_DAY);
      }

      return {
        ...p,
        status,
        daysDiff,
      };
    };

    const { sem1, sem2 } = resolveValidSemesters(matrix?.semesters, matrix?.weeks);

    const formatted = nonTheory.map(formatItem);
    const { semester1, semester2 } = partitionSemesterPeriods(
      formatted,
      matrix?.semesters,
      matrix?.weeks
    );

    const sem1Subtitle = sem1
      ? `${formatDisplayDate(sem1.start_date)} — ${formatDisplayDate(sem1.end_date)}`
      : "Осінь — Зима (вересень – січень)";
    const lastWeekEnd = matrix?.weeks?.[matrix.weeks.length - 1]?.end_date;
    const sem2FallbackStart = sem1?.end_date
      ? addDaysIso(sem1.end_date, 1)
      : semester2[0]?.start_date;
    const sem2FallbackEnd = lastWeekEnd || semester2[semester2.length - 1]?.end_date;
    const sem2Subtitle = sem2
      ? `${formatDisplayDate(sem2.start_date)} — ${formatDisplayDate(sem2.end_date)}`
      : sem2FallbackStart && sem2FallbackEnd
      ? `${formatDisplayDate(sem2FallbackStart)} — ${formatDisplayDate(sem2FallbackEnd)}`
      : "Весна — Літо (січень – серпень)";

    return { semester1, semester2, sem1Subtitle, sem2Subtitle };
  }, [currentGroupData, matrix?.semesters, matrix?.weeks, todayIso]);

  const yearOverview = useMemo(() => {
    if (!currentGroupData) return null;
    const merged = currentGroupData.mergedPeriods;
    const summaries = summarizeProcessPeriods(merged);
    const todayMs = parseUtcMidnightMs(todayIso);
    const currentIdx = merged.findIndex((p) => {
      const s = parseUtcMidnightMs(p.start_date);
      const e = parseUtcMidnightMs(p.end_date);
      return todayMs >= s && todayMs <= e;
    });
    const inspectedIdx =
      activeTimelineIdx !== null && activeTimelineIdx >= 0 && activeTimelineIdx < merged.length
        ? activeTimelineIdx
        : currentIdx >= 0
        ? currentIdx
        : 0;
    return {
      merged,
      summaries,
      currentIdx,
      inspectedPeriod: merged[inspectedIdx] ?? null,
      inspectedIdx,
    };
  }, [currentGroupData, todayIso, activeTimelineIdx]);

  const handleSelectCourse = (courseNum: number | "all") => {
    setActiveCourseTab(courseNum);
    if (courseNum !== "all") {
      const courseGroups = allGroups.filter((g) => g.course === courseNum);
      if (courseGroups.length > 0) {
        const currentInCourse = courseGroups.find((g) => g.id === selectedGroupId);
        if (currentInCourse) return;

        const savedInCourse = courseGroups.find((g) => g.id === savedGroupId);
        if (savedInCourse) {
          setSelectedGroupId(savedInCourse.id);
        } else {
          setSelectedGroupId(courseGroups[0].id);
        }
      }
    }
  };

  const handleSelectGroup = (id: number) => {
    setSelectedGroupId(id);
    setActiveTimelineIdx(null);
    const g = allGroups.find((x) => x.id === id);
    if (g && activeCourseTab !== "all" && activeCourseTab !== g.course) {
      setActiveCourseTab(g.course);
    }
  };

  const savedGroup = useMemo(
    () => (savedGroupId ? allGroups.find((g) => g.id === savedGroupId) ?? null : null),
    [allGroups, savedGroupId]
  );

  const academicYearLabel = `${selectedYear}/${selectedYear + 1}`;
  const totalWeeksCount = matrix?.weeks?.length || 52;
  const headerSubtitle = `Семестри, сесії, практика та канікули · ${academicYearLabel} навчальний рік`;

  return (
    <div className="min-h-screen bg-[var(--page-bg)] text-sys-text-primary">
      <SubpageHeader
        title="Графік освітнього процесу"
        subtitle={headerSubtitle}
        maxWidthClass="max-w-6xl"
        rightSlot={
          currentGroupData ? (
            <span className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-sys-border bg-sys-bg px-2.5 text-xs font-semibold text-sys-text-primary whitespace-nowrap">
              <span className="h-1.5 w-1.5 rounded-full bg-sys-accent shrink-0" />
              <span>Група {currentGroupData.group.group_name}</span>
              <span className="hidden sm:inline text-sys-text-secondary font-medium">
                · {currentGroupData.course} курс
              </span>
            </span>
          ) : undefined
        }
      />

      <main
        id="main-content"
        tabIndex={-1}
        className="vt-main-content focus:outline-none mx-auto max-w-6xl px-4 py-4 sm:px-6 sm:py-5 pb-bottom-nav-safe lg:pb-8 space-y-5"
      >
        <section
          aria-label="Вибір курсу та групи"
          className="rounded-2xl border border-sys-border bg-sys-card p-3 sm:p-4 shadow-xs space-y-3"
        >
          {/* Row 1: Course Tabs & Search */}
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-2.5">
            <div
              role="tablist"
              aria-label="Курс"
              className="ui-seg-xl ui-seg-pad-4 ui-seg-gap-4 flex items-stretch bg-sys-bg rounded-xl border border-sys-border/70 overflow-x-auto"
            >
              {availableCourses.map((courseNum) => {
                const isActive = activeCourseTab === courseNum;
                return (
                  <button
                    key={courseNum}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => handleSelectCourse(courseNum)}
                    className={`ui-seg-pill spring-press px-3 py-1.5 text-xs font-bold transition-[transform,color,background-color] duration-150 whitespace-nowrap ${
                      isActive
                        ? "bg-sys-accentSolid text-sys-onAccent shadow-xs"
                        : "text-sys-text-secondary hover:text-sys-text-primary hover:bg-sys-card"
                    }`}
                  >
                    {courseNum} курс
                  </button>
                );
              })}
              <button
                type="button"
                role="tab"
                aria-selected={activeCourseTab === "all"}
                onClick={() => handleSelectCourse("all")}
                className={`ui-seg-pill spring-press px-2.5 py-1.5 text-xs font-bold transition-[transform,color,background-color] duration-150 whitespace-nowrap ${
                  activeCourseTab === "all"
                    ? "bg-sys-accentSolid text-sys-onAccent shadow-xs"
                    : "text-sys-text-secondary hover:text-sys-text-primary hover:bg-sys-card"
                }`}
              >
                Всі
              </button>
            </div>

            <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
              <div className="relative flex-1 min-w-[180px] md:w-52">
                <SearchIcon className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-sys-text-muted pointer-events-none" />
                <input
                  type="search"
                  aria-label="Пошук групи"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Пошук групи..."
                  className="w-full rounded-xl border border-sys-border bg-sys-bg py-1.5 pl-8 pr-8 text-xs text-sys-text-primary placeholder:text-sys-text-muted focus:border-sys-accent focus:outline-none focus:ring-1 focus:ring-sys-accent transition-colors"
                />
                {searchQuery && (
                  <button
                    type="button"
                    aria-label="Очистити пошук"
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-sys-text-muted hover:text-sys-text-primary p-0.5 rounded"
                  >
                    <CloseIcon className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              {savedGroup && currentGroupData && savedGroup.id !== currentGroupData.group.group_id && (
                <button
                  type="button"
                  onClick={() => handleSelectGroup(savedGroup.id)}
                  className="shrink-0 rounded-xl border border-sys-accent/40 bg-sys-accent/10 px-2.5 py-1.5 text-xs font-semibold text-sys-accent hover:bg-sys-accent/15 transition-colors cursor-pointer"
                  title={`Повернутися до моєї групи (${savedGroup.name})`}
                >
                  Моя група ({savedGroup.name})
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 pt-1 max-h-32 overflow-y-auto">
            {visibleGroups.map((g) => {
              const isSelected = selectedGroupId === g.id;
              const isSaved = savedGroupId === g.id;
              return (
                <button
                  key={g.id}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => handleSelectGroup(g.id)}
                  className={`spring-press rounded-lg px-2.5 py-1 text-xs font-semibold transition-[transform,color,background-color,border-color] duration-150 flex items-center gap-1.5 ${
                    isSelected
                      ? "bg-sys-accentSolid text-sys-onAccent shadow-xs"
                      : "border border-sys-border bg-sys-bg text-sys-text-primary hover:border-sys-accent/50 hover:bg-sys-card"
                  }`}
                >
                  <span>{g.name}</span>
                  {isSaved && (
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        isSelected ? "bg-sys-onAccent" : "bg-sys-accent"
                      }`}
                      title="Моя група з розкладу"
                    />
                  )}
                </button>
              );
            })}
            {visibleGroups.length === 0 && !loading && (
              <span className="text-xs text-sys-text-secondary py-1">Групи не знайдені.</span>
            )}
          </div>
        </section>

        {loading ? (
          <div className="space-y-4" aria-busy="true">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-24 rounded-2xl bg-sys-card border border-sys-border animate-pulse"
                />
              ))}
            </div>
            <div className="h-48 rounded-2xl bg-sys-card border border-sys-border animate-pulse" />
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-6 text-center text-sm text-rose-700 dark:text-rose-300">
            {error}
          </div>
        ) : !currentGroupData ? (
          <div className="rounded-2xl border border-dashed border-sys-border bg-sys-card/50 p-8 text-center text-sys-text-secondary text-sm">
            Оберіть групу вище, щоб переглянути графік освітнього процесу.
          </div>
        ) : (
          <div className="space-y-6">
            {realTimeStatus && (
              <DesktopSpotlightGrid
                aria-label="Поточний стан"
                className="grid grid-cols-1 sm:grid-cols-3 gap-3"
              >
                <div
                  style={{ "--stagger-index": 0 } as React.CSSProperties}
                  className="interactive-surface desktop-stagger-card rounded-2xl border border-sys-border bg-sys-card p-4 shadow-xs flex flex-col justify-between space-y-2"
                >
                  <div className="flex items-center justify-between text-xs text-sys-text-secondary">
                    <span className="font-medium">Зараз триває</span>
                    {realTimeStatus.currentWeekNumber && (
                      <span className="text-[11px] font-semibold text-sys-text-muted">
                        {realTimeStatus.currentWeekNumber}-й тиждень
                      </span>
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                          realTimeStatus.currentPeriod
                            ? TYPE_CONFIG[realTimeStatus.currentPeriod.period_type]?.dotClass ||
                              "bg-slate-400"
                            : "bg-slate-400"
                        }`}
                      />
                      <span className="font-bold text-base text-sys-text-primary tracking-tight">
                        {realTimeStatus.currentPeriod
                          ? realTimeStatus.currentPeriod.name ||
                            TYPE_CONFIG[realTimeStatus.currentPeriod.period_type]?.name ||
                            "Навчання"
                          : "Навчання"}
                      </span>
                    </div>
                    {realTimeStatus.currentPeriod && (
                      <p className="text-xs text-sys-text-secondary mt-1">
                        до {formatDisplayDate(realTimeStatus.currentPeriod.end_date)}
                      </p>
                    )}
                  </div>
                </div>

                <div
                  style={{ "--stagger-index": 1 } as React.CSSProperties}
                  className="interactive-surface desktop-stagger-card rounded-2xl border border-sys-border bg-sys-card p-4 shadow-xs flex flex-col justify-between space-y-2"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-sys-text-secondary">Найближча подія</span>
                    {realTimeStatus.nextMilestone && (
                      <span className="px-2 py-0.5 rounded-full bg-sys-accent-subtle text-sys-accent font-bold text-[11px]">
                        через {realTimeStatus.nextMilestone.daysUntil} дн.
                      </span>
                    )}
                  </div>
                  <div>
                    <span className="font-bold text-base text-sys-text-primary tracking-tight block">
                      {realTimeStatus.nextMilestone
                        ? realTimeStatus.nextMilestone.period.name ||
                          TYPE_CONFIG[realTimeStatus.nextMilestone.period.period_type]?.name
                        : "Семестрових етапів більше немає"}
                    </span>
                    {realTimeStatus.nextMilestone && (
                      <p className="text-xs text-sys-text-secondary mt-1">
                        Початок: {formatDisplayDate(realTimeStatus.nextMilestone.period.start_date)}{" "}
                        ({realTimeStatus.nextMilestone.period.weeks_count} тижн.)
                      </p>
                    )}
                  </div>
                </div>

                <div
                  style={{ "--stagger-index": 2 } as React.CSSProperties}
                  className="interactive-surface desktop-stagger-card rounded-2xl border border-sys-border bg-sys-card p-4 shadow-xs flex flex-col justify-between space-y-2"
                >
                  <div className="flex items-center justify-between text-xs text-sys-text-secondary">
                    <span className="font-medium">Навчальний рік</span>
                    <span className="text-[11px] font-bold text-sys-accent">
                      {realTimeStatus.currentWeekNumber || 0} із {totalWeeksCount} тижнів
                    </span>
                  </div>
                  <div>
                    <div className="flex items-baseline justify-between mb-1.5">
                      <span className="text-xl font-black text-sys-text-primary tracking-tight">
                        {realTimeStatus.progressPercent}%
                      </span>
                      <span className="text-xs text-sys-text-muted">пройдено</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-sys-bg border border-sys-border/70 overflow-hidden">
                      <div
                        className="h-full bg-sys-accent rounded-full transition-[width] duration-500 ease-out"
                        style={{ width: `${realTimeStatus.progressPercent}%` }}
                      />
                    </div>
                  </div>
                </div>
              </DesktopSpotlightGrid>
            )}

            {yearOverview && yearOverview.merged.length > 0 && (
              <section
                aria-label="Візуальна шкала навчального року"
                className="rounded-2xl border border-sys-border bg-sys-card p-4 shadow-xs space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-sys-text-secondary">
                    Карта навчального року
                  </h2>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {yearOverview.summaries.map((sum) => {
                      const cfg = TYPE_CONFIG[sum.period_type] || TYPE_CONFIG.theory;
                      return (
                        <span
                          key={sum.period_type}
                          className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-0.5 text-[11px] font-semibold ${cfg.badgeBg} ${cfg.badgeText} ${cfg.badgeBorder}`}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${cfg.dotClass}`} />
                          <span>{cfg.name}:</span>
                          <span className="font-bold">
                            {pluralizeUk(sum.weeks_count, ["тиждень", "тижні", "тижнів"])}
                          </span>
                        </span>
                      );
                    })}
                  </div>
                </div>

                <div className="relative pt-1">
                  <div
                    className="flex h-4 w-full overflow-hidden rounded-full bg-sys-bg p-0.5 border border-sys-border/70 gap-[2px]"
                    onMouseLeave={() => setActiveTimelineIdx(null)}
                  >
                    {yearOverview.merged.map((period, idx) => {
                      const cfg = TYPE_CONFIG[period.period_type] || TYPE_CONFIG.theory;
                      const isInspected = yearOverview.inspectedIdx === idx;
                      const label = `${period.name || cfg.name} (${formatDisplayDate(period.start_date)} — ${formatDisplayDate(period.end_date)}, ${pluralizeUk(period.weeks_count, ["тиждень", "тижні", "тижнів"])})`;
                      return (
                        <button
                          key={`${period.start_week}-${period.period_type}-${idx}`}
                          type="button"
                          title={label}
                          aria-label={label}
                          onMouseEnter={() => setActiveTimelineIdx(idx)}
                          onFocus={() => setActiveTimelineIdx(idx)}
                          onClick={() => setActiveTimelineIdx(idx)}
                          style={{ flexGrow: period.weeks_count, flexBasis: 0 }}
                          className={`h-full min-w-[4px] rounded-full transition-opacity duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-sys-accent ${cfg.barClass} ${
                            isInspected ? "opacity-100 ring-1 ring-sys-text-primary/40" : "opacity-85 hover:opacity-100"
                          }`}
                        />
                      );
                    })}
                  </div>

                  {realTimeStatus && realTimeStatus.progressPercent > 0 && realTimeStatus.progressPercent < 100 && (
                    <div
                      aria-hidden="true"
                      style={{ left: `${realTimeStatus.progressPercent}%` }}
                      className="pointer-events-none absolute top-0 bottom-0 -translate-x-1/2 flex flex-col items-center"
                    >
                      <span className="h-5 w-0.5 rounded-full bg-sys-text-primary shadow-xs" />
                    </div>
                  )}

                  <div
                    aria-hidden="true"
                    className="mt-1.5 grid grid-cols-12 text-[10px] font-medium text-sys-text-muted text-center select-none"
                  >
                    {ACADEMIC_MONTH_LABELS.map((monthLabel) => (
                      <span key={monthLabel}>{monthLabel}</span>
                    ))}
                  </div>
                </div>

                {yearOverview.inspectedPeriod && (() => {
                  const p = yearOverview.inspectedPeriod;
                  const cfg = TYPE_CONFIG[p.period_type] || TYPE_CONFIG.theory;
                  const isCurrentBlock = yearOverview.inspectedIdx === yearOverview.currentIdx;
                  return (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sys-border/70 bg-sys-bg/60 px-3 py-2 text-xs">
                      <div className="flex flex-wrap items-center gap-2 min-w-0">
                        <span className={`h-2 w-2 rounded-full shrink-0 ${cfg.dotClass}`} />
                        <span className="font-bold text-sys-text-primary truncate">
                          {p.name || cfg.name}
                        </span>
                        {isCurrentBlock && (
                          <span className="rounded-full bg-sys-accent-subtle px-2 py-0.5 text-[10px] font-bold text-sys-accent">
                            Зараз триває
                          </span>
                        )}
                      </div>
                      <span className="text-sys-text-secondary font-medium whitespace-nowrap">
                        {formatDisplayDate(p.start_date)} — {formatDisplayDate(p.end_date)} ·{" "}
                        <span className="font-semibold text-sys-text-primary">
                          {pluralizeUk(p.weeks_count, ["тиждень", "тижні", "тижнів"])}
                        </span>
                      </span>
                    </div>
                  );
                })()}
              </section>
            )}

            <SemesterSection
              title="I семестр"
              subtitle={semesterMilestones.sem1Subtitle}
              items={semesterMilestones.semester1}
            />

            <SemesterSection
              title="II семестр"
              subtitle={semesterMilestones.sem2Subtitle}
              items={semesterMilestones.semester2}
              extraTopPadding={semesterMilestones.semester1.length > 0}
            />

            {semesterMilestones.semester1.length === 0 && semesterMilestones.semester2.length === 0 && (
              <div className="rounded-2xl border border-dashed border-sys-border bg-sys-card/50 p-6 text-center text-xs text-sys-text-secondary">
                У цьому навчальному році для обраної групи заплановано лише теоретичне навчання без додаткових етапів у графіку.
              </div>
            )}

            {/* Full Schedule Collapsible Table */}
            <div className="pt-2">
              <button
                type="button"
                aria-expanded={showFullSchedule}
                onClick={() => setShowFullSchedule(!showFullSchedule)}
                className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-sys-border bg-sys-card text-xs font-semibold text-sys-text-secondary hover:text-sys-text-primary hover:border-sys-border-elevated transition-colors"
              >
                <span>Повний календарний план усіх {totalWeeksCount} тижнів</span>
                <span className="inline-flex items-center gap-1.5 text-xs text-sys-text-muted">
                  <span>{showFullSchedule ? "Згорнути" : "Розгорнути"}</span>
                  {showFullSchedule ? (
                    <ChevronUpIcon className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronDownIcon className="h-3.5 w-3.5" />
                  )}
                </span>
              </button>

              {showFullSchedule && (
                <div
                  tabIndex={0}
                  role="region"
                  aria-label="Календарний план тижнів навчального року"
                  className="mt-3 rounded-2xl border border-sys-border bg-sys-card overflow-x-auto shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sys-accent"
                >
                  <table className="w-full text-left text-xs">
                    <caption className="sr-only">
                      Повний календарний графік групи {currentGroupData.group.group_name} на{" "}
                      {academicYearLabel} навчальний рік
                    </caption>
                    <thead>
                      <tr className="border-b border-sys-border text-sys-text-secondary bg-sys-bg/40">
                        <th scope="col" className="py-2.5 px-3 font-medium">
                          Дати
                        </th>
                        <th scope="col" className="py-2.5 px-4 font-medium">
                          Етап
                        </th>
                        <th scope="col" className="py-2.5 px-3 font-medium">
                          Тижні
                        </th>
                        <th scope="col" className="py-2.5 px-3 text-right font-medium">
                          Тривалість
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-sys-border/40">
                      {currentGroupData.mergedPeriods.map((period, idx) => {
                        const cfg = TYPE_CONFIG[period.period_type] || TYPE_CONFIG.theory;
                        const isTheory = period.period_type === "theory";

                        return (
                          <tr
                            key={`${period.start_week}-${period.period_type}-${idx}`}
                            className={`transition-colors hover:bg-sys-cardActive/20 ${
                              !isTheory ? "bg-sys-accent/[0.03]" : ""
                            }`}
                          >
                            <td className="py-2.5 px-3 font-mono tabular-nums text-sys-text-secondary whitespace-nowrap">
                              {formatShortDate(period.start_date)} – {formatShortDate(period.end_date)}
                            </td>
                            <th
                              scope="row"
                              className="py-2.5 px-4 font-semibold text-sys-text-primary"
                            >
                              <span className="inline-flex items-center gap-2">
                                <span className={`w-2 h-2 rounded-full shrink-0 ${cfg.dotClass}`} />
                                <span>{period.name || cfg.name}</span>
                              </span>
                            </th>
                            <td className="py-2.5 px-3 text-sys-text-muted whitespace-nowrap">
                              {period.start_week === period.end_week
                                ? `${period.start_week}-й тиждень`
                                : `тижні ${period.start_week}–${period.end_week}`}
                            </td>
                            <td className="py-2.5 px-3 text-right whitespace-nowrap">
                              <span
                                className={`inline-block px-2 py-0.5 rounded-md font-medium border ${cfg.badgeBg} ${cfg.badgeText} ${cfg.badgeBorder}`}
                              >
                                {period.weeks_count} тижн.
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
