"use client";

import { useSyncExternalStore } from "react";

export type ViewportTier = "mobile" | "tablet" | "desktop";

interface ViewportSnapshot {
  tier: ViewportTier;
  isMounted: boolean;
  isDesktop: boolean;
  isMobile: boolean;
  isTablet: boolean;
}

const SERVER_SNAPSHOT: ViewportSnapshot = {
  tier: "desktop",
  isMounted: false,
  isDesktop: true,
  isMobile: false,
  isTablet: false,
};

let currentSnapshot: ViewportSnapshot = SERVER_SNAPSHOT;
let listenersInitialized = false;
const subscribers = new Set<() => void>();

function computeClientSnapshot(): ViewportSnapshot {
  if (typeof window === "undefined") return SERVER_SNAPSHOT;
  const w = window.innerWidth;
  const tier: ViewportTier = w < 640 ? "mobile" : w < 1024 ? "tablet" : "desktop";
  if (
    currentSnapshot.isMounted &&
    currentSnapshot.tier === tier
  ) {
    return currentSnapshot;
  }
  currentSnapshot = {
    tier,
    isMounted: true,
    isDesktop: tier === "desktop",
    isMobile: tier === "mobile",
    isTablet: tier === "tablet",
  };
  return currentSnapshot;
}

function initViewportListeners() {
  if (listenersInitialized || typeof window === "undefined") return;
  listenersInitialized = true;
  computeClientSnapshot();

  const notify = () => {
    const prev = currentSnapshot;
    const next = computeClientSnapshot();
    if (prev !== next) {
      subscribers.forEach((cb) => cb());
    }
  };

  const mqlMobile = window.matchMedia("(max-width: 639px)");
  const mqlTablet = window.matchMedia("(min-width: 640px) and (max-width: 1023px)");
  const mqlDesktop = window.matchMedia("(min-width: 1024px)");

  mqlMobile.addEventListener("change", notify);
  mqlTablet.addEventListener("change", notify);
  mqlDesktop.addEventListener("change", notify);
  window.addEventListener("resize", notify);
}

function subscribe(callback: () => void): () => void {
  initViewportListeners();
  subscribers.add(callback);
  return () => {
    subscribers.delete(callback);
  };
}

function getClientSnapshot(): ViewportSnapshot {
  initViewportListeners();
  return computeClientSnapshot();
}

function getServerSnapshot(): ViewportSnapshot {
  return SERVER_SNAPSHOT;
}

export function useViewportTier(): ViewportSnapshot {
  return useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
}
