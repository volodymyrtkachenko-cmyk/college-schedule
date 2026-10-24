"use client";

import { useOnlineStatus } from "../lib/hooks";

export function OfflineIndicator() {
  const online = useOnlineStatus();
  if (online) return null;
  return <div role="status" className="border-b border-amber-500/30 dark:border-amber-400/20 bg-amber-500/15 dark:bg-amber-400/10 px-4 py-2 text-center text-sm font-medium text-amber-900 dark:text-amber-200">Немає підключення до інтернету.</div>;
}
