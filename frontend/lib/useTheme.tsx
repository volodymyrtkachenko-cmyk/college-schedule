"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export type AccentColor = "blue" | "emerald" | "violet" | "amber" | "rose" | "cyan";

export interface AccentOption {
  id: AccentColor;
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
    darkCardHex: "#101829",
    lightBgHex: "#f2f6fd",
    lightCardHex: "#dbeafe",
    dotBg: "bg-blue-500",
  },
  {
    id: "emerald",
    label: "Смарагд",
    colorHex: "#10b981",
    darkBgHex: "#06120e",
    darkCardHex: "#0d1f19",
    lightBgHex: "#f0faf5",
    lightCardHex: "#d1fae5",
    dotBg: "bg-emerald-500",
  },
  {
    id: "violet",
    label: "Аметист",
    colorHex: "#a855f7",
    darkBgHex: "#0e0918",
    darkCardHex: "#181129",
    lightBgHex: "#f6f3ff",
    lightCardHex: "#e9d5ff",
    dotBg: "bg-purple-500",
  },
  {
    id: "amber",
    label: "Бурштин",
    colorHex: "#f59e0b",
    darkBgHex: "#130e07",
    darkCardHex: "#21190d",
    lightBgHex: "#fdf8ee",
    lightCardHex: "#fee6b2",
    dotBg: "bg-amber-500",
  },
  {
    id: "rose",
    label: "Сакура",
    colorHex: "#f43f5e",
    darkBgHex: "#14080e",
    darkCardHex: "#24101a",
    lightBgHex: "#fdf2f5",
    lightCardHex: "#fecdd3",
    dotBg: "bg-rose-500",
  },
  {
    id: "cyan",
    label: "Лагуна",
    colorHex: "#06b6d4",
    darkBgHex: "#061117",
    darkCardHex: "#0c1e26",
    lightBgHex: "#eef9fb",
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
}

const ThemeContext = createContext<ThemeContextType | null>(null);

const STORAGE_KEY = "college_theme";
const ACCENT_STORAGE_KEY = "college_accent";

function getInitialAccent(): AccentColor {
  if (typeof window === "undefined") return "blue";
  try {
    const stored = localStorage.getItem(ACCENT_STORAGE_KEY) as AccentColor | null;
    return stored && ["blue", "emerald", "violet", "amber", "rose", "cyan"].includes(stored)
      ? stored
      : "blue";
  } catch {
    return "blue";
  }
}

function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "system";
  try {
    const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
    return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
  } catch {
    return "system";
  }
}

function getInitialResolvedTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "dark";
  try {
    const docAttr = document.documentElement.getAttribute("data-theme") as ResolvedTheme | null;
    if (docAttr === "light" || docAttr === "dark") return docAttr;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "dark";
  }
}

function syncMetaThemeColor(effectiveTheme: ResolvedTheme, activeAccent: AccentColor) {
  if (typeof document === "undefined") return;
  const opt = ACCENT_OPTIONS.find((o) => o.id === activeAccent) ?? ACCENT_OPTIONS[0];
  const bgHex = effectiveTheme === "dark" ? opt.darkBgHex : opt.lightBgHex;
  const metas = document.querySelectorAll('meta[name="theme-color"]');
  metas.forEach((meta) => meta.setAttribute("content", bgHex));
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(getInitialResolvedTheme);
  const [accent, setAccentState] = useState<AccentColor>(getInitialAccent);

  const applyAccent = useCallback((newAccent: AccentColor) => {
    setAccentState(newAccent);
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-accent", newAccent);
      const currentResolved =
        (document.documentElement.getAttribute("data-theme") as ResolvedTheme) || "dark";
      syncMetaThemeColor(currentResolved, newAccent);
    }
  }, []);

  const setAccent = useCallback((newAccent: AccentColor) => {
    applyAccent(newAccent);
    try {
      localStorage.setItem(ACCENT_STORAGE_KEY, newAccent);
    } catch {}
  }, [applyAccent]);

  const applyTheme = useCallback((targetTheme: Theme) => {
    let effective: ResolvedTheme = "dark";
    if (targetTheme === "system") {
      const isDark = typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
      effective = isDark ? "dark" : "light";
    } else {
      effective = targetTheme;
    }

    setResolvedTheme(effective);

    if (typeof document !== "undefined") {
      const root = document.documentElement;
      root.classList.remove("dark", "light");
      root.classList.add(effective);
      root.setAttribute("data-theme", effective);

      const currentAccent = (root.getAttribute("data-accent") as AccentColor) || getInitialAccent();
      syncMetaThemeColor(effective, currentAccent);
    }
  }, []);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
      const initialTheme: Theme = stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
      setThemeState(initialTheme);
      applyTheme(initialTheme);
    } catch {
      applyTheme("system");
    }

    try {
      const storedAccent = localStorage.getItem(ACCENT_STORAGE_KEY) as AccentColor | null;
      const initialAccent: AccentColor =
        storedAccent && ["blue", "emerald", "violet", "amber", "rose", "cyan"].includes(storedAccent)
          ? storedAccent
          : "blue";
      applyAccent(initialAccent);
    } catch {
      applyAccent("blue");
    }

    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      const currentStored = localStorage.getItem(STORAGE_KEY) as Theme | null;
      if (!currentStored || currentStored === "system") {
        applyTheme("system");
      }
    };
    mql.addEventListener("change", handleChange);
    return () => mql.removeEventListener("change", handleChange);
  }, [applyTheme, applyAccent]);

  const setTheme = useCallback(
    (newTheme: Theme) => {
      setThemeState(newTheme);
      try {
        localStorage.setItem(STORAGE_KEY, newTheme);
      } catch {}

      const isReduced =
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const hasViewTransition =
        typeof document !== "undefined" &&
        "startViewTransition" in document &&
        typeof (document as any).startViewTransition === "function";

      if (hasViewTransition && !isReduced) {
        (document as any).startViewTransition(() => {
          applyTheme(newTheme);
        });
      } else {
        applyTheme(newTheme);
      }
    },
    [applyTheme]
  );

  const toggleTheme = useCallback(() => {
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  }, [resolvedTheme, setTheme]);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme, toggleTheme, accent, setAccent }}>
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
    };
  }
  return ctx;
}
