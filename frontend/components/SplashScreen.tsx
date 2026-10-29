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

  useEffect(() => {
    if (!isVisible || isDismissed) return;
    // Safety watchdog: never block the user on splash screen for more than 3.2s on weak connections
    const maxTimer = setTimeout(() => {
      setIsFadingOut(true);
      setTimeout(() => setIsDismissed(true), 200);
    }, 3200);
    return () => clearTimeout(maxTimer);
  }, [isVisible, isDismissed]);

  if (isDismissed || !isVisible) {
    return null;
  }

  return (
    <div
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center select-none transition-opacity duration-200 ease-smooth will-change-[opacity] bg-sys-bg text-sys-text-primary ${
        isFadingOut ? "opacity-0 pointer-events-none" : "opacity-100 pointer-events-auto"
      }`}
      aria-label="Завантаження розкладу"
      role="status"
    >
      {/* Static ambient radial background — lightweight, hardware-composited without blur */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: isDark
            ? "radial-gradient(circle at 50% 45%, rgb(var(--sys-accent) / 0.14) 0%, rgb(var(--sys-accent) / 0.04) 40%, transparent 70%)"
            : "radial-gradient(circle at 50% 45%, rgb(var(--sys-accent) / 0.16) 0%, rgb(var(--sys-accent) / 0.05) 40%, transparent 70%)",
        }}
      />

      {/* Central Content */}
      <div className="relative z-10 flex flex-col items-center px-6 text-center">
        {/* Modern App Icon Frame */}
        <div className="relative mb-6">
          {/* Subtle static gradient accent border */}
          <div className="absolute -inset-1 rounded-[28px] pointer-events-none bg-gradient-to-tr from-sys-accent/25 via-sys-accent/10 to-sys-accent/25" />

          {/* Squircle Icon Container */}
          <div
            className={`relative h-24 w-24 sm:h-28 sm:w-28 overflow-hidden rounded-[26px] p-1.5 transition-colors border border-sys-accent/30 bg-sys-card ${
              isDark
                ? "shadow-2xl shadow-black/70 ring-1 ring-white/10"
                : "shadow-xl shadow-slate-300/50 ring-1 ring-slate-900/5"
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
            <span className="text-sys-text-primary">ДФКР</span>
            <span className="text-sys-accent">Розклад</span>
          </h1>
          <p className="text-xs sm:text-sm font-medium tracking-wide max-w-[280px] sm:max-w-sm text-sys-text-secondary">
            Дніпровський Фаховий коледж радіоелектроніки
          </p>
        </div>

        {/* Ultra-lightweight Hardware-Accelerated Progress Track */}
        <div className="relative h-1 w-36 sm:w-44 overflow-hidden rounded-full bg-sys-elevated ring-1 ring-sys-border">
          <div className="absolute inset-y-0 w-1/2 rounded-full animate-splash-beam bg-sys-accent" />
        </div>
      </div>
    </div>
  );
}
