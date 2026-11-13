"use client";

import React from "react";
import { m, AnimatePresence } from "framer-motion";
import { EditIcon, MoveIcon } from "../LessonIcons";
import { HistoryIcon, MessageSquareIcon } from "../ui/Icons";
import { Lesson } from "../../lib/api";

function CopyIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}

function CalendarOffIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.2 4.2A2 2 0 0 0 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 1.8-1.2" />
      <path d="M21 15V6a2 2 0 0 0-2-2H9" />
      <line x1="2" x2="22" y1="2" y2="22" />
    </svg>
  );
}

function SwapIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m7 15 5 5 5-5" />
      <path d="m7 9 5-5 5 5" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
      <line x1="10" x2="10" y1="11" y2="17" />
      <line x1="14" x2="14" y1="11" y2="17" />
    </svg>
  );
}

function TemplateIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="18" height="18" x="3" y="4" rx="2" ry="2" />
      <line x1="16" x2="16" y1="2" y2="6" />
      <line x1="8" x2="8" y1="2" y2="6" />
      <line x1="3" x2="21" y1="10" y2="10" />
      <path d="M8 14h.01" />
      <path d="M12 14h.01" />
      <path d="M16 14h.01" />
      <path d="M8 18h.01" />
      <path d="M12 18h.01" />
      <path d="M16 18h.01" />
    </svg>
  );
}

export function LessonMoreMenu({
  open,
  onClose,
  alignTop = true,
  lesson,
  targetDate,
  isTemplateMode,
  canMove,
  movingLesson,
  visibleNoteText,
  onCopySelect,
  onMoveSelect,
  onSwapSelect,
  onDeleteTemplate,
  onRemoveReplacement,
  onCancelDated,
  onOpenPermanentSchedule,
  onOpenNoteModal,
}: {
  open: boolean;
  onClose: () => void;
  alignTop?: boolean;
  lesson: Lesson;
  targetDate: string;
  isTemplateMode: boolean;
  canMove: boolean;
  movingLesson?: Lesson | null;
  visibleNoteText: string;
  onCopySelect?: (lesson: Lesson) => void;
  onMoveSelect?: (lesson: Lesson | null) => void;
  onSwapSelect?: (lesson: Lesson) => void;
  onDeleteTemplate?: (lesson: Lesson) => void;
  onRemoveReplacement?: (lesson: Lesson, date: string) => void;
  onCancelDated?: (lesson: Lesson, date: string) => void;
  onOpenPermanentSchedule?: (lesson: Lesson) => void;
  onOpenNoteModal: (mode: "edit" | "history") => void;
}) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <m.div
            key="more-menu-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-40"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
          />
          <m.div
            key="more-menu-popup"
            initial={{ opacity: 0, scale: 0.95, y: alignTop ? 4 : -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: alignTop ? 4 : -4 }}
            transition={{ type: "spring", stiffness: 420, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
            className={`absolute right-0 ${
              alignTop ? "bottom-full mb-1" : "top-full mt-1"
            } z-50 min-w-[200px] rounded-xl border border-sys-border bg-sys-card shadow-2xl p-1 text-xs space-y-0.5`}
          >
            {isTemplateMode ? (
              <>
                {onCopySelect && !movingLesson && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onCopySelect(lesson);
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-2 sm:py-1.5 rounded-lg text-left text-sys-text-primary hover:bg-sky-500/10 hover:text-sky-600 dark:hover:text-sky-400 transition-colors"
                  >
                    <CopyIcon />
                    <span>Копіювати</span>
                  </button>
                )}

                {onMoveSelect && !movingLesson && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onMoveSelect(lesson);
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-2 sm:py-1.5 rounded-lg text-left text-sys-text-primary hover:bg-emerald-500/10 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
                  >
                    <MoveIcon />
                    <span>Перемістити</span>
                  </button>
                )}

                {onSwapSelect && !movingLesson && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onSwapSelect(lesson);
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-2 sm:py-1.5 rounded-lg text-left text-sys-text-primary hover:bg-amber-500/10 hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
                  >
                    <SwapIcon />
                    <span>Поміняти місцями</span>
                  </button>
                )}

                {onDeleteTemplate && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      if (
                        typeof window !== "undefined" &&
                        window.confirm(`Видалити пару «${lesson.subject_name}» з постійного розкладу?`)
                      ) {
                        onDeleteTemplate(lesson);
                      }
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-2 sm:py-1.5 rounded-lg text-left text-rose-700 dark:text-rose-400 hover:bg-rose-500/10 transition-colors"
                  >
                    <TrashIcon />
                    <span>Видалити</span>
                  </button>
                )}
              </>
            ) : (
              <>
                {canMove && !movingLesson && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onMoveSelect?.(lesson);
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-2 sm:py-1.5 rounded-lg text-left text-sys-text-primary hover:bg-emerald-500/10 hover:text-emerald-700 dark:hover:text-emerald-400 transition-colors"
                  >
                    <MoveIcon />
                    <span>Перенести</span>
                  </button>
                )}

                {onSwapSelect && !movingLesson && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onSwapSelect(lesson);
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-2 sm:py-1.5 rounded-lg text-left text-sys-text-primary hover:bg-amber-500/10 hover:text-amber-700 dark:hover:text-amber-400 transition-colors"
                  >
                    <SwapIcon />
                    <span>Поміняти місцями</span>
                  </button>
                )}

                {lesson.is_replacement ? (
                  onRemoveReplacement &&
                  lesson.group_id && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        if (
                          typeof window !== "undefined" &&
                          window.confirm(`Прибрати заміну «${lesson.subject_name}» на ${targetDate}?`)
                        ) {
                          onRemoveReplacement(lesson, targetDate);
                        }
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-2 sm:py-1.5 rounded-lg text-left text-amber-700 dark:text-amber-400 hover:bg-amber-500/10 transition-colors"
                    >
                      <span>↩</span>
                      <span>Прибрати заміну</span>
                    </button>
                  )
                ) : (
                  onCancelDated &&
                  lesson.group_id && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        if (
                          typeof window !== "undefined" &&
                          window.confirm(`Скасувати пару «${lesson.subject_name}» на ${targetDate}?`)
                        ) {
                          onCancelDated(lesson, targetDate);
                        }
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-2 sm:py-1.5 rounded-lg text-left text-rose-700 dark:text-rose-400 hover:bg-rose-500/10 transition-colors"
                    >
                      <CalendarOffIcon />
                      <span>Скасувати</span>
                    </button>
                  )
                )}

                {onOpenPermanentSchedule && (!lesson.is_replacement || lesson.has_template !== false) && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenPermanentSchedule(lesson);
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-2 sm:py-1.5 rounded-lg text-left text-sys-accent hover:bg-sys-accent/10 transition-colors"
                  >
                    <TemplateIcon />
                    <span>Змінити в постійному розкладі</span>
                  </button>
                )}

                {lesson.group_id && (
                  <>
                    <div className="border-t border-sys-border/40 my-1" />
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onOpenNoteModal("edit");
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-2 sm:py-1.5 rounded-lg text-left text-sys-text-secondary hover:text-sys-accent hover:bg-sys-accent/10 transition-colors"
                    >
                      <MessageSquareIcon className="w-3.5 h-3.5 shrink-0" />
                      <span>{visibleNoteText ? "Редагувати примітку" : "+ Примітка"}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onOpenNoteModal("history");
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-2 sm:py-1.5 rounded-lg text-left text-sys-text-secondary hover:text-sys-text-primary hover:bg-white/5 transition-colors"
                    >
                      <HistoryIcon className="w-3.5 h-3.5 shrink-0" />
                      <span>Історія примітки</span>
                    </button>
                  </>
                )}
              </>
            )}
          </m.div>
        </>
      )}
    </AnimatePresence>
  );
}

export type LessonActionsVariant = "desktop-day" | "mobile-day" | "week";

export function LessonCardActions({
  variant,
  lesson,
  targetDate,
  isEvent,
  canEditAction,
  canMove,
  isTemplateMode,
  movingLesson,
  visibleNoteText,
  moreOpen,
  onToggleMore,
  onCloseMore,
  onEdit,
  onRestoreDated,
  onRemoveReplacement,
  onCopySelect,
  onMoveSelect,
  onSwapSelect,
  onDeleteTemplate,
  onCancelDated,
  onOpenPermanentSchedule,
  onOpenNoteModal,
}: {
  variant: LessonActionsVariant;
  lesson: Lesson;
  targetDate: string;
  isEvent: boolean;
  canEditAction: boolean;
  canMove: boolean;
  isTemplateMode: boolean;
  movingLesson?: Lesson | null;
  visibleNoteText: string;
  moreOpen: boolean;
  onToggleMore: () => void;
  onCloseMore: () => void;
  onEdit?: (lesson: Lesson) => void;
  onRestoreDated?: (lesson: Lesson, date: string) => void;
  onRemoveReplacement?: (lesson: Lesson, date: string) => void;
  onCopySelect?: (lesson: Lesson) => void;
  onMoveSelect?: (lesson: Lesson | null) => void;
  onSwapSelect?: (lesson: Lesson) => void;
  onDeleteTemplate?: (lesson: Lesson) => void;
  onCancelDated?: (lesson: Lesson, date: string) => void;
  onOpenPermanentSchedule?: (lesson: Lesson) => void;
  onOpenNoteModal: (mode: "edit" | "history") => void;
}) {
  const wrapperClass =
    variant === "desktop-day"
      ? "relative flex items-center gap-1 ml-1"
      : variant === "mobile-day"
      ? "relative flex items-center gap-1.5 ml-auto shrink-0"
      : "relative flex items-center gap-1 shrink-0 whitespace-nowrap ml-auto lg:opacity-0 lg:group-hover:opacity-100 focus-within:opacity-100 transition-opacity";

  const wrapperStyle =
    variant === "week"
      ? { flex: "0 0 auto" as const, marginLeft: "auto", whiteSpace: "nowrap" as const }
      : undefined;

  const restoreCls =
    variant === "desktop-day"
      ? "inline-flex h-8 items-center justify-center rounded-lg border border-emerald-500/50 bg-emerald-500/15 px-2.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/25 active:scale-[0.98] transition-colors whitespace-nowrap"
      : variant === "mobile-day"
      ? "inline-flex h-9 items-center justify-center rounded-lg border border-emerald-500/50 bg-emerald-500/15 px-3 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/25 active:scale-[0.98] transition-colors whitespace-nowrap"
      : "inline-flex min-h-[44px] min-w-[44px] sm:min-h-[32px] items-center justify-center rounded-md border border-emerald-500/50 bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/25 active:scale-[0.98] transition-colors whitespace-nowrap";

  const removeCls =
    variant === "desktop-day"
      ? "inline-flex h-8 items-center justify-center rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 text-xs font-semibold text-rose-700 dark:text-rose-300 hover:bg-rose-500/20 active:scale-[0.98] transition-colors whitespace-nowrap"
      : variant === "mobile-day"
      ? "inline-flex h-9 items-center justify-center rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 text-xs font-semibold text-rose-700 dark:text-rose-300 hover:bg-rose-500/20 active:scale-[0.98] transition-colors whitespace-nowrap"
      : "inline-flex min-h-[44px] sm:min-h-[32px] items-center justify-center rounded-md border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-xs font-semibold text-rose-700 dark:text-rose-300 hover:bg-rose-500/20 active:scale-[0.98] transition-colors whitespace-nowrap";

  const editTitle =
    variant === "desktop-day"
      ? "Редагувати пару"
      : isEvent
      ? "Редагувати подію сесії"
      : lesson.is_replacement
      ? "Редагувати заміну"
      : "Редагувати пару";

  return (
    <div className={wrapperClass} style={wrapperStyle}>
      {lesson.is_cancelled ? (
        <div className={variant === "mobile-day" ? "flex items-center gap-1.5" : "flex items-center gap-1"}>
          {onRestoreDated && lesson.group_id && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRestoreDated(lesson, targetDate);
              }}
              title={lesson.moved_to_date ? "Скасувати перенесення та відновити пару" : `Відновити пару на ${targetDate}`}
              aria-label={lesson.moved_to_date ? "Скасувати перенесення та відновити пару" : `Відновити пару на ${targetDate}`}
              className={restoreCls}
              style={variant === "week" ? { whiteSpace: "nowrap" } : undefined}
            >
              Відновити
            </button>
          )}
          {onRemoveReplacement && lesson.group_id && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRemoveReplacement(lesson, targetDate);
              }}
              title="Очистити слот (повністю прибрати скасовану пару)"
              aria-label="Очистити слот"
              className={removeCls}
              style={variant === "week" ? { whiteSpace: "nowrap" } : undefined}
            >
              {variant === "desktop-day" ? "Очистити слот" : "Очистити"}
            </button>
          )}
        </div>
      ) : (
        <>
          {canEditAction && (
            <button
              type="button"
              title={editTitle}
              aria-label={variant === "desktop-day" ? "Редагувати пару" : `Редагувати ${lesson.subject_name}`}
              onClick={(e) => {
                e.stopPropagation();
                onEdit?.(lesson);
              }}
              className={
                variant === "desktop-day"
                  ? "w-8 h-8 flex items-center justify-center rounded-lg border border-sys-border/60 bg-sys-card text-sys-text-secondary hover:text-sys-accent hover:border-sys-accent/60"
                  : variant === "mobile-day"
                  ? "inline-flex h-9 px-2.5 items-center justify-center gap-1.5 rounded-lg border border-sys-border bg-sys-bg/80 text-xs font-semibold text-sys-text-primary hover:border-sys-accent/60 hover:text-sys-accent active:scale-[0.98] transition-colors whitespace-nowrap"
                  : "w-7 h-7 flex items-center justify-center rounded-md border border-sys-border/60 bg-sys-card text-sys-text-secondary hover:border-sys-accent/60 hover:bg-sys-accent/15 hover:text-sys-accent active:scale-[0.98] transition-colors"
              }
            >
              <EditIcon />
              {variant === "mobile-day" && <span>Редагувати</span>}
            </button>
          )}
          <button
            type="button"
            title="Більше дій"
            aria-label={variant === "desktop-day" ? "Більше дій" : "Більше дій для пари"}
            aria-expanded={moreOpen}
            onClick={(e) => {
              e.stopPropagation();
              onToggleMore();
            }}
            className={
              variant === "desktop-day"
                ? "w-8 h-8 flex items-center justify-center rounded-lg border border-sys-border/60 bg-sys-card text-sys-text-secondary hover:text-sys-text-primary"
                : variant === "mobile-day"
                ? "w-9 h-9 flex items-center justify-center rounded-lg border border-sys-border bg-sys-bg/80 text-sys-text-secondary hover:text-sys-text-primary active:scale-[0.98] transition-colors font-bold text-sm"
                : "w-7 h-7 flex items-center justify-center rounded-md border border-sys-border/60 bg-sys-card text-sys-text-secondary hover:text-sys-text-primary hover:bg-white/5 active:scale-[0.98] transition-colors font-bold text-sm tracking-widest leading-none"
            }
          >
            ⋯
          </button>
          <LessonMoreMenu
            open={moreOpen}
            onClose={onCloseMore}
            alignTop={variant !== "mobile-day"}
            lesson={lesson}
            targetDate={targetDate}
            isTemplateMode={isTemplateMode}
            canMove={canMove}
            movingLesson={movingLesson}
            visibleNoteText={visibleNoteText}
            onCopySelect={onCopySelect}
            onMoveSelect={onMoveSelect}
            onSwapSelect={onSwapSelect}
            onDeleteTemplate={onDeleteTemplate}
            onRemoveReplacement={onRemoveReplacement}
            onCancelDated={onCancelDated}
            onOpenPermanentSchedule={onOpenPermanentSchedule}
            onOpenNoteModal={onOpenNoteModal}
          />
        </>
      )}
    </div>
  );
}
