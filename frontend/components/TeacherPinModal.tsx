"use client";

import React, { useState, useEffect, useRef } from "react";
import { useTeacherAccess } from "../lib/useTeacherAccess";

interface TeacherPinModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetGroupName?: string | null;
  onSuccess?: () => void;
}

export function TeacherPinModal({
  isOpen,
  onClose,
  targetGroupName,
  onSuccess,
}: TeacherPinModalProps) {
  const { isTeacherUnlocked, unlockTeacher, lockTeacher } = useTeacherAccess();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setPin("");
      setError(null);
      setIsSubmitting(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin.trim()) {
      setError("Введіть PIN-код");
      return;
    }
    setError(null);
    setIsSubmitting(true);
    const result = await unlockTeacher(pin.trim());
    setIsSubmitting(false);
    if (result.success) {
      onSuccess?.();
      onClose();
    } else {
      setError(result.error || "Невірний PIN-код");
    }
  };

  const handleLock = () => {
    lockTeacher();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 sm:backdrop-blur-xs animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="surface-panel w-full max-w-sm rounded-2xl border border-sys-border bg-sys-card p-6 shadow-2xl relative overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Icon & Title */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${
              isTeacherUnlocked
                ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
                : "bg-sky-500/15 border-sky-500/30 text-sky-600 dark:text-sky-400"
            }`}>
              {isTeacherUnlocked ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              )}
            </div>
            <div>
              <h3 className="text-base font-bold text-sys-text-primary leading-tight">
                {isTeacherUnlocked ? "Режим викладача активний" : "Вхід для викладача"}
              </h3>
              <p className="text-xs text-sys-text-secondary mt-0.5">
                {isTeacherUnlocked ? "Доступ до всіх онлайн-пар відкрито" : "PIN-код для доступу до посилань"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-sys-text-muted hover:text-sys-text-primary hover:bg-sys-bg transition-colors -mr-1 -mt-1"
          >
            ✕
          </button>
        </div>

        {isTeacherUnlocked ? (
          <div className="space-y-4">
            <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-800 dark:text-emerald-300 leading-relaxed font-medium">
              На цьому пристрої активовано доступ викладача. Усі посилання на відеоконференції (Zoom, Google Meet) у розкладі відображаються відкритими.
            </div>
            <div className="flex gap-2.5 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 h-10 rounded-xl border border-sys-border bg-sys-bg text-xs font-semibold text-sys-text-primary hover:bg-sys-card transition-colors"
              >
                Закрити
              </button>
              <button
                type="button"
                onClick={handleLock}
                className="flex-1 h-10 rounded-xl border border-rose-500/40 bg-rose-500/15 text-xs font-semibold text-rose-700 dark:text-rose-300 hover:bg-rose-500/25 active:scale-95 transition-colors"
              >
                Вийти з режиму
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="teacher-pin-input" className="block text-xs font-medium text-sys-text-secondary mb-1.5">
                Введіть PIN-код викладача
              </label>
              <input
                id="teacher-pin-input"
                ref={inputRef}
                type="password"
                inputMode="text"
                autoComplete="off"
                placeholder="Введіть PIN..."
                value={pin}
                onChange={(e) => {
                  setPin(e.target.value);
                  if (error) setError(null);
                }}
                className={`w-full h-11 px-3.5 rounded-xl border text-sm text-sys-text-primary bg-sys-bg/90 placeholder:text-sys-text-muted focus:outline-hidden focus:ring-2 transition-colors duration-fast ease-smooth ${
                  error
                    ? "border-rose-500/60 focus:ring-rose-500/30"
                    : "border-sys-border focus:border-sys-accent focus:ring-sys-accent/20"
                }`}
              />
              {error && (
                <p className="text-xs text-rose-700 dark:text-rose-400 font-medium mt-1.5 animate-in fade-in duration-150">
                  {error}
                </p>
              )}
            </div>

            {targetGroupName && (
              <div className="p-3 rounded-xl bg-sys-bg/60 border border-sys-border text-xs text-sys-text-secondary leading-relaxed">
                <span className="font-semibold text-sys-text-primary">Для студентів:</span> якщо ви студент групи <span className="text-sys-accent font-medium">{targetGroupName}</span>, перейдіть до розкладу групи та прив'яжіть свій Google Classroom — посилання розблокується автоматично.
              </div>
            )}

            <div className="flex gap-2.5 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 h-11 rounded-xl border border-sys-border bg-sys-bg text-xs font-semibold text-sys-text-secondary hover:text-sys-text-primary hover:bg-sys-card transition-colors duration-fast ease-smooth"
              >
                Скасувати
              </button>
              <button
                type="submit"
                disabled={isSubmitting || !pin.trim()}
                className="flex-1 h-11 rounded-xl bg-sys-accent text-slate-950 text-xs font-bold shadow-md hover:bg-sys-accent/90 disabled:opacity-50 disabled:cursor-not-allowed active:scale-98 transition-colors duration-fast ease-smooth flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                    <span>Перевірка...</span>
                  </>
                ) : (
                  <span>Розблокувати</span>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
