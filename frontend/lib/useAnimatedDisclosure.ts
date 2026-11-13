"use client";

import { useEffect, useState } from "react";
import { prefersReducedMotion } from "./dialogTopLayer";

/**
 * Keeps a popover or dropdown mounted briefly while closing so CSS exit transitions
 * (`data-closing="true"`) play cleanly across Chrome, Safari, and Firefox.
 */
export function useAnimatedDisclosure(isOpen: boolean, exitMs = 170) {
  const [rendered, setRendered] = useState(isOpen);

  if (isOpen && !rendered) {
    setRendered(true);
  }

  useEffect(() => {
    if (isOpen || !rendered) return;
    const delay = prefersReducedMotion() ? 90 : exitMs;
    const timer = window.setTimeout(() => {
      setRendered(false);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [isOpen, rendered, exitMs]);

  return {
    shouldRender: rendered,
    isClosing: rendered && !isOpen,
  };
}
