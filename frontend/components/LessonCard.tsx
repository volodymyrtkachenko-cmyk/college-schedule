import { FormEvent, useState } from "react";
import { Lesson } from "../lib/api";
import { formatTeacherName } from "../lib/format";

function renderNote(note: string) {
  const parts = note.split(/(https?:\/\/[^\s<>"']+)/g);
  return parts.map((part, index) => {
    if (!/^https?:\/\//i.test(part)) return <span key={index}>{part}</span>;
    let href: string;
    try {
      const url = new URL(part);
      if (url.protocol !== "http:" && url.protocol !== "https:") return <span key={index}>{part}</span>;
      href = url.toString();
    } catch {
      return <span key={index}>{part}</span>;
    }
    return <a key={index} href={href} target="_blank" rel="noopener noreferrer" className="break-all text-cyan-300 underline underline-offset-2 hover:text-cyan-200">{part}</a>;
  });
}

export function LessonCard({ lesson, targetDate, canEdit = false, onEdit, onNoteSave, onNoteDelete }: {
  lesson: Lesson; targetDate: string; canEdit?: boolean; onEdit?: (lesson: Lesson) => void;
  onNoteSave?: (note: string) => Promise<void>; onNoteDelete?: () => Promise<void>;
}) {
  const [editingNote, setEditingNote] = useState(false);
  const [note, setNote] = useState(lesson.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noteForDate = lesson.note && (!lesson.note_date || lesson.note_date === targetDate) ? lesson.note : null;
  const submitNote = async (event: FormEvent) => {
    event.preventDefault();
    if (!onNoteSave || !note.trim()) return;
    setBusy(true); setError(null);
    try { await onNoteSave(note.trim()); setEditingNote(false); }
    catch (e) { setError(e instanceof Error ? e.message : "Не вдалося зберегти примітку"); }
    finally { setBusy(false); }
  };
  const deleteNote = async () => {
    if (!onNoteDelete || !window.confirm("Видалити примітку?")) return;
    setBusy(true); setError(null);
    try { await onNoteDelete(); setNote(""); setEditingNote(false); }
    catch (e) { setError(e instanceof Error ? e.message : "Не вдалося видалити примітку"); }
    finally { setBusy(false); }
  };
  return (
    <article
      className={`min-w-0 overflow-hidden rounded-xl border border-slate-800 bg-slate-900/90 p-3 shadow-sm transition ${
        lesson.is_relevant_this_week ? "" : "opacity-40 grayscale"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-[3.25rem] text-center">
          <p className="text-lg font-bold leading-none text-cyan-300">{lesson.lesson_number}</p>
          <p className="mt-1 text-[11px] text-slate-500">{lesson.time}</p>
          {canEdit && <button type="button" aria-label={`Редагувати ${lesson.subject_name}`} onClick={() => onEdit?.(lesson)} className="rounded-md border border-slate-700 px-2 py-1 text-xs text-cyan-300 hover:border-cyan-400">Редагувати</button>}
        </div>
        <div className="min-w-0 flex-1 border-l border-slate-800 pl-3">
          <div className="flex min-w-0 flex-wrap items-start gap-2">
            <h3 className="min-w-0 flex-1 break-words font-semibold leading-snug text-slate-100 [overflow-wrap:anywhere]">{lesson.subject_name}</h3>
          </div>
          {lesson.teacher_name && <p className="mt-1 truncate text-sm text-slate-400">{formatTeacherName(lesson.teacher_name)}</p>}
          {lesson.room_name && <p className="mt-1 text-xs text-slate-500">Ауд. {lesson.room_name}</p>}
          {noteForDate && !editingNote && <p className="mt-2 whitespace-pre-wrap text-xs text-amber-200/80">{renderNote(noteForDate)}</p>}
          {canEdit && !editingNote && <button type="button" onClick={() => { setNote(noteForDate ?? ""); setEditingNote(true); }} className="mt-2 text-xs text-cyan-300 hover:text-cyan-200">{noteForDate ? "Редагувати примітку" : "Додати примітку"}</button>}
          {canEdit && editingNote && <form onSubmit={submitNote} className="mt-2 space-y-2">
            <label className="sr-only" htmlFor={`note-${lesson.id}-${targetDate}`}>Примітка</label>
            <textarea id={`note-${lesson.id}-${targetDate}`} value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={2000} placeholder="Примітка до заняття" className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-slate-100" />
            {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={busy || !note.trim()} className="rounded-md bg-cyan-400 px-2 py-1 text-xs font-semibold text-slate-950">{busy ? "Збереження…" : "Зберегти"}</button>
              {noteForDate && <button type="button" disabled={busy} onClick={deleteNote} className="rounded-md border border-rose-400/50 px-2 py-1 text-xs text-rose-300">Видалити</button>}
              <button type="button" disabled={busy} onClick={() => setEditingNote(false)} className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300">Скасувати</button>
            </div>
          </form>}
        </div>
      </div>
    </article>
  );
}
