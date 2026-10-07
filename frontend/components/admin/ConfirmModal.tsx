"use client";

type Props = {
  isOpen: boolean;
  title: string;
  message?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmModal({ isOpen, title, message, onConfirm, onCancel }: Props) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-sm rounded-2xl border border-rose-500/20 bg-sys-card shadow-2xl overflow-hidden">
        <div className="bg-gradient-to-b from-white/5 to-transparent p-5 pb-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-500/20 text-rose-500">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
            </div>
            <h3 className="text-lg font-bold text-sys-text-primary">{title}</h3>
          </div>
        </div>
        {message && <div className="px-6 pb-2"><p className="text-sm text-sys-text-secondary">{message}</p></div>}
        <div className="mt-4 flex justify-end gap-3 border-t border-sys-border bg-sys-bg/30 px-5 py-4">
          <button type="button" onClick={onCancel} className="rounded-lg border border-sys-border px-4 py-2 text-sm font-medium text-sys-text-primary hover:bg-sys-bg transition-colors">
            Скасувати
          </button>
          <button type="button" onClick={onConfirm} className="rounded-lg bg-rose-500 px-5 py-2 text-sm font-medium text-white hover:bg-rose-400 transition-colors shadow-sm">
            Видалити
          </button>
        </div>
      </div>
    </div>
  );
}
