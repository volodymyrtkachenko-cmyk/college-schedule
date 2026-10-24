"use client";
import { FormEvent, useEffect, useState } from "react";
import { ShortenedDayItem, api } from "../../lib/api";
import { PageHeader } from "./PageHeader";

export function SemesterSettingsPanel() {
  const [semesterStart, setSemesterStart] = useState("");
  const [semesterEnd, setSemesterEnd] = useState("");
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [shortenedDays, setShortenedDays] = useState<ShortenedDayItem[]>([]);
  const [shortenedLoading, setShortenedLoading] = useState(true);
  const [newShortenedDate, setNewShortenedDate] = useState("");
  const [newShortenedReason, setNewShortenedReason] = useState("");
  const [shortenedActionLoading, setShortenedActionLoading] = useState(false);
  const [shortenedError, setShortenedError] = useState<string | null>(null);
  const [shortenedSuccess, setShortenedSuccess] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api.settings.semesterDates()
      .then((settings) => {
        if (!active) return;
        setSemesterStart(settings.semester_start ?? "");
        setSemesterEnd(settings.semester_end ?? "");
        setConfigured(settings.configured);
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : "Не вдалося завантажити дати семестру.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    api.settings.shortenedDays.list()
      .then((items) => {
        if (active) setShortenedDays(items);
      })
      .catch(() => {
        // non-blocking
      })
      .finally(() => {
        if (active) setShortenedLoading(false);
      });

    return () => { active = false; };
  }, []);

  async function handleAddShortenedDay(e: FormEvent) {
    e.preventDefault();
    if (!newShortenedDate) return;
    setShortenedError(null);
    setShortenedSuccess(null);
    setShortenedActionLoading(true);
    try {
      const session = await api.auth.ensureAuthenticated();
      const updated = await api.settings.shortenedDays.add({
        date: newShortenedDate,
        reason: newShortenedReason.trim() || undefined,
      }, session.access_token);
      setShortenedDays(updated);
      setNewShortenedDate("");
      setNewShortenedReason("");
      setShortenedSuccess("Скорочений день додано.");
    } catch (cause) {
      setShortenedError(cause instanceof Error ? cause.message : "Не вдалося додати скорочений день.");
    } finally {
      setShortenedActionLoading(false);
    }
  }

  async function handleDeleteShortenedDay(dateStr: string) {
    setShortenedError(null);
    setShortenedSuccess(null);
    setShortenedActionLoading(true);
    try {
      const session = await api.auth.ensureAuthenticated();
      const updated = await api.settings.shortenedDays.delete(dateStr, session.access_token);
      setShortenedDays(updated);
      setShortenedSuccess("Скорочений день видалено.");
    } catch (cause) {
      setShortenedError(cause instanceof Error ? cause.message : "Не вдалося видалити скорочений день.");
    } finally {
      setShortenedActionLoading(false);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    if (semesterEnd < semesterStart) {
      setError("Дата завершення не може бути раніше дати початку.");
      return;
    }

    setSaving(true);
    try {
      const session = await api.auth.ensureAuthenticated();
      const settings = await api.settings.updateSemesterDates({
        semester_start: semesterStart,
        semester_end: semesterEnd,
      }, session.access_token);
      setConfigured(settings.configured);
      setSuccess("Дати семестру збережено.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося зберегти дати семестру.");
    } finally {
      setSaving(false);
    }
  }

  const preview = (() => {
    if (!semesterStart) return null;
    const start = new Date(`${semesterStart}T00:00:00`);
    if (isNaN(start.getTime())) return null;

    const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(new Date());
    const today = new Date(`${todayStr}T00:00:00`);

    const startDay = (start.getDay() + 6) % 7;
    const startMonday = new Date(start);
    startMonday.setDate(start.getDate() - startDay);

    const todayDay = (today.getDay() + 6) % 7;
    const todayMonday = new Date(today);
    todayMonday.setDate(today.getDate() - todayDay);

    const diffDays = Math.round((todayMonday.getTime() - startMonday.getTime()) / (1000 * 60 * 60 * 24));
    const weekDiff = Math.floor(diffDays / 7);
    const weekNumber = weekDiff + 1;
    const weekType: "numerator" | "denominator" = (weekDiff % 2 === 0 || (weekDiff < 0 && Math.abs(weekDiff) % 2 === 0)) ? "numerator" : "denominator";

    const isBefore = semesterStart > todayStr;
    const isAfter = semesterEnd && semesterEnd < todayStr;

    return {
      todayStr,
      weekNumber,
      weekType,
      isBefore,
      isAfter,
    };
  })();

  return (
    <section className="max-w-[520px] space-y-5">
      <PageHeader
        eyebrow="НАЛАШТУВАННЯ"
        title="Налаштування семестру"
        description="Вкажіть базові дати семестру для автоматичного розрахунку номера тижня та чисельника/знаменника."
      />

      {loading ? (
        <p className="text-sm text-sys-text-secondary">Завантаження налаштувань…</p>
      ) : (
        <form onSubmit={save} className="w-full max-w-md rounded-2xl border border-sys-border bg-sys-card shadow-lg overflow-hidden">
          <div className="bg-gradient-to-b from-white/5 to-transparent p-6 pb-4 border-b border-sys-border/50">
            <h3 className="text-lg font-bold text-sys-text-primary">Параметри семестру</h3>
            <p className="mt-1 text-xs text-sys-text-secondary">Дати для визначення чергування чисельника та знаменника</p>
          </div>
          <div className="px-6 py-5 space-y-4">
            <label className="block">
              <span className="form-label text-sys-text-secondary">Початок семестру</span>
              <input
                required
                type="date"
                value={semesterStart}
                onChange={(event) => setSemesterStart(event.target.value)}
                className="form-control mt-1 shadow-sm bg-sys-bg w-full"
              />
            </label>
            <label className="block">
              <span className="form-label text-sys-text-secondary">Завершення семестру</span>
              <input
                required
                type="date"
                min={semesterStart || undefined}
                value={semesterEnd}
                onChange={(event) => setSemesterEnd(event.target.value)}
                className="form-control mt-1 shadow-sm bg-sys-bg w-full"
              />
            </label>

            {preview && (
              <div className="rounded-xl border border-sys-border/80 bg-sys-bg/60 p-4 space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-sys-text-muted uppercase tracking-wider">
                  <span>Розрахунок на сьогодні</span>
                  <span className="font-mono text-sys-text-secondary">{preview.todayStr}</span>
                </div>
                <div className="flex items-center justify-between gap-2 pt-1">
                  <div className="text-sm font-medium text-sys-text-primary">
                    {preview.isBefore ? (
                      <span className="text-amber-400">Семестр ще не розпочався</span>
                    ) : preview.isAfter ? (
                      <span className="text-sys-text-muted">Семестр вже завершився</span>
                    ) : (
                      <span>{preview.weekNumber}-й тиждень семестру</span>
                    )}
                  </div>
                  <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                    preview.weekType === "numerator"
                      ? "bg-amber-400/15 text-amber-300 border border-amber-400/20"
                      : "bg-emerald-400/15 text-emerald-300 border border-emerald-400/20"
                  }`}>
                    {preview.weekType === "numerator" ? "Чисельник" : "Знаменник"}
                  </span>
                </div>
              </div>
            )}

            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-400">
                <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
                <p>{error}</p>
              </div>
            )}
            
            {success && (
              <div className="flex items-start gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-400">
                <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                <p>{success}</p>
              </div>
            )}
          </div>
          
          <div className="bg-sys-bg/30 px-6 py-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 border-t border-sys-border/50">
            <span className="flex items-center gap-1.5 text-xs font-medium text-sys-text-muted">
              <span className={`h-2 w-2 rounded-full ${configured ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]"}`}></span>
              {configured ? "Налаштовано" : "Не налаштовано"}
            </span>
            <button
              type="submit"
              disabled={saving || loading}
              className="flex items-center justify-center gap-2 rounded-lg bg-sys-accent px-5 py-2.5 min-h-[44px] sm:min-h-0 text-sm font-semibold text-white shadow-xs hover:opacity-95 disabled:opacity-50 transition-colors w-full sm:w-auto"
            >
              {saving ? (
                <>
                  <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                  Збереження...
                </>
              ) : (
                "Зберегти дати"
              )}
            </button>
          </div>
        </form>
      )}

      {/* Скорочені навчальні дні (пари по 50 хв) */}
      <div className="w-full max-w-md rounded-2xl border border-sys-border bg-sys-card shadow-lg overflow-hidden">
        <div className="bg-gradient-to-b from-white/5 to-transparent p-6 pb-4 border-b border-sys-border/50">
          <div className="flex items-center gap-2">
            <span className="text-xl">⏱</span>
            <h3 className="text-lg font-bold text-sys-text-primary">Скорочені дні (пари по 50 хв)</h3>
          </div>
          <p className="mt-1 text-xs text-sys-text-secondary">
            Одноразові дні зі спеціальним розкладом дзвінків (початок о 09:00, пари по 50 хв, перерви по 10 хв).
          </p>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Info callout */}
          <div className="rounded-xl border border-sys-border/80 bg-sys-bg/60 p-3.5 space-y-2 text-xs">
            <div className="font-semibold text-sys-text-primary flex items-center gap-1.5">
              <span>🔔 Розклад дзвінків скороченого дня:</span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sys-text-secondary font-mono text-[11px]">
              <div>1 пара: 09:00 – 09:50</div>
              <div>2 пара: 10:00 – 10:50</div>
              <div>3 пара: 11:00 – 11:50</div>
              <div>4 пара: 12:00 – 12:50</div>
              <div className="col-span-2">5 пара: 13:00 – 13:50</div>
            </div>
            <p className="text-[11px] text-sys-text-muted pt-1 border-t border-sys-border/40">
              Усі перерви — рівно 10 хвилин. У розкладі день автоматично отримує позначку «⏱ 50 хв».
            </p>
          </div>

          {/* List of active shortened days */}
          <div className="space-y-2">
            <span className="text-xs font-semibold text-sys-text-secondary uppercase tracking-wider">
              Заплановані скорочені дні ({shortenedDays.length})
            </span>
            {shortenedLoading ? (
              <p className="text-xs text-sys-text-muted">Завантаження...</p>
            ) : shortenedDays.length === 0 ? (
              <p className="text-xs text-sys-text-muted italic py-1">
                Немає скорочених днів. Ви можете додати один нижче або через меню дня «⋮» у редакторі розкладу.
              </p>
            ) : (
              <div className="divide-y divide-sys-border/50 rounded-xl border border-sys-border/80 bg-sys-bg/40 overflow-hidden">
                {shortenedDays.map((item) => {
                  const formattedDate = new Intl.DateTimeFormat("uk-UA", {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  }).format(new Date(`${item.date}T12:00:00`));
                  return (
                    <div key={item.date} className="flex items-center justify-between gap-3 p-3 text-xs">
                      <div className="min-w-0">
                        <div className="font-medium text-sys-text-primary capitalize">
                          {formattedDate}
                        </div>
                        {item.reason && (
                          <div className="text-[11px] text-sys-text-muted truncate">
                            {item.reason}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        disabled={shortenedActionLoading}
                        onClick={() => void handleDeleteShortenedDay(item.date)}
                        aria-label={`Видалити скорочений день ${item.date}`}
                        title="Скасувати скорочений день"
                        className="p-1.5 rounded-lg text-sys-text-muted hover:text-rose-400 hover:bg-rose-500/10 transition-colors disabled:opacity-50"
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Add shortened day form */}
          <form onSubmit={handleAddShortenedDay} className="pt-2 space-y-3 border-t border-sys-border/50">
            <span className="text-xs font-semibold text-sys-text-secondary uppercase tracking-wider">
              Додати скорочений день
            </span>
            <div className="space-y-2">
              <input
                required
                type="date"
                value={newShortenedDate}
                onChange={(e) => setNewShortenedDate(e.target.value)}
                className="form-control text-xs shadow-sm bg-sys-bg w-full"
              />
              <input
                type="text"
                placeholder="Причина (наприклад: Передсвятковий день, Педрада)"
                value={newShortenedReason}
                onChange={(e) => setNewShortenedReason(e.target.value)}
                maxLength={255}
                className="form-control text-xs shadow-sm bg-sys-bg w-full"
              />
            </div>

            {shortenedError && (
              <div className="flex items-start gap-2 rounded-lg border border-rose-500/20 bg-rose-500/10 p-2.5 text-xs text-rose-400">
                <p>{shortenedError}</p>
              </div>
            )}
            {shortenedSuccess && (
              <div className="flex items-start gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-2.5 text-xs text-emerald-400">
                <p>{shortenedSuccess}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={shortenedActionLoading || !newShortenedDate}
              className="w-full flex items-center justify-center gap-2 rounded-lg border border-sys-border bg-white/5 px-4 py-2 text-xs font-semibold text-sys-text-primary hover:bg-white/10 active:scale-[0.99] transition-all disabled:opacity-50"
            >
              + Додати скорочений день
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}
