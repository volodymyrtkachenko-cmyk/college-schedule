"use client";

import Link from "next/link";
import { useAuth, canAccessAdmin } from "../../lib/auth";
import { useEffect, useState } from "react";
import { api, ReferenceResource } from "../../lib/api";

export const referenceLabels: Record<ReferenceResource, string> = {
  faculties: "Спеціальності", groups: "Групи", teachers: "Викладачі", subjects: "Предмети",
};

export function AdminNav({ active }: { active: string }) { 
  const { user, logout } = useAuth();
  const [online, setOnline] = useState<number | null>(null);
  const [isOpen, setIsOpen] = useState(false); // Mobile menu drawer toggle

  useEffect(() => {
    // Poll online metrics every 5 seconds
    const fetchMetrics = async () => {
      try {
        const session = await api.auth.ensureAuthenticated();
        const data = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/api/metrics`, {
          headers: { "Authorization": `Bearer ${session.access_token}` }
        }).then(res => res.json());
        setOnline(data.online);
      } catch (e) {
        // fail silently
      }
    };
    fetchMetrics();
    const iv = setInterval(fetchMetrics, 7000);
    return () => clearInterval(iv);
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

       <div className="mb-2 pl-2 text-[11px] font-bold uppercase tracking-wider text-sys-text-secondary">Розклад</div>
       <Link href="/admin?resource=schedule" onClick={() => setIsOpen(false)} className={linkClass(active === "schedule")}>
         Перегляд розкладу
       </Link>

       {user?.role === "admin" && (
         <>
           <div className="mb-2 mt-6 border-t border-sys-border/50 pl-2 pt-5 text-[11px] font-bold uppercase tracking-wider text-sys-text-secondary">Підготовка розкладу</div>
           <Link href="/admin?resource=generator" onClick={() => setIsOpen(false)} className={linkClass(active === "generator")}>
             Генератор розкладу
           </Link>
           <Link href="/admin?resource=constraints" onClick={() => setIsOpen(false)} className={linkClass(active === "constraints")}>
             Доступність викладачів
           </Link>
           <Link href="/admin?resource=curriculum" onClick={() => setIsOpen(false)} className={linkClass(active === "curriculum")}>
             Навчальне навантаження
           </Link>
           <Link href="/admin?resource=periods" onClick={() => setIsOpen(false)} className={linkClass(active === "periods")}>
             Практики й канікули
           </Link>
           <div className="mb-2 mt-6 border-t border-sys-border/50 pl-2 pt-5 text-[11px] font-bold uppercase tracking-wider text-sys-text-secondary">Довідкова інформація</div>
           <div className="space-y-1">
             {resources.map(r => (
               <Link key={r} href={`/admin?resource=${r}`} onClick={() => setIsOpen(false)} className={linkClass(active === r)}>
                 {referenceLabels[r]}
               </Link>
             ))}
           </div>

           <div className="mb-2 mt-6 border-t border-sys-border/50 pl-2 pt-5 text-[11px] font-bold uppercase tracking-wider text-sys-text-secondary">Користувачі</div>
           <Link href="/admin?resource=users" onClick={() => setIsOpen(false)} className={linkClass(active === "users")}>
             Облікові записи
           </Link>
         </>
       )}

       <div className="mt-auto pt-8 flex flex-col gap-3">
           <div className="flex flex-col items-start gap-1.5 rounded-[10px] border border-emerald-500/10 bg-emerald-500/5 px-4 py-3 shadow-sm">
              <span className="text-[10px] text-emerald-600/70 dark:text-emerald-400/70 font-bold uppercase tracking-widest">Відвідувачі</span>
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2 shrink-0"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span></span>
                <span className="text-[13px] font-semibold text-emerald-600 dark:text-emerald-400">{online !== null ? online : "…"} зараз на сайті</span>
              </div>
           </div>
           
           <button onClick={() => { setIsOpen(false); logout(); }} className="w-full text-left flex items-center justify-center gap-2 px-3 py-2.5 text-[14px] font-bold rounded-[8px] text-rose-500/80 bg-rose-500/10 hover:text-rose-400 hover:bg-rose-500/20 active:scale-95 transition-all">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
              Вийти з облікового запису
           </button>
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
