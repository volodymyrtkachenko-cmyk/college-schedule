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
  /** Runs synchronously if a newer transition supersedes this one before it settles. */
  onAbort?: () => void;
  /** Safety ceiling (ms) after `ready` in case `finished` stalls; aborts transition atomically. */
  failsafeMs?: number;
}

type DocumentWithVT = Document & {
  startViewTransition?: (
    arg:
      | (() => void | Promise<void>)
      | { update: () => void | Promise<void>; types?: string[] },
  ) => ViewTransitionHandle;
};

interface InterruptedGesture {
  id: number;
  x: number;
  y: number;
  time: number;
  pointerType: string;
  handled: boolean;
  cleanupTimer: ReturnType<typeof setTimeout> | null;
}

const INTERACTIVE_TARGET_SELECTOR =
  'button:not(:disabled), a[href], summary, [role="button"], [role="tab"], [role="menuitem"], [role="option"], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), label';

let activeTransitionSeq = 0;
let activeHandle: ViewTransitionHandle | null = null;
let activeKind: string | undefined;
let activeAbortCleanup: (() => void) | null = null;
let activeFailsafeTimer: ReturnType<typeof setTimeout> | null = null;
let vtListenersAttached = false;
let gestureListenersAttached = false;
let gestureSeq = 0;
let activeInterruptedGesture: InterruptedGesture | null = null;
let lastInterruptedOrigin: { x: number; y: number; time: number } | null = null;

function clearActiveFailsafe() {
  if (activeFailsafeTimer !== null) {
    clearTimeout(activeFailsafeTimer);
    activeFailsafeTimer = null;
  }
}

function armActiveFailsafe(seq: number, ms?: number) {
  clearActiveFailsafe();
  if (!ms || ms <= 0) return;
  activeFailsafeTimer = setTimeout(() => {
    activeFailsafeTimer = null;
    if (seq !== activeTransitionSeq || !activeHandle) return;
    abortActiveViewTransition();
  }, ms);
}

function nowMs(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function findInteractiveTarget(x: number, y: number): HTMLElement | null {
  if (typeof document === "undefined" || typeof document.elementFromPoint !== "function") {
    return null;
  }
  const hit = document.elementFromPoint(x, y);
  if (!hit || typeof (hit as Element).closest !== "function") return null;
  const candidate = (hit as Element).closest(INTERACTIVE_TARGET_SELECTOR);
  if (!candidate || typeof (candidate as HTMLElement).click !== "function") return null;
  if (candidate.getAttribute("aria-disabled") === "true") return null;
  return candidate as HTMLElement;
}

function dispatchInteractiveClick(interactive: HTMLElement, x: number, y: number) {
  lastInterruptedOrigin = { x, y, time: nowMs() };
  if (
    interactive.tagName === "INPUT" ||
    interactive.tagName === "SELECT" ||
    interactive.tagName === "TEXTAREA"
  ) {
    try {
      interactive.focus({ preventScroll: true });
    } catch {}
  }
  interactive.click();
}

function clearInterruptedGesture() {
  if (activeInterruptedGesture?.cleanupTimer) {
    clearTimeout(activeInterruptedGesture.cleanupTimer);
  }
  activeInterruptedGesture = null;
  detachGestureListeners();
}

function onGestureClick(e: MouseEvent) {
  if (e.isTrusted === false) return;
  const g = activeInterruptedGesture;
  if (!g || g.handled) return;

  const target = e.target as Element | null;
  if (
    target &&
    typeof document !== "undefined" &&
    target !== document.documentElement &&
    target !== document.body &&
    document.body?.contains(target)
  ) {
    g.handled = true;
    clearInterruptedGesture();
    return;
  }

  const cx = e.clientX || g.x;
  const cy = e.clientY || g.y;
  const moved = Math.hypot(cx - g.x, cy - g.y);
  g.handled = true;
  clearInterruptedGesture();

  if (moved > 16) return;

  const interactive = findInteractiveTarget(cx, cy);
  if (!interactive) return;

  e.stopImmediatePropagation();
  e.preventDefault();
  dispatchInteractiveClick(interactive, cx, cy);
}

function onGesturePointerUp(e: PointerEvent) {
  if (e.isTrusted === false) return;
  const g = activeInterruptedGesture;
  if (!g || g.handled) return;

  const upX = e.clientX || g.x;
  const upY = e.clientY || g.y;
  if (Math.hypot(upX - g.x, upY - g.y) > 16) {
    g.handled = true;
    clearInterruptedGesture();
    return;
  }

  const completeIfMissingClick = () => {
    if (activeInterruptedGesture?.id !== g.id || g.handled) return;
    g.handled = true;
    clearInterruptedGesture();
    const interactive = findInteractiveTarget(upX, upY);
    if (interactive) {
      dispatchInteractiveClick(interactive, upX, upY);
    }
  };

  if (g.pointerType === "touch" || g.pointerType === "pen") {
    setTimeout(completeIfMissingClick, 50);
  } else if (typeof queueMicrotask === "function") {
    queueMicrotask(completeIfMissingClick);
  } else {
    setTimeout(completeIfMissingClick, 0);
  }
}

function onGestureCancel() {
  clearInterruptedGesture();
}

function attachGestureListeners() {
  if (
    gestureListenersAttached ||
    typeof window === "undefined" ||
    typeof window.addEventListener !== "function"
  ) {
    return;
  }
  gestureListenersAttached = true;
  window.addEventListener("pointerup", onGesturePointerUp, true);
  window.addEventListener("click", onGestureClick, true);
  window.addEventListener("pointercancel", onGestureCancel, true);
}

function detachGestureListeners() {
  if (
    !gestureListenersAttached ||
    typeof window === "undefined" ||
    typeof window.removeEventListener !== "function"
  ) {
    return;
  }
  gestureListenersAttached = false;
  window.removeEventListener("pointerup", onGesturePointerUp, true);
  window.removeEventListener("click", onGestureClick, true);
  window.removeEventListener("pointercancel", onGestureCancel, true);
}

function onActivePointerDown(e: PointerEvent) {
  if (!activeHandle) return;
  if (e.isTrusted === false) return;
  if (e.pointerType === "mouse" && e.button !== 0) return;

  const downX = e.clientX;
  const downY = e.clientY;
  const pointerType = e.pointerType || "mouse";

  abortActiveViewTransition();

  const time = nowMs();
  lastInterruptedOrigin = { x: downX, y: downY, time };

  clearInterruptedGesture();
  const gesture: InterruptedGesture = {
    id: ++gestureSeq,
    x: downX,
    y: downY,
    time,
    pointerType,
    handled: false,
    cleanupTimer: setTimeout(() => {
      if (activeInterruptedGesture?.id === gesture.id) {
        clearInterruptedGesture();
      }
    }, 1500),
  };
  activeInterruptedGesture = gesture;
  attachGestureListeners();
}

function onActiveKeyDown(e: KeyboardEvent) {
  if (!activeHandle) return;
  if (e.key === "Escape" || e.key === "Enter" || e.key === " ") {
    abortActiveViewTransition();
  }
}

function attachVtInterruptListeners() {
  if (
    vtListenersAttached ||
    typeof window === "undefined" ||
    typeof window.addEventListener !== "function"
  ) {
    return;
  }
  vtListenersAttached = true;
  window.addEventListener("pointerdown", onActivePointerDown, true);
  window.addEventListener("keydown", onActiveKeyDown, true);
}

function detachVtInterruptListeners() {
  if (
    !vtListenersAttached ||
    typeof window === "undefined" ||
    typeof window.removeEventListener !== "function"
  ) {
    return;
  }
  vtListenersAttached = false;
  window.removeEventListener("pointerdown", onActivePointerDown, true);
  window.removeEventListener("keydown", onActiveKeyDown, true);
}

/**
 * Returns and clears recent pointer coordinates saved when interrupting an active
 * View Transition so synthetic `.click()` replays preserve origin coordinates.
 */
export function consumeInterruptedPointerOrigin(
  maxAgeMs = 250,
): { x: number; y: number } | null {
  const rec = lastInterruptedOrigin;
  lastInterruptedOrigin = null;
  if (!rec) return null;
  if (nowMs() - rec.time > maxAgeMs) return null;
  return { x: rec.x, y: rec.y };
}

function clearVtKindIfCurrent(seq: number, kind?: string) {
  if (!kind || typeof document === "undefined" || seq !== activeTransitionSeq) return;
  if (document.documentElement.dataset.vtKind === kind) {
    delete document.documentElement.dataset.vtKind;
  }
}

/**
 * Synchronously supersedes any in-flight same-document View Transition and runs
 * its registered abort cleanup so a newer transition starts from clean root attrs.
 */
export function abortActiveViewTransition(): void {
  const prevHandle = activeHandle;
  const prevKind = activeKind;
  const prevAbortCleanup = activeAbortCleanup;

  activeTransitionSeq += 1;
  activeHandle = null;
  activeKind = undefined;
  activeAbortCleanup = null;
  clearActiveFailsafe();
  detachVtInterruptListeners();

  if (prevKind && typeof document !== "undefined") {
    if (document.documentElement.dataset.vtKind === prevKind) {
      delete document.documentElement.dataset.vtKind;
    }
  }

  if (prevHandle) {
    try {
      prevHandle.skipTransition?.();
    } catch {
      // Ignore if already skipped or finished.
    }
  }

  prevAbortCleanup?.();
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
  abortActiveViewTransition();

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

  const seq = ++activeTransitionSeq;

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
      clearVtKindIfCurrent(seq, kind);
      void update();
      options?.onReady?.();
      options?.onFinish?.();
      return null;
    }
  }

  activeHandle = handle;
  activeKind = kind;
  activeAbortCleanup = options?.onAbort ?? options?.onFinish ?? null;
  attachVtInterruptListeners();
  if (options?.failsafeMs && options.failsafeMs > 0) {
    armActiveFailsafe(seq, Math.max(options.failsafeMs + 450, 1400));
  }

  let readyNotified = false;
  const notifyReady = () => {
    if (readyNotified || seq !== activeTransitionSeq) return;
    readyNotified = true;
    if (options?.failsafeMs && options.failsafeMs > 0) {
      armActiveFailsafe(seq, options.failsafeMs);
    }
    options?.onReady?.();
  };

  let finishedNotified = false;
  const notifyFinish = () => {
    if (finishedNotified || seq !== activeTransitionSeq) return;
    finishedNotified = true;
    notifyReady();
    if (activeHandle === handle) {
      activeHandle = null;
      activeKind = undefined;
      activeAbortCleanup = null;
      clearActiveFailsafe();
      detachVtInterruptListeners();
    }
    clearVtKindIfCurrent(seq, kind);
    options?.onFinish?.();
  };

  handle.ready?.then(notifyReady, notifyReady);
  handle.finished?.then(notifyFinish, notifyFinish);

  return handle;
}
