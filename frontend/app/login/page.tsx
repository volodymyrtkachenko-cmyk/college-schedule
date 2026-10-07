"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth, canAccessAdmin } from "../../lib/auth";

export default function LoginPage() {
  const { user, loading, login } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState({ username: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (user && !loading) {
      router.replace(canAccessAdmin(user) ? "/admin" : "/");
    }
  }, [user, loading, router]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await login(form.username, form.password);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не вдалося увійти. Перевірте дані та спробуйте ще раз.");
      setIsSubmitting(false);
    }
  };

  if (loading || user) {
    return <main className="flex min-h-screen items-center justify-center bg-sys-bg p-6 text-sys-text-secondary">Завантаження…</main>;
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-sys-bg px-4 py-12 sm:px-6 lg:px-8 text-sys-text-primary">
      <div className="surface-panel w-full max-w-md space-y-8 p-6 shadow-xl sm:p-8">
        <div>
          <div className="mb-5 flex justify-center">
            <span className="rounded-md bg-sys-accent px-2.5 py-1 text-sm font-black tracking-[0.18em] text-[#0b1120]">ДФКР</span>
          </div>
          <h2 className="mt-2 text-center text-3xl font-bold tracking-tight text-sys-text-primary">Вхід у систему</h2>
          <p className="mt-2 text-center text-sm text-sys-text-secondary">Для адміністраторів і редакторів розкладу</p>
        </div>
        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div className="space-y-4 rounded-md shadow-sm">
            <div>
              <label htmlFor="username" className="mb-1.5 block text-sm font-medium text-sys-text-secondary">Ім’я користувача</label>
              <input id="username" name="username" type="text" autoComplete="username" required value={form.username}
                     onChange={(e) => setForm({ ...form, username: e.target.value })}
                     className="form-control block w-full py-3 sm:text-sm"
                     placeholder="Наприклад, admin" />
            </div>
            <div>
              <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-sys-text-secondary">Пароль</label>
              <input id="password" name="password" type="password" autoComplete="current-password" required value={form.password}
                     onChange={(e) => setForm({ ...form, password: e.target.value })}
                     className="form-control block w-full py-3 sm:text-sm"
                     placeholder="Пароль" />
            </div>
          </div>
          {error && <p className="text-sm text-rose-400 text-center">{error}</p>}
          <div>
            <button type="submit" disabled={isSubmitting} className="group relative flex w-full justify-center rounded-lg border border-transparent bg-sys-accent px-4 py-3 text-sm font-semibold text-slate-950 transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-50">
              {isSubmitting ? "Входимо…" : "Увійти"}
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
