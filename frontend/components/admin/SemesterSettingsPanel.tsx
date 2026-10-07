"use client";

import { FormEvent, useEffect, useState } from "react";
import { api } from "../../lib/api";

export function SemesterSettingsPanel() {
  const [semesterStart, setSemesterStart] = useState("");
  const [semesterEnd, setSemesterEnd] = useState("");
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

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
    return () => { active = false; };
  }, []);

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

  return (
    <section className="max-w-2xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Налаштування семестру</h1>
        <p className="mt-2 text-sm text-sys-text-secondary">
          Вкажіть дати поточного семестру. Вони застосовуються до всіх груп і викладачів.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-sys-text-secondary">Завантаження налаштувань…</p>
      ) : (
        <form onSubmit={save} className="w-full max-w-md rounded-2xl border border-sys-border bg-sys-card shadow-lg overflow-hidden">
          <div className="bg-gradient-to-b from-white/5 to-transparent p-6 pb-4 border-b border-sys-border/50">
            <h3 className="text-lg font-bold text-sys-text-primary">Параметри семестру</h3>
            <p className="mt-1 text-sm text-sys-text-secondary">Вкажіть базові дати для коректного розрахунку чисельника/знаменника.</p>
          </div>
          <div className="px-6 py-5 space-y-5">
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
          
          <div className="bg-sys-bg/30 px-6 py-4 flex items-center justify-between border-t border-sys-border/50">
            <span className="flex items-center gap-1.5 text-xs font-medium text-sys-text-muted">
              <span className={`h-2 w-2 rounded-full ${configured ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]"}`}></span>
              {configured ? "Налаштовано" : "Не налаштовано"}
            </span>
            <button
              type="submit"
              disabled={saving || loading}
              className="flex items-center gap-2 rounded-lg bg-sys-accent px-5 py-2 text-sm font-medium text-[#0b1120] hover:opacity-90 disabled:opacity-50 transition-colors"
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
    </section>
  );
}
