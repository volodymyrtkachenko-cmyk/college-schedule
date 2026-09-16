"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/auth";

export default function LoginPage() {
  const { user, loading, login } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState({ username: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (user && !loading) {
      router.replace(user.role === "admin" ? "/admin" : "/");
    }
  }, [user, loading, router]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await login(form.username, form.password);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Помилка входу");
      setIsSubmitting(false);
    }
  };

  if (loading || user) {
    return <main className="flex min-h-screen items-center justify-center bg-sys-bg p-6 text-sys-text-secondary">Завантаження…</main>;
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-sys-bg px-4 py-12 sm:px-6 lg:px-8 text-sys-text-primary">
      <div className="w-full max-w-md space-y-8 rounded-2xl border border-sys-border bg-sys-card p-8 shadow-xl">
        <div>
          <h2 className="mt-2 text-center text-3xl font-bold tracking-tight text-sys-text-primary">Вхід в систему</h2>
          <p className="mt-2 text-center text-sm text-sys-text-secondary">Сторінка для адміністраторів розкладу</p>
        </div>
        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div className="space-y-4 rounded-md shadow-sm">
            <div>
              <label htmlFor="username" className="sr-only">Логін</label>
              <input id="username" name="username" type="text" required value={form.username}
                     onChange={(e) => setForm({ ...form, username: e.target.value })}
                     className="relative block w-full rounded-lg border border-sys-border bg-slate-800 px-3 py-3 text-sys-text-primary placeholder-slate-400 focus:z-10 focus:border-sys-accent focus:outline-none focus:ring-1 focus:ring-cyan-400 sm:text-sm"
                     placeholder="Логін" />
            </div>
            <div>
              <label htmlFor="password" className="sr-only">Пароль</label>
              <input id="password" name="password" type="password" required value={form.password}
                     onChange={(e) => setForm({ ...form, password: e.target.value })}
                     className="relative block w-full rounded-lg border border-sys-border bg-slate-800 px-3 py-3 text-sys-text-primary placeholder-slate-400 focus:z-10 focus:border-sys-accent focus:outline-none focus:ring-1 focus:ring-cyan-400 sm:text-sm"
                     placeholder="Пароль" />
            </div>
          </div>
          {error && <p className="text-sm text-rose-400 text-center">{error}</p>}
          <div>
            <button type="submit" disabled={isSubmitting} className="group relative flex w-full justify-center rounded-lg border border-transparent bg-cyan-500 px-4 py-3 text-sm font-semibold text-slate-950 hover:bg-sys-accent focus:outline-none disabled:opacity-50">
              {isSubmitting ? "Вхід..." : "Увійти"}
            </button>
          </div>
          <div className="text-center">
             <a href="/" className="text-sm font-medium text-sys-accent hover:text-sys-accent">Повернутися до розкладу</a>
          </div>
        </form>
      </div>
    </main>
  );
}
