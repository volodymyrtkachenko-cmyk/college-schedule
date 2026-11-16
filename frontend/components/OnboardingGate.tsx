"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { api, type ReferenceRecord } from "../lib/api";
import { toTeacherSlug } from "../lib/slug";
import { isScheduleRoutePath } from "../lib/useMobileNav";
import { useOnboardingStatus } from "../lib/useOnboardingStatus";
import { WelcomeScreen } from "./WelcomeScreen";

function readCachedDirectoryList(key: string): ReferenceRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function OnboardingGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { isMounted, isOnboarded, isExempt, pathname, markOnboarded } = useOnboardingStatus();

  const isScheduleRoute = isScheduleRoutePath(pathname);
  const needsGlobalGate = isMounted && !isOnboarded && !isExempt && !isScheduleRoute;

  const backdropRef = useRef<HTMLDivElement>(null);
  const directoryRequestedRef = useRef(false);

  const [groups, setGroups] = useState<ReferenceRecord[]>([]);
  const [teachers, setTeachers] = useState<ReferenceRecord[]>([]);
  const [isLoadingDirectory, setIsLoadingDirectory] = useState(false);
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  const handleRetryDirectory = useCallback(() => {
    directoryRequestedRef.current = false;
    setDirectoryError(null);
    setReloadNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    const el = backdropRef.current as (HTMLDivElement & { inert?: boolean }) | null;
    if (!el) return;
    el.inert = needsGlobalGate;
  }, [needsGlobalGate]);

  useEffect(() => {
    if (!needsGlobalGate) return;

    const cachedGroups = readCachedDirectoryList("schedule:groups");
    const cachedTeachers = readCachedDirectoryList("schedule:teachers").filter(
      (t) => t.name && !t.name.includes("!")
    );
    if (cachedGroups.length > 0) setGroups(cachedGroups);
    if (cachedTeachers.length > 0) setTeachers(cachedTeachers);

    if (directoryRequestedRef.current) return;
    directoryRequestedRef.current = true;

    let cancelled = false;
    setDirectoryError(null);
    if (cachedGroups.length === 0 && cachedTeachers.length === 0) {
      setIsLoadingDirectory(true);
    }

    Promise.allSettled([api.directory.groups(), api.directory.teachers()])
      .then(([groupsRes, teachersRes]) => {
        if (cancelled) return;
        let loadedAny = cachedGroups.length > 0 || cachedTeachers.length > 0;
        if (groupsRes.status === "fulfilled" && Array.isArray(groupsRes.value)) {
          setGroups(groupsRes.value);
          if (groupsRes.value.length > 0) loadedAny = true;
          try {
            window.localStorage.setItem("schedule:groups", JSON.stringify(groupsRes.value));
          } catch {}
        }
        if (teachersRes.status === "fulfilled" && Array.isArray(teachersRes.value)) {
          const filteredTeachers = teachersRes.value.filter(
            (t) => t.name && !t.name.includes("!")
          );
          setTeachers(filteredTeachers);
          if (filteredTeachers.length > 0) loadedAny = true;
          try {
            window.localStorage.setItem("schedule:teachers", JSON.stringify(teachersRes.value));
          } catch {}
        }
        if (
          !loadedAny &&
          groupsRes.status === "rejected" &&
          teachersRes.status === "rejected"
        ) {
          setDirectoryError("Не вдалося завантажити список груп і викладачів. Перевірте інтернет.");
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingDirectory(false);
      });

    return () => {
      cancelled = true;
    };
  }, [needsGlobalGate, reloadNonce]);

  const handleComplete = useCallback(
    (selectedMode: "student" | "teacher", id: number) => {
      try {
        window.localStorage.setItem("schedule:mode", selectedMode);
        if (selectedMode === "student") {
          window.localStorage.setItem("schedule:groupId", String(id));
        } else {
          window.localStorage.setItem("schedule:teacherId", String(id));
        }
      } catch {}

      markOnboarded();

      if (selectedMode === "student") {
        const matchedGroup = groups.find((g) => g.id === id);
        router.replace(
          matchedGroup ? `/group/${encodeURIComponent(matchedGroup.name)}` : "/"
        );
      } else {
        const matchedTeacher = teachers.find((t) => t.id === id);
        router.replace(
          matchedTeacher ? `/teacher/${toTeacherSlug(matchedTeacher.name)}` : "/"
        );
      }
    },
    [groups, teachers, markOnboarded, router]
  );

  return (
    <>
      <div
        ref={backdropRef}
        aria-hidden={needsGlobalGate ? "true" : undefined}
        className={
          needsGlobalGate
            ? "blur-[8px] opacity-60 saturate-90 pointer-events-none select-none max-h-dvh overflow-hidden"
            : undefined
        }
      >
        {children}
      </div>

      {needsGlobalGate && (
        <WelcomeScreen
          groups={groups}
          teachers={teachers}
          initialMode="student"
          isLoadingDirectory={isLoadingDirectory}
          directoryError={directoryError}
          onRetryDirectory={handleRetryDirectory}
          onComplete={handleComplete}
        />
      )}
    </>
  );
}
