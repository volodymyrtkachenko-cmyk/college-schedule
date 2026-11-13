"use client";

import React, { useCallback, useEffect, useRef } from "react";

interface DesktopSpotlightGridProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

/**
 * Desktop-only GPU pointer spotlight coordinator.
 * Coalesces pointer coordinates in a single requestAnimationFrame and updates
 * `--spot-x` / `--spot-y` on hovered `.interactive-surface` children without React re-renders.
 * Zero event cost on touch / coarse-pointer devices.
 */
export function DesktopSpotlightGrid({
  children,
  className = "",
  onPointerMove,
  ...rest
}: DesktopSpotlightGridProps) {
  const rafRef = useRef<number | null>(null);
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
    const update = () => {
      canHoverRef.current = mq.matches;
    };
    update();
    mq.addEventListener?.("change", update);
    return () => {
      mq.removeEventListener?.("change", update);
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
        const rect = job.el.getBoundingClientRect();
        job.el.style.setProperty("--spot-x", `${Math.round(job.clientX - rect.left)}px`);
        job.el.style.setProperty("--spot-y", `${Math.round(job.clientY - rect.top)}px`);
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
