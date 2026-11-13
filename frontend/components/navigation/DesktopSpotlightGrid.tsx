"use client";

import React, { useCallback, useEffect, useRef } from "react";

interface DesktopSpotlightGridProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

/**
 * Desktop-only GPU pointer spotlight coordinator.
 * Caches surface DOMRects to avoid layout thrashing on pointermove, throttles
 * sub-4px pointer jitter, and updates `--spot-x` / `--spot-y` in one rAF.
 */
export function DesktopSpotlightGrid({
  children,
  className = "",
  onPointerMove,
  ...rest
}: DesktopSpotlightGridProps) {
  const rafRef = useRef<number | null>(null);
  const rectCacheRef = useRef<WeakMap<HTMLElement, DOMRect>>(new WeakMap());
  const lastCoordsRef = useRef<WeakMap<HTMLElement, { x: number; y: number }>>(new WeakMap());
  const pendingRef = useRef<{
    el: HTMLElement;
    clientX: number;
    clientY: number;
  } | null>(null);
  const canHoverRef = useRef<boolean>(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia(
      "(min-width: 1024px) and (hover: hover) and (pointer: fine)",
    );
    const invalidateCache = () => {
      rectCacheRef.current = new WeakMap();
    };
    const update = () => {
      canHoverRef.current = mq.matches;
      invalidateCache();
    };
    update();
    mq.addEventListener?.("change", update);
    window.addEventListener("scroll", invalidateCache, { passive: true });
    window.addEventListener("resize", invalidateCache, { passive: true });
    return () => {
      mq.removeEventListener?.("change", update);
      window.removeEventListener("scroll", invalidateCache);
      window.removeEventListener("resize", invalidateCache);
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      onPointerMove?.(e);
      if (!canHoverRef.current || e.pointerType !== "mouse") return;
      const target = e.target;
      if (!(target instanceof Element)) return;
      const surface = target.closest(".interactive-surface");
      if (!(surface instanceof HTMLElement)) return;

      pendingRef.current = {
        el: surface,
        clientX: e.clientX,
        clientY: e.clientY,
      };

      if (rafRef.current !== null) return;
      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = null;
        const job = pendingRef.current;
        pendingRef.current = null;
        if (!job) return;

        let rect = rectCacheRef.current.get(job.el);
        if (!rect) {
          rect = job.el.getBoundingClientRect();
          rectCacheRef.current.set(job.el, rect);
        }

        const relX = Math.round(job.clientX - rect.left);
        const relY = Math.round(job.clientY - rect.top);
        const prev = lastCoordsRef.current.get(job.el);
        if (prev) {
          const dx = relX - prev.x;
          const dy = relY - prev.y;
          if (dx * dx + dy * dy < 16) return;
        }
        lastCoordsRef.current.set(job.el, { x: relX, y: relY });
        job.el.style.setProperty("--spot-x", `${relX}px`);
        job.el.style.setProperty("--spot-y", `${relY}px`);
      });
    },
    [onPointerMove],
  );

  return (
    <div onPointerMove={handlePointerMove} className={className} {...rest}>
      {children}
    </div>
  );
}
