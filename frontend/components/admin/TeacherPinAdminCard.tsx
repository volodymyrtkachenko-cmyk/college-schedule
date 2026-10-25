"use client";

import React, { useState, useEffect } from "react";
import { api } from "../../lib/api";

interface TeacherPinAdminCardProps {
  onNotify?: (message: string, tone: "positive" | "negative") => void;
}

export function TeacherPinAdminCard({ onNotify }: TeacherPinAdminCardProps) {
  const [currentPin, setCurrentPin] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isRevealed, setIsRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  const [isEditing, setIsEditing] = useState(false);
  const [newPin, setNewPin] = useState("");
  const [isNewPinRevealed, setIsNewPinRevealed] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const loadPin = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.settings.getTeacherPin();
      setCurrentPin(res.pin);
    } catch {
      setError("Не вдалося завантажити поточний PIN-код");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPin();
  }, []);

  const handleCopy = async () => {
    if (!currentPin) return;
    try {
      await navigator.clipboard.writeText(currentPin);
      setCopied(true);
      onNotify?.("PIN-код скопійовано в буфер обміну", "positive");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      onNotify?.("Не вдалося скопіювати", "negative");
    }
  };

  const handleStartEdit = () => {
    setNewPin(currentPin || "");
    setEditError(null);
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditError(null);
  };

  const handleSavePin = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newPin.trim();
    if (!trimmed) {
      setEditError("PIN-код не може бути порожнім");
      return;
    }
    if (trimmed.length < 3) {
      setEditError("PIN-код має містити щонайменше 3 символи");
      return;
    }

    setSaving(true);
    setEditError(null);
    try {
      const res = await api.settings.updateTeacherPin(trimmed);
      setCurrentPin(res.pin);
      setIsEditing(false);
      onNotify?.("✓ PIN-код викладача успішно оновлено!", "positive");
    } catch (err: any) {
      setEditError(err?.message || "Помилка при збереженні PIN-коду");
      onNotify?.("Не вдалося оновити PIN-код", "negative");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="surface-panel rounded-2xl border border-sys-border bg-sys-card p-4 sm:p-5 shadow-xs space-y-3.5 mb-5 w-full">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-sys-border/60">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400 flex items-center justify-center shrink-0">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 2l-2 2m-1.5 1.5L16 7l-1.5-1.5L13 7l-2-2-1 1 2 2-3 3-1-1-1 1 1 1-2 2 1 1-1 1 2 2 3-3 2 2 7-7" />
              <circle cx="7.5" cy="15.5" r="5.5" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-bold text-sys-text-primary leading-tight">
              PIN-код доступу для викладачів
            </h3>
            <p className="text-xs text-sys-text-secondary mt-0.5">
              Спільний пароль для розблокування посилань Zoom та Google Meet у розкладі викладачів
            </p>
          </div>
        </div>

        {!isEditing && (
          <button
            type="button"
            onClick={handleStartEdit}
            disabled={loading}
            className="self-start sm:self-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-sys-border bg-sys-bg text-xs font-semibold text-sys-text-primary hover:border-sys-accent/60 hover:text-sys-accent active:scale-95 transition-all cursor-pointer disabled:opacity-50"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
            </svg>
            <span>Змінити PIN-код</span>
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-3 py-2 text-xs text-sys-text-muted animate-pulse">
          <span className="w-4 h-4 rounded-full border-2 border-sys-accent border-t-transparent animate-spin" />
          <span>Завантаження поточного PIN-коду…</span>
        </div>
      ) : error ? (
        <div className="flex items-center justify-between p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300">
          <span>{error}</span>
          <button
            type="button"
            onClick={loadPin}
            className="underline hover:no-underline font-semibold"
          >
            Спробувати знову
          </button>
        </div>
      ) : isEditing ? (
        <form onSubmit={handleSavePin} className="space-y-3 pt-1">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
            <div className="relative flex-1">
              <input
                type={isNewPinRevealed ? "text" : "password"}
                autoFocus
                value={newPin}
                onChange={(e) => {
                  setNewPin(e.target.value);
                  if (editError) setEditError(null);
                }}
                placeholder="Введіть новий PIN-код..."
                className="w-full h-10 px-3.5 pr-10 rounded-xl border border-sys-border bg-sys-bg font-mono text-sm text-sys-text-primary placeholder:text-sys-text-muted focus:border-sys-accent focus:ring-2 focus:ring-sys-accent/20 focus:outline-hidden transition-all"
              />
              <button
                type="button"
                onClick={() => setIsNewPinRevealed(!isNewPinRevealed)}
                title={isNewPinRevealed ? "Приховати символи" : "Показати символи"}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-sys-text-muted hover:text-sys-text-primary p-1 transition-colors"
              >
                {isNewPinRevealed ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                    <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                    <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                    <line x1="2" x2="22" y1="2" y2="22" />
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleCancelEdit}
                disabled={saving}
                className="min-h-[40px] px-3.5 rounded-xl border border-sys-border bg-sys-bg text-xs font-semibold text-sys-text-secondary hover:text-sys-text-primary active:scale-95 transition-all"
              >
                Скасувати
              </button>
              <button
                type="submit"
                disabled={saving || !newPin.trim()}
                className="min-h-[40px] px-4 rounded-xl bg-sys-accent text-white text-xs font-semibold shadow-xs hover:bg-sys-accent/90 disabled:opacity-50 active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer"
              >
                {saving ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Збереження…</span>
                  </>
                ) : (
                  <span>Зберегти PIN</span>
                )}
              </button>
            </div>
          </div>

          {editError && (
            <p className="text-xs text-rose-400 font-medium animate-in fade-in duration-150">
              {editError}
            </p>
          )}
        </form>
      ) : (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-xl bg-sys-bg/60 border border-sys-border">
          <div className="flex items-center gap-3">
            <span className="text-xs text-sys-text-secondary">Поточний PIN-код:</span>
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-bold text-sys-text-primary px-2.5 py-1 rounded-lg bg-sys-card border border-sys-border/80 tracking-wider">
                {isRevealed ? currentPin : "••••••••"}
              </span>
              <button
                type="button"
                onClick={() => setIsRevealed(!isRevealed)}
                className="p-1.5 rounded-lg border border-sys-border bg-sys-bg text-sys-text-secondary hover:text-sys-text-primary hover:border-sys-accent/40 active:scale-95 transition-all"
                title={isRevealed ? "Приховати PIN" : "Показати PIN"}
                aria-label={isRevealed ? "Приховати PIN" : "Показати PIN"}
              >
                {isRevealed ? (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                    <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                    <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                    <line x1="2" x2="22" y1="2" y2="22" />
                  </svg>
                ) : (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 self-start sm:self-auto px-3 py-1.5 rounded-lg border border-sys-border bg-sys-bg text-xs font-semibold text-sys-text-secondary hover:text-sys-text-primary active:scale-95 transition-all"
            title="Скопіювати PIN-код"
          >
            {copied ? (
              <>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                <span className="text-emerald-400 font-bold">Скопійовано!</span>
              </>
            ) : (
              <>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                  <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                </svg>
                <span>Копіювати PIN</span>
              </>
            )}
          </button>
        </div>
      )}

      <p className="text-[11px] text-sys-text-muted leading-relaxed">
        ⓘ Надайте цей PIN-код викладачам коледжу. Вони зможуть ввести його у розкладі, щоб відкрити всі посилання на онлайн-пари в один клік.
      </p>
    </div>
  );
}
