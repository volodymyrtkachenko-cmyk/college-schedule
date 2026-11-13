"use client";

import React, {
  Suspense,
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  isScheduleRoutePath,
  resolveActiveMobileTab,
  resolveEffectiveScheduleMode,
  resolveHomeTabFromLocation,
  type MobileHomeTab,
  type MobileTab,
  type ScheduleMode,
} from "./navigation";

export { isScheduleRoutePath };
export type { MobileTab };

interface MobileNavContextValue {
  activeTab: MobileTab | null;
  homeTab: MobileHomeTab;
  setHomeTab: (tab: MobileHomeTab) => void;
  overdueCount: number;
  setOverdueCount: (count: number) => void;
  hideTasksTab: boolean;
  setHideTasksTab: (hide: boolean) => void;
  scheduleMode: ScheduleMode;
  setScheduleMode: (mode: ScheduleMode) => void;
  urlSearch: string;
}

const MobileNavContext = createContext<MobileNavContextValue | null>(null);

function MobileNavUrlSync({
  onLocationChange,
}: {
  onLocationChange: (pathname: string | null, search: string, isInitial: boolean) => void;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchStr = searchParams ? searchParams.toString() : "";
  const prevNavKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const navKey = `${pathname ?? ""}?${searchStr}`;
    const isInitial = prevNavKeyRef.current === null;
    if (prevNavKeyRef.current !== navKey) {
      prevNavKeyRef.current = navKey;
      onLocationChange(pathname, searchStr, isInitial);
    }
  }, [pathname, searchStr, onLocationChange]);

  useEffect(() => {
    const handlePopState = () => {
      const currentPath = window.location.pathname;
      const currentSearch = window.location.search.replace(/^\?/, "");
      prevNavKeyRef.current = `${currentPath}?${currentSearch}`;
      onLocationChange(currentPath, currentSearch, false);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [onLocationChange]);

  return null;
}

export function MobileNavProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [homeTab, setHomeTabState] = useState<MobileHomeTab>("schedule");
  const [overdueCount, setOverdueCount] = useState<number>(0);
  const [hideTasksTab, setHideTasksTab] = useState<boolean>(false);
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>("student");
  const [urlSearch, setUrlSearch] = useState<string>("");

  const handleLocationChange = useCallback(
    (nextPathname: string | null, searchStr: string, isInitial: boolean) => {
      setUrlSearch(searchStr);
      setHomeTabState(resolveHomeTabFromLocation(nextPathname, searchStr));

      if (typeof window === "undefined") return;
      const shouldSyncStoredMode =
        (!isScheduleRoutePath(nextPathname) && !nextPathname?.startsWith("/settings")) ||
        (isInitial &&
          !nextPathname?.startsWith("/group/") &&
          !nextPathname?.startsWith("/teacher/"));

      if (shouldSyncStoredMode) {
        let storedMode: string | null = null;
        try {
          storedMode = window.localStorage.getItem("schedule:mode");
        } catch {}
        const resolved = resolveEffectiveScheduleMode(searchStr, storedMode);
        setScheduleMode(resolved);
        setHideTasksTab(resolved === "teacher");
      }
    },
    []
  );

  const setHomeTab = useCallback((tab: MobileHomeTab) => {
    setHomeTabState(tab);
  }, []);

  const activeTab = useMemo(
    () => resolveActiveMobileTab(pathname, homeTab),
    [pathname, homeTab]
  );

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
      urlSearch,
    }),
    [activeTab, homeTab, setHomeTab, overdueCount, hideTasksTab, scheduleMode, urlSearch]
  );

  return (
    <MobileNavContext.Provider value={value}>
      <Suspense fallback={null}>
        <MobileNavUrlSync onLocationChange={handleLocationChange} />
      </Suspense>
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
