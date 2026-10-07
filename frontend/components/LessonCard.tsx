import { useState } from "react";
import { Lesson, ScheduleResponse } from "../lib/api";

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
  const parts = name.split(/\s+/);
  if (parts.length >= 3) {
    return `${parts[0]} ${parts[1][0]}.${parts[2][0]}.`;
  } else if (parts.length === 2) {
    return `${parts[0]} ${parts[1][0]}.`;
  }
  return name;
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
  const isDay = mode !== "week";
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

  if (!isDay) {
    // ----------------------------------------------------
    // WEEK MODE (GRID VIEW) - Google Calendar Style
    // ----------------------------------------------------
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
        className={`group relative min-w-0 flex flex-col justify-start overflow-hidden rounded-md border-l-[4px] bg-sys-accent/[0.08] hover:bg-sys-accent/[0.12] px-2 py-1.5 transition-colors duration-200 cursor-pointer ${
          isSelectedForMove ? "border-l-emerald-400 ring-1 ring-emerald-400/70 bg-emerald-500/10" : "border-l-sys-accent"
        } ${lesson.is_relevant_this_week ? "" : "opacity-40 grayscale"} ${
          lesson.is_replacement ? "ring-1 ring-sys-accent/40" : ""
        }`}
      >
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className="flex items-center justify-center rounded-[4px] bg-sys-accent/20 px-1 text-[9px] font-bold text-sys-accent">{lesson.lesson_number}</span>
          <span className="text-[9px] font-medium text-sys-text-muted opacity-80">{lesson.time}</span>
        </div>
        <h3 className="min-w-0 font-semibold text-sys-text-primary text-[12px] leading-snug line-clamp-2 pr-4 break-words">
          {lesson.subject_name}
        </h3>
        
        {teacherRoom && (
          <p className="mt-[2px] text-[10px] text-sys-text-secondary leading-tight line-clamp-1 opacity-80 break-words">
            {teacherRoom}
          </p>
        )}
        
        {lesson.is_replacement && (
          <div className="mt-1">
            <span className="inline-block px-1 py-0.5 text-[9px] uppercase tracking-wider font-bold bg-sys-accent text-[#0b1120] rounded leading-none shadow-sm">Заміна</span>
          </div>
        )}

        {/* Note / Edit icons overlay (shown faintly on hover in week view) */}
        <div className="absolute top-1 right-1 flex flex-col items-center gap-1 opacity-60 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
          {canEdit && (
            <button type="button" aria-label={`Редагувати ${lesson.subject_name}`} onClick={() => onEdit?.(lesson)} 
              className="flex h-5 w-5 items-center justify-center rounded-sm bg-sys-bg/80 backdrop-blur-sm text-sys-text-muted hover:text-sys-accent hover:bg-sys-accent/20">
              <EditIcon />
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
              className={`flex h-5 w-5 items-center justify-center rounded-sm backdrop-blur-sm ${hasNote ? 'bg-sys-accent/20 text-sys-accent' : 'bg-sys-bg/80 text-sys-text-muted hover:text-sys-text-primary'}`}>
              <MessageIcon filled={hasNote} />
            </button>
          )}
        </div>

        {canEdit && onMoveSelect && !lesson.is_replacement && isSelectedForMove && (
          <div className="mt-1.5 text-[9px] font-bold text-emerald-400">
            ОБРАНО ДЛЯ ПЕРЕМІЩЕННЯ
          </div>
        )}

        {/* Note display and editor */}
        {(hasNote && noteExpanded && !editingNote) && (
          <div className="mt-2 text-[11px] text-sys-text-secondary w-full relative z-10 break-words pt-1 border-t border-sys-accent/20">
            <p className="whitespace-pre-wrap">{renderNote(noteForDate)}</p>
          </div>
        )}

        {canEdit && editingNote && (
          <form onSubmit={submitNote} className="mt-2 flex flex-col gap-1 border-t border-sys-accent/20 pt-2 relative z-10">
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="w-full rounded border-[0.5px] border-sys-border bg-sys-bg px-1 py-1 text-[10px] text-sys-text-primary outline-none focus:border-sys-accent" />
            <div className="flex gap-1 mt-1">
              <button type="submit" disabled={busy || !note.trim()} className="flex-1 rounded bg-sys-accent py-1 text-[9px] font-bold text-sys-bg">Зберегти</button>
              <button type="button" disabled={busy} onClick={() => setEditingNote(false)} className="flex-1 rounded border-[0.5px] border-sys-border py-1 text-[9px] text-sys-text-muted">Скасувати</button>
            </div>
          </form>
        )}
      </article>
    );
  }

  // ----------------------------------------------------
  // TODAY MODE (LIST VIEW) - Detailed Card Style
  // ----------------------------------------------------
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
      className={`relative min-w-0 overflow-hidden rounded-xl border bg-sys-card p-3 shadow-sm transition-colors duration-200 ${
        isSelectedForMove ? "border-emerald-400 ring-1 ring-emerald-400/70" : "border-sys-border"
      } ${
        lesson.is_relevant_this_week ? "" : "opacity-40 grayscale"
      } ${lesson.is_replacement ? "ring-1 ring-sys-accent/60 !border-sys-accent/40 bg-sys-accent/[0.02]" : canEdit ? "cursor-grab active:cursor-grabbing" : ""} ${hasNote ? "cursor-pointer hover:shadow-md" : ""}`}
    >
      <div className="flex items-stretch gap-4 flex-row">
        
        {/* Time column */}
        <div className="flex w-[4.5rem] flex-col items-center justify-center shrink-0 self-stretch rounded-xl bg-sys-bg/60 py-2 border border-sys-border/40">
          <p className="text-[20px] font-extrabold leading-none text-sys-text-primary tracking-tight mb-1">{lesson.lesson_number}</p>
          <div className="flex flex-col text-sys-text-muted font-medium items-center text-[10px] uppercase tracking-wider opacity-80">
            <span>{startT}</span>
            <span>{endT}</span>
          </div>
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1 flex flex-col justify-center py-1">
          <div className="flex min-w-0 items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="min-w-0 break-words font-semibold text-sys-text-primary [overflow-wrap:anywhere] leading-tight text-[16px]">
                <span className="align-middle">{lesson.subject_name}</span>
              </h3>
              {teacherRoom && (
                <p className="flex items-center gap-1.5 text-sys-text-secondary break-words [overflow-wrap:anywhere] mt-1.5 text-[13.5px]">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-60"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                  {teacherRoom}
                </p>
              )}
              {lesson.is_replacement && (
                <div className="mt-2">
                  <span className="inline-block px-2 py-0.5 text-[10px] uppercase tracking-wider font-bold bg-sys-accent text-[#0b1120] rounded-md leading-relaxed shadow-sm">Заміна</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Action Icons right aligned */}
        <div className="flex shrink-0 gap-2 items-center self-center">
             {canEdit && (
                <button type="button" aria-label={`Редагувати ${lesson.subject_name}`} onClick={() => onEdit?.(lesson)} 
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-sys-text-muted transition-colors hover:bg-sys-accent/10 hover:text-sys-accent text-[18px]">
                  <EditIcon />
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
                  className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors text-[18px] ${hasNote ? 'bg-sys-accent/10 text-sys-accent' : 'text-sys-text-muted hover:bg-white/5 hover:text-sys-text-primary'}`}>
                  <MessageIcon filled={hasNote} />
                </button>
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
          className={`mt-2 rounded-md border px-2 py-1 text-xs font-medium transition-colors ${
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
        <div className="mt-3 flex gap-2 border-t border-sys-border/50 pt-2 text-[13px] text-sys-text-secondary w-full relative z-10 transition-all">
          <NoteIcon className="shrink-0 text-[15px] mt-[1px]" />
          <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{renderNote(noteForDate)}</p>
        </div>
      )}

      {/* Editor Box */}
      {canEdit && editingNote && <form onSubmit={submitNote} className="mt-3 space-y-2 border-t border-sys-border/50 pt-3 relative z-10">
        <label className="sr-only" htmlFor={`note-${lesson.id}-${targetDate}`}>Примітка</label>
        <textarea id={`note-${lesson.id}-${targetDate}`} value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={2000} placeholder="Варіант роботи, аудиторія або інша примітка" className="w-full rounded-md border-[0.5px] border-sys-border bg-sys-bg px-2 py-2 text-xs text-sys-text-primary outline-none focus:border-sys-accent focus:ring-1 focus:ring-sys-accent" />
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
