"use client";

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { flushSync } from "react-dom";
import { startTypedViewTransition } from "@/lib/viewTransition";
import {
  type AccentSelection,
  type BaseThemeMode,
  type CuratedStylePreset,
  type ResolvedThemeMode,
  type StockAccentColor,
  type VisualStudioConfig,
  CURATED_STYLE_PRESETS,
  CUSTOM_CSS_VAR_KEYS,
  DEFAULT_VISUAL_CONFIG,
  VISUAL_CHANGE_EVENT,
  VISUAL_CUSTOM_VARS_STORAGE_KEY,
  VISUAL_STUDIO_STORAGE_KEY,
  buildCustomAccentVars,
  sanitizeVisualConfig,
} from "@/lib/visualStudio";

export type Theme = BaseThemeMode;
export type ResolvedTheme = ResolvedThemeMode;
export type AccentColor = AccentSelection;

export interface AccentOption {
  id: StockAccentColor;
  label: string;
  colorHex: string;
  darkBgHex: string;
  darkCardHex: string;
  lightBgHex: string;
  lightCardHex: string;
  dotBg: string;
}

export const ACCENT_OPTIONS: AccentOption[] = [
  {
    id: "blue",
    label: "Океан",
    colorHex: "#3b82f6",
    darkBgHex: "#080d18",
    darkCardHex: "#111a2e",
    lightBgHex: "#eef4fc",
    lightCardHex: "#dbeafe",
    dotBg: "bg-blue-500",
  },
  {
    id: "emerald",
    label: "Смарагд",
    colorHex: "#10b981",
    darkBgHex: "#06120e",
    darkCardHex: "#0d211a",
    lightBgHex: "#ebf7f1",
    lightCardHex: "#d1fae5",
    dotBg: "bg-emerald-500",
  },
  {
    id: "violet",
    label: "Аметист",
    colorHex: "#a855f7",
    darkBgHex: "#0d0917",
    darkCardHex: "#17112b",
    lightBgHex: "#f3effe",
    lightCardHex: "#e9d5ff",
    dotBg: "bg-purple-500",
  },
  {
    id: "amber",
    label: "Бурштин",
    colorHex: "#f59e0b",
    darkBgHex: "#120d06",
    darkCardHex: "#21180b",
    lightBgHex: "#fbf4e6",
    lightCardHex: "#fde0a1",
    dotBg: "bg-amber-500",
  },
  {
    id: "rose",
    label: "Сакура",
    colorHex: "#f43f5e",
    darkBgHex: "#13080d",
    darkCardHex: "#24101a",
    lightBgHex: "#fbeef2",
    lightCardHex: "#fecdd3",
    dotBg: "bg-rose-500",
  },
  {
    id: "cyan",
    label: "Лагуна",
    colorHex: "#06b6d4",
    darkBgHex: "#061117",
    darkCardHex: "#0c202b",
    lightBgHex: "#eaf6f9",
    lightCardHex: "#cffafe",
    dotBg: "bg-cyan-500",
  },
];

interface ThemeContextType {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  accent: AccentColor;
  setAccent: (accent: AccentColor) => void;
  visualConfig: VisualStudioConfig;
  setVisualConfig: (patch: Partial<VisualStudioConfig>) => void;
  applyCuratedPreset: (preset: CuratedStylePreset) => void;
  applyThemeBundle: (nextAccent: AccentColor, patch: Partial<VisualStudioConfig>) => void;
  resetVisualStudio: () => void;
  wallpaperVersion: number;
  bumpWallpaperVersion: () => void;
}

const ThemeContext = createContext<ThemeContextType | null>(null);

const STORAGE_KEY = "college_theme";
const ACCENT_STORAGE_KEY = "college_accent";

function isValidAccent(value: unknown): value is AccentColor {
  return (
    value === "custom" ||
    ACCENT_OPTIONS.some((opt) => opt.id === value)
  );
}

function getInitialAccent(): AccentColor {
  if (typeof window === "undefined") return "blue";
  try {
    const stored = localStorage.getItem(ACCENT_STORAGE_KEY);
    return isValidAccent(stored) ? stored : "blue";
  } catch {
    return "blue";
  }
}

function getInitialVisualConfig(): VisualStudioConfig {
  if (typeof window === "undefined") return { ...DEFAULT_VISUAL_CONFIG };
  try {
    const raw = localStorage.getItem(VISUAL_STUDIO_STORAGE_KEY);
    return raw ? sanitizeVisualConfig(JSON.parse(raw)) : { ...DEFAULT_VISUAL_CONFIG };
  } catch {
    return { ...DEFAULT_VISUAL_CONFIG };
  }
}

function syncMetaThemeColor(
  effectiveTheme: ResolvedTheme,
  activeAccent: AccentColor,
  config: VisualStudioConfig,
  customBgHex?: string
) {
  if (typeof document === "undefined") return;
  let bgHex: string;
  if (config.surface === "oled") {
    bgHex = effectiveTheme === "dark" ? "#000000" : "#ffffff";
  } else if (activeAccent === "custom" && customBgHex) {
    bgHex = customBgHex;
  } else {
    const opt = ACCENT_OPTIONS.find((o) => o.id === activeAccent) ?? ACCENT_OPTIONS[0];
    bgHex = effectiveTheme === "dark" ? opt.darkBgHex : opt.lightBgHex;
  }
  const metas = document.querySelectorAll('meta[name="theme-color"]');
  metas.forEach((meta) => meta.setAttribute("content", bgHex));
}

function removeTransitionBlockers() {
  if (typeof document === "undefined") return;
  document
    .querySelectorAll('style[data-theme-transition-blocker="true"]')
    .forEach((node) => {
      try {
        node.remove();
      } catch {}
    });
}

function injectTransitionBlocker(): () => void {
  if (typeof document === "undefined") return () => {};
  removeTransitionBlockers();
  const css = document.createElement("style");
  css.setAttribute("data-theme-transition-blocker", "true");
  css.appendChild(
    document.createTextNode(`*, *::before, *::after { transition: none !important; }`)
  );
  document.head.appendChild(css);
  return () => {
    try {
      if (css.isConnected) css.remove();
    } catch {}
  };
}

function disableTransitionsTemporarily() {
  if (typeof document === "undefined") return;
  const cleanup = injectTransitionBlocker();
  void window.getComputedStyle(document.body).opacity;
  requestAnimationFrame(() => {
    requestAnimationFrame(cleanup);
  });
}

function applyDomState(
  effectiveTheme: ResolvedTheme,
  activeAccent: AccentColor,
  config: VisualStudioConfig
) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.remove("dark", "light");
  root.classList.add(effectiveTheme);
  root.setAttribute("data-theme", effectiveTheme);
  root.setAttribute("data-accent", activeAccent);
  root.setAttribute("data-surface", config.surface);
  root.setAttribute("data-backdrop", config.backdrop);
  root.setAttribute("data-font-preset", config.fontPreset);
  root.setAttribute("data-radius", config.radius);
  root.setAttribute("data-density", config.density);

  root.style.setProperty("--backdrop-blur", `${config.wallpaperBlur}px`);
  root.style.setProperty("--backdrop-dim", (config.wallpaperDim / 100).toFixed(2));
  if (config.wallpaperTint) {
    root.style.setProperty("--backdrop-tint", config.wallpaperTint);
  } else {
    root.style.removeProperty("--backdrop-tint");
  }

  let customBgHex: string | undefined;
  if (activeAccent === "custom") {
    const darkBundle = buildCustomAccentVars(
      config.customHue,
      config.customSaturation,
      "dark",
      config.surface
    );
    const lightBundle = buildCustomAccentVars(
      config.customHue,
      config.customSaturation,
      "light",
      config.surface
    );
    const activeBundle = effectiveTheme === "dark" ? darkBundle : lightBundle;
    customBgHex = activeBundle.bgHex;

    for (const [varKey, varValue] of Object.entries(activeBundle.vars)) {
      root.style.setProperty(varKey, varValue);
    }

    try {
      localStorage.setItem(
        VISUAL_CUSTOM_VARS_STORAGE_KEY,
        JSON.stringify({
          dark: darkBundle.vars,
          light: lightBundle.vars,
          darkBgHex: darkBundle.bgHex,
          lightBgHex: lightBundle.bgHex,
        })
      );
    } catch {}
  } else {
    for (const key of CUSTOM_CSS_VAR_KEYS) {
      root.style.removeProperty(key);
    }
    try {
      localStorage.removeItem(VISUAL_CUSTOM_VARS_STORAGE_KEY);
    } catch {}
  }

  syncMetaThemeColor(effectiveTheme, activeAccent, config, customBgHex);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("system");
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>("dark");
  const [accent, setAccentState] = useState<AccentColor>("blue");
  const [visualConfig, setVisualConfigState] = useState<VisualStudioConfig>({
    ...DEFAULT_VISUAL_CONFIG,
  });
  const [wallpaperVersion, setWallpaperVersion] = useState(0);

  const stateRef = useRef({
    theme: "system" as Theme,
    resolvedTheme: "dark" as ResolvedTheme,
    accent: "blue" as AccentColor,
    visualConfig: { ...DEFAULT_VISUAL_CONFIG } as VisualStudioConfig,
  });

  const commitState = useCallback(
    (
      nextTheme: Theme,
      nextResolved: ResolvedTheme,
      nextAccent: AccentColor,
      nextConfig: VisualStudioConfig,
      options?: { suppressTransitions?: boolean; viewTransition?: boolean }
    ) => {
      const runReactStateCommit = () => {
        stateRef.current = {
          theme: nextTheme,
          resolvedTheme: nextResolved,
          accent: nextAccent,
          visualConfig: nextConfig,
        };
        setThemeState(nextTheme);
        setResolvedTheme(nextResolved);
        setAccentState(nextAccent);
        setVisualConfigState(nextConfig);
      };

      const isReduced =
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const hasViewTransition =
        typeof document !== "undefined" &&
        "startViewTransition" in document &&
        typeof (document as any).startViewTransition === "function";

      if (options?.viewTransition && hasViewTransition && !isReduced) {
        let removeBlocker: (() => void) | null = null;
        let failsafeTimer: number | null = null;
        const releaseBlocker = () => {
          if (failsafeTimer !== null) {
            window.clearTimeout(failsafeTimer);
            failsafeTimer = null;
          }
          removeBlocker?.();
          removeBlocker = null;
        };

        startTypedViewTransition(
          ["theme-change"],
          () => {
            removeBlocker = injectTransitionBlocker();
            failsafeTimer = window.setTimeout(releaseBlocker, 250);
            try {
              flushSync(runReactStateCommit);
            } catch {
              runReactStateCommit();
            }
            applyDomState(nextResolved, nextAccent, nextConfig);
            void window.getComputedStyle(document.documentElement).colorScheme;
            if (typeof window !== "undefined") {
              window.dispatchEvent(new CustomEvent(VISUAL_CHANGE_EVENT));
            }
          },
          {
            kind: "theme",
            onReady: releaseBlocker,
            onFinish: releaseBlocker,
          }
        );
        return;
      }

      runReactStateCommit();
      if (options?.suppressTransitions) {
        disableTransitionsTemporarily();
      }
      applyDomState(nextResolved, nextAccent, nextConfig);

      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent(VISUAL_CHANGE_EVENT));
      }
    },
    []
  );

  const resolveSystemTheme = useCallback((target: Theme): ResolvedTheme => {
    if (target === "system") {
      return typeof window !== "undefined" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    }
    return target;
  }, []);

  useEffect(() => {
    let initialTheme: Theme = "system";
    try {
      const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
      if (stored === "light" || stored === "dark" || stored === "system") {
        initialTheme = stored;
      }
    } catch {}

    const initialAccent = getInitialAccent();
    const initialConfig = getInitialVisualConfig();
    const effective = resolveSystemTheme(initialTheme);

    commitState(initialTheme, effective, initialAccent, initialConfig);

    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      const curr = stateRef.current;
      if (curr.theme === "system") {
        const nextResolved = mql.matches ? "dark" : "light";
        commitState("system", nextResolved, curr.accent, curr.visualConfig);
      }
    };
    mql.addEventListener("change", handleChange);
    return () => mql.removeEventListener("change", handleChange);
  }, [commitState, resolveSystemTheme]);

  const setTheme = useCallback(
    (newTheme: Theme) => {
      try {
        localStorage.setItem(STORAGE_KEY, newTheme);
      } catch {}
      const effective = resolveSystemTheme(newTheme);
      const curr = stateRef.current;
      const visualThemeChanged = effective !== curr.resolvedTheme;
      commitState(newTheme, effective, curr.accent, curr.visualConfig, {
        viewTransition: visualThemeChanged,
        suppressTransitions: visualThemeChanged,
      });
    },
    [commitState, resolveSystemTheme]
  );

  const toggleTheme = useCallback(() => {
    setTheme(stateRef.current.resolvedTheme === "dark" ? "light" : "dark");
  }, [setTheme]);

  const setAccent = useCallback(
    (newAccent: AccentColor) => {
      try {
        localStorage.setItem(ACCENT_STORAGE_KEY, newAccent);
      } catch {}
      const curr = stateRef.current;
      commitState(curr.theme, curr.resolvedTheme, newAccent, curr.visualConfig, {
        suppressTransitions: true,
      });
    },
    [commitState]
  );

  const setVisualConfig = useCallback(
    (patch: Partial<VisualStudioConfig>) => {
      const curr = stateRef.current;
      const merged = sanitizeVisualConfig({ ...curr.visualConfig, ...patch });
      try {
        localStorage.setItem(VISUAL_STUDIO_STORAGE_KEY, JSON.stringify(merged));
      } catch {}
      commitState(curr.theme, curr.resolvedTheme, curr.accent, merged, {
        suppressTransitions:
          patch.surface !== undefined ||
          patch.customHue !== undefined ||
          patch.customSaturation !== undefined,
      });
    },
    [commitState]
  );

  const applyThemeBundle = useCallback(
    (nextAccent: AccentColor, patch: Partial<VisualStudioConfig>) => {
      const curr = stateRef.current;
      const merged = sanitizeVisualConfig({ ...curr.visualConfig, ...patch });
      try {
        localStorage.setItem(ACCENT_STORAGE_KEY, nextAccent);
        localStorage.setItem(VISUAL_STUDIO_STORAGE_KEY, JSON.stringify(merged));
      } catch {}
      commitState(curr.theme, curr.resolvedTheme, nextAccent, merged, {
        suppressTransitions: true,
      });
    },
    [commitState]
  );

  const applyCuratedPreset = useCallback(
    (preset: CuratedStylePreset) => {
      applyThemeBundle(preset.accent, preset.config);
    },
    [applyThemeBundle]
  );

  const resetVisualStudio = useCallback(() => {
    const classic = CURATED_STYLE_PRESETS[0];
    applyThemeBundle(classic.accent, DEFAULT_VISUAL_CONFIG);
  }, [applyThemeBundle]);

  const bumpWallpaperVersion = useCallback(() => {
    setWallpaperVersion((prev) => prev + 1);
  }, []);

  return (
    <ThemeContext.Provider
      value={{
        theme,
        resolvedTheme,
        setTheme,
        toggleTheme,
        accent,
        setAccent,
        visualConfig,
        setVisualConfig,
        applyCuratedPreset,
        applyThemeBundle,
        resetVisualStudio,
        wallpaperVersion,
        bumpWallpaperVersion,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextType {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    return {
      theme: "dark",
      resolvedTheme: "dark",
      setTheme: () => {},
      toggleTheme: () => {},
      accent: "blue",
      setAccent: () => {},
      visualConfig: DEFAULT_VISUAL_CONFIG,
      setVisualConfig: () => {},
      applyCuratedPreset: () => {},
      applyThemeBundle: () => {},
      resetVisualStudio: () => {},
      wallpaperVersion: 0,
      bumpWallpaperVersion: () => {},
    };
  }
  return ctx;
}
