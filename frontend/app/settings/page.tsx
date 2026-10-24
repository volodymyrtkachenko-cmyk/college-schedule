"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useTheme } from "../../lib/useTheme";
import { useUserSettings } from "../../lib/useUserSettings";
import { useClassroomSubmissions } from "../../lib/useClassroomSubmissions";
import { useTeacherAccess } from "../../lib/useTeacherAccess";
import { useAuth } from "../../lib/auth";

const ROLE_NAMES: Record<string, string> = {
  admin: "Адміністратор",
  editor: "Редактор",
  viewer: "Перегляд",
  teacher: "Викладач",
};

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const { settings, updateSetting } = useUserSettings();
  const { isLinked, linkedEmail, unlink } = useClassroomSubmissions();
  const { isTeacherUnlocked, unlockTeacher, lockTeacher } = useTeacherAccess();
  const auth = useAuth();

  const [pinInput, setPinInput] = useState("");
  const [showPinInput, setShowPinInput] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinSuccess, setPinSuccess] = useState(false);
  const [isVerifyingPin, setIsVerifyingPin] = useState(false);

  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pinInput.trim()) return;
    setPinError(null);
    setPinSuccess(false);
    setIsVerifyingPin(true);
    const res = await unlockTeacher(pinInput.trim());
    setIsVerifyingPin(false);
    if (res.success) {
      setPinInput("");
      setPinSuccess(true);
      setTimeout(() => setPinSuccess(false), 3000);
    } else {
      setPinError("Невірний PIN-код. Перевірте й спробуйте ще раз.");
    }
  };

  const handleClassroomLinkClick = () => {
    window.location.href = "/?sync=1";
  };

  const roleLabel = (auth?.user && (ROLE_NAMES[auth.user.role] || auth.user.role)) || "";

  return (
    <div className="min-h-screen bg-sys-bg text-sys-text-primary transition-colors duration-200">
      {/* Top Bar with Return Link */}
      <header className="sticky top-0 z-30 border-b border-sys-border/80 bg-sys-card/85 backdrop-blur-md px-4 sm:px-6 py-3.5">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-lg px-2.5 py-1.5 -ml-2 text-xs sm:text-sm font-semibold text-sys-text-secondary hover:text-sys-accent hover:bg-sys-accent/10 transition-colors"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M19 12H5" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
            <span>До розкладу</span>
          </Link>
        </div>
      </header>

      {/* Main Settings Container */}
      <main className="max-w-2xl mx-auto px-4 py-6 sm:py-8 space-y-6 pb-24">
        {/* Title */}
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-sys-text-primary flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-sys-accent/15 text-sys-accent text-base">
              ⚙️
            </span>
            <span>Налаштування</span>
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-sys-text-secondary">
            Параметри розкладу й інтерфейсу. Діють лише на цьому пристрої.
          </p>
        </div>

        {/* Section 1: Розклад */}
        <section className="rounded-2xl border border-sys-border bg-sys-card p-4 sm:p-5 shadow-xs space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-sys-border/60">
            <span className="text-base">📅</span>
            <h2 className="text-sm font-bold uppercase tracking-wider text-sys-text-muted">
              Розклад
            </h2>
          </div>

          {/* 1.1 Setting: Моя підгрупа */}
          <div className="space-y-2 py-1">
            <span className="font-semibold text-xs sm:text-sm text-sys-text-primary">
              Моя підгрупа
            </span>
            <p className="text-xs text-sys-text-secondary leading-relaxed">
              Автоматично обирається для пар із поділом на підгрупи; на картці пари її можна змінити.
            </p>
            <div className="grid grid-cols-2 gap-1.5 rounded-xl border border-sys-border bg-sys-bg p-1 text-xs">
              <button
                type="button"
                onClick={() => updateSetting("defaultSubgroup", 1)}
                className={`py-1.5 px-2 rounded-lg font-semibold text-center transition-colors duration-fast ease-smooth cursor-pointer ${
                  settings.defaultSubgroup === 1
                    ? "bg-sys-accent text-white shadow-xs"
                    : "text-sys-text-secondary hover:text-sys-text-primary"
                }`}
              >
                1 підгрупа
              </button>
              <button
                type="button"
                onClick={() => updateSetting("defaultSubgroup", 2)}
                className={`py-1.5 px-2 rounded-lg font-semibold text-center transition-colors duration-fast ease-smooth cursor-pointer ${
                  settings.defaultSubgroup === 2
                    ? "bg-sys-accent text-white shadow-xs"
                    : "text-sys-text-secondary hover:text-sys-text-primary"
                }`}
              >
                2 підгрупа
              </button>
            </div>
          </div>

          <div className="h-px bg-sys-border/40" />

          {/* 1.2 Setting: Початковий вигляд */}
          <div className="space-y-2 py-1">
            <span className="font-semibold text-xs sm:text-sm text-sys-text-primary">
              Початковий вигляд
            </span>
            <p className="text-xs text-sys-text-secondary leading-relaxed">
              На широких екранах (комп&apos;ютер, планшет): що відкривається першим. На телефоні завжди день.
            </p>
            <div className="grid grid-cols-2 gap-1.5 rounded-xl border border-sys-border bg-sys-bg p-1 text-xs">
              <button
                type="button"
                onClick={() => updateSetting("defaultViewDesktop", "today")}
                className={`py-1.5 px-2 rounded-lg font-semibold text-center transition-colors duration-fast ease-smooth cursor-pointer ${
                  settings.defaultViewDesktop === "today"
                    ? "bg-sys-accent text-white shadow-xs"
                    : "text-sys-text-secondary hover:text-sys-text-primary"
                }`}
              >
                День
              </button>
              <button
                type="button"
                onClick={() => updateSetting("defaultViewDesktop", "week")}
                className={`py-1.5 px-2 rounded-lg font-semibold text-center transition-colors duration-fast ease-smooth cursor-pointer ${
                  settings.defaultViewDesktop === "week"
                    ? "bg-sys-accent text-white shadow-xs"
                    : "text-sys-text-secondary hover:text-sys-text-primary"
                }`}
              >
                Тиждень
              </button>
            </div>
          </div>

          <div className="h-px bg-sys-border/40" />

          {/* 1.3 Toggle: Показувати завдання (ДЗ) на парах */}
          <div className="flex items-start justify-between gap-4 py-1">
            <div className="space-y-0.5 min-w-0 pr-2">
              <span className="font-semibold text-xs sm:text-sm text-sys-text-primary">
                Показувати завдання (ДЗ) на парах
              </span>
              <p className="text-xs text-sys-text-secondary leading-relaxed">
                Мітки домашніх завдань у картках пар.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.showHomeworkBadges}
              onClick={() => updateSetting("showHomeworkBadges", !settings.showHomeworkBadges)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                settings.showHomeworkBadges ? "bg-sys-accent" : "bg-slate-300 dark:bg-slate-700"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                  settings.showHomeworkBadges ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>
        </section>

        {/* Section 2: Google Classroom */}
        <section className="rounded-2xl border border-sys-border bg-sys-card p-4 sm:p-5 shadow-xs space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-sys-border/60">
            <span className="text-base">🎓</span>
            <h2 className="text-sm font-bold uppercase tracking-wider text-sys-text-muted">
              Google Classroom
            </h2>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-sys-border/60 bg-sys-bg/60 p-3 text-xs">
            <div className="space-y-0.5 min-w-0">
              <span className="text-xs font-semibold text-sys-text-secondary">Студентська пошта Google</span>
              {isLinked && linkedEmail ? (
                <div className="flex items-center gap-1.5 font-bold text-sys-text-primary truncate">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
                  <span className="text-emerald-700 dark:text-emerald-400 font-semibold mr-1">Прив&apos;язано ·</span>
                  <span className="truncate">{linkedEmail}</span>
                </div>
              ) : (
                <div className="text-sys-text-muted font-medium">Не прив&apos;язано</div>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {isLinked ? (
                <button
                  type="button"
                  onClick={unlink}
                  className="rounded-lg bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 px-3 py-1.5 text-xs font-semibold text-rose-700 dark:text-rose-400 transition-colors cursor-pointer"
                >
                  Відв&apos;язати
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleClassroomLinkClick}
                  className="rounded-lg bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/40 px-3 py-1.5 text-xs font-semibold text-sky-700 dark:text-sky-400 transition-colors cursor-pointer"
                >
                  Прив&apos;язати Classroom
                </button>
              )}
            </div>
          </div>
          <p className="text-xs text-sys-text-secondary leading-relaxed">
            Після прив&apos;язки відкриваються посилання на онлайн-пари, персональні статуси здачі та оцінки.
          </p>
        </section>

        {/* Section 3: Тема оформлення */}
        <section className="rounded-2xl border border-sys-border bg-sys-card p-4 sm:p-5 shadow-xs space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-sys-border/60">
            <span className="text-base">🎨</span>
            <h2 className="text-sm font-bold uppercase tracking-wider text-sys-text-muted">
              Тема оформлення
            </h2>
          </div>
          <div className="grid grid-cols-3 gap-2 rounded-xl border border-sys-border bg-sys-bg p-1 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setTheme("dark")}
              className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg transition-colors duration-fast ease-smooth cursor-pointer ${
                theme === "dark"
                  ? "bg-sys-accent text-white shadow-xs"
                  : "text-sys-text-secondary hover:text-sys-text-primary"
              }`}
            >
              <span>🌙</span>
              <span>Темна</span>
            </button>
            <button
              type="button"
              onClick={() => setTheme("light")}
              className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg transition-colors duration-fast ease-smooth cursor-pointer ${
                theme === "light"
                  ? "bg-sys-accent text-white shadow-xs"
                  : "text-sys-text-secondary hover:text-sys-text-primary"
              }`}
            >
              <span>☀️</span>
              <span>Світла</span>
            </button>
            <button
              type="button"
              onClick={() => setTheme("system")}
              className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg transition-colors duration-fast ease-smooth cursor-pointer ${
                theme === "system"
                  ? "bg-sys-accent text-white shadow-xs"
                  : "text-sys-text-secondary hover:text-sys-text-primary"
              }`}
            >
              <span>💻</span>
              <span>Авто</span>
            </button>
          </div>
          <p className="text-xs text-sys-text-secondary leading-relaxed">
            «Авто» відповідає системній темі пристрою.
          </p>
        </section>

        {/* Section 4: Доступ викладача */}
        <section className="rounded-2xl border border-sys-border bg-sys-card p-4 sm:p-5 shadow-xs space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-sys-border/60">
            <span className="text-base">👨‍🏫</span>
            <h2 className="text-sm font-bold uppercase tracking-wider text-sys-text-muted">
              Доступ викладача
            </h2>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-sys-border/60 bg-sys-bg/60 p-3.5 text-xs">
            <div className="space-y-0.5 min-w-0">
              <span className="text-xs font-semibold text-sys-text-secondary">Статус</span>
              {isTeacherUnlocked ? (
                <div className="flex items-center gap-1.5 font-bold text-emerald-700 dark:text-emerald-400">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
                  <span>Активовано · онлайн-посилання розблоковано</span>
                </div>
              ) : (
                <div className="text-sys-text-muted font-medium">Не активовано</div>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {isTeacherUnlocked && (
                <button
                  type="button"
                  onClick={lockTeacher}
                  className="rounded-lg bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 px-3 py-1.5 text-xs font-semibold text-rose-700 dark:text-rose-400 transition-colors cursor-pointer"
                >
                  Вимкнути режим викладача
                </button>
              )}
            </div>
          </div>

          {!isTeacherUnlocked && (
            <form onSubmit={handlePinSubmit} className="space-y-2 pt-1">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <input
                    type={showPinInput ? "text" : "password"}
                    placeholder="PIN-код викладача"
                    value={pinInput}
                    onChange={(e) => {
                      setPinInput(e.target.value);
                      if (pinError) setPinError(null);
                    }}
                    className={`w-full h-10 px-3 pr-9 rounded-xl border bg-sys-bg text-xs text-sys-text-primary placeholder:text-sys-text-muted focus:outline-hidden focus:ring-2 ${
                      pinError ? "border-rose-500/50 focus:ring-rose-500/20" : "border-sys-border focus:border-sys-accent focus:ring-sys-accent/20"
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPinInput(!showPinInput)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-sys-text-muted hover:text-sys-text-primary p-1 transition-colors cursor-pointer"
                    title={showPinInput ? "Приховати PIN" : "Показати PIN"}
                  >
                    {showPinInput ? (
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
                <button
                  type="submit"
                  disabled={isVerifyingPin || !pinInput.trim()}
                  className="h-10 px-4 rounded-xl bg-sys-accent text-white font-semibold text-xs hover:bg-sys-accent/90 disabled:opacity-50 transition-colors duration-fast ease-smooth shrink-0 cursor-pointer shadow-xs active:scale-95"
                >
                  {isVerifyingPin ? "Перевірка…" : "Активувати"}
                </button>
              </div>
              {pinError && <p className="text-xs text-rose-700 dark:text-rose-400 font-medium">{pinError}</p>}
              {pinSuccess && <p className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">Доступ викладача активовано.</p>}
            </form>
          )}

          <p className="text-xs text-sys-text-secondary leading-relaxed">
            Відкриває всі посилання на онлайн-пари в розкладі без прив&apos;язки Classroom. PIN-код видає адміністратор розкладу.
          </p>
        </section>

        {/* Section 5: Корисні посилання */}
        <section className="rounded-2xl border border-sys-border bg-sys-card p-4 sm:p-5 shadow-xs space-y-3">
          <div className="flex items-center gap-2 pb-2 border-b border-sys-border/60">
            <span className="text-base">🔗</span>
            <h2 className="text-sm font-bold uppercase tracking-wider text-sys-text-muted">
              Корисні посилання
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            <Link
              href="/statistics"
              className="flex items-center justify-between rounded-xl border border-sys-border/60 bg-sys-bg/60 p-3 hover:border-purple-500/40 hover:bg-purple-500/5 transition-colors duration-fast ease-smooth group"
            >
              <span className="flex items-center gap-2.5 font-semibold text-sys-text-primary">
                <span className="text-base">📊</span>
                <span>Статистика занять</span>
              </span>
              <span className="text-purple-400 group-hover:translate-x-0.5 transition-transform">↗</span>
            </Link>

            <Link
              href="/educational-process"
              className="flex items-center justify-between rounded-xl border border-sys-border/60 bg-sys-bg/60 p-3 hover:border-indigo-500/40 hover:bg-indigo-500/5 transition-colors duration-fast ease-smooth group"
            >
              <span className="flex items-center gap-2.5 font-semibold text-sys-text-primary">
                <span className="text-base">📅</span>
                <span>Графік навчального процесу</span>
              </span>
              <span className="text-indigo-400 group-hover:translate-x-0.5 transition-transform">↗</span>
            </Link>
          </div>
        </section>

        {/* Section 6: Адміністрування */}
        <section className="rounded-2xl border border-sys-border bg-sys-card p-4 sm:p-5 shadow-xs space-y-3">
          <div className="flex items-center gap-2 pb-2 border-b border-sys-border/60">
            <span className="text-base">🛡️</span>
            <h2 className="text-sm font-bold uppercase tracking-wider text-sys-text-muted">
              Адміністрування
            </h2>
          </div>

          {auth?.user ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs">
                <div>
                  <div className="font-bold text-emerald-800 dark:text-emerald-400">Увійшли як {auth.user.username}</div>
                  <div className="text-sys-text-secondary text-[11px]">Роль: {roleLabel}</div>
                </div>
                <button
                  type="button"
                  onClick={() => auth.logout()}
                  className="rounded-lg bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 px-3 py-1.5 text-xs font-semibold text-rose-700 dark:text-rose-400 transition-colors cursor-pointer"
                >
                  Вийти з акаунта
                </button>
              </div>
              <Link
                href="/admin"
                className="flex items-center justify-center gap-2 rounded-xl bg-sys-accent px-4 py-2.5 text-xs font-bold text-white hover:bg-sys-accent/90 transition-colors"
              >
                <span>Панель керування розкладом</span>
                <span>→</span>
              </Link>
            </div>
          ) : (
            <Link
              href="/login"
              className="flex items-center justify-between rounded-xl border border-sys-border/60 bg-sys-bg/60 p-3 text-xs hover:border-sys-accent/40 hover:bg-sys-accent/5 transition-colors duration-fast ease-smooth group"
            >
              <div className="space-y-0.5">
                <div className="font-semibold text-sys-text-primary">Увійти до панелі керування</div>
                <div className="text-[11px] text-sys-text-secondary">Розклад, чернетки, довідники</div>
              </div>
              <span className="text-sys-accent font-bold group-hover:translate-x-0.5 transition-transform">→</span>
            </Link>
          )}
        </section>
      </main>
    </div>
  );
}
