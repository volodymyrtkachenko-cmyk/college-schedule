"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { BottomNav } from "../components/BottomNav";
import { OfflineIndicator } from "../components/OfflineIndicator";
import { InstallPrompt } from "../components/InstallPrompt";
import { ScheduleDay } from "../components/ScheduleDay";
import { ScheduleWeekGrid } from "../components/ScheduleWeekGrid";
import { WeekTypeBadge } from "../components/WeekTypeBadge";
import { useSchedule, useIsStandalonePwa, downloadForOffline } from "../lib/hooks";
import { useAuth } from "../lib/auth";
import { useRouter } from "next/navigation";
import { getMondayOf } from "../lib/date";
import { WelcomeScreen } from "../components/WelcomeScreen";

export default function HomePage() {
  const [weekAnchorDate, setWeekAnchorDate] = useState(() => {
    const date = new Date();
    const day = date.getDay();
    if (day === 0 || day === 6) {
        date.setDate(date.getDate() + (day === 0 ? 1 : 2));
    }
    return getMondayOf(date);
  });

  const isCurrentWeek = useMemo(() => {
    const todayAnchor = getMondayOf(new Date());
    return Math.abs(weekAnchorDate.getTime() - todayAnchor.getTime()) < 1000 * 60 * 60 * 24;
  }, [weekAnchorDate]);

  const { isSetupComplete, completeSetup, resetSetup, mode, toggleMode, teachers, teacherId, setTeacherId, groups, groupId, setGroupId, today, week, loading, error } = useSchedule(weekAnchorDate);
  const { user, loading: authLoading, logout } = useAuth();
  
  const isStandalone = useIsStandalonePwa();
  const [isDownloading, setIsDownloading] = useState(false);
  const [isDownloaded, setIsDownloaded] = useState(false);

  useEffect(() => {
    const targetKey = mode === "student" ? `groupId:${groupId}` : `teacherId:${teacherId}`;
    if (typeof window !== "undefined") {
      setIsDownloaded(!!localStorage.getItem(`offline_marker:${targetKey}`));
    }
  }, [mode, groupId, teacherId]);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const handleDownloadOffline = async () => {
    setIsDownloading(true);
    try {
      const target = mode === "student" ? { groupId: groupId ?? undefined } : { teacherId: teacherId ?? undefined };
      await downloadForOffline(target, weekAnchorDate);
      setIsDownloaded(true);
      setToast({ message: "Розклад збережено для офлайн-режиму", type: "success" });
    } catch (e) {
      console.error(e);
      setToast({ message: `Не вдалось завантажити: ${e instanceof Error ? e.message : String(e)}`, type: "error" });
    } finally {
      setIsDownloading(false);
    }
  };
  
  // Easter Egg states
  const router = useRouter();
  const [clickCount, setClickCount] = useState(0);

  useEffect(() => {
    if (clickCount > 0) {
      const timer = setTimeout(() => setClickCount(0), 1000);
      return () => clearTimeout(timer);
    }
  }, [clickCount]);

  const handleSecretClick = () => {
    setClickCount(prev => {
      if (prev + 1 >= 5) {
        router.push("/login");
        return 0;
      }
      return prev + 1;
    });
  };

  const [view, setView] = useState<"today" | "week">("today");
  const weekType = view === "week" ? ((week?.[0]?.week_type) ?? "both") : (today?.week_type ?? "both");

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const weekRange = useMemo(() => {
    const end = new Date(weekAnchorDate);
    end.setDate(end.getDate() + 6);
    return `${new Intl.DateTimeFormat("uk-UA", { day: "numeric", month: "long" }).format(weekAnchorDate)} – ${new Intl.DateTimeFormat("uk-UA", { day: "numeric", month: "long", year: "numeric" }).format(end)}`;
  }, [weekAnchorDate]);

  const resetWeek = () => setWeekAnchorDate(getMondayOf(new Date()));

  if (!loading && !isSetupComplete) {
    return <WelcomeScreen groups={groups} teachers={teachers} initialMode={mode} onComplete={(m, id) => {
        toggleMode(m);
        if (m === "student") setGroupId(id);
        else setTeacherId(id);
        completeSetup();
    }} />;
  }

  return (
    <main className="min-h-screen bg-sys-bg pb-24 text-sys-text-primary md:pb-8">
      <OfflineIndicator />
      <InstallPrompt />
      <header className="border-b border-sys-border bg-sys-bg/80">
        <div className="mx-auto flex max-w-[1800px] flex-col md:flex-row md:items-center justify-between gap-4 px-3 py-5 sm:px-5 lg:px-6 xl:px-8">
          <div>
            <a href="https://kre.dp.ua/" target="_blank" rel="noopener noreferrer" className="inline-block hover:opacity-80 transition-opacity" title="Головна сторінка закладу">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-sys-accent">ДФКР</p>
            </a>
            <h1 onClick={handleSecretClick} className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl cursor-pointer select-none">Розклад занять</h1>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center gap-4 w-full md:w-auto">
            {isStandalone && !isDownloaded && (
              <button 
                type="button" 
                onClick={handleDownloadOffline} 
                disabled={isDownloading} 
                className="flex items-center gap-2 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-4 py-2 rounded-xl text-sm font-medium transition-colors hover:bg-emerald-500/20 disabled:opacity-50 h-[38px] sm:h-auto"
              >
                {isDownloading ? (
                  <span className="flex items-center gap-2"><svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25"></circle><path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" className="opacity-75"></path></svg> Завантаження...</span>
                ) : "📥 Завантажити для офлайн"}
              </button>
            )}
            
            <div className="flex items-center justify-between sm:justify-start gap-4">
              <div className="flex items-center gap-2 bg-sys-card border border-sys-border px-4 py-2 rounded-xl">
                 <span className="font-medium text-white shadow-sm flex items-center gap-2 truncate max-w-[200px]">
                   {mode === "student" ? groups.find(g => g.id === groupId)?.name || "Не обрано" : teachers.find(t => t.id === teacherId)?.name || "Не обрано"}
                 </span>
                 <button onClick={resetSetup} className="ml-3 flex items-center gap-1.5 text-xs font-medium text-sys-text-secondary hover:text-white transition-colors bg-sys-bg/50 px-2.5 py-1 rounded-md border border-sys-border" title="Змінити налаштування" type="button">
                   <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                   Змінити
                 </button>
              </div>
            </div>

            {user && (
              <div className="flex items-center gap-2 ml-auto sm:ml-0 mt-2 sm:mt-0">
                {user.role === "admin" && <a href="/admin" className="rounded-lg border border-cyan-400/40 px-3 py-2 text-sm font-medium text-cyan-300 whitespace-nowrap shadow-sm hover:bg-cyan-500/10 transition-colors">Панель керування</a>}
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1800px] px-3 py-6 sm:px-5 lg:px-6 xl:px-8">
        <div className="mb-6 hidden items-center justify-between md:flex">
          <div>
            <p className="text-sm text-sys-text-secondary">{view === "today" ? "Поточний день" : "Навчальний тиждень"}</p>
            <h2 className="text-xl font-semibold">{view === "today" ? "Сьогодні" : "Усі дні"}</h2>
          </div>
          
          <div className="flex rounded-lg border border-sys-border bg-sys-card p-1 text-sm relative">
            <div className="absolute top-1 bottom-1 w-[calc(50%-4px)] bg-sys-accent/10 border border-sys-accent/20 rounded-md shadow-sm transition-all duration-300 ease-out z-0" style={{ left: view === 'today' ? '4px' : 'calc(50% + 2px)' }}></div>
            <button key="today" onClick={() => setView("today")} className={`w-24 relative z-10 rounded-md px-4 py-2 text-sm font-medium transition-colors ${view === 'today' ? 'text-sys-accent' : 'text-sys-text-secondary hover:text-sys-text-primary'}`}>Сьогодні</button>
            <button key="week" onClick={() => setView("week")} className={`w-24 relative z-10 rounded-md px-4 py-2 text-sm font-medium transition-colors ${view === 'week' ? 'text-sys-accent' : 'text-sys-text-secondary hover:text-sys-text-primary'}`}>Тиждень</button>
          </div>
        </div>

        {loading ? (
          <div className="rounded-2xl border border-sys-border bg-sys-card/50 p-12 text-center text-sys-text-secondary">Завантаження розкладу…</div>
        ) : error ? (
          <div className="rounded-2xl border border-rose-400/20 bg-rose-400/5 p-8 text-center text-rose-200">{error}</div>
        ) : today ? (
          <div>
            <div className={view === "today" ? "block" : "hidden"}>
              <div className="mb-4 mt-2 flex justify-end">
                 <WeekTypeBadge weekType={today.week_type} />
              </div>
              <ScheduleDay schedule={today} isToday scheduleMode={mode} canEdit={false} />
            </div>
            
            <div className={view === "week" ? "block w-full min-w-0" : "hidden"}>
               <div className="mb-4 mt-2 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center rounded-xl bg-sys-card p-3 border border-sys-border/50">
                  <div className="text-[13px] font-medium text-sys-text-primary flex items-center gap-2 w-full sm:w-auto overflow-hidden">
                    <svg width="1.2em" height="1.2em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-sys-accent shrink-0"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                    <span className="truncate">{weekRange}</span>
                    <div className="ml-2 hidden sm:block shrink-0"><WeekTypeBadge weekType={weekType} /></div>
                  </div>
                  <div className="flex w-full sm:w-auto items-center justify-between gap-3">
                     <div className="sm:hidden shrink-0"><WeekTypeBadge weekType={weekType} /></div>
                     <div className="flex w-full sm:w-auto rounded-lg border border-sys-border bg-sys-card p-1 text-sm relative">
                    <div className="absolute top-1 bottom-1 w-[calc(50%-4px)] bg-sys-bg border border-sys-border/50 rounded-md shadow-sm transition-all duration-300 ease-out z-0" style={{ left: isCurrentWeek ? '4px' : 'calc(50% + 2px)' }} />
                    <button type="button" onClick={resetWeek} className={`relative z-10 flex-1 sm:flex-none sm:w-28 text-center rounded-md px-3 py-1.5 font-medium transition-colors ${isCurrentWeek ? 'text-sys-text-primary' : 'text-sys-text-secondary hover:text-sys-text-primary'}`}>Поточний</button>
                    <button type="button" onClick={() => {
                      const nextAnchor = getMondayOf(new Date());
                      nextAnchor.setDate(nextAnchor.getDate() + 7);
                      setWeekAnchorDate(nextAnchor);
                    }} className={`relative z-10 flex-1 sm:flex-none sm:w-28 text-center rounded-md px-3 py-1.5 font-medium transition-colors ${!isCurrentWeek ? 'text-sys-text-primary' : 'text-sys-text-secondary hover:text-sys-text-primary'}`}>Наступний</button>
                  </div>
                </div>
               </div>
              <ScheduleWeekGrid week={week} scheduleMode={mode} canEdit={false} />
            </div>
          </div>
        ) : null}
        
        {!loading && !error && !groups.length && <div className="rounded-2xl border border-dashed border-sys-border p-12 text-center text-sys-text-secondary">Активних груп поки немає.</div>}
        
        {toast && (
          <div className={`fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:bottom-6 z-[100] flex animate-in slide-in-from-bottom-5 items-center gap-2 rounded-[8px] border px-4 py-3 text-sm shadow-2xl backdrop-blur-md ${
            toast.type === "success"
            ? "border-emerald-500/40 bg-emerald-950/90 text-emerald-200"
            : "border-rose-500/40 bg-rose-950/90 text-rose-200"
          }`}>
             {toast.type === "success" 
               ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="M5 12l5 5l10 -10"/></svg>
               : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
             }
             {toast.message}
          </div>
        )}
      </div>

      <BottomNav view={view} onViewChange={setView} />
    </main>
  );
}
