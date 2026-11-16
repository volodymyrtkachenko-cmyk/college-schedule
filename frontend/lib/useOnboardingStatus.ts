"use client";

import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "./auth";
import {
  ADMIN_SESSION_STORAGE_KEY,
  ONBOARDING_CHANGE_EVENT,
  SETUP_COMPLETE_STORAGE_KEY,
  isOnboardingExemptPath,
  readStoredSetupComplete,
  writeStoredSetupComplete,
} from "./onboarding";

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function useOnboardingStatus() {
  const pathname = usePathname();
  const { user } = useAuth();
  const isExempt = isOnboardingExemptPath(pathname);

  const [isMounted, setIsMounted] = useState(false);
  const [hasStoredSetup, setHasStoredSetup] = useState(false);

  const syncFromStorage = useCallback(() => {
    setHasStoredSetup(readStoredSetupComplete());
  }, []);

  useIsomorphicLayoutEffect(() => {
    setIsMounted(true);
    syncFromStorage();
  }, [syncFromStorage, pathname]);

  useEffect(() => {
    const onOnboardingChange = () => syncFromStorage();
    const onStorage = (e: StorageEvent) => {
      if (
        e.key === null ||
        e.key === SETUP_COMPLETE_STORAGE_KEY ||
        e.key === ADMIN_SESSION_STORAGE_KEY
      ) {
        syncFromStorage();
      }
    };
    window.addEventListener(ONBOARDING_CHANGE_EVENT, onOnboardingChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(ONBOARDING_CHANGE_EVENT, onOnboardingChange);
      window.removeEventListener("storage", onStorage);
    };
  }, [syncFromStorage]);

  const markOnboarded = useCallback(() => {
    writeStoredSetupComplete();
    setHasStoredSetup(true);
  }, []);

  const isOnboarded = isExempt || Boolean(user) || hasStoredSetup;

  return {
    isMounted,
    isOnboarded,
    isExempt,
    pathname,
    markOnboarded,
  };
}
