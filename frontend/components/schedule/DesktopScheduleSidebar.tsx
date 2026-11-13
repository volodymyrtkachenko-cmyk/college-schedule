"use client";

import dynamic from "next/dynamic";
import type { WeekDayMini } from "../../lib/schedule";
import { formatTaskWord, type TaskGroupsResult } from "../../lib/useTaskGroups";
import { ClassroomSyncButton } from "../ClassroomSyncButton";
import type { FullTaskItem } from "../TaskCardItem";

const TasksTodoBoard = dynamic(() => import("../MobileTasksView").then((m) => m.TasksTodoBoard), { ssr: false });
const GradesView = dynamic(() => import("../GradesView").then((m) => m.GradesView), { ssr: false });

interface DesktopScheduleSidebarProps {
  visible: boolean;
  shouldReduceMotion: boolean;
  mode: "student" | "teacher";
  groupId: number | null;
  weekStartStr: string;
  currentWeekNumber: number | null;
  weekType: string;
  weekRange: string;
  weekDaysMini: WeekDayMini[];
  selectedDayIndex: number;
  todayActualIso: string;
  desktopSidebarTab: "tasks" | "grades";
  hasGroupTaskAccess: boolean;
  isLinked: boolean;
  sidebarTaskGroups: TaskGroupsResult;
  formattedSyncTime: string | null;
  allTasks: FullTaskItem[];
  onToggleFocusMode: () => void;
  onSelectDayIndex: (index: number) => void;
  onChangeSidebarTab: (tab: "tasks" | "grades") => void;
  onClassroomSynced: (
    detectedId: number | null,
    tasks?: any[],
    lastSynced?: string | null,
    isSilent?: boolean
  ) => void;
}

export function DesktopScheduleSidebar({
  visible,
  shouldReduceMotion,
  mode,
  groupId,
  weekStartStr,
  currentWeekNumber,
  weekType,
  weekRange,
  weekDaysMini,
  selectedDayIndex,
  todayActualIso,
  desktopSidebarTab,
  hasGroupTaskAccess,
  isLinked,
  sidebarTaskGroups,
  formattedSyncTime,
  allTasks,
  onToggleFocusMode,
  onSelectDayIndex,
  onChangeSidebarTab,
  onClassroomSynced,
}: DesktopScheduleSidebarProps) {
  if (!visible) return null;

  const clampedDayIndex = Math.max(0, Math.min(selectedDayIndex, Math.max(0, weekDaysMini.length - 1)));

  return (
    <aside className="ml-8 hidden lg:block w-[360px] shrink-0">
      <div className="w-[360px] flex flex-col gap-6 sticky top-[72px]">
        {/* Week & Navigator Card */}
        <div className="rounded-2xl border border-sys-border bg-sys-card p-5 shadow-sm">
          <div className="pb-3.5 border-b border-sys-border/50 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-sys-text-muted">
                <span>{currentWeekNumber ? `${currentWeekNumber} ТИЖДЕНЬ` : "РОЗКЛАД"}</span>
                {weekType !== "both" && (
                  <>
                    <span>•</span>
                    <span
                      title={
                        weekType === "numerator"
                          ? "Чисельник — непарний тиждень навчального графіка"
                          : "Знаменник — парний тиждень навчального графіка"
                      }
                      className="lowercase font-medium text-sys-text-secondary cursor-help underline decoration-dotted underline-offset-2"
                    >
                      {weekType === "numerator" ? "чисельник" : "знаменник"}
                    </span>
                  </>
                )}
              </div>
              <h2 className="text-base sm:text-lg font-semibold text-sys-text-primary mt-1 leading-snug">
                {weekRange}
              </h2>
            </div>

            <button
              type="button"
              onClick={onToggleFocusMode}
              title="Фокус на розкладі (приховати панелі)"
              aria-label="Фокус на розкладі (приховати панелі)"
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-sys-border bg-sys-bg text-sys-text-secondary hover:text-sys-accent hover:border-sys-accent/40 transition-colors shrink-0 cursor-pointer"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="18" height="18" x="3" y="3" rx="2" />
                <path d="M15 3v18" />
                <path d="m11 15-3-3 3-3" />
              </svg>
            </button>
          </div>

          {/* 5-Day Quick Switcher — Pure GPU translate3d pill */}
          <div className="mt-4">
            <div className="relative grid grid-cols-5 gap-2 isolate">
              {weekDaysMini.length === 5 && (
                <div
                  aria-hidden="true"
                  className={`pointer-events-none absolute top-0 bottom-0 left-0 z-0 rounded-xl bg-sys-accentSolid shadow-md ring-2 ring-sys-accent/60 transform-gpu ${
                    shouldReduceMotion
                      ? ""
                      : "transition-transform duration-base [transition-timing-function:var(--ease-spring-snappy)]"
                  }`}
                  style={{
                    width: "calc((100% - 32px) / 5)",
                    transform: `translate3d(calc(${clampedDayIndex} * (100% + 8px)), 0, 0)`,
                  }}
                />
              )}

              {weekDaysMini.map((d) => {
                const isActive = d.index === selectedDayIndex;
                const isToday = d.iso === todayActualIso;
                return (
                  <button
                    key={d.iso}
                    type="button"
                    onClick={() => onSelectDayIndex(d.index)}
                    className={`relative z-10 flex flex-col items-center justify-center h-16 rounded-xl transition-colors duration-150 cursor-pointer active:scale-95 ${
                      isActive
                        ? "text-white font-black"
                        : "border border-sys-border bg-sys-bg text-sys-text-secondary hover:text-sys-text-primary hover:border-sys-elevated-border font-medium"
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs uppercase font-semibold opacity-90">{d.name}</span>
                      {isToday && (
                        <span
                          title="Сьогодні"
                          className={`h-1.5 w-1.5 rounded-full shrink-0 ${isActive ? "bg-white" : "bg-sys-accent"}`}
                        />
                      )}
                    </div>
                    <span className="text-xl font-bold mt-0.5 leading-none">{d.dateStr}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Google Classroom Deadlines Widget */}
        <div className="rounded-2xl border border-sys-border bg-sys-card p-5 shadow-sm min-h-[260px]">
          <div className="pb-3 border-b border-sys-border/50">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-purple-600 dark:text-purple-400">
                  <path d="M16 4h2a2 2 0 0 1 2 2v14l-8-4-8 4V6a2 2 0 0 1 2-2h2" />
                  <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
                </svg>
                <h2 className="text-sm font-bold uppercase tracking-wider text-sys-text-primary">
                  Classroom
                </h2>
              </div>

              {/* Desktop Segmented Toggle: Завдання vs Оцінки (Pure GPU translate3d) */}
              <div className="relative grid grid-cols-2 items-center rounded-lg border border-sys-border bg-sys-bg p-0.5 text-xs shadow-xs isolate">
                <div
                  aria-hidden="true"
                  className={`pointer-events-none absolute top-0.5 bottom-0.5 left-0.5 z-0 rounded-md bg-sys-accentSolid shadow-xs transform-gpu ${
                    shouldReduceMotion
                      ? ""
                      : "transition-transform duration-150 ease-out"
                  }`}
                  style={{
                    width: "calc((100% - 4px) / 2)",
                    transform: `translate3d(${desktopSidebarTab === "grades" ? "100%" : "0%"}, 0, 0)`,
                  }}
                />
                <button
                  type="button"
                  onClick={() => onChangeSidebarTab("tasks")}
                  className={`relative z-10 rounded-md px-2 py-0.5 font-semibold transition-colors duration-150 cursor-pointer text-center ${
                    desktopSidebarTab === "tasks"
                      ? "text-white font-bold"
                      : "text-sys-text-secondary hover:text-sys-text-primary"
                  }`}
                >
                  Завдання
                </button>
                <button
                  type="button"
                  onClick={() => onChangeSidebarTab("grades")}
                  className={`relative z-10 rounded-md px-2 py-0.5 font-semibold transition-colors duration-150 cursor-pointer text-center ${
                    desktopSidebarTab === "grades"
                      ? "text-white font-bold"
                      : "text-sys-text-secondary hover:text-sys-text-primary"
                  }`}
                >
                  Оцінки
                </button>
              </div>
            </div>

            {((desktopSidebarTab === "tasks" && hasGroupTaskAccess) || (mode === "student" && groupId)) && (
              <div className="mt-2 flex items-center justify-between gap-2 text-xs text-sys-text-secondary min-w-0">
                <div className="flex items-center gap-1.5 min-w-0 truncate">
                  {desktopSidebarTab === "tasks" && hasGroupTaskAccess ? (
                    <>
                      <span className="truncate">
                        {isLinked
                          ? `Активних: ${sidebarTaskGroups.activeCount}`
                          : `Усього: ${sidebarTaskGroups.totalCount} ${formatTaskWord(sidebarTaskGroups.totalCount)}`}
                      </span>
                      {formattedSyncTime && (
                        <span className="shrink-0 text-sys-text-muted">• {formattedSyncTime}</span>
                      )}
                    </>
                  ) : (
                    <span className="truncate text-sys-text-muted">
                      {isLinked ? "Синхронізація активна" : "Підключіть Classroom"}
                    </span>
                  )}
                </div>

                {mode === "student" && groupId && (
                  <ClassroomSyncButton
                    compact
                    listenGlobalTrigger={false}
                    currentGroupId={groupId}
                    weekStart={weekStartStr}
                    onSynced={onClassroomSynced}
                  />
                )}
              </div>
            )}
          </div>

          {!hasGroupTaskAccess ? (
            <div className="mt-4 rounded-2xl border border-sky-500/20 bg-sky-500/5 p-5 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-500/10 text-sky-700 dark:text-sky-400 border border-sky-500/20">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </div>
              <h3 className="text-sm font-semibold text-sys-text-primary mb-1">
                {desktopSidebarTab === "grades" ? "Оцінки захищено" : "Завдання захищено"}
              </h3>
              <p className="text-xs text-sys-text-secondary leading-relaxed mb-4">
                Домашні завдання та матеріали доступні лише для студентів цієї групи. Підключіть студентський Google Classroom, щоб отримати доступ.
              </p>
              <button
                type="button"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent("trigger-classroom-sync"));
                }}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-white font-medium text-xs px-4 py-2.5 transition-colors shadow-sm cursor-pointer active:scale-95"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                  <polyline points="10 17 15 12 10 7" />
                  <line x1="15" y1="12" x2="3" y2="12" />
                </svg>
                <span>Прив&apos;язати Google Classroom</span>
              </button>
            </div>
          ) : desktopSidebarTab === "grades" ? (
            <div className="mt-4">
              <GradesView
                tasks={allTasks}
                isLinked={isLinked}
                onSyncClassroom={() =>
                  window.dispatchEvent(new CustomEvent("trigger-classroom-sync"))
                }
              />
            </div>
          ) : (
            <div className="mt-4">
              <TasksTodoBoard
                tasks={allTasks}
                isLinked={isLinked}
                layoutPrefix="desktop-sidebar-tasks"
              />
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
