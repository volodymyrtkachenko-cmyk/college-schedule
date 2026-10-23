"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useTheme } from "../lib/useTheme";

interface SplashScreenProps {
  isLoading: boolean;
  minDurationMs?: number;
}

/**
 * Lightweight, hardware-accelerated PWA splash screen.
 * - Displays on initial app boot for a smooth, intentional duration (default: 850ms).
 * - Adapts seamlessly to user's active theme (dark / light) to prevent color flashes.
 * - Zero heavy blur filters or dynamic box-shadow recalculations to protect mobile CPU/battery.
 * - Hardware-accelerated CSS compositor transforms for the progress indicator.
 * - Once dismissed on initial load, remains unmounted throughout the session.
 */
export function SplashScreen({ isLoading, minDurationMs = 850 }: SplashScreenProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const [isDismissed, setIsDismissed] = useState(false);
  const [isFadingOut, setIsFadingOut] = useState(false);
  const [minTimeElapsed, setMinTimeElapsed] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setMinTimeElapsed(true);
    }, minDurationMs);
    return () => clearTimeout(timer);
  }, [minDurationMs]);

  useEffect(() => {
    // Dismiss once minimum display time has passed AND initial data loading is finished
    if (minTimeElapsed && !isLoading && !isFadingOut && !isDismissed) {
      setIsFadingOut(true);
      const dismissTimer = setTimeout(() => {
        setIsDismissed(true);
      }, 320);
      return () => clearTimeout(dismissTimer);
    }
  }, [minTimeElapsed, isLoading, isFadingOut, isDismissed]);

  if (isDismissed) {
    return null;
  }

  return (
    <div
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center select-none transition-opacity duration-300 ease-out will-change-[opacity] ${
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
            className={`text-xs sm:text-sm font-medium tracking-wide max-w-xs ${
              isDark ? "text-slate-400" : "text-slate-500"
            }`}
          >
            Фаховий коледж електронних приладів
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
