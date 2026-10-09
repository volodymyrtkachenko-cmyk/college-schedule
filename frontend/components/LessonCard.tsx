import { LessonNote } from "./LessonNote";
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

function formatRoom(room: string) {
  const clean = room.split(",").map(p => p.trim()).filter(Boolean).join(" / ");
  const lower = clean.toLowerCase();
  if (lower.startsWith("ауд") || lower.startsWith("каб") || lower.startsWith("спорт") || lower.startsWith("дист") || lower.startsWith("акт")) {
    return clean;
  }
  return `ауд. ${clean}`;
}

export function LessonCard({
  lesson, targetDate, mode, scheduleMode, canEdit, onEdit, onDelete, 
   movingLesson, onMoveSelect, 
}: {
  lesson: Lesson;
  targetDate: string;
  mode: "today" | "week" | "day";
  scheduleMode: "student" | "teacher" | "admin";
  canEdit: boolean;
  onEdit?: (lesson: Lesson) => void;
  onDelete?: (id: number) => void;
        movingLesson?: Lesson | null;
  onMoveSelect?: (lesson: Lesson | null) => void;
  
  
}) {
  const isSelectedForMove = movingLesson?.id === lesson.id;
  
  
  
  const [startT, endT] = lesson.time.split("-");
  let primaryName = lesson.teacher_name ? formatTeacherName(lesson.teacher_name) : null;
  if (scheduleMode === "teacher" && lesson.group_name) {
    primaryName = `Група ${lesson.group_name}`;
  }



  const isDay = mode !== "week";

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
            className={`relative min-w-0 flex flex-col items-stretch overflow-hidden rounded-2xl border bg-sys-card shadow-sm transition-colors duration-200 min-h-[110px] ${
        isDay ? "p-3 xl:p-4" : "p-3"
      } ${
        isSelectedForMove ? "border-emerald-400 ring-1 ring-emerald-400/70" : "border-sys-border"
      } ${
        lesson.is_relevant_this_week ? "" : "opacity-40 grayscale"
      } ${lesson.is_replacement ? "ring-1 ring-sys-warning/60 !border-sys-warning/40 bg-sys-warning/[0.02]" : canEdit ? "cursor-grab active:cursor-grabbing" : ""} `}
    >
      <div className={`flex items-center w-full ${isDay ? "gap-3 xl:gap-4" : "gap-2"}`}>
        {isDay && (
          <>
            <div className="flex flex-col min-w-[45px] sm:min-w-[55px] text-left shrink-0">
              <span className="text-sys-neon font-bold text-xl leading-none mb-1.5">{lesson.lesson_number}</span>
              <span className="text-sys-text-secondary text-xs font-medium">{startT}</span>
              <span className="text-sys-text-secondary text-xs font-medium">{endT}</span>
            </div>
            <div className="w-[1px] h-12 bg-[#30363D] shrink-0 hidden sm:block"></div>
          </>
        )}

        {/* Content */}
        <div className="flex-1 min-w-0 flex flex-col justify-center">
          <div className={`flex items-start justify-between ${isDay ? "gap-3" : "gap-2"}`}>
            <h3 className={`flex-1 min-w-0 text-white font-bold leading-snug break-words ${isDay ? "text-base" : "text-[14px]"}`}>
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
                 {canEdit && onMoveSelect && !movingLesson && !lesson.is_replacement && (
                    <button
                      type="button"
                      aria-label="Перемістити пару"
                      onClick={(e) => { e.stopPropagation(); onMoveSelect(lesson); }}
                      className={`flex shrink-0 h-8 w-8 items-center justify-center rounded-lg transition-colors text-[16px] ${isSelectedForMove ? "bg-sys-accent text-white" : "text-sys-text-secondary hover:bg-sys-accent/10 hover:text-sys-accent"}`}
                    >
                      <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/><polyline points="19 9 22 12 19 15"/><polyline points="9 19 12 22 15 19"/><line x1="2" x2="22" y1="12" y2="12"/><line x1="12" x2="12" y1="2" y2="22"/></svg>
                    </button>
                 )}
                 
            </div>
          </div>
          
          <div className={`flex flex-wrap items-center justify-between ${isDay ? "mt-3" : "mt-2"} gap-2`}>
            {primaryName ? (
              <p className="text-sys-text-secondary text-sm break-words flex-1 min-w-[120px]">{primaryName}</p>
            ) : <div className="flex-1" />}
            {lesson.room && (
              <span className="bg-[#21262D] text-white text-xs px-2.5 py-0.5 rounded-md border border-[#30363D] shrink-0 ml-auto">
                {formatRoom(lesson.room)}
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

      
      
      <LessonNote key={`${lesson.group_id}:${targetDate}:${lesson.lesson_number}:${lesson.subject_id}`} lesson={lesson} date={targetDate} />
      </article>
  );
}

