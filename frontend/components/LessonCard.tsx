import { useState } from "react";
import { Lesson } from "../lib/api";

function EditIcon() {
  return <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>;
}

function MessageIcon({ filled }: { filled?: boolean }) {
  if (filled) {
    return <svg width="1em" height="1em" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>;
  }
  return <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>;
}

function NoteIcon(props: React.SVGProps<SVGSVGElement>) {
  return <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><line x1="4" x2="20" y1="9" y2="9"/><line x1="4" x2="20" y1="15" y2="15"/><line x1="10" x2="14" y1="21" y2="21"/><path d="M4 9V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/></svg>;
}

function formatTeacherName(name: string) {
  return name.split(/\s*(?:[,/])\s*/).map(t => {
    const clean = t.trim();
    if (!clean) return "";
    const parts = clean.split(/\s+/);
    
    // If it already contains dots, it's likely already abbreviated
    if (parts.some(p => p.includes('.'))) {
      return clean;
    }
    
    if (parts.length >= 3) {
      return `${parts[0]} ${parts[1][0]}.${parts[2][0]}.`;
    } else if (parts.length === 2) {
      return `${parts[0]} ${parts[1][0]}.`;
    }
    return clean;
  }).filter(Boolean).join(" / ");
}

const URL_REGEX = /((?:https?:\/\/)?(?:www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_\+.~#?&//=]*))/gi;

function renderNote(note: string) {
  const parts = note.split(URL_REGEX);
  return parts.map((part, i) => {
    if (part.match(URL_REGEX)) {
      let href = part;
      if (!href.startsWith('http://') && !href.startsWith('https://')) {
        href = 'https://' + href;
      }
      return <a key={i} href={href} target="_blank" rel="noopener noreferrer" className="text-sys-accent hover:underline break-words" onClick={e => e.stopPropagation()}>{part}</a>;
    }
    return <span key={i}>{part}</span>;
  });
}

export function LessonCard({
  lesson, targetDate, mode, scheduleMode, canEdit, onEdit, onDelete, hasNote,
  noteExpandedId, setNoteExpandedId, movingLesson, onMoveSelect, onNoteSave, onNoteDelete,
}: {
  lesson: Lesson;
  targetDate: string;
  mode: "today" | "week" | "day";
  scheduleMode: "student" | "teacher" | "admin";
  canEdit: boolean;
  onEdit?: (lesson: Lesson) => void;
  onDelete?: (id: number) => void;
  hasNote?: boolean;
  noteExpandedId?: number | null;
  setNoteExpandedId?: (id: number | null) => void;
  movingLesson?: Lesson | null;
  onMoveSelect?: (lesson: Lesson | null) => void;
  onNoteSave?: (note: string) => Promise<void>;
  onNoteDelete?: () => Promise<void>;
}) {
  const isSelectedForMove = movingLesson?.id === lesson.id;
  const noteExpanded = noteExpandedId === lesson.id;
  
  const noteForDate = lesson.note && (!lesson.note_date || lesson.note_date === targetDate) ? lesson.note : "";
  const [editingNote, setEditingNote] = useState(false);
  const [note, setNote] = useState(noteForDate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submitNote = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!onNoteSave) return;
    setBusy(true);
    setError("");
    try {
      await onNoteSave(note.trim());
      setEditingNote(false);
    } catch (e: any) {
      setError(e.message || "Сталася помилка при збереженні примітки.");
    } finally {
      setBusy(false);
    }
  };

  const deleteNote = async () => {
    if (!onNoteDelete || !lesson.note_id) return;
    setBusy(true);
    try {
      await onNoteDelete();
      setEditingNote(false);
      setNote("");
    } catch (e: any) {
      setError(e.message || "Сталася помилка.");
    } finally {
      setBusy(false);
    }
  };

  const [startT, endT] = lesson.time.split("-");
  let primaryName = lesson.teacher_name ? formatTeacherName(lesson.teacher_name) : null;
  if (scheduleMode === "teacher" && lesson.group_name) {
    primaryName = `Група ${lesson.group_name}`;
  }
  const teacherRoom = [primaryName, lesson.room].filter(Boolean).join(" · ");


  return (
    <article
      draggable={canEdit && !!onMoveSelect && !lesson.is_replacement}
      onDragStart={(event) => {
        if (lesson.is_replacement) {
          event.preventDefault();
          return;
        }
        event.dataTransfer.setData("text/plain", String(lesson.id));
        event.dataTransfer.effectAllowed = "move";
        onMoveSelect?.(lesson);
      }}
      onClick={(e) => {
        const target = e.target as HTMLElement;
        if (target.closest('button') || target.tagName === 'TEXTAREA' || target.tagName === 'A') return;
        if (hasNote) setNoteExpandedId?.(noteExpanded ? null : lesson.id);
      }}
      className={`relative min-w-0 flex flex-col items-stretch overflow-hidden rounded-2xl border bg-sys-card p-4 md:p-5 shadow-sm transition-colors duration-200 min-h-[110px] ${
        isSelectedForMove ? "border-emerald-400 ring-1 ring-emerald-400/70" : "border-sys-border"
      } ${
        lesson.is_relevant_this_week ? "" : "opacity-40 grayscale"
      } ${lesson.is_replacement ? "ring-1 ring-sys-warning/60 !border-sys-warning/40 bg-sys-warning/[0.02]" : canEdit ? "cursor-grab active:cursor-grabbing" : ""} ${hasNote ? "cursor-pointer hover:shadow-md" : ""}`}
    >
      <div className="flex items-center gap-4 w-full">
        {/* Time column */}
        <div className="flex flex-col min-w-[45px] sm:min-w-[55px] text-left shrink-0">
          <span className="text-sys-neon font-bold text-xl leading-none mb-1.5">{lesson.lesson_number}</span>
          <span className="text-sys-text-secondary text-xs font-medium">{startT}</span>
          <span className="text-sys-text-secondary text-xs font-medium">{endT}</span>
        </div>

        {/* Separator */}
        <div className="w-[1px] h-12 bg-[#30363D] shrink-0 hidden sm:block"></div>

        {/* Content */}
        <div className="flex-1 min-w-0 flex flex-col justify-center">
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-white font-bold text-base leading-snug break-words">
              {lesson.subject_name}
            </h3>
            
            {/* Action Icons right aligned */}
            <div className="flex shrink-0 gap-1 sm:gap-2 items-center">
                 {canEdit && (
                    <button type="button" aria-label={`Редагувати ${lesson.subject_name}`} onClick={() => onEdit?.(lesson)} 
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-sys-text-secondary transition-colors hover:bg-sys-accent/10 hover:text-sys-accent text-[16px]">
                      <EditIcon />
                    </button>
                 )}
                 {canEdit && onMoveSelect && !movingLesson && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onMoveSelect(lesson); }}
                      aria-label="Перемістити пару"
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-sys-text-secondary transition-colors hover:bg-sys-accent/10 hover:text-sys-accent text-[16px]"
                    >
                      <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/><polyline points="19 9 22 12 19 15"/><polyline points="9 19 12 22 15 19"/><line x1="2" x2="22" y1="12" y2="12"/><line x1="12" x2="12" y1="2" y2="22"/></svg>
                    </button>
                 )}
                 {(canEdit || hasNote) && (
                    <button type="button" aria-label={canEdit ? hasNote ? "Редагувати примітку" : "Додати примітку" : "Показати примітку"} onClick={(e) => {
                      e.stopPropagation();
                      if (canEdit) {
                         if (!hasNote) setNote("");
                         setEditingNote(!editingNote);
                      } else {
                         setNoteExpandedId?.(noteExpanded ? null : lesson.id);
                      }
                    }} 
                      className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors text-[16px] ${hasNote ? 'bg-sys-accent/10 text-sys-accent' : 'text-sys-text-secondary hover:bg-white/5 hover:text-white'}`}>
                      <MessageIcon filled={hasNote} />
                    </button>
                 )}
            </div>
          </div>
          
          <div className="flex flex-wrap items-center justify-between mt-3 gap-2">
            {primaryName ? (
              <p className="text-sys-text-secondary text-sm break-words flex-1">{primaryName}</p>
            ) : <div className="flex-1" />}
            {lesson.room && (
              <span className="bg-[#21262D] text-white text-xs px-2.5 py-0.5 rounded-md border border-[#30363D] shrink-0">
                ауд. {lesson.room}
              </span>
            )}
          </div>

          {lesson.is_replacement && (
            <div className="mt-2.5 flex flex-wrap gap-2">
              <span className="bg-sys-warning text-sys-warningText font-bold text-[10px] uppercase px-2 py-0.5 rounded tracking-wider inline-flex">
                Заміна
              </span>
            </div>
          )}
        </div>
      </div>

      {canEdit && onMoveSelect && !lesson.is_replacement && (
        <button
          type="button"
          aria-label={`Перемістити ${lesson.subject_name}`}
          aria-pressed={isSelectedForMove}
          onClick={(event) => {
            event.stopPropagation();
            onMoveSelect(isSelectedForMove ? null : lesson);
          }}
          className={`mt-4 rounded-md border px-3 py-2 text-[13px] min-h-[36px] font-semibold transition-colors w-full ${
            isSelectedForMove
              ? "border-sys-accent/50 bg-sys-accent/10 text-sys-accent"
              : "border-sys-border text-sys-text-secondary hover:border-sys-accent/50 hover:text-sys-accent"
          }`}
        >
          {isSelectedForMove ? "Обрано для переміщення" : "Перемістити"}
        </button>
      )}
      
      {/* Note full text display */}
      {((hasNote && !editingNote) || (hasNote && noteExpanded && !editingNote)) && (
        <div className="mt-4 flex gap-2 border-t border-[#30363D] pt-4 text-[14px] text-sys-text-secondary font-medium w-full relative z-10 transition-all">
          <NoteIcon className="shrink-0 text-[16px] mt-[2px] text-sys-accent" />
          <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{renderNote(noteForDate)}</p>
        </div>
      )}

      {/* Editor Box */}
      {canEdit && editingNote && <form onSubmit={submitNote} className="mt-4 space-y-3 border-t border-[#30363D] pt-4 relative z-10">
        <label className="sr-only" htmlFor={`note-${lesson.id}-${targetDate}`}>Примітка</label>
        <textarea id={`note-${lesson.id}-${targetDate}`} value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={2000} placeholder="Варіант роботи, аудиторія або інша примітка" className="w-full rounded-md border border-[#30363D] bg-[#010409] px-3 py-2 text-[14px] text-white outline-none focus:border-sys-accent focus:ring-1 focus:ring-sys-accent" />
        {error && <p role="alert" className="text-[13px] text-rose-400 font-medium">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={busy || !note.trim()} className="rounded bg-sys-accent hover:bg-[#238636] px-4 py-2 min-h-[36px] text-[13px] font-bold text-white disabled:opacity-50 transition-colors">Зберегти</button>
          {noteForDate && <button type="button" disabled={busy} onClick={deleteNote} className="rounded border border-[#30363D] px-4 py-2 min-h-[36px] text-[13px] font-medium text-rose-400 hover:bg-rose-400/10 disabled:opacity-50 transition-colors">Видалити</button>}
          <button type="button" disabled={busy} onClick={() => setEditingNote(false)} className="rounded border border-[#30363D] px-4 py-2 min-h-[36px] text-[13px] font-medium text-sys-text-secondary hover:text-white disabled:opacity-50 transition-colors">Скасувати</button>
        </div>
      </form>}
    </article>
  );
}
