import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useRef } from "react";

export function ConfirmModal({ isOpen, title, onConfirm, onCancel, confirmText = "Видалити", cancelText = "Скасувати" }: { isOpen: boolean, title: string, onConfirm: () => void, onCancel: () => void, confirmText?: string, cancelText?: string }) {
  const overlayRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") onConfirm();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onCancel, onConfirm]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-[#0b1120]/60 backdrop-blur-sm" onClick={onCancel} />
          
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 10 }}
            className="relative w-full max-w-sm rounded-[14px] border border-sys-border bg-sys-card p-6 shadow-xl shadow-black/50"
          >
            <h3 className="mb-6 text-lg font-semibold text-sys-text-primary text-center leading-snug">{title}</h3>
            
            <div className="flex gap-3 w-full">
              <button type="button" onClick={onCancel} className="flex-1 rounded-[10px] border border-sys-border bg-sys-bg py-2.5 text-sm font-medium text-sys-text-secondary hover:bg-sys-border/50 hover:text-white transition-colors">
                {cancelText}
              </button>
              <button autoFocus type="button" onClick={onConfirm} className="flex-1 rounded-[10px] bg-rose-500/10 border border-rose-500/20 py-2.5 text-sm font-medium text-rose-400 hover:bg-rose-500/20 hover:text-rose-300 transition-colors">
                {confirmText}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
