"use client";

import { m, AnimatePresence } from "framer-motion";
import { useOnlineStatus, invalidateScheduleCache } from "../lib/hooks";
import { WifiOffIcon } from "./ui/Icons";

export function OfflineIndicator({
  isSlowNetwork = false,
  isUsingFallbackCache = false,
}: {
  isSlowNetwork?: boolean;
  isUsingFallbackCache?: boolean;
}) {
  const online = useOnlineStatus();

  return (
    <AnimatePresence>
      {!online ? (
        <m.div
          key="offline"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          role="status"
          className="overflow-hidden border-b border-amber-500/30 dark:border-amber-400/20 bg-amber-500/15 dark:bg-amber-400/10 px-4 py-2 text-center text-xs sm:text-sm font-medium text-amber-900 dark:text-amber-200 flex items-center justify-center gap-2"
        >
          <span className="inline-flex items-center gap-2">
            <WifiOffIcon className="h-4 w-4 shrink-0" />
            <span>Немає підключення до інтернету · показано збережений розклад.</span>
          </span>
        </m.div>
      ) : isSlowNetwork || isUsingFallbackCache ? (
        <m.div
          key="slow-or-fallback"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          role="status"
          className="overflow-hidden border-b border-sys-accent/30 bg-sys-accent/10 px-4 py-1.5 text-center text-xs font-medium text-sys-text-primary flex items-center justify-center gap-2.5 flex-wrap"
        >
          {isSlowNetwork ? (
            <span className="inline-flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-sys-accent animate-ping" />
              <span>Повільний інтернет — показуємо збережений розклад, оновлюємо у фоні…</span>
            </span>
          ) : (
            <span>Показано збережений розклад (сервер тимчасово недоступний).</span>
          )}
          <button
            type="button"
            onClick={() => invalidateScheduleCache()}
            className="rounded-lg border border-sys-accent/40 bg-sys-card/80 px-2.5 py-0.5 text-[11px] font-semibold text-sys-accent hover:bg-sys-accent hover:text-white transition-colors cursor-pointer"
          >
            Оновити
          </button>
        </m.div>
      ) : null}
    </AnimatePresence>
  );
}
