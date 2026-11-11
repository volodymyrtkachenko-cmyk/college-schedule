"use client";

import { useEffect, useLayoutEffect, useState } from "react";

export type ViewportTier = "mobile" | "tablet" | "desktop";

function getTier(): ViewportTier {
  if (typeof window === "undefined") return "desktop";
  const w = window.innerWidth;
  if (w < 640) return "mobile";
  if (w < 1024) return "tablet";
  return "desktop";
}

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function useViewportTier(): {
  tier: ViewportTier;
  isMounted: boolean;
  isDesktop: boolean;
  isMobile: boolean;
  isTablet: boolean;
} {
  // На старті завжди однаково на сервері й клієнті для чистої гідрації без #418
  const [tier, setTier] = useState<ViewportTier>("desktop");
  const [isMounted, setIsMounted] = useState(false);

  useIsomorphicLayoutEffect(() => {
    setIsMounted(true);
    const update = () => setTier(getTier());
    update();

    const mqlMobile = window.matchMedia("(max-width: 639px)");
    const mqlTablet = window.matchMedia("(min-width: 640px) and (max-width: 1023px)");
    const mqlDesktop = window.matchMedia("(min-width: 1024px)");

    mqlMobile.addEventListener("change", update);
    mqlTablet.addEventListener("change", update);
    mqlDesktop.addEventListener("change", update);

    return () => {
      mqlMobile.removeEventListener("change", update);
      mqlTablet.removeEventListener("change", update);
      mqlDesktop.removeEventListener("change", update);
    };
  }, []);

  return {
    tier,
    isMounted,
    isDesktop: isMounted ? tier === "desktop" : true,
    isMobile: isMounted ? tier === "mobile" : false,
    isTablet: isMounted ? tier === "tablet" : false,
  };
}
