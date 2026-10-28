"use client";

import React, { useState, useMemo } from "react";
import { FullTaskItem } from "./MobileTasksView";
import { useGradesSummary, GradeItem, SubjectSummary } from "../lib/useGradesSummary";

interface GradesViewProps {
  tasks: FullTaskItem[];
  isLinked: boolean;
  onSyncClassroom?: () => void;
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
  const [filterMode, setFilterMode] = useState<"all" | "attention" | "excellent">("all");
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

  const filteredSubjects = useMemo(() => {
    return subjects.filter((subj: SubjectSummary) => {
      const matchesSearch = subj.subject.toLowerCase().includes(searchQuery.toLowerCase());
      if (!matchesSearch) return false;

      if (filterMode === "attention") {
        return subj.average5 < 4.0;
      }
      if (filterMode === "excellent") {
        return subj.average5 >= 4.5;
      }
      return true;
    });
  }, [subjects, searchQuery, filterMode]);

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
    <div className="w-full space-y-4">
      {/* GPA & Standing Overview Card */}
      <section className="rounded-2xl border border-sys-border bg-sys-card p-4 sm:p-6 shadow-sm relative overflow-hidden">
        {/* Subtle decorative glow */}
        <div className="absolute -top-16 -right-16 w-48 h-48 rounded-full bg-sys-accent/10 blur-3xl pointer-events-none" />

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 relative z-10">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-sys-text-muted">
                Академічна успішність
              </span>
              <span
                className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${getBadgeColorClasses(
                  standing.badgeColor
                )}`}
              >
                {standing.title}
              </span>
            </div>

            <div className="flex items-baseline gap-2">
              <div className="flex items-baseline gap-1">
                <span className="text-3xl sm:text-4xl font-black text-sys-text-primary tracking-tight">
                  {totalGradesCount > 0 ? overallGpa5.toFixed(2) : "—"}
                </span>
                <span className="text-sm font-semibold text-sys-text-secondary">
                  / 5.00
                </span>
              </div>

              {overallAverage12 !== null && (
                <div className="flex items-baseline gap-1 pl-2 border-l border-sys-border/80">
                  <span className="text-xl sm:text-2xl font-bold text-sys-accent">
                    {overallAverage12.toFixed(1)}
                  </span>
                  <span className="text-xs font-semibold text-sys-text-secondary">
                    / 12 б.
                  </span>
                </div>
              )}
            </div>

            <p className="text-xs text-sys-text-secondary max-w-md leading-relaxed">
              {standing.description}
            </p>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-center">
            <button
              type="button"
              onClick={() => setIsAddModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-sys-border bg-sys-bg hover:bg-sys-accent/10 hover:border-sys-accent/40 px-3.5 py-2 text-xs font-semibold text-sys-text-primary hover:text-sys-accent transition-colors duration-fast ease-smooth cursor-pointer shadow-xs active:scale-95"
            >
              <svg
                width="14"
                height="14"
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
        </div>

        {/* Grade Distribution Bar */}
        {totalGradesCount > 0 && (
          <div className="mt-5 pt-4 border-t border-sys-border/60">
            <div className="flex items-center justify-between text-xs text-sys-text-secondary mb-2">
              <span>Розподіл оцінок ({totalGradesCount})</span>
              <span>{totalSubjectsCount} предметів</span>
            </div>

            <div className="grid grid-cols-4 gap-2">
              <div className="flex flex-col items-center justify-center p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                <span className="text-xs text-emerald-700 dark:text-emerald-400 font-semibold">«5»</span>
                <span className="text-base font-bold text-sys-text-primary">{distribution.count5}</span>
              </div>
              <div className="flex flex-col items-center justify-center p-2 rounded-xl bg-blue-500/10 border border-blue-500/20">
                <span className="text-xs text-blue-700 dark:text-blue-400 font-semibold">«4»</span>
                <span className="text-base font-bold text-sys-text-primary">{distribution.count4}</span>
              </div>
              <div className="flex flex-col items-center justify-center p-2 rounded-xl bg-amber-500/10 border border-amber-500/20">
                <span className="text-xs text-amber-700 dark:text-amber-400 font-semibold">«3»</span>
                <span className="text-base font-bold text-sys-text-primary">{distribution.count3}</span>
              </div>
              <div className="flex flex-col items-center justify-center p-2 rounded-xl bg-rose-500/10 border border-rose-500/20">
                <span className="text-xs text-rose-700 dark:text-rose-400 font-semibold">«2»</span>
                <span className="text-base font-bold text-sys-text-primary">{distribution.count2}</span>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Classroom Unlinked Notice if not logged in */}
      {!isLinked && (
        <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 p-3.5 text-xs text-sys-text-secondary flex items-start justify-between gap-3">
          <div className="space-y-0.5">
            <span className="font-semibold text-sys-text-primary block">
              Автоматичне підтягування оцінок з Classroom
            </span>
            <span>
              Прив&apos;яжіть студентську пошту, щоб оцінки за домашні завдання відображалися автоматично.
            </span>
          </div>
          {onSyncClassroom && (
            <button
              type="button"
              onClick={onSyncClassroom}
              className="shrink-0 rounded-lg bg-sky-500 hover:bg-sky-400 text-white font-semibold px-3 py-1.5 text-xs shadow-xs transition-colors cursor-pointer active:scale-95"
            >
              Прив&apos;язати
            </button>
          )}
        </div>
      )}

      {/* Filter and Search Bar */}
      {subjects.length > 0 && (
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
          <div className="relative flex-1">
            <svg
              className="absolute left-3 top-2.5 h-4 w-4 text-sys-text-muted"
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
              placeholder="Пошук за назвою предмета..."
              className="w-full pl-9 pr-3 py-1.5 rounded-xl border border-sys-border bg-sys-card text-xs text-sys-text-primary placeholder:text-sys-text-muted focus:outline-none focus:ring-1 focus:ring-sys-accent transition-colors"
            />
          </div>

          <div className="flex items-center gap-1 rounded-xl border border-sys-border bg-sys-card p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setFilterMode("all")}
              className={`px-2.5 py-1 rounded-lg font-semibold transition-colors duration-fast ease-smooth cursor-pointer ${
                filterMode === "all"
                  ? "bg-sys-accent text-white shadow-xs"
                  : "text-sys-text-secondary hover:text-sys-text-primary"
              }`}
            >
              Всі ({subjects.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterMode("excellent")}
              className={`px-2.5 py-1 rounded-lg font-semibold transition-colors duration-fast ease-smooth cursor-pointer ${
                filterMode === "excellent"
                  ? "bg-sys-accent text-white shadow-xs"
                  : "text-sys-text-secondary hover:text-sys-text-primary"
              }`}
            >
              Відмінно (≥ 4.5)
            </button>
            <button
              type="button"
              onClick={() => setFilterMode("attention")}
              className={`px-2.5 py-1 rounded-lg font-semibold transition-colors duration-fast ease-smooth cursor-pointer ${
                filterMode === "attention"
                  ? "bg-sys-accent text-white shadow-xs"
                  : "text-sys-text-secondary hover:text-sys-text-primary"
              }`}
            >
              Підтягнути (&lt; 4.0)
            </button>
          </div>
        </div>
      )}

      {/* Subjects List */}
      {filteredSubjects.length > 0 ? (
        <div className="space-y-2.5">
          {filteredSubjects.map((subj) => {
            const isExpanded = Boolean(expandedSubjects[subj.subject]);
            return (
              <div
                key={subj.subject}
                className="rounded-2xl border border-sys-border bg-sys-card transition-all duration-fast ease-smooth overflow-hidden shadow-xs hover:border-sys-border/90"
              >
                {/* Subject Header / Accordion trigger */}
                <button
                  type="button"
                  onClick={() => toggleSubject(subj.subject)}
                  className="w-full p-4 flex items-center justify-between gap-3 text-left cursor-pointer hover:bg-sys-bg/40 transition-colors"
                >
                  <div className="space-y-1 min-w-0 pr-2">
                    <div className="flex items-center gap-2">
                      <h4 className="font-bold text-sm sm:text-base text-sys-text-primary truncate">
                        {subj.subject}
                      </h4>
                      <span className="text-[11px] font-medium text-sys-text-muted shrink-0">
                        ({subj.grades.length}{" "}
                        {subj.grades.length === 1
                          ? "оцінка"
                          : subj.grades.length >= 2 && subj.grades.length <= 4
                          ? "оцінки"
                          : "оцінок"}
                        )
                      </span>
                    </div>

                    {subj.teacher && (
                      <p className="text-xs text-sys-text-secondary truncate">
                        👨‍🏫 {subj.teacher}
                      </p>
                    )}

                    {/* Chips preview of grades */}
                    <div className="flex flex-wrap items-center gap-1 pt-1">
                      {subj.grades.slice(0, 8).map((g) => (
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
                      {subj.grades.length > 8 && (
                        <span className="text-[10px] text-sys-text-muted font-semibold">
                          +{subj.grades.length - 8}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <div className="flex flex-col items-end">
                      <div className="flex items-baseline gap-1">
                        <span className="text-lg sm:text-xl font-black text-sys-text-primary">
                          {subj.average5.toFixed(2)}
                        </span>
                        <span className="text-[11px] font-semibold text-sys-text-secondary">
                          / 5
                        </span>
                      </div>
                      {subj.has12Scale && subj.average12 !== null && (
                        <span className="text-xs font-semibold text-sys-accent">
                          {subj.average12.toFixed(1)} / 12 б.
                        </span>
                      )}
                    </div>

                    <span className="text-xs text-sys-text-muted p-1">
                      {isExpanded ? "▴" : "▾"}
                    </span>
                  </div>
                </button>

                {/* Expanded Detailed Tasks */}
                {isExpanded && (
                  <div className="px-4 pb-4 pt-1 border-t border-sys-border/50 bg-sys-bg/40 space-y-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-sys-text-muted pt-2 pb-1">
                      Деталізація робіт та оцінок
                    </div>

                    <div className="space-y-1.5">
                      {subj.grades.map((grade) => (
                        <div
                          key={grade.id}
                          className="flex items-center justify-between gap-3 p-2.5 rounded-xl border border-sys-border/60 bg-sys-card text-xs"
                        >
                          <div className="space-y-0.5 min-w-0 pr-2">
                            <div className="flex items-center gap-1.5">
                              {grade.isManual && (
                                <span className="inline-block text-[10px] px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-700 dark:text-amber-400 font-semibold border border-amber-500/20">
                                  Вручну
                                </span>
                              )}
                              <span className="font-semibold text-sys-text-primary truncate">
                                {grade.title}
                              </span>
                            </div>

                            {grade.date && (
                              <p className="text-[11px] text-sys-text-muted">
                                {new Date(grade.date).toLocaleDateString("uk-UA", {
                                  day: "numeric",
                                  month: "short",
                                  year: "numeric",
                                })}
                              </p>
                            )}
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <div className="text-right">
                              <div className="flex items-baseline justify-end gap-1 font-bold">
                                <span className="text-sm text-sys-text-primary">
                                  {grade.rawGrade}
                                </span>
                                <span className="text-[11px] text-sys-text-secondary">
                                  /{grade.maxPoints}
                                </span>
                              </div>
                              <span className="text-[10px] text-sys-text-muted">
                                {grade.grade5} за 5-бальною ({grade.percentage}%)
                              </span>
                            </div>

                            {grade.url && (
                              <a
                                href={grade.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="p-1 rounded-lg text-sys-text-secondary hover:text-sys-accent transition-colors"
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
                                className="p-1 rounded-lg text-rose-500 hover:bg-rose-500/10 transition-colors cursor-pointer"
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
        <div className="rounded-2xl border border-dashed border-sys-border p-8 text-center space-y-3">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-sys-accent/10 text-sys-accent text-xl">
            📊
          </div>
          <h3 className="text-sm sm:text-base font-bold text-sys-text-primary">
            {searchQuery ? "Предметів не знайдено" : "Оцінок поки немає"}
          </h3>
          <p className="text-xs text-sys-text-secondary max-w-sm mx-auto leading-relaxed">
            {searchQuery
              ? "Спробуйте змінити пошуковий запит або скинути фільтри."
              : "Оцінки з'являться після того, як викладачі оцінять роботи в Google Classroom, або додайте оцінку власноруч."}
          </p>
          <button
            type="button"
            onClick={() => setIsAddModalOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-sys-accent px-4 py-2 text-xs font-semibold text-white shadow-xs hover:opacity-90 active:scale-95 transition-all cursor-pointer"
          >
            + Додати оцінку вручну
          </button>
        </div>
      )}

      {/* Modal Dialog: Add Custom Grade */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-2xl border border-sys-border bg-sys-card p-5 shadow-xl space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-sys-border/60">
              <h3 className="text-sm font-bold text-sys-text-primary flex items-center gap-2">
                <span>📝</span>
                <span>Додати оцінку</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="text-sys-text-muted hover:text-sys-text-primary p-1 rounded-lg cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAddSubmit} className="space-y-3.5">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-sys-text-secondary">
                  Предмет *
                </label>
                <input
                  type="text"
                  required
                  value={newSubject}
                  onChange={(e) => setNewSubject(e.target.value)}
                  placeholder="наприклад: Вища математика"
                  className="w-full px-3 py-2 rounded-xl border border-sys-border bg-sys-bg text-xs text-sys-text-primary placeholder:text-sys-text-muted focus:outline-none focus:ring-1 focus:ring-sys-accent"
                />
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
                  className="w-full px-3 py-2 rounded-xl border border-sys-border bg-sys-bg text-xs text-sys-text-primary placeholder:text-sys-text-muted focus:outline-none focus:ring-1 focus:ring-sys-accent"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-sys-text-secondary">
                  Система оцінювання
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setNewScale(5);
                      if (newGrade > 5) setNewGrade(5);
                    }}
                    className={`py-2 px-3 rounded-xl border text-xs font-semibold cursor-pointer transition-colors ${
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
                    className={`py-2 px-3 rounded-xl border text-xs font-semibold cursor-pointer transition-colors ${
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
                  className="w-full px-3 py-2 rounded-xl border border-sys-border bg-sys-bg text-xs text-sys-text-primary focus:outline-none focus:ring-1 focus:ring-sys-accent font-bold"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-sys-border/60">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-3.5 py-1.5 rounded-xl border border-sys-border text-xs font-semibold text-sys-text-secondary hover:text-sys-text-primary cursor-pointer"
                >
                  Скасувати
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-xl bg-sys-accent text-xs font-semibold text-white shadow-xs hover:opacity-90 active:scale-95 cursor-pointer"
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
