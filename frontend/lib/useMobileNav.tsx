"use client";

import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from "react";
import { usePathname } from "next/navigation";

export type MobileTab = "schedule" | "tasks" | "settings" | null;

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

export function MobileNavProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [homeTab, setHomeTabState] = useState<"schedule" | "tasks">("schedule");
  const [overdueCount, setOverdueCount] = useState<number>(0);
  const [hideTasksTab, setHideTasksTab] = useState<boolean>(false);
  const [scheduleMode, setScheduleMode] = useState<"student" | "teacher">("student");

  const isHomeRoute =
    pathname === "/" ||
    Boolean(pathname?.startsWith("/group/") || pathname?.startsWith("/teacher/"));

  // Read initial homeTab and mode from URL/localStorage
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const tab = params.get("tab");
      if (tab === "tasks") {
        setHomeTabState("tasks");
      }
      const cachedMode = window.localStorage.getItem("schedule:mode") as "student" | "teacher" | null;
      if (cachedMode === "student" || cachedMode === "teacher") {
        setScheduleMode(cachedMode);
      }
    }
  }, []);

  // When on home route ("/", "/group/*", "/teacher/*"), sync homeTab with current URL query params (?tab=tasks vs none):
  useEffect(() => {
    if (isHomeRoute && typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const tab = params.get("tab");
      if (tab === "tasks") {
        setHomeTabState("tasks");
      } else {
        setHomeTabState("schedule");
      }
    }
  }, [pathname, isHomeRoute]);

  // Handle browser back/forward history navigation (popstate)
  useEffect(() => {
    const handlePopState = () => {
      if (isHomeRoute && typeof window !== "undefined") {
        const params = new URLSearchParams(window.location.search);
        const tab = params.get("tab");
        if (tab === "tasks") {
          setHomeTabState("tasks");
        } else {
          setHomeTabState("schedule");
        }
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [isHomeRoute]);

  const setHomeTab = useCallback((tab: "schedule" | "tasks") => {
    setHomeTabState(tab);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (tab === "tasks") {
        url.searchParams.set("tab", "tasks");
      } else {
        url.searchParams.delete("tab");
      }
      window.history.replaceState({}, "", url.pathname + url.search);
    }
  }, []);

  // Compute activeTab: "settings" on /settings, homeTab on home routes, null on secondary pages (/bells, /statistics, /educational-process)
  const activeTab: MobileTab = useMemo(() => {
    if (pathname?.startsWith("/settings")) {
      return "settings";
    }
    if (isHomeRoute) {
      return homeTab;
    }
    return null;
  }, [pathname, isHomeRoute, homeTab]);

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
