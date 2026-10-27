"use client";

import { useEffect, useState } from "react";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

const DISMISS_KEY = "pwa_install_prompt_dismissed";

export function InstallPrompt() {
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null);
  const [isIosPhone, setIsIosPhone] = useState(false);
  const [isPhone, setIsPhone] = useState(false);
  const [dismissed, setDismissed] = useState(true); // default true until checked

  useEffect(() => {
    // Перевірка збереженого закриття
    if (typeof window !== "undefined" && window.localStorage) {
      if (localStorage.getItem(DISMISS_KEY) === "true") {
        return;
      }
      setDismissed(false);
    }

    // Перевірка, що пристрій — саме телефон (не ПК і не планшет)
    const checkIsPhone = () => {
      if (typeof window === "undefined" || typeof navigator === "undefined") return false;

      // Modern Client Hints API (Chromium на телефонах)
      if ("userAgentData" in navigator && (navigator as any).userAgentData?.mobile !== undefined) {
        return Boolean((navigator as any).userAgentData.mobile);
      }

      // Перевірка через User-Agent спеціально для телефонів
      const ua = navigator.userAgent || "";
      const isMobileUa = /android.*mobile|iphone|ipod|mobile/i.test(ua);
      const isTabletUa = /ipad|tablet/i.test(ua);

      return isMobileUa && !isTabletUa;
    };

    if (!checkIsPhone()) return;
    setIsPhone(true);

    // Якщо розклад вже відкрито як встановлений PWA застосунок — банер не потрібен
    const isStandalone =
      ("standalone" in window.navigator && (window.navigator as any).standalone === true) ||
      window.matchMedia("(display-mode: standalone)").matches;

    if (isStandalone) return;

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as InstallPromptEvent);
    };

    const isIos = /iphone|ipod/i.test(navigator.userAgent);
    setIsIosPhone(isIos);

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  }, []);

  const handleDismiss = () => {
    setDismissed(true);
    setInstallEvent(null);
    try {
      localStorage.setItem(DISMISS_KEY, "true");
    } catch {
      // ignore storage errors
    }
  };

  if (dismissed || !isPhone) return null;

  if (installEvent) {
    return (
      <div className="md:hidden mx-auto mt-3 flex max-w-[1800px] items-center justify-between gap-2.5 rounded-xl border border-cyan-400/25 bg-cyan-950/40 backdrop-blur-sm px-3.5 py-2.5 text-xs sm:text-sm text-cyan-100 shadow-sm">
        <span className="flex-1 pr-1 font-medium leading-snug">
          Встановіть розклад, щоб швидко відкривати його без інтернету.
        </span>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            className="rounded-lg bg-cyan-400 px-3 py-1.5 text-xs font-bold text-slate-950 shadow-xs active:scale-95 transition-transform"
            onClick={async () => {
              await installEvent.prompt();
              handleDismiss();
            }}
          >
            Встановити
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Закрити сповіщення про встановлення"
            title="Закрити"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-cyan-300 hover:bg-cyan-400/15 hover:text-cyan-100 active:scale-90 transition-colors"
          >
            ✕
          </button>
        </div>
      </div>
    );
  }

  if (!isIosPhone) return null;

  return (
    <div className="md:hidden mx-auto mt-3 flex max-w-[1800px] items-center justify-between gap-2 rounded-xl border border-slate-700/50 bg-slate-900/60 backdrop-blur-sm px-3 py-2 text-xs text-slate-300 shadow-sm">
      <span className="flex-1">
        На iPhone натисніть «Поділитися» <span className="opacity-75">⎋</span>, а потім — «На початковий екран» ⊞.
      </span>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Закрити підказку"
        title="Закрити"
        className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:text-slate-200 active:scale-90 transition-colors"
      >
        ✕
      </button>
    </div>
  );
}
