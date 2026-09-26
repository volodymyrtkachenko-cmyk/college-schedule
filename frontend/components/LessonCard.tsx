
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
    return <a key={index} href={href} target="_blank" rel="noopener noreferrer" className="break-all text-sys-accent underline underline-offset-2 hover:opacity-80">{part}</a>;
  });
}

function EditIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4" /><path d="M13.5 6.5l4 4" />
    </svg>
  );
}

function MessageIcon({ className, filled }: { className?: string, filled?: boolean }) {
  if (filled) {
    return (
      <svg className={className} width="1em" height="1em" viewBox="0 0 24 24" fill="currentColor">
        <path d="M18 3a4 4 0 0 1 4 4v8a4 4 0 0 1 -4 4h-4.724l-4.762 2.857a1 1 0 0 1 -1.508 -.743l-.006 -.114v-2h-3a4 4 0 0 1 -3.995 -3.8l-.005 -.2v-8a4 4 0 0 1 4 -4h14zm-4 9h-6a1 1 0 0 0 0 2h6a1 1 0 0 0 0 -2zm2 -4h-8a1 1 0 1 0 0 2h8a1 1 0 0 0 0 -2z" />
      </svg>
    );
  }
  return (
    <svg className={className} width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
       <path d="M8 9h8" /><path d="M8 13h6" /><path d="M18 4a3 3 0 0 1 3 3v8a3 3 0 0 1 -3 3h-5l-5 3v-3h-2a3 3 0 0 1 -3 -3v-8a3 3 0 0 1 3 -3h12z" />
    </svg>
  );
}

function NoteIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 20l7 -7" /><path d="M13 20v-6a1 1 0 0 1 1 -1h6v-7a2 2 0 0 0 -2 -2h-12a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h7" />
    </svg>
  );
}

export function LessonCard({ lesson, targetDate, mode = "day", scheduleMode = "student", canEdit = false, onEdit, onNoteSave, onNoteDelete }: {
  lesson: Lesson; targetDate: string; mode?: "day" | "week"; canEdit?: boolean; onEdit?: (lesson: Lesson) => void;
  scheduleMode?: "student"|"teacher"; onNoteSave?: (note: string) => Promise<void>; onNoteDelete?: () => Promise<void>;
}) {
  const [editingNote, setEditingNote] = useState(false);
  const [noteExpanded, setNoteExpanded] = useState(false);
  const [note, setNote] = useState(lesson.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const noteForDate = lesson.note && (!lesson.note_date || lesson.note_date === targetDate) ? lesson.note : null;
  const hasNote = !!noteForDate;
  
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

  const isDay = mode === "day";
  const [startT, endT] = lesson.time.split("-");
    let primaryName = lesson.teacher_name ? formatTeacherName(lesson.teacher_name) : null;
  if (scheduleMode === "teacher" && lesson.group_name) {
    primaryName = `Група ${lesson.group_name}`;
  }
  const teacherRoom = [primaryName, lesson.room].filter(Boolean).join(" · ");

  return (
    <article
      onClick={(e) => {
        const target = e.target as HTMLElement;
        if (target.closest('button') || target.tagName === 'TEXTAREA' || target.tagName === 'A') return;
        if (!isDay && hasNote) setNoteExpanded(!noteExpanded);
      }}
      className={`relative min-w-0 overflow-hidden rounded-[8px] border-[0.5px] border-sys-border bg-sys-card p-3 shadow-sm transition ${
        lesson.is_relevant_this_week ? "" : "opacity-40 grayscale"
      } ${lesson.is_replacement ? "ring-1 ring-sys-accent/60 !border-sys-accent/40 bg-sys-accent/[0.02]" : ""} ${!isDay && hasNote ? "cursor-pointer hover:shadow-md" : ""}`}
    >
      <div className={`flex items-start ${isDay ? 'gap-3 flex-row' : 'flex-col gap-2'}`}>
        
        {/* Time column (day) or inline (week) */}
        <div className={isDay ? "min-w-[3.25rem] text-center shrink-0 pt-0.5" : "flex items-center gap-2"}>
          {isDay && <p className="text-lg font-bold leading-none text-sys-text-primary mb-1">{lesson.lesson_number}</p>}
          <div className="text-[12px] leading-tight flex flex-col">
            <span className="text-sys-text-primary font-medium">{startT}</span>
            <span className="text-sys-text-muted">{endT}</span>
          </div>
        </div>

        {/* Separator for Day mode */}
        {isDay && <div className="w-[1px] bg-sys-border self-stretch" />}

        {/* Content */}
        <div className="min-w-0 flex-1 flex flex-col justify-center self-stretch">
          <div className="flex min-w-0 items-start justify-between gap-2">
            <div className={`min-w-0 ${!isDay ? "pr-6" : ""}`}>
              <h3 className={`min-w-0 break-words font-medium text-sys-text-subject [overflow-wrap:anywhere] ${isDay ? 'text-[15px]' : 'text-[13px]'}`}>
                {lesson.is_replacement && <span className="inline-block px-1.5 py-0.5 mr-1.5 text-[0.65rem] uppercase tracking-widest font-bold bg-sys-accent text-slate-950 rounded align-middle leading-none">Заміна</span>}
                <span className="align-middle">{lesson.subject_name}</span>
              </h3>
              {teacherRoom && <p className={`text-sys-text-secondary break-words [overflow-wrap:anywhere] mt-0.5 ${isDay ? 'text-[13px]' : 'text-[12px]'}`}>{teacherRoom}</p>}
            </div>
          </div>
        </div>

        {/* Action Icons right aligned */}
        <div className={`flex shrink-0 gap-2 ${isDay ? 'items-center self-center' : 'absolute top-3 right-3'}`}>
             {canEdit && (
                <button type="button" aria-label={`Редагувати ${lesson.subject_name}`} onClick={() => onEdit?.(lesson)} 
                  className={`text-sys-text-muted hover:text-sys-accent transition-colors ${isDay ? 'text-[18px]' : 'text-[15px]'}`}>
                  <EditIcon />
                </button>
             )}
             {(canEdit || hasNote) && (
                <button type="button" aria-label="Примітка" onClick={(e) => {
                  e.stopPropagation();
                  if (canEdit) {
                     if (!hasNote) setNote("");
                     setEditingNote(!editingNote);
                  } else {
                     setNoteExpanded(!noteExpanded);
                  }
                }} 
                  className={`${hasNote ? 'text-sys-accent' : 'text-sys-text-muted hover:text-sys-text-primary'} transition-colors ${isDay ? 'text-[18px]' : 'text-[15px]'}`}>
                  <MessageIcon filled={hasNote} />
                </button>
             )}
        </div>
      </div>
      
      {/* Note full text display */}
      {((isDay && hasNote && !editingNote) || (!isDay && hasNote && noteExpanded && !editingNote)) && (
        <div className="mt-3 flex gap-2 border-t border-sys-border/50 pt-2 text-[13px] text-sys-text-secondary w-full relative z-10 transition-all">
          <NoteIcon className="shrink-0 text-[15px] mt-[1px]" />
          <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{renderNote(noteForDate)}</p>
        </div>
      )}

      {/* Editor Box */}
      {canEdit && editingNote && <form onSubmit={submitNote} className="mt-3 space-y-2 border-t border-sys-border/50 pt-3 relative z-10">
        <label className="sr-only" htmlFor={`note-${lesson.id}-${targetDate}`}>Примітка</label>
        <textarea id={`note-${lesson.id}-${targetDate}`} value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={2000} placeholder="Варіант роботи, кабінет, або інша примітка" className="w-full rounded-md border-[0.5px] border-sys-border bg-sys-bg px-2 py-2 text-xs text-sys-text-primary outline-none focus:border-sys-accent focus:ring-1 focus:ring-sys-accent" />
        {error && <p role="alert" className="text-xs text-rose-400">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={busy || !note.trim()} className="rounded bg-sys-accent px-3 py-1.5 text-xs font-semibold text-sys-bg disabled:opacity-50 hover:opacity-90">{busy ? "Збереження…" : "Зберегти"}</button>
          {noteForDate && <button type="button" disabled={busy} onClick={deleteNote} className="rounded border-[0.5px] border-sys-border px-3 py-1.5 text-xs text-rose-400 hover:bg-rose-400/10 disabled:opacity-50">Видалити</button>}
          <button type="button" disabled={busy} onClick={() => setEditingNote(false)} className="rounded border-[0.5px] border-sys-border px-3 py-1.5 text-xs text-sys-text-muted hover:text-sys-text-primary disabled:opacity-50">Скасувати</button>
        </div>
      </form>}
    </article>
  );
}
