"use client";
import { useEffect, useId, useRef, useState } from "react";
import { api, Lesson, NoteRevision } from "../lib/api";
import { useAuth } from "../lib/auth";
import { invalidateScheduleCache, useOnlineStatus } from "../lib/hooks";
import { getVisibleUserNote } from "./LessonCard";

export function LessonNote({ lesson, date }: { lesson: Lesson; date: string }) {
  const cleanDisplayNote = (lesson.note || "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("[TASK]"))
    .join("\n")
    .trim();

  const visibleNote = getVisibleUserNote(cleanDisplayNote);

  if (!visibleNote) {
    return null;
  }

  return (
    <p className="mt-1 flex items-center gap-1.5 text-xs text-sys-text-secondary/90 [overflow-wrap:anywhere] italic border-t border-sys-border/20 pt-1">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-sys-text-muted">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
      <span>{visibleNote}</span>
    </p>
  );
}

export function LessonNoteModal({
  lesson,
  date,
  initialMode = "edit",
  onClose,
}: {
  lesson: Lesson;
  date: string;
  initialMode?: "edit" | "history";
  onClose: () => void;
}) {
  const { user } = useAuth();
  const online = useOnlineStatus();
  const labelId = useId();
  const mounted = useRef(true);
  const [note, setNote] = useState(lesson.note ?? "");
  const [revision, setRevision] = useState(lesson.note_revision ?? 0);
  const [draft, setDraft] = useState(
    getVisibleUserNote(
      (lesson.note || "")
        .split("\n")
        .filter((l) => !l.trim().startsWith("[TASK]"))
        .join("\n")
        .trim()
    )
  );
  const [mode, setMode] = useState<"edit" | "history">(initialMode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<NoteRevision[] | null>(null);
  const groupId = lesson.group_id;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (mode === "history" && !history) {
      void fetchHistory();
    }
  }, [mode]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  async function fetchHistory() {
    if (!groupId) return;
    setBusy(true);
    setError(null);
    try {
      const rows = await api.notes.history(groupId, date, lesson.lesson_number);
      if (mounted.current) setHistory(rows);
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : "Не вдалося завантажити історію.");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  async function saveNote(remove: boolean = false) {
    if (!groupId) return;
    if (!online) {
      setError("Немає зв'язку з мережею.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (remove) {
        await api.notes.remove(groupId, date, lesson.lesson_number, lesson.subject_id, revision);
        setNote("");
        setDraft("");
      } else {
        const saved = await api.notes.save(groupId, date, lesson.lesson_number, lesson.subject_id, draft, revision);
        setNote(saved.note);
        setDraft(saved.note);
      }
      try {
        invalidateScheduleCache();
      } catch {
        window.dispatchEvent(new Event("schedule:refresh"));
      }
      onClose();
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : "Не вдалося зберегти примітку.");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="flex max-h-[92dvh] w-full max-w-md flex-col rounded-t-2xl sm:rounded-2xl border border-sys-border bg-sys-card shadow-2xl overflow-hidden pb-safe animate-in slide-in-from-bottom-6 sm:slide-in-from-bottom-2 duration-200"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-sys-border/50 px-5 py-4">
          <div>
            <h3 className="text-base font-bold text-sys-text-primary">
              {mode === "edit" ? "Примітка до пари" : "Історія змін примітки"}
            </h3>
            <p className="text-xs text-sys-text-secondary mt-0.5">
              {date}, {lesson.lesson_number}-та пара · {lesson.subject_name}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрити"
            className="w-8 h-8 flex items-center justify-center rounded-lg text-sys-text-secondary hover:bg-white/5 hover:text-sys-text-primary"
          >
            ✕
          </button>
        </div>

        {/* Tab switch between Edit and History */}
        <div className="flex border-b border-sys-border/40 px-5 pt-2 gap-4 text-xs font-semibold">
          <button
            type="button"
            onClick={() => setMode("edit")}
            className={`pb-2 border-b-2 transition-colors ${
              mode === "edit"
                ? "border-sys-accent text-sys-accent"
                : "border-transparent text-sys-text-secondary hover:text-sys-text-primary"
            }`}
          >
            Редагування
          </button>
          <button
            type="button"
            onClick={() => setMode("history")}
            className={`pb-2 border-b-2 transition-colors ${
              mode === "history"
                ? "border-sys-accent text-sys-accent"
                : "border-transparent text-sys-text-secondary hover:text-sys-text-primary"
            }`}
          >
            Історія
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {mode === "edit" ? (
            <form
              id="lesson-note-form"
              onSubmit={(e) => {
                e.preventDefault();
                void saveNote(false);
              }}
              className="space-y-4"
            >
              <label htmlFor={labelId} className="block text-xs font-medium text-sys-text-secondary">
                Текст примітки (видимий студентам та викладачам)
              </label>
              <textarea
                id={labelId}
                rows={4}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Введіть важливу інформацію щодо пари…"
                disabled={busy}
                className="form-control w-full p-3 text-sm text-sys-text-primary"
              />
              {error && (
                <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-2.5 text-xs text-rose-400">
                  {error}
                </div>
              )}
            </form>
          ) : (
            <div className="space-y-3">
              {busy ? (
                <p className="text-center text-xs text-sys-text-secondary py-4">Завантаження історії…</p>
              ) : history && history.length > 0 ? (
                history.map((row) => (
                  <div key={`${row.note_id}:${row.revision}`} className="rounded-lg border border-sys-border/60 bg-sys-bg/40 p-3 text-xs space-y-1">
                    <div className="flex items-center justify-between text-sys-text-muted">
                      <span>{row.snapshot.actor_name ?? "Система"}</span>
                      <span>{row.snapshot.note_date}</span>
                    </div>
                    <p className="text-sys-text-primary whitespace-pre-wrap">{row.snapshot.note}</p>
                    {row.snapshot.archived && (
                      <span className="inline-block text-xs text-rose-400 uppercase font-semibold">Архівовано</span>
                    )}
                  </div>
                ))
              ) : (
                <p className="text-center text-xs text-sys-text-muted py-6">Історія змін порожня.</p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 z-10 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-2.5 border-t border-sys-border/50 bg-sys-bg/80 backdrop-blur-xs p-4 sm:px-5 sm:py-3.5">
          {mode === "edit" ? (
            <>
              {note ? (
                <button
                  type="button"
                  disabled={busy || !online}
                  onClick={() => {
                    if (confirm("Архівувати примітку? Текст залишиться в історії.")) {
                      void saveNote(true);
                    }
                  }}
                  className="w-full sm:w-auto min-h-[44px] sm:min-h-[38px] px-3.5 py-2 text-xs sm:text-sm font-semibold text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors border border-rose-500/20 active:scale-[0.98]"
                >
                  Видалити
                </button>
              ) : (
                <div />
              )}
              <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center gap-2.5">
                <button
                  type="button"
                  onClick={onClose}
                  className="w-full sm:w-auto min-h-[44px] sm:min-h-[38px] px-4 py-2 text-xs sm:text-sm font-semibold text-sys-text-secondary hover:text-sys-text-primary rounded-lg border border-sys-border bg-sys-card transition-colors active:scale-[0.98]"
                >
                  Скасувати
                </button>
                <button
                  type="submit"
                  form="lesson-note-form"
                  disabled={busy || !online}
                  className="w-full sm:w-auto min-h-[44px] sm:min-h-[38px] px-5 py-2 text-xs sm:text-sm font-semibold text-white shadow-xs bg-sys-accent hover:opacity-95 active:scale-[0.98] rounded-lg transition-all disabled:opacity-50"
                >
                  {busy ? "Збереження…" : "Зберегти"}
                </button>
              </div>
            </>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="w-full sm:w-auto ml-auto min-h-[44px] sm:min-h-[38px] px-5 py-2 text-xs sm:text-sm font-semibold text-sys-text-primary bg-sys-card border border-sys-border rounded-lg hover:bg-white/5 active:scale-[0.98]"
            >
              Закрити
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
