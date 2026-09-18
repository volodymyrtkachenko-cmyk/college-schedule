"use client";

import { useOnlineStatus } from "../lib/hooks";

export function OfflineIndicator() {
  const online = useOnlineStatus();
  if (online) return null;
  return <div role="status" className="border-b border-amber-400/20 bg-amber-400/10 px-4 py-2 text-center text-sm text-amber-200">Офлайн-режим</div>;
}
