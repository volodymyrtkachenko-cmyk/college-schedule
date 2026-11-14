"use client";

import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AppDialog } from "@/components/ui/AppDialog";
import { CloseIcon } from "@/components/ui/Icons";
import { ACCENT_OPTIONS, useTheme, type AccentColor, type Theme } from "@/lib/useTheme";
import {
  BACKDROP_OPTIONS,
  CURATED_STYLE_PRESETS,
  DENSITY_OPTIONS,
  FONT_OPTIONS,
  QUICK_CUSTOM_HUES,
  RADIUS_OPTIONS,
  SURFACE_OPTIONS,
  buildCustomAccentVars,
  contrastRatio,
  decodeThemeShareCode,
  encodeThemeShareCode,
  hslToRgb,
  matchesCuratedPreset,
  rgbToHex,
  type RGBColor,
} from "@/lib/visualStudio";
import {
  deleteCustomWallpaper,
  loadCustomWallpaperBlob,
  readWallpaperMeta,
  saveCustomWallpaper,
  type WallpaperMeta,
} from "@/lib/wallpaperStorage";

type StudioTab = "presets" | "color" | "surface" | "backdrop" | "layout";

const THEME_MODES: Array<{ id: Theme; label: string }> = [
  { id: "dark", label: "Темна" },
  { id: "light", label: "Світла" },
  { id: "system", label: "Авто" },
];

const STUDIO_TABS: Array<{ id: StudioTab; label: string }> = [
  { id: "presets", label: "Стилі" },
  { id: "color", label: "Колір" },
  { id: "surface", label: "Матеріал" },
  { id: "backdrop", label: "Фон" },
  { id: "layout", label: "Шрифт і код" },
];

const HUE_SPECTRUM_TRACK =
  "linear-gradient(to right, hsl(0 82% 54%), hsl(60 82% 50%), hsl(120 75% 44%), hsl(180 80% 45%), hsl(240 82% 58%), hsl(300 80% 54%), hsl(359 82% 54%))";

export interface AppearanceStudioModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: StudioTab;
}

export function AppearanceStudioModal({
  isOpen,
  onClose,
  initialTab = "presets",
}: AppearanceStudioModalProps) {
  const {
    theme,
    resolvedTheme,
    setTheme,
    accent,
    setAccent,
    visualConfig,
    setVisualConfig,
    applyCuratedPreset,
    applyThemeBundle,
    resetVisualStudio,
    wallpaperVersion,
    bumpWallpaperVersion,
  } = useTheme();

  const titleId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const hueInputId = useId();
  const satInputId = useId();
  const blurInputId = useId();
  const dimInputId = useId();
  const importInputId = useId();

  const [activeTab, setActiveTab] = useState<StudioTab>(initialTab);
  const [hasSwitchedTab, setHasSwitchedTab] = useState(false);
  const [tabSlideDir, setTabSlideDir] = useState<"next" | "prev">("next");
  const tabListRef = useRef<HTMLDivElement | null>(null);
  const tabButtonRefs = useRef<Partial<Record<StudioTab, HTMLButtonElement | null>>>({});
  const [tabPill, setTabPill] = useState<{ left: number; width: number; ready: boolean }>({
    left: 0,
    width: 0,
    ready: false,
  });

  const handleSelectTab = useCallback(
    (nextTab: StudioTab) => {
      if (nextTab === activeTab) return;
      const prevIdx = STUDIO_TABS.findIndex((t) => t.id === activeTab);
      const nextIdx = STUDIO_TABS.findIndex((t) => t.id === nextTab);
      setTabSlideDir(nextIdx >= prevIdx ? "next" : "prev");
      setHasSwitchedTab(true);
      setActiveTab(nextTab);
    },
    [activeTab]
  );

  const measureTabPill = useCallback(
    (allowAnimate: boolean) => {
      const btn = tabButtonRefs.current[activeTab];
      if (!btn) return;
      const nextLeft = btn.offsetLeft;
      const nextWidth = btn.offsetWidth;
      if (nextWidth <= 0) return;
      setTabPill((prev) => ({
        left: nextLeft,
        width: nextWidth,
        ready: allowAnimate ? prev.ready || prev.width > 0 : false,
      }));
    },
    [activeTab]
  );

  useEffect(() => {
    if (isOpen) {
      setHasSwitchedTab(false);
      setActiveTab(initialTab);
      setTabPill((prev) => ({ ...prev, ready: false }));
    }
  }, [isOpen, initialTab]);

  useLayoutEffect(() => {
    if (!isOpen) return;
    measureTabPill(tabPill.width > 0);
    const btn = tabButtonRefs.current[activeTab];
    if (btn && hasSwitchedTab) {
      btn.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    }
    // Note: tabPill.width intentionally excluded to avoid re-running measurement on its own update
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, activeTab, hasSwitchedTab]);

  useEffect(() => {
    if (!isOpen) return;
    const listEl = tabListRef.current;
    if (!listEl || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      measureTabPill(false);
    });
    ro.observe(listEl);
    return () => ro.disconnect();
  }, [isOpen, measureTabPill]);

  const [previewLive, setPreviewLive] = useState<boolean>(true);
  const [wallpaperMeta, setWallpaperMeta] = useState<WallpaperMeta | null>(null);
  const [previewBlobUrl, setPreviewBlobUrl] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoFeedback, setPhotoFeedback] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [importCode, setImportCode] = useState("");
  const [importFeedback, setImportFeedback] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const previewObjectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    setWallpaperMeta(readWallpaperMeta());
  }, [wallpaperVersion, isOpen]);

  useEffect(() => {
    let cancelled = false;
    if (!isOpen || visualConfig.backdrop !== "custom") {
      if (previewObjectUrlRef.current) {
        URL.revokeObjectURL(previewObjectUrlRef.current);
        previewObjectUrlRef.current = null;
      }
      setPreviewBlobUrl(null);
      return;
    }

    loadCustomWallpaperBlob()
      .then((rec) => {
        if (cancelled) return;
        if (!rec?.blob) {
          setPreviewBlobUrl(null);
          return;
        }
        const url = URL.createObjectURL(rec.blob);
        if (previewObjectUrlRef.current && previewObjectUrlRef.current !== url) {
          URL.revokeObjectURL(previewObjectUrlRef.current);
        }
        previewObjectUrlRef.current = url;
        setPreviewBlobUrl(url);
      })
      .catch(() => {
        if (!cancelled) setPreviewBlobUrl(null);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, visualConfig.backdrop, wallpaperVersion]);

  useEffect(() => {
    return () => {
      if (previewObjectUrlRef.current) {
        URL.revokeObjectURL(previewObjectUrlRef.current);
        previewObjectUrlRef.current = null;
      }
    };
  }, []);

  const customPreview = useMemo(() => {
    const built = buildCustomAccentVars(
      visualConfig.customHue,
      visualConfig.customSaturation,
      resolvedTheme,
      visualConfig.surface
    );
    const parseTriplet = (str: string): RGBColor => {
      const [r, g, b] = str.split(" ").map((n) => Number(n));
      return { r, g, b };
    };
    const ratio = contrastRatio(
      parseTriplet(built.vars["--sys-accent"]),
      parseTriplet(built.vars["--sys-card"])
    );
    const solidContrast = contrastRatio(
      { r: 255, g: 255, b: 255 },
      parseTriplet(built.vars["--sys-accent-solid"])
    );
    const swatchRgb = hslToRgb(
      visualConfig.customHue,
      visualConfig.customSaturation,
      resolvedTheme === "dark" ? 60 : 48
    );
    return {
      swatchHex: rgbToHex(swatchRgb),
      accentContrast: ratio.toFixed(1),
      solidContrast: solidContrast.toFixed(1),
    };
  }, [visualConfig.customHue, visualConfig.customSaturation, visualConfig.surface, resolvedTheme]);

  const shareResult = useMemo(
    () => encodeThemeShareCode(accent, visualConfig),
    [accent, visualConfig]
  );

  const isDefaultClassic =
    theme === "dark" &&
    matchesCuratedPreset(CURATED_STYLE_PRESETS[0], accent, visualConfig);

  async function handlePhotoSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setUploadingPhoto(true);
    setPhotoFeedback(null);
    try {
      const meta = await saveCustomWallpaper(file);
      setWallpaperMeta(meta);
      setVisualConfig({
        backdrop: "custom",
        wallpaperTint: meta.dominantHex,
      });
      bumpWallpaperVersion();
      setPhotoFeedback({
        kind: "ok",
        text: "Шпалери оптимізовано та збережено локально.",
      });
    } catch (err) {
      setPhotoFeedback({
        kind: "err",
        text: err instanceof Error ? err.message : "Не вдалося завантажити зображення.",
      });
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function handleRemovePhoto() {
    setPhotoFeedback(null);
    await deleteCustomWallpaper();
    setWallpaperMeta(null);
    if (visualConfig.backdrop === "custom") {
      setVisualConfig({ backdrop: "none", wallpaperTint: null });
    } else {
      setVisualConfig({ wallpaperTint: null });
    }
    bumpWallpaperVersion();
  }

  async function handleCopyShareCode() {
    try {
      await navigator.clipboard.writeText(shareResult.code);
      setCopyFeedback("Код скопійовано");
      window.setTimeout(() => setCopyFeedback(null), 2200);
    } catch {
      setCopyFeedback("Скопіюйте код вручну");
      window.setTimeout(() => setCopyFeedback(null), 2600);
    }
  }

  function handleImportSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = decodeThemeShareCode(importCode);
    if (!parsed) {
      setImportFeedback({
        kind: "err",
        text: "Невірний формат. Код має вигляд DFKR1.матеріал.фон.шрифт.кути.щільність.акцент",
      });
      return;
    }
    applyThemeBundle(parsed.accent, parsed.config);
    setImportFeedback({ kind: "ok", text: "Стиль застосовано." });
    setImportCode("");
    window.setTimeout(() => setImportFeedback(null), 2600);
  }

  const effectivePreviewBackdrop =
    visualConfig.backdrop === "custom" && !previewBlobUrl && !wallpaperMeta?.tinyPlaceholder
      ? "aurora"
      : visualConfig.backdrop;

  const previewDimTop = Math.max(0.1, Math.min(0.85, visualConfig.wallpaperDim / 100));
  const previewDimBottom = Math.min(
    resolvedTheme === "dark" ? 0.92 : 0.94,
    Number((previewDimTop + 0.16).toFixed(2))
  );

  const hueProgress = `${Math.round((visualConfig.customHue / 359) * 100)}%`;
  const satProgress = `${Math.round(((visualConfig.customSaturation - 40) / 55) * 100)}%`;
  const blurProgress = `${Math.round((visualConfig.wallpaperBlur / 24) * 100)}%`;
  const dimProgress = `${Math.round(((visualConfig.wallpaperDim - 10) / 75) * 100)}%`;

  const activeSurfaceLabel =
    SURFACE_OPTIONS.find((s) => s.id === visualConfig.surface)?.label ?? "Класичний";
  const activeBackdropLabel =
    BACKDROP_OPTIONS.find((b) => b.id === visualConfig.backdrop)?.label ?? "Чистий";
  const activeFontLabel =
    FONT_OPTIONS.find((f) => f.id === visualConfig.fontPreset)?.label ?? "Класичний";
  const activeRadiusLabel =
    RADIUS_OPTIONS.find((r) => r.id === visualConfig.radius)?.label ?? "Стандарт";
  const activeDensityLabel =
    DENSITY_OPTIONS.find((d) => d.id === visualConfig.density)?.label ?? "Стандарт";

  return (
    <AppDialog
      isOpen={isOpen}
      onClose={onClose}
      variant="sheet"
      maxWidth="60rem"
      maxHeight="90dvh"
      labelledBy={titleId}
    >
      <div className="w-full max-w-full min-w-0 max-h-[90dvh] flex flex-col rounded-t-2xl sm:rounded-2xl border border-sys-border bg-sys-card text-sys-text-primary shadow-2xl overflow-hidden">
        {/* Sticky Studio Header */}
        <div className="shrink-0 flex items-center justify-between gap-2 border-b border-sys-border bg-sys-surface px-3.5 py-2.5 sm:px-5 sm:py-3">
          <div className="min-w-0">
            <h2 id={titleId} className="text-sm sm:text-lg font-bold text-sys-text-primary leading-tight">
              Студія оформлення
            </h2>
            <p className="hidden sm:block text-xs text-sys-text-secondary mt-0.5">
              Зміни застосовуються одразу та не впливають на логіку розкладу.
            </p>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {!isDefaultClassic && (
              <button
                type="button"
                onClick={() => {
                  setTheme("dark");
                  resetVisualStudio();
                  setImportFeedback(null);
                  setPhotoFeedback(null);
                }}
                className="min-h-[36px] rounded-xl border border-sys-border bg-sys-bg px-2.5 sm:px-3 py-1.5 text-xs font-semibold text-sys-text-secondary hover:border-sys-accent/60 hover:text-sys-text-primary transition-colors cursor-pointer"
              >
                Скинути
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="min-h-[36px] rounded-xl bg-sys-accentSolid px-3.5 py-1.5 text-xs font-semibold text-white hover:opacity-90 transition-opacity cursor-pointer"
            >
              Готово
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Закрити студію оформлення"
              className="hidden sm:inline-flex h-9 w-9 items-center justify-center rounded-xl border border-sys-border bg-sys-bg text-sys-text-secondary hover:text-sys-text-primary hover:border-sys-accent/50 transition-colors cursor-pointer"
            >
              <CloseIcon className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Main Studio Body: Top Live Preview on Mobile, Side-by-Side Live Preview on Desktop */}
        <div className="flex-1 min-h-0 flex flex-col md:grid md:grid-cols-[minmax(0,1fr)_20rem] lg:grid-cols-[minmax(0,1.2fr)_24rem] overflow-hidden">
          {/* Live Preview Stage (Pinned Top on Mobile, Right Column on Desktop) */}
          <aside
            aria-label="Живий попередній перегляд"
            className="order-1 md:order-2 shrink-0 md:overflow-y-auto md:overscroll-contain border-b md:border-b-0 md:border-l border-sys-border bg-sys-surface/50 px-3.5 py-2.5 sm:px-4 sm:py-3.5 md:p-5 flex flex-col justify-between gap-3"
          >
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-sys-text-muted">
                  Живе прев&apos;ю
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setPreviewLive((prev) => !prev)}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                      previewLive
                        ? "border-sys-accent/40 bg-sys-accent/15 text-sys-accent"
                        : "border-sys-border bg-sys-bg text-sys-text-secondary hover:text-sys-text-primary"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`h-1.5 w-1.5 rounded-full ${previewLive ? "bg-sys-accent" : "bg-sys-text-muted"}`}
                    />
                    {previewLive ? "Зараз іде" : "Спокійна"}
                  </button>
                </div>
              </div>

              {/* Mini-Stage Container reflecting live backdrop + surface + font + radius + density */}
              <div className="studio-preview-stage relative overflow-hidden rounded-2xl border border-sys-border bg-sys-bg p-2.5 sm:p-3.5 md:p-4">
                <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden select-none">
                  {effectivePreviewBackdrop === "none" && visualConfig.surface === "glass" && (
                    <div className="app-backdrop-glass-sheen absolute inset-0" />
                  )}
                  {effectivePreviewBackdrop === "aurora" && (
                    <div className="app-backdrop-aurora absolute inset-0">
                      <div className="app-aurora-orb app-aurora-orb-1" />
                      <div className="app-aurora-orb app-aurora-orb-2" />
                    </div>
                  )}
                  {effectivePreviewBackdrop === "dots" && (
                    <div className="app-backdrop-dots absolute inset-0" />
                  )}
                  {effectivePreviewBackdrop === "blueprint" && (
                    <div className="app-backdrop-blueprint absolute inset-0" />
                  )}
                  {effectivePreviewBackdrop === "silk" && (
                    <div className="app-backdrop-silk-gradient absolute inset-0" />
                  )}
                  {effectivePreviewBackdrop === "custom" && (
                    <>
                      {wallpaperMeta?.dominantHex && (
                        <div
                          className="absolute inset-0"
                          style={{ backgroundColor: wallpaperMeta.dominantHex }}
                        />
                      )}
                      {(previewBlobUrl || wallpaperMeta?.tinyPlaceholder) && (
                        <img
                          src={previewBlobUrl || wallpaperMeta?.tinyPlaceholder || ""}
                          alt=""
                          decoding="async"
                          className="absolute inset-0 h-full w-full object-cover"
                          style={
                            visualConfig.wallpaperBlur > 0
                              ? {
                                  filter: `blur(${visualConfig.wallpaperBlur}px)`,
                                  transform: "scale(1.06)",
                                }
                              : undefined
                          }
                        />
                      )}
                      <div
                        className="absolute inset-0"
                        style={{
                          background:
                            resolvedTheme === "dark"
                              ? `linear-gradient(180deg, rgb(6 10 20 / ${previewDimTop}) 0%, rgb(6 10 20 / ${previewDimBottom}) 100%)`
                              : `linear-gradient(180deg, rgb(248 250 252 / ${previewDimTop}) 0%, rgb(241 245 249 / ${previewDimBottom}) 100%)`,
                        }}
                      />
                    </>
                  )}
                </div>

                {/* Live Lesson Card Preview (Responsive without horizontal overflow) */}
                <article
                  data-live={previewLive ? "true" : undefined}
                  className={`studio-preview-card lesson-card-day relative z-10 overflow-hidden rounded-2xl border bg-sys-card shadow-sm transition-[border-color,background-color] duration-150 ${
                    previewLive
                      ? "border-sys-accent ring-1 ring-sys-accent/35"
                      : "border-sys-border"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex w-11 shrink-0 flex-col justify-start border-r border-sys-border pr-2.5">
                      <span
                        className={`ui-mono-slot text-lg sm:text-xl font-black leading-none ${
                          previewLive ? "text-sys-accent" : "text-sys-text-primary"
                        }`}
                      >
                        2
                      </span>
                      <div className="ui-mono-slot mt-1 flex flex-col leading-tight whitespace-nowrap">
                        <span className="text-xs font-bold text-sys-text-primary">10:40</span>
                        <span className="text-[11px] text-sys-text-muted">12:00</span>
                      </div>
                    </div>

                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div>
                        <div className="font-bold leading-snug text-sm sm:text-[15px] text-sys-text-primary break-words">
                          Комп&apos;ютерна схемотехніка
                        </div>
                        <div className="text-xs text-sys-text-secondary mt-0.5 leading-snug">
                          Викладач · 1 підгрупа
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="ui-mono-slot inline-flex h-6 px-2 items-center rounded-lg border border-sys-border bg-sys-bg text-sys-text-secondary font-medium text-[11px]">
                          ауд. 207
                        </span>
                        <span className="inline-flex h-6 px-2 items-center rounded-lg border border-sys-accent/30 bg-sys-accent/15 text-sys-accent font-bold text-[11px]">
                          1 ДЗ
                        </span>
                      </div>

                      {previewLive && (
                        <div className="flex items-center gap-2 pt-0.5">
                          <span className="ui-mono-slot shrink-0 text-[11px] font-bold text-sys-accent">
                            ще 24 хв
                          </span>
                          <div className="h-1.5 flex-1 rounded-full bg-sys-border/60 overflow-hidden">
                            <div className="h-full w-[68%] rounded-full bg-sys-accentSolid" />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </article>
              </div>
            </div>

            {/* Desktop Quick Mode Switcher & Current Summary */}
            <div className="hidden md:flex flex-col gap-3 pt-2 border-t border-sys-border/70">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-sys-text-secondary">
                  Перевірити у темі
                </span>
                <div className="inline-flex rounded-lg border border-sys-border bg-sys-bg p-0.5 gap-0.5">
                  {THEME_MODES.map((m) => (
                    <button
                      key={`preview-mode-${m.id}`}
                      type="button"
                      onClick={() => setTheme(m.id)}
                      className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                        theme === m.id
                          ? "bg-sys-accentSolid text-white"
                          : "text-sys-text-secondary hover:text-sys-text-primary"
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {[
                  activeSurfaceLabel,
                  activeBackdropLabel,
                  `Шрифт: ${activeFontLabel}`,
                  `Кути: ${activeRadiusLabel}`,
                  `Щільність: ${activeDensityLabel}`,
                ].map(
                  (tag, idx) => (
                    <span
                      key={`${tag}-${idx}`}
                      className="rounded-lg border border-sys-border bg-sys-bg px-2 py-0.5 text-[11px] font-medium text-sys-text-secondary"
                    >
                      {tag}
                    </span>
                  )
                )}
              </div>
            </div>
          </aside>

          {/* Controls Column (Scrollable Tabs Content) */}
          <div className="order-2 md:order-1 flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden">
            {/* Scrollable Horizontal Tab Bar with GPU sliding pill */}
            <div
              ref={tabListRef}
              role="tablist"
              aria-label="Розділи налаштування стилю"
              className="relative shrink-0 flex items-center gap-1.5 overflow-x-auto custom-scrollbar border-b border-sys-border bg-sys-card px-4 py-2.5 isolate"
            >
              {tabPill.width > 0 && (
                <div
                  aria-hidden="true"
                  className={`pointer-events-none absolute top-2.5 bottom-2.5 left-0 z-0 rounded-xl border border-sys-accent bg-sys-accent/15 shadow-xs transform-gpu ${
                    tabPill.ready
                      ? "transition-[transform,width] duration-base [transition-timing-function:var(--ease-spring-snappy)]"
                      : ""
                  }`}
                  style={{
                    width: `${tabPill.width}px`,
                    transform: `translate3d(${tabPill.left}px, 0, 0)`,
                  }}
                />
              )}
              {STUDIO_TABS.map((tab) => {
                const active = activeTab === tab.id;
                const showStaticActive = active && tabPill.width === 0;
                return (
                  <button
                    key={tab.id}
                    ref={(el) => {
                      tabButtonRefs.current[tab.id] = el;
                    }}
                    role="tab"
                    aria-selected={active}
                    type="button"
                    onClick={() => handleSelectTab(tab.id)}
                    className={`relative z-10 shrink-0 whitespace-nowrap min-h-[36px] rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors duration-fast cursor-pointer active:scale-[0.97] ${
                      showStaticActive
                        ? "border-sys-accent bg-sys-accent/15 text-sys-accent shadow-xs"
                        : active
                        ? "border-transparent text-sys-accent"
                        : "border-sys-border bg-sys-bg/75 text-sys-text-secondary hover:text-sys-text-primary hover:border-sys-elevated-border"
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {/* Tab Panel Body */}
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-5 space-y-4">
              {/* Tab 1: Curated Presets */}
              {activeTab === "presets" && (
                <div
                  key="tab-presets"
                  data-slide-dir={hasSwitchedTab ? tabSlideDir : undefined}
                  className={`${hasSwitchedTab ? "guide-step-slide " : ""}space-y-3`}
                  role="tabpanel"
                >
                  <p className="text-xs text-sys-text-secondary leading-relaxed">
                    Оберіть готовий образ в один клік або доналаштуйте колір, матеріал, фон і шрифт на сусідніх вкладках.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {CURATED_STYLE_PRESETS.map((preset) => {
                      const active = matchesCuratedPreset(preset, accent, visualConfig);
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          aria-pressed={active}
                          onClick={() => applyCuratedPreset(preset)}
                          className={`flex flex-col justify-between gap-2.5 rounded-xl border p-3.5 text-left transition-colors cursor-pointer ${
                            active
                              ? "border-sys-accent bg-sys-accent/12 text-sys-text-primary shadow-xs ring-1 ring-sys-accent/40"
                              : "border-sys-border bg-sys-bg text-sys-text-secondary hover:border-sys-elevated-border hover:text-sys-text-primary"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 w-full">
                            <div className="flex items-center gap-1.5">
                              {preset.previewSwatches.map((hex, i) => (
                                <span
                                  key={`${preset.id}-sw-${i}`}
                                  aria-hidden="true"
                                  className="h-4 w-4 rounded-full border border-white/15 shrink-0"
                                  style={{ backgroundColor: hex }}
                                />
                              ))}
                            </div>
                            {active && (
                              <span className="rounded-full bg-sys-accent/20 px-2 py-0.5 text-[11px] font-bold text-sys-accent">
                                Активний
                              </span>
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-bold text-sys-text-primary">
                              {preset.name}
                            </div>
                            <div className="text-xs text-sys-text-secondary leading-snug mt-0.5">
                              {preset.subtitle}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Tab 2: Mode + Palette + Custom Hue Generator */}
              {activeTab === "color" && (
                <div
                  key="tab-color"
                  data-slide-dir={hasSwitchedTab ? tabSlideDir : undefined}
                  className={`${hasSwitchedTab ? "guide-step-slide " : ""}space-y-4`}
                  role="tabpanel"
                >
                  <div className="space-y-2">
                    <span className="block text-xs font-semibold text-sys-text-secondary">
                      Режим освітлення
                    </span>
                    <div className="relative grid grid-cols-3 gap-1.5 rounded-xl border border-sys-border bg-sys-bg p-1 isolate">
                      <div
                        aria-hidden="true"
                        className="pointer-events-none absolute top-1 bottom-1 left-1 z-0 rounded-lg bg-sys-accentSolid shadow-xs transform-gpu transition-transform duration-base [transition-timing-function:var(--ease-spring-snappy)]"
                        style={{
                          width: "calc((100% - 8px - 12px) / 3)",
                          transform: `translate3d(calc(${Math.max(
                            0,
                            THEME_MODES.findIndex((m) => m.id === theme)
                          )} * (100% + 6px)), 0, 0)`,
                        }}
                      />
                      {THEME_MODES.map((m) => {
                        const active = theme === m.id;
                        return (
                          <button
                            key={m.id}
                            type="button"
                            aria-pressed={active}
                            onClick={() => setTheme(m.id)}
                            className={`relative z-10 min-h-[38px] rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors duration-fast cursor-pointer active:scale-[0.98] ${
                              active
                                ? "text-white font-bold"
                                : "text-sys-text-secondary hover:text-sys-text-primary"
                            }`}
                          >
                            {m.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <span className="block text-xs font-semibold text-sys-text-secondary">
                      Палітра акценту
                    </span>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                      {ACCENT_OPTIONS.map((opt) => {
                        const active = accent === opt.id;
                        const isDark = resolvedTheme === "dark";
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            aria-pressed={active}
                            onClick={() => setAccent(opt.id as AccentColor)}
                            className={`flex items-center gap-2.5 rounded-xl border p-3 text-left transition-colors cursor-pointer min-w-0 ${
                              active
                                ? "border-sys-accent bg-sys-accent/12 text-sys-text-primary ring-1 ring-sys-accent/35"
                                : "border-sys-border bg-sys-bg text-sys-text-secondary hover:border-sys-elevated-border hover:text-sys-text-primary"
                            }`}
                          >
                            <span
                              aria-hidden="true"
                              className="h-6 w-6 rounded-lg border border-sys-border shrink-0 shadow-xs"
                              style={{
                                background: `linear-gradient(135deg, ${
                                  isDark ? opt.darkCardHex : opt.lightCardHex
                                } 46%, ${opt.colorHex} 100%)`,
                              }}
                            />
                            <span className="text-xs font-semibold min-w-0 leading-tight break-words">{opt.label}</span>
                          </button>
                        );
                      })}

                      <button
                        type="button"
                        aria-pressed={accent === "custom"}
                        onClick={() => setAccent("custom")}
                        className={`flex items-center gap-2.5 rounded-xl border p-3 text-left transition-colors cursor-pointer min-w-0 ${
                          accent === "custom"
                            ? "border-sys-accent bg-sys-accent/12 text-sys-text-primary ring-1 ring-sys-accent/35"
                            : "border-sys-border bg-sys-bg text-sys-text-secondary hover:border-sys-elevated-border hover:text-sys-text-primary"
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className="h-6 w-6 rounded-lg border border-sys-border shrink-0 shadow-xs"
                          style={{
                            background:
                              accent === "custom"
                                ? customPreview.swatchHex
                                : "conic-gradient(from 0deg, #ef4444, #f59e0b, #10b981, #06b6d4, #3b82f6, #a855f7, #ef4444)",
                          }}
                        />
                        <span className="text-xs font-semibold min-w-0 leading-tight break-words">Свій колір</span>
                      </button>
                    </div>
                  </div>

                  <div
                    className="grid-accordion"
                    data-open={accent === "custom" ? "true" : "false"}
                    aria-hidden={accent === "custom" ? undefined : true}
                  >
                    <div className="grid-accordion-inner">
                      <div className="rounded-xl border border-sys-border bg-sys-bg p-3.5 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span
                            aria-hidden="true"
                            className="h-4 w-4 rounded-full border border-sys-border"
                            style={{ backgroundColor: customPreview.swatchHex }}
                          />
                          <span className="text-xs font-bold text-sys-text-primary">
                            Тонке налаштування відтінку
                          </span>
                        </div>
                        <span className="ui-mono-slot rounded-md border border-sys-border bg-sys-card px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                          WCAG AA ✓ {customPreview.accentContrast}:1 / {customPreview.solidContrast}:1
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                        <div>
                          <div className="flex items-center justify-between text-xs mb-1">
                            <label htmlFor={hueInputId} className="font-medium text-sys-text-secondary">
                              Відтінок (Hue)
                            </label>
                            <span className="ui-mono-slot font-semibold text-sys-text-primary">
                              {visualConfig.customHue}°
                            </span>
                          </div>
                          <input
                            id={hueInputId}
                            type="range"
                            min={0}
                            max={359}
                            value={visualConfig.customHue}
                            aria-valuetext={`${visualConfig.customHue} градусів`}
                            onChange={(e) => setVisualConfig({ customHue: Number(e.target.value) })}
                            className="studio-range"
                            style={
                              {
                                "--slider-progress": hueProgress,
                                "--slider-custom-track": HUE_SPECTRUM_TRACK,
                                "--slider-custom-progress": "transparent",
                                "--slider-fill-color": customPreview.swatchHex,
                              } as React.CSSProperties
                            }
                          />
                        </div>

                        <div>
                          <div className="flex items-center justify-between text-xs mb-1">
                            <label htmlFor={satInputId} className="font-medium text-sys-text-secondary">
                              Насиченість
                            </label>
                            <span className="ui-mono-slot font-semibold text-sys-text-primary">
                              {visualConfig.customSaturation}%
                            </span>
                          </div>
                          <input
                            id={satInputId}
                            type="range"
                            min={40}
                            max={95}
                            value={visualConfig.customSaturation}
                            aria-valuetext={`${visualConfig.customSaturation} відсотків`}
                            onChange={(e) => setVisualConfig({ customSaturation: Number(e.target.value) })}
                            className="studio-range"
                            style={
                              {
                                "--slider-progress": satProgress,
                                "--slider-fill-color": customPreview.swatchHex,
                              } as React.CSSProperties
                            }
                          />
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 pt-1">
                        <span className="text-[11px] text-sys-text-muted mr-1">Швидкі тони:</span>
                        {QUICK_CUSTOM_HUES.map((qh) => (
                          <button
                            key={qh.label}
                            type="button"
                            onClick={() =>
                              setVisualConfig({ customHue: qh.hue, customSaturation: qh.sat })
                            }
                            className="inline-flex items-center gap-1.5 rounded-lg border border-sys-border bg-sys-card px-2.5 py-1.5 text-xs font-medium text-sys-text-secondary hover:border-sys-accent/60 hover:text-sys-text-primary transition-colors cursor-pointer"
                          >
                            <span
                              aria-hidden="true"
                              className="h-2.5 w-2.5 rounded-full"
                              style={{ backgroundColor: `hsl(${qh.hue} ${qh.sat}% 52%)` }}
                            />
                            {qh.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Tab 3: Surface Material */}
              {activeTab === "surface" && (
                <div
                  key="tab-surface"
                  data-slide-dir={hasSwitchedTab ? tabSlideDir : undefined}
                  className={`${hasSwitchedTab ? "guide-step-slide " : ""}space-y-3`}
                  role="tabpanel"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {SURFACE_OPTIONS.map((opt) => {
                      const active = visualConfig.surface === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          aria-pressed={active}
                          onClick={() => setVisualConfig({ surface: opt.id })}
                          className={`flex items-start gap-3 rounded-xl border p-3.5 text-left transition-colors cursor-pointer ${
                            active
                              ? "border-sys-accent bg-sys-accent/12 ring-1 ring-sys-accent/35"
                              : "border-sys-border bg-sys-bg hover:border-sys-elevated-border"
                          }`}
                        >
                          <div
                            aria-hidden="true"
                            className={`h-11 w-11 shrink-0 rounded-lg flex items-center justify-center ${
                              opt.id === "oled"
                                ? resolvedTheme === "dark"
                                  ? "bg-black border border-sys-border"
                                  : "bg-white border border-sys-border"
                                : opt.id === "glass"
                                  ? "bg-sys-card/70 border border-sys-accent/40 backdrop-blur-sm"
                                  : opt.id === "outline"
                                    ? "bg-sys-card border-2 border-sys-elevated-border"
                                    : "bg-sys-card border border-sys-border shadow-xs"
                            }`}
                          >
                            <span className="h-2.5 w-5 rounded-sm bg-sys-accent/70" />
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-bold text-sys-text-primary">{opt.label}</div>
                            <div className="text-xs text-sys-text-secondary mt-0.5 leading-snug">
                              {opt.hint}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {visualConfig.surface === "glass" && visualConfig.backdrop === "none" && (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sys-border bg-sys-bg p-3 text-xs text-sys-text-secondary">
                      <span>
                        З фоном або власними шпалерами «Матове скло» виглядає ще ефектніше.
                      </span>
                      <button
                        type="button"
                        onClick={() => setVisualConfig({ backdrop: "aurora" })}
                        className="shrink-0 rounded-lg bg-sys-accent/15 border border-sys-accent/30 px-2.5 py-1 font-semibold text-sys-accent hover:bg-sys-accent/25 transition-colors cursor-pointer"
                      >
                        Увімкнути Аврору
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Tab 4: Backdrop & Custom Wallpaper */}
              {activeTab === "backdrop" && (
                <div
                  key="tab-backdrop"
                  data-slide-dir={hasSwitchedTab ? tabSlideDir : undefined}
                  className={`${hasSwitchedTab ? "guide-step-slide " : ""}space-y-4`}
                  role="tabpanel"
                >
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                    {BACKDROP_OPTIONS.map((opt) => {
                      const active = visualConfig.backdrop === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          aria-pressed={active}
                          onClick={() => {
                            if (opt.id === "custom" && !wallpaperMeta?.hasCustom) {
                              fileInputRef.current?.click();
                              return;
                            }
                            setVisualConfig({ backdrop: opt.id });
                          }}
                          className={`flex flex-col gap-2 rounded-xl border p-2.5 text-left transition-colors cursor-pointer ${
                            active
                              ? "border-sys-accent bg-sys-accent/12 ring-1 ring-sys-accent/35"
                              : "border-sys-border bg-sys-bg hover:border-sys-elevated-border"
                          }`}
                        >
                          <div
                            aria-hidden="true"
                            className="relative h-14 w-full overflow-hidden rounded-lg border border-sys-border bg-sys-bg"
                          >
                            {opt.id === "aurora" && (
                              <div
                                className="absolute inset-0"
                                style={{
                                  background:
                                    "radial-gradient(circle at 22% 28%, rgb(var(--sys-accent) / 0.45), transparent 60%), radial-gradient(circle at 82% 72%, rgb(var(--sys-info) / 0.35), transparent 58%)",
                                }}
                              />
                            )}
                            {opt.id === "dots" && (
                              <div className="app-backdrop-dots absolute inset-0 opacity-90" />
                            )}
                            {opt.id === "blueprint" && (
                              <div className="app-backdrop-blueprint absolute inset-0 opacity-90" />
                            )}
                            {opt.id === "silk" && (
                              <div className="app-backdrop-silk-gradient absolute inset-0" />
                            )}
                            {opt.id === "custom" && (previewBlobUrl || wallpaperMeta?.tinyPlaceholder) && (
                              <img
                                src={previewBlobUrl || wallpaperMeta?.tinyPlaceholder || ""}
                                alt=""
                                className="h-full w-full object-cover"
                              />
                            )}
                            {opt.id === "custom" && !previewBlobUrl && !wallpaperMeta?.tinyPlaceholder && (
                              <div className="flex h-full w-full items-center justify-center text-xs font-medium text-sys-text-muted">
                                + Фото
                              </div>
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-sys-text-primary">
                              {opt.label}
                            </div>
                            <div className="text-[11px] text-sys-text-secondary leading-tight mt-0.5">
                              {opt.hint}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {/* Custom Photo Controls */}
                  <div className="rounded-xl border border-sys-border bg-sys-bg p-3.5 space-y-3">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handlePhotoSelected}
                      className="sr-only"
                    />

                    <div className="flex flex-wrap items-center justify-between gap-2.5">
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-sys-text-primary">
                          Власні шпалери (PNG, JPG, WebP)
                        </div>
                        <div className="text-[11px] text-sys-text-secondary mt-0.5">
                          Зберігається лише у вашому браузері (до 20 МБ).
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={uploadingPhoto}
                          onClick={() => fileInputRef.current?.click()}
                          className="min-h-[38px] inline-flex items-center rounded-xl bg-sys-accentSolid px-3.5 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60 transition-opacity cursor-pointer"
                        >
                          {uploadingPhoto
                            ? "Оптимізація…"
                            : wallpaperMeta?.hasCustom
                              ? "Замінити фото"
                              : "Обрати фото"}
                        </button>

                        {wallpaperMeta?.hasCustom && (
                          <button
                            type="button"
                            onClick={handleRemovePhoto}
                            className="min-h-[38px] inline-flex items-center rounded-xl border border-sys-border bg-sys-card px-3.5 py-1.5 text-xs font-semibold text-rose-700 dark:text-rose-300 hover:border-rose-500/50 transition-colors cursor-pointer"
                          >
                            Видалити
                          </button>
                        )}
                      </div>
                    </div>

                    {photoFeedback && (
                      <p
                        role="status"
                        className={`text-xs font-medium ${
                          photoFeedback.kind === "err"
                            ? "text-rose-700 dark:text-rose-300"
                            : "text-emerald-700 dark:text-emerald-300"
                        }`}
                      >
                        {photoFeedback.text}
                      </p>
                    )}

                    <div
                      className="grid-accordion"
                      data-open={
                        visualConfig.backdrop === "custom" || Boolean(wallpaperMeta?.hasCustom)
                          ? "true"
                          : "false"
                      }
                      aria-hidden={
                        visualConfig.backdrop === "custom" || Boolean(wallpaperMeta?.hasCustom)
                          ? undefined
                          : true
                      }
                    >
                      <div className="grid-accordion-inner">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-2 border-t border-sys-border/60">
                        <div>
                          <div className="flex items-center justify-between text-xs mb-1">
                            <label htmlFor={blurInputId} className="font-medium text-sys-text-secondary">
                              Розмиття фото
                            </label>
                            <span className="ui-mono-slot font-semibold text-sys-text-primary">
                              {visualConfig.wallpaperBlur} px
                            </span>
                          </div>
                          <input
                            id={blurInputId}
                            type="range"
                            min={0}
                            max={24}
                            value={visualConfig.wallpaperBlur}
                            aria-valuetext={`${visualConfig.wallpaperBlur} пікселів`}
                            onChange={(e) => setVisualConfig({ wallpaperBlur: Number(e.target.value) })}
                            className="studio-range"
                            style={{ "--slider-progress": blurProgress } as React.CSSProperties}
                          />
                        </div>

                        <div>
                          <div className="flex items-center justify-between text-xs mb-1">
                            <label htmlFor={dimInputId} className="font-medium text-sys-text-secondary">
                              Затемнення / Вуаль
                            </label>
                            <span className="ui-mono-slot font-semibold text-sys-text-primary">
                              {visualConfig.wallpaperDim}%
                            </span>
                          </div>
                          <input
                            id={dimInputId}
                            type="range"
                            min={10}
                            max={85}
                            value={visualConfig.wallpaperDim}
                            aria-valuetext={`${visualConfig.wallpaperDim} відсотків`}
                            onChange={(e) => setVisualConfig({ wallpaperDim: Number(e.target.value) })}
                            className="studio-range"
                            style={{ "--slider-progress": dimProgress } as React.CSSProperties}
                          />
                        </div>
                      </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Tab 5: Typography, Radius, Density & Share Code */}
              {activeTab === "layout" && (
                <div
                  key="tab-layout"
                  data-slide-dir={hasSwitchedTab ? tabSlideDir : undefined}
                  className={`${hasSwitchedTab ? "guide-step-slide " : ""}space-y-4`}
                  role="tabpanel"
                >
                  {/* Font Preset */}
                  <div className="space-y-2">
                    <span className="block text-xs font-semibold text-sys-text-secondary">
                      Шрифт інтерфейсу
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {FONT_OPTIONS.map((opt) => {
                        const active = visualConfig.fontPreset === opt.id;
                        const sampleFamily =
                          opt.id === "tech"
                            ? "var(--font-jetbrains-mono), monospace"
                            : opt.id === "soft"
                              ? "var(--font-rubik), sans-serif"
                              : "var(--font-inter), sans-serif";
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            aria-pressed={active}
                            onClick={() => setVisualConfig({ fontPreset: opt.id })}
                            className={`flex items-center justify-between gap-2 rounded-xl border p-3 text-left transition-colors cursor-pointer ${
                              active
                                ? "border-sys-accent bg-sys-accent/12 ring-1 ring-sys-accent/35"
                                : "border-sys-border bg-sys-bg hover:border-sys-elevated-border"
                            }`}
                          >
                            <div className="min-w-0">
                              <div className="text-xs font-bold text-sys-text-primary">{opt.label}</div>
                              <div className="text-[11px] text-sys-text-secondary mt-0.5 leading-tight">
                                {opt.hint}
                              </div>
                            </div>
                            <span
                              aria-hidden="true"
                              className="shrink-0 rounded-lg border border-sys-border bg-sys-card px-2 py-1 text-xs font-bold text-sys-text-primary"
                              style={{ fontFamily: sampleFamily }}
                            >
                              {opt.sample}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Radius & Density */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <span className="block text-xs font-semibold text-sys-text-secondary">
                        Скруглення кутів
                      </span>
                      <div className="grid grid-cols-3 gap-2">
                        {RADIUS_OPTIONS.map((opt) => {
                          const active = visualConfig.radius === opt.id;
                          return (
                            <button
                              key={opt.id}
                              type="button"
                              aria-pressed={active}
                              onClick={() => setVisualConfig({ radius: opt.id })}
                              className={`flex flex-col items-center gap-1.5 rounded-xl border p-2.5 text-center transition-colors cursor-pointer ${
                                active
                                  ? "border-sys-accent bg-sys-accent/12 ring-1 ring-sys-accent/35"
                                  : "border-sys-border bg-sys-bg hover:border-sys-elevated-border"
                              }`}
                            >
                              <span
                                aria-hidden="true"
                                className="h-5 w-7 border-2 border-sys-accent bg-sys-accent/15"
                                style={{
                                  borderRadius:
                                    opt.id === "sharp" ? "4px" : opt.id === "soft" ? "12px" : "8px",
                                }}
                              />
                              <span className="text-xs font-bold text-sys-text-primary">{opt.label}</span>
                              <span className="ui-mono-slot text-[10px] text-sys-text-muted">
                                {opt.pxHint}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <span className="block text-xs font-semibold text-sys-text-secondary">
                        Щільність карток
                      </span>
                      <div className="grid grid-cols-3 gap-2">
                        {DENSITY_OPTIONS.map((opt) => {
                          const active = visualConfig.density === opt.id;
                          return (
                            <button
                              key={opt.id}
                              type="button"
                              aria-pressed={active}
                              onClick={() => setVisualConfig({ density: opt.id })}
                              className={`flex flex-col justify-center gap-1 rounded-xl border p-2.5 text-left transition-colors cursor-pointer ${
                                active
                                  ? "border-sys-accent bg-sys-accent/12 ring-1 ring-sys-accent/35"
                                  : "border-sys-border bg-sys-bg hover:border-sys-elevated-border"
                              }`}
                            >
                              <span className="text-xs font-bold text-sys-text-primary">{opt.label}</span>
                              <span className="text-[10px] text-sys-text-secondary leading-tight">
                                {opt.hint}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Theme Share Code */}
                  <div className="space-y-3 pt-2 border-t border-sys-border/70">
                    <div className="rounded-xl border border-sys-border bg-sys-bg p-3.5 space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-sys-text-primary">
                          Ваш код оформлення
                        </span>
                        {copyFeedback && (
                          <span role="status" className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                            {copyFeedback}
                          </span>
                        )}
                      </div>

                      <div className="flex flex-col sm:flex-row gap-2">
                        <code className="ui-mono-slot flex-1 rounded-xl border border-sys-border bg-sys-card px-3 py-2 text-xs font-semibold text-sys-text-primary select-all break-all">
                          {shareResult.code}
                        </code>
                        <button
                          type="button"
                          onClick={handleCopyShareCode}
                          className="shrink-0 min-h-[38px] rounded-xl bg-sys-accentSolid px-4 py-2 text-xs font-semibold text-white hover:opacity-90 transition-opacity cursor-pointer"
                        >
                          Копіювати
                        </button>
                      </div>

                      {shareResult.droppedCustomWallpaper && (
                        <p className="text-[11px] text-sys-text-secondary">
                          Власне фото зберігається лише локально, тому в коді воно замінено на «Північне сяйво».
                        </p>
                      )}
                    </div>

                    <form onSubmit={handleImportSubmit} className="rounded-xl border border-sys-border bg-sys-bg p-3.5 space-y-2">
                      <label htmlFor={importInputId} className="block text-xs font-bold text-sys-text-primary">
                        Застосувати чужий код теми
                      </label>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <input
                          id={importInputId}
                          type="text"
                          value={importCode}
                          onChange={(e) => {
                            setImportCode(e.target.value);
                            if (importFeedback) setImportFeedback(null);
                          }}
                          placeholder="DFKR1.glass.aurora.tech.soft.default.cyan"
                          className="ui-mono-slot flex-1 rounded-xl border border-sys-border bg-sys-card px-3 py-2 text-xs text-sys-text-primary placeholder:text-sys-text-muted focus:outline-none focus:border-sys-accent"
                        />
                        <button
                          type="submit"
                          className="shrink-0 min-h-[38px] rounded-xl border border-sys-border bg-sys-card px-4 py-2 text-xs font-semibold text-sys-text-primary hover:border-sys-accent/60 transition-colors cursor-pointer"
                        >
                          Застосувати
                        </button>
                      </div>
                      {importFeedback && (
                        <p
                          role="status"
                          className={`text-xs font-medium ${
                            importFeedback.kind === "err"
                              ? "text-rose-700 dark:text-rose-300"
                              : "text-emerald-700 dark:text-emerald-300"
                          }`}
                        >
                          {importFeedback.text}
                        </p>
                      )}
                    </form>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </AppDialog>
  );
}
