"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

export interface UseHairlineIndicatorOptions {
  /** Additional selector matching the active button/tab inside containerRef. */
  selector?: string;
  /** Horizontal inset in pixels from active element edges (total width reduction = insetPx * 2). */
  insetPx?: number;
  /** Pin underline to container's bottom edge instead of the active element's bottom edge. */
  alignToContainerBottom?: boolean;
  /** Trigger re-measurement whenever this active key changes. */
  activeKey: string | number | null | undefined;
  /** Extra dependencies (e.g. open modal state, dynamic tab list). */
  enabled?: boolean;
}

export function useHairlineIndicator<T extends HTMLElement = HTMLDivElement>({
  selector = '[aria-selected="true"], [aria-pressed="true"], [data-hairline-active="true"]',
  insetPx = 8,
  alignToContainerBottom = false,
  activeKey,
  enabled = true,
}: UseHairlineIndicatorOptions) {
  const containerRef = useRef<T | null>(null);
  const [metrics, setMetrics] = useState<{
    x: number;
    y: number;
    width: number;
    ready: boolean;
  }>({ x: 0, y: 0, width: 0, ready: false });

  const measure = useCallback(
    (allowTransition: boolean) => {
      const container = containerRef.current;
      if (!container) return;
      const activeEl = container.querySelector<HTMLElement>(selector);
      if (!activeEl) {
        setMetrics((prev) => (prev.width === 0 ? prev : { x: 0, y: 0, width: 0, ready: false }));
        return;
      }

      const elWidth = activeEl.offsetWidth;
      const elHeight = activeEl.offsetHeight;
      if (elWidth <= 0 || elHeight <= 0) return;

      const safeInset = Math.min(insetPx, Math.max(0, Math.floor((elWidth - 12) / 2)));
      const nextWidth = Math.max(12, elWidth - safeInset * 2);
      const nextX = activeEl.offsetLeft + safeInset;
      const nextY = alignToContainerBottom
        ? Math.max(0, container.clientHeight - 2)
        : Math.max(0, activeEl.offsetTop + elHeight - 2);

      setMetrics((prev) => ({
        x: nextX,
        y: nextY,
        width: nextWidth,
        ready: allowTransition ? prev.ready || prev.width > 0 : false,
      }));
    },
    [selector, insetPx, alignToContainerBottom]
  );

  useEffect(() => {
    if (!enabled) {
      setMetrics((prev) => (prev.ready ? { ...prev, ready: false } : prev));
    }
  }, [enabled]);

  useIsomorphicLayoutEffect(() => {
    if (!enabled) return;
    measure(true);
    // Re-enable smooth glide on the next frame if this was initial mount.
    let rafId: number | null = null;
    if (typeof window !== "undefined") {
      rafId = window.requestAnimationFrame(() => {
        setMetrics((prev) => (prev.width > 0 && !prev.ready ? { ...prev, ready: true } : prev));
      });
    }
    return () => {
      if (rafId !== null && typeof window !== "undefined") {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, [enabled, activeKey, measure]);

  useEffect(() => {
    if (!enabled) return;
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      measure(false);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [enabled, measure]);

  const indicatorStyle: CSSProperties = {
    "--bar-x": `${metrics.x}px`,
    "--bar-y": `${metrics.y}px`,
    "--bar-w": `${metrics.width}px`,
  } as CSSProperties;

  return {
    containerRef,
    hasTarget: metrics.width > 0,
    isReady: metrics.ready,
    indicatorStyle,
  };
}
