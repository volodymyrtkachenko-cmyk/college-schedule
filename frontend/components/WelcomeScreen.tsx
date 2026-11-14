import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { ReferenceRecord } from "../lib/api";
import { filterAndRankEntities, getGroupSearchBadge } from "../lib/quickJump";
import { getGroupCourse } from "../lib/groupInfo";
import { useViewportTier } from "../lib/useViewportTier";
import { CloseIcon } from "./ui/Icons";

const StudentOnboardingModal = dynamic(
  () => import("./StudentOnboardingModal").then((m) => m.StudentOnboardingModal),
  { ssr: false }
);

const TeacherOnboardingModal = dynamic(
  () => import("./TeacherOnboardingModal").then((m) => m.TeacherOnboardingModal),
  { ssr: false }
);

interface WelcomeScreenProps {
  groups: ReferenceRecord[];
  teachers: ReferenceRecord[];
  initialMode: "student" | "teacher";
  onComplete: (mode: "student" | "teacher", id: number) => void;
}

export function WelcomeScreen({ groups, teachers, initialMode, onComplete }: WelcomeScreenProps) {
  const [step, setStep] = useState(1);
  const [direction, setDirection] = useState(0);
  const [selectedStudentGroupId, setSelectedStudentGroupId] = useState<number | null>(null);
  const [showStudentGuide, setShowStudentGuide] = useState(false);
  const [selectedTeacherId, setSelectedTeacherId] = useState<number | null>(null);
  const [showTeacherGuide, setShowTeacherGuide] = useState(false);

  const { isDesktop } = useViewportTier();
  const [mode, setMode] = useState<"student" | "teacher">(initialMode);
  const [search, setSearch] = useState("");
  const [courseFilter, setCourseFilter] = useState<number | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const options = useMemo(() => {
    if (mode !== "student") return teachers;
    if (courseFilter === null) return groups;
    return groups.filter((g) => (g.course ?? getGroupCourse(g.name)) === courseFilter);
  }, [mode, groups, teachers, courseFilter]);

  const filtered = useMemo(
    () => filterAndRankEntities(options, search, mode),
    [options, search, mode]
  );

  useEffect(() => {
    setHighlightedIndex(0);
  }, [search, mode, courseFilter]);

  useEffect(() => {
    if (step !== 2 || typeof document === "undefined") return;
    const item = filtered[highlightedIndex];
    if (!item) return;
    const el = document.getElementById(`welcome-option-${mode}-${item.id}`);
    el?.scrollIntoView?.({ block: "nearest" });
  }, [highlightedIndex, step, filtered, mode]);

  const handleSelectItem = (item: ReferenceRecord) => {
    if (mode === "student") {
      setSelectedStudentGroupId(item.id);
      setShowStudentGuide(true);
    } else {
      setSelectedTeacherId(item.id);
      setShowTeacherGuide(true);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-sys-bg pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] sm:p-6">
      <div className="fixed inset-0 bg-gradient-to-b from-sys-accent/5 to-transparent pointer-events-none" />
      <div className="mx-auto flex min-h-full w-full max-w-md items-start justify-center relative z-10">
      {step === 1 ? (
        <div
          key="step1"
          data-slide-dir={direction < 0 ? "prev" : undefined}
          className={`my-auto w-full space-y-6 sm:space-y-8 [@media(max-height:520px)]:space-y-3.5 py-2 ${direction === 0 ? "week-grid-enter" : "guide-step-slide"}`}
        >
            <div className="text-center space-y-2 [@media(max-height:520px)]:space-y-1">
              <div className="mx-auto w-14 h-14 sm:w-16 sm:h-16 [@media(max-height:520px)]:w-11 [@media(max-height:520px)]:h-11 rounded-2xl bg-sys-card border border-sys-border flex items-center justify-center mb-3 sm:mb-5 [@media(max-height:520px)]:mb-2 shadow-lg shadow-sys-bg">
                <svg aria-hidden="true" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-sys-accent [@media(max-height:520px)]:w-5 [@media(max-height:520px)]:h-5"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"></path></svg>
              </div>
              <h2 className="text-2xl sm:text-3xl [@media(max-height:520px)]:text-xl font-bold tracking-tight text-sys-text-primary">Розклад ДФКР</h2>
              <p className="text-sys-text-secondary text-sm [@media(max-height:520px)]:text-xs sm:text-base">
                Дніпровський фаховий коледж радіоелектроніки · Оберіть свій профіль
              </p>
            </div>
            
            <div className="grid grid-cols-1 [@media(max-height:520px)_and_(min-width:480px)]:grid-cols-2 gap-3 sm:gap-4 [@media(max-height:520px)]:gap-2.5">
              <button 
                type="button"
                onClick={() => { setMode("student"); setDirection(1); setStep(2); }}
                className="group relative flex items-center gap-3.5 sm:gap-4 rounded-xl border border-sys-border bg-sys-card p-4 sm:p-5 [@media(max-height:520px)]:p-3.5 text-left transition-[border-color,background-color,transform] duration-fast ease-smooth hover:border-sys-accent/50 hover:bg-sys-card/80 active:scale-[0.98]"
              >
                <div className="flex h-11 w-11 sm:h-12 sm:w-12 shrink-0 items-center justify-center rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 group-hover:bg-blue-500/20 transition-colors">
                  <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>
                </div>
                <div className="min-w-0">
                  <h3 className="font-semibold text-base sm:text-lg text-sys-text-primary leading-tight">Студент</h3>
                  <p className="text-sys-text-secondary text-xs sm:text-sm">Розклад моєї групи</p>
                </div>
              </button>
              
              <button 
                type="button"
                onClick={() => { setMode("teacher"); setDirection(1); setStep(2); }}
                className="group relative flex items-center gap-3.5 sm:gap-4 rounded-xl border border-sys-border bg-sys-card p-4 sm:p-5 [@media(max-height:520px)]:p-3.5 text-left transition-[border-color,background-color,transform] duration-fast ease-smooth hover:border-sys-accent/50 hover:bg-sys-card/80 active:scale-[0.98]"
              >
                <div className="flex h-11 w-11 sm:h-12 sm:w-12 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 group-hover:bg-emerald-500/20 transition-colors">
                  <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                </div>
                <div className="min-w-0">
                  <h3 className="font-semibold text-base sm:text-lg text-sys-text-primary leading-tight">Викладач</h3>
                  <p className="text-sys-text-secondary text-xs sm:text-sm">Мій розклад занять</p>
                </div>
              </button>
            </div>
        </div>
      ) : (
        <div
          key="step2"
          data-slide-dir={direction > 0 ? "next" : "prev"}
          className="guide-step-slide my-auto w-full flex flex-col [@media(min-height:600px)]:h-[min(40rem,calc(100dvh-2.5rem))] relative"
        >
             <div className="mb-3 [@media(max-height:520px)]:mb-2 shrink-0">
                <button type="button" onClick={() => { setDirection(-1); setStep(1); setSearch(""); setCourseFilter(null); }} className="mb-2 [@media(max-height:520px)]:mb-1 inline-flex items-center gap-2 min-h-[36px] text-sm text-sys-text-secondary hover:text-sys-text-primary transition-colors">
                  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
                  Назад
                </button>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                  <h2 className="text-xl sm:text-2xl [@media(max-height:520px)]:text-lg font-bold text-sys-text-primary">Оберіть {mode === "student" ? "групу" : "викладача"}</h2>
                  <div className="inline-flex rounded-lg border border-sys-border bg-sys-card p-0.5 text-xs shrink-0">
                    <button
                      type="button"
                      onClick={() => { setMode("student"); setCourseFilter(null); }}
                      className={`px-2.5 py-1 rounded-md font-semibold transition-colors ${mode === "student" ? "bg-sys-accentSolid text-sys-onAccent" : "text-sys-text-secondary hover:text-sys-text-primary"}`}
                    >
                      Групи
                    </button>
                    <button
                      type="button"
                      onClick={() => { setMode("teacher"); setCourseFilter(null); }}
                      className={`px-2.5 py-1 rounded-md font-semibold transition-colors ${mode === "teacher" ? "bg-sys-accentSolid text-sys-onAccent" : "text-sys-text-secondary hover:text-sys-text-primary"}`}
                    >
                      Викладачі
                    </button>
                  </div>
                </div>
             </div>
             
             <div className="sticky top-0 z-20 bg-sys-bg pt-1 pb-2 shrink-0 space-y-2">
               <search className="relative block">
                 <svg aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-sys-text-secondary pointer-events-none" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                 <input 
                   autoFocus={isDesktop}
                   type="search"
                   autoCorrect="off"
                   autoCapitalize="off"
                   spellCheck={false}
                   aria-label={mode === "student" ? "Пошук групи" : "Пошук викладача"}
                   placeholder={mode === "student" ? "Номер групи, шифр (КІ-24) або курс..." : "Прізвище або ініціали викладача..."}
                   value={search}
                   onFocus={(e) => {
                     try {
                       e.currentTarget.scrollIntoView({ block: "nearest", behavior: "smooth" });
                     } catch {}
                   }}
                   onChange={(e) => setSearch(e.target.value)}
                   onKeyDown={(e) => {
                     if (e.nativeEvent.isComposing) return;
                     if (e.key === "ArrowDown") {
                       e.preventDefault();
                       setHighlightedIndex((i) => (filtered.length > 0 ? Math.min(i + 1, filtered.length - 1) : 0));
                     } else if (e.key === "ArrowUp") {
                       e.preventDefault();
                       setHighlightedIndex((i) => Math.max(i - 1, 0));
                     } else if (e.key === "Enter" && filtered.length > 0) {
                       e.preventDefault();
                       const target = filtered[highlightedIndex] ?? filtered[0];
                       if (target) handleSelectItem(target);
                     } else if (e.key === "Tab" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
                       e.preventDefault();
                       setMode((prev) => (prev === "student" ? "teacher" : "student"));
                       setCourseFilter(null);
                     }
                   }}
                   className="form-control w-full py-2.5 sm:py-3 pl-10 pr-10"
                 />
                 {search && (
                   <button
                     type="button"
                     onClick={() => setSearch("")}
                     aria-label="Очистити пошук"
                     className="absolute right-1 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-lg text-sys-text-muted hover:text-sys-text-primary transition-colors"
                   >
                     <CloseIcon className="h-4 w-4" />
                   </button>
                 )}
               </search>

               {mode === "student" && (
                 <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 no-scrollbar" role="group" aria-label="Фільтр за курсом">
                   {([null, 1, 2, 3, 4] as const).map((course) => {
                     const active = courseFilter === course;
                     return (
                       <button
                         key={course ?? "all"}
                         type="button"
                         aria-pressed={active}
                         onClick={() => setCourseFilter(course)}
                         className={`shrink-0 rounded-xl px-3 py-1.5 text-xs font-semibold border transition-colors ${
                           active
                             ? "bg-sys-accentSolid text-sys-onAccent border-sys-accentSolid shadow-xs"
                             : "bg-sys-card/70 border-sys-border text-sys-text-secondary hover:text-sys-text-primary hover:border-sys-accent/40"
                         }`}
                       >
                         {course === null ? "Всі" : `${course} курс`}
                       </button>
                     );
                   })}
                 </div>
               )}
             </div>
             
             <div className="flex-1 min-h-[150px] overflow-y-auto overflow-x-clip [scrollbar-gutter:stable] overscroll-contain pr-1 space-y-2 custom-scrollbar pb-4" role="listbox">
                {filtered.map((item, idx) => {
                  const isHighlighted = idx === highlightedIndex;
                  const badge = mode === "student" ? getGroupSearchBadge(item) : null;
                  return (
                    <button
                      key={item.id}
                      id={`welcome-option-${mode}-${item.id}`}
                      type="button"
                      role="option"
                      aria-selected={isHighlighted}
                      onMouseEnter={() => setHighlightedIndex(idx)}
                      onClick={() => handleSelectItem(item)}
                      className={`w-full rounded-xl border p-3.5 text-left font-medium text-sys-text-primary transition-[border-color,background-color,transform] duration-fast ease-smooth active:scale-[0.98] flex items-center justify-between gap-2 ${
                        isHighlighted
                          ? "border-sys-accent/60 bg-sys-accent/10 shadow-xs"
                          : "border-transparent bg-sys-card/50 hover:border-sys-border hover:bg-sys-card"
                      }`}
                    >
                      <span className="truncate font-semibold">{item.name}</span>
                      {badge && badge !== item.name && (
                        <span className="shrink-0 rounded-md bg-sys-bg/80 border border-sys-border/70 px-2 py-0.5 text-[11px] font-medium text-sys-text-secondary">
                          {badge}
                        </span>
                      )}
                    </button>
                  );
                })}
                {filtered.length === 0 && (
                  <div className="text-center py-8 text-sys-text-secondary">
                    {options.length === 0
                      ? mode === "student" ? "Список груп поки порожній." : "Список викладачів поки порожній."
                      : "За вашим запитом нічого не знайдено."}
                  </div>
                )}
             </div>
        </div>
      )}
      </div>

      {showStudentGuide && selectedStudentGroupId !== null && (
        <StudentOnboardingModal
          groupId={selectedStudentGroupId}
          onClose={() => onComplete("student", selectedStudentGroupId)}
          onComplete={(finalGroupId) => onComplete("student", finalGroupId ?? selectedStudentGroupId)}
        />
      )}

      {showTeacherGuide && selectedTeacherId !== null && (
        <TeacherOnboardingModal
          teacherId={selectedTeacherId}
          teacherName={teachers.find((t) => t.id === selectedTeacherId)?.name}
          onClose={() => onComplete("teacher", selectedTeacherId)}
          onComplete={(finalTeacherId) => onComplete("teacher", finalTeacherId ?? selectedTeacherId)}
        />
      )}
    </div>
  );
}
