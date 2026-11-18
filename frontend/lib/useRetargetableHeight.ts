"use client";

import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";
import { prefersReducedMotion } from "./dialogTopLayer";
import { EASE_EXIT, EASE_SMOOTH } from "./motion";

const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

const PANEL_EASING = `cubic-bezier(${EASE_SMOOTH.join(", ")})`;
const EXIT_EASING = `cubic-bezier(${EASE_EXIT.join(", ")})`;

/**
 * Smoothly interpolates container height across content transitions (tab switches,
 * filter changes) using WAAPI with mid-flight retargeting and instant updates
 * when `prefers-reduced-motion: reduce` is enabled.
 */
export function useRetargetableHeight<T extends HTMLElement = HTMLDivElement>(
  containerRef: RefObject<T | null>,
  activeKey: string | number
): void {
  const prevKeyRef = useRef<string | number>(activeKey);
  const lastSettledHeightRef = useRef<number | null>(null);
  const animRef = useRef<Animation | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (!containerRef.current || animRef.current) return;
      const h = containerRef.current.getBoundingClientRect().height;
      if (h > 0) {
        lastSettledHeightRef.current = h;
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef]);

  useIsomorphicLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    if (prevKeyRef.current === activeKey) {
      if (!animRef.current) {
        const currentH = el.getBoundingClientRect().height;
        if (currentH > 0) {
          lastSettledHeightRef.current = currentH;
        }
      }
      return;
    }

    prevKeyRef.current = activeKey;

    const fromH = animRef.current
      ? el.getBoundingClientRect().height
      : lastSettledHeightRef.current ?? el.getBoundingClientRect().height;

    animRef.current?.cancel();
    animRef.current = null;

    el.style.height = "";
    el.style.overflow = "";
    const toH = Math.ceil(el.offsetHeight);

    lastSettledHeightRef.current = toH;

    if (
      prefersReducedMotion() ||
      typeof el.animate !== "function" ||
      fromH <= 0 ||
      toH <= 0 ||
      Math.abs(fromH - toH) < 2
    ) {
      return;
    }

    const expanding = toH > fromH;
    el.style.height = `${toH}px`;
    el.style.overflow = "clip";
    const anim = el.animate(
      [{ height: `${fromH}px` }, { height: `${toH}px` }],
      {
        duration: expanding ? 260 : 210,
        easing: expanding ? PANEL_EASING : EXIT_EASING,
      }
    );
    animRef.current = anim;
    anim.onfinish = () => {
      if (animRef.current !== anim) return;
      animRef.current = null;
      el.style.height = "";
      el.style.overflow = "";
      lastSettledHeightRef.current = el.getBoundingClientRect().height;
    };
    anim.oncancel = () => {
      if (animRef.current === anim) {
        animRef.current = null;
      }
    };
  }, [activeKey, containerRef]);

  useEffect(() => {
    return () => {
      animRef.current?.cancel();
      animRef.current = null;
    };
  }, []);
}
