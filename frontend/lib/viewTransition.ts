export interface ViewTransitionHandle {
  finished: Promise<void>;
  ready: Promise<void>;
  updateCallbackDone: Promise<void>;
  skipTransition?: () => void;
}

export interface TypedViewTransitionOptions {
  /** Marker placed on `document.documentElement.dataset.vtKind` while snapshots and animations run. */
  kind?: string;
  /** Runs when pseudo-element animations are ready (`vt.ready`). */
  onReady?: () => void;
  /** Runs once the transition completes or is skipped (`vt.finished`). */
  onFinish?: () => void;
}

type DocumentWithVT = Document & {
  startViewTransition?: (
    arg:
      | (() => void | Promise<void>)
      | { update: () => void | Promise<void>; types?: string[] },
  ) => ViewTransitionHandle;
};

function clearVtKindIfMatching(kind?: string) {
  if (!kind || typeof document === "undefined") return;
  if (document.documentElement.dataset.vtKind === kind) {
    delete document.documentElement.dataset.vtKind;
  }
}

/**
 * Starts a same-document View Transition with optional active transition types and `data-vt-kind`.
 * Falls back cleanly to single-argument `startViewTransition(update)` on older Safari/Chrome
 * or direct execution when unsupported or reduced-motion is preferred.
 */
export function startTypedViewTransition(
  types: string[],
  update: () => void | Promise<void>,
  options?: TypedViewTransitionOptions,
): ViewTransitionHandle | null {
  const kind = options?.kind;

  if (typeof document === "undefined" || typeof window === "undefined") {
    void update();
    options?.onReady?.();
    options?.onFinish?.();
    return null;
  }

  const prefersReduced =
    window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
  const doc = document as DocumentWithVT;
  if (prefersReduced || typeof doc.startViewTransition !== "function") {
    void update();
    options?.onReady?.();
    options?.onFinish?.();
    return null;
  }

  if (kind) {
    document.documentElement.dataset.vtKind = kind;
  }

  let handle: ViewTransitionHandle | null = null;
  try {
    handle = doc.startViewTransition({ update, types });
  } catch {
    try {
      handle = doc.startViewTransition(update);
    } catch {
      clearVtKindIfMatching(kind);
      void update();
      options?.onReady?.();
      options?.onFinish?.();
      return null;
    }
  }

  let readyNotified = false;
  const notifyReady = () => {
    if (readyNotified) return;
    readyNotified = true;
    options?.onReady?.();
  };

  let finishedNotified = false;
  const notifyFinish = () => {
    if (finishedNotified) return;
    finishedNotified = true;
    notifyReady();
    clearVtKindIfMatching(kind);
    options?.onFinish?.();
  };

  handle.ready?.then(notifyReady, notifyReady);
  handle.finished?.then(notifyFinish, notifyFinish);

  return handle;
}
