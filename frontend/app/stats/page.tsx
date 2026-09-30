"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
// fallback to hardcoded API URL
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface StatItem {
  name: string;
  total: number;
  numerator: number;
  denominator: number;
  subjects: { name: string; count: number }[];
}

interface StatsResponse {
  groups: StatItem[];
  teachers: StatItem[];
}

export default function StatsPage() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"groups" | "teachers">("teachers");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetch(`${API_URL}/api/stats`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch");
        return res.json();
      })
      .then((data) => {
        setStats(data);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, []);

  const toggleExpand = (name: string) => {
    setExpanded(prev => ({ ...prev, [name]: !prev[name] }));
  };

  return (
    <main className="min-h-screen bg-sys-bg pb-24 text-sys-text-primary">
      <header className="border-b border-sys-border bg-sys-bg/80 sticky top-0 z-40 backdrop-blur-md">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <span className="text-xs font-black tracking-widest text-[#0b1120] bg-sys-accent px-2 py-0.5 rounded shadow-sm">ДФКР</span>
            <span className="font-bold text-lg">Статистика годин</span>
          </Link>
          <Link href="/" className="text-sm font-medium text-sys-text-secondary hover:text-sys-accent transition-colors">
            На головну →
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        <div className="mb-6 rounded-xl border border-sys-border bg-sys-card p-1 text-sm inline-flex">
          <button 
             onClick={() => setView("teachers")} 
             className={`rounded-lg px-4 py-2 font-medium transition-colors ${view === "teachers" ? "bg-sys-accent/10 text-sys-accent border border-sys-accent/20" : "text-sys-text-secondary hover:text-sys-text-primary"}`}
          >
            Викладачі
          </button>
          <button 
             onClick={() => setView("groups")} 
             className={`rounded-lg px-4 py-2 font-medium transition-colors ${view === "groups" ? "bg-sys-accent/10 text-sys-accent border border-sys-accent/20" : "text-sys-text-secondary hover:text-sys-text-primary"}`}
          >
            Групи
          </button>
        </div>

        {loading ? (
          <div className="rounded-xl border border-sys-border bg-sys-card p-12 text-center text-sys-text-secondary">
             Завантаження статистики...
          </div>
        ) : error ? (
          <div className="rounded-xl border border-rose-400/20 bg-rose-400/5 p-8 text-center text-rose-300">
             Помилка: {error}
          </div>
        ) : stats ? (
          <div className="space-y-4">
            <div className="text-sm text-sys-text-secondary mb-2 bg-sys-input rounded-lg p-3">
              Дані розраховані на основі <strong>двотижневого циклу</strong> (1 тиждень чисельника + 1 тиждень знаменника). Загальна сума — це кількість пар за 2 тижні.
            </div>
            
            {stats[view].map((item) => (
              <div key={item.name} className="overflow-hidden rounded-xl border border-sys-border bg-sys-card shadow-sm">
                <button 
                   onClick={() => toggleExpand(item.name)}
                   className="w-full flex items-center justify-between bg-white/[0.02] hover:bg-white/[0.04] p-4 text-left transition-colors"
                >
                  <div className="font-semibold text-[15px]">{item.name}</div>
                  <div className="flex items-center gap-3">
                     <span className="text-xs font-medium bg-sys-bg border border-sys-border px-2 py-1 rounded text-sys-text-secondary w-[130px] text-center hidden sm:block">
                        Чис: {item.numerator} | Знам: {item.denominator}
                     </span>
                     <span className="font-bold text-sys-accent bg-sys-accent/10 px-3 py-1 rounded-md text-sm border border-sys-accent/20 min-w-[50px] text-center">
                        {item.total}
                     </span>
                  </div>
                </button>
                
                {expanded[item.name] && item.subjects.length > 0 && (
                  <div className="border-t border-sys-border bg-sys-bg/30 p-4">
                    <ul className="space-y-2">
                       {item.subjects.map((subj, idx) => (
                         <li key={idx} className="flex justify-between items-center text-[13px] border-b border-sys-border/50 pb-2 last:border-0 last:pb-0">
                            <span className="text-sys-text-secondary pr-4">{subj.name}</span>
                            <span className="font-medium">{subj.count} пар</span>
                         </li>
                       ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
            
            {stats[view].length === 0 && (
               <div className="text-center text-sys-text-secondary py-12 border border-dashed border-sys-border rounded-xl">
                 Даних не знайдено
               </div>
            )}
          </div>
        ) : null}
      </div>
    </main>
  );
}
