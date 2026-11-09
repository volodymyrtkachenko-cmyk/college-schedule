"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { api } from "../../lib/api";
import { useMobileNav } from "../../lib/useMobileNav";

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
    barColor: string;
    dotClass: string;
  }
> = {
  session: {
    name: "Екзаменаційна сесія",
    badgeBg: "bg-rose-500/10 dark:bg-rose-500/15",
    badgeText: "text-rose-700 dark:text-rose-300",
    badgeBorder: "border-rose-500/30",
    barColor: "bg-rose-500",
    dotClass: "bg-rose-500",
  },
  holiday: {
    name: "Канікули",
    badgeBg: "bg-emerald-500/10 dark:bg-emerald-500/15",
    badgeText: "text-emerald-700 dark:text-emerald-300",
    badgeBorder: "border-emerald-500/30",
    barColor: "bg-emerald-500",
    dotClass: "bg-emerald-500",
  },
  practice: {
    name: "Практика",
    badgeBg: "bg-amber-500/10 dark:bg-amber-500/15",
    badgeText: "text-amber-800 dark:text-amber-300",
    badgeBorder: "border-amber-500/30",
    barColor: "bg-amber-500",
    dotClass: "bg-amber-500",
  },
  diploma: {
    name: "Дипломне проєктування",
    badgeBg: "bg-purple-500/10 dark:bg-purple-500/15",
    badgeText: "text-purple-700 dark:text-purple-300",
    badgeBorder: "border-purple-500/30",
    barColor: "bg-purple-500",
    dotClass: "bg-purple-500",
  },
  attestation: {
    name: "Атестація",
    badgeBg: "bg-sky-500/10 dark:bg-sky-500/15",
    badgeText: "text-sky-700 dark:text-sky-300",
    badgeBorder: "border-sky-500/30",
    barColor: "bg-sky-500",
    dotClass: "bg-sky-500",
  },
  theory: {
    name: "Теоретичне навчання",
    badgeBg: "bg-sys-bg",
    badgeText: "text-sys-text-secondary",
    badgeBorder: "border-sys-border",
    barColor: "bg-sys-border/70 dark:bg-sys-border/50",
    dotClass: "bg-slate-400",
  },
};

const MONTH_NAMES_UA = [
  "Січ", "Лют", "Бер", "Кві", "Тра", "Чер",
  "Лип", "Сер", "Вер", "Жов", "Лис", "Гру"
];

function formatDisplayDate(dateStr: string) {
  try {
    const d = new Date(`${dateStr}T12:00:00`);
    const day = d.getDate();
    const month = MONTH_NAMES_UA[d.getMonth()]?.toLowerCase();
    const year = d.getFullYear();
    return `${day} ${month}. ${year}`;
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
  const { setHomeTab } = useMobileNav();
  const [matrix, setMatrix] = useState<EducationalProcessMatrix | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Group selection state
  const [savedGroupId, setSavedGroupId] = useState<number | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [activeCourseTab, setActiveCourseTab] = useState<number | "all">(3);
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"milestones" | "full">("milestones");

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

  // Determine academic year start (e.g. 2026)
  const currentAcademicYear = useMemo(() => {
    const now = new Date();
    return now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  }, []);

  const [selectedYear, setSelectedYear] = useState<number>(currentAcademicYear);

  // Fetch educational process matrix
  useEffect(() => {
    setLoading(true);
    setError(null);
    api
      .educationalProcess<EducationalProcessMatrix>(selectedYear)
      .then((data) => {
        setMatrix(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setError("Не вдалося завантажити графік навчального процесу.");
        setLoading(false);
      });
  }, [selectedYear]);

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

  // If selected group is not set yet, set it to savedGroupId or first group
  useEffect(() => {
    if (!selectedGroupId && allGroups.length > 0) {
      if (savedGroupId && allGroups.some((g) => g.id === savedGroupId)) {
        setSelectedGroupId(savedGroupId);
      } else {
        setSelectedGroupId(allGroups[0].id);
      }
    }
  }, [allGroups, selectedGroupId, savedGroupId]);

  // Sync activeCourseTab when selectedGroupId changes
  useEffect(() => {
    if (selectedGroupId && allGroups.length > 0) {
      const g = allGroups.find((x) => x.id === selectedGroupId);
      if (g && activeCourseTab !== "all" && activeCourseTab !== g.course) {
        setActiveCourseTab(g.course);
      }
    }
  }, [selectedGroupId, allGroups, activeCourseTab]);

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

  // Filter groups for selector based on active course and search
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

    // Calculate overall academic year progress percentage
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

  // Filter key milestones
  const keyMilestones = useMemo(() => {
    if (!currentGroupData) return [];
    const todayDate = new Date(`${todayIso}T12:00:00`);

    return currentGroupData.mergedPeriods
      .filter((p) => p.period_type !== "theory")
      .map((p) => {
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
      });
  }, [currentGroupData, todayIso]);

  // Select group and save preference
  const handleSelectGroup = (id: number) => {
    setSelectedGroupId(id);
    try {
      window.localStorage.setItem("schedule:groupId", id.toString());
      setSavedGroupId(id);
    } catch {}
  };

  return (
    <div className="min-h-screen bg-[var(--page-bg)] text-sys-text-primary">
      {/* Mobile Header (<640px) */}
      <header className="sticky top-0 z-30 border-b border-sys-border bg-sys-card px-3 py-2.5 sm:hidden shadow-xs backdrop-blur-md">
        <div className="flex items-center justify-between gap-2">
          <Link
            href="/"
            className="flex items-center gap-1.5 shrink-0 hover:opacity-85 transition-opacity"
            title="Головна сторінка розкладу"
          >
            <span className="rounded-md bg-sys-accent/15 px-1.5 py-0.5 text-xs font-black uppercase tracking-wider text-sys-accent">
              ДФКР
            </span>
            <h1 className="text-sm font-bold tracking-tight text-sys-text-primary">
              Графік процесу
            </h1>
          </Link>
          <Link
            href="/"
            onClick={() => setHomeTab("schedule")}
            className="flex items-center gap-1 rounded-lg border border-sys-border bg-sys-bg px-2.5 py-1 text-xs font-semibold text-sys-text-secondary hover:text-sys-text-primary active:scale-[0.98] transition-colors"
          >
            ← До розкладу
          </Link>
        </div>
      </header>

      {/* Desktop Header (>=640px) */}
      <header className="hidden sm:block border-b border-sys-border bg-sys-card">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-5 sm:px-6 lg:px-8">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-sys-accent/15 px-2 py-0.5 text-xs font-black uppercase tracking-wider text-sys-accent">
                ДФКР
              </span>
              <span className="text-xs font-medium text-sys-text-muted">
                Дніпровський фаховий коледж радіоелектроніки
              </span>
            </div>
            <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl text-sys-text-primary">
              Графік освітнього процесу
            </h1>
            <p className="mt-0.5 text-xs sm:text-sm text-sys-text-secondary">
              Семестри, екзаменаційні сесії, виробнича практика, диплом та канікули на {selectedYear}/{selectedYear + 1} навч. рік
            </p>
          </div>

          <div className="flex items-center gap-3">
            <select
              aria-label="Навчальний рік"
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="rounded-xl border border-sys-border bg-sys-bg px-3 py-2 text-xs font-semibold text-sys-text-primary hover:border-sys-accent/50 focus:outline-none focus:ring-2 focus:ring-sys-accent transition-colors"
            >
              <option value={2026}>2026/2027 рік</option>
              <option value={2025}>2025/2026 рік</option>
              <option value={2024}>2024/2025 рік</option>
            </select>

            <Link
              href="/"
              onClick={() => setHomeTab("schedule")}
              className="flex items-center gap-1.5 rounded-xl border border-sys-border bg-sys-bg px-4 py-2 text-sm font-semibold text-sys-text-secondary hover:text-sys-text-primary hover:border-sys-accent/40 active:scale-[0.98] transition-colors shadow-xs"
            >
              ← До розкладу занять
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="mx-auto max-w-7xl px-3 py-4 sm:px-6 sm:py-6 pb-24 lg:pb-8 space-y-6">
        {/* Selector Panel: Tabs & Groups */}
        <section
          aria-label="Вибір навчальної групи"
          className="rounded-2xl border border-sys-border bg-sys-card p-3.5 sm:p-5 shadow-xs"
        >
          {/* Top Row: Course Tabs & Search */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pb-3 border-b border-sys-border/60">
            {/* Course Filter Tabs */}
            <div
              role="tablist"
              aria-label="Курси коледжу"
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
                    onClick={() => setActiveCourseTab(courseNum)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap active:scale-95 ${
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
                onClick={() => setActiveCourseTab("all")}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap active:scale-95 ${
                  activeCourseTab === "all"
                    ? "bg-sys-accent text-white shadow-xs"
                    : "text-sys-text-secondary hover:text-sys-text-primary hover:bg-sys-card"
                }`}
              >
                Всі курси
              </button>
            </div>

            {/* Clean Minimal Search Input */}
            <div className="relative min-w-[180px] sm:max-w-xs">
              <svg
                width="14"
                height="14"
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
                placeholder="Пошук групи (85, 75...)"
                className="w-full rounded-xl border border-sys-border bg-sys-bg py-1.5 pl-8 pr-7 text-xs text-sys-text-primary placeholder:text-sys-text-muted focus:border-sys-accent focus:outline-none focus:ring-1 focus:ring-sys-accent transition"
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

          {/* Group Chips Bar */}
          <div className="pt-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-sys-text-secondary">
                Навчальна група:
              </span>
              {savedGroupId && (
                <span className="text-xs text-sys-accent font-medium">
                  Ваша група: {allGroups.find((g) => g.id === savedGroupId)?.name || savedGroupId}
                </span>
              )}
            </div>

            <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto pr-1">
              {visibleGroups.map((g) => {
                const isSelected = selectedGroupId === g.id;
                const isSaved = savedGroupId === g.id;
                return (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => handleSelectGroup(g.id)}
                    className={`group rounded-xl border px-3 py-1.5 text-xs font-semibold transition-all active:scale-95 flex items-center gap-1.5 ${
                      isSelected
                        ? "border-sys-accent bg-sys-accent text-white shadow-xs"
                        : "border-sys-border bg-sys-bg text-sys-text-primary hover:border-sys-accent/60 hover:bg-sys-card"
                    }`}
                  >
                    <span>Група {g.name}</span>
                    {isSaved && !isSelected && (
                      <span className="w-1.5 h-1.5 rounded-full bg-sys-accent" title="Збережена група" />
                    )}
                  </button>
                );
              })}
              {visibleGroups.length === 0 && !loading && (
                <span className="text-xs text-sys-text-secondary py-2">
                  Групи не знайдені.
                </span>
              )}
            </div>
          </div>
        </section>

        {/* States: Loading, Error */}
        {loading ? (
          <div className="space-y-4" aria-busy="true" aria-label="Завантаження графіка освітнього процесу">
            <div className="h-32 rounded-2xl bg-sys-card border border-sys-border animate-pulse" />
            <div className="h-44 rounded-2xl bg-sys-card border border-sys-border animate-pulse" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-36 rounded-2xl bg-sys-card border border-sys-border animate-pulse" />
              ))}
            </div>
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-8 text-center text-sm text-rose-700 dark:text-rose-300">
            {error}
          </div>
        ) : !currentGroupData ? (
          <div className="rounded-2xl border border-dashed border-sys-border bg-sys-card/50 p-12 text-center text-sys-text-secondary">
            Оберіть групу зі списку вище, щоб переглянути графік освітнього процесу.
          </div>
        ) : (
          <div className="space-y-6">
            {/* Real-time Status & Countdown Hero Banner */}
            {realTimeStatus && (
              <section
                aria-label="Поточний навчальний статус"
                className="relative overflow-hidden rounded-2xl border border-sys-border bg-sys-card p-4 sm:p-6 shadow-xs"
              >
                <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-center">
                  {/* Left Column: Group & Current Period */}
                  <div className="md:col-span-7 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-md bg-sys-accent/15 px-2.5 py-0.5 text-xs font-bold text-sys-accent tracking-wide">
                        Група {currentGroupData.group.group_name} • {currentGroupData.course} курс
                      </span>
                      {realTimeStatus.currentWeekNumber && (
                        <span className="text-xs font-medium text-sys-text-secondary bg-sys-bg border border-sys-border px-2 py-0.5 rounded-md">
                          {realTimeStatus.currentWeekNumber}-й тиждень
                        </span>
                      )}
                      <span className="text-xs text-sys-text-muted">
                        {formatDisplayDate(todayIso)}
                      </span>
                    </div>

                    <div className="pt-0.5">
                      <div className="flex items-center gap-2">
                        {realTimeStatus.currentPeriod && (
                          <span
                            className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                              TYPE_CONFIG[realTimeStatus.currentPeriod.period_type]?.dotClass || "bg-slate-400"
                            }`}
                          />
                        )}
                        <h2 className="text-lg sm:text-xl font-bold text-sys-text-primary tracking-tight">
                          {realTimeStatus.currentPeriod
                            ? realTimeStatus.currentPeriod.name ||
                              TYPE_CONFIG[realTimeStatus.currentPeriod.period_type]?.name ||
                              "Навчальний період"
                            : "Навчальний період"}
                        </h2>
                      </div>

                      {realTimeStatus.currentPeriod && (
                        <p className="text-xs sm:text-sm text-sys-text-secondary mt-1">
                          {formatDisplayDate(realTimeStatus.currentPeriod.start_date)} —{" "}
                          {formatDisplayDate(realTimeStatus.currentPeriod.end_date)} ({realTimeStatus.currentPeriod.weeks_count} тижн.)
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Right Column: Next Milestone Countdown Box */}
                  <div className="md:col-span-5">
                    {realTimeStatus.nextMilestone ? (
                      <div className="rounded-xl border border-sys-border bg-sys-bg/60 p-4">
                        <div className="flex items-center justify-between text-xs font-semibold text-sys-text-secondary">
                          <span className="flex items-center gap-1.5">
                            <span
                              className={`w-2 h-2 rounded-full ${
                                TYPE_CONFIG[realTimeStatus.nextMilestone.period.period_type]?.dotClass
                              }`}
                            />
                            <span>Найближчий етап</span>
                          </span>
                          <span className="px-2 py-0.5 rounded-full bg-sys-accent text-white font-bold text-xs">
                            через {realTimeStatus.nextMilestone.daysUntil}{" "}
                            {realTimeStatus.nextMilestone.daysUntil === 1
                              ? "день"
                              : realTimeStatus.nextMilestone.daysUntil >= 2 && realTimeStatus.nextMilestone.daysUntil <= 4
                              ? "дні"
                              : "днів"}
                          </span>
                        </div>
                        <p className="font-bold text-sm sm:text-base mt-2 text-sys-text-primary">
                          {realTimeStatus.nextMilestone.period.name ||
                            TYPE_CONFIG[realTimeStatus.nextMilestone.period.period_type]?.name}
                        </p>
                        <p className="text-xs text-sys-text-secondary mt-0.5">
                          Початок: {formatDisplayDate(realTimeStatus.nextMilestone.period.start_date)} •{" "}
                          {realTimeStatus.nextMilestone.period.weeks_count} тижн.
                        </p>
                      </div>
                    ) : (
                      <div className="rounded-xl border border-sys-border bg-sys-bg/60 p-4 text-center text-xs text-sys-text-secondary">
                        Усі планові сесії та практики року завершено
                      </div>
                    )}
                  </div>
                </div>

                {/* Progress bar of academic year */}
                <div className="mt-5 pt-3.5 border-t border-sys-border/50">
                  <div className="flex items-center justify-between text-xs text-sys-text-secondary mb-1.5">
                    <span>Навчальний рік:</span>
                    <span className="font-semibold text-sys-text-primary">{realTimeStatus.progressPercent}% пройдено</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-sys-bg border border-sys-border/70 overflow-hidden">
                    <div
                      className="h-full bg-sys-accent transition-all duration-500 rounded-full"
                      style={{ width: `${realTimeStatus.progressPercent}%` }}
                    />
                  </div>
                </div>
              </section>
            )}

            {/* Annual Gantt Timeline Bar */}
            <section
              aria-label="Річний графік освітнього процесу"
              className="rounded-2xl border border-sys-border bg-sys-card p-4 sm:p-5 shadow-xs space-y-4"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-bold text-sys-text-primary">
                    Річна шкала навчального процесу
                  </h3>
                  <p className="text-xs text-sys-text-secondary mt-0.5">
                    Вересень — Серпень • 52 тижні
                  </p>
                </div>

                {/* Clean View Mode Toggle */}
                <div className="flex items-center gap-1 bg-sys-bg p-1 rounded-xl border border-sys-border self-start sm:self-auto">
                  <button
                    type="button"
                    onClick={() => setViewMode("milestones")}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${
                      viewMode === "milestones"
                        ? "bg-sys-card text-sys-accent shadow-xs"
                        : "text-sys-text-secondary hover:text-sys-text-primary"
                    }`}
                  >
                    Ключові етапи
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode("full")}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${
                      viewMode === "full"
                        ? "bg-sys-card text-sys-accent shadow-xs"
                        : "text-sys-text-secondary hover:text-sys-text-primary"
                    }`}
                  >
                    Усі тижні
                  </button>
                </div>
              </div>

              {/* Gantt Timeline Strip Container */}
              <div className="pt-1">
                {/* Month Headers */}
                <div className="grid grid-cols-12 text-center text-[10px] sm:text-xs font-medium text-sys-text-muted border-b border-sys-border/50 pb-1.5 mb-2 select-none">
                  {["Вер", "Жов", "Лис", "Гру", "Січ", "Лют", "Бер", "Кві", "Тра", "Чер", "Лип", "Сер"].map((m, i) => (
                    <span key={i}>{m}</span>
                  ))}
                </div>

                {/* Minimal Multi-segment Bar */}
                <div className="relative h-7 w-full rounded-lg bg-sys-bg border border-sys-border overflow-hidden flex shadow-inner">
                  {currentGroupData.mergedPeriods.map((period, idx) => {
                    const cfg = TYPE_CONFIG[period.period_type] || TYPE_CONFIG.theory;
                    const totalWeeks = matrix?.weeks?.length || 52;
                    const widthPercent = (period.weeks_count / totalWeeks) * 100;

                    return (
                      <div
                        key={idx}
                        style={{ width: `${widthPercent}%` }}
                        title={`${period.name || cfg.name}: ${formatShortDate(period.start_date)} – ${formatShortDate(period.end_date)} (${period.weeks_count} тижн.)`}
                        className={`h-full relative group cursor-pointer border-r border-sys-card/60 transition-opacity hover:opacity-90 ${cfg.barColor}`}
                      >
                        {/* Clean Hover Tooltip */}
                        <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:flex flex-col items-center z-30">
                          <div className="bg-sys-elevated text-sys-text-primary text-[11px] font-semibold rounded-lg px-2.5 py-1 shadow-lg border border-sys-border whitespace-nowrap">
                            <span>{period.name || cfg.name}</span>
                            <div className="text-[10px] text-sys-text-secondary font-normal">
                              {formatShortDate(period.start_date)} – {formatShortDate(period.end_date)} ({period.weeks_count} тижн.)
                            </div>
                          </div>
                          <div className="w-1.5 h-1.5 bg-sys-elevated rotate-45 -mt-0.5 border-r border-b border-sys-border" />
                        </div>
                      </div>
                    );
                  })}

                  {/* "Today" Needle Indicator */}
                  {realTimeStatus && (
                    <div
                      style={{ left: `${realTimeStatus.progressPercent}%` }}
                      className="absolute top-0 bottom-0 w-0.5 bg-rose-500 z-20 pointer-events-none shadow-[0_0_6px_rgba(244,63,94,0.7)]"
                    >
                      <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-rose-500 ring-2 ring-white dark:ring-black" />
                    </div>
                  )}
                </div>

                {/* Minimal Color Legend without emojis */}
                <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-xs text-sys-text-secondary select-none">
                  {Object.entries(TYPE_CONFIG).map(([key, cfg]) => (
                    <div key={key} className="flex items-center gap-1.5">
                      <span className={`h-2 w-2 rounded-full ${cfg.dotClass} shrink-0`} />
                      <span className="text-sys-text-secondary font-medium">{cfg.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* Key Milestones Cards View */}
            {viewMode === "milestones" ? (
              <section
                aria-label="Ключові події та етапи"
                className="space-y-3.5"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-bold text-sys-text-primary">
                    Ключові етапи групи {currentGroupData.group.group_name}
                  </h3>
                  <span className="text-xs text-sys-text-muted">
                    {keyMilestones.length} етапів
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {keyMilestones.map((item, idx) => {
                    const cfg = TYPE_CONFIG[item.period_type] || TYPE_CONFIG.theory;
                    const isCurrent = item.status === "current";
                    const isUpcoming = item.status === "upcoming";
                    const isPast = item.status === "past";

                    return (
                      <div
                        key={idx}
                        className={`rounded-2xl border p-4 transition-all flex flex-col justify-between shadow-xs ${
                          isCurrent
                            ? "border-sys-accent bg-sys-accent/5 ring-1 ring-sys-accent/40"
                            : isUpcoming
                            ? "border-sys-border bg-sys-card hover:border-sys-border-elevated"
                            : "border-sys-border/50 bg-sys-card/50 opacity-60"
                        }`}
                      >
                        {/* Card Header: Type Badge & Status */}
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

                          {/* Period Title / Practice Name */}
                          <h4 className="text-sm sm:text-base font-bold text-sys-text-primary mt-1">
                            {item.name || cfg.name}
                          </h4>
                        </div>

                        {/* Card Footer: Dates and Duration */}
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

                  {keyMilestones.length === 0 && (
                    <div className="col-span-full rounded-2xl border border-dashed border-sys-border p-8 text-center text-sys-text-secondary">
                      Для цієї групи графік містить лише теоретичні заняття.
                    </div>
                  )}
                </div>
              </section>
            ) : (
              /* Full Chronological Weeks List View */
              <section
                aria-label="Повний хронологічний розклад тижнів"
                className="rounded-2xl border border-sys-border bg-sys-card overflow-hidden shadow-xs"
              >
                <div className="border-b border-sys-border/60 bg-sys-card/80 px-4 py-3 font-semibold text-sm text-sys-text-primary flex items-center justify-between">
                  <span>Повний календарний план</span>
                  <span className="text-xs font-normal text-sys-text-secondary">
                    {currentGroupData.mergedPeriods.length} періодів
                  </span>
                </div>

                <div className="divide-y divide-sys-border/40">
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
                        {/* Dates column */}
                        <div className="w-28 sm:w-36 shrink-0 py-2.5 px-3 flex flex-col justify-center items-center text-xs font-semibold text-sys-text-secondary border-r border-sys-border/40 bg-sys-bg/30">
                          <span>{formatShortDate(period.start_date)}</span>
                          <span className="text-[10px] text-sys-text-muted">до</span>
                          <span>{formatShortDate(period.end_date)}</span>
                        </div>

                        {/* Details column */}
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
              </section>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
