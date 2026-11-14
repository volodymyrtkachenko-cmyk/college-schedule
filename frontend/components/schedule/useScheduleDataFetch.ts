"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScheduleResponse, api } from "../../lib/api";
import { requestClassroomAuth } from "../../lib/classroomAuth";
import { KYIV_DATE_FMT, KYIV_TIME_FMT, formatKyivDateIso, getKyivInitialWeekAnchor } from "../../lib/date";
import {
  aggregateClassroomTasks,
  countOverdueClassroomTasks,
  mergeTasksLists,
} from "../../lib/schedule";
import { syncPersonalSubmissions, useClassroomSubmissions } from "../../lib/useClassroomSubmissions";
import { DEFAULT_TASK_FILTERS, useTaskGroups } from "../../lib/useTaskGroups";
import type { FullTaskItem } from "../TaskCardItem";
import type { ReturnTarget } from "./useScheduleSelection";

const tasksMemoryCache = new Map<number, { tasks: any[]; lastSyncedAt: string | null }>();
const EMPTY_TASKS: FullTaskItem[] = [];

interface UseScheduleDataFetchParams {
  groupId: number | null;
  setGroupId: (id: number) => void;
  mode: "student" | "teacher";
  week: ScheduleResponse[];
  weekAnchorDate: Date;
  currentWeekNumber: number | null;
  returnTarget: ReturnTarget | null;
  setToast: (msg: string, type?: "success" | "error" | "info") => void;
  setOverdueCount: (count: number) => void;
  onOpenTeacherPinModal: (groupName: string | null) => void;
  enableSidebarTaskGroups?: boolean;
}

export function useScheduleDataFetch({
  groupId,
  setGroupId,
  mode,
  week,
  weekAnchorDate,
  currentWeekNumber,
  returnTarget,
  setToast,
  setOverdueCount,
  onOpenTeacherPinModal,
  enableSidebarTaskGroups = true,
}: UseScheduleDataFetchParams) {
  const [classroomTasks, setClassroomTasks] = useState<any[]>([]);
  const [classroomLastSyncedAt, setClassroomLastSyncedAt] = useState<string | null>(null);
  const classroomLastSyncedAtRef = useRef<string | null>(null);
  classroomLastSyncedAtRef.current = classroomLastSyncedAt;
  const { isLinked, isLinkedToGroup, submissions, personalTeachers } = useClassroomSubmissions();
  const hasGroupTaskAccess = mode !== "student" || isLinkedToGroup(groupId);

  const readCachedGroupTasks = useCallback((gid: number | null): any[] => {
    if (typeof window === "undefined" || !gid) return [];
    try {
      const groupRaw = localStorage.getItem(`schedule:classroom_group_tasks:${gid}`);
      const groupList = groupRaw ? JSON.parse(groupRaw) : [];
      const linkedGid = Number(localStorage.getItem("schedule:classroom_linked_group_id")) || null;
      if (linkedGid === gid) {
        const personalRaw = localStorage.getItem("schedule:classroom_tasks");
        const personalList = personalRaw ? JSON.parse(personalRaw) : [];
        return mergeTasksLists(
          Array.isArray(groupList) ? groupList : [],
          Array.isArray(personalList) ? personalList : []
        );
      }
      return Array.isArray(groupList) ? groupList : [];
    } catch {
      return [];
    }
  }, []);

  useEffect(() => {
    if (!groupId) {
      setClassroomTasks([]);
      return;
    }
    const mem = tasksMemoryCache.get(groupId);
    if (mem) {
      setClassroomTasks(mem.tasks);
      if (mem.lastSyncedAt) setClassroomLastSyncedAt(mem.lastSyncedAt);
      return;
    }
    const cached = readCachedGroupTasks(groupId);
    if (cached.length > 0) {
      tasksMemoryCache.set(groupId, { tasks: cached, lastSyncedAt: null });
      setClassroomTasks(cached);
    }
  }, [groupId, readCachedGroupTasks]);

  useEffect(() => {
    const handlePersonalTasksSynced = (e: Event) => {
      const detail = (e as CustomEvent)?.detail;
      if (!detail || !Array.isArray(detail.tasks)) return;
      if (detail.groupId && groupId && Number(detail.groupId) !== Number(groupId)) return;
      setClassroomTasks((prev) => {
        const next = mergeTasksLists(prev, detail.tasks);
        if (groupId) {
          tasksMemoryCache.set(groupId, { tasks: next, lastSyncedAt: classroomLastSyncedAtRef.current });
          try {
            localStorage.setItem(`schedule:classroom_group_tasks:${groupId}`, JSON.stringify(next));
          } catch {}
        }
        return next;
      });
    };
    window.addEventListener("classroom-tasks-synced", handlePersonalTasksSynced);
    return () => window.removeEventListener("classroom-tasks-synced", handlePersonalTasksSynced);
  }, [groupId]);

  const syncInFlightRef = useRef(false);
  const weekStartStr = useMemo(() => formatKyivDateIso(weekAnchorDate), [weekAnchorDate]);

  useEffect(() => {
    const handleGlobalTrigger = (e: Event) => {
      if (e.defaultPrevented || syncInFlightRef.current) return;
      e.preventDefault();
      syncInFlightRef.current = true;
      void requestClassroomAuth({
        groupId,
        weekStart: weekStartStr,
        onSuccess: (res, usedCode) => {
          const gid = res.group_id ?? groupId;
          if (!returnTarget && gid && gid !== groupId) {
            setGroupId(gid);
          }
          if (Array.isArray(res?.tasks) && gid) {
            const existing = tasksMemoryCache.get(gid)?.tasks ?? [];
            const merged = mergeTasksLists(existing, res.tasks);
            tasksMemoryCache.set(gid, {
              tasks: merged,
              lastSyncedAt: res.last_synced_at ?? null,
            });
          }
          const parts = [`підтягнуто ${res.synced_links ?? 0} онлайн-пар`];
          if (res.synced_tasks > 0) parts.push(`${res.synced_tasks} завдань`);
          if (res.synced_students > 0) parts.push(`${res.synced_students} студентів`);
          const prefix =
            groupId !== null && res.group_id && groupId !== res.group_id
              ? `Перемкнуто на вашу групу ${res.group_name}`
              : `Група ${res.group_name}`;
          const autoNote = usedCode ? " (фонове автооновлення активне)" : "";
          setToast(`${prefix}: ${parts.join(", ")}${autoNote}!`, "success");
        },
        onError: (err) => {
          setToast(err.message || "Не вдалося підключитися до Google Classroom", "error");
        },
      })
        .catch(() => {})
        .finally(() => {
          syncInFlightRef.current = false;
        });
    };
    window.addEventListener("trigger-classroom-sync", handleGlobalTrigger);
    return () => window.removeEventListener("trigger-classroom-sync", handleGlobalTrigger);
  }, [groupId, weekStartStr, returnTarget, setGroupId, setToast]);

  useEffect(() => {
    const handlePrompt = (e?: Event) => {
      const detail = (e as CustomEvent)?.detail;
      if (detail?.isTeacherView) {
        onOpenTeacherPinModal(detail?.groupName || null);
        return;
      }
      setToast("Для перегляду онлайн-пари прив'яжіть Google Classroom цієї групи", "info");
      window.dispatchEvent(new CustomEvent("trigger-classroom-sync"));
    };
    window.addEventListener("prompt-classroom-link", handlePrompt);
    return () => window.removeEventListener("prompt-classroom-link", handlePrompt);
  }, [setToast, onOpenTeacherPinModal]);

  const formattedSyncTime = useMemo(() => {
    if (!classroomLastSyncedAt) return null;
    try {
      const d = new Date(classroomLastSyncedAt);
      if (isNaN(d.getTime())) return null;
      return KYIV_TIME_FMT.format(d);
    } catch {
      return null;
    }
  }, [classroomLastSyncedAt]);

  const currentGroupIdRef = useRef<number | null>(groupId);
  currentGroupIdRef.current = groupId;

  const fetchClassroomTasks = useCallback(
    async (gid: number) => {
      try {
        const res = await api.classroom.groupStatus(gid);
        if (currentGroupIdRef.current !== gid) return;
        if (Array.isArray(res?.tasks) && res.tasks.length > 0) {
          setClassroomTasks((prev) => {
            const merged = mergeTasksLists(prev, res.tasks);
            tasksMemoryCache.set(gid, {
              tasks: merged,
              lastSyncedAt: res?.last_synced_at ?? null,
            });
            try {
              localStorage.setItem(`schedule:classroom_group_tasks:${gid}`, JSON.stringify(merged));
            } catch {}
            return merged;
          });
        }
        if (res?.last_synced_at) {
          setClassroomLastSyncedAt(res.last_synced_at);
          const prevMem = tasksMemoryCache.get(gid);
          if (prevMem) {
            tasksMemoryCache.set(gid, { tasks: prevMem.tasks, lastSyncedAt: res.last_synced_at });
          }
        }
        if (isLinked && res && res.requires_auth === false && !isLinkedToGroup(gid)) {
          try {
            localStorage.setItem("schedule:classroom_linked_group_id", String(gid));
            window.dispatchEvent(new Event("classroom-linked-change"));
            window.dispatchEvent(new Event("classroom-access-changed"));
          } catch {}
          void syncPersonalSubmissions(gid);
          return;
        }
      } catch {
        // Ignore background fetch error
      }
      if (isLinked && currentGroupIdRef.current === gid) {
        void syncPersonalSubmissions(gid);
      }
    },
    [isLinked, isLinkedToGroup]
  );

  useEffect(() => {
    if (groupId) {
      const mem = tasksMemoryCache.get(groupId);
      const cached = mem ? mem.tasks : readCachedGroupTasks(groupId);
      if (cached.length > 0 && !mem) {
        tasksMemoryCache.set(groupId, { tasks: cached, lastSyncedAt: null });
        setClassroomTasks(cached);
      }
      // Defer background sync when cached tasks already exist so mobile startup stays responsive
      const delayMs = cached.length > 0 ? 1200 : 150;
      const timer = setTimeout(() => {
        void fetchClassroomTasks(groupId);
      }, delayMs);
      return () => clearTimeout(timer);
    }
    setClassroomTasks([]);
    setClassroomLastSyncedAt(null);
  }, [groupId, readCachedGroupTasks, fetchClassroomTasks]);

  useEffect(() => {
    let lastClassroomVisibilitySync = 0;
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        const now = Date.now();
        if (now - lastClassroomVisibilitySync >= 60_000) {
          lastClassroomVisibilitySync = now;
          if (groupId) {
            void fetchClassroomTasks(groupId);
          }
        }
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [groupId, fetchClassroomTasks]);

  useEffect(() => {
    const handleClassroomSynced = (e: Event) => {
      const detail = (e as CustomEvent)?.detail;
      const isSilent = Boolean(detail?.is_silent);
      if (!isSilent && detail?.group_id && detail.group_id !== groupId) {
        setGroupId(detail.group_id);
      }
      if (detail?.tasks && Array.isArray(detail.tasks) && detail.tasks.length > 0) {
        const targetGid = detail.group_id ?? groupId;
        if (!isSilent || !detail?.group_id || detail.group_id === groupId) {
          setClassroomTasks((prev) => {
            const merged = mergeTasksLists(prev, detail.tasks);
            if (targetGid) {
              try {
                localStorage.setItem(`schedule:classroom_group_tasks:${targetGid}`, JSON.stringify(merged));
              } catch {}
            }
            return merged;
          });
        }
      }
      if (detail?.last_synced_at) {
        setClassroomLastSyncedAt(detail.last_synced_at);
      } else if (!isSilent && groupId) {
        void fetchClassroomTasks(groupId);
      }
    };
    window.addEventListener("classroom-synced", handleClassroomSynced);
    return () => window.removeEventListener("classroom-synced", handleClassroomSynced);
  }, [groupId, fetchClassroomTasks, setGroupId]);

  const handleToolbarClassroomSynced = useCallback(
    (detectedId: number | null, tasks?: any[], lastSynced?: string | null, isSilent?: boolean) => {
      if (!isSilent && !returnTarget && detectedId && detectedId !== groupId) {
        setGroupId(detectedId);
      }
      if (tasks && Array.isArray(tasks)) {
        setClassroomTasks((prev) => {
          const merged = mergeTasksLists(prev, tasks);
          if (groupId) {
            tasksMemoryCache.set(groupId, {
              tasks: merged,
              lastSyncedAt: lastSynced ?? classroomLastSyncedAt,
            });
            try {
              localStorage.setItem(`schedule:classroom_group_tasks:${groupId}`, JSON.stringify(merged));
            } catch {}
          }
          return merged;
        });
      }
      if (lastSynced) {
        setClassroomLastSyncedAt(lastSynced);
      }
    },
    [returnTarget, groupId, setGroupId, classroomLastSyncedAt]
  );

  const allTasks = useMemo(
    () =>
      aggregateClassroomTasks({
        mode,
        week,
        classroomTasks,
        isLinked,
        submissions,
        personalTeachers,
      }),
    [mode, week, classroomTasks, isLinked, submissions, personalTeachers]
  );

  const sidebarTaskGroups = useTaskGroups(
    enableSidebarTaskGroups ? allTasks : EMPTY_TASKS,
    "week",
    weekAnchorDate,
    currentWeekNumber,
    isLinked,
    DEFAULT_TASK_FILTERS
  );

  const overdueCount = useMemo(
    () =>
      countOverdueClassroomTasks(
        allTasks,
        isLinked,
        KYIV_DATE_FMT.format(getKyivInitialWeekAnchor())
      ),
    [allTasks, isLinked]
  );

  useEffect(() => {
    setOverdueCount(isLinked ? overdueCount : 0);
  }, [isLinked, overdueCount, setOverdueCount]);

  return {
    isLinked,
    classroomLastSyncedAt,
    formattedSyncTime,
    hasGroupTaskAccess,
    allTasks,
    sidebarTaskGroups,
    guideTaskGroups: sidebarTaskGroups,
    handleToolbarClassroomSynced,
  };
}
