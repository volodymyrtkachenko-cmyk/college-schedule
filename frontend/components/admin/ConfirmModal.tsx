"use client";
import { useId, useState } from "react";
import { AppDialog } from "../ui/AppDialog";
import { CloseIcon } from "../ui/Icons";

type Props = {
  isOpen: boolean;
  title: string;
  message?: string;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
};

export function ConfirmModal({ isOpen, title, message, onConfirm, onCancel }: Props) {
  const titleId = useId();
  const [processing, setProcessing] = useState(false);

  const handleConfirm = async () => {
    setProcessing(true);
    try {
      await onConfirm();
    } finally {
      setProcessing(false);
    }
  };

  return (
    <AppDialog
      isOpen={isOpen}
      onClose={processing ? () => {} : onCancel}
      variant="sheet"
      maxWidth="400px"
      closeDisabled={processing}
      labelledBy={titleId}
    >
      <div className="surface-panel w-full rounded-t-2xl sm:rounded-2xl border border-sys-border bg-sys-card text-sys-text-primary shadow-2xl overflow-hidden pb-safe">
        <div className="mx-auto mt-2.5 h-1 w-9 rounded-full bg-sys-border/80 sm:hidden" aria-hidden="true" />
        <div className="p-5 pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-rose-500/25 bg-rose-500/15 text-rose-600 dark:text-rose-400">
                <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
              </div>
              <h2 id={titleId} className="text-base sm:text-lg font-bold text-sys-text-primary leading-snug break-words">
                {title}
              </h2>
            </div>
            <button
              type="button"
              onClick={onCancel}
              disabled={processing}
              aria-label="Закрити"
              className="relative after:absolute after:-inset-1.5 after:content-[''] flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-sys-border bg-sys-bg text-sys-text-secondary hover:text-sys-text-primary transition-colors disabled:opacity-40 cursor-pointer"
            >
              <CloseIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
        {message && (
          <div className="px-5 pb-2">
            <p className="text-sm text-sys-text-secondary leading-relaxed">{message}</p>
          </div>
        )}
        <div className="mt-4 flex flex-col-reverse sm:flex-row justify-end gap-2.5 border-t border-sys-border bg-sys-surface p-4 sm:px-5 sm:py-4">
          <button
            type="button"
            autoFocus
            onClick={onCancel}
            disabled={processing}
            className="w-full sm:w-auto min-h-[44px] sm:min-h-[40px] rounded-xl border border-sys-border bg-sys-card px-4 py-2 text-sm font-semibold text-sys-text-primary hover:bg-sys-bg active:scale-[0.98] transition-colors disabled:opacity-50 cursor-pointer"
          >
            Скасувати
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={processing}
            className="w-full sm:w-auto min-h-[44px] sm:min-h-[40px] flex items-center justify-center gap-2 rounded-xl bg-rose-700 disabled:opacity-50 px-5 py-2 text-sm font-semibold text-white hover:bg-rose-800 active:scale-[0.98] transition-colors shadow-sm cursor-pointer"
          >
            {processing ? "Видалення…" : "Видалити"}
          </button>
        </div>
      </div>
    </AppDialog>
  );
}
