"use client";

import Link from "next/link";
import { useAuth, canAccessAdmin } from "../../lib/auth";
import { useEffect, useRef, useState } from "react";
import { api, ReferenceResource } from "../../lib/api";

export const referenceLabels: Record<ReferenceResource, string> = {
  faculties: "Спеціальності", groups: "Групи", teachers: "Викладачі", subjects: "Предмети",
};

export function AdminNav({ active }: { active: string }) {
  const { user, logout } = useAuth();
    const [online, setOnline] = useState<number | null>(null);
  const [metrics, setMetrics] = useState<any>(null);
  const [isOpen, setIsOpen] = useState(false); // Mobile menu drawer toggle
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const logoutInFlight = useRef(false);

  const handleLogout = async () => {
    if (logoutInFlight.current) return;
    logoutInFlight.current = true;
    setIsLoggingOut(true);
    setLogoutError("");
    try {
      await logout();
    } catch (e: any) {
      setLogoutError(e.message || "Помилка виходу");
    } finally {
      logoutInFlight.current = false;
      setIsLoggingOut(false);
    }
  };

  useEffect(() => {
    const fetchMetrics = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const session = await api.auth.ensureAuthenticated();
                const data = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/api/metrics`, {
          headers: { "Authorization": `Bearer ${session.access_token}` }
        }).then(res => res.json());
        setOnline(data.online);
        setMetrics(data);
      } catch (e) {
        // fail silently
      }
    };
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 5_000);
    document.addEventListener("visibilitychange", fetchMetrics);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", fetchMetrics);
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isOpen]);

  const resources = Object.keys(referenceLabels) as ReferenceResource[];
  const linkClass = (isActive: boolean) =>
    `flex items-center rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
      isActive
        ? "border border-sys-accent/20 bg-sys-accent/10 text-sys-accent"
        : "border border-transparent text-sys-text-secondary hover:bg-white/5 hover:text-sys-text-primary"
    }`;

  // This renders the inner content of the sidebar navigation
  const NavigationLinks = () => (
    <nav aria-label="Адміністрування" className="flex flex-col h-full overflow-y-auto p-4 sm:p-5 pb-6">
       <div className="mb-8 flex items-center justify-between">
       <Link href="/" className="flex items-center gap-2 transition-opacity hover:opacity-80" title="Повернутися на сайт">
          <span className="text-[17px] font-black tracking-widest text-[#0b1120] bg-sys-accent px-2 py-1 rounded-md shadow-sm">ДФКР</span>
          <span className="font-bold text-lg text-sys-text-primary tracking-tight">Керування розкладом</span>
       </Link>
       <button
         type="button"
         aria-label="Закрити меню"
         onClick={() => setIsOpen(false)}
         className="rounded-lg p-2 text-sys-text-secondary transition-colors hover:bg-white/5 hover:text-sys-text-primary sm:hidden"
       >
         <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m18 6-12 12M6 6l12 12" /></svg>
       </button>
       </div>

        <div className="mb-2 pl-2 text-[11px] font-bold uppercase tracking-wider text-sys-text-secondary">Основне</div>
        <div className="space-y-1">
          <Link href="/admin?resource=schedule" onClick={() => setIsOpen(false)} className={linkClass(active === "schedule")}>
            Розклад
          </Link>

          {user?.role === "admin" && (
            <>
              <Link href="/admin?resource=import" onClick={() => setIsOpen(false)} className={linkClass(active === "import")}>
                Імпорт з КРЕ
              </Link>
              <Link href="/admin?resource=periods" onClick={() => setIsOpen(false)} className={linkClass(active === "periods")}>
                Періоди (Практики/Канікули)
              </Link>
              <Link href="/admin?resource=versions" onClick={() => setIsOpen(false)} className={linkClass(active === "versions")}>
                Версії
              </Link>
              <Link href="/admin?resource=semester" onClick={() => setIsOpen(false)} className={linkClass(active === "semester")}>
                Семестр
              </Link>

              <details
                className="group mt-2 rounded-lg border border-sys-border/40 bg-white/[0.02] p-1.5"
                open={["curriculum", "constraints", "generator"].includes(active)}
              >
                <summary className="flex cursor-pointer select-none items-center justify-between px-2 py-1.5 text-xs font-semibold text-sys-text-secondary transition-colors hover:text-sys-text-primary">
                  <span>⚙️ Автогенератор (Додатково)</span>
                  <span className="text-[10px] transition-transform group-open:rotate-180">▼</span>
                </summary>
                <div className="mt-1 space-y-1 pt-1 border-t border-sys-border/20">
                  <Link href="/admin?resource=curriculum" onClick={() => setIsOpen(false)} className={linkClass(active === "curriculum")}>
                    Навантаження
                  </Link>
                  <Link href="/admin?resource=constraints" onClick={() => setIsOpen(false)} className={linkClass(active === "constraints")}>
                    Обмеження
                  </Link>
                  <Link href="/admin?resource=generator" onClick={() => setIsOpen(false)} className={linkClass(active === "generator")}>
                    Автогенератор
                  </Link>
                </div>
              </details>
            </>
          )}
        </div>

        {user?.role === "admin" && (
          <>
            <div className="mb-2 mt-6 border-t border-sys-border/50 pl-2 pt-5 text-[11px] font-bold uppercase tracking-wider text-sys-text-secondary">Довідники</div>
            <div className="space-y-1">
              {(["groups", "teachers", "subjects", "faculties"] as ReferenceResource[]).map(r => (
                <Link key={r} href={`/admin?resource=${r}`} onClick={() => setIsOpen(false)} className={linkClass(active === r)}>
                  {referenceLabels[r]}
                </Link>
              ))}
              <Link href="/admin?resource=users" onClick={() => setIsOpen(false)} className={linkClass(active === "users")}>
                Користувачі
              </Link>
            </div>
          </>
        )}

       <div className="mt-auto pt-8 flex flex-col gap-3">
                      <div className="flex flex-col items-start gap-2 rounded-[10px] border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 shadow-sm mb-3">
              <div className="flex items-center justify-between w-full">
                <span className="text-[10px] text-emerald-600/80 dark:text-emerald-400/80 font-bold uppercase tracking-wider">
                  Онлайн зараз
                </span>
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
                </span>
              </div>

              <div className="flex items-baseline gap-1.5">
                <span className="text-xl font-black tracking-tight text-emerald-600 dark:text-emerald-400">
                  {online !== null ? online : "…"}
                </span>
                <span className="text-xs text-sys-text-secondary font-medium">
                  {online === 1 ? "користувач" : (online && online >= 2 && online <= 4 ? "користувачі" : "користувачів")}
                </span>
              </div>

              {metrics?.online_details && (
                <div className="flex flex-wrap gap-1.5 pt-1 w-full border-t border-emerald-500/10 text-[11px]">
                  {metrics.online_details.guests > 0 && (
                    <span className="inline-flex items-center gap-1 rounded bg-sys-bg/60 px-2 py-0.5 text-sys-text-secondary border border-sys-border/40 font-medium" title="Звичайні користувачі або студенти без авторизації">
                      <span>👤</span>
                      <span>{metrics.online_details.guests} {metrics.online_details.guests === 1 ? "гість/студент" : "студентів"}</span>
                    </span>
                  )}
                  {metrics.online_details.admins > 0 && (
                    <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-2 py-0.5 text-amber-500 dark:text-amber-400 border border-amber-500/25 font-semibold" title={metrics.online_details.staff?.filter((s: any) => s.role === 'admin').map((s: any) => s.name || s.username).join(', ')}>
                      <span>🛡️</span>
                      <span>{metrics.online_details.admins} {metrics.online_details.admins === 1 ? "адмін" : "адмінів"}</span>
                    </span>
                  )}
                  {metrics.online_details.editors > 0 && (
                    <span className="inline-flex items-center gap-1 rounded bg-blue-500/10 px-2 py-0.5 text-blue-500 dark:text-blue-400 border border-blue-500/25 font-semibold" title={metrics.online_details.staff?.filter((s: any) => s.role === 'editor').map((s: any) => s.name || s.username).join(', ')}>
                      <span>✏️</span>
                      <span>{metrics.online_details.editors} {metrics.online_details.editors === 1 ? "редактор" : "редакторів"}</span>
                    </span>
                  )}
                </div>
              )}

              {metrics?.online_details?.staff?.length > 0 && (
                <div className="flex flex-col gap-1 text-[11px] text-sys-text-secondary w-full pt-1">
                  {metrics.online_details.staff.map((s: any, idx: number) => (
                    <div key={idx} className="flex items-center gap-1.5 truncate text-emerald-600/90 dark:text-emerald-400/90">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 inline-block shrink-0"></span>
                      <span className="font-semibold truncate">{s.name || s.username}</span>
                      <span className="text-[10px] opacity-75 shrink-0">({s.role === "admin" ? "адмін" : "редактор"})</span>
                    </div>
                  ))}
                </div>
              )}
           </div>

           {metrics && (
             <div className="flex flex-col items-start gap-2 rounded-[10px] border border-sys-border bg-sys-card px-4 py-3 shadow-sm mb-3 text-xs text-sys-text-secondary">
               <span className="text-[10px] font-bold uppercase tracking-widest text-sys-text-primary">Стан системи</span>
               <div className="flex justify-between w-full"><span>Помилки:</span> <span className="font-medium">{(metrics.error_rate * 100).toFixed(1)}%</span></div>
               <div className="flex justify-between w-full"><span>Затримка:</span> <span className="font-medium">{metrics.avg_latency_ms.toFixed(0)} мс</span></div>
               <div className="flex justify-between w-full"><span>Фонові задачі:</span> <span className="font-medium">{metrics.active_jobs}</span></div>
               <div className="flex justify-between w-full"><span>Імпорт:</span> <span className="font-medium">{metrics.last_successful_import ? new Date(metrics.last_successful_import * 1000).toLocaleTimeString("uk-UA") : "Немає даних"}</span></div>
             </div>
           )}
           <div className="flex flex-col gap-1 w-full">
           <button
             disabled={isLoggingOut}
             onClick={() => { void handleLogout(); }}
             className={`w-full text-left flex items-center justify-center gap-2 px-3 py-2.5 text-[14px] font-bold rounded-[8px] ${isLoggingOut ? 'opacity-50 cursor-not-allowed text-rose-300 bg-rose-300/10' : 'text-rose-500/80 bg-rose-500/10 hover:text-rose-400 hover:bg-rose-500/20 active:scale-95'} transition-all`}
           >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
              {isLoggingOut ? "Вихід..." : "Вийти з облікового запису"}
           </button>
           {logoutError && <div role="alert" className="text-red-500 text-xs text-center font-medium mt-1">{logoutError}</div>}
           </div>
       </div>
    </nav>
  );

  return (
    <>
      {/* Mobile Top Header (only visible on sm and below) */}
      <div className="sm:hidden flex items-center justify-between px-4 py-3 bg-sys-bg border-b border-sys-border sticky top-0 z-40">
        <Link href="/" className="flex items-center gap-2">
          <span className="text-[14px] font-black tracking-widest text-[#0b1120] bg-sys-accent px-1.5 py-0.5 rounded shadow-sm">ДФКР</span>
          <span className="font-bold text-[15px] text-sys-text-primary">Керування розкладом</span>
        </Link>
        <button
          type="button"
          aria-label="Відкрити меню"
          aria-expanded={isOpen}
          aria-controls="admin-navigation"
          onClick={() => setIsOpen(true)}
          className="rounded-lg p-2 text-sys-text-secondary transition-colors hover:bg-white/5 hover:text-sys-text-primary"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="12" x2="20" y2="12"></line><line x1="4" y1="6" x2="20" y2="6"></line><line x1="4" y1="18" x2="20" y2="18"></line></svg>
        </button>
      </div>

      {/* Mobile Drawer Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-[60] bg-[#0b1120]/80 backdrop-blur-sm sm:hidden transition-opacity duration-300"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar Desktop/Drawer Container */}
      <aside id="admin-navigation" className={`fixed top-0 left-0 bottom-0 z-[70] w-[min(85vw,280px)] bg-sys-card border-r border-sys-border flex flex-col transition-transform duration-300 ease-in-out sm:translate-x-0 sm:w-[260px] ${isOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full"} sm:relative sm:z-0`}>
        {NavigationLinks()}
      </aside>
    </>
  );
}
