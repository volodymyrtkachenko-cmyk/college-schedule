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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-sm rounded-2xl border border-sys-border bg-sys-card p-5 shadow-2xl">
        <h3 className="font-semibold text-sys-text-primary">{title}</h3>
        {message && <p className="mt-2 text-sm text-sys-text-secondary">{message}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-lg border border-sys-border px-4 py-2 text-sm text-sys-text-primary">
            Скасувати
          </button>
          <button type="button" onClick={onConfirm} className="rounded-lg bg-rose-500 px-4 py-2 text-sm font-semibold text-white">
            Видалити
          </button>
        </div>
      </div>
    </div>
  );
}
