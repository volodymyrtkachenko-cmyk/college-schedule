"use client";
import { useEffect, useId, useRef, useState } from "react";
import { api, Lesson, NoteRevision } from "../lib/api";
import { useAuth } from "../lib/auth";
import { invalidateScheduleCache, useOnlineStatus } from "../lib/hooks";

export function LessonNote({ lesson, date }: { lesson: Lesson; date: string }) {
  const { user } = useAuth();
  const online = useOnlineStatus();
  const labelId = useId();
  const mounted = useRef(true);
  const [note, setNote] = useState(lesson.note ?? "");
  const [revision, setRevision] = useState(lesson.note_revision ?? 0);
  const [draft, setDraft] = useState(note);
  const [editing, setEditing] = useState(false);
  const [editRevision, setEditRevision] = useState(revision);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<NoteRevision[] | null>(null);
  const groupId = lesson.group_id;
  const canManage = !!groupId && (user?.role === "admin" ||
    (user?.role === "editor" && !!user.allowed_groups?.includes(groupId)));

  useEffect(() => { setHistory(null); setEditing(false); setDraft(note); }, [user?.id, user?.role, JSON.stringify(user?.allowed_groups)]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    setNote(lesson.note ?? "");
    setRevision(lesson.note_revision ?? 0);
    // Never replace the user's unsaved text after a background refresh.
  }, [lesson.note, lesson.note_revision]);

  async function mutate(remove: boolean) {
    if (!groupId || !canManage || pending.current) return;
    if (!online) { setError("Немає мережі. Текст залишився у формі; збережіть після підключення."); return; }
    const generation = api.auth.generation();
    pending.current = true;
    setBusy(true); setError(null);
    try {
      if (remove) {
        await api.notes.remove(groupId, date, lesson.lesson_number, lesson.subject_id, editRevision);
        if (!mounted.current || generation !== api.auth.generation()) return;
        setNote(""); setRevision(0); setDraft("");
      } else {
        const saved = await api.notes.save(groupId, date, lesson.lesson_number, lesson.subject_id, draft, editRevision);
        if (!mounted.current || generation !== api.auth.generation()) return;
        setNote(saved.note); setRevision(saved.revision); setDraft(saved.note);
      }
      setEditing(false); setHistory(null);
      // A denied browser storage operation must not turn a committed save into a failure.
      try { invalidateScheduleCache(); } catch { window.dispatchEvent(new Event("schedule:refresh")); }
    } catch (e) {
      if (mounted.current && generation === api.auth.generation()) {
        setError(e instanceof Error ? e.message : "Не вдалося зберегти примітку.");
      }
    } finally { pending.current = false; if (mounted.current) setBusy(false); }
  }

  async function showHistory() {
    if (!groupId || pending.current) return;
    const generation = api.auth.generation();
    pending.current = true;
    setBusy(true); setError(null);
    try {
      const rows = await api.notes.history(groupId, date, lesson.lesson_number);
      if (mounted.current && generation === api.auth.generation()) setHistory(rows);
    } catch (e) {
      if (mounted.current && generation === api.auth.generation()) setError(e instanceof Error ? e.message : "Не вдалося завантажити історію.");
    } finally { pending.current = false; if (mounted.current) setBusy(false); }
  }

  return <section aria-label="Примітка до конкретної пари" className="mt-3 border-t border-sys-border pt-2 text-sm"
    onClick={e => e.stopPropagation()} onDragStart={e => { e.preventDefault(); e.stopPropagation(); }}>
    {note && <p className="whitespace-pre-wrap break-words text-sys-text-secondary">{note}</p>}
    {canManage && !editing && <div className="mt-1 flex flex-wrap gap-3">
      <button type="button" disabled={busy} onClick={() => { setDraft(note); setEditRevision(revision); setEditing(true); setError(null); }}
        className="text-sys-accent disabled:opacity-50">{note ? "Редагувати примітку" : "+ Примітка"}</button>
      <button type="button" disabled={busy || !online} onClick={showHistory} className="text-sys-text-secondary">Історія</button>
    </div>}
    {canManage && editing && <form onSubmit={e => { e.preventDefault(); void mutate(false); }} className="space-y-2">
      <label htmlFor={labelId} className="block text-sys-text-secondary">Примітка на {date}, {lesson.lesson_number}-ту пару</label>
      <textarea id={labelId} value={draft} onChange={e => setDraft(e.target.value)} maxLength={10000} rows={3}
        disabled={busy} required className="w-full rounded-lg border border-sys-border bg-sys-bg p-2 text-sys-text-primary" />
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={busy || !online || !draft.trim()} className="text-sys-accent disabled:opacity-50">{busy ? "Зберігаємо…" : "Зберегти"}</button>
        <button type="button" disabled={busy} onClick={() => setEditing(false)}>Скасувати</button>
        {note && <button type="button" disabled={busy || !online} onClick={() => {
          if (window.confirm("Архівувати примітку? Текст залишиться в історії.")) void mutate(true);
        }} className="text-rose-300">Архівувати</button>}
      </div>
      {!online && <p role="status">Без мережі збереження недоступне.</p>}
    </form>}
    {error && <p role="alert" className="mt-2 text-rose-300">{error}</p>}
    {canManage && history && <div className="mt-2 space-y-2">
      <button type="button" onClick={() => setHistory(null)} className="text-sys-text-secondary">Закрити історію</button>
      <p className="text-xs text-sys-text-muted">Останні 100 змін. Повна історія зберігається в базі.</p>
      {history.length === 0 && <p>Історія порожня.</p>}
      {history.map(row => <div key={`${row.note_id}:${row.revision}`} className="rounded border border-sys-border p-2">
        <p className="text-xs text-sys-text-muted">{row.snapshot.subject_name} · {row.snapshot.actor_name ?? "Система"} · {row.snapshot.note_date} · ревізія {row.revision}{row.snapshot.archived ? " · архів" : ""}</p>
        <p className="whitespace-pre-wrap break-words">{row.snapshot.note}</p>
      </div>)}
    </div>}
  </section>;
}
