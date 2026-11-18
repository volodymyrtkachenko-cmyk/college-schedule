"use client";

import { useEffect, useState } from "react";
import { prefersReducedMotion } from "./dialogTopLayer";

/**
 * Keeps a popover or dropdown mounted briefly while closing so CSS exit transitions
 * (`data-closing="true"`) play cleanly across Chrome, Safari, and Firefox.
 * Unmounts synchronously (0ms) when `prefers-reduced-motion: reduce` is active.
 */
export function useAnimatedDisclosure(isOpen: boolean, exitMs = 170) {
  const [rendered, setRendered] = useState(isOpen);

  if (isOpen && !rendered) {
    setRendered(true);
  }
  if (!isOpen && rendered && prefersReducedMotion()) {
    setRendered(false);
  }

  useEffect(() => {
    if (isOpen || !rendered) return;
    if (prefersReducedMotion()) {
      setRendered(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setRendered(false);
    }, exitMs);
    return () => window.clearTimeout(timer);
  }, [isOpen, rendered, exitMs]);

  return {
    shouldRender: rendered,
    isClosing: rendered && !isOpen && !prefersReducedMotion(),
  };
}
