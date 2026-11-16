"use client";

import React, { useEffect, useRef, useState } from "react";
import { BackdropScene } from "@/components/BackdropScene";
import { useTheme } from "@/lib/useTheme";
import { loadCustomWallpaperBlob, readWallpaperMeta } from "@/lib/wallpaperStorage";

export function AppBackdrop() {
  const { visualConfig, resolvedTheme, wallpaperVersion } = useTheme();
  const { backdrop, surface } = visualConfig;

  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [tinyFallback, setTinyFallback] = useState<string | null>(null);
  const [dominantHex, setDominantHex] = useState<string | null>(null);
  const [photoReady, setPhotoReady] = useState(false);
  const [hasMissingCustomPhoto, setHasMissingCustomPhoto] = useState(false);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const activeObjectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || backdrop === "none" || backdrop === "custom") {
      rootRef.current?.style.removeProperty("--bg-px");
      rootRef.current?.style.removeProperty("--bg-py");
      return;
    }

    const mqDesktop = window.matchMedia(
      "(min-width: 1024px) and (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)",
    );
    if (!mqDesktop.matches) return;

    let rafId: number | null = null;
    let lastNx = 0;
    let lastNy = 0;

    const flushCoords = () => {
      rafId = null;
      const node = rootRef.current;
      if (!node) return;
      node.style.setProperty("--bg-px", lastNx.toFixed(3));
      node.style.setProperty("--bg-py", lastNy.toFixed(3));
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || window.innerWidth <= 0 || window.innerHeight <= 0) return;
      lastNx = Math.max(-1, Math.min(1, (e.clientX / window.innerWidth) * 2 - 1));
      lastNy = Math.max(-1, Math.min(1, (e.clientY / window.innerHeight) * 2 - 1));
      if (rafId === null) {
        rafId = window.requestAnimationFrame(flushCoords);
      }
    };

    const handlePointerLeave = () => {
      lastNx = 0;
      lastNy = 0;
      if (rafId === null) {
        rafId = window.requestAnimationFrame(flushCoords);
      }
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    document.addEventListener("mouseleave", handlePointerLeave, { passive: true });
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("mouseleave", handlePointerLeave);
      if (rafId !== null) window.cancelAnimationFrame(rafId);
    };
  }, [backdrop]);

  useEffect(() => {
    let cancelled = false;

    if (backdrop !== "custom") {
      setPhotoReady(false);
      setHasMissingCustomPhoto(false);
      if (activeObjectUrlRef.current) {
        URL.revokeObjectURL(activeObjectUrlRef.current);
        activeObjectUrlRef.current = null;
      }
      setBlobUrl(null);
      return;
    }

    const meta = readWallpaperMeta();
    if (meta) {
      setTinyFallback(meta.tinyPlaceholder);
      setDominantHex(meta.dominantHex);
    }

    loadCustomWallpaperBlob()
      .then((record) => {
        if (cancelled) return;
        if (!record || !record.blob) {
          setHasMissingCustomPhoto(true);
          setBlobUrl(null);
          setPhotoReady(false);
          return;
        }
        setHasMissingCustomPhoto(false);
        const nextUrl = URL.createObjectURL(record.blob);
        if (activeObjectUrlRef.current && activeObjectUrlRef.current !== nextUrl) {
          URL.revokeObjectURL(activeObjectUrlRef.current);
        }
        activeObjectUrlRef.current = nextUrl;
        setTinyFallback(record.tinyPlaceholder || meta?.tinyPlaceholder || null);
        setDominantHex(record.dominantHex || meta?.dominantHex || null);
        setBlobUrl(nextUrl);
      })
      .catch(() => {
        if (!cancelled) {
          setHasMissingCustomPhoto(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [backdrop, wallpaperVersion]);

  useEffect(() => {
    return () => {
      if (activeObjectUrlRef.current) {
        URL.revokeObjectURL(activeObjectUrlRef.current);
        activeObjectUrlRef.current = null;
      }
    };
  }, []);

  const effectiveBackdrop =
    backdrop === "custom" && hasMissingCustomPhoto ? "aurora" : backdrop;
  const topDimAlpha = Math.max(0.1, Math.min(0.85, visualConfig.wallpaperDim / 100));
  const bottomDimAlpha = Math.min(
    resolvedTheme === "dark" ? 0.92 : 0.94,
    Number((topDimAlpha + 0.16).toFixed(2))
  );

  return (
    <div
      ref={rootRef}
      aria-hidden="true"
      data-parallax={effectiveBackdrop !== "none" && effectiveBackdrop !== "custom" ? "1" : undefined}
      className="app-backdrop fixed inset-0 z-0 overflow-hidden pointer-events-none select-none"
    >
      {effectiveBackdrop !== "custom" && (
        <BackdropScene backdrop={effectiveBackdrop} surface={surface} />
      )}

      {/* Custom Photo Wallpaper */}
      {effectiveBackdrop === "custom" && (
        <div
          className="absolute inset-0"
          style={dominantHex ? { backgroundColor: dominantHex } : undefined}
        >
          {tinyFallback && !photoReady && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={tinyFallback}
              alt=""
              decoding="async"
              className="h-full w-full object-cover scale-[1.12] opacity-85"
              style={{ filter: "blur(24px)" }}
            />
          )}
          {blobUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={blobUrl}
              alt=""
              decoding="async"
              onLoad={() => setPhotoReady(true)}
              className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
                photoReady ? "opacity-100" : "opacity-0"
              }`}
              style={
                visualConfig.wallpaperBlur > 0
                  ? {
                      filter: "blur(var(--backdrop-blur, 10px))",
                      transform: "scale(1.06)",
                    }
                  : undefined
              }
            />
          )}
          <div
            className="absolute inset-0"
            style={{
              background: `linear-gradient(180deg, rgb(var(--sys-bg) / ${topDimAlpha}) 0%, rgb(var(--sys-bg) / ${bottomDimAlpha}) 100%)`,
            }}
          />
        </div>
      )}
    </div>
  );
}
