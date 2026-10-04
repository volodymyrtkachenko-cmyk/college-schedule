"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { SearchableSelect } from "../../components/SearchableSelect";
import { api, ReferenceRecord, StatisticsResponse } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { getProgressMessage, getProgressPercentage, getScheduleInsightMessage } from "../../lib/format";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("uk-UA", { day: "numeric", month: "long", year: "numeric" })
    .format(new Date(`${value}T00:00:00`));
}

export default function StatisticsPage() {
  const { user } = useAuth();
  const [mode, setMode] = useState<"student" | "teacher">("student");
  const [groups, setGroups] = useState<ReferenceRecord[]>([]);
  const [teachers, setTeachers] = useState<ReferenceRecord[]>([]);
  const [groupId, setGroupId] = useState<number | null>(null);
  const [teacherId, setTeacherId] = useState<number | null>(null);
  const [referencesLoading, setReferencesLoading] = useState(true);
  const [stats, setStats] = useState<StatisticsResponse | null>(null);
  const [todayLessonCount, setTodayLessonCount] = useState<number | null>(null);
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
    api.today(mode === "student" ? targetId : undefined, mode === "teacher" ? targetId : undefined)
      .then((response) => {
        if (active) setTodayLessonCount(response.lessons.length);
      })
      .catch(() => {
        if (active) setTodayLessonCount(null);
      });
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
      setTodayLessonCount(null);
    };
  }, [mode, groupId, teacherId, referencesLoading]);

  const displayedEntries = useMemo(
    () => mode === "teacher"
      ? [...(stats?.entries ?? [])].sort((a, b) => b.completed_hours - a.completed_hours)
      : stats?.entries ?? [],
    [mode, stats],
  );
  const maxGroupHours = useMemo(
    () => Math.max(0, ...displayedEntries.map((entry) => entry.completed_hours)),
    [displayedEntries],
  );

  const selectedName = mode === "student"
    ? groups.find((item) => item.id === groupId)?.name
    : teachers.find((item) => item.id === teacherId)?.name;

  const messageData = getScheduleInsightMessage(
    mode === "student" ? "group" : "teacher",
    todayLessonCount ?? -1,
    (mode === "student" ? groupId : teacherId) ?? 0,
  );

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
            <div role="group" className="inline-flex relative rounded-full bg-slate-800/80 p-1 shadow-inner border border-slate-700/50">
              {teachers.length > 0 && (
                <div className="absolute top-1 bottom-1 w-[calc(50%-4px)] bg-sys-accent rounded-full transition-all duration-300 ease-out z-0 shadow-sm" style={{ left: mode === 'student' ? '4px' : 'calc(50% + 2px)' }}></div>
              )}
              <button
                type="button"
                onClick={() => changeMode("student")}
                className={`relative z-10 flex-1 w-32 rounded-full px-6 py-2 text-sm font-semibold transition-all ${mode === "student" ? "text-slate-900" : "text-slate-400 hover:text-slate-200"}`}
              >
                Групам
              </button>
              {teachers.length > 0 && (
                <button
                  type="button"
                  onClick={() => changeMode("teacher")}
                  className={`relative z-10 flex-1 w-32 rounded-full px-6 py-2 text-sm font-semibold transition-all ${mode === "teacher" ? "text-slate-900" : "text-slate-400 hover:text-slate-200"}`}
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
          <div className="rounded-2xl border border-sys-border bg-sys-card/50 p-10 text-center text-sys-text-secondary">
            Завантаження статистики…
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
                <h2 className="text-2xl font-bold">{selectedName}</h2>
                <div className="mt-3 flex items-center justify-center gap-1.5 text-sm font-medium text-slate-300 bg-slate-800/40 border border-slate-700/50 rounded-full px-4 py-1.5">
                    <span>{messageData.icon}</span>
                    <span>{messageData.text}</span>
                </div>
            </div>

            <section className="grid gap-4 grid-cols-2 mt-4">
              <div className="rounded-2xl border border-sys-border bg-sys-card p-5 text-center flex flex-col justify-center items-center">
                <p className="text-xs font-semibold uppercase tracking-wider text-sys-text-secondary">
                  {mode === "student" ? "Вивчено" : "Проведено"}
                </p>
                <p className="mt-2 text-4xl font-black text-sys-accent">
                  {stats.total_hours}
                </p>
                <p className="mt-1 text-xs text-sys-text-muted">академічних годин</p>
              </div>
              {mode === "student" ? (
                <div className="rounded-2xl border border-sys-border bg-sys-card p-5 text-center flex flex-col justify-center items-center">
                  <p className="text-xs font-semibold uppercase tracking-wider text-sys-text-secondary">Всього за планом</p>
                  <p className="mt-2 text-4xl font-black text-white">
                    {stats.planned_hours ?? 0}
                  </p>
                  <p className="mt-1 text-xs text-sys-text-muted">
                    {stats.planned_hours ? getProgressMessage(stats.total_hours, stats.planned_hours) : "Невідомо"}
                  </p>
                </div>
              ) : (
                <div className="rounded-2xl border border-sys-border bg-sys-card p-5 text-center flex flex-col justify-center items-center">
                  <p className="text-xs font-semibold uppercase tracking-wider text-sys-text-secondary">Активних груп</p>
                  <p className="mt-2 text-4xl font-black text-white">{stats.entries.length}</p>
                  <p className="mt-1 text-xs text-sys-text-muted">за поточний розклад</p>
                </div>
              )}
            </section>

            <section className="mt-4">
              <h2 className="mb-4 text-xl font-bold px-1">
                {mode === "student" ? "Розподіл за предметами" : "Розподіл за групами"}
              </h2>
              {displayedEntries.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-orange-300/15 bg-orange-300/[0.04] p-8 text-center shadow-sm">
                  <div className="text-3xl" aria-hidden="true">🛋️</div>
                  <p className="mt-2 text-sm text-sys-text-secondary">Поки що немає даних для відображення.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                  {displayedEntries.map((entry) => {
                    const totalHours = entry.planned_hours ?? 0;
                    const hasPlannedHours = totalHours > 0;
                    const progress = hasPlannedHours
                      ? getProgressPercentage(entry.completed_hours, totalHours)
                      : 0;
                    const clampedProgress = Math.min(100, Math.max(0, progress));
                    
                    const circumference = 2 * Math.PI * 20; // r=20
                    const strokeDashoffset = mode === "student" && hasPlannedHours 
                        ? circumference - (clampedProgress / 100) * circumference
                        : mode !== "student" && maxGroupHours > 0
                            ? circumference - ((entry.completed_hours / maxGroupHours) * 100 / 100) * circumference
                            : circumference;

                    const colorClass = mode === "student"
                      ? progress >= 100 ? "text-emerald-500" : progress >= 50 ? "text-purple-500" : "text-blue-500"
                      : "text-emerald-400";

                    return (
                      <div key={entry.id} className="rounded-2xl border border-sys-border bg-sys-card p-4 flex items-center gap-4 hover:bg-white/5 transition-colors">
                        <div className="relative w-16 h-16 shrink-0 flex items-center justify-center">
                            {(mode !== "student" || hasPlannedHours) ? (
                                <>
                                    <svg className="w-full h-full transform -rotate-90" viewBox="0 0 48 48">
                                        <circle 
                                            cx="24" cy="24" r="20" 
                                            stroke="currentColor" 
                                            strokeWidth="4" 
                                            fill="none" 
                                            className="text-slate-800" 
                                        />
                                        <circle 
                                            cx="24" cy="24" r="20" 
                                            stroke="currentColor" 
                                            strokeWidth="4" 
                                            fill="none" 
                                            strokeDasharray={circumference} 
                                            strokeDashoffset={strokeDashoffset} 
                                            className={`${colorClass} transition-all duration-1000 ease-out`} 
                                            strokeLinecap="round" 
                                        />
                                    </svg>
                                    <span className="absolute text-xs font-bold text-slate-300">
                                        {mode === "student" ? `${Math.round(clampedProgress)}%` : entry.completed_hours}
                                    </span>
                                </>
                            ) : (
                                <div className="w-full h-full rounded-full border-4 border-slate-700 border-dashed flex items-center justify-center">
                                    <span className="text-xs font-bold text-slate-400">?</span>
                                </div>
                            )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="truncate font-semibold text-sm mb-1 text-slate-200" title={entry.name}>
                            {entry.name}
                          </h3>
                          <p className="text-xs text-slate-400">
                            {mode === "student" ? (
                                hasPlannedHours ? `${entry.completed_hours} / ${totalHours} год.` : `${entry.completed_hours} год. (Поза планом)`
                            ) : (
                                `${entry.completed_hours} акад. год.`
                            )}
                          </p>
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
          </>
        ) : null}
      </div>
    </main>
  );
}
