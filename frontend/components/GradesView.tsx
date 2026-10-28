"use client";

import React, { useState, useMemo } from "react";
import { FullTaskItem } from "./MobileTasksView";
import { useGradesSummary, GradeItem, SubjectSummary } from "../lib/useGradesSummary";

interface GradesViewProps {
  tasks: FullTaskItem[];
  isLinked: boolean;
  onSyncClassroom?: () => void;
}

function formatGradesWord(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod100 >= 11 && mod100 <= 19) return "оцінок";
  if (mod10 === 1) return "оцінка";
  if (mod10 >= 2 && mod10 <= 4) return "оцінки";
  return "оцінок";
}

function formatSubjectsWord(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod100 >= 11 && mod100 <= 19) return "предметів";
  if (mod10 === 1) return "предмет";
  if (mod10 >= 2 && mod10 <= 4) return "предмети";
  return "предметів";
}

export function GradesView({ tasks, isLinked, onSyncClassroom }: GradesViewProps) {
  const {
    overallGpa5,
    overallAverage12,
    totalGradesCount,
    totalSubjectsCount,
    distribution,
    subjects,
    standing,
    addCustomGrade,
    removeCustomGrade,
  } = useGradesSummary(tasks);

  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<string>("all");
  const [expandedSubjects, setExpandedSubjects] = useState<Record<string, boolean>>({});
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  // Form state for adding custom grade
  const [newSubject, setNewSubject] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newScale, setNewScale] = useState<5 | 12>(5);
  const [newGrade, setNewGrade] = useState<number>(5);

  const toggleSubject = (subjectName: string) => {
    setExpandedSubjects((prev) => ({
      ...prev,
      [subjectName]: !prev[subjectName],
    }));
  };

  // Dynamic filter options generated strictly from what actually exists in the student's data
  const dynamicFilters = useMemo(() => {
    if (subjects.length === 0) return [];

    const list: Array<{ id: string; label: string; count: number }> = [
      { id: "all", label: `Всі (${subjects.length})`, count: subjects.length },
    ];

    const excellentCount = subjects.filter((s: SubjectSummary) => s.average5 >= 4.5).length;
    if (excellentCount > 0 && excellentCount < subjects.length) {
      list.push({ id: "excellent", label: `Відмінно (${excellentCount})`, count: excellentCount });
    }

    const goodCount = subjects.filter((s: SubjectSummary) => s.average5 >= 3.5 && s.average5 < 4.5).length;
    if (goodCount > 0) {
      list.push({ id: "good", label: `Добре (${goodCount})`, count: goodCount });
    }

    const satCount = subjects.filter((s: SubjectSummary) => s.average5 >= 3.0 && s.average5 < 3.5).length;
    if (satCount > 0) {
      list.push({ id: "satisfactory", label: `Задовільно (${satCount})`, count: satCount });
    }

    const debtCount = subjects.filter((s: SubjectSummary) => s.average5 < 3.0 || s.distribution.count2 > 0).length;
    if (debtCount > 0) {
      list.push({ id: "debt", label: `Потребує уваги (${debtCount})`, count: debtCount });
    }

    // Dynamic grade filter pills if selected from distribution tiles
    if (activeFilter.startsWith("grade-")) {
      const mark = Number(activeFilter.replace("grade-", ""));
      const markSubjects = subjects.filter((s: SubjectSummary) => {
        if (mark === 5) return s.distribution.count5 > 0;
        if (mark === 4) return s.distribution.count4 > 0;
        if (mark === 3) return s.distribution.count3 > 0;
        if (mark === 2) return s.distribution.count2 > 0;
        return false;
      });
      list.push({ id: activeFilter, label: `Є оцінка «${mark}» (${markSubjects.length})`, count: markSubjects.length });
    }

    return list;
  }, [subjects, activeFilter]);

  const filteredSubjects = useMemo(() => {
    return subjects.filter((subj: SubjectSummary) => {
      // 1. Text Search
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchesName = subj.subject.toLowerCase().includes(query);
        const matchesTeacher = subj.teacher ? subj.teacher.toLowerCase().includes(query) : false;
        if (!matchesName && !matchesTeacher) return false;
      }

      // 2. Dynamic Category Filter
      if (activeFilter === "excellent") {
        return subj.average5 >= 4.5;
      }
      if (activeFilter === "good") {
        return subj.average5 >= 3.5 && subj.average5 < 4.5;
      }
      if (activeFilter === "satisfactory") {
        return subj.average5 >= 3.0 && subj.average5 < 3.5;
      }
      if (activeFilter === "debt") {
        return subj.average5 < 3.0 || subj.distribution.count2 > 0;
      }
      if (activeFilter === "grade-5") {
        return subj.distribution.count5 > 0;
      }
      if (activeFilter === "grade-4") {
        return subj.distribution.count4 > 0;
      }
      if (activeFilter === "grade-3") {
        return subj.distribution.count3 > 0;
      }
      if (activeFilter === "grade-2") {
        return subj.distribution.count2 > 0;
      }

      return true;
    });
  }, [subjects, searchQuery, activeFilter]);

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSubject.trim()) return;

    addCustomGrade({
      subject: newSubject.trim(),
      title: newTitle.trim() || (newScale === 5 ? "Самостійна оцінка" : "Тематична оцінка"),
      grade: Number(newGrade),
      maxScale: newScale,
      date: new Date().toISOString(),
    });

    setNewTitle("");
    setIsAddModalOpen(false);
  };

  const getBadgeColorClasses = (color: "emerald" | "blue" | "amber" | "rose") => {
    switch (color) {
      case "emerald":
        return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30";
      case "blue":
        return "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30";
      case "amber":
        return "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30";
      case "rose":
        return "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30";
    }
  };

  const getGradePillClass = (grade5: number) => {
    if (grade5 === 5) {
      return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30";
    }
    if (grade5 === 4) {
      return "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30";
    }
    if (grade5 === 3) {
      return "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30";
    }
    return "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30";
  };

  return (
    <div className="w-full space-y-3.5">
      {/* GPA & Standing Overview Card */}
      <section className="rounded-2xl border border-sys-border bg-sys-card p-4 sm:p-5 shadow-xs relative overflow-hidden">
        {/* Subtle decorative glow */}
        <div className="absolute -top-16 -right-16 w-44 h-44 rounded-full bg-sys-accent/10 blur-3xl pointer-events-none" />

        {/* Top Header Row */}
        <div className="flex items-center justify-between gap-2 relative z-10 pb-1">
          <span className="text-[11px] font-bold uppercase tracking-wider text-sys-text-muted">
            Академічна успішність
          </span>
          <button
            type="button"
            onClick={() => setIsAddModalOpen(true)}
            className="inline-flex items-center gap-1 rounded-lg border border-sys-border bg-sys-bg hover:bg-sys-accent/10 hover:border-sys-accent/40 px-2.5 py-1 text-xs font-semibold text-sys-text-primary hover:text-sys-accent transition-colors duration-fast ease-smooth cursor-pointer shadow-xs active:scale-95"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>+ Оцінка</span>
          </button>
        </div>

        {/* Standing Badge on its own comfortable row (never squashed or oval) */}
        <div className="mt-1.5 relative z-10">
          <div
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl border text-xs font-semibold ${getBadgeColorClasses(
              standing.badgeColor
            )}`}
          >
            <span className="text-sm shrink-0">{standing.icon}</span>
            <span className="leading-snug">{standing.title}</span>
          </div>
        </div>

        {/* Main GPA Score */}
        <div className="mt-2.5 flex items-baseline gap-2.5 relative z-10">
          <div className="flex items-baseline gap-1">
            <span className="text-3xl sm:text-4xl font-black text-sys-text-primary tracking-tight">
              {totalGradesCount > 0 ? overallGpa5.toFixed(2) : "—"}
            </span>
            <span className="text-xs sm:text-sm font-semibold text-sys-text-secondary">
              / 5.00
            </span>
          </div>

          {overallAverage12 !== null && (
            <div className="flex items-baseline gap-1 pl-2.5 border-l border-sys-border/80">
              <span className="text-xl sm:text-2xl font-bold text-sys-accent">
                {overallAverage12.toFixed(1)}
              </span>
              <span className="text-xs font-semibold text-sys-text-secondary">
                / 12 б.
              </span>
            </div>
          )}
        </div>

        <p className="mt-1 text-xs text-sys-text-secondary leading-relaxed relative z-10">
          {standing.description}
        </p>

        {/* Grade Distribution Grid with Interactive Quick Filters */}
        {totalGradesCount > 0 && (
          <div className="mt-3.5 pt-3 border-t border-sys-border/60 relative z-10">
            <div className="flex items-center justify-between text-[11px] text-sys-text-secondary mb-2">
              <span>Розподіл оцінок ({totalGradesCount})</span>
              <span>{totalSubjectsCount} {formatSubjectsWord(totalSubjectsCount)}</span>
            </div>

            <div className="grid grid-cols-4 gap-1.5">
              <button
                type="button"
                onClick={() => setActiveFilter(activeFilter === "grade-5" ? "all" : "grade-5")}
                className={`flex flex-col items-center justify-center p-1.5 rounded-xl border transition-all cursor-pointer ${
                  activeFilter === "grade-5"
                    ? "bg-emerald-500/25 border-emerald-500 ring-1 ring-emerald-500 shadow-xs"
                    : "bg-emerald-500/10 border-emerald-500/20 hover:bg-emerald-500/15"
                }`}
                title="Фільтрувати предмети з оцінкою «5»"
              >
                <span className="text-[11px] text-emerald-700 dark:text-emerald-400 font-bold">«5»</span>
                <span className="text-sm sm:text-base font-black text-sys-text-primary leading-tight">
                  {distribution.count5}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveFilter(activeFilter === "grade-4" ? "all" : "grade-4")}
                className={`flex flex-col items-center justify-center p-1.5 rounded-xl border transition-all cursor-pointer ${
                  activeFilter === "grade-4"
                    ? "bg-blue-500/25 border-blue-500 ring-1 ring-blue-500 shadow-xs"
                    : "bg-blue-500/10 border-blue-500/20 hover:bg-blue-500/15"
                }`}
                title="Фільтрувати предмети з оцінкою «4»"
              >
                <span className="text-[11px] text-blue-700 dark:text-blue-400 font-bold">«4»</span>
                <span className="text-sm sm:text-base font-black text-sys-text-primary leading-tight">
                  {distribution.count4}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveFilter(activeFilter === "grade-3" ? "all" : "grade-3")}
                className={`flex flex-col items-center justify-center p-1.5 rounded-xl border transition-all cursor-pointer ${
                  activeFilter === "grade-3"
                    ? "bg-amber-500/25 border-amber-500 ring-1 ring-amber-500 shadow-xs"
                    : distribution.count3 > 0
                    ? "bg-amber-500/10 border-amber-500/20 hover:bg-amber-500/15"
                    : "bg-amber-500/5 border-amber-500/10 opacity-50"
                }`}
                title="Фільтрувати предмети з оцінкою «3»"
              >
                <span className="text-[11px] text-amber-700 dark:text-amber-400 font-bold">«3»</span>
                <span className="text-sm sm:text-base font-black text-sys-text-primary leading-tight">
                  {distribution.count3}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveFilter(activeFilter === "grade-2" ? "all" : "grade-2")}
                className={`flex flex-col items-center justify-center p-1.5 rounded-xl border transition-all cursor-pointer ${
                  activeFilter === "grade-2"
                    ? "bg-rose-500/25 border-rose-500 ring-1 ring-rose-500 shadow-xs"
                    : distribution.count2 > 0
                    ? "bg-rose-500/10 border-rose-500/20 hover:bg-rose-500/15"
                    : "bg-rose-500/5 border-rose-500/10 opacity-50"
                }`}
                title="Фільтрувати предмети з оцінкою «2»"
              >
                <span className="text-[11px] text-rose-700 dark:text-rose-400 font-bold">«2»</span>
                <span className="text-sm sm:text-base font-black text-sys-text-primary leading-tight">
                  {distribution.count2}
                </span>
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Classroom Unlinked Notice if not logged in */}
      {!isLinked && (
        <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 p-3 text-xs text-sys-text-secondary flex items-start justify-between gap-3">
          <div className="space-y-0.5 min-w-0">
            <span className="font-semibold text-sys-text-primary block">
              Автоматичне підтягування оцінок з Classroom
            </span>
            <span className="leading-snug block">
              Прив&apos;яжіть студентську пошту, щоб оцінки підтягувалися автоматично.
            </span>
          </div>
          {onSyncClassroom && (
            <button
              type="button"
              onClick={onSyncClassroom}
              className="shrink-0 rounded-lg bg-sky-500 hover:bg-sky-400 text-white font-semibold px-2.5 py-1 text-xs shadow-xs transition-colors cursor-pointer active:scale-95"
            >
              Прив&apos;язати
            </button>
          )}
        </div>
      )}

      {/* Dynamic Filters & Search Bar */}
      {subjects.length > 0 && (
        <div className="space-y-2">
          {/* Search Input */}
          <div className="relative w-full">
            <svg
              className="absolute left-3 top-2.5 h-3.5 w-3.5 text-sys-text-muted"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Пошук предмета..."
              className="w-full pl-8 pr-7 py-1.5 rounded-xl border border-sys-border bg-sys-card text-xs text-sys-text-primary placeholder:text-sys-text-muted focus:outline-none focus:ring-1 focus:ring-sys-accent transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-2 text-sys-text-muted hover:text-sys-text-primary text-xs p-0.5 cursor-pointer"
                aria-label="Очистити пошук"
              >
                ✕
              </button>
            )}
          </div>

          {/* Dynamic Filter Chips (Horizontally scrollable, only shows existing categories) */}
          {dynamicFilters.length > 1 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 pt-0.5 no-scrollbar -mx-1 px-1">
              {dynamicFilters.map((flt) => {
                const isSelected = activeFilter === flt.id;
                return (
                  <button
                    key={flt.id}
                    type="button"
                    onClick={() => setActiveFilter(flt.id)}
                    className={`shrink-0 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all duration-fast ease-smooth cursor-pointer border ${
                      isSelected
                        ? "bg-sys-accent text-white border-sys-accent shadow-xs"
                        : "border-sys-border bg-sys-card text-sys-text-secondary hover:text-sys-text-primary hover:border-sys-border/80"
                    }`}
                  >
                    {flt.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Subjects List */}
      {filteredSubjects.length > 0 ? (
        <div className="space-y-2">
          {filteredSubjects.map((subj: SubjectSummary) => {
            const isExpanded = Boolean(expandedSubjects[subj.subject]);
            return (
              <div
                key={subj.subject}
                className="rounded-2xl border border-sys-border bg-sys-card transition-all duration-fast ease-smooth overflow-hidden shadow-xs hover:border-sys-border/90"
              >
                {/* Subject Header Button */}
                <button
                  type="button"
                  onClick={() => toggleSubject(subj.subject)}
                  className="w-full p-3 sm:p-4 text-left cursor-pointer hover:bg-sys-bg/40 transition-colors"
                >
                  {/* Top Row: Full Subject Title & Score */}
                  <div className="flex items-start justify-between gap-2.5">
                    <div className="flex-1 min-w-0 pr-1">
                      <h4 className="font-bold text-sm sm:text-[15px] text-sys-text-primary leading-snug break-words">
                        {subj.subject}
                      </h4>
                      <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                        <span className="text-[11px] font-medium text-sys-text-muted">
                          {subj.grades.length} {formatGradesWord(subj.grades.length)}
                        </span>
                        {subj.teacher && (
                          <>
                            <span className="text-[10px] text-slate-500">•</span>
                            <span className="text-[11px] text-sys-text-secondary truncate max-w-[170px] sm:max-w-[240px]">
                              👨‍🏫 {subj.teacher}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Score Block */}
                    <div className="flex items-center gap-2 shrink-0 pt-0.5">
                      <div className="flex flex-col items-end">
                        <div className="flex items-baseline gap-0.5">
                          <span className="text-lg sm:text-xl font-black text-sys-text-primary leading-none">
                            {subj.average5.toFixed(2)}
                          </span>
                          <span className="text-[10px] sm:text-[11px] font-semibold text-sys-text-secondary">
                            / 5
                          </span>
                        </div>
                        {subj.has12Scale && subj.average12 !== null && (
                          <span className="text-[10px] sm:text-[11px] font-bold text-sys-accent mt-0.5">
                            {subj.average12.toFixed(1)} / 12 б.
                          </span>
                        )}
                      </div>

                      <span className="text-xs text-sys-text-muted pl-0.5">
                        {isExpanded ? "▴" : "▾"}
                      </span>
                    </div>
                  </div>

                  {/* Bottom Row: Full-width grade chips */}
                  <div className="flex flex-wrap items-center gap-1 pt-2 mt-2 border-t border-sys-border/40">
                    {subj.grades.slice(0, 10).map((g: GradeItem) => (
                      <span
                        key={g.id}
                        className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] font-bold border ${getGradePillClass(
                          g.grade5
                        )}`}
                        title={`${g.title}: ${g.rawGrade}/${g.maxPoints} (${g.percentage}%)`}
                      >
                        {g.maxPoints > 5 && g.maxPoints <= 12 ? `${g.rawGrade} б.` : g.grade5}
                      </span>
                    ))}
                    {subj.grades.length > 10 && (
                      <span className="text-[11px] text-sys-text-muted font-bold px-1">
                        +{subj.grades.length - 10}
                      </span>
                    )}
                  </div>
                </button>

                {/* Expanded Detailed Tasks */}
                {isExpanded && (
                  <div className="px-3 sm:px-4 pb-3.5 pt-1 border-t border-sys-border/50 bg-sys-bg/40 space-y-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-sys-text-muted pt-2 pb-0.5">
                      Деталізація оцінок
                    </div>

                    <div className="space-y-1.5">
                      {subj.grades.map((grade: GradeItem) => (
                        <div
                          key={grade.id}
                          className="flex items-start justify-between gap-2 p-2.5 rounded-xl border border-sys-border/60 bg-sys-card text-xs"
                        >
                          <div className="space-y-0.5 min-w-0 pr-1 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {grade.isManual && (
                                <span className="inline-block text-[10px] px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-700 dark:text-amber-400 font-semibold border border-amber-500/20">
                                  Вручну
                                </span>
                              )}
                              <span className="font-semibold text-sys-text-primary break-words leading-tight">
                                {grade.title}
                              </span>
                            </div>

                            {grade.date && (
                              <p className="text-[10px] text-sys-text-muted">
                                {new Date(grade.date).toLocaleDateString("uk-UA", {
                                  day: "numeric",
                                  month: "short",
                                  year: "numeric",
                                })}
                              </p>
                            )}
                          </div>

                          <div className="flex items-center gap-2 shrink-0 pt-0.5">
                            <div className="text-right">
                              <div className="flex items-baseline justify-end gap-0.5 font-bold">
                                <span className="text-sm text-sys-text-primary">
                                  {grade.rawGrade}
                                </span>
                                <span className="text-[10px] text-sys-text-secondary">
                                  /{grade.maxPoints}
                                </span>
                              </div>
                              <span className="text-[10px] text-sys-text-muted block">
                                {grade.grade5} за 5-б. ({grade.percentage}%)
                              </span>
                            </div>

                            {grade.url && (
                              <a
                                href={grade.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="p-1.5 rounded-lg text-sys-text-secondary hover:text-sys-accent hover:bg-sys-accent/10 transition-colors"
                                title="Відкрити завдання в Google Classroom"
                              >
                                <svg
                                  width="14"
                                  height="14"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                                  <polyline points="15 3 21 3 21 9" />
                                  <line x1="10" y1="14" x2="21" y2="3" />
                                </svg>
                              </a>
                            )}

                            {grade.isManual && (
                              <button
                                type="button"
                                onClick={() => removeCustomGrade(grade.id)}
                                className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-500/10 transition-colors cursor-pointer"
                                title="Видалити оцінку"
                              >
                                <svg
                                  width="14"
                                  height="14"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <line x1="18" y1="6" x2="6" y2="18" />
                                  <line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        /* Empty State */
        <div className="rounded-2xl border border-dashed border-sys-border p-6 text-center space-y-2.5">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-sys-accent/10 text-sys-accent text-lg">
            📊
          </div>
          <h3 className="text-sm font-bold text-sys-text-primary">
            {searchQuery || activeFilter !== "all" ? "Нічого не знайдено" : "Оцінок поки немає"}
          </h3>
          <p className="text-xs text-sys-text-secondary max-w-xs mx-auto leading-relaxed">
            {searchQuery || activeFilter !== "all"
              ? "Спробуйте очистити пошуковий запит або скинути вибраний фільтр."
              : "Оцінки з'являться після того, як викладачі оцінять роботи в Google Classroom, або додайте оцінку вручну."}
          </p>
          {searchQuery || activeFilter !== "all" ? (
            <button
              type="button"
              onClick={() => {
                setSearchQuery("");
                setActiveFilter("all");
              }}
              className="inline-flex items-center gap-1.5 rounded-xl border border-sys-border bg-sys-card px-3 py-1.5 text-xs font-semibold text-sys-accent hover:border-sys-accent/40 cursor-pointer"
            >
              Скинути фільтри
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setIsAddModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-sys-accent px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs hover:opacity-90 active:scale-95 transition-all cursor-pointer"
            >
              + Додати оцінку
            </button>
          )}
        </div>
      )}

      {/* Modal Dialog: Add Custom Grade */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="w-full max-w-sm rounded-2xl border border-sys-border bg-sys-card p-4 sm:p-5 shadow-xl space-y-3.5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-2 border-b border-sys-border/60">
              <h3 className="text-sm font-bold text-sys-text-primary flex items-center gap-1.5">
                <span>📝</span>
                <span>Додати оцінку</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="text-sys-text-muted hover:text-sys-text-primary p-1 rounded-lg cursor-pointer text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAddSubmit} className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-sys-text-secondary">
                  Предмет *
                </label>
                <input
                  type="text"
                  required
                  list="grades-existing-subjects"
                  value={newSubject}
                  onChange={(e) => setNewSubject(e.target.value)}
                  placeholder="наприклад: Вища математика"
                  className="w-full px-3 py-1.5 rounded-xl border border-sys-border bg-sys-bg text-xs text-sys-text-primary placeholder:text-sys-text-muted focus:outline-none focus:ring-1 focus:ring-sys-accent"
                />
                <datalist id="grades-existing-subjects">
                  {subjects.map((s: SubjectSummary) => (
                    <option key={s.subject} value={s.subject} />
                  ))}
                </datalist>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-sys-text-secondary">
                  Назва роботи / коментар
                </label>
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="наприклад: Модульний контроль"
                  className="w-full px-3 py-1.5 rounded-xl border border-sys-border bg-sys-bg text-xs text-sys-text-primary placeholder:text-sys-text-muted focus:outline-none focus:ring-1 focus:ring-sys-accent"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-sys-text-secondary">
                  Система оцінювання
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setNewScale(5);
                      if (newGrade > 5) setNewGrade(5);
                    }}
                    className={`py-1.5 px-2 rounded-xl border text-xs font-semibold cursor-pointer transition-colors ${
                      newScale === 5
                        ? "border-sys-accent bg-sys-accent text-white"
                        : "border-sys-border bg-sys-bg text-sys-text-secondary hover:text-sys-text-primary"
                    }`}
                  >
                    5-бальна (коледж)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setNewScale(12);
                    }}
                    className={`py-1.5 px-2 rounded-xl border text-xs font-semibold cursor-pointer transition-colors ${
                      newScale === 12
                        ? "border-sys-accent bg-sys-accent text-white"
                        : "border-sys-border bg-sys-bg text-sys-text-secondary hover:text-sys-text-primary"
                    }`}
                  >
                    12-бальна (1-2 курс)
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-sys-text-secondary">
                  Оцінка ({newScale === 5 ? "1..5" : "1..12"}) *
                </label>
                <input
                  type="number"
                  required
                  min={1}
                  max={newScale}
                  value={newGrade}
                  onChange={(e) => setNewGrade(Number(e.target.value))}
                  className="w-full px-3 py-1.5 rounded-xl border border-sys-border bg-sys-bg text-xs text-sys-text-primary focus:outline-none focus:ring-1 focus:ring-sys-accent font-bold"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-sys-border/60">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-3 py-1.5 rounded-xl border border-sys-border text-xs font-semibold text-sys-text-secondary hover:text-sys-text-primary cursor-pointer"
                >
                  Скасувати
                </button>
                <button
                  type="submit"
                  className="px-3.5 py-1.5 rounded-xl bg-sys-accent text-xs font-semibold text-white shadow-xs hover:opacity-90 active:scale-95 cursor-pointer"
                >
                  Зберегти
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
