"use client";

import { createContext, useContext, useState, useCallback, ReactNode, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { prefersReducedMotion } from "@/lib/dialogTopLayer";

type ToastType = "success" | "error" | "info";

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  leaving?: boolean;
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Map<string, number[]>>(new Map());

  const clearTimersForToast = useCallback((id: string) => {
    const timers = timersRef.current.get(id);
    if (!timers) return;
    timers.forEach((timerId) => window.clearTimeout(timerId));
    timersRef.current.delete(id);
  }, []);

  useEffect(() => {
    const timersMap = timersRef.current;
    return () => {
      timersMap.forEach((list) => list.forEach((timerId) => window.clearTimeout(timerId)));
      timersMap.clear();
    };
  }, []);

  const dismissToast = useCallback(
    (id: string) => {
      clearTimersForToast(id);
      const exitDelay = prefersReducedMotion() ? 100 : 210;
      setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
      const removeTimer = window.setTimeout(() => {
        clearTimersForToast(id);
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, exitDelay);
      timersRef.current.set(id, [removeTimer]);
    },
    [clearTimersForToast]
  );

  const showToast = useCallback(
    (message: string, type: ToastType = "info") => {
      const id = Math.random().toString(36).substring(2, 9);
      const cleanMessage =
        type === "success"
          ? message.replace(/^[✓✔]\s*/, "")
          : type === "error"
          ? message.replace(/^[✗✕✖❌]\s*/, "")
          : message;
      setToasts((prev) => [...prev, { id, message: cleanMessage, type }]);

      const autoTimer = window.setTimeout(() => {
        dismissToast(id);
      }, 3800);
      timersRef.current.set(id, [autoTimer]);
    },
    [dismissToast]
  );

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used within ToastProvider");
  return context;
}

export function useOptionalToast() {
  return useContext(ToastContext);
}

function ToastContainer({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted || toasts.length === 0) return null;

  return createPortal(
    <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:bottom-6 z-[100] flex flex-col gap-2 items-end pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="alert"
          data-leaving={toast.leaving ? "true" : undefined}
          onClick={() => onDismiss(toast.id)}
          className={`toast-item flex w-full sm:w-auto items-center gap-2 rounded-xl border px-4 py-3 text-sm shadow-2xl lg:backdrop-blur-md pointer-events-auto cursor-pointer select-none ${
            toast.type === "success"
              ? "border-emerald-500/40 bg-emerald-50 dark:bg-emerald-950/90 text-emerald-800 dark:text-emerald-200"
              : toast.type === "error"
              ? "border-rose-500/40 bg-rose-50 dark:bg-rose-950/90 text-rose-800 dark:text-rose-200"
              : "border-sys-border bg-sys-card text-sys-text-primary"
          }`}
        >
          {toast.type === "success" ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="M5 12l5 5l10 -10"/></svg>
          ) : toast.type === "error" ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
          )}
          <span>{toast.message}</span>
        </div>
      ))}
    </div>,
    document.body
  );
}
