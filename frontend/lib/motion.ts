/**
 * Unified motion tokens for Framer Motion & transitions.
 * B1: Fast 120ms (hover/tap), Base 200ms (content switch), Slow 280ms (modals/theme).
 * Curves: EaseInOut [0.2, 0, 0, 1], EaseOut [0.4, 0, 1, 1].
 */

export const DURATION_FAST = 0.12;
export const DURATION_BASE = 0.20;
export const DURATION_SLOW = 0.28;

export const EASE_SMOOTH = [0.2, 0, 0, 1] as const;
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

/**
 * Standard content crossfade / pop animation variant
 * B5: Fast exit (≤ 120ms opacity only), smooth enter (180-200ms)
 */
export const contentFadeVariants = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0, transition: { duration: DURATION_BASE, ease: EASE_SMOOTH } },
  exit: { opacity: 0, transition: { duration: DURATION_FAST, ease: EASE_OUT } },
};
