"use client";

import React, { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { LaptopIcon, MoonIcon, PaletteIcon, SunIcon } from "@/components/ui/Icons";
import { ACCENT_OPTIONS, useTheme, type AccentColor, type Theme } from "@/lib/useTheme";

const preloadStudioModal = () => {
  void import("@/components/settings/AppearanceStudioModal");
};

const AppearanceStudioModal = dynamic(
  () => import("@/components/settings/AppearanceStudioModal").then((m) => m.AppearanceStudioModal),
  { ssr: false }
);
import {
  BACKDROP_OPTIONS,
  CURATED_STYLE_PRESETS,
  FONT_OPTIONS,
  SURFACE_OPTIONS,
  hslToRgb,
  matchesCuratedPreset,
  rgbToHex,
} from "@/lib/visualStudio";

export function AppearanceStudioSection() {
  const {
    theme,
    resolvedTheme,
    setTheme,
    accent,
    setAccent,
    visualConfig,
  } = useTheme();

  const [studioOpen, setStudioOpen] = useState(false);
  const [studioMounted, setStudioMounted] = useState(false);
  const [studioTab, setStudioTab] = useState<"presets" | "color">("presets");

  if (studioOpen && !studioMounted) {
    setStudioMounted(true);
  }

  useEffect(() => {
    if (studioMounted || typeof window === "undefined") return;
    const win = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (typeof win.requestIdleCallback === "function") {
      const id = win.requestIdleCallback(preloadStudioModal, { timeout: 1200 });
      return () => win.cancelIdleCallback?.(id);
    }
    const timer = window.setTimeout(preloadStudioModal, 450);
    return () => window.clearTimeout(timer);
  }, [studioMounted]);

  const openStudio = (tab: "presets" | "color") => {
    preloadStudioModal();
    setStudioMounted(true);
    setStudioTab(tab);
    setStudioOpen(true);
  };

  const customSwatchHex = useMemo(
    () =>
      rgbToHex(
        hslToRgb(
          visualConfig.customHue,
          visualConfig.customSaturation,
          resolvedTheme === "dark" ? 60 : 48
        )
      ),
    [visualConfig.customHue, visualConfig.customSaturation, resolvedTheme]
  );

  const matchedPreset = useMemo(
    () => CURATED_STYLE_PRESETS.find((p) => matchesCuratedPreset(p, accent, visualConfig)),
    [accent, visualConfig]
  );

  const activeSurfaceLabel =
    SURFACE_OPTIONS.find((s) => s.id === visualConfig.surface)?.label ?? "Класичний";
  const activeBackdropLabel =
    BACKDROP_OPTIONS.find((b) => b.id === visualConfig.backdrop)?.label ?? "Чистий";
  const activeFontLabel =
    FONT_OPTIONS.find((f) => f.id === visualConfig.fontPreset)?.label ?? "Класичний";
  const activeAccentLabel =
    accent === "custom"
      ? "Свій колір"
      : ACCENT_OPTIONS.find((opt) => opt.id === accent)?.label ?? "Океан";

  const modes: Array<{ id: Theme; label: string; icon: React.ReactNode }> = [
    { id: "dark", label: "Темна", icon: <MoonIcon className="h-3.5 w-3.5 shrink-0" /> },
    { id: "light", label: "Світла", icon: <SunIcon className="h-3.5 w-3.5 shrink-0" /> },
    { id: "system", label: "Авто", icon: <LaptopIcon className="h-3.5 w-3.5 shrink-0" /> },
  ];

  return (
    <>
      <section className="rounded-2xl border border-sys-border bg-sys-card p-4 sm:p-5 shadow-xs space-y-4">
        <div className="flex items-center justify-between gap-2 pb-2 border-b border-sys-border/60">
          <div className="flex items-center gap-2">
            <PaletteIcon className="h-4 w-4 text-sys-text-muted" />
            <h2 className="text-sm font-bold uppercase tracking-wider text-sys-text-muted">
              Тема оформлення
            </h2>
          </div>
          <span className="text-xs font-semibold text-sys-accent">
            {matchedPreset ? matchedPreset.name : activeAccentLabel}
          </span>
        </div>

        {/* Light / Dark / System Switch — Pure GPU translate3d sliding pill */}
        {(() => {
          const activeModeIdx = Math.max(0, modes.findIndex((m) => m.id === theme));
          return (
            <div
              role="group"
              aria-label="Режим теми"
              className="relative grid grid-cols-3 rounded-xl border border-sys-border bg-sys-bg p-1 text-xs font-semibold isolate select-none"
            >
              <div
                aria-hidden="true"
                className="pointer-events-none absolute top-1 bottom-1 left-1 z-0 rounded-lg bg-sys-accentSolid shadow-xs transition-transform duration-base [transition-timing-function:var(--ease-spring-snappy)] transform-gpu"
                style={{
                  width: "calc((100% - 8px) / 3)",
                  transform: `translate3d(calc(${activeModeIdx} * 100%), 0, 0)`,
                }}
              />
              {modes.map((mode) => {
                const active = theme === mode.id;
                return (
                  <button
                    key={mode.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setTheme(mode.id)}
                    className={`relative z-10 flex min-h-[38px] items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 transition-colors duration-150 cursor-pointer active:scale-[0.98] ${
                      active
                        ? "text-white font-bold"
                        : "text-sys-text-secondary hover:text-sys-text-primary"
                    }`}
                  >
                    {mode.icon}
                    <span>{mode.label}</span>
                  </button>
                );
              })}
            </div>
          );
        })()}

        {/* Compact Non-Overflowing Palette Swatches */}
        <div className="space-y-2">
          <span className="block text-xs font-semibold text-sys-text-secondary">
            Колірна палітра
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {ACCENT_OPTIONS.map((opt) => {
              const active = accent === opt.id;
              const isDark = resolvedTheme === "dark";
              return (
                <button
                  key={opt.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setAccent(opt.id as AccentColor)}
                  className={`inline-flex min-h-[36px] items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer active:scale-[0.98] ${
                    active
                      ? "border-sys-accent bg-sys-accent/15 text-sys-text-primary ring-1 ring-sys-accent/35"
                      : "border-sys-border bg-sys-bg text-sys-text-secondary hover:border-sys-elevated-border hover:text-sys-text-primary"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className="h-3.5 w-3.5 rounded-full border border-black/15 dark:border-white/20 shrink-0"
                    style={{
                      background: `linear-gradient(135deg, ${
                        isDark ? opt.darkCardHex : opt.lightCardHex
                      } 35%, ${opt.colorHex} 100%)`,
                    }}
                  />
                  <span>{opt.label}</span>
                </button>
              );
            })}

            <button
              type="button"
              aria-pressed={accent === "custom"}
              onPointerEnter={preloadStudioModal}
              onTouchStart={preloadStudioModal}
              onFocus={preloadStudioModal}
              onClick={() => {
                setAccent("custom");
                openStudio("color");
              }}
              className={`inline-flex min-h-[36px] items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer active:scale-[0.98] ${
                accent === "custom"
                  ? "border-sys-accent bg-sys-accent/15 text-sys-text-primary ring-1 ring-sys-accent/35"
                  : "border-sys-border bg-sys-bg text-sys-text-secondary hover:border-sys-elevated-border hover:text-sys-text-primary"
              }`}
            >
              <span
                aria-hidden="true"
                className="h-3.5 w-3.5 rounded-full border border-sys-border shrink-0"
                style={{
                  background:
                    accent === "custom"
                      ? customSwatchHex
                      : "conic-gradient(from 0deg, #ef4444, #f59e0b, #10b981, #06b6d4, #3b82f6, #a855f7, #ef4444)",
                }}
              />
              <span>Свій колір</span>
            </button>
          </div>
        </div>

        {/* Studio Launcher Card */}
        <button
          type="button"
          onPointerEnter={preloadStudioModal}
          onTouchStart={preloadStudioModal}
          onFocus={preloadStudioModal}
          onClick={() => openStudio("presets")}
          className="spring-press group w-full flex items-center justify-between gap-3 rounded-xl border border-sys-border bg-sys-bg p-3.5 text-left hover:border-sys-accent/60 transition-colors cursor-pointer"
        >
          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="text-xs sm:text-sm font-bold text-sys-text-primary group-hover:text-sys-accent transition-colors">
              Студія оформлення
            </div>
            <div className="text-xs text-sys-text-secondary leading-snug break-words">
              {activeSurfaceLabel} · {activeBackdropLabel} · Шрифт {activeFontLabel}
            </div>
          </div>
          <span className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-sys-border bg-sys-card px-2.5 py-1.5 text-xs font-semibold text-sys-text-primary group-hover:border-sys-accent/50 transition-colors">
            Налаштувати →
          </span>
        </button>
      </section>

      {studioMounted && (
        <AppearanceStudioModal
          isOpen={studioOpen}
          onClose={() => setStudioOpen(false)}
          initialTab={studioTab}
        />
      )}
    </>
  );
}
