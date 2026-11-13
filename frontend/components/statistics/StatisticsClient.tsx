"use client";

import { useEffect, useMemo, useState } from "react";
import { DesktopSpotlightGrid } from "@/components/navigation/DesktopSpotlightGrid";
import { SubpageHeader } from "@/components/navigation/SubpageHeader";
import { RecentSelectionsChips } from "@/components/RecentSelectionsChips";
import { SearchableSelect } from "@/components/SearchableSelect";
import { InboxIcon, SearchIcon } from "@/components/ui/Icons";
import {
  api,
  type ReferenceRecord,
  type StatisticsResponse,
  type TeacherGroupDetail,
  type TeacherSubjectEntry,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { readCacheSnapshot, writeCacheSnapshot } from "@/lib/cacheSnapshot";
import { getProgressPercentage } from "@/lib/format";
import { resolveEffectiveScheduleMode } from "@/lib/navigation";
import { useMobileNav } from "@/lib/useMobileNav";
import { useRecentSelections } from "@/lib/useRecentSelections";

function formatDate(value: string) {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(parsed);
}

export function StatisticsClient() {
  const { user } = useAuth();
  const {
    urlSearch,
    setScheduleMode: setNavScheduleMode,
    setHideTasksTab,
  } = useMobileNav();
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

  const { recentGroupIds, recentTeacherIds, recordRecentGroup, recordRecentTeacher } =
    useRecentSelections();

  useEffect(() => {
    let active = true;
    const rawSearch = typeof window !== "undefined" ? window.location.search : "";
    const storedMode = window.localStorage.getItem("schedule:mode");
    const storedGroupId = Number(window.localStorage.getItem("schedule:groupId")) || null;
    const storedTeacherId = Number(window.localStorage.getItem("schedule:teacherId")) || null;

    const applyReferences = (allGroups: ReferenceRecord[], allTeachers: ReferenceRecord[]) => {
      const availableGroups =
        user?.role === "editor"
          ? allGroups.filter((group) => (user.allowed_groups || []).includes(group.id))
          : allGroups;
      const availableTeachers = user?.role === "editor" ? [] : allTeachers;
      const resolvedMode = resolveEffectiveScheduleMode(rawSearch, storedMode);
      const initialMode =
        resolvedMode === "teacher" && availableTeachers.length ? "teacher" : "student";

      setGroups(availableGroups);
      setTeachers(availableTeachers);
      setMode(initialMode);
      setNavScheduleMode(initialMode);
      setHideTasksTab(initialMode === "teacher");
      setGroupId((prev) =>
        prev && availableGroups.some((g) => g.id === prev)
          ? prev
          : storedGroupId && availableGroups.some((group) => group.id === storedGroupId)
          ? storedGroupId
          : availableGroups[0]?.id ?? null
      );
      setTeacherId((prev) =>
        prev && availableTeachers.some((t) => t.id === prev)
          ? prev
          : storedTeacherId && availableTeachers.some((teacher) => teacher.id === storedTeacherId)
          ? storedTeacherId
          : availableTeachers[0]?.id ?? null
      );
    };

    const cachedGroups = readCacheSnapshot<ReferenceRecord[]>("directory:groups")?.data;
    const cachedTeachers = readCacheSnapshot<ReferenceRecord[]>("directory:teachers")?.data;
    if (cachedGroups && cachedTeachers) {
      applyReferences(cachedGroups, cachedTeachers);
      setReferencesLoading(false);
    }

    Promise.all([api.groups(), api.directory.teachers()])
      .then(([allGroups, allTeachers]) => {
        if (!active) return;
        writeCacheSnapshot("directory:groups", allGroups);
        writeCacheSnapshot("directory:teachers", allTeachers);
        applyReferences(allGroups, allTeachers);
        setError(null);
      })
      .catch((loadError: unknown) => {
        if (active && !(cachedGroups && cachedTeachers)) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Не вдалося завантажити список груп і викладачів."
          );
        }
      })
      .finally(() => {
        if (active) setReferencesLoading(false);
      });

    return () => {
      active = false;
    };
  }, [user?.id, user?.role, setNavScheduleMode, setHideTasksTab]);

  useEffect(() => {
    if (!urlSearch || teachers.length === 0) return;
    const params = new URLSearchParams(urlSearch);
    const urlMode = params.get("mode");
    if (urlMode === "teacher" || urlMode === "student") {
      setMode(urlMode);
      setNavScheduleMode(urlMode);
      setHideTasksTab(urlMode === "teacher");
    }
  }, [urlSearch, teachers.length, setNavScheduleMode, setHideTasksTab]);

  useEffect(() => {
    if (referencesLoading) return;
    const targetId = mode === "student" ? groupId : teacherId;
    if (targetId === null) {
      setStats(null);
      setStatsLoading(false);
      return;
    }

    let active = true;
    const statsKey = `stats:${mode}:${targetId}`;
    const cachedStats = readCacheSnapshot<StatisticsResponse>(statsKey)?.data;
    if (cachedStats) {
      setStats(cachedStats);
      setStatsLoading(false);
    } else {
      setStatsLoading(true);
    }
    setError(null);

    const target = mode === "student" ? { groupId: targetId } : { teacherId: targetId };
    api
      .statistics(target)
      .then((response) => {
        if (!active) return;
        writeCacheSnapshot(statsKey, response);
        setStats(response);
      })
      .catch((loadError: unknown) => {
        if (active && !cachedStats) {
          setStats(null);
          setError(
            loadError instanceof Error ? loadError.message : "Не вдалося завантажити статистику."
          );
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
    [stats]
  );

  const hasAnyPlannedSubject = useMemo(
    () => displayedStudentEntries.some((entry) => (entry.planned_hours ?? 0) > 0),
    [displayedStudentEntries]
  );

  const teacherSubjects: TeacherSubjectEntry[] = useMemo(
    () => stats?.subjects ?? [],
    [stats]
  );

  const teacherGroups: TeacherGroupDetail[] = useMemo(() => {
    if (stats?.groups && stats.groups.length > 0) {
      return [...stats.groups].sort((a, b) => b.completed_hours - a.completed_hours);
    }
    return (stats?.entries ?? [])
      .map((e) => ({
        id: e.id,
        name: e.name,
        completed_hours: e.completed_hours,
        lessons_count: Math.round(e.completed_hours / 2),
        subject_names: e.subject_names ?? [],
      }))
      .sort((a, b) => b.completed_hours - a.completed_hours);
  }, [stats]);

  const maxStudentEntryHours = useMemo(
    () => Math.max(0, ...displayedStudentEntries.map((entry) => entry.completed_hours)),
    [displayedStudentEntries]
  );

  const maxTeacherSubjectHours = useMemo(
    () => Math.max(0, ...teacherSubjects.map((s) => s.completed_hours)),
    [teacherSubjects]
  );

  const maxTeacherGroupHours = useMemo(
    () => Math.max(0, ...teacherGroups.map((g) => g.completed_hours)),
    [teacherGroups]
  );

  const hasGlobalPlan = Boolean(stats?.planned_hours && stats.planned_hours > 0);

  const selectedName =
    mode === "student"
      ? groups.find((item) => item.id === groupId)?.name
      : teachers.find((item) => item.id === teacherId)?.name;

  const changeMode = (value: "student" | "teacher") => {
    setMode(value);
    window.localStorage.setItem("schedule:mode", value);
    setNavScheduleMode(value);
    setHideTasksTab(value === "teacher");
  };

  const changeGroup = (id: number | null) => {
    setGroupId(id);
    if (id !== null) {
      window.localStorage.setItem("schedule:groupId", String(id));
      recordRecentGroup(id);
    }
  };

  const changeTeacher = (id: number | null) => {
    setTeacherId(id);
    if (id !== null) {
      window.localStorage.setItem("schedule:teacherId", String(id));
      recordRecentTeacher(id);
    }
  };

  return (
    <div className="min-h-screen bg-sys-bg text-sys-text-primary">
      <SubpageHeader
        title="Статистика занять ДФКР"
        subtitle="Виконання навчального плану та навантаження"
        backHref="/"
        maxWidthClass="max-w-5xl"
      />

      <main
        id="main-content"
        tabIndex={-1}
        className="vt-main-content focus:outline-none mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6 sm:py-8 pb-24 lg:pb-8"
      >
        <section aria-label="Параметри статистики" className="flex flex-col gap-4">
          <div className="flex justify-center mb-2">
            <div
              role="group"
              aria-label="Режим перегляду статистики"
              className="inline-flex relative rounded-full bg-sys-elevated p-1 shadow-inner border border-sys-border"
            >
              {teachers.length > 0 && (
                <div
                  className="pointer-events-none absolute top-1 bottom-1 left-1 w-[calc(50%-4px)] bg-sys-accentSolid rounded-full transition-transform duration-base [transition-timing-function:var(--ease-spring-snappy)] transform-gpu z-0 shadow-sm"
                  style={{
                    transform:
                      mode === "student"
                        ? "translate3d(0, 0, 0)"
                        : "translate3d(100%, 0, 0)",
                  }}
                />
              )}
              <button
                type="button"
                onClick={() => changeMode("student")}
                className={`relative z-10 flex-1 w-32 rounded-full px-6 py-2 text-sm font-semibold transition-colors ${
                  mode === "student"
                    ? teachers.length === 0
                      ? "bg-sys-accent text-white"
                      : "text-sys-onAccent"
                    : "text-sys-text-secondary hover:text-sys-text-primary"
                }`}
              >
                Групам
              </button>
              {teachers.length > 0 && (
                <button
                  type="button"
                  onClick={() => changeMode("teacher")}
                  className={`relative z-10 flex-1 w-32 rounded-full px-6 py-2 text-sm font-semibold transition-colors ${
                    mode === "teacher"
                      ? "text-sys-onAccent"
                      : "text-sys-text-secondary hover:text-sys-text-primary"
                  }`}
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
              placeholder={mode === "student" ? "Знайти групу..." : "Знайти викладача..."}
              emptyLabel="Очистити вибір"
              leadingIcon={<SearchIcon className="h-4 w-4" />}
            />
            <RecentSelectionsChips
              mode={mode}
              currentId={mode === "student" ? groupId : teacherId}
              recentIds={mode === "student" ? recentGroupIds : recentTeacherIds}
              options={mode === "student" ? groups : teachers}
              onSelect={(id) => {
                if (mode === "student") changeGroup(id);
                else changeTeacher(id);
              }}
              className="mt-1"
            />
            {stats && (
              <p className="mt-3 text-center text-xs text-sys-text-muted">
                Розрахунок за: {formatDate(stats.semester_start)} — {formatDate(stats.through_date)}
                {" · "}1 пара = 2 акад. год
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
                <div
                  key={i}
                  className="h-24 rounded-2xl border border-sys-border/60 bg-sys-card/70 p-4 flex items-center gap-4"
                >
                  <div className="w-16 h-16 rounded-full bg-sys-elevated shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-3/4 rounded bg-sys-elevated" />
                    <div className="h-3 w-1/2 rounded bg-sys-surface" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : error ? (
          <div
            role="alert"
            className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-6 text-center text-rose-700 dark:text-rose-300"
          >
            {error}
          </div>
        ) : !selectedName ? (
          <div className="rounded-2xl border border-dashed border-sys-border p-10 text-center text-sys-text-secondary">
            {mode === "student"
              ? "Немає доступних груп для статистики."
              : "Немає доступних викладачів для статистики."}
          </div>
        ) : stats ? (
          <>
            <div className="flex flex-col items-center justify-center text-center mt-4 mb-2">
              <h2 className="text-2xl font-bold tracking-tight">{selectedName}</h2>
            </div>

            {mode === "student" ? (
              <DesktopSpotlightGrid className="grid gap-4 grid-cols-2 mt-4">
                <div
                  style={{ "--stagger-index": 0 } as React.CSSProperties}
                  className="interactive-surface desktop-stagger-card rounded-2xl border border-sys-border bg-sys-card p-5 text-center flex flex-col justify-center items-center"
                >
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
                  <div
                    style={{ "--stagger-index": 1 } as React.CSSProperties}
                    className="interactive-surface desktop-stagger-card rounded-2xl border border-sys-border bg-sys-card p-5 text-center flex flex-col justify-center items-center"
                  >
                    <p className="text-xs font-semibold uppercase tracking-wider text-sys-text-secondary">
                      Всього за планом
                    </p>
                    <p className="mt-2 text-4xl font-black text-sys-text-primary">
                      {stats.planned_hours}
                    </p>
                    <p className="mt-1 text-xs text-sys-text-muted">
                      Виконано{" "}
                      {Math.min(100, Math.round((stats.total_hours / stats.planned_hours!) * 100))}%
                      {" · "}Залишилось {Math.max(0, stats.planned_hours! - stats.total_hours)} год (
                      {Math.round(Math.max(0, stats.planned_hours! - stats.total_hours) / 2)} пар)
                    </p>
                  </div>
                ) : (
                  <div
                    style={{ "--stagger-index": 1 } as React.CSSProperties}
                    className="interactive-surface desktop-stagger-card rounded-2xl border border-sys-border bg-sys-card p-5 text-center flex flex-col justify-center items-center"
                  >
                    <p className="text-xs font-semibold uppercase tracking-wider text-sys-text-secondary">
                      Дисциплін
                    </p>
                    <p className="mt-2 text-4xl font-black text-sys-text-primary">
                      {stats.entries.length}
                    </p>
                    <p className="mt-1 text-xs text-sys-text-muted">у поточному семестрі</p>
                  </div>
                )}
              </DesktopSpotlightGrid>
            ) : (
              <DesktopSpotlightGrid className="grid gap-4 grid-cols-2 mt-4">
                <div
                  style={{ "--stagger-index": 0 } as React.CSSProperties}
                  className="interactive-surface desktop-stagger-card rounded-2xl border border-sys-border bg-sys-card p-5 text-center flex flex-col justify-center items-center"
                >
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
                  <div
                    style={{ "--stagger-index": 1 } as React.CSSProperties}
                    className="interactive-surface desktop-stagger-card rounded-2xl border border-sys-border bg-sys-card p-5 text-center flex flex-col justify-center items-center"
                  >
                    <p className="text-xs font-semibold uppercase tracking-wider text-sys-text-secondary">
                      Семестровий план
                    </p>
                    <p className="mt-2 text-4xl font-black text-sys-text-primary">
                      {stats.planned_hours}
                    </p>
                    <p className="mt-1 text-xs text-sys-text-muted">
                      Виконано{" "}
                      {Math.min(100, Math.round((stats.total_hours / stats.planned_hours!) * 100))}%
                      {" · "}Залишилось {Math.max(0, stats.planned_hours! - stats.total_hours)} год
                    </p>
                  </div>
                ) : stats.weekly_hours ? (
                  <div
                    style={{ "--stagger-index": 1 } as React.CSSProperties}
                    className="interactive-surface desktop-stagger-card rounded-2xl border border-sys-border bg-sys-card p-5 text-center flex flex-col justify-center items-center"
                  >
                    <p className="text-xs font-semibold uppercase tracking-wider text-sys-text-secondary">
                      Тижневе навантаження
                    </p>
                    <p className="mt-2 text-4xl font-black text-sys-text-primary">
                      {stats.weekly_hours}
                    </p>
                    <p className="mt-1 text-xs text-sys-text-muted">
                      акад. год/тиждень · {Math.round(stats.weekly_hours / 2)} пар
                    </p>
                  </div>
                ) : (
                  <div
                    style={{ "--stagger-index": 1 } as React.CSSProperties}
                    className="interactive-surface desktop-stagger-card rounded-2xl border border-sys-border bg-sys-card p-5 text-center flex flex-col justify-center items-center"
                  >
                    <p className="text-xs font-semibold uppercase tracking-wider text-sys-text-secondary">
                      Активних груп
                    </p>
                    <p className="mt-2 text-4xl font-black text-sys-text-primary">
                      {teacherGroups.length}
                    </p>
                    <p className="mt-1 text-xs text-sys-text-muted">
                      {teacherSubjects.length} дисциплін
                    </p>
                  </div>
                )}
              </DesktopSpotlightGrid>
            )}

            {mode === "student" ? (
              <section className="mt-4">
                <h2 className="mb-4 text-xl font-bold px-1">Розподіл за предметами</h2>
                {displayedStudentEntries.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-sys-border bg-sys-card/50 p-8 text-center">
                    <InboxIcon className="mx-auto h-7 w-7 text-sys-text-muted" />
                    <p className="mt-2.5 text-sm text-sys-text-secondary">
                      Поки що немає даних для відображення.
                    </p>
                  </div>
                ) : (
                  <DesktopSpotlightGrid className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                    {displayedStudentEntries.map((entry, idx) => {
                      const totalHours = entry.planned_hours ?? 0;
                      const hasPlannedHours = totalHours > 0;
                      const isUnplanned = !hasPlannedHours && hasAnyPlannedSubject;
                      const relativePercent =
                        maxStudentEntryHours > 0
                          ? Math.round((entry.completed_hours / maxStudentEntryHours) * 100)
                          : 0;
                      const progress = hasPlannedHours
                        ? getProgressPercentage(entry.completed_hours, totalHours)
                        : relativePercent;
                      const clampedProgress = Math.min(100, Math.max(0, progress));

                      const circumference = 2 * Math.PI * 20;
                      const strokeDashoffset =
                        circumference - (clampedProgress / 100) * circumference;

                      const colorClass = hasPlannedHours
                        ? progress >= 100
                          ? "text-emerald-600 dark:text-emerald-400"
                          : progress >= 50
                          ? "text-purple-600 dark:text-purple-400"
                          : "text-blue-600 dark:text-blue-400"
                        : "text-sys-accent";

                      return (
                        <div
                          key={entry.id}
                          style={{ "--stagger-index": idx } as React.CSSProperties}
                          className={`interactive-surface ${
                            idx < 6 ? "desktop-stagger-card" : "scroll-reveal-card"
                          } rounded-2xl border border-sys-border bg-sys-card p-4 flex items-center gap-4 hover:bg-sys-elevated/60 hover:border-sys-accent/40`}
                        >
                          <div className="relative w-16 h-16 shrink-0 flex items-center justify-center">
                            <svg
                              className="w-full h-full transform -rotate-90"
                              viewBox="0 0 48 48"
                              aria-hidden="true"
                            >
                              <circle
                                cx="24"
                                cy="24"
                                r="20"
                                stroke="currentColor"
                                strokeWidth="4"
                                fill="none"
                                className="text-sys-border"
                              />
                              <circle
                                cx="24"
                                cy="24"
                                r="20"
                                stroke="currentColor"
                                strokeWidth="4"
                                fill="none"
                                strokeDasharray={circumference}
                                style={{ strokeDashoffset }}
                                className={`${colorClass} transition-[stroke-dashoffset] duration-700 ease-out`}
                                strokeLinecap="round"
                              />
                            </svg>
                            <span className="absolute text-xs font-bold text-sys-text-primary">
                              {hasPlannedHours
                                ? `${Math.round(clampedProgress)}%`
                                : `${entry.completed_hours}г`}
                            </span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <h3
                              className="line-clamp-2 leading-snug font-semibold text-sm mb-1 text-sys-text-primary"
                              title={entry.name}
                            >
                              {entry.name}
                            </h3>
                            <p className="text-xs text-sys-text-secondary">
                              {hasPlannedHours
                                ? `${entry.completed_hours} з ${totalHours} акад. год · ${Math.round(entry.completed_hours / 2)} пар`
                                : `${entry.completed_hours} акад. год · ${Math.round(entry.completed_hours / 2)} пар`}
                            </p>
                            {(isUnplanned ||
                              Boolean(entry.replaced_count) ||
                              Boolean(entry.cancelled_count)) && (
                              <div className="mt-1.5 flex flex-wrap gap-1.5 text-xs">
                                {isUnplanned && (
                                  <span className="rounded border border-sys-border bg-sys-bg-secondary px-1.5 py-0.5 text-sys-text-secondary font-medium">
                                    Поза планом
                                  </span>
                                )}
                                {Boolean(entry.replaced_count) && (
                                  <span className="rounded border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-amber-800 dark:text-amber-300 font-medium">
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
                  </DesktopSpotlightGrid>
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
                      {teacherView === "subjects"
                        ? "Розподіл за дисциплінами"
                        : "Розподіл за групами"}
                    </h2>
                    <p className="text-xs text-sys-text-muted mt-0.5">
                      {teacherView === "subjects"
                        ? `${teacherSubjects.length} дисциплін закріплено в розкладі`
                        : `${teacherGroups.length} активних груп у поточному семестрі`}
                    </p>
                  </div>
                  <div
                    role="group"
                    aria-label="Групування статистики викладача"
                    className="inline-flex rounded-xl bg-sys-elevated p-1 border border-sys-border text-xs font-medium self-start sm:self-auto"
                  >
                    <button
                      type="button"
                      onClick={() => setTeacherView("subjects")}
                      className={`rounded-lg px-3.5 py-1.5 transition-colors ${
                        teacherView === "subjects"
                          ? "bg-sys-accentSolid text-sys-onAccent font-semibold shadow-sm"
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
                          ? "bg-sys-accentSolid text-sys-onAccent font-semibold shadow-sm"
                          : "text-sys-text-secondary hover:text-sys-text-primary"
                      }`}
                    >
                      За групами ({teacherGroups.length})
                    </button>
                  </div>
                </div>

                {teacherView === "subjects" ? (
                  teacherSubjects.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-sys-border bg-sys-card/50 p-8 text-center">
                      <InboxIcon className="mx-auto h-7 w-7 text-sys-text-muted" />
                      <p className="mt-2.5 text-sm text-sys-text-secondary">
                        Поки що немає даних за дисциплінами.
                      </p>
                    </div>
                  ) : (
                    <DesktopSpotlightGrid className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                      {teacherSubjects.map((subj, idx) => {
                        const relativePercent =
                          maxTeacherSubjectHours > 0
                            ? Math.round((subj.completed_hours / maxTeacherSubjectHours) * 100)
                            : 0;
                        const clampedProgress = Math.min(100, Math.max(0, relativePercent));
                        const circumference = 2 * Math.PI * 20;
                        const strokeDashoffset =
                          circumference - (clampedProgress / 100) * circumference;

                        return (
                          <div
                            key={subj.id}
                            style={{ "--stagger-index": idx } as React.CSSProperties}
                            className={`interactive-surface ${
                              idx < 6 ? "desktop-stagger-card" : "scroll-reveal-card"
                            } rounded-2xl border border-sys-border bg-sys-card p-4 flex items-center gap-4 hover:bg-sys-elevated/60 hover:border-sys-accent/40`}
                          >
                            <div className="relative w-16 h-16 shrink-0 flex items-center justify-center">
                              <svg
                                className="w-full h-full transform -rotate-90"
                                viewBox="0 0 48 48"
                                aria-hidden="true"
                              >
                                <circle
                                  cx="24"
                                  cy="24"
                                  r="20"
                                  stroke="currentColor"
                                  strokeWidth="4"
                                  fill="none"
                                  className="text-sys-border"
                                />
                                <circle
                                  cx="24"
                                  cy="24"
                                  r="20"
                                  stroke="currentColor"
                                  strokeWidth="4"
                                  fill="none"
                                  strokeDasharray={circumference}
                                  style={{ strokeDashoffset }}
                                  className="text-sys-accent transition-[stroke-dashoffset] duration-700 ease-out"
                                  strokeLinecap="round"
                                />
                              </svg>
                              <span className="absolute text-xs font-bold text-sys-text-primary">
                                {subj.completed_hours}г
                              </span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <h3
                                className="line-clamp-2 leading-snug font-semibold text-sm mb-1 text-sys-text-primary"
                                title={subj.name}
                              >
                                {subj.name}
                              </h3>
                              <p className="text-xs text-sys-text-secondary mb-1.5">
                                {subj.completed_hours} акад. год · {subj.lessons_count} пар
                              </p>
                              {subj.groups.length > 0 && (
                                <div className="flex flex-wrap gap-1 items-center">
                                  <span className="text-[11px] text-sys-text-muted mr-0.5">
                                    Групи:
                                  </span>
                                  {subj.groups.map((grp) => (
                                    <span
                                      key={grp}
                                      className="rounded bg-sys-elevated border border-sys-border px-1.5 py-0.5 text-[11px] font-medium text-sys-text-secondary"
                                    >
                                      {grp}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </DesktopSpotlightGrid>
                  )
                ) : teacherGroups.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-sys-border bg-sys-card/50 p-8 text-center">
                    <InboxIcon className="mx-auto h-7 w-7 text-sys-text-muted" />
                    <p className="mt-2.5 text-sm text-sys-text-secondary">
                      Поки що немає даних за групами.
                    </p>
                  </div>
                ) : (
                  <DesktopSpotlightGrid className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                    {teacherGroups.map((grp, idx) => {
                      const relativePercent =
                        maxTeacherGroupHours > 0
                          ? Math.round((grp.completed_hours / maxTeacherGroupHours) * 100)
                          : 0;
                      const clampedProgress = Math.min(100, Math.max(0, relativePercent));
                      const circumference = 2 * Math.PI * 20;
                      const strokeDashoffset =
                        circumference - (clampedProgress / 100) * circumference;

                      return (
                        <div
                          key={grp.id}
                          style={{ "--stagger-index": idx } as React.CSSProperties}
                          className={`interactive-surface ${
                            idx < 6 ? "desktop-stagger-card" : "scroll-reveal-card"
                          } rounded-2xl border border-sys-border bg-sys-card p-4 flex items-center gap-4 hover:bg-sys-elevated/60 hover:border-sys-accent/40`}
                        >
                          <div className="relative w-16 h-16 shrink-0 flex items-center justify-center">
                            <svg
                              className="w-full h-full transform -rotate-90"
                              viewBox="0 0 48 48"
                              aria-hidden="true"
                            >
                              <circle
                                cx="24"
                                cy="24"
                                r="20"
                                stroke="currentColor"
                                strokeWidth="4"
                                fill="none"
                                className="text-sys-border"
                              />
                              <circle
                                cx="24"
                                cy="24"
                                r="20"
                                stroke="currentColor"
                                strokeWidth="4"
                                fill="none"
                                strokeDasharray={circumference}
                                style={{ strokeDashoffset }}
                                className="text-sys-accent transition-[stroke-dashoffset] duration-700 ease-out"
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
                  </DesktopSpotlightGrid>
                )}
              </section>
            )}
          </>
        ) : null}
      </main>
    </div>
  );
}
