"use client";

import { useEffect, useState } from "react";
import { api, DraftRecord, DraftSlotRecord } from "../../lib/api";
import { ConfirmModal } from "./ConfirmModal";

export function GeneratorPanel() {
  const [drafts, setDrafts] = useState<DraftRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [activeDraft, setActiveDraft] = useState<DraftRecord | null>(null);
  const [slots, setSlots] = useState<DraftSlotRecord[]>([]);
  const [filterGroup, setFilterGroup] = useState<string>("");
  const [draftToDelete, setDraftToDelete] = useState<DraftRecord | null>(null);
  
  const [toast, setToast] = useState<{message: string, type: "success"|"error"} | null>(null);

  useEffect(() => {
    loadDrafts();
  }, []);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  async function loadDrafts() {
    try {
      const session = await api.auth.ensureAuthenticated();
      const res = await api.generator.listDrafts(session.access_token);
      setDrafts(res);
    } catch(err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadSlots(d: DraftRecord) {
    try {
      setLoading(true);
      const session = await api.auth.ensureAuthenticated();
      const res = await api.generator.getSlots(d.id, session.access_token);
      setSlots(res);
      setActiveDraft(d);
    } catch(err: any) {
      setToast({message: err.message, type: "error"});
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerate() {
    try {
      setGenerating(true);
      const session = await api.auth.ensureAuthenticated();
      const job = await api.generator.generate(session.access_token);
      const startedAt = Date.now();
      let completed = job;
      while (completed.status === "GENERATING" && Date.now() - startedAt < 12 * 60 * 1000) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        completed = await api.generator.getDraft(job.id, session.access_token);
      }
      if (completed.status === "TIMEOUT") {
        throw new Error("Не вдалося знайти розклад за 10 хвилин. Перевірте навантаження та спробуйте на сервері з більшою кількістю CPU.");
      }
      if (completed.status === "INFEASIBLE") {
        throw new Error("Обмеження розкладу несумісні. Перевірте навантаження, закріплені пари та доступність викладачів.");
      }
      if (completed.status === "FAILED") {
        throw new Error("Фонове створення розкладу завершилося помилкою. Перевірте логи Render.");
      }
      if (completed.status === "GENERATING") {
        throw new Error(`Генерація ще триває. Перевірте стан чернетки #${job.id} трохи пізніше.`);
      }
      if (completed.status !== "DRAFT") {
        throw new Error(`Генерація завершилася зі статусом ${completed.status}. Перевірте логи Render.`);
      }
      setToast({message: "Згенеровано успішно!", type: "success"});
      await loadDrafts();
    } catch(err: any) {
      setToast({message: err.message, type: "error"});
    } finally {
      setGenerating(false);
    }
  }

  async function handleDelete(id: number) {
    try {
      const session = await api.auth.ensureAuthenticated();
      await api.generator.deleteDraft(id, session.access_token);
      setToast({message: "Видалено!", type: "success"});
      await loadDrafts();
    } catch(err: any) {
      setToast({message: err.message, type: "error"});
    } finally {
      setDraftToDelete(null);
    }
  }

  async function handlePublish(id: number) {
    if (!confirm("Опублікувати цей розклад? Поточний бойовий розклад буде замінено.")) return;
    try {
      const session = await api.auth.ensureAuthenticated();
      await api.generator.publish(id, session.access_token);
      setToast({message: "Розклад успішно опубліковано і він вже на сайті!", type: "success"});
      await loadDrafts();
    } catch(err: any) {
      setToast({message: err.message, type: "error"});
    }
  }

  async function handleMove(slotId: number, day: number, lesson: number, week: string) {
    try {
      const session = await api.auth.ensureAuthenticated();
      const updated = await api.generator.moveSlot(slotId, day, lesson, week, session.access_token);
      setSlots(curr => curr.map(s => s.id === updated.id ? updated : s));
      setToast({message: "Пару переміщено", type: "success"});
    } catch(err: any) {
      setToast({message: err.message, type: "error"});
    }
  }

  if (activeDraft) {
    const days = [1,2,3,4,5];
    const dict = {1:"ПН", 2:"ВТ", 3:"СР", 4:"ЧТ", 5:"ПТ"};
    
    return (
      <div className="flex flex-col gap-4">
        <div className="flex justify-between items-center bg-sys-card p-4 rounded-xl border border-sys-border">
           <div>
             <h2 className="text-lg font-bold">{activeDraft.name}</h2>
             <span className="text-sm text-sys-text-secondary">Статус: {activeDraft.status}</span>
           </div>
           <div className="flex gap-4 items-center">
             <input type="search" aria-label="Пошук за назвою групи" placeholder="Пошук групи..." value={filterGroup} onChange={e=>setFilterGroup(e.target.value)} className="form-control min-w-0 flex-1 sm:w-56" />
             <button onClick={() => setActiveDraft(null)} className="shrink-0 rounded-lg border border-sys-border px-4 py-2 text-sm font-semibold transition-colors hover:bg-white/5">Назад до списку</button>
           </div>
        </div>
        
        <div className="flex gap-4 overflow-x-auto pb-4">
          {["numerator", "denominator"].map(week => (
             <div key={week} className="flex-1 min-w-[600px] border border-sys-border rounded-xl bg-[#0b1120] p-4 flex flex-col gap-2">
                <h3 className="text-center font-bold text-sys-text-secondary uppercase tracking-widest text-xs mb-2">
                  {week === "numerator" ? "Чисельник" : "Знаменник"}
                </h3>
                
                <div className="grid grid-cols-6 gap-2 border-b border-sys-border/50 pb-2">
                  <div></div>
                  {days.map(d => <div key={d} className="text-center font-bold text-sys-text-secondary text-sm">{dict[d as keyof typeof dict]}</div>)}
                </div>
                
                {[1,2,3,4].map(lesson => (
                  <div key={lesson} className="grid grid-cols-6 gap-2">
                    <div className="flex items-center justify-center font-black text-sys-text-muted text-xl">{lesson}</div>
                    
                    {days.map(day => (
                       <div key={day} className="bg-sys-input/50 rounded-lg min-h-[80px] p-1 border border-transparent hover:border-sys-accent/30 transition-colors"
                            onDragOver={e => e.preventDefault()}
                            onDrop={e => {
                               e.preventDefault();
                               const slotId = parseInt(e.dataTransfer.getData("slot_id"));
                               if (slotId) handleMove(slotId, day, lesson, week);
                            }}>
                          {slots.filter(s => s.day_of_week === day && s.lesson_number === lesson && (s.week_type === week || s.week_type === "both") && s.curriculum.group.name.toLowerCase().includes(filterGroup.toLowerCase()))
                                .map(s => (
                             <div key={s.id} draggable onDragStart={e => e.dataTransfer.setData("slot_id", s.id.toString())} className="bg-sys-card border border-sys-border shadow-sm p-1.5 mb-1 rounded cursor-grab active:cursor-grabbing text-xs flex flex-col gap-0.5">
                                <b className="text-sys-accent">{s.curriculum.group.name}</b>
                                <span className="font-semibold text-sys-text-primary leading-tight">{s.curriculum.subject.name}</span>
                                <span className="text-[10px] text-sys-text-secondary">{s.curriculum.teacher.name}</span>
                             </div>
                          ))}
                       </div>
                    ))}
                  </div>
                ))}
             </div>
          ))}
        </div>
        
        {toast && <Toast toast={toast} />}
      </div>
    );
  }

  return (
    <>
      <div className="mt-2 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
         <div>
           <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sys-accent">Виробництво</p>
           <h1 className="mt-1 text-xl font-bold">Генератор розкладу</h1>
         </div>
         <button onClick={handleGenerate} disabled={generating} className="shrink-0 rounded-[6px] bg-emerald-500 px-4 py-2 text-sm font-semibold text-[#0b1120] hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-wait flex items-center gap-2">
            {generating ? (
              <>
                <svg className="animate-spin h-4 w-4 text-[#0b1120]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" d="M4 12a8 8 0 018-8v8H4z"></path></svg>
                Пошук розкладу (до 10 хв)...
              </>
            ) : "+ Згенерувати новий розклад"}
         </button>
      </div>

      {loading ? (
        <div className="mt-8 text-center text-sys-text-secondary">Завантаження...</div>
      ) : error ? (
        <div className="mt-8 text-center text-rose-500">{error}</div>
      ) : (
        <div className="surface-panel mt-6 overflow-x-auto">
          <table className="w-full min-w-[700px] border-collapse text-left text-sm">
            <thead className="bg-[#111827]">
              <tr>
                <th className="px-5 py-4 font-semibold text-sys-text-secondary text-xs uppercase tracking-wider">ID</th>
                <th className="px-5 py-4 font-semibold text-sys-text-secondary text-xs uppercase tracking-wider">Назва/Дата</th>
                <th className="px-5 py-4 font-semibold text-sys-text-secondary text-xs uppercase tracking-wider">Статус</th>
                <th className="px-5 py-4 font-semibold text-sys-text-secondary text-right min-w-[200px]">Дії</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sys-border/50">
              {drafts.map(d => (
                <tr key={d.id} className="hover:bg-white/[0.02] transition-colors">
                  <td className="px-5 py-3 whitespace-nowrap text-sys-text-muted">#{d.id}</td>
                  <td className="px-5 py-3 font-semibold text-sys-text-primary">{d.name}</td>
                  <td className="px-5 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider ${d.status === 'published' ? 'bg-emerald-500/10 text-emerald-400' : d.status === 'DRAFT' ? 'bg-amber-500/10 text-amber-400' : 'bg-gray-500/10 text-gray-400'}`}>{d.status}</span>
                  </td>
                  <td className="px-5 py-3 text-right flex justify-end gap-2">
                    <button onClick={() => loadSlots(d)} className="px-3 py-1.5 text-xs font-semibold rounded bg-sys-accent/10 text-sys-accent hover:bg-sys-accent/20 transition">Відкрити</button>
                    {d.status !== 'published' && (
                       <button onClick={() => handlePublish(d.id)} className="px-3 py-1.5 text-xs font-semibold rounded bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition">Опублікувати</button>
                    )}
                    <button onClick={() => setDraftToDelete(d)} className="px-3 py-1.5 text-xs font-semibold rounded bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 transition">Видалити</button>
                  </td>
                </tr>
              ))}
              {drafts.length === 0 && (
                <tr>
                   <td colSpan={4} className="px-5 py-8 text-center text-sys-text-secondary">Нічого не знайдено. Згенеруйте розклад.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {toast && <Toast toast={toast} />}
      <ConfirmModal
        isOpen={draftToDelete !== null}
        title="Видалити розклад?"
        message={draftToDelete ? `Чернетку «${draftToDelete.name}» та всі її пари буде видалено без можливості відновлення.` : undefined}
        onConfirm={() => {
          if (draftToDelete) void handleDelete(draftToDelete.id);
        }}
        onCancel={() => setDraftToDelete(null)}
      />
    </>
  );
}

function Toast({toast}: {toast: {message: string, type: "success"|"error"}}) {
  return (
    <div className={`fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:bottom-6 z-[200] flex animate-in slide-in-from-bottom-5 items-center gap-2 rounded-[8px] border px-4 py-3 text-sm shadow-2xl backdrop-blur-md ${
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
  )
}
