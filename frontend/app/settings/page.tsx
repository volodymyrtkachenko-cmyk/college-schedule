"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useTheme, Theme } from "../../lib/useTheme";
import { useUserSettings } from "../../lib/useUserSettings";
import { useClassroomSubmissions } from "../../lib/useClassroomSubmissions";
import { useAuth } from "../../lib/auth";

interface PinnedTarget {
  mode: "student" | "teacher";
  id: number;
  name: string;
}

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const { settings, updateSetting } = useUserSettings();
  const { isLinked, linkedEmail, unlink } = useClassroomSubmissions();
  const auth = useAuth();

  const [pins, setPins] = useState<PinnedTarget[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("schedule:pins");
      if (raw) setPins(JSON.parse(raw));
    } catch {}
  }, []);

  const handleRemovePin = (mode: "student" | "teacher", id: number) => {
    const next = pins.filter((p) => !(p.mode === mode && p.id === id));
    setPins(next);
    try {
      localStorage.setItem("schedule:pins", JSON.stringify(next));
      window.dispatchEvent(new Event("storage"));
    } catch {}
  };

  const handleClassroomLinkClick = () => {
    window.location.href = "/?sync=1";
  };

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
            Параметри інтерфейсу та розкладу для цього пристрою
          </p>
        </div>

        {/* Section 1: Розклад та кастомізація */}
        <section className="rounded-2xl border border-sys-border bg-sys-card p-4 sm:p-5 shadow-xs space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-sys-border/60">
            <span className="text-base">📅</span>
            <h2 className="text-sm font-bold uppercase tracking-wider text-sys-text-muted">
              Відображення розкладу
            </h2>
          </div>

          {/* Toggle: Homework badges */}
          <div className="flex items-start justify-between gap-4 py-1">
            <div className="space-y-0.5 min-w-0 pr-2">
              <span className="font-semibold text-xs sm:text-sm text-sys-text-primary">
                Показувати завдання (ДЗ) на парах
              </span>
              <p className="text-xs text-sys-text-secondary leading-relaxed">
                Мітки домашніх завдань у картках занять.
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

          <div className="h-px bg-sys-border/40" />

          {/* Setting: Preferred subgroup */}
          <div className="space-y-2 py-1">
            <span className="font-semibold text-xs sm:text-sm text-sys-text-primary">
              Бажана підгрупа за замовчуванням
            </span>
            <p className="text-xs text-sys-text-secondary">
              Автоматичний вибір для пар із поділом на підгрупи.
            </p>
            <div className="grid grid-cols-2 gap-1.5 rounded-xl border border-sys-border bg-sys-bg p-1 text-xs">
              <button
                type="button"
                onClick={() => updateSetting("defaultSubgroup", 1)}
                className={`py-1.5 px-2 rounded-lg font-semibold text-center transition-all ${
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
                className={`py-1.5 px-2 rounded-lg font-semibold text-center transition-all ${
                  settings.defaultSubgroup === 2
                    ? "bg-sys-accent text-white shadow-xs"
                    : "text-sys-text-secondary hover:text-sys-text-primary"
                }`}
              >
                2 підгрупа
              </button>
            </div>
          </div>

          <div className="h-px bg-sys-border/40 hidden lg:block" />

          {/* Setting: Default view Desktop */}
          <div className="space-y-2 py-1 hidden lg:block">
            <span className="font-semibold text-xs sm:text-sm text-sys-text-primary">
              Початковий вигляд розкладу
            </span>
            <p className="text-xs text-sys-text-secondary">
              Стартовий режим для великих екранів: день або тиждень.
            </p>
            <div className="grid grid-cols-2 gap-1.5 rounded-xl border border-sys-border bg-sys-bg p-1 text-xs">
              <button
                type="button"
                onClick={() => updateSetting("defaultViewDesktop", "week")}
                className={`py-1.5 px-2 rounded-lg font-semibold text-center transition-all ${
                  settings.defaultViewDesktop === "week"
                    ? "bg-sys-accent text-white shadow-xs"
                    : "text-sys-text-secondary hover:text-sys-text-primary"
                }`}
              >
                Тиждень (сітка)
              </button>
              <button
                type="button"
                onClick={() => updateSetting("defaultViewDesktop", "today")}
                className={`py-1.5 px-2 rounded-lg font-semibold text-center transition-all ${
                  settings.defaultViewDesktop === "today"
                    ? "bg-sys-accent text-white shadow-xs"
                    : "text-sys-text-secondary hover:text-sys-text-primary"
                }`}
              >
                День
              </button>
            </div>
          </div>
        </section>

        {/* Section 2: Тема оформлення */}
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
              className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg transition-all ${
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
              className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg transition-all ${
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
              className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg transition-all ${
                theme === "system"
                  ? "bg-sys-accent text-white shadow-xs"
                  : "text-sys-text-secondary hover:text-sys-text-primary"
              }`}
            >
              <span>💻</span>
              <span>Авто</span>
            </button>
          </div>
        </section>

        {/* Section 3: Google Classroom */}
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
                  <span className="truncate">{linkedEmail}</span>
                </div>
              ) : (
                <div className="text-slate-400 font-medium">Акаунт не прив&apos;язано</div>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {isLinked ? (
                <button
                  type="button"
                  onClick={unlink}
                  className="rounded-lg bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 px-3 py-1.5 text-xs font-semibold text-rose-400 transition-colors cursor-pointer"
                >
                  Від&apos;єднати
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleClassroomLinkClick}
                  className="rounded-lg bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/40 px-3 py-1.5 text-xs font-semibold text-sky-400 transition-colors cursor-pointer"
                >
                  Прив&apos;язати акаунт
                </button>
              )}
            </div>
          </div>
          <p className="text-xs text-sys-text-secondary leading-relaxed">
            Доступ до дзвінків, персональних оцінок та завдань.
          </p>
        </section>

        {/* Section 4: Закріплені розклади */}
        <section className="rounded-2xl border border-sys-border bg-sys-card p-4 sm:p-5 shadow-xs space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-sys-border/60">
            <span className="text-base">★</span>
            <h2 className="text-sm font-bold uppercase tracking-wider text-sys-text-muted">
              Закріплені розклади
            </h2>
          </div>

          {pins.length === 0 ? (
            <p className="text-xs text-sys-text-secondary">
              Немає закріплених розкладів. Натискайте зірочку біля селектора для збереження.
            </p>
          ) : (
            <div className="space-y-1.5">
              {pins.map((pin) => (
                <div
                  key={`pin-${pin.mode}-${pin.id}`}
                  className="flex items-center justify-between rounded-xl border border-sys-border/60 bg-sys-bg/60 px-3 py-2 text-xs"
                >
                  <div className="flex items-center gap-2 min-w-0 pr-2">
                    <span className="text-amber-400 font-bold">★</span>
                    <span className="font-semibold text-sys-text-primary truncate">{pin.name}</span>
                    <span className="rounded px-1.5 py-0.2 text-[10px] font-semibold bg-sys-bg text-sys-text-secondary border border-sys-border">
                      {pin.mode === "student" ? "Група" : "Викладач"}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemovePin(pin.mode, pin.id)}
                    title="Видалити зі збережених"
                    className="flex h-6 w-6 items-center justify-center rounded-md border border-sys-border/60 text-sys-text-secondary hover:text-rose-400 hover:border-rose-400/40 transition-colors"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Section 5: Корисні посилання */}
        <section className="rounded-2xl border border-sys-border bg-sys-card p-4 sm:p-5 shadow-xs space-y-3">
          <div className="flex items-center gap-2 pb-2 border-b border-sys-border/60">
            <span className="text-base">🔗</span>
            <h2 className="text-sm font-bold uppercase tracking-wider text-sys-text-muted">
              Корисні посилання та інструменти
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            <Link
              href="/statistics"
              className="flex items-center justify-between rounded-xl border border-sys-border/60 bg-sys-bg/60 p-3 hover:border-purple-500/40 hover:bg-purple-500/5 transition-all group"
            >
              <span className="flex items-center gap-2.5 font-semibold text-sys-text-primary">
                <span className="text-base">📊</span>
                <span>Статистика занять</span>
              </span>
              <span className="text-purple-400 group-hover:translate-x-0.5 transition-transform">↗</span>
            </Link>

            <Link
              href="/educational-process"
              className="flex items-center justify-between rounded-xl border border-sys-border/60 bg-sys-bg/60 p-3 hover:border-indigo-500/40 hover:bg-indigo-500/5 transition-all group"
            >
              <span className="flex items-center gap-2.5 font-semibold text-sys-text-primary">
                <span className="text-base">📅</span>
                <span>Графік навчального процесу</span>
              </span>
              <span className="text-indigo-400 group-hover:translate-x-0.5 transition-transform">↗</span>
            </Link>
          </div>
        </section>

        {/* Section 6: Вхід для адміністрації */}
        <section className="rounded-2xl border border-sys-border bg-sys-card p-4 sm:p-5 shadow-xs space-y-3">
          <div className="flex items-center gap-2 pb-2 border-b border-sys-border/60">
            <span className="text-base">🛡️</span>
            <h2 className="text-sm font-bold uppercase tracking-wider text-sys-text-muted">
              Вхід для адміністрації
            </h2>
          </div>

          {auth?.user ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs">
                <div>
                  <div className="font-bold text-emerald-400">Авторизовано: {auth.user.username}</div>
                  <div className="text-sys-text-secondary text-[11px]">Роль: {auth.user.role}</div>
                </div>
                <button
                  type="button"
                  onClick={() => auth.logout()}
                  className="rounded-lg bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 px-3 py-1.5 text-xs font-semibold text-rose-400 transition-colors"
                >
                  Вийти
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
              className="flex items-center justify-between rounded-xl border border-sys-border/60 bg-sys-bg/60 p-3 text-xs hover:border-sys-accent/40 hover:bg-sys-accent/5 transition-all group"
            >
              <div className="space-y-0.5">
                <div className="font-semibold text-sys-text-primary">Вхід для адміністрації</div>
                <div className="text-[11px] text-sys-text-secondary">Керування розкладом та чернетками</div>
              </div>
              <span className="text-sys-accent font-bold group-hover:translate-x-0.5 transition-transform">→</span>
            </Link>
          )}
        </section>
      </main>
    </div>
  );
}
