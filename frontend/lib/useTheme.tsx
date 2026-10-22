"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

interface ThemeContextType {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | null>(null);

const STORAGE_KEY = "college_theme";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("dark");
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>("dark");

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

      // Update meta theme-color for mobile browser address bar and PWA
      const metaThemeColor = document.querySelector('meta[name="theme-color"]');
      if (metaThemeColor) {
        metaThemeColor.setAttribute("content", effective === "dark" ? "#0a0d14" : "#f8fafc");
      }
    }
  }, []);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
      const initialTheme: Theme = stored === "light" || stored === "dark" || stored === "system" ? stored : "dark";
      setThemeState(initialTheme);
      applyTheme(initialTheme);
    } catch {
      applyTheme("dark");
    }

    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      const currentStored = localStorage.getItem(STORAGE_KEY) as Theme | null;
      if (currentStored === "system") {
        applyTheme("system");
      }
    };
    mql.addEventListener("change", handleChange);
    return () => mql.removeEventListener("change", handleChange);
  }, [applyTheme]);

  const setTheme = useCallback(
    (newTheme: Theme) => {
      setThemeState(newTheme);
      try {
        localStorage.setItem(STORAGE_KEY, newTheme);
      } catch {}

      if (typeof document !== "undefined") {
        const root = document.documentElement;
        root.classList.add("theme-transitioning");

        const update = () => {
          applyTheme(newTheme);
        };

        if ("startViewTransition" in document && typeof (document as any).startViewTransition === "function") {
          (document as any).startViewTransition(update);
        } else {
          update();
        }

        setTimeout(() => {
          root.classList.remove("theme-transitioning");
        }, 320);
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
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme, toggleTheme }}>
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
    };
  }
  return ctx;
}
