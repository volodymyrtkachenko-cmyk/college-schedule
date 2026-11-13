export interface ViewTransitionHandle {
  finished: Promise<void>;
  ready: Promise<void>;
  updateCallbackDone: Promise<void>;
  skipTransition?: () => void;
}

type DocumentWithVT = Document & {
  startViewTransition?: (
    arg:
      | (() => void | Promise<void>)
      | { update: () => void | Promise<void>; types?: string[] },
  ) => ViewTransitionHandle;
};

/**
 * Starts a same-document View Transition with optional active transition types.
 * Falls back cleanly to single-argument `startViewTransition(update)` on older Safari/Chrome
 * or direct execution when unsupported or reduced-motion is preferred.
 */
export function startTypedViewTransition(
  types: string[],
  update: () => void | Promise<void>,
): ViewTransitionHandle | null {
  if (typeof document === "undefined" || typeof window === "undefined") {
    void update();
    return null;
  }

  const prefersReduced =
    window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
  const doc = document as DocumentWithVT;
  if (prefersReduced || typeof doc.startViewTransition !== "function") {
    void update();
    return null;
  }

  try {
    return doc.startViewTransition({ update, types });
  } catch {
    try {
      return doc.startViewTransition(update);
    } catch {
      void update();
      return null;
    }
  }
}
