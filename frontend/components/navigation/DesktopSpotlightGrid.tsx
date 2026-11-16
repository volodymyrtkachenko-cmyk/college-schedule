"use client";

import React, { useCallback, useEffect, useRef } from "react";

interface DesktopSpotlightGridProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

/**
 * Desktop-only GPU pointer spotlight & micro-tilt coordinator.
 * Propagates cached proximity coordinates (`--spot-x`, `--spot-y`) across sibling
 * `.interactive-surface` cards for Fluent border reveal and gently tilts `.desktop-tilt-card`
 * elements in a single rAF with zero mobile overhead.
 */
export function DesktopSpotlightGrid({
  children,
  className = "",
  onPointerMove,
  onPointerLeave,
  ...rest
}: DesktopSpotlightGridProps) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const rectCacheRef = useRef<WeakMap<HTMLElement, DOMRect>>(new WeakMap());
  const lastCoordsRef = useRef<WeakMap<HTMLElement, { x: number; y: number }>>(new WeakMap());
  const activeTiltElRef = useRef<HTMLElement | null>(null);
  const pendingRef = useRef<{
    target: Element;
    clientX: number;
    clientY: number;
  } | null>(null);
  const canHoverRef = useRef<boolean>(false);

  const clearTilt = useCallback((el: HTMLElement | null) => {
    if (!el) return;
    el.style.removeProperty("--tilt-x");
    el.style.removeProperty("--tilt-y");
  }, []);

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
      clearTilt(activeTiltElRef.current);
    };
  }, [clearTilt]);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      onPointerMove?.(e);
      if (!canHoverRef.current || e.pointerType !== "mouse") return;
      const target = e.target;
      if (!(target instanceof Element)) return;

      const grid = gridRef.current;
      if (grid && grid.dataset.spotActive !== "true") {
        grid.dataset.spotActive = "true";
      }

      pendingRef.current = {
        target,
        clientX: e.clientX,
        clientY: e.clientY,
      };

      if (rafRef.current !== null) return;
      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = null;
        const job = pendingRef.current;
        pendingRef.current = null;
        const container = gridRef.current;
        if (!job || !container) return;

        const surfaces = container.querySelectorAll<HTMLElement>(".interactive-surface");
        surfaces.forEach((surface) => {
          let rect = rectCacheRef.current.get(surface);
          if (!rect) {
            rect = surface.getBoundingClientRect();
            rectCacheRef.current.set(surface, rect);
          }
          // Skip surfaces far outside the pointer proximity radius (260px) to avoid dead writes
          if (
            job.clientX < rect.left - 260 ||
            job.clientX > rect.right + 260 ||
            job.clientY < rect.top - 260 ||
            job.clientY > rect.bottom + 260
          ) {
            return;
          }
          const relX = Math.round(job.clientX - rect.left);
          const relY = Math.round(job.clientY - rect.top);
          const prev = lastCoordsRef.current.get(surface);
          if (prev) {
            const dx = relX - prev.x;
            const dy = relY - prev.y;
            if (dx * dx + dy * dy < 9) return;
          }
          lastCoordsRef.current.set(surface, { x: relX, y: relY });
          surface.style.setProperty("--spot-x", `${relX}px`);
          surface.style.setProperty("--spot-y", `${relY}px`);
        });

        const hoveredTilt = job.target.closest(".desktop-tilt-card");
        const nextTiltEl = hoveredTilt instanceof HTMLElement ? hoveredTilt : null;
        if (activeTiltElRef.current && activeTiltElRef.current !== nextTiltEl) {
          clearTilt(activeTiltElRef.current);
          activeTiltElRef.current = null;
        }
        if (nextTiltEl && nextTiltEl.dataset.open !== "true") {
          let rect = rectCacheRef.current.get(nextTiltEl);
          if (!rect) {
            rect = nextTiltEl.getBoundingClientRect();
            rectCacheRef.current.set(nextTiltEl, rect);
          }
          if (rect.width > 0 && rect.height > 0) {
            const nx = Math.max(-1, Math.min(1, ((job.clientX - rect.left) / rect.width) * 2 - 1));
            const ny = Math.max(-1, Math.min(1, ((job.clientY - rect.top) / rect.height) * 2 - 1));
            const tiltX = (-ny * 1.45).toFixed(2);
            const tiltY = (nx * 1.45).toFixed(2);
            nextTiltEl.style.setProperty("--tilt-x", `${tiltX}deg`);
            nextTiltEl.style.setProperty("--tilt-y", `${tiltY}deg`);
            activeTiltElRef.current = nextTiltEl;
          }
        }
      });
    },
    [onPointerMove, clearTilt],
  );

  const handlePointerLeave = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      onPointerLeave?.(e);
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      pendingRef.current = null;
      const grid = gridRef.current;
      if (grid) {
        delete grid.dataset.spotActive;
      }
      clearTilt(activeTiltElRef.current);
      activeTiltElRef.current = null;
    },
    [onPointerLeave, clearTilt],
  );

  return (
    <div
      ref={gridRef}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      className={`desktop-spotlight-active ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
