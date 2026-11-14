"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangleIcon } from "@/components/ui/Icons";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log the error to client console for diagnostics
    console.error("Помилка завантаження сторінки розкладу:", error);
  }, [error]);

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="min-h-dvh flex items-center justify-center p-4 bg-[var(--page-bg)] text-sys-text-primary outline-none"
    >
      <div className="w-full max-w-md p-6 rounded-2xl bg-sys-card border border-sys-border shadow-lg text-center space-y-4">
        <div className="w-14 h-14 mx-auto rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-600 dark:text-amber-400">
          <AlertTriangleIcon className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-sys-text-primary">
            Тимчасова помилка завантаження
          </h1>
          <p className="mt-1 text-sm text-sys-text-secondary leading-relaxed">
            Не вдалося завантажити дані сторінки. Можливо, оновлюється розклад або відсутній зв’язок із сервером.
          </p>
        </div>

        <div className="pt-2 flex flex-col sm:flex-row gap-2 justify-center">
          <button
            type="button"
            onClick={() => reset()}
            className="inline-flex items-center justify-center px-4 py-2.5 rounded-xl bg-sys-accentSolid text-sys-onAccent font-medium text-sm hover:opacity-90 active:scale-[0.98] transition"
          >
            Спробувати знову
          </button>
          <Link
            href="/"
            className="inline-flex items-center justify-center px-4 py-2.5 rounded-xl bg-sys-card hover:bg-sys-hover border border-sys-border text-sys-text-primary font-medium text-sm transition"
          >
            На головну розкладу
          </Link>
        </div>
      </div>
    </main>
  );
}
