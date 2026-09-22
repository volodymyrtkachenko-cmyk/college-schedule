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
        const data = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "https://college-schedule-dpyg.onrender.com"}/api/metrics`, {
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

  const resources = Object.keys(referenceLabels) as ReferenceResource[];

  // This renders the inner content of the sidebar navigation
  const NavigationLinks = () => (
    <nav aria-label="Адміністрування" className="flex flex-col h-full overflow-y-auto p-4 sm:p-5 pb-6">
       <Link href="/" className="mb-8 flex items-center gap-2 hover:opacity-80 transition-opacity" title="Повернутися на сайт">
          <span className="text-[17px] font-black tracking-widest text-[#0b1120] bg-sys-accent px-2 py-1 rounded-md shadow-sm">ДФКР</span>
          <span className="font-bold text-lg text-sys-text-primary tracking-tight">Адмінка</span>
       </Link>

       <div className="text-[11px] font-bold uppercase tracking-wider text-sys-text-secondary mb-2 pl-2">Головна панель</div>
       <Link href="/admin?resource=schedule" onClick={() => setIsOpen(false)} className={`flex items-center gap-3 px-3 py-2.5 text-[15px] font-medium rounded-xl transition-all duration-200 active:scale-95 ${active === "schedule" ? "bg-sys-accent text-[#0b1120] shadow-md shadow-sys-accent/20" : "text-sys-text-secondary hover:text-sys-text-primary hover:bg-white/5"}`}>
         <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
         Розклад
       </Link>

       {user?.role === "admin" && (
         <>
           <div className="text-[11px] border-t border-sys-border/50 pt-5 font-bold uppercase tracking-wider text-sys-text-secondary mt-6 mb-2 pl-2">База даних</div>
           <div className="space-y-1">
             {resources.map(r => (
               <Link key={r} href={`/admin?resource=${r}`} onClick={() => setIsOpen(false)} className={`flex items-center gap-3 px-3 py-2 text-[14px] font-medium rounded-lg transition-colors ${active === r ? "bg-sys-accent/10 border border-sys-accent/20 text-sys-accent" : "text-sys-text-secondary hover:text-sys-text-primary hover:bg-white/5 border border-transparent"}`}>
                 {referenceLabels[r]}
               </Link>
             ))}
           </div>

           <div className="text-[11px] border-t border-sys-border/50 pt-5 font-bold uppercase tracking-wider text-sys-text-secondary mt-6 mb-2 pl-2">Доступ</div>
           <Link href="/admin?resource=users" onClick={() => setIsOpen(false)} className={`flex items-center gap-3 px-3 py-2 text-[14px] font-medium rounded-lg transition-colors ${active === "users" ? "bg-sys-accent/10 border border-sys-accent/20 text-sys-accent" : "text-sys-text-secondary hover:text-sys-text-primary hover:bg-white/5 border border-transparent"}`}>
             <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
             Менеджери
           </Link>
         </>
       )}

       <div className="mt-auto pt-8 flex flex-col gap-3">
           <div className="flex flex-col items-start gap-1.5 rounded-[10px] border border-emerald-500/10 bg-emerald-500/5 px-4 py-3 shadow-sm">
              <span className="text-[10px] text-emerald-600/70 dark:text-emerald-400/70 font-bold uppercase tracking-widest">Аналітика</span>
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2 shrink-0"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span></span>
                <span className="text-[13px] font-semibold text-emerald-600 dark:text-emerald-400">{online !== null ? online : "..."} на сайті</span>
              </div>
           </div>
           
           <button onClick={() => { setIsOpen(false); logout(); }} className="w-full text-left flex items-center justify-center gap-2 px-3 py-2.5 text-[14px] font-bold rounded-[8px] text-rose-500/80 bg-rose-500/10 hover:text-rose-400 hover:bg-rose-500/20 active:scale-95 transition-all">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
              Вийти з адмінки
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
          <span className="font-bold text-[15px] text-sys-text-primary">Адмінка</span>
        </Link>
        <button onClick={() => setIsOpen(true)} className="p-2 -mr-2 text-sys-text-secondary hover:text-sys-text-primary rounded-full hover:bg-white/5 active:scale-95 transition-all">
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
      <aside className={`fixed top-0 left-0 bottom-0 z-[70] w-[260px] bg-sys-card border-r border-sys-border flex flex-col transition-transform duration-300 ease-in-out sm:translate-x-0 ${isOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full"} sm:relative sm:z-0`}>
        {NavigationLinks()}
      </aside>
    </>
  );
}
