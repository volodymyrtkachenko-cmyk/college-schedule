"use client";
import { FormEvent, useEffect, useState } from "react";
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

export function LearningModePanel() {
  const [config, setConfig] = useState<LearningModeConfig>(EMPTY_CONFIG);
  const [draftOverride, setDraftOverride] = useState<LearningModeOverride>(EMPTY_OVERRIDE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

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
    let next = config;
    if (draftOverride.start && draftOverride.end && draftOverride.end >= draftOverride.start) {
      next = {
        ...config,
        overrides: [
          ...config.overrides,
          {
            ...draftOverride,
            reason: draftOverride.reason?.trim() || null,
          },
        ],
      };
      setDraftOverride(EMPTY_OVERRIDE);
    }
    void persist(next, "Цикл збережено.");
  }

  function addOverride(event: FormEvent<HTMLFormElement>) {
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
    const next = { ...config, overrides: [...config.overrides, normalized] };
    setDraftOverride(EMPTY_OVERRIDE);
    void persist(next, "Виняток додано.");
  }

  function removeOverride(index: number) {
    const next = { ...config, overrides: config.overrides.filter((_, i) => i !== index) };
    void persist(next, "Виняток видалено.");
  }

  return (
    <section className="max-w-[640px] space-y-5">
      <PageHeader
        eyebrow="НАЛАШТУВАННЯ"
        title="Режим навчання"
        description="Очне або дистанційне навчання по курсах. Режим міняється автоматично за циклом, а винятки дозволяють швидко перевести курс на дистанційне навчання."
      />

      {loading ? (
        <p className="text-sm text-sys-text-secondary">Завантаження налаштувань…</p>
      ) : (
        <>
          <form onSubmit={saveCycle} className="w-full rounded-2xl border border-sys-border bg-sys-card shadow-lg overflow-hidden">
            <div className="bg-gradient-to-b from-white/5 to-transparent p-6 pb-4 border-b border-sys-border/50">
              <h3 className="text-lg font-bold text-sys-text-primary">Автоматичний цикл</h3>
              <p className="mt-1 text-xs text-sys-text-secondary">Очні та дистанційні тижні чергуються від стартової дати</p>
            </div>
            <div className="px-6 py-5 space-y-4">
              <label className="block">
                <span className="form-label text-sys-text-secondary">Початок циклу (понеділок першого тижня)</span>
                <input
                  required
                  type="date"
                  value={config.cycle_start ?? ""}
                  onChange={(event) => setConfig({ ...config, cycle_start: event.target.value || null })}
                  className="form-control mt-1 shadow-sm bg-sys-bg w-full"
                />
              </label>
              <label className="block">
                <span className="form-label text-sys-text-secondary">Тижнів у кожній фазі</span>
                <input
                  type="number"
                  min={1}
                  max={8}
                  value={config.weeks_per_phase}
                  onChange={(event) => setConfig({ ...config, weeks_per_phase: Number(event.target.value) })}
                  className="form-control mt-1 shadow-sm bg-sys-bg w-full"
                />
              </label>
              <div>
                <span className="form-label text-sys-text-secondary">Очно в першій фазі</span>
                <div className="mt-2 flex flex-wrap gap-2">
                  {COURSES.map((course) => {
                    const active = config.first_phase_offline_courses.includes(course);
                    return (
                      <button
                        key={course}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setConfig({ ...config, first_phase_offline_courses: toggle(config.first_phase_offline_courses, course) })}
                        className={`min-h-[44px] sm:min-h-0 rounded-lg border px-4 py-2 text-sm font-semibold transition-colors ${
                          active
                            ? "border-sys-accent bg-sys-accent/15 text-sys-accent"
                            : "border-sys-border bg-sys-bg text-sys-text-secondary"
                        }`}
                      >
                        {course} курс
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 text-xs text-sys-text-muted">Інші курси в першій фазі навчаються дистанційно.</p>
              </div>
            </div>
            <div className="bg-sys-bg/30 px-6 py-4 flex justify-end border-t border-sys-border/50">
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-sys-accent px-5 py-2.5 min-h-[44px] sm:min-h-0 text-sm font-semibold text-white shadow-xs hover:opacity-95 disabled:opacity-50 transition-colors"
              >
                Зберегти цикл
              </button>
            </div>
          </form>

          <div className="w-full rounded-2xl border border-sys-border bg-sys-card shadow-lg overflow-hidden">
            <div className="bg-gradient-to-b from-white/5 to-transparent p-6 pb-4 border-b border-sys-border/50">
              <h3 className="text-lg font-bold text-sys-text-primary">Винятки</h3>
              <p className="mt-1 text-xs text-sys-text-secondary">Наприклад, дистанційний день або тиждень через небезпеку. Має пріоритет над циклом.</p>
            </div>
            <div className="px-6 py-5 space-y-4">
              {config.overrides.length === 0 ? (
                <p className="text-sm text-sys-text-muted">Винятків немає.</p>
              ) : (
                <ul className="space-y-2">
                  {config.overrides.map((override, index) => (
                    <li key={`${override.start}-${override.end}-${index}`} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-sys-border bg-sys-bg/60 px-3 py-2.5 text-sm">
                      <div className="flex flex-col gap-1 min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-sys-text-primary">
                          <span className="font-semibold">
                            {override.start === override.end ? override.start : `${override.start} – ${override.end}`}
                          </span>
                          <span
                            className={`rounded-full border px-2 py-0.5 text-xs font-bold ${
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
                        </div>
                        {override.reason && (
                          <p className="text-xs text-sys-text-secondary whitespace-normal break-words">
                            {override.reason}
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => removeOverride(index)}
                        disabled={saving}
                        className="min-h-[44px] sm:min-h-0 px-2 text-xs font-semibold text-rose-400 hover:underline disabled:opacity-50 shrink-0"
                      >
                        Видалити
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <form onSubmit={addOverride} className="space-y-3 rounded-xl border border-sys-border/80 bg-sys-bg/40 p-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="block">
                    <span className="form-label text-sys-text-secondary">З</span>
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
                      className="form-control mt-1 shadow-sm bg-sys-bg w-full"
                    />
                  </label>
                  <label className="block">
                    <span className="form-label text-sys-text-secondary">По</span>
                    <input
                      required
                      type="date"
                      min={draftOverride.start || undefined}
                      value={draftOverride.end}
                      onChange={(event) => setDraftOverride({ ...draftOverride, end: event.target.value })}
                      className="form-control mt-1 shadow-sm bg-sys-bg w-full"
                    />
                  </label>
                </div>
                <div>
                  <span className="form-label text-sys-text-secondary">Режим</span>
                  <div className="mt-2 flex gap-2">
                    {(["offline", "online"] as LearningMode[]).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        aria-pressed={draftOverride.mode === mode}
                        onClick={() => setDraftOverride({ ...draftOverride, mode })}
                        className={`min-h-[44px] sm:min-h-0 flex-1 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
                          draftOverride.mode === mode
                            ? "border-sys-accent bg-sys-accent/15 text-sys-accent"
                            : "border-sys-border bg-sys-bg text-sys-text-secondary"
                        }`}
                      >
                        {mode === "offline" ? "Очно" : "Дистанційно"}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <span className="form-label text-sys-text-secondary">Курси (порожньо — всі)</span>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      aria-pressed={draftOverride.courses.length === 0}
                      onClick={() => setDraftOverride({ ...draftOverride, courses: [] })}
                      className={`min-h-[44px] sm:min-h-0 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
                        draftOverride.courses.length === 0
                          ? "border-sys-accent bg-sys-accent/15 text-sys-accent"
                          : "border-sys-border bg-sys-bg text-sys-text-secondary"
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
                          className={`min-h-[44px] sm:min-h-0 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
                            active
                              ? "border-sys-accent bg-sys-accent/15 text-sys-accent"
                              : "border-sys-border bg-sys-bg text-sys-text-secondary"
                          }`}
                        >
                          {course} курс
                        </button>
                      );
                    })}
                  </div>
                </div>
                <label className="block">
                  <span className="form-label text-sys-text-secondary">Пояснення для студентів (необов&apos;язково)</span>
                  <input
                    type="text"
                    maxLength={500}
                    placeholder="Наприклад: Дистанційне навчання через безпекову ситуацію"
                    value={draftOverride.reason ?? ""}
                    onChange={(event) => setDraftOverride({ ...draftOverride, reason: event.target.value })}
                    className="form-control mt-1 shadow-sm bg-sys-bg w-full"
                  />
                </label>
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={saving || !draftOverride.start || !draftOverride.end}
                    className="rounded-lg bg-sys-accent px-5 py-2.5 min-h-[44px] sm:min-h-0 text-sm font-semibold text-white shadow-xs hover:opacity-95 disabled:opacity-50 transition-colors"
                  >
                    Додати виняток
                  </button>
                </div>
              </form>
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-400">
              <p>{error}</p>
            </div>
          )}
          {success && (
            <div className="flex items-start gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-400">
              <p>{success}</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
