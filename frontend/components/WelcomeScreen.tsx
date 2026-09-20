import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ReferenceRecord } from "../lib/api";

interface WelcomeScreenProps {
  groups: ReferenceRecord[];
  teachers: ReferenceRecord[];
  initialMode: "student" | "teacher";
  onComplete: (mode: "student" | "teacher", id: number) => void;
}

export function WelcomeScreen({ groups, teachers, initialMode, onComplete }: WelcomeScreenProps) {
  const [step, setStep] = useState(1);
  const [mode, setMode] = useState<"student" | "teacher">(initialMode);
  const [search, setSearch] = useState("");
  
  const options = mode === "student" ? groups : teachers;
  const filtered = options.filter(o => o.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-sys-bg p-4 sm:p-6 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-sys-accent/5 to-transparent pointer-events-none" />
      
      <AnimatePresence mode="wait">
        {step === 1 ? (
          <motion.div 
            key="step1"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, x: -50 }}
            className="w-full max-w-md space-y-8 relative z-10"
          >
            <div className="text-center space-y-3">
              <div className="mx-auto w-16 h-16 rounded-2xl bg-sys-card border border-sys-border flex items-center justify-center mb-6 shadow-lg shadow-sys-bg">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-sys-accent"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"></path></svg>
              </div>
              <h1 className="text-3xl font-bold tracking-tight text-white">Вітаємо у ДФКР!</h1>
              <p className="text-sys-text-secondary text-lg">Оберіть свою роль, щоб налаштувати розклад під вас.</p>
            </div>
            
            <div className="grid grid-cols-1 gap-4">
              <button 
                onClick={() => { setMode("student"); setStep(2); }}
                className="group relative flex items-center gap-4 rounded-xl border border-sys-border bg-sys-card p-5 text-left transition-all hover:border-sys-accent/50 hover:bg-sys-card/80 active:scale-[0.98]"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-500/10 text-blue-400 group-hover:bg-blue-500/20 transition-colors">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>
                </div>
                <div>
                  <h3 className="font-semibold text-lg text-white">Я студент</h3>
                  <p className="text-sys-text-secondary text-sm">Перегляд розкладу для моєї групи</p>
                </div>
              </button>
              
              <button 
                onClick={() => { setMode("teacher"); setStep(2); }}
                className="group relative flex items-center gap-4 rounded-xl border border-sys-border bg-sys-card p-5 text-left transition-all hover:border-sys-accent/50 hover:bg-sys-card/80 active:scale-[0.98]"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400 group-hover:bg-emerald-500/20 transition-colors">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                </div>
                <div>
                  <h3 className="font-semibold text-lg text-white">Я викладач</h3>
                  <p className="text-sys-text-secondary text-sm">Перегляд моїх пар та планів</p>
                </div>
              </button>
            </div>
          </motion.div>
        ) : (
          <motion.div 
            key="step2"
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -50 }}
            className="w-full max-w-md flex flex-col h-[85vh] relative z-10"
          >
             <div className="mb-6">
                <button onClick={() => { setStep(1); setSearch(""); }} className="mb-4 flex items-center gap-2 text-sm text-sys-text-secondary hover:text-white transition-colors">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
                  Назад
                </button>
                <h2 className="text-2xl font-bold text-white mb-2">Оберіть {mode === "student" ? "вашу групу" : "ваше прізвище"}</h2>
             </div>
             
             <div className="relative mb-4 shrink-0">
               <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-sys-text-secondary" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
               <input 
                 autoFocus
                 type="text" 
                 placeholder="Пошук..." 
                 value={search}
                 onChange={(e) => setSearch(e.target.value)}
                 className="w-full rounded-xl border border-sys-border bg-sys-card py-3 pl-10 pr-4 text-white outline-none focus:border-sys-accent transition-colors"
               />
             </div>
             
             <div className="flex-1 overflow-y-auto min-h-0 pr-2 space-y-2 custom-scrollbar pb-6">
                {filtered.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => onComplete(mode, item.id)}
                    className="w-full rounded-lg border border-transparent bg-sys-card/50 p-4 text-left font-medium text-white transition-all hover:border-sys-border hover:bg-sys-card active:scale-[0.98]"
                  >
                    {item.name}
                  </button>
                ))}
                {filtered.length === 0 && (
                  <div className="text-center py-8 text-sys-text-secondary">
                    Нічого не знайдено
                  </div>
                )}
             </div>
          </motion.div>
        )}
      </AnimatePresence>
      <style dangerouslySetInnerHTML={{__html: `
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #1e2a42; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #2a3b5a; }
      `}} />
    </div>
  );
}
