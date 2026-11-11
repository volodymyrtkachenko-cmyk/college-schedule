"use client";

import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from "react";
import { usePathname } from "next/navigation";

export type MobileTab = "schedule" | "tasks" | "settings";

interface MobileNavContextValue {
  activeTab: MobileTab;
  homeTab: "schedule" | "tasks";
  setHomeTab: (tab: "schedule" | "tasks") => void;
  overdueCount: number;
  setOverdueCount: (count: number) => void;
  hideTasksTab: boolean;
  setHideTasksTab: (hide: boolean) => void;
  scheduleMode: "student" | "teacher";
  setScheduleMode: (mode: "student" | "teacher") => void;
}

const MobileNavContext = createContext<MobileNavContextValue | null>(null);

export function isScheduleRoutePath(pathname?: string | null): boolean {
  if (!pathname) return false;
  return (
    pathname === "/" ||
    pathname.startsWith("/group/") ||
    pathname.startsWith("/teacher/")
  );
}

export function MobileNavProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [homeTab, setHomeTabState] = useState<"schedule" | "tasks">("schedule");
  const [overdueCount, setOverdueCount] = useState<number>(0);
  const [hideTasksTab, setHideTasksTab] = useState<boolean>(false);
  const [scheduleMode, setScheduleMode] = useState<"student" | "teacher">("student");

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("tab") === "tasks") {
        setHomeTabState("tasks");
      }
      const cachedMode = window.localStorage.getItem("schedule:mode") as "student" | "teacher" | null;
      if (cachedMode === "student" || cachedMode === "teacher") {
        setScheduleMode(cachedMode);
      }
    }
  }, []);

  useEffect(() => {
    if (isScheduleRoutePath(pathname) && typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("tab") === "tasks") {
        setHomeTabState("tasks");
      }
    }
  }, [pathname]);

  const setHomeTab = useCallback((tab: "schedule" | "tasks") => {
    setHomeTabState(tab);
  }, []);

  const activeTab: MobileTab = useMemo(() => {
    if (pathname?.startsWith("/settings")) {
      return "settings";
    }
    return homeTab;
  }, [pathname, homeTab]);

  const value = useMemo(
    () => ({
      activeTab,
      homeTab,
      setHomeTab,
      overdueCount,
      setOverdueCount,
      hideTasksTab,
      setHideTasksTab,
      scheduleMode,
      setScheduleMode,
    }),
    [activeTab, homeTab, setHomeTab, overdueCount, hideTasksTab, scheduleMode]
  );

  return (
    <MobileNavContext.Provider value={value}>
      {children}
    </MobileNavContext.Provider>
  );
}

export function useMobileNav() {
  const ctx = useContext(MobileNavContext);
  if (!ctx) {
    throw new Error("useMobileNav must be used within MobileNavProvider");
  }
  return ctx;
}
