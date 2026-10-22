"use client";

import { useEffect, useState, useMemo } from "react";
import { api, TeacherConstraintRecord } from "../../lib/api";
import { SearchableSelect } from "../SearchableSelect";
import { useToast } from "../ToastProvider";
import { PageHeader } from "./PageHeader";

const DAYS: { id: number; name: string; short: string }[] = [
  { id: 1, name: "Понеділок", short: "Пн" },
  { id: 2, name: "Вівторок", short: "Вт" },
  { id: 3, name: "Середа", short: "Ср" },
  { id: 4, name: "Четвер", short: "Чт" },
  { id: 5, name: "П’ятниця", short: "Пт" },
];

const LESSON_NUMBERS = [1, 2, 3, 4];

const LESSON_TIMES: Record<number, string> = {
  1: "09:00–10:20",
  2: "10:40–12:00",
  3: "12:30–13:50",
  4: "14:00–15:20",
};

export function ConstraintsPanel() {
  const [items, setItems] = useState<TeacherConstraintRecord[]>([]);
  const [teachers, setTeachers] = useState<{ id: number; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [togglingCell, setTogglingCell] = useState<string | null>(null);

  const [teacherId, setTeacherId] = useState<number | "">("");
  const { showToast: setToast } = useToast();

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      const session = await api.auth.ensureAuthenticated();
      const t = await api.directory.teachers();
      setTeachers(t);
      if (t.length > 0 && teacherId === "") {
        setTeacherId(t[0].id);
      }
      const res = await api.constraints.list(session.access_token);
      setItems(res);
    } catch (err: any) {
      setToast(err.message || "Помилка завантаження даних", "error");
    } finally {
      setLoading(false);
    }
  }

  // Constraints map for the selected teacher: `${day}_${lesson}` -> TeacherConstraintRecord
  const teacherConstraintsMap = useMemo(() => {
    const map = new Map<string, TeacherConstraintRecord>();
    if (!teacherId) return map;
    for (const c of items) {
      if (c.teacher.id === Number(teacherId)) {
        map.set(`${c.day_of_week}_${c.lesson_number}`, c);
      }
    }
    return map;
  }, [items, teacherId]);

  const selectedTeacherName = useMemo(() => {
    return teachers.find((t) => t.id === teacherId)?.name || "";
  }, [teachers, teacherId]);

  async function toggleCell(day: number, lesson: number) {
    if (!teacherId) {
      setToast("Оберіть викладача", "error");
      return;
    }
    const key = `${day}_${lesson}`;
    const existing = teacherConstraintsMap.get(key);
    setTogglingCell(key);

    try {
      const session = await api.auth.ensureAuthenticated();
      if (existing) {
        await api.constraints.remove(existing.id, session.access_token);
        setItems((prev) => prev.filter((i) => i.id !== existing.id));
        setToast(`Пару розблоковано: ${DAYS.find((d) => d.id === day)?.name}, ${lesson} пара`, "success");
      } else {
        const created = await api.constraints.create(Number(teacherId), day, lesson, session.access_token);
        setItems((prev) => [created, ...prev]);
        setToast(`Обмеження додано: ${DAYS.find((d) => d.id === day)?.name}, ${lesson} пара`, "success");
      }
    } catch (err: any) {
      setToast(err.message || "Помилка оновлення обмеження", "error");
    } finally {
      setTogglingCell(null);
    }
  }

  async function toggleWholeDay(day: number) {
    if (!teacherId) {
      setToast("Оберіть викладача", "error");
      return;
    }

    // Check if all lessons are currently constrained
    const allConstrained = LESSON_NUMBERS.every((l) => teacherConstraintsMap.has(`${day}_${l}`));

    try {
      const session = await api.auth.ensureAuthenticated();
      if (allConstrained) {
        // Remove all constraints for this day
        const toRemove = LESSON_NUMBERS.map((l) => teacherConstraintsMap.get(`${day}_${l}`))
          .filter(Boolean) as TeacherConstraintRecord[];
        await Promise.all(toRemove.map((c) => api.constraints.remove(c.id, session.access_token)));
        const removedIds = new Set(toRemove.map((c) => c.id));
        setItems((prev) => prev.filter((i) => !removedIds.has(i.id)));
        setToast(`День розблоковано: ${DAYS.find((d) => d.id === day)?.name}`, "success");
      } else {
        // Add constraints for all free lessons in this day
        const toAdd = LESSON_NUMBERS.filter((l) => !teacherConstraintsMap.has(`${day}_${l}`));
        const newRecords = await Promise.all(
          toAdd.map((l) => api.constraints.create(Number(teacherId), day, l, session.access_token))
        );
        setItems((prev) => [...newRecords, ...prev]);
        setToast(`Методичний день: заблоковано весь ${DAYS.find((d) => d.id === day)?.name}`, "success");
      }
    } catch (err: any) {
      setToast(err.message || "Помилка оновлення дня", "error");
    }
  }

  async function clearAllTeacherConstraints() {
    if (!teacherId) return;
    const currentConstraints = items.filter((i) => i.teacher.id === Number(teacherId));
    if (currentConstraints.length === 0) return;
    if (!window.confirm(`Зняти всі обмеження для викладача ${selectedTeacherName}?`)) return;

    try {
      const session = await api.auth.ensureAuthenticated();
      await Promise.all(currentConstraints.map((c) => api.constraints.remove(c.id, session.access_token)));
      const removedIds = new Set(currentConstraints.map((c) => c.id));
      setItems((prev) => prev.filter((i) => !removedIds.has(i.id)));
      setToast(`Всі обмеження для ${selectedTeacherName} знято`, "success");
    } catch (err: any) {
      setToast(err.message || "Помилка очищення обмежень", "error");
    }
  }

  const blockedCount = teacherConstraintsMap.size;

  return (
    <>
      <PageHeader
        eyebrow="АВТОМАТИЗАЦІЯ"
        title="Доступність викладачів"
        description="Інтерактивна матриця щотижневої зайнятості. Клікніть по комірці, щоб позначити пару недоступною. Клікніть по заголовку дня тижня, щоб заблокувати весь день (методичний день)."
      />

      {/* Top Bar: Teacher Picker & Quick Status */}
      <div className="surface-panel mt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 sm:p-5">
        <div className="w-full sm:w-80">
          <label className="block text-xs font-semibold uppercase tracking-wider text-sys-text-secondary mb-1.5">
            Викладач для налаштування
          </label>
          <SearchableSelect
            options={teachers}
            value={teacherId === "" ? null : teacherId}
            onChange={(id) => setTeacherId(id ?? "")}
            placeholder="Знайти викладача"
            disabled={loading}
            ariaLabel="Викладач"
          />
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-xl border border-sys-border bg-sys-card px-3.5 py-2 text-xs">
            <span className="text-sys-text-secondary">Заблоковано пар:</span>
            <span
              className={`font-bold px-2 py-0.5 rounded-full ${
                blockedCount > 0
                  ? "bg-rose-500/15 text-rose-600 dark:text-rose-300 border border-rose-500/30"
                  : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30"
              }`}
            >
              {blockedCount} з {DAYS.length * LESSON_NUMBERS.length}
            </span>
          </div>

          {blockedCount > 0 && (
            <button
              type="button"
              onClick={clearAllTeacherConstraints}
              className="h-10 px-3.5 rounded-xl border border-sys-border bg-sys-card text-xs font-semibold text-sys-text-secondary hover:border-rose-500/40 hover:bg-rose-500/10 hover:text-rose-400 active:scale-95 transition-all"
            >
              Очистити все
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="mt-8 text-center text-sys-text-secondary py-12">Завантаження доступності…</div>
      ) : teacherId === "" ? (
        <div className="mt-6 rounded-2xl border border-dashed border-sys-border p-12 text-center text-sys-text-secondary text-sm">
          Оберіть викладача в селекторі вище для перегляду та редагування матриці зайнятості.
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          {/* Interactive 5x6 Chessboard Matrix */}
          <div className="rounded-2xl border border-sys-border bg-sys-card p-4 sm:p-6 shadow-xl overflow-x-auto">
            <div className="min-w-[640px]">
              {/* Matrix Header: Days */}
              <div className="grid grid-cols-6 gap-2.5 pb-3 border-b border-sys-border/60">
                <div className="flex items-center justify-center p-2 text-xs font-bold uppercase tracking-wider text-sys-text-muted">
                  Пара \ День
                </div>
                {DAYS.map((d) => {
                  const dayBlocked = LESSON_NUMBERS.every((l) => teacherConstraintsMap.has(`${d.id}_${l}`));
                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => void toggleWholeDay(d.id)}
                      title={`Клікніть, щоб ${dayBlocked ? "розблокувати" : "заблокувати"} весь ${d.name}`}
                      className={`flex flex-col items-center justify-center py-2 px-1 rounded-xl border text-xs transition-all active:scale-98 ${
                        dayBlocked
                          ? "border-rose-500/40 bg-rose-500/15 text-rose-600 dark:text-rose-300 font-bold"
                          : "border-sys-border bg-sys-bg text-sys-text-primary hover:border-sys-accent/50 hover:bg-sys-bg/80"
                      }`}
                    >
                      <span className="font-bold text-sm">{d.short}</span>
                      <span className="text-[10px] text-sys-text-muted">{d.name}</span>
                    </button>
                  );
                })}
              </div>

              {/* Matrix Rows: 6 pairs */}
              <div className="mt-3 space-y-2.5">
                {LESSON_NUMBERS.map((lesson) => (
                  <div key={lesson} className="grid grid-cols-6 gap-2.5 items-center">
                    {/* Lesson Label */}
                    <div className="flex flex-col items-center justify-center py-2 px-2 rounded-xl bg-sys-bg border border-sys-border/60 text-center">
                      <span className="text-xs font-bold text-sys-text-primary">{lesson} пара</span>
                      <span className="text-[10px] text-sys-text-muted font-mono">{LESSON_TIMES[lesson]}</span>
                    </div>

                    {/* 5 Day Cells */}
                    {DAYS.map((d) => {
                      const key = `${d.id}_${lesson}`;
                      const isBlocked = teacherConstraintsMap.has(key);
                      const isToggling = togglingCell === key;

                      return (
                        <button
                          key={d.id}
                          type="button"
                          disabled={isToggling}
                          onClick={() => void toggleCell(d.id, lesson)}
                          className={`relative flex flex-col items-center justify-center h-16 rounded-xl border p-2 transition-all active:scale-[0.97] focus:outline-none focus:ring-2 focus:ring-sys-accent ${
                            isBlocked
                              ? "border-rose-500/50 bg-rose-500/10 text-rose-600 dark:text-rose-300 shadow-inner hover:bg-rose-500/20"
                              : "border-sys-border bg-sys-bg/60 text-sys-text-muted hover:border-sys-accent/60 hover:bg-sys-bg hover:text-sys-text-primary"
                          }`}
                        >
                          {isToggling ? (
                            <span className="text-xs text-sys-text-muted animate-pulse">…</span>
                          ) : isBlocked ? (
                            <>
                              <span className="text-sm">⛔</span>
                              <span className="text-[11px] font-bold text-rose-400 mt-0.5">Недоступний</span>
                            </>
                          ) : (
                            <>
                              <span className="text-xs text-sys-text-muted font-medium">Вільний</span>
                            </>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Helper Legend */}
          <div className="flex items-center gap-6 px-2 text-xs text-sys-text-secondary">
            <div className="flex items-center gap-2">
              <span className="flex h-3.5 w-3.5 rounded-md border border-sys-border bg-sys-bg/60" />
              <span>Вільний для призначення</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="flex h-3.5 w-3.5 rounded-md border border-rose-500/50 bg-rose-500/15" />
              <span>Недоступний (генератор не призначить пару)</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
