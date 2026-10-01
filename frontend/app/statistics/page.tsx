"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { SearchableSelect } from "../../components/SearchableSelect";
import { api, ReferenceRecord, StatisticsResponse } from "../../lib/api";
import { useAuth } from "../../lib/auth";

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

  const maxGroupHours = useMemo(
    () => Math.max(0, ...(stats?.entries.map((entry) => entry.completed_hours) ?? [])),
    [stats],
  );

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
        <section className="rounded-2xl border border-sys-border bg-sys-card p-4 sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="mb-2 text-sm text-sys-text-secondary">Показати статистику для</p>
              <div role="group" aria-label="Тип статистики" className="inline-flex rounded-lg border border-sys-border bg-sys-bg p-1">
                <button
                  type="button"
                  aria-pressed={mode === "student"}
                  onClick={() => changeMode("student")}
                  className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${mode === "student" ? "bg-sys-accent/10 text-sys-accent" : "text-sys-text-secondary hover:text-sys-text-primary"}`}
                >
                  Для групи
                </button>
                {teachers.length > 0 && (
                  <button
                    type="button"
                    aria-pressed={mode === "teacher"}
                    onClick={() => changeMode("teacher")}
                    className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${mode === "teacher" ? "bg-sys-accent/10 text-sys-accent" : "text-sys-text-secondary hover:text-sys-text-primary"}`}
                  >
                    Для викладача
                  </button>
                )}
              </div>
            </div>
            <label className="w-full sm:max-w-xs">
              <span className="mb-1 block text-xs font-medium text-sys-text-muted">
                {mode === "student" ? "Навчальна група" : "Викладач"}
              </span>
              <SearchableSelect
                options={mode === "student" ? groups : teachers}
                value={mode === "student" ? groupId : teacherId}
                onChange={mode === "student" ? changeGroup : changeTeacher}
                ariaLabel={mode === "student" ? "Обрати групу" : "Обрати викладача"}
                placeholder={mode === "student" ? "Оберіть групу" : "Оберіть викладача"}
                emptyLabel="Очистити вибір"
              />
            </label>
          </div>
          {stats && (
            <p className="mt-4 text-xs text-sys-text-muted">
              Розрахунок за розкладом: {formatDate(stats.semester_start)} — {formatDate(stats.through_date)}. Одна пара — 2 академічні години.
            </p>
          )}
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
            <section className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-sys-border bg-sys-card p-5">
                <p className="text-sm text-sys-text-secondary">
                  {mode === "student" ? "Вивчено за розкладом" : "Проведено за розкладом"}
                </p>
                <p className="mt-2 text-3xl font-bold text-sys-accent">
                  {stats.total_hours} <span className="text-base font-medium text-sys-text-secondary">акад. год.</span>
                </p>
                <p className="mt-1 text-sm text-sys-text-muted">{selectedName}</p>
              </div>
              {mode === "student" ? (
                <div className="rounded-2xl border border-sys-border bg-sys-card p-5">
                  <p className="text-sm text-sys-text-secondary">Від загального навантаження</p>
                  <p className="mt-2 text-3xl font-bold text-sys-text-primary">
                    {stats.planned_hours ?? 0} <span className="text-base font-medium text-sys-text-secondary">акад. год.</span>
                  </p>
                  <p className="mt-1 text-sm text-sys-text-muted">за навчальним планом</p>
                </div>
              ) : (
                <div className="rounded-2xl border border-sys-border bg-sys-card p-5">
                  <p className="text-sm text-sys-text-secondary">Групи в розкладі</p>
                  <p className="mt-2 text-3xl font-bold text-sys-text-primary">{stats.entries.length}</p>
                  <p className="mt-1 text-sm text-sys-text-muted">за поточний семестр</p>
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-sys-border bg-sys-card p-5 sm:p-6">
              <div className="mb-5">
                <h2 className="text-lg font-semibold">
                  {mode === "student" ? "Години за предметами" : "Години за групами"}
                </h2>
                <p className="mt-1 text-sm text-sys-text-secondary">
                  {mode === "student"
                    ? "Прогрес порівнюється із загальною кількістю годин у навчальному навантаженні."
                    : "Смуги показують відносний обсяг годин між групами."}
                </p>
              </div>
              {stats.entries.length === 0 ? (
                <p className="rounded-xl border border-dashed border-sys-border p-8 text-center text-sm text-sys-text-secondary">
                  Для цього періоду даних про навантаження немає.
                </p>
              ) : (
                <div className="space-y-5">
                  {stats.entries.map((entry) => {
                    const progress = entry.progress_percent ?? 0;
                    const barWidth = mode === "student"
                      ? Math.min(100, Math.max(0, progress))
                      : maxGroupHours > 0 ? entry.completed_hours * 100 / maxGroupHours : 0;
                    const barMaximum = mode === "student"
                      ? entry.planned_hours || 1
                      : maxGroupHours || 1;
                    return (
                      <div key={entry.id}>
                        <div className="mb-2 flex items-baseline justify-between gap-3">
                          <h3 className="min-w-0 truncate text-sm font-medium">{entry.name}</h3>
                          <p className="shrink-0 text-sm font-semibold text-sys-text-primary">
                            {entry.completed_hours}
                            {mode === "student" ? ` / ${entry.planned_hours ?? 0}` : ""}
                            <span className="ml-1 text-xs font-normal text-sys-text-muted">год.</span>
                          </p>
                        </div>
                        <div
                          role={mode === "student" && !entry.planned_hours ? undefined : "progressbar"}
                          aria-label={`${entry.name}: ${entry.completed_hours}${mode === "student" ? ` з ${entry.planned_hours ?? 0}` : ""} академічних годин`}
                          aria-valuemin={0}
                          aria-valuemax={barMaximum}
                          aria-valuenow={Math.min(entry.completed_hours, barMaximum)}
                          className="h-2.5 overflow-hidden rounded-full bg-sys-bg"
                        >
                          <div
                            className={`h-full rounded-full transition-[width] duration-500 ${mode === "student" ? "bg-sys-accent" : "bg-emerald-400"}`}
                            style={{ width: `${barWidth}%` }}
                          />
                        </div>
                        {mode === "student" && (
                          <p className="mt-1 text-right text-xs text-sys-text-muted">
                            {entry.planned_hours
                              ? `${Math.round(progress)}%${progress > 100 ? " — план перевищено" : ""}`
                              : "Загальне навантаження не задано"}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              <p className="mt-6 border-t border-sys-border pt-4 text-xs text-sys-text-muted">
                Значення розраховані за розкладом і не враховують фактичну присутність на заняттях.
              </p>
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}
