"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useTheme } from "../lib/useTheme";

interface SplashScreenProps {
  isLoading: boolean;
}

/**
 * Lightweight, hardware-accelerated PWA splash screen.
 * - Displays only if initial data loading takes longer than 150ms.
 * - Closes immediately without flash if data is already cached / fast (<150ms).
 * - Smooth hardware-accelerated fade-out in <= 200ms once data is loaded.
 * - Adapts seamlessly to user's active theme (dark / light).
 */
export function SplashScreen({ isLoading }: SplashScreenProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const [isDismissed, setIsDismissed] = useState(!isLoading);
  const [isVisible, setIsVisible] = useState(false);
  const [isFadingOut, setIsFadingOut] = useState(false);

  useEffect(() => {
    if (isDismissed) return;

    // If initial loading finishes quickly (<150ms), never show splash screen
    if (!isLoading && !isVisible) {
      setIsDismissed(true);
      return;
    }

    // If loading is still going after 150ms, show the splash screen
    const thresholdTimer = setTimeout(() => {
      if (isLoading) {
        setIsVisible(true);
      } else {
        setIsDismissed(true);
      }
    }, 150);

    return () => clearTimeout(thresholdTimer);
  }, [isLoading, isVisible, isDismissed]);

  useEffect(() => {
    // If visible and loading finishes, fade out quickly in 200ms
    if (isVisible && !isLoading && !isFadingOut && !isDismissed) {
      setIsFadingOut(true);
      const dismissTimer = setTimeout(() => {
        setIsDismissed(true);
      }, 200);
      return () => clearTimeout(dismissTimer);
    }
  }, [isVisible, isLoading, isFadingOut, isDismissed]);

  if (isDismissed || !isVisible) {
    return null;
  }

  return (
    <div
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center select-none transition-opacity duration-200 ease-smooth will-change-[opacity] ${
        isDark ? "bg-[#0a0d14] text-white" : "bg-[#f8fafc] text-slate-900"
      } ${isFadingOut ? "opacity-0 pointer-events-none" : "opacity-100 pointer-events-auto"}`}
      aria-label="Завантаження розкладу"
      role="status"
    >
      {/* Static ambient radial background — lightweight, hardware-composited without blur */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: isDark
            ? "radial-gradient(circle at 50% 45%, rgba(56, 189, 248, 0.08) 0%, rgba(99, 102, 241, 0.04) 40%, transparent 70%)"
            : "radial-gradient(circle at 50% 45%, rgba(56, 189, 248, 0.12) 0%, rgba(99, 102, 241, 0.05) 40%, transparent 70%)",
        }}
      />

      {/* Central Content */}
      <div className="relative z-10 flex flex-col items-center px-6 text-center">
        {/* Modern App Icon Frame */}
        <div className="relative mb-6">
          {/* Subtle static gradient accent border */}
          <div
            className={`absolute -inset-1 rounded-[28px] pointer-events-none ${
              isDark
                ? "bg-gradient-to-tr from-sky-500/20 via-cyan-400/10 to-indigo-500/20"
                : "bg-gradient-to-tr from-sky-500/25 via-cyan-400/20 to-indigo-500/25"
            }`}
          />

          {/* Squircle Icon Container */}
          <div
            className={`relative h-24 w-24 sm:h-28 sm:w-28 overflow-hidden rounded-[26px] p-1.5 transition-colors ${
              isDark
                ? "border border-sky-400/25 bg-[#0f1422] shadow-2xl shadow-black/70 ring-1 ring-white/10"
                : "border border-sky-300/40 bg-white shadow-xl shadow-slate-300/50 ring-1 ring-slate-900/5"
            }`}
          >
            <Image
              src="/icon-192.png"
              alt="ДФКР Розклад"
              width={112}
              height={112}
              priority
              className="h-full w-full object-cover rounded-[20px]"
            />
          </div>
        </div>

        {/* Brand Title */}
        <div className="space-y-1.5 mb-8">
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight flex items-center justify-center gap-2">
            <span className={isDark ? "text-white" : "text-slate-900"}>ДФКР</span>
            <span
              className={
                isDark
                  ? "bg-gradient-to-r from-sky-400 via-cyan-300 to-indigo-400 bg-clip-text text-transparent"
                  : "bg-gradient-to-r from-sky-600 via-cyan-600 to-indigo-600 bg-clip-text text-transparent"
              }
            >
              Розклад
            </span>
          </h1>
          <p
            className={`text-xs sm:text-sm font-medium tracking-wide max-w-[280px] sm:max-w-sm ${
              isDark ? "text-slate-400" : "text-slate-500"
            }`}
          >
            Дніпровський Фаховий коледж радіоелектроніки
          </p>
        </div>

        {/* Ultra-lightweight Hardware-Accelerated Progress Track */}
        <div
          className={`relative h-1 w-36 sm:w-44 overflow-hidden rounded-full ${
            isDark ? "bg-slate-800/80 ring-1 ring-white/5" : "bg-slate-200 ring-1 ring-slate-900/5"
          }`}
        >
          <div
            className={`absolute inset-y-0 w-1/2 rounded-full animate-splash-beam ${
              isDark
                ? "bg-gradient-to-r from-sky-500 via-cyan-300 to-indigo-500"
                : "bg-gradient-to-r from-sky-500 via-cyan-500 to-indigo-600"
            }`}
          />
        </div>
      </div>
    </div>
  );
}
