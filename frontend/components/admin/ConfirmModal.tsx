"use client";
import { useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";

type Props = {
  isOpen: boolean;
  title: string;
  message?: string;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
};

export function ConfirmModal({ isOpen, title, message, onConfirm, onCancel }: Props) {
  const [processing, setProcessing] = useState(false);
  const shouldReduceMotion = useReducedMotion();

  const handleConfirm = async () => {
    setProcessing(true);
    try {
      await onConfirm();
    } finally {
      setProcessing(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center bg-black/60 p-0 sm:px-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) onCancel();
          }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={shouldReduceMotion ? { opacity: 0 } : { y: "100%", opacity: 0 }}
            animate={shouldReduceMotion ? { opacity: 1 } : { y: 0, opacity: 1 }}
            exit={shouldReduceMotion ? { opacity: 0 } : { y: "100%", opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }}
            className="w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl border border-rose-500/20 bg-sys-card shadow-2xl overflow-hidden pb-safe"
          >
            <div className="bg-gradient-to-b from-white/5 to-transparent p-5 pb-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-500/20 text-rose-500">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
                </div>
                <h3 className="text-base sm:text-lg font-bold text-sys-text-primary">{title}</h3>
              </div>
            </div>
            {message && <div className="px-5 sm:px-6 pb-2"><p className="text-sm text-sys-text-secondary leading-relaxed">{message}</p></div>}
            <div className="mt-4 flex flex-col-reverse sm:flex-row justify-end gap-2.5 border-t border-sys-border bg-sys-bg/30 p-4 sm:p-5">
              <button
                type="button"
                onClick={onCancel}
                className="w-full sm:w-auto min-h-[44px] sm:min-h-[40px] rounded-lg border border-sys-border bg-sys-card px-4 py-2 text-sm font-semibold text-sys-text-primary hover:bg-white/5 active:scale-[0.98] transition-all"
              >
                Скасувати
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={processing}
                className="w-full sm:w-auto min-h-[44px] sm:min-h-[40px] flex items-center justify-center gap-2 rounded-lg bg-rose-500 disabled:opacity-50 px-5 py-2 text-sm font-semibold text-white hover:bg-rose-400 active:scale-[0.98] transition-all shadow-sm"
              >
                {processing ? "Видалення…" : "Видалити"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
