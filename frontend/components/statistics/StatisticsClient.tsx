"use client";

import { useEffect, useMemo, useState } from "react";
import { DesktopSpotlightGrid } from "@/components/navigation/DesktopSpotlightGrid";
import { SubpageHeader } from "@/components/navigation/SubpageHeader";
import { RecentSelectionsChips } from "@/components/RecentSelectionsChips";
import { SearchableSelect } from "@/components/SearchableSelect";
import { CloseIcon, InboxIcon, SearchIcon } from "@/components/ui/Icons";
import {
  api,
  type ReferenceRecord,
  type StatisticsResponse,
  type TeacherGroupDetail,
  type TeacherSubjectEntry,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { readCacheSnapshot, writeCacheSnapshot } from "@/lib/cacheSnapshot";
import { UKR_UTC_FULL_DATE_FMT } from "@/lib/date";
import { pluralizeUk } from "@/lib/educationalProcess";
import { calculateWeekNumber, getProgressPercentage } from "@/lib/format";
import { resolveEffectiveScheduleMode } from "@/lib/navigation";
import {
  evaluateTeacherPlanStatus,
  filterAndSortStudentEntries,
  formatPairsFromHours,
  normalizeDisplaySemesterStart,
  sortTeacherItems,
  summarizeStudentStatistics,
  type StudentFilterMode,
  type StudentSortMode,
  type TeacherSortMode,
} from "@/lib/statistics";
import { useMobileNav } from "@/lib/useMobileNav";
import { useRecentSelections } from "@/lib/useRecentSelections";

function formatDate(value: string) {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return UKR_UTC_FULL_DATE_FMT.format(parsed);
}

const SEGMENT_PALETTE = [
  { bar: "bg-sky-500", dot: "bg-sky-500" },
  { bar: "bg-indigo-500", dot: "bg-indigo-500" },
  { bar: "bg-emerald-500", dot: "bg-emerald-500" },
  { bar: "bg-amber-500", dot: "bg-amber-500" },
  { bar: "bg-purple-500", dot: "bg-purple-500" },
  { bar: "bg-rose-500", dot: "bg-rose-500" },
  { bar: "bg-teal-500", dot: "bg-teal-500" },
  { bar: "bg-cyan-500", dot: "bg-cyan-500" },
] as const;

interface DistributionSegment {
  id: number;
  label: string;
  hours: number;
  sharePercent: number;
  plannedHours: number | null;
  colorIdx: number;
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
  const [studentSort, setStudentSort] = useState<StudentSortMode>("hours");
  const [studentFilter, setStudentFilter] = useState<StudentFilterMode>("all");
  const [teacherSort, setTeacherSort] = useState<TeacherSortMode>("hours");
  const [itemSearch, setItemSearch] = useState("");
  const [activeSegmentIdx, setActiveSegmentIdx] = useState<number | null>(null);
  const [reorderStatusText, setReorderStatusText] = useState("");

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
    setActiveSegmentIdx(null);
    setStudentFilter("all");
    setItemSearch("");
  }, [mode, groupId, teacherId, teacherView]);

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

  const rawStudentEntries = useMemo(() => stats?.entries ?? [], [stats]);

  const studentSummary = useMemo(
    () => (stats ? summarizeStudentStatistics(stats) : null),
    [stats]
  );

  const displayedStudentEntries = useMemo(
    () =>
      filterAndSortStudentEntries(
        rawStudentEntries,
        studentFilter,
        studentSort,
        itemSearch
      ),
    [rawStudentEntries, studentFilter, studentSort, itemSearch]
  );

  const hasAnyPlannedSubject = useMemo(
    () => rawStudentEntries.some((entry) => (entry.planned_hours ?? 0) > 0),
    [rawStudentEntries]
  );

  const rawTeacherSubjects: TeacherSubjectEntry[] = useMemo(
    () => stats?.subjects ?? [],
    [stats]
  );

  const rawTeacherGroups: TeacherGroupDetail[] = useMemo(() => {
    if (stats?.groups && stats.groups.length > 0) {
      return stats.groups;
    }
    return (stats?.entries ?? []).map((e) => ({
      id: e.id,
      name: e.name,
      completed_hours: e.completed_hours,
      lessons_count: Math.round(e.completed_hours / 2),
      subject_names: e.subject_names ?? [],
    }));
  }, [stats]);

  const teacherSubjects = useMemo(
    () => sortTeacherItems(rawTeacherSubjects, teacherSort, itemSearch),
    [rawTeacherSubjects, teacherSort, itemSearch]
  );

  const teacherGroups = useMemo(
    () => sortTeacherItems(rawTeacherGroups, teacherSort, itemSearch),
    [rawTeacherGroups, teacherSort, itemSearch]
  );

  const teacherPlanStatus = useMemo(
    () =>
      stats
        ? evaluateTeacherPlanStatus(
            stats.total_hours,
            stats.planned_hours,
            rawTeacherSubjects
          )
        : null,
    [stats, rawTeacherSubjects]
  );

  const maxStudentEntryHours = useMemo(
    () => Math.max(0, ...rawStudentEntries.map((entry) => entry.completed_hours)),
    [rawStudentEntries]
  );

  const maxTeacherSubjectHours = useMemo(
    () => Math.max(0, ...rawTeacherSubjects.map((s) => s.completed_hours)),
    [rawTeacherSubjects]
  );

  const maxTeacherGroupHours = useMemo(
    () => Math.max(0, ...rawTeacherGroups.map((g) => g.completed_hours)),
    [rawTeacherGroups]
  );

  const currentWeekNumber = useMemo(() => {
    if (!stats?.semester_start || !stats?.through_date) return null;
    const throughDateObj = new Date(`${stats.through_date}T12:00:00Z`);
    if (Number.isNaN(throughDateObj.getTime())) return null;
    return calculateWeekNumber(throughDateObj, stats.semester_start);
  }, [stats?.semester_start, stats?.through_date]);

  const distributionSegments = useMemo<DistributionSegment[]>(() => {
    if (!stats) return [];
    const sourceItems =
      mode === "student"
        ? [...rawStudentEntries]
            .filter((e) => e.completed_hours > 0)
            .sort((a, b) => b.completed_hours - a.completed_hours)
            .map((e) => ({
              id: e.id,
              label: e.name,
              hours: e.completed_hours,
              plannedHours: e.planned_hours && e.planned_hours > 0 ? e.planned_hours : null,
            }))
        : teacherView === "subjects"
        ? [...rawTeacherSubjects]
            .filter((s) => s.completed_hours > 0)
            .sort((a, b) => b.completed_hours - a.completed_hours)
            .map((s) => ({
              id: s.id,
              label: s.name,
              hours: s.completed_hours,
              plannedHours: s.planned_hours && s.planned_hours > 0 ? s.planned_hours : null,
            }))
        : [...rawTeacherGroups]
            .filter((g) => g.completed_hours > 0)
            .sort((a, b) => b.completed_hours - a.completed_hours)
            .map((g) => ({
              id: g.id,
              label: `Група ${g.name}`,
              hours: g.completed_hours,
              plannedHours: null,
            }));

    const sumHours = sourceItems.reduce((acc, item) => acc + item.hours, 0);
    if (sumHours <= 0) return [];

    return sourceItems.map((item, idx) => ({
      ...item,
      sharePercent: Math.max(1, Math.round((item.hours / sumHours) * 100)),
      colorIdx: idx % SEGMENT_PALETTE.length,
    }));
  }, [stats, mode, teacherView, rawStudentEntries, rawTeacherSubjects, rawTeacherGroups]);

  const inspectedSegment =
    distributionSegments.length > 0
      ? distributionSegments[activeSegmentIdx ?? 0] ?? distributionSegments[0]
      : null;

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

  const handleStudentSortChange = (nextSort: StudentSortMode) => {
    setStudentSort(nextSort);
    const sortLabel =
      nextSort === "hours"
        ? "за кількістю годин"
        : nextSort === "progress"
        ? "за відсотком виконання плану"
        : "за алфавітом";
    setReorderStatusText(
      `Відсортовано ${sortLabel}, показано ${displayedStudentEntries.length} предметів`
    );
  };

  const handleTeacherSortChange = (nextSort: TeacherSortMode) => {
    setTeacherSort(nextSort);
    const sortLabel = nextSort === "hours" ? "за кількістю годин" : "за назвою";
    const count = teacherView === "subjects" ? teacherSubjects.length : teacherGroups.length;
    setReorderStatusText(`Відсортовано ${sortLabel}, показано ${count} позицій`);
  };

  return (
    <div className="min-h-screen bg-sys-bg text-sys-text-primary">
      <SubpageHeader
        title="Статистика занять ДФКР"
        subtitle="Виконання навчального плану та навантаження"
        backHref="/"
        maxWidthClass="max-w-5xl"
        rightSlot={
          selectedName ? (
            <span className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-sys-border bg-sys-bg px-2.5 text-xs font-semibold text-sys-text-primary max-w-[220px] truncate">
              <span className="h-1.5 w-1.5 rounded-full bg-sys-accent shrink-0" />
              <span className="truncate">
                {mode === "student" ? `Група ${selectedName}` : selectedName}
              </span>
            </span>
          ) : undefined
        }
      />

      <main
        id="main-content"
        tabIndex={-1}
        className="vt-main-content focus:outline-none mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6 sm:py-8 pb-bottom-nav-safe lg:pb-8"
      >
        <p role="status" className="sr-only">
          {reorderStatusText}
        </p>

        <section aria-label="Параметри статистики" className="flex flex-col gap-4">
          <div className="flex justify-center mb-1">
            <div
              role="group"
              aria-label="Режим перегляду статистики"
              style={
                {
                  "--seg-cols": teachers.length > 0 ? 2 : 1,
                  "--seg-index": mode === "teacher" ? 1 : 0,
                } as React.CSSProperties
              }
              className={`ui-seg-full inline-grid items-stretch ${
                teachers.length > 0 ? "grid-cols-2" : "grid-cols-1"
              } relative bg-sys-elevated shadow-inner border border-sys-border isolate select-none`}
            >
              {teachers.length > 0 && (
                <div
                  aria-hidden="true"
                  className="ui-seg-slider pointer-events-none bg-sys-accentSolid transition-transform duration-base [transition-timing-function:var(--ease-spring-snappy)] transform-gpu z-0 shadow-sm"
                />
              )}
              <button
                type="button"
                aria-pressed={mode === "student"}
                onClick={() => changeMode("student")}
                className={`ui-seg-pill relative z-10 flex items-center justify-center min-w-[7rem] sm:min-w-[8rem] px-4 sm:px-6 py-2 text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap ${
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
                  aria-pressed={mode === "teacher"}
                  onClick={() => changeMode("teacher")}
                  className={`ui-seg-pill relative z-10 flex items-center justify-center min-w-[7rem] sm:min-w-[8rem] px-4 sm:px-6 py-2 text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap ${
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
                Розрахунок за:{" "}
                {formatDate(normalizeDisplaySemesterStart(stats.semester_start))} —{" "}
                {formatDate(stats.through_date)}
                {currentWeekNumber ? ` · ${currentWeekNumber}-й тиждень` : ""}
                {" · "}1 пара = 2 акад. год
              </p>
            )}
          </div>
        </section>

        {referencesLoading || statsLoading ? (
          <div role="status" className="space-y-4 animate-pulse">
            <span className="sr-only">Завантаження статистики…</span>
            <div aria-hidden="true" className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="h-28 rounded-2xl border border-sys-border/60 bg-sys-card/70" />
              <div className="h-28 rounded-2xl border border-sys-border/60 bg-sys-card/70" />
              <div className="h-28 rounded-2xl border border-sys-border/60 bg-sys-card/70" />
            </div>
            <div aria-hidden="true" className="h-24 rounded-2xl border border-sys-border/60 bg-sys-card/70" />
            <div aria-hidden="true" className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
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
            <h2 className="sr-only">{selectedName}</h2>

            {/* 3-Card KPI Overview Strip */}
            {mode === "student" && studentSummary ? (
              <DesktopSpotlightGrid
                aria-label="Основні показники групи"
                className="grid grid-cols-1 sm:grid-cols-3 gap-3"
              >
                <div
                  style={{ "--stagger-index": 0 } as React.CSSProperties}
                  className="interactive-surface desktop-stagger-card rounded-2xl border border-sys-border bg-sys-card p-4 shadow-xs flex flex-col justify-between space-y-2"
                >
                  <div className="flex items-center justify-between text-xs text-sys-text-secondary">
                    <span className="font-medium">Вивчено за семестр</span>
                    <span className="rounded-full bg-sys-accent-subtle px-2 py-0.5 text-[11px] font-bold text-sys-accent">
                      {formatPairsFromHours(stats.total_hours)} пар
                    </span>
                  </div>
                  <div>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-3xl font-black text-sys-accent tracking-tight">
                        {stats.total_hours}
                      </span>
                      <span className="text-xs font-semibold text-sys-text-secondary">
                        акад. год
                      </span>
                    </div>
                    <p className="text-xs text-sys-text-muted mt-1">
                      {studentSummary.unplannedCompletedHours > 0
                        ? `За планом: ${studentSummary.plannedCompletedHours} год · Поза планом: ${studentSummary.unplannedCompletedHours} год`
                        : `${pluralizeUk(rawStudentEntries.length, ["дисципліна", "дисципліни", "дисциплін"])} у розкладі`}
                    </p>
                  </div>
                </div>

                {studentSummary.plannedTotalHours > 0 && studentSummary.planCompletionPercent !== null ? (
                  <div
                    style={{ "--stagger-index": 1 } as React.CSSProperties}
                    className="interactive-surface desktop-stagger-card rounded-2xl border border-sys-border bg-sys-card p-4 shadow-xs flex flex-col justify-between space-y-2"
                  >
                    <div className="flex items-center justify-between text-xs text-sys-text-secondary">
                      <span className="font-medium">Виконання плану</span>
                      <span className="text-[11px] font-bold text-sys-text-primary">
                        {studentSummary.plannedCompletedHours} із {studentSummary.plannedTotalHours} год
                      </span>
                    </div>
                    <div>
                      <div className="flex items-baseline justify-between mb-1.5">
                        <span className="text-2xl font-black text-sys-text-primary tracking-tight">
                          {studentSummary.planCompletionPercent}%
                        </span>
                        <span className="text-xs text-sys-text-muted">
                          залишилось {studentSummary.remainingPlannedHours} год (
                          {formatPairsFromHours(studentSummary.remainingPlannedHours)} пар)
                        </span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-sys-bg border border-sys-border/70 overflow-hidden">
                        <div
                          className="h-full bg-sys-accent rounded-full transition-[width] duration-500 ease-out"
                          style={{
                            width: `${Math.min(100, Math.max(0, studentSummary.planCompletionPercent))}%`,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div
                    style={{ "--stagger-index": 1 } as React.CSSProperties}
                    className="interactive-surface desktop-stagger-card rounded-2xl border border-sys-border bg-sys-card p-4 shadow-xs flex flex-col justify-between space-y-2"
                  >
                    <div className="flex items-center justify-between text-xs text-sys-text-secondary">
                      <span className="font-medium">Дисциплін у семестрі</span>
                    </div>
                    <div>
                      <span className="text-3xl font-black text-sys-text-primary tracking-tight">
                        {rawStudentEntries.length}
                      </span>
                      <p className="text-xs text-sys-text-muted mt-1">
                        активних предметів у розкладі
                      </p>
                    </div>
                  </div>
                )}

                <div
                  style={{ "--stagger-index": 2 } as React.CSSProperties}
                  className="interactive-surface desktop-stagger-card rounded-2xl border border-sys-border bg-sys-card p-4 shadow-xs flex flex-col justify-between space-y-2"
                >
                  <div className="flex items-center justify-between text-xs text-sys-text-secondary">
                    <span className="font-medium">Тижневий ритм</span>
                    {stats.weekly_hours ? (
                      <span className="text-[11px] font-semibold text-sys-text-muted">
                        {formatPairsFromHours(stats.weekly_hours)} пар/тиж
                      </span>
                    ) : null}
                  </div>
                  <div>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-2xl font-black text-sys-text-primary tracking-tight">
                        {stats.weekly_hours ?? "—"}
                      </span>
                      {stats.weekly_hours ? (
                        <span className="text-xs font-semibold text-sys-text-secondary">
                          акад. год / тиждень
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                      {studentSummary.totalReplacedCount > 0 && (
                        <span className="rounded border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:text-amber-300">
                          Замін: {studentSummary.totalReplacedCount}
                        </span>
                      )}
                      {studentSummary.totalCancelledCount > 0 && (
                        <span className="rounded border border-rose-500/20 bg-rose-500/10 px-1.5 py-0.5 text-[11px] font-medium text-rose-700 dark:text-rose-300">
                          Скасовано: {studentSummary.totalCancelledCount}
                        </span>
                      )}
                      {studentSummary.totalReplacedCount === 0 &&
                        studentSummary.totalCancelledCount === 0 && (
                          <span className="text-sys-text-muted">
                            Змін чи скасувань не зафіксовано
                          </span>
                        )}
                    </div>
                  </div>
                </div>
              </DesktopSpotlightGrid>
            ) : (
              <DesktopSpotlightGrid
                aria-label="Основні показники викладача"
                className="grid grid-cols-1 sm:grid-cols-3 gap-3"
              >
                <div
                  style={{ "--stagger-index": 0 } as React.CSSProperties}
                  className="interactive-surface desktop-stagger-card rounded-2xl border border-sys-border bg-sys-card p-4 shadow-xs flex flex-col justify-between space-y-2"
                >
                  <div className="flex items-center justify-between text-xs text-sys-text-secondary">
                    <span className="font-medium">Проведено за семестр</span>
                    <span className="rounded-full bg-sys-accent-subtle px-2 py-0.5 text-[11px] font-bold text-sys-accent">
                      {formatPairsFromHours(stats.total_hours)} пар
                    </span>
                  </div>
                  <div>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-3xl font-black text-sys-accent tracking-tight">
                        {stats.total_hours}
                      </span>
                      <span className="text-xs font-semibold text-sys-text-secondary">
                        акад. год
                      </span>
                    </div>
                    <p className="text-xs text-sys-text-muted mt-1">
                      {pluralizeUk(rawTeacherGroups.length, ["група", "групи", "груп"])} ·{" "}
                      {pluralizeUk(rawTeacherSubjects.length, [
                        "дисципліна",
                        "дисципліни",
                        "дисциплін",
                      ])}
                    </p>
                  </div>
                </div>

                <div
                  style={{ "--stagger-index": 1 } as React.CSSProperties}
                  className="interactive-surface desktop-stagger-card rounded-2xl border border-sys-border bg-sys-card p-4 shadow-xs flex flex-col justify-between space-y-2"
                >
                  <div className="flex items-center justify-between text-xs text-sys-text-secondary">
                    <span className="font-medium">Тижневе навантаження</span>
                    {stats.weekly_hours ? (
                      <span className="text-[11px] font-bold text-sys-text-primary">
                        {formatPairsFromHours(stats.weekly_hours)} пар/тиж
                      </span>
                    ) : null}
                  </div>
                  <div>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-3xl font-black text-sys-text-primary tracking-tight">
                        {stats.weekly_hours ?? 0}
                      </span>
                      <span className="text-xs font-semibold text-sys-text-secondary">
                        акад. год / тиждень
                      </span>
                    </div>
                    <p className="text-xs text-sys-text-muted mt-1">
                      за активним розкладом семестру
                    </p>
                  </div>
                </div>

                {teacherPlanStatus?.hasPlan && !teacherPlanStatus.isPartialPlan ? (
                  <div
                    style={{ "--stagger-index": 2 } as React.CSSProperties}
                    className="interactive-surface desktop-stagger-card rounded-2xl border border-sys-border bg-sys-card p-4 shadow-xs flex flex-col justify-between space-y-2"
                  >
                    <div className="flex items-center justify-between text-xs text-sys-text-secondary">
                      <span className="font-medium">Семестровий план</span>
                      <span className="text-[11px] font-bold text-sys-text-primary">
                        {stats.total_hours} із {teacherPlanStatus.plannedHours} год
                      </span>
                    </div>
                    <div>
                      <div className="flex items-baseline justify-between mb-1.5">
                        <span className="text-2xl font-black text-sys-text-primary tracking-tight">
                          {teacherPlanStatus.completionPercent}%
                        </span>
                        <span className="text-xs text-sys-text-muted">
                          залишилось {teacherPlanStatus.remainingHours} год
                        </span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-sys-bg border border-sys-border/70 overflow-hidden">
                        <div
                          className="h-full bg-sys-accent rounded-full transition-[width] duration-500 ease-out"
                          style={{
                            width: `${Math.min(
                              100,
                              Math.max(0, teacherPlanStatus.completionPercent ?? 0)
                            )}%`,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div
                    style={{ "--stagger-index": 2 } as React.CSSProperties}
                    className="interactive-surface desktop-stagger-card rounded-2xl border border-sys-border bg-sys-card p-4 shadow-xs flex flex-col justify-between space-y-2"
                  >
                    <div className="flex items-center justify-between text-xs text-sys-text-secondary">
                      <span className="font-medium">Охоплення аудиторії</span>
                      {teacherPlanStatus?.isPartialPlan && (
                        <span className="rounded bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:text-amber-300">
                          План частковий ({teacherPlanStatus.plannedHours} год)
                        </span>
                      )}
                    </div>
                    <div>
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-3xl font-black text-sys-text-primary tracking-tight">
                          {rawTeacherGroups.length}
                        </span>
                        <span className="text-xs font-semibold text-sys-text-secondary">
                          активних груп
                        </span>
                      </div>
                      <p className="text-xs text-sys-text-muted mt-1">
                        {pluralizeUk(rawTeacherSubjects.length, [
                          "дисципліна",
                          "дисципліни",
                          "дисциплін",
                        ])}{" "}
                        у поточному семестрі
                      </p>
                    </div>
                  </div>
                )}
              </DesktopSpotlightGrid>
            )}

            {/* Proportional Workload Distribution Ribbon */}
            {distributionSegments.length > 1 && (
              <section
                aria-label="Структура проведених годин"
                className="rounded-2xl border border-sys-border bg-sys-card p-4 shadow-xs space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-sys-text-secondary">
                    Структура навантаження{" "}
                    {mode === "teacher"
                      ? teacherView === "subjects"
                        ? "(за дисциплінами)"
                        : "(за групами)"
                      : "(за предметами)"}
                  </h2>
                  <span className="text-xs text-sys-text-muted">
                    Наведіть або натисніть на сегмент для деталей
                  </span>
                </div>

                <div
                  className="flex h-3.5 w-full overflow-hidden rounded-full bg-sys-bg p-0.5 border border-sys-border/70 gap-[2px]"
                  onMouseLeave={() => setActiveSegmentIdx(null)}
                >
                  {distributionSegments.map((seg, idx) => {
                    const palette = SEGMENT_PALETTE[seg.colorIdx];
                    const isInspected = (activeSegmentIdx ?? 0) === idx;
                    const label = `${seg.label}: ${seg.hours} акад. год (${seg.sharePercent}%)`;
                    return (
                      <button
                        key={seg.id}
                        type="button"
                        title={label}
                        aria-label={label}
                        onMouseEnter={() => setActiveSegmentIdx(idx)}
                        onFocus={() => setActiveSegmentIdx(idx)}
                        onClick={() => setActiveSegmentIdx(idx)}
                        style={{ flexGrow: seg.hours, flexBasis: 0 }}
                        className={`h-full min-w-[4px] rounded-full transition-opacity duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-sys-accent ${palette.bar} ${
                          isInspected
                            ? "opacity-100 ring-1 ring-sys-text-primary/40"
                            : "opacity-80 hover:opacity-100"
                        }`}
                      />
                    );
                  })}
                </div>

                {inspectedSegment && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sys-border/70 bg-sys-bg/60 px-3 py-2 text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`h-2.5 w-2.5 rounded-full shrink-0 ${
                          SEGMENT_PALETTE[inspectedSegment.colorIdx].dot
                        }`}
                      />
                      <span className="font-bold text-sys-text-primary truncate">
                        {inspectedSegment.label}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-sys-text-secondary font-medium">
                      <span>
                        <strong className="text-sys-text-primary">{inspectedSegment.hours}</strong>{" "}
                        год ({formatPairsFromHours(inspectedSegment.hours)} пар)
                      </span>
                      <span>·</span>
                      <span className="rounded-md bg-sys-elevated border border-sys-border px-1.5 py-0.5 text-[11px] font-semibold text-sys-text-primary">
                        {inspectedSegment.sharePercent}% усіх годин
                      </span>
                      {inspectedSegment.plannedHours ? (
                        <span className="text-sys-text-muted">
                          (план: {inspectedSegment.plannedHours} год)
                        </span>
                      ) : null}
                    </div>
                  </div>
                )}
              </section>
            )}

            {mode === "student" ? (
              <section className="space-y-4">
                <div className="flex flex-col gap-3 px-1">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-bold">Розподіл за предметами</h2>
                      <p className="text-xs text-sys-text-muted mt-0.5">
                        Показано {displayedStudentEntries.length} із {rawStudentEntries.length}{" "}
                        дисциплін
                      </p>
                    </div>

                    {/* Sort controls */}
                    <div
                      role="group"
                      aria-label="Сортування предметів"
                      className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-sys-border bg-sys-card p-1 text-xs self-start sm:self-auto"
                    >
                      {(
                        [
                          { id: "hours", label: "За годинами" },
                          ...(hasAnyPlannedSubject
                            ? [{ id: "progress" as const, label: "За % плану" }]
                            : []),
                          { id: "name", label: "За назвою" },
                        ] as const
                      ).map((opt) => {
                        const active = studentSort === opt.id;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            aria-pressed={active}
                            onClick={() => handleStudentSortChange(opt.id)}
                            className={`rounded-lg px-2.5 py-1 font-semibold transition-colors cursor-pointer ${
                              active
                                ? "bg-sys-accentSolid text-sys-onAccent shadow-xs"
                                : "text-sys-text-secondary hover:text-sys-text-primary"
                            }`}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Quick filter pills + search when needed */}
                  {(studentSummary &&
                    (studentSummary.unplannedSubjectsCount > 0 ||
                      studentSummary.changesSubjectsCount > 0 ||
                      rawStudentEntries.length >= 6)) && (
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                      <div
                        role="group"
                        aria-label="Фільтр предметів"
                        className="flex flex-wrap items-center gap-1.5"
                      >
                        {(
                          [
                            {
                              id: "all" as const,
                              label: `Усі (${rawStudentEntries.length})`,
                              show: true,
                            },
                            {
                              id: "planned" as const,
                              label: `За планом (${studentSummary.plannedSubjectsCount})`,
                              show:
                                studentSummary.plannedSubjectsCount > 0 &&
                                studentSummary.unplannedSubjectsCount > 0,
                            },
                            {
                              id: "unplanned" as const,
                              label: `Поза планом (${studentSummary.unplannedSubjectsCount})`,
                              show: studentSummary.unplannedSubjectsCount > 0,
                            },
                            {
                              id: "changes" as const,
                              label: `Зі змінами (${studentSummary.changesSubjectsCount})`,
                              show: studentSummary.changesSubjectsCount > 0,
                            },
                          ] as const
                        )
                          .filter((f) => f.show)
                          .map((f) => {
                            const active = studentFilter === f.id;
                            return (
                              <button
                                key={f.id}
                                type="button"
                                aria-pressed={active}
                                onClick={() => setStudentFilter(f.id)}
                                className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer ${
                                  active
                                    ? "border-sys-accent bg-sys-accent/10 text-sys-accent"
                                    : "border-sys-border bg-sys-card text-sys-text-secondary hover:text-sys-text-primary"
                                }`}
                              >
                                {f.label}
                              </button>
                            );
                          })}
                      </div>

                      {rawStudentEntries.length >= 6 && (
                        <div className="relative w-full sm:w-56">
                          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-sys-text-muted" />
                          <input
                            type="text"
                            value={itemSearch}
                            onChange={(e) => setItemSearch(e.target.value)}
                            placeholder="Фільтр за назвою..."
                            aria-label="Фільтр предметів за назвою"
                            className="w-full rounded-xl border border-sys-border bg-sys-card pl-8 pr-7 py-1.5 text-xs text-sys-text-primary placeholder:text-sys-text-muted focus:border-sys-accent focus:outline-none"
                          />
                          {itemSearch && (
                            <button
                              type="button"
                              aria-label="Очистити фільтр"
                              onClick={() => setItemSearch("")}
                              className="absolute right-2 top-1/2 -translate-y-1/2 text-sys-text-muted hover:text-sys-text-primary p-0.5"
                            >
                              <CloseIcon className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {displayedStudentEntries.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-sys-border bg-sys-card/50 p-8 text-center">
                    <InboxIcon className="mx-auto h-7 w-7 text-sys-text-muted" />
                    <p className="mt-2.5 text-sm text-sys-text-secondary">
                      {rawStudentEntries.length === 0
                        ? "Поки що немає даних для відображення."
                        : "За обраним фільтром предметів не знайдено."}
                    </p>
                  </div>
                ) : (
                  <DesktopSpotlightGrid className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                    {displayedStudentEntries.map((entry, idx) => {
                      const totalHours = entry.planned_hours ?? 0;
                      const hasPlannedHours = totalHours > 0;
                      const isUnplanned = !hasPlannedHours && hasAnyPlannedSubject;
                      const isOverPlan = hasPlannedHours && entry.completed_hours > totalHours;
                      const overPlanDiff = isOverPlan ? entry.completed_hours - totalHours : 0;
                      const remainingHours = hasPlannedHours
                        ? Math.max(0, totalHours - entry.completed_hours)
                        : 0;

                      const rawPercent = hasPlannedHours
                        ? Math.round((entry.completed_hours / totalHours) * 100)
                        : maxStudentEntryHours > 0
                        ? Math.round((entry.completed_hours / maxStudentEntryHours) * 100)
                        : 0;
                      const progress = hasPlannedHours
                        ? getProgressPercentage(entry.completed_hours, totalHours)
                        : rawPercent;
                      const clampedProgress = Math.min(100, Math.max(0, progress));
                      const shareOfTotal =
                        stats.total_hours > 0
                          ? Math.round((entry.completed_hours / stats.total_hours) * 100)
                          : 0;

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
                        <article
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
                            <span
                              aria-hidden="true"
                              className="absolute text-xs font-bold text-sys-text-primary"
                            >
                              {hasPlannedHours
                                ? `${rawPercent}%`
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
                                ? `${entry.completed_hours} з ${totalHours} акад. год · ${formatPairsFromHours(
                                    entry.completed_hours
                                  )} пар`
                                : `${entry.completed_hours} акад. год · ${formatPairsFromHours(
                                    entry.completed_hours
                                  )} пар`}
                            </p>
                            <p className="text-[11px] text-sys-text-muted mt-0.5">
                              {hasPlannedHours
                                ? isOverPlan
                                  ? `Перевиконано на +${overPlanDiff} год (${formatPairsFromHours(
                                      overPlanDiff
                                    )} пар)`
                                  : remainingHours > 0
                                  ? `Залишилось: ${remainingHours} год (${formatPairsFromHours(
                                      remainingHours
                                    )} пар)`
                                  : "План виконано повністю"
                                : shareOfTotal > 0
                                ? `Частка у семестрі: ${shareOfTotal}%`
                                : "Ще не проводилось"}
                            </p>
                            {(isUnplanned ||
                              isOverPlan ||
                              Boolean(entry.replaced_count) ||
                              Boolean(entry.cancelled_count)) && (
                              <div className="mt-1.5 flex flex-wrap gap-1.5 text-xs">
                                {isUnplanned && (
                                  <span className="rounded border border-sys-border bg-sys-bg-secondary px-1.5 py-0.5 text-sys-text-secondary font-medium">
                                    Поза планом
                                  </span>
                                )}
                                {isOverPlan && (
                                  <span className="rounded border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 text-emerald-800 dark:text-emerald-300 font-medium">
                                    +{overPlanDiff} год понад план
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
                        </article>
                      );
                    })}
                  </DesktopSpotlightGrid>
                )}
                <p className="mt-6 text-center text-xs text-sys-text-muted">
                  Дані розраховані за розкладом і не враховують фактичну присутність.
                </p>
              </section>
            ) : (
              <section className="space-y-4">
                <div className="flex flex-col gap-3 px-1">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-bold">
                        {teacherView === "subjects"
                          ? "Розподіл за дисциплінами"
                          : "Розподіл за групами"}
                      </h2>
                      <p className="text-xs text-sys-text-muted mt-0.5">
                        {teacherView === "subjects"
                          ? `${pluralizeUk(rawTeacherSubjects.length, [
                              "дисципліна закріплена",
                              "дисципліни закріплено",
                              "дисциплін закріплено",
                            ])} в розкладі`
                          : `${pluralizeUk(rawTeacherGroups.length, [
                              "активна група",
                              "активні групи",
                              "активних груп",
                            ])} у поточному семестрі`}
                      </p>
                    </div>
                    <div
                      role="group"
                      aria-label="Групування статистики викладача"
                      style={
                        {
                          "--seg-cols": 2,
                          "--seg-index": teacherView === "groups" ? 1 : 0,
                        } as React.CSSProperties
                      }
                      className="ui-seg-xl ui-seg-pad-4 relative grid grid-cols-2 sm:inline-grid items-stretch rounded-xl bg-sys-elevated border border-sys-border text-xs font-medium self-stretch sm:self-auto isolate select-none"
                    >
                      <div
                        aria-hidden="true"
                        className="ui-seg-slider pointer-events-none bg-sys-accentSolid shadow-sm transition-transform duration-base [transition-timing-function:var(--ease-spring-snappy)] transform-gpu z-0"
                      />
                      <button
                        type="button"
                        aria-pressed={teacherView === "subjects"}
                        onClick={() => setTeacherView("subjects")}
                        className={`ui-seg-pill relative z-10 flex items-center justify-center px-3 py-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                          teacherView === "subjects"
                            ? "text-sys-onAccent font-semibold"
                            : "text-sys-text-secondary hover:text-sys-text-primary"
                        }`}
                      >
                        За дисциплінами ({rawTeacherSubjects.length})
                      </button>
                      <button
                        type="button"
                        aria-pressed={teacherView === "groups"}
                        onClick={() => setTeacherView("groups")}
                        className={`ui-seg-pill relative z-10 flex items-center justify-center px-3 py-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                          teacherView === "groups"
                            ? "text-sys-onAccent font-semibold"
                            : "text-sys-text-secondary hover:text-sys-text-primary"
                        }`}
                      >
                        За групами ({rawTeacherGroups.length})
                      </button>
                    </div>
                  </div>

                  {((teacherView === "subjects" && rawTeacherSubjects.length > 1) ||
                    (teacherView === "groups" && rawTeacherGroups.length > 1)) && (
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                      <div
                        role="group"
                        aria-label="Сортування списку викладача"
                        className="inline-flex items-center gap-1 rounded-xl border border-sys-border bg-sys-card p-1 text-xs self-start"
                      >
                        {(
                          [
                            { id: "hours" as const, label: "За годинами" },
                            { id: "name" as const, label: "За назвою" },
                          ] as const
                        ).map((opt) => {
                          const active = teacherSort === opt.id;
                          return (
                            <button
                              key={opt.id}
                              type="button"
                              aria-pressed={active}
                              onClick={() => handleTeacherSortChange(opt.id)}
                              className={`rounded-lg px-2.5 py-1 font-semibold transition-colors cursor-pointer ${
                                active
                                  ? "bg-sys-accentSolid text-sys-onAccent shadow-xs"
                                  : "text-sys-text-secondary hover:text-sys-text-primary"
                              }`}
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>

                      {((teacherView === "subjects" && rawTeacherSubjects.length >= 6) ||
                        (teacherView === "groups" && rawTeacherGroups.length >= 6)) && (
                        <div className="relative w-full sm:w-56">
                          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-sys-text-muted" />
                          <input
                            type="text"
                            value={itemSearch}
                            onChange={(e) => setItemSearch(e.target.value)}
                            placeholder={
                              teacherView === "subjects"
                                ? "Фільтр дисципліни чи групи..."
                                : "Фільтр групи чи предмета..."
                            }
                            aria-label="Фільтр записів викладача"
                            className="w-full rounded-xl border border-sys-border bg-sys-card pl-8 pr-7 py-1.5 text-xs text-sys-text-primary placeholder:text-sys-text-muted focus:border-sys-accent focus:outline-none"
                          />
                          {itemSearch && (
                            <button
                              type="button"
                              aria-label="Очистити фільтр"
                              onClick={() => setItemSearch("")}
                              className="absolute right-2 top-1/2 -translate-y-1/2 text-sys-text-muted hover:text-sys-text-primary p-0.5"
                            >
                              <CloseIcon className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
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
                        const subjPlanned = subj.planned_hours ?? 0;
                        const hasSubjPlan =
                          subjPlanned > 0 && subj.completed_hours <= subjPlanned * 1.35;
                        const relativePercent = hasSubjPlan
                          ? Math.round((subj.completed_hours / subjPlanned) * 100)
                          : maxTeacherSubjectHours > 0
                          ? Math.round((subj.completed_hours / maxTeacherSubjectHours) * 100)
                          : 0;
                        const clampedProgress = Math.min(100, Math.max(0, relativePercent));
                        const sharePercent =
                          stats.total_hours > 0
                            ? Math.round((subj.completed_hours / stats.total_hours) * 100)
                            : 0;
                        const circumference = 2 * Math.PI * 20;
                        const strokeDashoffset =
                          circumference - (clampedProgress / 100) * circumference;

                        return (
                          <article
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
                              <span
                                aria-hidden="true"
                                className="absolute text-xs font-bold text-sys-text-primary"
                              >
                                {hasSubjPlan ? `${relativePercent}%` : `${subj.completed_hours}г`}
                              </span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <h3
                                className="line-clamp-2 leading-snug font-semibold text-sm mb-1 text-sys-text-primary"
                                title={subj.name}
                              >
                                {subj.name}
                              </h3>
                              <p className="text-xs text-sys-text-secondary">
                                {hasSubjPlan
                                  ? `${subj.completed_hours} з ${subjPlanned} акад. год · ${subj.lessons_count} пар`
                                  : `${subj.completed_hours} акад. год · ${subj.lessons_count} пар`}
                              </p>
                              <p className="text-[11px] text-sys-text-muted mt-0.5 mb-1.5">
                                Частка навантаження: {sharePercent}%
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
                              {(Boolean(subj.replaced_count) || Boolean(subj.cancelled_count)) && (
                                <div className="mt-1.5 flex flex-wrap gap-1.5 text-xs">
                                  {Boolean(subj.replaced_count) && (
                                    <span className="rounded border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-amber-800 dark:text-amber-300 font-medium">
                                      Замін: {subj.replaced_count}
                                    </span>
                                  )}
                                  {Boolean(subj.cancelled_count) && (
                                    <span className="rounded border border-rose-500/20 bg-rose-500/10 px-1.5 py-0.5 text-rose-700 dark:text-rose-300 font-medium">
                                      Скасовано: {subj.cancelled_count}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          </article>
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
                      const sharePercent =
                        stats.total_hours > 0
                          ? Math.round((grp.completed_hours / stats.total_hours) * 100)
                          : 0;
                      const circumference = 2 * Math.PI * 20;
                      const strokeDashoffset =
                        circumference - (clampedProgress / 100) * circumference;

                      return (
                        <article
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
                            <span
                              aria-hidden="true"
                              className="absolute text-xs font-bold text-sys-text-primary"
                            >
                              {grp.completed_hours}г
                            </span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <h3 className="font-semibold text-sm text-sys-text-primary">
                                Група {grp.name}
                              </h3>
                              <span className="text-[11px] font-semibold text-sys-text-muted">
                                {sharePercent}%
                              </span>
                            </div>
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
                        </article>
                      );
                    })}
                  </DesktopSpotlightGrid>
                )}

                <p className="mt-6 text-center text-xs text-sys-text-muted">
                  Дані розраховані за розкладом і не враховують фактичну присутність.
                </p>
              </section>
            )}
          </>
        ) : null}
      </main>
    </div>
  );
}
