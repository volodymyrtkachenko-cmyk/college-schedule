"use client";

import { useEffect, useState, useMemo } from "react";
import { SubpageHeader } from "@/components/navigation/SubpageHeader";
import { DesktopSpotlightGrid } from "@/components/navigation/DesktopSpotlightGrid";
import {
  getCurrentAcademicYear,
  readCacheSnapshot,
  writeCacheSnapshot,
} from "@/lib/cacheSnapshot";
import { api } from "../../lib/api";

interface CellInfo {
  week_number: number;
  period_type: string;
  name: string | null;
}

interface GroupProcessInfo {
  group_id: number;
  group_name: string;
  cells: CellInfo[];
}

interface CourseProcessInfo {
  course: number;
  groups: GroupProcessInfo[];
}

interface WeekInfo {
  week_number: number;
  start_date: string;
  end_date: string;
}

interface EducationalProcessMatrix {
  academic_year_start: number;
  weeks: WeekInfo[];
  courses: CourseProcessInfo[];
}

const TYPE_CONFIG: Record<
  string,
  {
    name: string;
    badgeBg: string;
    badgeText: string;
    badgeBorder: string;
    dotClass: string;
  }
> = {
  session: {
    name: "Екзаменаційна сесія",
    badgeBg: "bg-rose-500/10 dark:bg-rose-500/15",
    badgeText: "text-rose-700 dark:text-rose-300",
    badgeBorder: "border-rose-500/30",
    dotClass: "bg-rose-500",
  },
  holiday: {
    name: "Канікули",
    badgeBg: "bg-emerald-500/10 dark:bg-emerald-500/15",
    badgeText: "text-emerald-700 dark:text-emerald-300",
    badgeBorder: "border-emerald-500/30",
    dotClass: "bg-emerald-500",
  },
  practice: {
    name: "Практика",
    badgeBg: "bg-amber-500/10 dark:bg-amber-500/15",
    badgeText: "text-amber-800 dark:text-amber-300",
    badgeBorder: "border-amber-500/30",
    dotClass: "bg-amber-500",
  },
  diploma: {
    name: "Дипломне проєктування",
    badgeBg: "bg-purple-500/10 dark:bg-purple-500/15",
    badgeText: "text-purple-700 dark:text-purple-300",
    badgeBorder: "border-purple-500/30",
    dotClass: "bg-purple-500",
  },
  attestation: {
    name: "Атестація",
    badgeBg: "bg-sky-500/10 dark:bg-sky-500/15",
    badgeText: "text-sky-700 dark:text-sky-300",
    badgeBorder: "border-sky-500/30",
    dotClass: "bg-sky-500",
  },
  theory: {
    name: "Теоретичне навчання",
    badgeBg: "bg-sys-bg",
    badgeText: "text-sys-text-secondary",
    badgeBorder: "border-sys-border",
    dotClass: "bg-slate-400",
  },
};

const MONTH_NAMES_UA = [
  "січ.", "лют.", "бер.", "квіт.", "трав.", "черв.",
  "лип.", "серп.", "вер.", "жовт.", "лист.", "груд."
];

function formatDisplayDate(dateStr: string) {
  try {
    const d = new Date(`${dateStr}T12:00:00`);
    const day = d.getDate();
    const month = MONTH_NAMES_UA[d.getMonth()] || "";
    const year = d.getFullYear();
    return `${day} ${month} ${year}`;
  } catch {
    return dateStr;
  }
}

function formatShortDate(dateStr: string) {
  try {
    const d = new Date(`${dateStr}T12:00:00`);
    return `${d.getDate().toString().padStart(2, "0")}.${(d.getMonth() + 1).toString().padStart(2, "0")}`;
  } catch {
    return dateStr;
  }
}

interface MergedPeriod {
  start_date: string;
  end_date: string;
  start_week: number;
  end_week: number;
  weeks_count: number;
  period_type: string;
  name: string | null;
}

function mergeCells(cells: CellInfo[], weeks: WeekInfo[]): MergedPeriod[] {
  if (!cells.length || !weeks.length) return [];

  const sortedCells = [...cells].sort((a, b) => a.week_number - b.week_number);
  const merged: MergedPeriod[] = [];
  let current: MergedPeriod | null = null;

  for (const cell of sortedCells) {
    const week = weeks.find((w) => w.week_number === cell.week_number);
    if (!week) continue;

    if (!current) {
      current = {
        start_date: week.start_date,
        end_date: week.end_date,
        start_week: cell.week_number,
        end_week: cell.week_number,
        weeks_count: 1,
        period_type: cell.period_type,
        name: cell.name,
      };
    } else if (current.period_type === cell.period_type && current.name === cell.name) {
      current.end_date = week.end_date;
      current.end_week = cell.week_number;
      current.weeks_count += 1;
    } else {
      merged.push(current);
      current = {
        start_date: week.start_date,
        end_date: week.end_date,
        start_week: cell.week_number,
        end_week: cell.week_number,
        weeks_count: 1,
        period_type: cell.period_type,
        name: cell.name,
      };
    }
  }

  if (current) {
    merged.push(current);
  }

  return merged;
}

export default function EducationalProcessPage() {
  const [matrix, setMatrix] = useState<EducationalProcessMatrix | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Group selection state
  const [savedGroupId, setSavedGroupId] = useState<number | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [activeCourseTab, setActiveCourseTab] = useState<number | "all">(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [showFullSchedule, setShowFullSchedule] = useState(false);

  // Read saved group from local storage on mount
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("schedule:groupId");
      if (raw) {
        const parsed = Number(raw);
        if (!Number.isNaN(parsed) && parsed > 0) {
          setSavedGroupId(parsed);
          setSelectedGroupId(parsed);
        }
      }
    } catch {}
  }, []);

  // Determine current academic year (e.g. 2026)
  const currentAcademicYear = useMemo(() => getCurrentAcademicYear(), []);

  // Fetch educational process matrix with instant stale-while-revalidate cache seed
  useEffect(() => {
    const cacheKey = `edu-process:${currentAcademicYear}`;
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
      .educationalProcess<EducationalProcessMatrix>(currentAcademicYear)
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
          setError("Не вдалося завантажити графік навчального процесу.");
        }
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [currentAcademicYear]);

  // Extract all groups with their course info
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

  // Set initial selected group
  useEffect(() => {
    if (!selectedGroupId && allGroups.length > 0) {
      if (savedGroupId && allGroups.some((g) => g.id === savedGroupId)) {
        const found = allGroups.find((g) => g.id === savedGroupId);
        setSelectedGroupId(savedGroupId);
        if (found) setActiveCourseTab(found.course);
      } else {
        setSelectedGroupId(allGroups[0].id);
        setActiveCourseTab(allGroups[0].course);
      }
    }
  }, [allGroups, selectedGroupId, savedGroupId]);

  // Current active group object and data
  const currentGroupData = useMemo(() => {
    if (!matrix || !selectedGroupId) return null;
    for (const course of matrix.courses) {
      const g = course.groups.find((x) => x.group_id === selectedGroupId);
      if (g) {
        return {
          group: g,
          course: course.course,
          mergedPeriods: mergeCells(g.cells, matrix.weeks),
        };
      }
    }
    return null;
  }, [matrix, selectedGroupId]);

  // Filter groups for selector
  const visibleGroups = useMemo(() => {
    return allGroups.filter((g) => {
      const matchesCourse = activeCourseTab === "all" || g.course === activeCourseTab;
      const matchesSearch =
        !searchQuery.trim() ||
        g.name.toLowerCase().includes(searchQuery.trim().toLowerCase());
      return matchesCourse && matchesSearch;
    });
  }, [allGroups, activeCourseTab, searchQuery]);

  // Today ISO string in Europe/Kyiv
  const todayIso = useMemo(() => {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(new Date());
  }, []);

  // Compute real-time status and upcoming milestone
  const realTimeStatus = useMemo(() => {
    if (!currentGroupData || !matrix || !matrix.weeks.length) return null;

    const todayDate = new Date(`${todayIso}T12:00:00`);
    const { mergedPeriods } = currentGroupData;

    // Find current period
    let currentPeriod: MergedPeriod | null = null;
    for (const p of mergedPeriods) {
      const s = new Date(`${p.start_date}T00:00:00`);
      const e = new Date(`${p.end_date}T23:59:59`);
      if (todayDate >= s && todayDate <= e) {
        currentPeriod = p;
        break;
      }
    }

    // Find next non-theory milestone
    let nextMilestone: { period: MergedPeriod; daysUntil: number } | null = null;
    for (const p of mergedPeriods) {
      if (p.period_type === "theory") continue;
      const s = new Date(`${p.start_date}T00:00:00`);
      if (s > todayDate) {
        const diffMs = s.getTime() - todayDate.getTime();
        const daysUntil = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        nextMilestone = { period: p, daysUntil };
        break;
      }
    }

    // Find current week number
    const currentWeekObj = matrix.weeks.find((w) => {
      const s = new Date(`${w.start_date}T00:00:00`);
      const e = new Date(`${w.end_date}T23:59:59`);
      return todayDate >= s && todayDate <= e;
    });

    // Calculate progress percentage
    const firstWeek = matrix.weeks[0];
    const lastWeek = matrix.weeks[matrix.weeks.length - 1];
    let progressPercent = 0;
    if (firstWeek && lastWeek) {
      const startMs = new Date(`${firstWeek.start_date}T00:00:00`).getTime();
      const endMs = new Date(`${lastWeek.end_date}T23:59:59`).getTime();
      const nowMs = todayDate.getTime();
      if (nowMs >= endMs) {
        progressPercent = 100;
      } else if (nowMs > startMs) {
        progressPercent = Math.min(100, Math.max(0, Math.round(((nowMs - startMs) / (endMs - startMs)) * 100)));
      }
    }

    return {
      currentPeriod,
      nextMilestone,
      currentWeekNumber: currentWeekObj?.week_number ?? null,
      progressPercent,
    };
  }, [currentGroupData, matrix, todayIso]);

  // Group milestones by Semester 1 and Semester 2
  const semesterMilestones = useMemo(() => {
    if (!currentGroupData) return { semester1: [], semester2: [] };
    const todayDate = new Date(`${todayIso}T12:00:00`);

    const nonTheory = currentGroupData.mergedPeriods.filter((p) => p.period_type !== "theory");

    const formatItem = (p: MergedPeriod) => {
      const s = new Date(`${p.start_date}T00:00:00`);
      const e = new Date(`${p.end_date}T23:59:59`);
      let status: "past" | "current" | "upcoming" = "upcoming";
      let daysDiff = 0;

      if (todayDate > e) {
        status = "past";
      } else if (todayDate >= s && todayDate <= e) {
        status = "current";
      } else {
        status = "upcoming";
        daysDiff = Math.ceil((s.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24));
      }

      return {
        ...p,
        status,
        daysDiff,
      };
    };

    // Week <= 21 belongs to Semester 1 (Autumn / Winter), Week >= 22 belongs to Semester 2 (Spring / Summer)
    const semester1 = nonTheory.filter((p) => p.end_week <= 21).map(formatItem);
    const semester2 = nonTheory.filter((p) => p.start_week >= 22).map(formatItem);

    return { semester1, semester2 };
  }, [currentGroupData, todayIso]);

  // Select course tab and switch to that course's group
  const handleSelectCourse = (courseNum: number | "all") => {
    setActiveCourseTab(courseNum);
    if (courseNum !== "all") {
      const courseGroups = allGroups.filter((g) => g.course === courseNum);
      if (courseGroups.length > 0) {
        // If current group is already in this course, keep it
        const currentInCourse = courseGroups.find((g) => g.id === selectedGroupId);
        if (currentInCourse) return;

        // If user's saved group is in this course, pick it
        const savedInCourse = courseGroups.find((g) => g.id === savedGroupId);
        if (savedInCourse) {
          setSelectedGroupId(savedInCourse.id);
        } else {
          // Otherwise pick the first group of the selected course
          setSelectedGroupId(courseGroups[0].id);
        }
      }
    }
  };

  // Select group handler
  const handleSelectGroup = (id: number) => {
    setSelectedGroupId(id);
    const g = allGroups.find((x) => x.id === id);
    if (g && activeCourseTab !== "all" && activeCourseTab !== g.course) {
      setActiveCourseTab(g.course);
    }
    try {
      window.localStorage.setItem("schedule:groupId", id.toString());
      setSavedGroupId(id);
    } catch {}
  };

  const academicYearLabel = `${currentAcademicYear}/${currentAcademicYear + 1}`;

  return (
    <div className="min-h-screen bg-[var(--page-bg)] text-sys-text-primary">
      <SubpageHeader
        title="Графік освітнього процесу"
        subtitle={`Семестри, екзамени, практика та канікули · ${academicYearLabel} навчальний рік`}
        maxWidthClass="max-w-6xl"
      />

      {/* Main Content Area */}
      <main
        id="main-content"
        tabIndex={-1}
        className="vt-main-content focus:outline-none mx-auto max-w-6xl px-3.5 py-4 sm:px-6 sm:py-5 pb-24 lg:pb-8 space-y-5"
      >
        {/* Compact Clean Group Selector */}
        <section
          aria-label="Вибір групи"
          className="rounded-2xl border border-sys-border bg-sys-card p-3 sm:p-4 shadow-xs space-y-3"
        >
          {/* Row 1: Course Tabs & Search */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
            {/* Minimal Course Tabs */}
            <div
              role="tablist"
              aria-label="Курс"
              className="flex items-center gap-1 bg-sys-bg p-1 rounded-xl border border-sys-border/70 overflow-x-auto"
            >
              {[1, 2, 3, 4].map((courseNum) => {
                const isActive = activeCourseTab === courseNum;
                return (
                  <button
                    key={courseNum}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => handleSelectCourse(courseNum)}
                    className={`spring-press px-3 py-1.5 rounded-lg text-xs font-bold transition-[transform,color,background-color] duration-150 whitespace-nowrap ${
                      isActive
                        ? "bg-sys-accent text-white shadow-xs"
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
                className={`spring-press px-2.5 py-1.5 rounded-lg text-xs font-bold transition-[transform,color,background-color] duration-150 whitespace-nowrap ${
                  activeCourseTab === "all"
                    ? "bg-sys-accent text-white shadow-xs"
                    : "text-sys-text-secondary hover:text-sys-text-primary hover:bg-sys-card"
                }`}
              >
                Всі
              </button>
            </div>

            {/* Clean Search Input */}
            <div className="relative min-w-[160px] sm:w-48">
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="absolute left-3 top-2.5 text-sys-text-muted pointer-events-none"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Пошук групи..."
                className="w-full rounded-xl border border-sys-border bg-sys-bg py-1.5 pl-8 pr-6 text-xs text-sys-text-primary placeholder:text-sys-text-muted focus:border-sys-accent focus:outline-none focus:ring-1 focus:ring-sys-accent transition"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 top-1.5 text-xs text-sys-text-muted hover:text-sys-text-primary"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* Row 2: Pure Compact Number Pills: [ 11 ] [ 12 ] [ 21 ] ... */}
          <div className="flex flex-wrap items-center gap-1.5 pt-1 max-h-32 overflow-y-auto">
            {visibleGroups.map((g) => {
              const isSelected = selectedGroupId === g.id;
              const isSaved = savedGroupId === g.id;
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => handleSelectGroup(g.id)}
                  className={`spring-press rounded-lg px-2.5 py-1 text-xs font-semibold transition-[transform,color,background-color,border-color] duration-150 flex items-center gap-1 ${
                    isSelected
                      ? "bg-sys-accent text-white shadow-xs"
                      : "border border-sys-border bg-sys-bg text-sys-text-primary hover:border-sys-accent/50 hover:bg-sys-card"
                  }`}
                >
                  <span>{g.name}</span>
                  {isSaved && !isSelected && (
                    <span className="w-1.5 h-1.5 rounded-full bg-sys-accent" title="Збережена група" />
                  )}
                </button>
              );
            })}
            {visibleGroups.length === 0 && !loading && (
              <span className="text-xs text-sys-text-secondary py-1">
                Групи не знайдені.
              </span>
            )}
          </div>
        </section>

        {/* Loading / Error States */}
        {loading ? (
          <div className="space-y-4" aria-busy="true">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-24 rounded-2xl bg-sys-card border border-sys-border animate-pulse" />
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
            {/* 3 Equal Clean Stats Cards in One Row */}
            {realTimeStatus && (
              <DesktopSpotlightGrid
                aria-label="Поточний стан"
                className="grid grid-cols-1 sm:grid-cols-3 gap-3"
              >
                {/* Card 1: Current Status */}
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
                            ? TYPE_CONFIG[realTimeStatus.currentPeriod.period_type]?.dotClass || "bg-slate-400"
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

                {/* Card 2: Next Milestone */}
                <div
                  style={{ "--stagger-index": 1 } as React.CSSProperties}
                  className="interactive-surface desktop-stagger-card rounded-2xl border border-sys-border bg-sys-card p-4 shadow-xs flex flex-col justify-between space-y-2"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-sys-text-secondary">Найближча подія</span>
                    {realTimeStatus.nextMilestone && (
                      <span className="px-2 py-0.5 rounded-full bg-sys-accent text-white font-bold text-[11px]">
                        через {realTimeStatus.nextMilestone.daysUntil}{" "}
                        {realTimeStatus.nextMilestone.daysUntil === 1
                          ? "день"
                          : realTimeStatus.nextMilestone.daysUntil >= 2 && realTimeStatus.nextMilestone.daysUntil <= 4
                          ? "дні"
                          : "днів"}
                      </span>
                    )}
                  </div>
                  <div>
                    <p className="font-bold text-base text-sys-text-primary tracking-tight">
                      {realTimeStatus.nextMilestone
                        ? realTimeStatus.nextMilestone.period.name ||
                          TYPE_CONFIG[realTimeStatus.nextMilestone.period.period_type]?.name
                        : "Усі події завершено"}
                    </p>
                    {realTimeStatus.nextMilestone && (
                      <p className="text-xs text-sys-text-secondary mt-1">
                        Початок: {formatDisplayDate(realTimeStatus.nextMilestone.period.start_date)} ({realTimeStatus.nextMilestone.period.weeks_count} тижн.)
                      </p>
                    )}
                  </div>
                </div>

                {/* Card 3: Academic Year Progress */}
                <div
                  style={{ "--stagger-index": 2 } as React.CSSProperties}
                  className="interactive-surface desktop-stagger-card rounded-2xl border border-sys-border bg-sys-card p-4 shadow-xs flex flex-col justify-between space-y-2"
                >
                  <div className="flex items-center justify-between text-xs text-sys-text-secondary">
                    <span className="font-medium">Навчальний рік</span>
                    <span className="text-[11px] font-bold text-sys-accent">
                      {realTimeStatus.currentWeekNumber || 0} із {matrix?.weeks?.length || 52} тижнів
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

            {/* Semester 1 Section: Autumn / Winter */}
            <section aria-label="I семестр" className="space-y-3">
              <div className="flex items-center justify-between border-b border-sys-border/60 pb-2">
                <div className="flex items-center gap-2">
                  <h2 className="px-2 py-0.5 rounded-md bg-sys-bg border border-sys-border text-xs font-bold text-sys-text-primary">
                    I семестр
                  </h2>
                  <span className="text-xs text-sys-text-secondary font-medium">
                    Осінь — Зима (вересень – січень)
                  </span>
                </div>
                <span className="text-xs text-sys-text-muted">
                  {semesterMilestones.semester1.length} етапів
                </span>
              </div>

              <DesktopSpotlightGrid className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {semesterMilestones.semester1.map((item, idx) => {
                  const cfg = TYPE_CONFIG[item.period_type] || TYPE_CONFIG.theory;
                  const isCurrent = item.status === "current";
                  const isUpcoming = item.status === "upcoming";
                  const isPast = item.status === "past";

                  return (
                    <div
                      key={idx}
                      className={`interactive-surface scroll-reveal-card rounded-2xl border p-4 flex flex-col justify-between shadow-xs ${
                        isCurrent
                          ? "border-sys-accent bg-sys-accent/5 ring-1 ring-sys-accent/40"
                          : isUpcoming
                          ? "border-sys-border bg-sys-card hover:border-sys-border-elevated"
                          : "border-sys-border/50 bg-sys-card/50 opacity-60"
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
                            <span className="px-2 py-0.5 rounded-full bg-rose-500 text-white font-bold text-[10px] uppercase tracking-wide">
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

                      <div className="mt-4 pt-3 border-t border-sys-border/50 flex items-center justify-between text-xs text-sys-text-secondary">
                        <span>
                          {formatDisplayDate(item.start_date)} — {formatDisplayDate(item.end_date)}
                        </span>
                        <span className="font-semibold text-sys-text-primary">
                          {item.weeks_count} тижн.
                        </span>
                      </div>
                    </div>
                  );
                })}

                {semesterMilestones.semester1.length === 0 && (
                  <div className="col-span-full rounded-xl border border-dashed border-sys-border p-4 text-center text-xs text-sys-text-secondary">
                    Немає додаткових сесійних або практичних етапів у I семестрі.
                  </div>
                )}
              </DesktopSpotlightGrid>
            </section>

            {/* Semester 2 Section: Spring / Summer */}
            <section aria-label="II семестр" className="space-y-3 pt-2">
              <div className="flex items-center justify-between border-b border-sys-border/60 pb-2">
                <div className="flex items-center gap-2">
                  <h2 className="px-2 py-0.5 rounded-md bg-sys-bg border border-sys-border text-xs font-bold text-sys-text-primary">
                    II семестр
                  </h2>
                  <span className="text-xs text-sys-text-secondary font-medium">
                    Весна — Літо (січень – серпень)
                  </span>
                </div>
                <span className="text-xs text-sys-text-muted">
                  {semesterMilestones.semester2.length} етапів
                </span>
              </div>

              <DesktopSpotlightGrid className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {semesterMilestones.semester2.map((item, idx) => {
                  const cfg = TYPE_CONFIG[item.period_type] || TYPE_CONFIG.theory;
                  const isCurrent = item.status === "current";
                  const isUpcoming = item.status === "upcoming";
                  const isPast = item.status === "past";

                  return (
                    <div
                      key={idx}
                      className={`interactive-surface scroll-reveal-card rounded-2xl border p-4 flex flex-col justify-between shadow-xs ${
                        isCurrent
                          ? "border-sys-accent bg-sys-accent/5 ring-1 ring-sys-accent/40"
                          : isUpcoming
                          ? "border-sys-border bg-sys-card hover:border-sys-border-elevated"
                          : "border-sys-border/50 bg-sys-card/50 opacity-60"
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
                            <span className="px-2 py-0.5 rounded-full bg-rose-500 text-white font-bold text-[10px] uppercase tracking-wide">
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

                      <div className="mt-4 pt-3 border-t border-sys-border/50 flex items-center justify-between text-xs text-sys-text-secondary">
                        <span>
                          {formatDisplayDate(item.start_date)} — {formatDisplayDate(item.end_date)}
                        </span>
                        <span className="font-semibold text-sys-text-primary">
                          {item.weeks_count} тижн.
                        </span>
                      </div>
                    </div>
                  );
                })}

                {semesterMilestones.semester2.length === 0 && (
                  <div className="col-span-full rounded-xl border border-dashed border-sys-border p-4 text-center text-xs text-sys-text-secondary">
                    Немає додаткових сесійних або практичних етапів у II семестрі.
                  </div>
                )}
              </DesktopSpotlightGrid>
            </section>

            {/* Optional Collapsible Full 52 Weeks Schedule */}
            <div className="pt-2">
              <button
                type="button"
                onClick={() => setShowFullSchedule(!showFullSchedule)}
                className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-sys-border bg-sys-card text-xs font-semibold text-sys-text-secondary hover:text-sys-text-primary hover:border-sys-border-elevated transition"
              >
                <span>Повний календарний план усіх 52 тижнів</span>
                <span className="text-xs text-sys-text-muted">
                  {showFullSchedule ? "Згорнути ▲" : "Розгорнути ▼"}
                </span>
              </button>

              {showFullSchedule && (
                <div className="mt-3 rounded-2xl border border-sys-border bg-sys-card overflow-hidden shadow-xs divide-y divide-sys-border/40">
                  {currentGroupData.mergedPeriods.map((period, idx) => {
                    const cfg = TYPE_CONFIG[period.period_type] || TYPE_CONFIG.theory;
                    const isTheory = period.period_type === "theory";

                    return (
                      <div
                        key={idx}
                        className={`flex items-center hover:bg-sys-cardActive/20 transition-colors ${
                          !isTheory ? "bg-sys-accent/[0.03]" : ""
                        }`}
                      >
                        <div className="w-28 sm:w-36 shrink-0 py-2.5 px-3 flex flex-col justify-center items-center text-xs font-semibold text-sys-text-secondary border-r border-sys-border/40 bg-sys-bg/30">
                          <span>{formatShortDate(period.start_date)}</span>
                          <span className="text-[10px] text-sys-text-muted">до</span>
                          <span>{formatShortDate(period.end_date)}</span>
                        </div>

                        <div className="flex-1 py-2.5 px-4 flex items-center justify-between gap-3 min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`w-2 h-2 rounded-full shrink-0 ${cfg.dotClass}`} />
                            <div className="flex flex-col min-w-0">
                              <span className="text-xs sm:text-sm font-semibold text-sys-text-primary truncate">
                                {period.name || cfg.name}
                              </span>
                              <span className="text-[11px] text-sys-text-muted">
                                {period.start_week === period.end_week
                                  ? `${period.start_week}-й тиждень`
                                  : `тижні ${period.start_week} — ${period.end_week}`}
                              </span>
                            </div>
                          </div>

                          <span className={`px-2 py-0.5 rounded-md text-xs font-medium border shrink-0 ${cfg.badgeBg} ${cfg.badgeText} ${cfg.badgeBorder}`}>
                            {period.weeks_count} тижн.
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
