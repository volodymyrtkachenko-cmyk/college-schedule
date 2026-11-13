"use client";

import { useEffect, useState } from "react";
import { CloseIcon, ShareUploadIcon } from "./ui/Icons";

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

    if (typeof window !== "undefined" && (window as any).__pwaInstallEvent) {
      setInstallEvent((window as any).__pwaInstallEvent as InstallPromptEvent);
    }

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      (window as any).__pwaInstallEvent = event;
      setInstallEvent(event as InstallPromptEvent);
    };

    const isIos = /iphone|ipod/i.test(navigator.userAgent);
    setIsIosPhone(isIos);

    const onInstallReady = (e: any) => {
      if (e.detail) {
        setInstallEvent(e.detail as InstallPromptEvent);
      }
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("pwa-install-ready", onInstallReady);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("pwa-install-ready", onInstallReady);
    };
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
      <div className="md:hidden mx-auto mt-3 flex max-w-[1800px] items-center justify-between gap-2.5 rounded-xl border border-sys-accent/35 bg-sys-elevated px-3.5 py-2.5 text-xs sm:text-sm text-sys-text-primary shadow-sm">
        <span className="flex-1 pr-1 font-medium leading-snug">
          Встановіть розклад, щоб швидко відкривати його без інтернету.
        </span>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            className="rounded-lg bg-sys-accent px-3 py-1.5 text-xs font-bold text-white shadow-xs active:scale-95 transition-transform"
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
            className="flex h-7 w-7 items-center justify-center rounded-lg text-sys-text-secondary hover:bg-sys-accent/15 hover:text-sys-text-primary active:scale-90 transition-colors"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  if (!isIosPhone) return null;

  return (
    <div className="md:hidden mx-auto mt-3 flex max-w-[1800px] items-center justify-between gap-2 rounded-xl border border-sys-border bg-sys-elevated px-3 py-2 text-xs text-sys-text-primary shadow-sm">
      <span className="flex-1 inline-flex flex-wrap items-center gap-1">
        <span>На iPhone натисніть «Поділитися»</span>
        <ShareUploadIcon className="inline h-3.5 w-3.5 opacity-80" />
        <span>, а потім — «На початковий екран».</span>
      </span>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Закрити підказку"
        title="Закрити"
        className="flex h-6 w-6 items-center justify-center rounded text-sys-text-secondary hover:text-sys-text-primary active:scale-90 transition-colors"
      >
        <CloseIcon className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
