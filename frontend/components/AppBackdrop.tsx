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

  const activeObjectUrlRef = useRef<string | null>(null);

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
      aria-hidden="true"
      data-backdrop={effectiveBackdrop}
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
