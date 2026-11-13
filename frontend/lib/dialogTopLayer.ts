"use client";

const pendingCloseCleanups = new WeakMap<HTMLDialogElement, () => void>();

/**
 * Checks whether the browser supports discrete top-layer exit transitions
 * (`transition-behavior: allow-discrete` and transitioning `overlay`).
 */
export function canTransitionTopLayer(): boolean {
  if (typeof window === "undefined" || typeof CSS === "undefined" || typeof CSS.supports !== "function") {
    return false;
  }
  return (
    CSS.supports("transition-behavior", "allow-discrete") &&
    CSS.supports("transition-property", "overlay")
  );
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
 * Closes a modal `<dialog>` cleanly, letting modern browsers animate `display`/`overlay`
 * natively and using a `data-closing` animation wait fallback on older engines.
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
    if (dialog.open) dialog.close();
    notifyAfterClose();
    return () => {};
  }

  let cancelled = false;
  let timeoutId: number | null = null;

  const cleanup = () => {
    cancelled = true;
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
      timeoutId = null;
    }
    delete dialog.dataset.closing;
  };

  pendingCloseCleanups.set(dialog, cleanup);

  const waitForExitAnimations = (shouldCloseAfter: boolean): () => void => {
    const animations =
      typeof dialog.getAnimations === "function"
        ? dialog.getAnimations({ subtree: false })
        : [];

    const finish = () => {
      if (cancelled) return;
      cleanup();
      pendingCloseCleanups.delete(dialog);
      if (shouldCloseAfter && dialog.open) {
        dialog.close();
      }
      notifyAfterClose();
    };

    if (animations.length === 0) {
      finish();
      return () => {};
    }

    timeoutId = window.setTimeout(finish, 320);
    Promise.allSettled(animations.map((a) => a.finished)).then(finish);
    return cleanup;
  };

  if (!dialog.open) {
    if (!canTransitionTopLayer()) {
      cleanup();
      pendingCloseCleanups.delete(dialog);
      notifyAfterClose();
      return () => {};
    }
    return waitForExitAnimations(false);
  }

  if (canTransitionTopLayer()) {
    dialog.close();
    return waitForExitAnimations(false);
  }

  // Fallback for browsers without discrete top-layer `display`/`overlay` transitions.
  dialog.dataset.closing = "true";
  return waitForExitAnimations(true);
}

function isOutsideDialogBox(dialog: HTMLDialogElement, clientX: number, clientY: number): boolean {
  const rect = dialog.getBoundingClientRect();
  return clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom;
}

/**
 * Fallback backdrop light-dismiss for engines without native `HTMLDialogElement.prototype.closedBy`.
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
  if ("closedBy" in HTMLDialogElement.prototype) {
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
