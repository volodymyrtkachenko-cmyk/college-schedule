"use client";

import { useEffect, useState } from "react";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

export function InstallPrompt() {
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null);
  const [isIosPhone, setIsIosPhone] = useState(false);
  const [isPhone, setIsPhone] = useState(false);

  useEffect(() => {
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

  if (!isPhone) return null;

  if (installEvent) {
    return (
      <div className="md:hidden mx-auto mt-4 flex max-w-[1800px] items-center justify-between gap-3 rounded-xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100">
        <span>Встановіть розклад, щоб швидко відкривати його без інтернету.</span>
        <button
          type="button"
          className="shrink-0 rounded-lg bg-cyan-400 px-3 py-2 font-semibold text-slate-950"
          onClick={async () => {
            await installEvent.prompt();
            setInstallEvent(null);
          }}
        >
          Встановити
        </button>
      </div>
    );
  }

  if (!isIosPhone) return null;

  return (
    <p className="md:hidden mx-auto mt-4 max-w-[1800px] px-4 text-center text-xs text-slate-400">
      На iPhone натисніть «Поділитися», а потім — «На початковий екран».
    </p>
  );
}
