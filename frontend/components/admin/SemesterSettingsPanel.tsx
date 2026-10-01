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
        <form onSubmit={save} className="space-y-5 rounded-xl border border-sys-border bg-sys-card p-5">
          <label className="block">
            <span className="form-label">Початок семестру</span>
            <input
              required
              type="date"
              value={semesterStart}
              onChange={(event) => setSemesterStart(event.target.value)}
              className="form-control mt-1 w-full"
            />
          </label>
          <label className="block">
            <span className="form-label">Завершення семестру</span>
            <input
              required
              type="date"
              min={semesterStart || undefined}
              value={semesterEnd}
              onChange={(event) => setSemesterEnd(event.target.value)}
              className="form-control mt-1 w-full"
            />
          </label>

          {error && <p role="alert" className="text-sm text-rose-400">{error}</p>}
          {success && <p role="status" className="text-sm text-emerald-400">{success}</p>}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={saving || loading}
              className="rounded-lg bg-sys-accent px-4 py-2 text-sm font-semibold text-[#0b1120] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Збереження…" : "Зберегти дати"}
            </button>
            <span className="text-xs text-sys-text-muted">
              {configured ? "Дати налаштовано" : "Дати ще не налаштовано"}
            </span>
          </div>
        </form>
      )}
    </section>
  );
}
