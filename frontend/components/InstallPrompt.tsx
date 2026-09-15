"use client";

import { useEffect, useState } from "react";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

export function InstallPrompt() {
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null);
  const [ios, setIos] = useState(false);
  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as InstallPromptEvent);
    };
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent)
      && !("standalone" in navigator && (navigator as Navigator & { standalone?: boolean }).standalone);
    setIos(isIos);
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  }, []);
  if (installEvent) {
    return (
      <div className="mx-auto mt-4 flex max-w-[1800px] items-center justify-between gap-3 rounded-xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100">
        <span>Встановіть розклад для швидкого доступу офлайн.</span>
        <button type="button" className="shrink-0 rounded-lg bg-cyan-400 px-3 py-2 font-semibold text-slate-950" onClick={async () => { await installEvent.prompt(); setInstallEvent(null); }}>Встановити</button>
      </div>
    );
  }
  if (!ios) return null;
  return <p className="mx-auto mt-4 max-w-[1800px] px-4 text-center text-xs text-slate-400">На iPhone/iPad відкрийте «Поділитися» та виберіть «На початковий екран».</p>;
}
