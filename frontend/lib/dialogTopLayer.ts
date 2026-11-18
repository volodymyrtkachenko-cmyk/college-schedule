"use client";

const pendingCloseCleanups = new WeakMap<HTMLDialogElement, () => void>();
let cachedDisplayTransitionSupport: boolean | undefined;

/**
 * Probes whether the browser actually delays `display: none` during discrete transitions.
 * Protects against Firefox 129+ where `CSS.supports("transition-behavior", "allow-discrete")`
 * returns true without actually transitioning `display`.
 */
export function canTransitionDisplay(): boolean {
  if (cachedDisplayTransitionSupport !== undefined) {
    return cachedDisplayTransitionSupport;
  }
  if (
    typeof window === "undefined" ||
    typeof document === "undefined" ||
    !document.body ||
    !window.CSS?.supports?.("transition-behavior", "allow-discrete")
  ) {
    return false;
  }

  const probe = document.createElement("div");
  probe.style.cssText =
    "transition: display 1s allow-discrete !important; display: block;";
  document.body.appendChild(probe);
  window.getComputedStyle(probe).display;
  probe.style.display = "none";
  cachedDisplayTransitionSupport =
    window.getComputedStyle(probe).display === "block";
  probe.remove();
  return cachedDisplayTransitionSupport;
}

/**
 * Checks whether the browser supports discrete top-layer exit transitions
 * (transitionable `display` + `overlay: auto`).
 */
export function canTransitionTopLayer(): boolean {
  if (typeof window === "undefined" || !window.CSS?.supports) {
    return false;
  }
  return window.CSS.supports("overlay", "auto") && canTransitionDisplay();
}

/** Checks if the user prefers reduced motion. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Cancels any in-flight fallback closing sequence for a dialog element. */
export function cancelPendingTopLayerClose(dialog: HTMLDialogElement): void {
  const cancel = pendingCloseCleanups.get(dialog);
  if (cancel) {
    cancel();
    pendingCloseCleanups.delete(dialog);
  }
  delete dialog.dataset.closing;
}

/** Opens a dialog in the browser top layer via `showModal()`. */
export function openTopLayer(dialog: HTMLDialogElement): void {
  cancelPendingTopLayerClose(dialog);
  if (!dialog.isConnected || dialog.open) return;
  try {
    dialog.showModal();
  } catch {
    // Ignore invalid-state races if the node disconnected before effect commit.
  }
}

/**
 * Closes a modal `<dialog>` cleanly using a controlled `data-closing="true"` transition
 * while keeping `[open]` in the top layer so dialog and `::backdrop` exit in sync.
 */
export function closeTopLayer(
  dialog: HTMLDialogElement,
  onAfterClose?: () => void
): () => void {
  cancelPendingTopLayerClose(dialog);

  const notifyAfterClose = () => {
    if (onAfterClose && !dialog.open) {
      onAfterClose();
    }
  };

  if (prefersReducedMotion()) {
    const prevScroll =
      typeof window !== "undefined" ? { x: window.scrollX, y: window.scrollY } : null;
    if (dialog.open) dialog.close();
    if (
      prevScroll &&
      typeof window !== "undefined" &&
      (window.scrollX !== prevScroll.x || window.scrollY !== prevScroll.y)
    ) {
      window.scrollTo(prevScroll.x, prevScroll.y);
    }
    notifyAfterClose();
    return () => {};
  }

  let cancelled = false;
  let timeoutId: number | null = null;

  const cleanup = () => {
    cancelled = true;
    if (timeoutId !== null && typeof window !== "undefined") {
      window.clearTimeout(timeoutId);
      timeoutId = null;
    }
    delete dialog.dataset.closing;
  };

  pendingCloseCleanups.set(dialog, cleanup);

  const waitForExitAnimations = (shouldCloseAfter: boolean): () => void => {
    if (typeof window !== "undefined" && typeof window.getComputedStyle === "function") {
      void window.getComputedStyle(dialog).opacity;
    }

    const animations =
      typeof dialog.getAnimations === "function"
        ? dialog.getAnimations({ subtree: true })
        : [];

    const finish = () => {
      if (cancelled) return;
      cleanup();
      pendingCloseCleanups.delete(dialog);
      if (shouldCloseAfter && dialog.open) {
        const prevScroll =
          typeof window !== "undefined" ? { x: window.scrollX, y: window.scrollY } : null;
        dialog.close();
        if (
          prevScroll &&
          typeof window !== "undefined" &&
          (window.scrollX !== prevScroll.x || window.scrollY !== prevScroll.y)
        ) {
          window.scrollTo(prevScroll.x, prevScroll.y);
        }
      }
      notifyAfterClose();
    };

    if (animations.length === 0) {
      finish();
      return () => {};
    }

    if (typeof window !== "undefined") {
      timeoutId = window.setTimeout(finish, 240);
    }
    Promise.allSettled(animations.map((a) => a.finished)).then(finish);
    return cleanup;
  };

  if (!dialog.open) {
    cleanup();
    pendingCloseCleanups.delete(dialog);
    notifyAfterClose();
    return () => {};
  }

  // Keep `dialog.open === true` with `data-closing="true"` so both surface & `::backdrop`
  // glide out together uniformly across Chrome, Safari, and Firefox.
  dialog.dataset.closing = "true";
  return waitForExitAnimations(true);
}

function isOutsideDialogBox(dialog: HTMLDialogElement, clientX: number, clientY: number): boolean {
  const rect = dialog.getBoundingClientRect();
  return clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom;
}

/**
 * Controlled backdrop light-dismiss for modal `<dialog>` elements so outside clicks
 * always go through `onRequestClose()` and play the `data-closing` exit transition.
 * Checks both `pointerdown` and `pointerup` outside the dialog box so text-drag selection never closes it.
 */
export function setupClosedByFallback(
  dialog: HTMLDialogElement,
  enabled: boolean,
  onRequestClose: () => void
): () => void {
  if (!enabled || typeof HTMLDialogElement === "undefined") {
    return () => {};
  }

  let downOnBackdrop = false;

  const onPointerDown = (e: PointerEvent) => {
    if (e.target !== dialog || (e.pointerType === "mouse" && e.button !== 0)) {
      downOnBackdrop = false;
      return;
    }
    downOnBackdrop = isOutsideDialogBox(dialog, e.clientX, e.clientY);
  };

  const onPointerUp = (e: PointerEvent) => {
    const startedOutside = downOnBackdrop;
    downOnBackdrop = false;
    if (!startedOutside || e.target !== dialog) return;
    if (isOutsideDialogBox(dialog, e.clientX, e.clientY)) {
      onRequestClose();
    }
  };

  const onPointerCancel = () => {
    downOnBackdrop = false;
  };

  dialog.addEventListener("pointerdown", onPointerDown);
  dialog.addEventListener("pointerup", onPointerUp);
  dialog.addEventListener("pointercancel", onPointerCancel);

  return () => {
    dialog.removeEventListener("pointerdown", onPointerDown);
    dialog.removeEventListener("pointerup", onPointerUp);
    dialog.removeEventListener("pointercancel", onPointerCancel);
  };
}
