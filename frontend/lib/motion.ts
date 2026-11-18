/**
 * Unified motion tokens and pure choreography helpers aligned with the desktop
 * compact/focus benchmark (`--ease-desktop-panel` / `--ease-desktop-exit`).
 * Zero overshoot: immediate start with smooth exponential deceleration.
 */

export const DURATION_FAST = 0.15;
export const DURATION_BASE = 0.24;
export const DURATION_SLOW = 0.28;
export const DURATION_PANEL = 0.34;
export const DURATION_SHELL = 0.46;

export const EASE_SMOOTH = [0.22, 1, 0.36, 1] as const;
export const EASE_EXIT = [0.32, 0, 0.24, 1] as const;
export const EASE_OUT = [0.4, 0, 1, 1] as const;

export const transitionFast = {
  duration: DURATION_FAST,
  ease: EASE_SMOOTH,
};

export const transitionBase = {
  duration: DURATION_BASE,
  ease: EASE_SMOOTH,
};

export const transitionSlow = {
  duration: DURATION_SLOW,
  ease: EASE_SMOOTH,
};

export const transitionPanel = {
  duration: DURATION_PANEL,
  ease: EASE_SMOOTH,
};

/**
 * Clamp stagger index so bottom rows of long lists never lag behind.
 */
export function clampStaggerIndex(index: number, cap = 5): number {
  if (!Number.isFinite(index) || index <= 0) return 0;
  return Math.min(Math.floor(index), Math.max(0, cap));
}

/**
 * Resolve signed navigation direction (-1 backward, 1 forward, 0 unchanged)
 * across scalar indices or chronologically sortable ISO dates.
 */
export function resolveNetDirection(
  prevValue: number | string | null | undefined,
  nextValue: number | string | null | undefined
): -1 | 0 | 1 {
  if (prevValue == null || nextValue == null) return 0;
  if (typeof prevValue === "number" && typeof nextValue === "number") {
    if (nextValue > prevValue) return 1;
    if (nextValue < prevValue) return -1;
    return 0;
  }
  const prevStr = String(prevValue);
  const nextStr = String(nextValue);
  if (nextStr > prevStr) return 1;
  if (nextStr < prevStr) return -1;
  return 0;
}

/**
 * Compute starting horizontal pixel offset for incoming mobile day content so a
 * swipe release hands off smoothly into the new day without a visual jump.
 */
export function computeMobileSwipeEntryOffset(
  slideDir: -1 | 0 | 1,
  releasedOffsetPx = 0
): number {
  if (slideDir === 0) return 0;
  if (releasedOffsetPx !== 0) {
    const absRelease = Math.abs(releasedOffsetPx);
    const distance = Math.max(28, Math.min(72, 76 - absRelease * 0.42));
    return slideDir * Math.round(distance);
  }
  return slideDir * 22;
}

/**
 * Standard content crossfade / subtle directional enter without bounce.
 */
export const contentFadeVariants = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: { duration: DURATION_BASE, ease: EASE_SMOOTH } },
  exit: { opacity: 0, transition: { duration: DURATION_FAST, ease: EASE_EXIT } },
};
