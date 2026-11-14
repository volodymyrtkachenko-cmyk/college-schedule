"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth, canAccessAdmin } from "../../lib/auth";
import { sanitizeInternalRedirect } from "../../lib/navigation";

function LoginForm() {
  const { user, loading, login } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const explicitRedirect = sanitizeInternalRedirect(searchParams?.get("redirect"), "");
  const redirectTarget = explicitRedirect || (canAccessAdmin(user) ? "/admin" : "/");

  const [form, setForm] = useState({ username: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (user && !loading) {
      router.replace(redirectTarget);
    }
  }, [user, loading, router, redirectTarget]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const loggedInUser = await login(form.username, form.password);
      const nextTarget = explicitRedirect || (canAccessAdmin(loggedInUser) ? "/admin" : "/");
      router.replace(nextTarget);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не вдалося увійти. Перевірте дані та спробуйте ще раз.");
      setIsSubmitting(false);
    }
  };

  if (loading || user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-sys-bg p-6 text-sys-text-secondary">
        Завантаження…
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-sys-bg px-4 py-12 sm:px-6 lg:px-8 text-sys-text-primary">
      <div className="surface-panel w-full max-w-md space-y-8 p-6 shadow-xl sm:p-8">
        <div>
          <div className="mb-5 flex justify-center">
            <span className="rounded-md bg-sys-accent/15 px-2.5 py-1 text-sm font-black tracking-[0.18em] text-sys-accent border border-sys-accent/25">
              ДФКР
            </span>
          </div>
          <h2 className="mt-2 text-center text-3xl font-bold tracking-tight text-sys-text-primary">
            Вхід у систему
          </h2>
          <p className="mt-2 text-center text-sm text-sys-text-secondary">
            Для адміністраторів і редакторів розкладу
          </p>
        </div>
        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div className="space-y-4 rounded-md shadow-sm">
            <div>
              <label
                htmlFor="username"
                className="mb-1.5 block text-sm font-medium text-sys-text-secondary"
              >
                Ім’я користувача
              </label>
              <input
                id="username"
                name="username"
                type="text"
                autoComplete="username"
                required
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                className="form-control block w-full py-3 sm:text-sm"
                placeholder="Наприклад, admin"
              />
            </div>
            <div>
              <label
                htmlFor="password"
                className="mb-1.5 block text-sm font-medium text-sys-text-secondary"
              >
                Пароль
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="form-control block w-full py-3 sm:text-sm"
                placeholder="Пароль"
              />
            </div>
          </div>
          {error && <p className="text-sm text-rose-600 dark:text-rose-400 text-center font-medium">{error}</p>}
          <div className="space-y-3">
            <button
              type="submit"
              disabled={isSubmitting}
              className="group relative flex w-full justify-center rounded-lg border border-transparent bg-sys-accentSolid px-4 py-3 text-sm font-semibold text-sys-onAccent transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-50 shadow-sm"
            >
              {isSubmitting ? "Входимо…" : "Увійти"}
            </button>
            <div className="flex items-center justify-center gap-1.5 text-xs text-sys-text-secondary/80 text-center">
              <span>🔒</span>
              <span>Сесія зберігається на цьому пристрої протягом 30 днів</span>
            </div>
          </div>
          <div className="text-center pt-1">
            <a href="/" className="text-sm font-medium text-sys-accent hover:underline">
              Повернутися до розкладу
            </a>
          </div>
        </form>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-sys-bg p-6 text-sys-text-secondary">
          Завантаження…
        </main>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
