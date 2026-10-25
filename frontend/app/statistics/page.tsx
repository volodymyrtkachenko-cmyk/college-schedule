"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { SearchableSelect } from "../../components/SearchableSelect";
import { api, ReferenceRecord, StatisticsResponse, TeacherGroupDetail, TeacherSubjectEntry } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { getProgressPercentage } from "../../lib/format";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("uk-UA", { day: "numeric", month: "long", year: "numeric" })
    .format(new Date(`${value}T00:00:00`));
}

export default function StatisticsPage() {
  const { user } = useAuth();
  const [mode, setMode] = useState<"student" | "teacher">("student");
  const [teacherView, setTeacherView] = useState<"subjects" | "groups">("subjects");
  const [groups, setGroups] = useState<ReferenceRecord[]>([]);
  const [teachers, setTeachers] = useState<ReferenceRecord[]>([]);
  const [groupId, setGroupId] = useState<number | null>(null);
  const [teacherId, setTeacherId] = useState<number | null>(null);
  const [referencesLoading, setReferencesLoading] = useState(true);
  const [stats, setStats] = useState<StatisticsResponse | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const storedMode = window.localStorage.getItem("schedule:mode");
    const storedGroupId = Number(window.localStorage.getItem("schedule:groupId")) || null;
    const storedTeacherId = Number(window.localStorage.getItem("schedule:teacherId")) || null;

    Promise.all([api.groups(), api.directory.teachers()])
      .then(([allGroups, allTeachers]) => {
        if (!active) return;
        const availableGroups = user?.role === "editor"
          ? allGroups.filter((group) => (user.allowed_groups || []).includes(group.id))
          : allGroups;
        const availableTeachers = user?.role === "editor" ? [] : allTeachers;
        const initialMode = storedMode === "teacher" && availableTeachers.length
          ? "teacher"
          : "student";

        setGroups(availableGroups);
        setTeachers(availableTeachers);
        setMode(initialMode);
        setGroupId(
          storedGroupId && availableGroups.some((group) => group.id === storedGroupId)
            ? storedGroupId
            : availableGroups[0]?.id ?? null,
        );
        setTeacherId(
          storedTeacherId && availableTeachers.some((teacher) => teacher.id === storedTeacherId)
            ? storedTeacherId
            : availableTeachers[0]?.id ?? null,
        );
        setError(null);
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Не вдалося завантажити список груп і викладачів.");
        }
      })
      .finally(() => {
        if (active) setReferencesLoading(false);
      });

    return () => {
      active = false;
    };
  }, [user?.id, user?.role]);

  useEffect(() => {
    if (referencesLoading) return;
    const targetId = mode === "student" ? groupId : teacherId;
    if (targetId === null) {
      setStats(null);
      setStatsLoading(false);
      return;
    }

    let active = true;
    setStatsLoading(true);
    setError(null);
    const target = mode === "student" ? { groupId: targetId } : { teacherId: targetId };
    api.statistics(target)
      .then((response) => {
        if (active) setStats(response);
      })
      .catch((loadError: unknown) => {
        if (active) {
          setStats(null);
          setError(loadError instanceof Error ? loadError.message : "Не вдалося завантажити статистику.");
        }
      })
      .finally(() => {
        if (active) setStatsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [mode, groupId, teacherId, referencesLoading]);

  const displayedStudentEntries = useMemo(
    () => [...(stats?.entries ?? [])].sort((a, b) => b.completed_hours - a.completed_hours),
    [stats],
  );

  const teacherSubjects: TeacherSubjectEntry[] = useMemo(
    () => stats?.subjects ?? [],
    [stats],
  );

  const teacherGroups: TeacherGroupDetail[] = useMemo(() => {
    if (stats?.groups && stats.groups.length > 0) {
      return [...stats.groups].sort((a, b) => b.completed_hours - a.completed_hours);
    }
    return (stats?.entries ?? []).map((e) => ({
      id: e.id,
      name: e.name,
      completed_hours: e.completed_hours,
      lessons_count: Math.round(e.completed_hours / 2),
      subject_names: e.subject_names ?? [],
    })).sort((a, b) => b.completed_hours - a.completed_hours);
  }, [stats]);

  const maxStudentEntryHours = useMemo(
    () => Math.max(0, ...displayedStudentEntries.map((entry) => entry.completed_hours)),
    [displayedStudentEntries],
  );

  const maxTeacherSubjectHours = useMemo(
    () => Math.max(0, ...teacherSubjects.map((s) => s.completed_hours)),
    [teacherSubjects],
  );

  const maxTeacherGroupHours = useMemo(
    () => Math.max(0, ...teacherGroups.map((g) => g.completed_hours)),
    [teacherGroups],
  );

  const hasGlobalPlan = Boolean(stats?.planned_hours && stats.planned_hours > 0);

  const selectedName = mode === "student"
    ? groups.find((item) => item.id === groupId)?.name
    : teachers.find((item) => item.id === teacherId)?.name;

  const changeMode = (value: "student" | "teacher") => {
    setMode(value);
    window.localStorage.setItem("schedule:mode", value);
  };

  const changeGroup = (id: number | null) => {
    setGroupId(id);
    if (id !== null) window.localStorage.setItem("schedule:groupId", String(id));
  };

  const changeTeacher = (id: number | null) => {
    setTeacherId(id);
    if (id !== null) window.localStorage.setItem("schedule:teacherId", String(id));
  };

  return (
    <main className="min-h-screen bg-sys-bg text-sys-text-primary">
      <header className="border-b border-sys-border bg-sys-bg/80">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-5 sm:px-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-sys-accent">ДФКР</p>
            <h1 className="mt-1 text-xl font-bold tracking-tight sm:text-2xl">Статистика</h1>
          </div>
          <Link href="/" className="shrink-0 rounded-lg border border-sys-border px-3 py-2 text-sm font-medium text-sys-text-secondary transition-colors hover:bg-sys-hover hover:text-sys-text-primary">
            До розкладу
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <section className="flex flex-col gap-4">
          <div className="flex justify-center mb-2">
            <div role="group" className="inline-flex relative rounded-full bg-slate-200/80 dark:bg-slate-800/80 p-1 shadow-inner border border-slate-300/80 dark:border-slate-700/50">
              {teachers.length > 0 && (
                <div className="absolute top-1 bottom-1 w-[calc(50%-4px)] bg-sys-accent rounded-full transition-all duration-300 ease-out z-0 shadow-sm" style={{ left: mode === 'student' ? '4px' : 'calc(50% + 2px)' }}></div>
              )}
              <button
                type="button"
                onClick={() => changeMode("student")}
                className={`relative z-10 flex-1 w-32 rounded-full px-6 py-2 text-sm font-semibold transition-colors ${mode === "student" ? "text-white" : "text-sys-text-secondary hover:text-sys-text-primary"}`}
              >
                Групам
              </button>
              {teachers.length > 0 && (
                <button
                  type="button"
                  onClick={() => changeMode("teacher")}
                  className={`relative z-10 flex-1 w-32 rounded-full px-6 py-2 text-sm font-semibold transition-colors ${mode === "teacher" ? "text-white" : "text-sys-text-secondary hover:text-sys-text-primary"}`}
                >
                  Викладачам
                </button>
              )}
            </div>
          </div>
          
          <div className="max-w-md mx-auto w-full">
            <SearchableSelect
              options={mode === "student" ? groups : teachers}
              value={mode === "student" ? groupId : teacherId}
              onChange={mode === "student" ? changeGroup : changeTeacher}
              ariaLabel={mode === "student" ? "Обрати групу" : "Обрати викладача"}
              placeholder={mode === "student" ? "🔍 Знайти групу..." : "🔍 Знайти викладача..."}
              emptyLabel="Очистити вибір"
            />
            {stats && (
              <p className="mt-3 text-center text-xs text-sys-text-muted">
                Розрахунок за: {formatDate(stats.semester_start)} — {formatDate(stats.through_date)}
              </p>
            )}
          </div>
        </section>

        {referencesLoading || statsLoading ? (
          <div className="space-y-4 animate-pulse" aria-busy="true">
            <div className="grid grid-cols-2 gap-4">
              <div className="h-28 rounded-2xl border border-sys-border/60 bg-sys-card/70" />
              <div className="h-28 rounded-2xl border border-sys-border/60 bg-sys-card/70" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="h-24 rounded-2xl border border-sys-border/60 bg-sys-card/70 p-4 flex items-center gap-4">
                  <div className="w-16 h-16 rounded-full bg-slate-200 dark:bg-slate-800 shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-3/4 rounded bg-slate-200/80 dark:bg-slate-700/70" />
                    <div className="h-3 w-1/2 rounded bg-slate-100 dark:bg-slate-800" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : error ? (
          <div role="alert" className="rounded-2xl border border-rose-400/20 bg-rose-400/5 p-6 text-center text-rose-200">
            {error}
          </div>
        ) : !selectedName ? (
          <div className="rounded-2xl border border-dashed border-sys-border p-10 text-center text-sys-text-secondary">
            {mode === "student" ? "Немає доступних груп для статистики." : "Немає доступних викладачів для статистики."}
          </div>
        ) : stats ? (
          <>
            <div className="flex flex-col items-center justify-center text-center mt-4 mb-2">
              <h2 className="text-2xl font-bold tracking-tight">{selectedName}</h2>
            </div>

            {mode === "student" ? (
              <section className="grid gap-4 grid-cols-2 mt-4">
                <div className="rounded-2xl border border-sys-border bg-sys-card p-5 text-center flex flex-col justify-center items-center">
                  <p className="text-xs font-semibold uppercase tracking-wider text-sys-text-secondary">
                    Вивчено
                  </p>
                  <p className="mt-2 text-4xl font-black text-sys-accent">
                    {stats.total_hours}
                  </p>
                  <p className="mt-1 text-xs text-sys-text-muted">
                    акад. год · {Math.round(stats.total_hours / 2)} пар
                  </p>
                </div>
                {hasGlobalPlan ? (
                  <div className="rounded-2xl border border-sys-border bg-sys-card p-5 text-center flex flex-col justify-center items-center">
                    <p className="text-xs font-semibold uppercase tracking-wider text-sys-text-secondary">Всього за планом</p>
                    <p className="mt-2 text-4xl font-black text-sys-text-primary">
                      {stats.planned_hours}
                    </p>
                    <p className="mt-1 text-xs text-sys-text-muted">
                      Виконано {Math.min(100, Math.round((stats.total_hours / stats.planned_hours!) * 100))}% · Залишилось {Math.max(0, stats.planned_hours! - stats.total_hours)} год ({Math.round(Math.max(0, stats.planned_hours! - stats.total_hours) / 2)} пар)
                    </p>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-sys-border bg-sys-card p-5 text-center flex flex-col justify-center items-center">
                    <p className="text-xs font-semibold uppercase tracking-wider text-sys-text-secondary">
                      Дисциплін
                    </p>
                    <p className="mt-2 text-4xl font-black text-sys-text-primary">{stats.entries.length}</p>
                    <p className="mt-1 text-xs text-sys-text-muted">у поточному семестрі</p>
                  </div>
                )}
              </section>
            ) : (
              <section className="grid gap-4 grid-cols-2 mt-4">
                <div className="rounded-2xl border border-sys-border bg-sys-card p-5 text-center flex flex-col justify-center items-center">
                  <p className="text-xs font-semibold uppercase tracking-wider text-sys-text-secondary">
                    Проведено
                  </p>
                  <p className="mt-2 text-4xl font-black text-sys-accent">
                    {stats.total_hours}
                  </p>
                  <p className="mt-1 text-xs text-sys-text-muted">
                    акад. год · {Math.round(stats.total_hours / 2)} пар
                  </p>
                </div>
                {hasGlobalPlan ? (
                  <div className="rounded-2xl border border-sys-border bg-sys-card p-5 text-center flex flex-col justify-center items-center">
                    <p className="text-xs font-semibold uppercase tracking-wider text-sys-text-secondary">Семестровий план</p>
                    <p className="mt-2 text-4xl font-black text-sys-text-primary">
                      {stats.planned_hours}
                    </p>
                    <p className="mt-1 text-xs text-sys-text-muted">
                      Виконано {Math.min(100, Math.round((stats.total_hours / stats.planned_hours!) * 100))}% · Залишилось {Math.max(0, stats.planned_hours! - stats.total_hours)} год
                    </p>
                  </div>
                ) : stats.weekly_hours ? (
                  <div className="rounded-2xl border border-sys-border bg-sys-card p-5 text-center flex flex-col justify-center items-center">
                    <p className="text-xs font-semibold uppercase tracking-wider text-sys-text-secondary">Тижневе навантаження</p>
                    <p className="mt-2 text-4xl font-black text-sys-text-primary">
                      {stats.weekly_hours}
                    </p>
                    <p className="mt-1 text-xs text-sys-text-muted">
                      акад. год/тиждень · {Math.round(stats.weekly_hours / 2)} пар
                    </p>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-sys-border bg-sys-card p-5 text-center flex flex-col justify-center items-center">
                    <p className="text-xs font-semibold uppercase tracking-wider text-sys-text-secondary">
                      Активних груп
                    </p>
                    <p className="mt-2 text-4xl font-black text-sys-text-primary">{teacherGroups.length}</p>
                    <p className="mt-1 text-xs text-sys-text-muted">{teacherSubjects.length} дисциплін</p>
                  </div>
                )}
              </section>
            )}

            {mode === "student" ? (
              <section className="mt-4">
                <h2 className="mb-4 text-xl font-bold px-1">
                  Розподіл за предметами
                </h2>
                {displayedStudentEntries.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-orange-300/15 bg-orange-300/[0.04] p-8 text-center shadow-sm">
                    <div className="text-3xl" aria-hidden="true">🛋️</div>
                    <p className="mt-2 text-sm text-sys-text-secondary">Поки що немає даних для відображення.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                    {displayedStudentEntries.map((entry) => {
                      const totalHours = entry.planned_hours ?? 0;
                      const hasPlannedHours = totalHours > 0;
                      const relativePercent =
                        maxStudentEntryHours > 0 ? Math.round((entry.completed_hours / maxStudentEntryHours) * 100) : 0;
                      const progress = hasPlannedHours
                        ? getProgressPercentage(entry.completed_hours, totalHours)
                        : relativePercent;
                      const clampedProgress = Math.min(100, Math.max(0, progress));

                      const circumference = 2 * Math.PI * 20;
                      const strokeDashoffset = circumference - (clampedProgress / 100) * circumference;

                      const colorClass = hasPlannedHours
                        ? progress >= 100
                          ? "text-emerald-600 dark:text-emerald-400"
                          : progress >= 50
                            ? "text-purple-600 dark:text-purple-400"
                            : "text-blue-600 dark:text-blue-400"
                        : "text-sys-accent";

                      return (
                        <div key={entry.id} className="rounded-2xl border border-sys-border bg-sys-card p-4 flex items-center gap-4 hover:bg-slate-50 dark:hover:bg-white/5 hover:border-sys-accent/40 transition-colors">
                          <div className="relative w-16 h-16 shrink-0 flex items-center justify-center">
                            <svg className="w-full h-full transform -rotate-90" viewBox="0 0 48 48">
                              <circle
                                cx="24" cy="24" r="20"
                                stroke="currentColor" strokeWidth="4" fill="none"
                                className="text-slate-200 dark:text-slate-800"
                              />
                              <circle
                                cx="24" cy="24" r="20"
                                stroke="currentColor" strokeWidth="4" fill="none"
                                strokeDasharray={circumference}
                                strokeDashoffset={strokeDashoffset}
                                className={`${colorClass} transition-all duration-1000 ease-out`}
                                strokeLinecap="round"
                              />
                            </svg>
                            <span className="absolute text-xs font-bold text-sys-text-primary">
                              {hasPlannedHours ? `${Math.round(clampedProgress)}%` : `${entry.completed_hours}г`}
                            </span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <h3 className="line-clamp-2 leading-snug font-semibold text-sm mb-1 text-sys-text-primary" title={entry.name}>
                              {entry.name}
                            </h3>
                            <p className="text-xs text-sys-text-secondary">
                              {hasPlannedHours
                                ? `${entry.completed_hours} з ${totalHours} акад. год · ${Math.round(entry.completed_hours / 2)} пар`
                                : `${entry.completed_hours} акад. год · ${Math.round(entry.completed_hours / 2)} пар`}
                            </p>
                            {Boolean(entry.replaced_count || entry.cancelled_count) && (
                              <div className="mt-1.5 flex flex-wrap gap-1.5 text-xs">
                                {Boolean(entry.replaced_count) && (
                                  <span className="rounded border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-amber-700 dark:text-amber-300 font-medium">
                                    Замін: {entry.replaced_count}
                                  </span>
                                )}
                                {Boolean(entry.cancelled_count) && (
                                  <span className="rounded border border-rose-500/20 bg-rose-500/10 px-1.5 py-0.5 text-rose-700 dark:text-rose-300 font-medium">
                                    Скасовано: {entry.cancelled_count}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                <p className="mt-6 text-center text-xs text-sys-text-muted">
                  Дані розраховані за розкладом і не враховують фактичну присутність.
                </p>
              </section>
            ) : (
              <section className="mt-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 px-1">
                  <div>
                    <h2 className="text-xl font-bold">
                      {teacherView === "subjects" ? "Розподіл за дисциплінами" : "Розподіл за групами"}
                    </h2>
                    <p className="text-xs text-sys-text-muted mt-0.5">
                      {teacherView === "subjects"
                        ? `${teacherSubjects.length} дисциплін закріплено в розкладі`
                        : `${teacherGroups.length} активних груп у поточному семестрі`}
                    </p>
                  </div>
                  <div role="group" className="inline-flex rounded-xl bg-slate-200/80 dark:bg-slate-800/80 p-1 border border-slate-300/80 dark:border-slate-700/50 text-xs font-medium self-start sm:self-auto">
                    <button
                      type="button"
                      onClick={() => setTeacherView("subjects")}
                      className={`rounded-lg px-3.5 py-1.5 transition-colors ${
                        teacherView === "subjects"
                          ? "bg-sys-accent text-white font-semibold shadow-sm"
                          : "text-sys-text-secondary hover:text-sys-text-primary"
                      }`}
                    >
                      За дисциплінами ({teacherSubjects.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setTeacherView("groups")}
                      className={`rounded-lg px-3.5 py-1.5 transition-colors ${
                        teacherView === "groups"
                          ? "bg-sys-accent text-white font-semibold shadow-sm"
                          : "text-sys-text-secondary hover:text-sys-text-primary"
                      }`}
                    >
                      За групами ({teacherGroups.length})
                    </button>
                  </div>
                </div>

                {teacherView === "subjects" ? (
                  teacherSubjects.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-orange-300/15 bg-orange-300/[0.04] p-8 text-center shadow-sm">
                      <div className="text-3xl" aria-hidden="true">🛋️</div>
                      <p className="mt-2 text-sm text-sys-text-secondary">Поки що немає даних за дисциплінами.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                      {teacherSubjects.map((subj) => {
                        const relativePercent =
                          maxTeacherSubjectHours > 0 ? Math.round((subj.completed_hours / maxTeacherSubjectHours) * 100) : 0;
                        const clampedProgress = Math.min(100, Math.max(0, relativePercent));
                        const circumference = 2 * Math.PI * 20;
                        const strokeDashoffset = circumference - (clampedProgress / 100) * circumference;

                        return (
                          <div key={subj.id} className="rounded-2xl border border-sys-border bg-sys-card p-4 flex items-center gap-4 hover:bg-slate-50 dark:hover:bg-white/5 hover:border-sys-accent/40 transition-colors">
                            <div className="relative w-16 h-16 shrink-0 flex items-center justify-center">
                              <svg className="w-full h-full transform -rotate-90" viewBox="0 0 48 48">
                                <circle
                                  cx="24" cy="24" r="20"
                                  stroke="currentColor" strokeWidth="4" fill="none"
                                  className="text-slate-200 dark:text-slate-800"
                                />
                                <circle
                                  cx="24" cy="24" r="20"
                                  stroke="currentColor" strokeWidth="4" fill="none"
                                  strokeDasharray={circumference}
                                  strokeDashoffset={strokeDashoffset}
                                  className="text-sys-accent transition-all duration-1000 ease-out"
                                  strokeLinecap="round"
                                />
                              </svg>
                              <span className="absolute text-xs font-bold text-sys-text-primary">
                                {subj.completed_hours}г
                              </span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <h3 className="line-clamp-2 leading-snug font-semibold text-sm mb-1 text-sys-text-primary" title={subj.name}>
                                {subj.name}
                              </h3>
                              <p className="text-xs text-sys-text-secondary mb-1.5">
                                {subj.completed_hours} акад. год · {subj.lessons_count} пар
                              </p>
                              {subj.groups.length > 0 && (
                                <div className="flex flex-wrap gap-1 items-center">
                                  <span className="text-[11px] text-sys-text-muted mr-0.5">Групи:</span>
                                  {subj.groups.map((grp) => (
                                    <span key={grp} className="rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700/60 px-1.5 py-0.5 text-[11px] font-medium text-slate-700 dark:text-slate-300">
                                      {grp}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )
                ) : (
                  teacherGroups.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-orange-300/15 bg-orange-300/[0.04] p-8 text-center shadow-sm">
                      <div className="text-3xl" aria-hidden="true">🛋️</div>
                      <p className="mt-2 text-sm text-sys-text-secondary">Поки що немає даних за групами.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                      {teacherGroups.map((grp) => {
                        const relativePercent =
                          maxTeacherGroupHours > 0 ? Math.round((grp.completed_hours / maxTeacherGroupHours) * 100) : 0;
                        const clampedProgress = Math.min(100, Math.max(0, relativePercent));
                        const circumference = 2 * Math.PI * 20;
                        const strokeDashoffset = circumference - (clampedProgress / 100) * circumference;

                        return (
                          <div key={grp.id} className="rounded-2xl border border-sys-border bg-sys-card p-4 flex items-center gap-4 hover:bg-slate-50 dark:hover:bg-white/5 hover:border-sys-accent/40 transition-colors">
                            <div className="relative w-16 h-16 shrink-0 flex items-center justify-center">
                              <svg className="w-full h-full transform -rotate-90" viewBox="0 0 48 48">
                                <circle
                                  cx="24" cy="24" r="20"
                                  stroke="currentColor" strokeWidth="4" fill="none"
                                  className="text-slate-200 dark:text-slate-800"
                                />
                                <circle
                                  cx="24" cy="24" r="20"
                                  stroke="currentColor" strokeWidth="4" fill="none"
                                  strokeDasharray={circumference}
                                  strokeDashoffset={strokeDashoffset}
                                  className="text-sys-accent transition-all duration-1000 ease-out"
                                  strokeLinecap="round"
                                />
                              </svg>
                              <span className="absolute text-xs font-bold text-sys-text-primary">
                                {grp.completed_hours}г
                              </span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <h3 className="font-semibold text-sm mb-1 text-sys-text-primary">
                                Група {grp.name}
                              </h3>
                              {grp.subject_names && grp.subject_names.length > 0 && (
                                <div className="flex flex-wrap gap-1 my-1.5">
                                  {grp.subject_names.map((subjectName) => (
                                    <span
                                      key={subjectName}
                                      className="rounded bg-sky-500/10 border border-sky-500/20 px-1.5 py-0.5 text-[11px] font-medium text-sky-700 dark:text-sky-300 leading-snug"
                                    >
                                      {subjectName}
                                    </span>
                                  ))}
                                </div>
                              )}
                              <p className="text-xs text-sys-text-secondary">
                                {grp.completed_hours} акад. год · {grp.lessons_count} пар
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )
                )}
              </section>
            )}
          </>
        ) : null}
      </div>
    </main>
  );
}
