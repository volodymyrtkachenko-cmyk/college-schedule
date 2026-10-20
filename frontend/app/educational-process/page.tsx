"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
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

const TYPE_NAMES: Record<string, string> = {
  theory: "Теоретичне навчання",
  session: "Екзаменаційна сесія",
  holiday: "Канікули",
  diploma: "Дипломне проєктування",
  attestation: "Атестація",
};

interface PeriodStyle {
  badgeClass: string;
  dotClass: string;
}

function getPeriodStyle(periodType: string, name: string | null): PeriodStyle {
  if (periodType === "practice") {
    return {
      badgeClass: "border-amber-500/40 bg-amber-500/15 text-amber-300",
      dotClass: "bg-amber-400",
    };
  }
  switch (periodType) {
    case "session":
      return {
        badgeClass: "border-rose-500/40 bg-rose-500/15 text-rose-300",
        dotClass: "bg-rose-400",
      };
    case "holiday":
      return {
        badgeClass: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
        dotClass: "bg-emerald-400",
      };
    case "diploma":
      return {
        badgeClass: "border-purple-500/40 bg-purple-500/15 text-purple-300",
        dotClass: "bg-purple-400",
      };
    case "attestation":
      return {
        badgeClass: "border-sky-500/40 bg-sky-500/15 text-sky-300",
        dotClass: "bg-sky-400",
      };
    case "theory":
    default:
      return {
        badgeClass: "border-sys-border/70 bg-sys-tabActive/50 text-sys-text-primary",
        dotClass: "bg-slate-400",
      };
  }
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  return `${d.getDate().toString().padStart(2, "0")}.${(d.getMonth() + 1).toString().padStart(2, "0")}`;
}

interface MergedPeriod {
  start_date: string;
  end_date: string;
  period_type: string;
  name: string | null;
}

function mergeCells(cells: CellInfo[], weeks: WeekInfo[]): MergedPeriod[] {
  if (!cells.length || !weeks.length) return [];

  const sortedCells = [...cells].sort((a, b) => a.week_number - b.week_number);
  const merged: MergedPeriod[] = [];
  let currentPeriod: MergedPeriod | null = null;

  for (const cell of sortedCells) {
    const week = weeks.find((w) => w.week_number === cell.week_number);
    if (!week) continue;

    if (!currentPeriod) {
      currentPeriod = {
        start_date: week.start_date,
        end_date: week.end_date,
        period_type: cell.period_type,
        name: cell.name,
      };
    } else if (currentPeriod.period_type === cell.period_type && currentPeriod.name === cell.name) {
      currentPeriod.end_date = week.end_date;
    } else {
      merged.push(currentPeriod);
      currentPeriod = {
        start_date: week.start_date,
        end_date: week.end_date,
        period_type: cell.period_type,
        name: cell.name,
      };
    }
  }
  if (currentPeriod) {
    merged.push(currentPeriod);
  }

  return merged;
}

export default function EducationalProcessPage() {
  const [matrix, setMatrix] = useState<EducationalProcessMatrix | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedGroups, setSelectedGroups] = useState<number[]>([]);

  const year = useMemo(() => {
    const now = new Date();
    return now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api
      .educationalProcess<EducationalProcessMatrix>(year)
      .then((data) => {
        setMatrix(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setError("Не вдалося завантажити графік навчального процесу.");
        setLoading(false);
      });
  }, [year]);

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
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [matrix]);

  const filteredCourses = useMemo(() => {
    if (!matrix) return [];
    if (selectedGroups.length === 0) return matrix.courses;
    return matrix.courses
      .map((c) => ({
        course: c.course,
        groups: c.groups.filter((g) => selectedGroups.includes(g.group_id)),
      }))
      .filter((c) => c.groups.length > 0);
  }, [matrix, selectedGroups]);

  return (
    <div className="min-h-screen bg-sys-bg text-sys-text-primary">
      {/* Mobile Header (<640px) */}
      <header className="border-b border-sys-border bg-sys-card px-3 py-2.5 sm:hidden">
        <div className="flex items-center justify-between gap-2">
          <Link
            href="/"
            className="flex items-center gap-1.5 shrink-0 hover:opacity-85"
            title="Головна сторінка розкладу"
          >
            <span className="rounded bg-sys-accent/15 px-1.5 py-0.5 text-xs font-extrabold uppercase tracking-wider text-sys-accent">
              ДФКР
            </span>
            <span className="text-sm font-bold tracking-tight text-sys-text-primary">
              Графік процесу
            </span>
          </Link>
          <Link
            href="/"
            className="flex items-center gap-1 rounded-lg border border-sys-border bg-sys-bg px-2.5 py-1 text-xs font-semibold text-sys-text-secondary hover:text-sys-text-primary active:scale-[0.98] transition-colors"
          >
            ← До розкладу
          </Link>
        </div>
      </header>

      {/* Desktop Header (>=640px) */}
      <header className="hidden sm:block border-b border-sys-border bg-sys-card">
        <div className="mx-auto flex max-w-[1800px] items-center justify-between px-4 py-5 sm:px-6 lg:px-8">
          <div>
            <a
              href="https://kre.dp.ua/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block hover:opacity-80 transition-opacity"
            >
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-sys-text-secondary">ДФКР</p>
            </a>
            <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl text-sys-text-primary">
              Графік освітнього процесу
            </h1>
            <p className="mt-0.5 text-xs sm:text-sm text-sys-text-secondary">
              {year}/{year + 1} навчальний рік
            </p>
          </div>
          <Link
            href="/"
            className="flex items-center gap-1.5 rounded-xl border border-sys-border bg-sys-bg px-4 py-2 text-sm font-semibold text-sys-text-secondary hover:text-sys-text-primary hover:border-sys-accent/40 active:scale-[0.98] transition-colors"
          >
            ← До розкладу занять
          </Link>
        </div>
      </header>

      {/* Page Content */}
      <main className="mx-auto max-w-[1200px] px-3 py-4 sm:px-6 sm:py-6">
        {/* Group Filter Pills */}
        <div className="mb-6 rounded-2xl border border-sys-border bg-sys-card p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wider text-sys-text-secondary">
              Фільтр за групами
            </h2>
            {selectedGroups.length > 0 && (
              <button
                type="button"
                onClick={() => setSelectedGroups([])}
                className="text-xs font-semibold text-sys-accent hover:underline focus:outline-none"
              >
                Скинути вибір ({selectedGroups.length})
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto pr-1">
            {allGroups.map((g) => {
              const isSelected = selectedGroups.includes(g.id);
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => {
                    setSelectedGroups((prev) =>
                      isSelected ? prev.filter((id) => id !== g.id) : [...prev, g.id]
                    );
                  }}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-all active:scale-[0.96] ${
                    isSelected
                      ? "border-sys-accent bg-sys-accent/15 text-sys-accent font-semibold shadow-xs"
                      : "border-sys-border/70 bg-sys-bg/60 text-sys-text-secondary hover:text-sys-text-primary hover:border-sys-border"
                  }`}
                >
                  {g.name}
                </button>
              );
            })}
            {allGroups.length === 0 && !loading && (
              <span className="text-xs text-sys-text-secondary">Немає груп для відображення</span>
            )}
          </div>
        </div>

        {/* States: Loading, Error, Empty, Content */}
        {loading ? (
          <div className="space-y-4" aria-busy="true" aria-label="Завантаження графіка">
            {[1, 2, 3].map((num) => (
              <div
                key={num}
                className="rounded-2xl border border-sys-border/60 bg-sys-card/70 p-5 animate-pulse"
              >
                <div className="h-5 w-32 rounded bg-slate-700/60 mb-4" />
                <div className="space-y-2">
                  <div className="h-4 w-full rounded bg-slate-800" />
                  <div className="h-4 w-4/5 rounded bg-slate-800" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-rose-400/20 bg-rose-400/5 p-8 text-center text-sm text-rose-200">
            {error}
          </div>
        ) : !matrix || filteredCourses.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-sys-border bg-sys-card/40 p-12 text-center text-sys-text-secondary">
            Немає даних графіка освітнього процесу для вибраних параметрів.
          </div>
        ) : (
          <div className="flex flex-col gap-8">
            {filteredCourses.map((course) => (
              <section key={course.course} className="flex flex-col gap-4">
                <div className="flex items-center gap-2.5">
                  <span className="rounded-lg border border-sys-accent/30 bg-sys-accent/15 px-2.5 py-1 text-xs font-bold text-sys-accent">
                    {course.course} курс
                  </span>
                  <h3 className="text-lg sm:text-xl font-bold text-sys-text-primary">
                    Навчальний план {course.course}-го курсу
                  </h3>
                </div>

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  {course.groups.map((group) => {
                    const merged = mergeCells(group.cells, matrix.weeks);
                    return (
                      <div
                        key={group.group_id}
                        className="flex flex-col rounded-2xl border border-sys-border bg-sys-card overflow-hidden shadow-xs"
                      >
                        <div className="border-b border-sys-border/60 bg-sys-card/80 px-4 py-3 font-bold text-sm sm:text-base text-sys-text-primary flex items-center justify-between">
                          <span>Група {group.group_name}</span>
                          <span className="text-xs font-normal text-sys-text-secondary">
                            {merged.length} {merged.length === 1 ? "період" : "періоди"}
                          </span>
                        </div>

                        <div className="flex flex-col divide-y divide-sys-border/30">
                          {merged.map((m, idx) => {
                            const style = getPeriodStyle(m.period_type, m.name);
                            const periodLabel =
                              m.period_type === "practice"
                                ? m.name || "Практика"
                                : TYPE_NAMES[m.period_type] || m.period_type;

                            return (
                              <div
                                key={idx}
                                className="flex items-center hover:bg-sys-cardActive/20 transition-colors"
                              >
                                {/* Date Range Column */}
                                <div className="w-24 sm:w-28 shrink-0 py-3 px-2 flex flex-col justify-center items-center text-xs font-semibold text-sys-text-secondary border-r border-sys-border/40 bg-sys-bg/30">
                                  <span>{formatDate(m.start_date)}</span>
                                  <span className="text-xs text-sys-text-muted my-0.5">до</span>
                                  <span>{formatDate(m.end_date)}</span>
                                </div>

                                {/* Period Details Column */}
                                <div className="flex-1 py-3 px-3.5 sm:px-4 flex items-center gap-2.5 min-w-0">
                                  <span
                                    aria-hidden="true"
                                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${style.dotClass}`}
                                  />
                                  <span className="text-xs sm:text-sm font-medium text-sys-text-primary [overflow-wrap:anywhere] min-w-0">
                                    {periodLabel}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
