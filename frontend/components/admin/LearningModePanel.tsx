"use client";
import { FormEvent, useEffect, useRef, useState } from "react";
import { api, LearningMode, LearningModeConfig, LearningModeOverride } from "../../lib/api";
import { invalidateScheduleCache } from "../../lib/hooks";
import { PageHeader } from "./PageHeader";

const COURSES = [1, 2, 3, 4];

const EMPTY_CONFIG: LearningModeConfig = {
  cycle_start: null,
  weeks_per_phase: 2,
  first_phase_offline_courses: [1, 3],
  overrides: [],
};

const EMPTY_OVERRIDE: LearningModeOverride = {
  start: "",
  end: "",
  mode: "online",
  courses: [],
  reason: "",
};

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

function formatOverrideDatesUk(startIso: string, endIso: string): string {
  if (!startIso) return "";
  const [sy, sm, sd] = startIso.split("-").map(Number);
  const startDt = new Date(sy, sm - 1, sd);
  const sFmt = startDt.toLocaleDateString("uk-UA", { day: "numeric", month: "short" });
  if (!endIso || startIso === endIso) {
    return sFmt;
  }
  const [ey, em, ed] = endIso.split("-").map(Number);
  const endDt = new Date(ey, em - 1, ed);
  const eFmt = endDt.toLocaleDateString("uk-UA", { day: "numeric", month: "short" });
  return `${sFmt} – ${eFmt}`;
}

export function LearningModePanel() {
  const [config, setConfig] = useState<LearningModeConfig>(EMPTY_CONFIG);
  const [draftOverride, setDraftOverride] = useState<LearningModeOverride>(EMPTY_OVERRIDE);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    let active = true;
    api.settings.learningMode()
      .then((settings) => {
        if (active) setConfig(settings);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "Не вдалося завантажити режим навчання.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  async function persist(next: LearningModeConfig, message: string) {
    setError(null);
    setSuccess(null);
    setSaving(true);
    try {
      const session = await api.auth.ensureAuthenticated();
      const saved = await api.settings.updateLearningMode(next, session.access_token);
      invalidateScheduleCache();
      setConfig(saved);
      setSuccess(message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося зберегти режим навчання.");
    } finally {
      setSaving(false);
    }
  }

  function saveCycle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!config.cycle_start) {
      setError("Вкажіть дату початку циклу.");
      return;
    }
    void persist(config, "Цикл збережено.");
  }

  function startEditing(index: number) {
    const target = config.overrides[index];
    if (!target) return;
    setEditingIndex(index);
    setDraftOverride({
      start: target.start,
      end: target.end,
      mode: target.mode,
      courses: [...target.courses],
      reason: target.reason ?? "",
    });
    setError(null);
    setSuccess(null);
    setTimeout(() => {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 50);
  }

  function cancelEditing() {
    setEditingIndex(null);
    setDraftOverride(EMPTY_OVERRIDE);
    setError(null);
  }

  function saveOverride(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const start = draftOverride.start.trim();
    const end = (draftOverride.end || draftOverride.start).trim();
    if (!start || !end) {
      setError("Вкажіть дати дії винятку.");
      return;
    }
    if (end < start) {
      setError("Дата завершення винятку не може бути раніше початку.");
      return;
    }
    const normalized: LearningModeOverride = {
      ...draftOverride,
      start,
      end,
      courses: [...draftOverride.courses].sort((a, b) => a - b),
      reason: draftOverride.reason?.trim() || null,
    };

    let next: LearningModeConfig;
    let message: string;

    if (editingIndex !== null && editingIndex >= 0 && editingIndex < config.overrides.length) {
      const updated = [...config.overrides];
      updated[editingIndex] = normalized;
      next = { ...config, overrides: updated };
      message = "Виняток успішно змінено.";
    } else {
      next = { ...config, overrides: [...config.overrides, normalized] };
      message = "Виняток успішно додано.";
    }

    setDraftOverride(EMPTY_OVERRIDE);
    setEditingIndex(null);
    void persist(next, message);
  }

  function removeOverride(index: number) {
    if (editingIndex === index) {
      setEditingIndex(null);
      setDraftOverride(EMPTY_OVERRIDE);
    } else if (editingIndex !== null && index < editingIndex) {
      setEditingIndex(editingIndex - 1);
    }
    const next = { ...config, overrides: config.overrides.filter((_, i) => i !== index) };
    void persist(next, "Виняток видалено.");
  }

  return (
    <section className="w-full space-y-6">
      <PageHeader
        eyebrow="НАЛАШТУВАННЯ"
        title="Режим навчання"
        description="Очне або дистанційне навчання по курсах. Режим міняється автоматично за циклом, а винятки дозволяють швидко перевести курс на дистанційне навчання."
      />

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-500/20 bg-rose-500/10 p-3.5 text-sm text-rose-700 dark:text-rose-300">
          <p>{error}</p>
        </div>
      )}
      {success && (
        <div role="status" className="flex items-start gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3.5 text-sm text-emerald-700 dark:text-emerald-300">
          <p>{success}</p>
        </div>
      )}

      {loading ? (
        <div className="rounded-2xl border border-sys-border bg-sys-card p-12 text-center text-sm text-sys-text-secondary">
          Завантаження налаштувань…
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* Картка 1: Автоматичний цикл */}
          <form onSubmit={saveCycle} className="w-full rounded-2xl border border-sys-border bg-sys-card shadow-sm overflow-hidden flex flex-col">
            <div className="bg-gradient-to-b from-white/5 to-transparent p-5 sm:p-6 pb-4 border-b border-sys-border/50">
              <div className="flex items-center gap-2.5">
                <span className="text-xl">🔄</span>
                <div>
                  <h3 className="text-base sm:text-lg font-bold text-sys-text-primary">Автоматичний цикл</h3>
                  <p className="mt-0.5 text-xs text-sys-text-secondary">Очні та дистанційні тижні чергуються від стартової дати</p>
                </div>
              </div>
            </div>

            <div className="p-5 sm:p-6 space-y-5 flex-1">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="block">
                  <span className="form-label text-sys-text-secondary text-xs">Початок циклу (понеділок)</span>
                  <input
                    required
                    type="date"
                    value={config.cycle_start ?? ""}
                    onChange={(event) => setConfig({ ...config, cycle_start: event.target.value || null })}
                    className="form-control mt-1 shadow-sm bg-sys-bg w-full text-sm"
                  />
                </label>
                <label className="block">
                  <span className="form-label text-sys-text-secondary text-xs">Тижнів у кожній фазі</span>
                  <input
                    type="number"
                    min={1}
                    max={8}
                    value={config.weeks_per_phase}
                    onChange={(event) => setConfig({ ...config, weeks_per_phase: Number(event.target.value) })}
                    className="form-control mt-1 shadow-sm bg-sys-bg w-full text-sm"
                  />
                </label>
              </div>

              <div>
                <span className="form-label text-sys-text-secondary text-xs">Очно в першій фазі</span>
                <div className="mt-2 flex flex-wrap gap-2">
                  {COURSES.map((course) => {
                    const active = config.first_phase_offline_courses.includes(course);
                    return (
                      <button
                        key={course}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setConfig({ ...config, first_phase_offline_courses: toggle(config.first_phase_offline_courses, course) })}
                        className={`min-h-[40px] rounded-lg border px-3.5 py-1.5 text-xs sm:text-sm font-semibold transition-colors cursor-pointer ${
                          active
                            ? "border-sys-accent bg-sys-accent/15 text-sys-accent shadow-xs"
                            : "border-sys-border bg-sys-bg text-sys-text-secondary hover:text-sys-text-primary"
                        }`}
                      >
                        {course} курс
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 text-xs text-sys-text-muted">Інші курси в 1-й фазі навчаються дистанційно, а в наступній — навпаки.</p>
              </div>

              {/* Інформаційна плашка схеми чергування */}
              <div className="rounded-xl border border-sys-border/80 bg-sys-bg/60 p-4 space-y-2.5">
                <div className="flex items-center justify-between text-xs font-semibold text-sys-text-secondary">
                  <span>Схема чергування фаз</span>
                  <span className="text-sys-text-muted font-normal">по {config.weeks_per_phase} тиж.</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg border border-sys-accent/30 bg-sys-accent/5 p-2.5 space-y-1">
                    <span className="font-bold text-sys-accent text-[11px] uppercase tracking-wider block">1-ша фаза</span>
                    <p className="text-sys-text-primary">
                      Очно: <strong>{config.first_phase_offline_courses.length ? [...config.first_phase_offline_courses].sort((a,b)=>a-b).map(c=>`${c} курс`).join(", ") : "—"}</strong>
                    </p>
                    <p className="text-sys-text-secondary text-[11px]">
                      Дистанційно: {COURSES.filter(c => !config.first_phase_offline_courses.includes(c)).map(c=>`${c} курс`).join(", ") || "—"}
                    </p>
                  </div>
                  <div className="rounded-lg border border-sys-border bg-sys-bg/80 p-2.5 space-y-1">
                    <span className="font-bold text-sys-text-secondary text-[11px] uppercase tracking-wider block">2-га фаза</span>
                    <p className="text-sys-text-primary">
                      Очно: <strong>{COURSES.filter(c => !config.first_phase_offline_courses.includes(c)).map(c=>`${c} курс`).join(", ") || "—"}</strong>
                    </p>
                    <p className="text-sys-text-secondary text-[11px]">
                      Дистанційно: {config.first_phase_offline_courses.length ? [...config.first_phase_offline_courses].sort((a,b)=>a-b).map(c=>`${c} курс`).join(", ") : "—"}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-sys-bg/30 px-6 py-4 flex justify-end border-t border-sys-border/50">
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-sys-accent px-5 py-2.5 min-h-[40px] text-xs sm:text-sm font-semibold text-white shadow-xs hover:opacity-95 disabled:opacity-50 transition-colors cursor-pointer"
              >
                {saving ? "Збереження…" : "Зберегти цикл"}
              </button>
            </div>
          </form>

          {/* Картка 2: Винятки */}
          <div className="w-full rounded-2xl border border-sys-border bg-sys-card shadow-sm overflow-hidden flex flex-col">
            <div className="bg-gradient-to-b from-white/5 to-transparent p-5 sm:p-6 pb-4 border-b border-sys-border/50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="text-xl">⚠️</span>
                  <div>
                    <h3 className="text-base sm:text-lg font-bold text-sys-text-primary">Винятки</h3>
                    <p className="mt-0.5 text-xs text-sys-text-secondary">Тимчасові зміни режиму (наприклад, небезпека або карантин)</p>
                  </div>
                </div>
                {config.overrides.length > 0 && (
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-sys-accent/15 text-sys-accent border border-sys-accent/30">
                    {config.overrides.length}
                  </span>
                )}
              </div>
            </div>

            <div className="p-5 sm:p-6 space-y-5 flex-1">
              {config.overrides.length === 0 ? (
                <div className="rounded-xl border border-dashed border-sys-border p-6 text-center text-xs text-sys-text-muted">
                  Активних винятків наразі немає. Режим розраховується суто за автоматичним циклом.
                </div>
              ) : (
                <ul className="space-y-2.5 max-h-[300px] overflow-y-auto pr-1">
                  {config.overrides.map((override, index) => {
                    const isEditing = editingIndex === index;
                    return (
                      <li
                        key={`${override.start}-${override.end}-${index}`}
                        className={`flex flex-wrap items-start justify-between gap-3 rounded-xl border p-3 text-sm transition-all ${
                          isEditing
                            ? "border-sys-accent bg-sys-accent/10 ring-2 ring-sys-accent/40 shadow-xs"
                            : "border-sys-border bg-sys-bg/60 hover:border-sys-border/90"
                        }`}
                      >
                        <div className="flex flex-col gap-1 min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2 text-sys-text-primary">
                            <span className="font-semibold text-xs sm:text-sm">
                              {formatOverrideDatesUk(override.start, override.end)}
                            </span>
                            <span className="text-[11px] text-sys-text-muted font-mono">
                              ({override.start === override.end ? override.start : `${override.start} – ${override.end}`})
                            </span>
                            <span
                              className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${
                                override.mode === "offline"
                                  ? "border-sys-accent/30 bg-sys-accent/10 text-sys-accent"
                                  : "border-sys-warning/30 bg-sys-warning/10 text-sys-warning"
                              }`}
                            >
                              {override.mode === "offline" ? "Очно" : "Дистанційно"}
                            </span>
                            <span className="text-xs text-sys-text-secondary">
                              {override.courses.length ? override.courses.map((c) => `${c} курс`).join(", ") : "усі курси"}
                            </span>
                            {isEditing && (
                              <span className="rounded-full bg-sys-accent/20 border border-sys-accent/40 px-2 py-0.5 text-[11px] font-bold text-sys-accent">
                                ✏️ Редагується
                              </span>
                            )}
                          </div>
                          {override.reason && (
                            <p className="text-xs text-sys-text-secondary whitespace-normal break-words">
                              {override.reason}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {isEditing ? (
                            <button
                              type="button"
                              onClick={cancelEditing}
                              disabled={saving}
                              className="min-h-[32px] px-2.5 py-1 rounded-lg border border-sys-border text-xs font-semibold text-sys-text-secondary hover:text-sys-text-primary hover:bg-sys-bg disabled:opacity-50 cursor-pointer transition-colors"
                            >
                              Скасувати
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => startEditing(index)}
                              disabled={saving}
                              className="min-h-[32px] px-2.5 py-1 rounded-lg border border-sys-border/80 text-xs font-semibold text-sys-accent hover:border-sys-accent/50 hover:bg-sys-accent/10 disabled:opacity-50 cursor-pointer transition-colors"
                            >
                              ✏️ Змінити
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => removeOverride(index)}
                            disabled={saving}
                            className="min-h-[32px] px-2 text-xs font-semibold text-rose-700 dark:text-rose-400 hover:text-rose-800 dark:hover:text-rose-300 hover:underline disabled:opacity-50 cursor-pointer"
                          >
                            Видалити
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}

              <form
                ref={formRef}
                onSubmit={saveOverride}
                className={`space-y-3.5 rounded-xl border p-4 transition-colors ${
                  editingIndex !== null
                    ? "border-sys-accent/50 bg-sys-accent/5 ring-1 ring-sys-accent/20"
                    : "border-sys-border/80 bg-sys-bg/40"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-sys-text-primary flex items-center gap-1.5">
                    {editingIndex !== null ? (
                      <>
                        <span className="text-sys-accent">✏️</span>
                        <span>Редагувати виняток #{editingIndex + 1}</span>
                      </>
                    ) : (
                      <>
                        <span>+</span>
                        <span>Додати новий виняток</span>
                      </>
                    )}
                  </span>
                  {editingIndex !== null && (
                    <button
                      type="button"
                      onClick={cancelEditing}
                      className="text-xs text-sys-text-muted hover:text-sys-text-primary hover:underline cursor-pointer"
                    >
                      Скасувати редагування
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="block">
                    <span className="form-label text-sys-text-secondary text-xs">Початок (З)</span>
                    <input
                      required
                      type="date"
                      value={draftOverride.start}
                      onChange={(event) => {
                        const nextStart = event.target.value;
                        setDraftOverride((prev) => ({
                          ...prev,
                          start: nextStart,
                          end: !prev.end || prev.end < nextStart ? nextStart : prev.end,
                        }));
                      }}
                      className="form-control mt-1 shadow-sm bg-sys-bg w-full text-sm"
                    />
                  </label>
                  <label className="block">
                    <span className="form-label text-sys-text-secondary text-xs">Завершення (По)</span>
                    <input
                      required
                      type="date"
                      min={draftOverride.start || undefined}
                      value={draftOverride.end}
                      onChange={(event) => setDraftOverride({ ...draftOverride, end: event.target.value })}
                      className="form-control mt-1 shadow-sm bg-sys-bg w-full text-sm"
                    />
                  </label>
                </div>
                <div>
                  <span className="form-label text-sys-text-secondary text-xs">Режим навчання</span>
                  <div className="mt-1.5 flex gap-2">
                    {(["offline", "online"] as LearningMode[]).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        aria-pressed={draftOverride.mode === mode}
                        onClick={() => setDraftOverride({ ...draftOverride, mode })}
                        className={`min-h-[38px] flex-1 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                          draftOverride.mode === mode
                            ? "border-sys-accent bg-sys-accent/15 text-sys-accent shadow-xs"
                            : "border-sys-border bg-sys-bg text-sys-text-secondary hover:text-sys-text-primary"
                        }`}
                      >
                        {mode === "offline" ? "Очно" : "Дистанційно"}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <span className="form-label text-sys-text-secondary text-xs">Курси (порожньо — всі)</span>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      aria-pressed={draftOverride.courses.length === 0}
                      onClick={() => setDraftOverride({ ...draftOverride, courses: [] })}
                      className={`min-h-[34px] rounded-lg border px-3 py-1 text-xs font-semibold transition-colors cursor-pointer ${
                        draftOverride.courses.length === 0
                          ? "border-sys-accent bg-sys-accent/15 text-sys-accent shadow-xs"
                          : "border-sys-border bg-sys-bg text-sys-text-secondary hover:text-sys-text-primary"
                      }`}
                    >
                      Усі курси
                    </button>
                    {COURSES.map((course) => {
                      const active = draftOverride.courses.includes(course);
                      return (
                        <button
                          key={course}
                          type="button"
                          aria-pressed={active}
                          onClick={() => setDraftOverride({ ...draftOverride, courses: toggle(draftOverride.courses, course) })}
                          className={`min-h-[34px] rounded-lg border px-3 py-1 text-xs font-semibold transition-colors cursor-pointer ${
                            active
                              ? "border-sys-accent bg-sys-accent/15 text-sys-accent shadow-xs"
                              : "border-sys-border bg-sys-bg text-sys-text-secondary hover:text-sys-text-primary"
                          }`}
                        >
                          {course} курс
                        </button>
                      );
                    })}
                  </div>
                </div>
                <label className="block">
                  <span className="form-label text-sys-text-secondary text-xs">Пояснення для студентів (необов&apos;язково)</span>
                  <input
                    type="text"
                    maxLength={500}
                    placeholder="Наприклад: Дистанційне навчання через безпекову ситуацію"
                    value={draftOverride.reason ?? ""}
                    onChange={(event) => setDraftOverride({ ...draftOverride, reason: event.target.value })}
                    className="form-control mt-1 shadow-sm bg-sys-bg w-full text-sm"
                  />
                </label>
                <div className="flex items-center justify-end gap-2.5 pt-1">
                  {editingIndex !== null && (
                    <button
                      type="button"
                      onClick={cancelEditing}
                      disabled={saving}
                      className="rounded-lg border border-sys-border px-4 py-2 min-h-[38px] text-xs font-semibold text-sys-text-secondary hover:bg-sys-bg hover:text-sys-text-primary disabled:opacity-50 transition-colors cursor-pointer"
                    >
                      Скасувати
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={saving || !draftOverride.start || !draftOverride.end}
                    className="rounded-lg bg-sys-accent px-4 py-2 min-h-[38px] text-xs font-semibold text-white shadow-xs hover:opacity-95 disabled:opacity-50 transition-colors cursor-pointer"
                  >
                    {saving ? "Збереження…" : editingIndex !== null ? "Зберегти зміни" : "+ Додати виняток"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
