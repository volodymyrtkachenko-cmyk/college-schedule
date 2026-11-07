"use client";

import { useState } from "react";
import { AcademicTermRecord, TermCourseScheduleInput, api } from "../../lib/api";
import { useToast } from "../ToastProvider";

interface TermScheduleModalProps {
  term: AcademicTermRecord;
  terms: AcademicTermRecord[];
  onClose: () => void;
  onSaved: (updatedTerm: AcademicTermRecord) => void;
  onCreatedNextTerm?: (newTerm: AcademicTermRecord) => void;
}

export function TermScheduleModal({
  term,
  terms,
  onClose,
  onSaved,
  onCreatedNextTerm,
}: TermScheduleModalProps) {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"schedule" | "new_term" | "clone">("schedule");

  // Form states
  const [name, setName] = useState(term.name);
  const [totalWeeks, setTotalWeeks] = useState(term.total_weeks);
  const [startDate, setStartDate] = useState(term.start_date);
  const [endDate, setEndDate] = useState(term.end_date);
  const [status, setStatus] = useState(term.status);
  const [isCurrent, setIsCurrent] = useState(term.is_current);

  // Schedules by course 1..4
  const [courseSchedules, setCourseSchedules] = useState<TermCourseScheduleInput[]>(() => {
    const existingMap = new Map(term.course_schedules.map((cs) => [cs.course, cs]));
    return [1, 2, 3, 4].map((course) => {
      const ex = existingMap.get(course);
      const pWeeks = ex?.practice_weeks ?? (course >= 4 ? 3 : course === 3 ? 2 : 0);
      const tWeeks = ex?.total_weeks ?? term.total_weeks;
      const timing = ex?.practice_timing ?? (pWeeks > 0 ? "MIDDLE" : "NONE");
      return {
        course,
        total_weeks: tWeeks,
        practice_weeks: pWeeks,
        practice_timing: timing,
        practice_start_week: ex?.practice_start_week ?? (pWeeks > 0 ? 8 : null),
        practice_end_week: ex?.practice_end_week ?? (pWeeks > 0 ? 8 + pWeeks - 1 : null),
        theory_weeks: Math.max(0, tWeeks - pWeeks),
      };
    });
  });

  // Next term creation states
  const [nextYear, setNextYear] = useState(
    term.semester_number === 1 ? term.academic_year : `${parseInt(term.academic_year.split("/")[0]) + 1}/${parseInt(term.academic_year.split("/")[1]) + 1}`
  );
  const [nextSemesterNum, setNextSemesterNum] = useState(term.semester_number === 1 ? 2 : 1);
  const [nextName, setNextName] = useState(
    term.semester_number === 1 ? `${term.academic_year} · II семестр` : `${nextYear} · I семестр`
  );
  const [nextWeeks, setNextWeeks] = useState(17);
  const [sourceTermForClone, setSourceTermForClone] = useState<number>(term.id);

  function handleCourseChange(
    course: number,
    field: "practice_weeks" | "practice_timing" | "practice_start_week",
    value: any
  ) {
    setCourseSchedules((prev) =>
      prev.map((cs) => {
        if (cs.course !== course) return cs;
        const updated = { ...cs, [field]: value };
        if (field === "practice_weeks") {
          const p = Math.max(0, parseInt(value) || 0);
          updated.practice_weeks = p;
          updated.theory_weeks = Math.max(0, updated.total_weeks - p);
          if (p === 0) {
            updated.practice_timing = "NONE";
            updated.practice_start_week = null;
            updated.practice_end_week = null;
          } else {
            if (updated.practice_timing === "NONE") updated.practice_timing = "MIDDLE";
            const start = updated.practice_start_week || 8;
            updated.practice_start_week = start;
            updated.practice_end_week = start + p - 1;
          }
        }
        if (field === "practice_start_week") {
          const s = parseInt(value) || null;
          updated.practice_start_week = s;
          updated.practice_end_week = s && updated.practice_weeks ? s + updated.practice_weeks - 1 : null;
        }
        if (field === "practice_timing") {
          updated.practice_timing = value;
          if (value === "START") {
            updated.practice_start_week = 1;
            updated.practice_end_week = updated.practice_weeks;
          } else if (value === "END") {
            updated.practice_start_week = updated.total_weeks - updated.practice_weeks + 1;
            updated.practice_end_week = updated.total_weeks;
          } else if (value === "MIDDLE") {
            updated.practice_start_week = 8;
            updated.practice_end_week = 8 + updated.practice_weeks - 1;
          }
        }
        return updated;
      })
    );
  }

  async function handleSaveSchedule() {
    setLoading(true);
    try {
      const session = await api.auth.ensureAuthenticated();
      const updated = await api.terms.update(
        term.id,
        {
          name,
          total_weeks: totalWeeks,
          start_date: startDate,
          end_date: endDate,
          is_current: isCurrent,
          status,
          course_schedules: courseSchedules,
        },
        session.access_token
      );
      showToast("Графік навчального процесу збережено", "success");
      onSaved(updated);
      onClose();
    } catch (e: any) {
      showToast(e.message || "Помилка збереження графіка", "error");
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateNextTerm() {
    setLoading(true);
    try {
      const session = await api.auth.ensureAuthenticated();
      const created = await api.terms.create(
        {
          name: nextName,
          academic_year: nextYear,
          semester_number: nextSemesterNum,
          start_date: term.semester_number === 1 ? "2026-02-01" : "2026-09-01",
          end_date: term.semester_number === 1 ? "2026-06-30" : "2027-01-31",
          total_weeks: nextWeeks,
          is_current: false,
          status: "PLANNING",
          course_schedules: courseSchedules.map((cs) => ({
            ...cs,
            total_weeks: nextWeeks,
            theory_weeks: Math.max(0, nextWeeks - cs.practice_weeks),
          })),
        },
        session.access_token
      );
      showToast(`Семестр «${created.name}» створено в режимі планування`, "success");
      if (onCreatedNextTerm) {
        onCreatedNextTerm(created);
      }
      onClose();
    } catch (e: any) {
      showToast(e.message || "Помилка створення семестру", "error");
    } finally {
      setLoading(false);
    }
  }

  async function handleCloneWorkload() {
    if (!sourceTermForClone) return;
    setLoading(true);
    try {
      const session = await api.auth.ensureAuthenticated();
      const res = await api.terms.clone(
        term.id,
        sourceTermForClone,
        true,
        session.access_token
      );
      showToast(`Успішно скопійовано: ${res.cloned_curriculums} предметів та ${res.cloned_constraints} побажань`, "success");
      onSaved(term);
      onClose();
    } catch (e: any) {
      showToast(e.message || "Помилка копіювання", "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center bg-black/70 p-0 sm:p-4 backdrop-blur-md"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Графік навчального процесу та семестри"
        className="flex max-h-[94dvh] w-full sm:max-w-3xl flex-col rounded-t-2xl sm:rounded-2xl border border-sys-border bg-sys-card shadow-2xl overflow-hidden pb-safe animate-in slide-in-from-bottom-6 sm:slide-in-from-bottom-2 duration-200"
      >
        {/* Header */}
        <div className="p-5 sm:p-6 pb-4 border-b border-sys-border/50 sticky top-0 flex justify-between items-center z-10 bg-sys-card/95 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sys-accent/20 text-sys-accent shadow-inner">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect width="18" height="18" x="3" y="4" rx="2" ry="2"/>
                <line x1="16" x2="16" y1="2" y2="6"/>
                <line x1="8" x2="8" y1="2" y2="6"/>
                <line x1="3" x2="21" y1="10" y2="10"/>
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-bold text-sys-text-primary leading-tight">
                Графік навчального процесу та семестри
              </h3>
              <p className="text-xs text-sys-text-secondary mt-0.5">
                {term.name} • {term.is_current ? "Поточний семестр" : "Семестр планування"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 flex items-center justify-center rounded-lg text-sys-text-secondary hover:text-sys-text-primary hover:bg-white/5 active:scale-95 transition-all"
            aria-label="Закрити"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Tab switch */}
        <div className="flex items-center px-5 sm:px-6 pt-3 border-b border-sys-border/40 gap-2 bg-sys-bg/40">
          <button
            type="button"
            onClick={() => setActiveTab("schedule")}
            className={`pb-2.5 px-3 text-xs sm:text-sm font-semibold border-b-2 transition-all ${
              activeTab === "schedule"
                ? "border-sys-accent text-sys-accent"
                : "border-transparent text-sys-text-secondary hover:text-sys-text-primary"
            }`}
          >
            📅 Практики за курсами 1–4
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("new_term")}
            className={`pb-2.5 px-3 text-xs sm:text-sm font-semibold border-b-2 transition-all ${
              activeTab === "new_term"
                ? "border-sys-accent text-sys-accent"
                : "border-transparent text-sys-text-secondary hover:text-sys-text-primary"
            }`}
          >
            ➕ Новий семестр для планування
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("clone")}
            className={`pb-2.5 px-3 text-xs sm:text-sm font-semibold border-b-2 transition-all ${
              activeTab === "clone"
                ? "border-sys-accent text-sys-accent"
                : "border-transparent text-sys-text-secondary hover:text-sys-text-primary"
            }`}
          >
            📥 Скопіювати навантаження
          </button>
        </div>

        {/* Body content */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-5 flex-1">
          {activeTab === "schedule" && (
            <>
              {/* General term settings */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-4 rounded-xl border border-sys-border bg-sys-bg/60">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-sys-text-secondary">Назва семестру</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full rounded-lg border border-sys-border bg-sys-card px-3 py-1.5 text-xs text-sys-text-primary font-medium focus:border-sys-accent outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-sys-text-secondary">Тривалість семестру (тижнів)</label>
                  <input
                    type="number"
                    min="10"
                    max="30"
                    value={totalWeeks}
                    onChange={(e) => setTotalWeeks(parseInt(e.target.value) || 17)}
                    className="w-full rounded-lg border border-sys-border bg-sys-card px-3 py-1.5 text-xs text-sys-text-primary font-bold text-center focus:border-sys-accent outline-none"
                  />
                </div>
                <div className="space-y-1 flex flex-col justify-end">
                  <label className="flex items-center gap-2 cursor-pointer p-1.5 rounded-lg border border-sys-border/60 bg-sys-card hover:bg-white/5 transition-colors">
                    <input
                      type="checkbox"
                      checked={isCurrent}
                      onChange={(e) => setIsCurrent(e.target.checked)}
                      className="accent-emerald-500 rounded h-4 w-4"
                    />
                    <span className="text-xs font-semibold text-sys-text-primary">
                      {isCurrent ? "🟢 Поточний семестр" : "⚪ Семестр планування"}
                    </span>
                  </label>
                </div>
              </div>

              {/* Course by course practice cards */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-sys-accent">
                    Практики та тижні теорії за курсами (1–4)
                  </h4>
                  <span className="text-xs text-sys-text-muted">
                    ⚡ 1 пара = 2 год · розраховується за чистими тижнями теорії
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {courseSchedules.map((cs) => {
                    const isPract = cs.practice_weeks > 0;
                    return (
                      <div
                        key={cs.course}
                        className={`p-4 rounded-xl border transition-all ${
                          isPract
                            ? "border-amber-500/40 bg-amber-500/5 shadow-sm"
                            : "border-sys-border bg-sys-card/70"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-bold text-sm text-sys-text-primary">
                            🎓 {cs.course}-й курс
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded text-xs font-bold ${
                              isPract
                                ? "bg-amber-500/20 text-amber-800 dark:text-amber-300"
                                : "bg-emerald-500/20 text-emerald-800 dark:text-emerald-300"
                            }`}
                          >
                            {cs.theory_weeks} тижнів теорії
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <label className="text-sys-text-secondary block mb-1">
                              Тижнів практики:
                            </label>
                            <input
                              type="number"
                              min="0"
                              max={cs.total_weeks}
                              value={cs.practice_weeks}
                              onChange={(e) =>
                                handleCourseChange(cs.course, "practice_weeks", e.target.value)
                              }
                              className="w-full rounded border border-sys-border bg-sys-bg px-2 py-1 text-center font-bold text-sys-text-primary focus:border-sys-accent outline-none"
                            />
                          </div>

                          <div>
                            <label className="text-sys-text-secondary block mb-1">
                              Розташування:
                            </label>
                            <select
                              value={cs.practice_timing}
                              disabled={cs.practice_weeks === 0}
                              onChange={(e) =>
                                handleCourseChange(cs.course, "practice_timing", e.target.value)
                              }
                              className="w-full rounded border border-sys-border bg-sys-bg px-2 py-1 text-xs text-sys-text-primary focus:border-sys-accent outline-none disabled:opacity-40"
                            >
                              <option value="NONE">Без практики</option>
                              <option value="START">На початку</option>
                              <option value="MIDDLE">Посередині</option>
                              <option value="END">Вкінці семестру</option>
                            </select>
                          </div>
                        </div>

                        {isPract && (
                          <div className="mt-2.5 pt-2 border-t border-amber-500/20 flex items-center justify-between text-xs text-amber-800 dark:text-amber-300/90">
                            <span>
                              Період практики: {cs.practice_start_week ?? "?"}–{cs.practice_end_week ?? "?"} тиждень
                            </span>
                            <span className="font-medium text-sys-text-muted">
                              ({cs.practice_weeks} тиж.)
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {activeTab === "new_term" && (
            <div className="space-y-4 p-4 rounded-xl border border-sys-border bg-sys-bg/60">
              <div className="space-y-1">
                <h4 className="text-sm font-bold text-sys-text-primary">
                  Підготовка наступного семестру
                </h4>
                <p className="text-xs text-sys-text-secondary">
                  Створює окремий навчальний семестр у режимі «PLANNING». У ньому викладачі та адміністратори можуть вносити нові предмети, перерозподіляти навантаження та генерувати чернетки, <strong>не змінюючи поточний розклад та статистику</strong>.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-sys-text-secondary">Назва семестру</label>
                  <input
                    type="text"
                    value={nextName}
                    onChange={(e) => setNextName(e.target.value)}
                    className="w-full rounded-lg border border-sys-border bg-sys-card px-3 py-2 text-xs text-sys-text-primary font-medium focus:border-sys-accent outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-sys-text-secondary">Академічний рік</label>
                  <input
                    type="text"
                    value={nextYear}
                    onChange={(e) => setNextYear(e.target.value)}
                    className="w-full rounded-lg border border-sys-border bg-sys-card px-3 py-2 text-xs text-sys-text-primary font-medium focus:border-sys-accent outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-sys-text-secondary">Номер семестру</label>
                  <select
                    value={nextSemesterNum}
                    onChange={(e) => setNextSemesterNum(parseInt(e.target.value))}
                    className="w-full rounded-lg border border-sys-border bg-sys-card px-3 py-2 text-xs text-sys-text-primary focus:border-sys-accent outline-none"
                  >
                    <option value={1}>1 семестр</option>
                    <option value={2}>2 семестр</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-sys-text-secondary">Тривалість (тижнів)</label>
                  <input
                    type="number"
                    min="10"
                    max="30"
                    value={nextWeeks}
                    onChange={(e) => setNextWeeks(parseInt(e.target.value) || 17)}
                    className="w-full rounded-lg border border-sys-border bg-sys-card px-3 py-2 text-xs text-sys-text-primary font-bold text-center focus:border-sys-accent outline-none"
                  />
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleCreateNextTerm}
                  disabled={loading}
                  className="w-full py-2.5 rounded-xl bg-sys-accent hover:bg-sys-accent-hover text-white text-xs font-bold transition-all shadow-md active:scale-[0.99] disabled:opacity-50"
                >
                  {loading ? "Створення..." : "➕ Створити семестр для планування"}
                </button>
              </div>
            </div>
          )}

          {activeTab === "clone" && (
            <div className="space-y-4 p-4 rounded-xl border border-sys-border bg-sys-bg/60">
              <div className="space-y-1">
                <h4 className="text-sm font-bold text-sys-text-primary">
                  Швидкий переніс навантаження
                </h4>
                <p className="text-xs text-sys-text-secondary">
                  Копіює предмети, групи, викладачів та побажання з обраного семестру в поточний (<strong>{term.name}</strong>). Години та пари будуть автоматично перераховані під чисті тижні теорії цільового семестру.
                </p>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-sys-text-secondary">
                  Оберіть семестр-джерело:
                </label>
                <select
                  value={sourceTermForClone}
                  onChange={(e) => setSourceTermForClone(parseInt(e.target.value))}
                  className="w-full rounded-lg border border-sys-border bg-sys-card px-3 py-2 text-xs text-sys-text-primary font-medium focus:border-sys-accent outline-none"
                >
                  {terms
                    .filter((t) => t.id !== term.id)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.is_current ? "Поточний" : t.status})
                      </option>
                    ))}
                </select>
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleCloneWorkload}
                  disabled={loading || terms.filter((t) => t.id !== term.id).length === 0}
                  className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all shadow-md active:scale-[0.99] disabled:opacity-50"
                >
                  {loading ? "Копіювання..." : "📥 Скопіювати предмети з перерахунком годин"}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {activeTab === "schedule" && (
          <div className="p-4 sm:p-5 border-t border-sys-border/50 bg-sys-card/95 flex justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-sys-border text-sys-text-secondary hover:text-sys-text-primary hover:bg-white/5 text-xs font-semibold transition-all"
            >
              Скасувати
            </button>
            <button
              type="button"
              onClick={handleSaveSchedule}
              disabled={loading}
              className="px-5 py-2 rounded-xl bg-sys-accent hover:bg-sys-accent-hover text-white text-xs font-bold transition-all shadow-md active:scale-95 disabled:opacity-50"
            >
              {loading ? "Збереження..." : "Зберегти графік процесу"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}