import { useMemo } from "react";
import { FullTaskItem } from "../components/MobileTasksView";
import { getMondayOf, formatShortWeekRange } from "./format";

export interface TaskGroupsResult {
  pastWeekTasks: FullTaskItem[];
  overdueTasks: FullTaskItem[];
  activeTasks: FullTaskItem[];
  noDateTasks: FullTaskItem[];
  turnedInTasks: FullTaskItem[];
  totalCount: number;
  activeCount: number;
  isOnlyTurnedIn: boolean;
  weekLabel: string;
}

export function formatTaskWord(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "завдання";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "завдання";
  return "завдань";
}

export function useTaskGroups(
  tasks: FullTaskItem[],
  scope: "week" | "all",
  weekAnchorDate: Date,
  weekNumber: number | null | undefined,
  isLinked: boolean,
  searchQuery = ""
): TaskGroupsResult {
  const currentWeekMonday = useMemo(() => {
    return getMondayOf(weekAnchorDate || new Date());
  }, [weekAnchorDate]);

  const mondayIso = useMemo(() => {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(currentWeekMonday);
  }, [currentWeekMonday]);

  const sundayIso = useMemo(() => {
    const sun = new Date(currentWeekMonday);
    sun.setDate(sun.getDate() + 6);
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(sun);
  }, [currentWeekMonday]);

  const weekLabel = useMemo(() => {
    return formatShortWeekRange(currentWeekMonday, weekNumber);
  }, [currentWeekMonday, weekNumber]);

  const filteredTasks = useMemo(() => {
    if (!searchQuery.trim()) return tasks;
    const q = searchQuery.toLowerCase();
    return tasks.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.subject.toLowerCase().includes(q) ||
        (t.teacher && t.teacher.toLowerCase().includes(q))
    );
  }, [tasks, searchQuery]);

  return useMemo(() => {
    const pastWeekTasks: FullTaskItem[] = [];
    const overdueTasks: FullTaskItem[] = [];
    const activeTasks: FullTaskItem[] = [];
    const noDateTasks: FullTaskItem[] = [];
    const turnedInTasks: FullTaskItem[] = [];

    for (const t of filteredTasks) {
      const isDone = isLinked && (t.state === "TURNED_IN" || t.state === "RETURNED");

      let dueIso = t.dueDateIso;
      if (!dueIso && t.deadline.date) {
        dueIso = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(t.deadline.date);
      }

      if (scope === "all") {
        if (isDone) {
          turnedInTasks.push(t);
        } else if (t.deadline.isOverdue) {
          overdueTasks.push(t);
        } else if (dueIso) {
          activeTasks.push(t);
        } else {
          noDateTasks.push(t);
        }
      } else {
        // scope === "week"
        if (isDone) {
          // Turned-in tasks belonging to this week
          const belongsToThisWeek =
            t.isBoundToWeek || (dueIso && dueIso >= mondayIso && dueIso <= sundayIso);
          if (belongsToThisWeek) {
            turnedInTasks.push(t);
          }
        } else {
          // Uncompleted tasks
          if (dueIso && dueIso < mondayIso) {
            // Uncompleted overdue from past weeks: Section 22.1
            pastWeekTasks.push(t);
          } else if (dueIso && dueIso >= mondayIso && dueIso <= sundayIso) {
            if (t.deadline.isOverdue) {
              overdueTasks.push(t);
            } else {
              activeTasks.push(t);
            }
          } else if (t.isBoundToWeek && dueIso) {
            if (t.deadline.isOverdue) {
              overdueTasks.push(t);
            } else {
              activeTasks.push(t);
            }
          } else if (!dueIso) {
            // Uncompleted tasks with no deadline: Section 22.3 (never disappear)
            noDateTasks.push(t);
          }
          // If dueIso > sundayIso and not bound to this week, it belongs to that future week
        }
      }
    }

    const activeCount =
      pastWeekTasks.length + overdueTasks.length + activeTasks.length + noDateTasks.length;
    const isOnlyTurnedIn = activeCount === 0 && turnedInTasks.length > 0;
    const totalCount = activeCount + turnedInTasks.length;

    return {
      pastWeekTasks,
      overdueTasks,
      activeTasks,
      noDateTasks,
      turnedInTasks,
      totalCount,
      activeCount,
      isOnlyTurnedIn,
      weekLabel,
    };
  }, [filteredTasks, scope, mondayIso, sundayIso, isLinked, weekLabel]);
}
