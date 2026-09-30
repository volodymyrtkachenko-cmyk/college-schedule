"use client";

import { useEffect, useState } from "react";
import { api, CurriculumRecord, CurriculumMutation, ReferenceRecord } from "../../lib/api";
import { ConfirmModal } from "./ConfirmModal";

export function CurriculumPanel() {
  const [items, setItems] = useState<CurriculumRecord[]>([]);
  const [groups, setGroups] = useState<ReferenceRecord[]>([]);
  const [subjects, setSubjects] = useState<ReferenceRecord[]>([]);
  const [teachers, setTeachers] = useState<ReferenceRecord[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [searchTerm, setSearchTerm] = useState("");
  const [toast, setToast] = useState<{message: string, type: "success"|"error"} | null>(null);
  
  const [editor, setEditor] = useState<Partial<CurriculumRecord> | null>(null);
  const [itemToDelete, setItemToDelete] = useState<CurriculumRecord | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const session = await api.auth.ensureAuthenticated();
        const [curr, g, s, t] = await Promise.all([
          api.curriculums.list(session.access_token),
          api.directory.groups(),
          api.directory.subjects(),
          api.directory.teachers(),
        ]);
        setItems(curr);
        setGroups(g);
        setSubjects(s);
        setTeachers(t || []);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const filteredItems = items.filter(i => {
    const q = searchTerm.toLowerCase();
    return i.group.name.toLowerCase().includes(q) || 
           i.teacher.name.toLowerCase().includes(q) || 
           i.subject.name.toLowerCase().includes(q);
  });
  
  // Custom sorting if needed, else just ID backward
  const sortedItems = [...filteredItems].sort((a,b) => b.id - a.id);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!editor || !editor.group_id || !editor.subject_id || !editor.teacher_id) return;
    
    try {
      const session = await api.auth.ensureAuthenticated();
      
      const payload: CurriculumMutation = {
        group_id: editor.group_id,
        subject_id: editor.subject_id,
        teacher_id: editor.teacher_id,
        second_teacher_id: editor.second_teacher_id || null,
        pairs_per_2_weeks: editor.pairs_per_2_weeks || 0,
        total_hours: editor.total_hours || 0,
        is_fixed: editor.is_fixed || false,
        is_stream: editor.is_stream || false,
        strict_day: editor.is_fixed ? (editor.strict_day || null) : null,
        strict_lesson: editor.is_fixed ? (editor.strict_lesson || null) : null,
      };
      
      if (editor.id) {
        const updated = await api.curriculums.update(editor.id, payload, session.access_token);
        setItems(curr => curr.map(c => c.id === updated.id ? updated : c));
        setToast({message: "Запис оновлено", type:"success"});
      } else {
        const created = await api.curriculums.create(payload, session.access_token);
        setItems(curr => [created, ...curr]);
        setToast({message: "Запис додано", type:"success"});
      }
      setEditor(null);
    } catch(err: any) {
      setToast({message: err.message, type: "error"});
    }
  }

  async function remove() {
    if (!itemToDelete) return;
    try {
      const session = await api.auth.ensureAuthenticated();
      await api.curriculums.remove(itemToDelete.id, session.access_token);
      setItems(curr => curr.filter(c => c.id !== itemToDelete.id));
      setToast({message: "Видалено успішно", type: "success"});
    } catch(err: any) {
      setToast({message: err.message, type: "error"});
    } finally {
      setItemToDelete(null);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4 mt-2">
         <div className="relative w-full max-w-[320px]">
           <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sys-text-muted">
             <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0" /><path d="M21 21l-6 -6" /></svg>
           </span>
           <input 
             type="text" 
             placeholder="Пошук (група, предмет, викладач)..." 
             value={searchTerm}
             onChange={(e) => setSearchTerm(e.target.value)}
             className="w-full rounded-[6px] border-[0.5px] border-sys-border bg-sys-input py-2 pl-9 pr-4 text-sm text-sys-text-primary outline-none transition-colors focus:border-sys-accent focus:ring-1 focus:ring-sys-accent"
           />
         </div>
         <button onClick={() => setEditor({ is_fixed: false, is_stream: false, pairs_per_2_weeks: 2, total_hours: 40 })} className="shrink-0 rounded-[6px] bg-sys-accent px-4 py-2 text-sm font-semibold text-[#0b1120] hover:opacity-90 transition-opacity">
            + Додати навантаження
         </button>
      </div>

      {loading ? (
        <div className="mt-8 text-center text-sys-text-secondary">Завантаження даних...</div>
      ) : error ? (
        <div className="mt-8 text-center text-rose-500">{error}</div>
      ) : (
        <div className="mt-6 rounded-[12px] border-[0.5px] border-sys-border bg-sys-card overflow-x-auto shadow-sm">
          <table className="w-full text-left text-sm border-collapse">
            <thead className="bg-[#111827] sticky top-0 z-10">
              <tr>
                <th className="px-5 py-4 font-semibold text-sys-text-secondary whitespace-nowrap border-b border-sys-border text-xs uppercase tracking-wider">Група</th>
                <th className="px-5 py-4 font-semibold text-sys-text-secondary border-b border-sys-border text-xs uppercase tracking-wider min-w-[200px]">Предмет</th>
                <th className="px-5 py-4 font-semibold text-sys-text-secondary border-b border-sys-border text-xs uppercase tracking-wider min-w-[150px]">Викладач</th>
                <th className="px-5 py-4 font-semibold text-sys-text-secondary border-b border-sys-border text-xs uppercase tracking-wider">Підгрупа (2-й)</th>
                <th className="px-5 py-4 font-semibold text-sys-text-secondary border-b border-sys-border text-xs uppercase tracking-wider text-center">Пар/2 тижні</th>
                <th className="px-5 py-4 font-semibold text-sys-text-secondary border-b border-sys-border text-xs uppercase tracking-wider text-center">Годин</th>
                <th className="px-5 py-4 font-semibold text-sys-text-secondary border-b border-sys-border text-xs uppercase tracking-wider">Значки</th>
                <th className="px-5 py-4 font-semibold text-sys-text-secondary border-b border-sys-border text-right min-w-[100px]">Дії</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sys-border/50">
              {sortedItems.map(item => (
                <tr key={item.id} className="hover:bg-white/[0.02] transition-colors group">
                  <td className="px-5 py-3 whitespace-nowrap">
                    <span className="font-semibold text-sys-text-primary px-2 py-0.5 bg-sys-accent/10 text-sys-accent rounded">{item.group.name}</span>
                  </td>
                  <td className="px-5 py-3 text-sys-text-primary font-medium">{item.subject.name}</td>
                  <td className="px-5 py-3 text-sys-text-secondary">{item.teacher.name}</td>
                  <td className="px-5 py-3 text-sys-text-secondary text-[13px]">{item.second_teacher?.name || <span className="text-sys-text-muted">—</span>}</td>
                  <td className="px-5 py-3 text-center text-emerald-400 font-black text-lg">{item.pairs_per_2_weeks}</td>
                  <td className="px-5 py-3 text-center text-sys-text-secondary font-medium">{item.total_hours}</td>
                  <td className="px-5 py-3 flex gap-2">
                    {item.is_fixed && <span title="Закріплено" className="text-xl">🔒</span>}
                    {item.is_stream && <span title="Потік" className="text-xl">🌊</span>}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <button onClick={() => setEditor(item)} className="p-2 text-sys-text-muted hover:text-sys-accent rounded-full hover:bg-sys-accent/10 transition-colors" title="Редагувати">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>
                    </button>
                    <button onClick={() => setItemToDelete(item)} className="p-2 text-sys-text-muted hover:text-rose-400 rounded-full hover:bg-rose-500/10 transition-colors" title="Видалити">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                  </td>
                </tr>
              ))}
              {sortedItems.length === 0 && (
                <tr>
                   <td colSpan={8} className="px-5 py-8 text-center text-sys-text-secondary">Нічого не знайдено за вашим запитом.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {editor && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0b1120]/80 p-4 backdrop-blur-sm shadow-2xl">
          <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-sys-card border border-sys-border/50 flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-sys-border bg-[#0b1120]/50 sticky top-0 flex justify-between items-center z-10">
              <h3 className="text-lg font-bold text-sys-text-primary">
                {editor.id ? "Редагування плану" : "Додавання нового плану"}
              </h3>
              <button onClick={() => setEditor(null)} className="p-1 -mr-2 text-sys-text-secondary hover:text-sys-text-primary bg-transparent rounded-full hover:bg-white/10 transition">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="p-6 overflow-y-auto">
              <form id="curr-form" onSubmit={handleSave} className="space-y-4">
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold uppercase tracking-wider text-sys-text-secondary pl-1">Група</label>
                    <select required value={editor.group_id || ""} onChange={e => setEditor({...editor, group_id: parseInt(e.target.value)})} className="w-full rounded-[8px] border-[0.5px] border-sys-border bg-sys-input px-3 py-2.5 text-[15px] font-medium text-sys-text-primary shadow-sm outline-none transition-all focus:border-sys-accent focus:ring-1 focus:ring-sys-accent">
                      <option value="" disabled>Оберіть групу</option>
                      {groups.sort((a,b)=>a.name.localeCompare(b.name,'uk')).map(g => (
                        <option key={g.id} value={g.id}>{g.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold uppercase tracking-wider text-sys-text-secondary pl-1">Предмет</label>
                    <select required value={editor.subject_id || ""} onChange={e => setEditor({...editor, subject_id: parseInt(e.target.value)})} className="w-full rounded-[8px] border-[0.5px] border-sys-border bg-sys-input px-3 py-2.5 text-[15px] font-medium text-sys-text-primary shadow-sm outline-none transition-all focus:border-sys-accent focus:ring-1 focus:ring-sys-accent">
                      <option value="" disabled>Оберіть предмет</option>
                      {subjects.sort((a,b)=>a.name.localeCompare(b.name,'uk')).map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold uppercase tracking-wider text-sys-text-secondary pl-1">Викладач</label>
                    <select required value={editor.teacher_id || ""} onChange={e => setEditor({...editor, teacher_id: parseInt(e.target.value)})} className="w-full rounded-[8px] border-[0.5px] border-sys-border bg-sys-input px-3 py-2.5 text-[15px] font-medium text-sys-text-primary shadow-sm outline-none transition-all focus:border-sys-accent focus:ring-1 focus:ring-sys-accent">
                      <option value="" disabled>Основний викладач</option>
                      {teachers.sort((a,b)=>a.name.localeCompare(b.name,'uk')).map(t => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold uppercase tracking-wider text-sys-text-secondary pl-1">Підгрупа (2-й викладач)</label>
                    <select value={editor.second_teacher_id || ""} onChange={e => setEditor({...editor, second_teacher_id: e.target.value ? parseInt(e.target.value) : null})} className="w-full rounded-[8px] border-[0.5px] border-sys-border bg-sys-input px-3 py-2.5 text-[15px] font-medium text-sys-text-primary shadow-sm outline-none transition-all focus:border-sys-accent focus:ring-1 focus:ring-sys-accent">
                      <option value="">Немає (весь курс)</option>
                      {teachers.sort((a,b)=>a.name.localeCompare(b.name,'uk')).map(t => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                     <label className="text-xs font-bold uppercase tracking-wider text-sys-accent pl-1">Пар за 2 тижні</label>
                     <input type="number" min="0" max="50" required value={editor.pairs_per_2_weeks || 0} onChange={e => setEditor({...editor, pairs_per_2_weeks: parseInt(e.target.value)})} className="w-full rounded-[8px] border-[0.5px] border-sys-accent/50 bg-[#0b1120] px-3 py-2.5 text-[16px] font-black text-emerald-400 text-center shadow-inner outline-none focus:border-sys-accent focus:ring-1 focus:ring-sys-accent" />
                  </div>
                  <div className="space-y-1">
                     <label className="text-xs font-bold uppercase tracking-wider text-sys-text-secondary pl-1">Всього Годин</label>
                     <input type="number" min="0" required value={editor.total_hours || 0} onChange={e => setEditor({...editor, total_hours: parseInt(e.target.value)})} className="w-full rounded-[8px] border-[0.5px] border-sys-border bg-sys-input px-3 py-2.5 text-[15px] font-medium text-sys-text-primary text-center shadow-sm outline-none focus:border-sys-accent focus:ring-1 focus:ring-sys-accent" />
                  </div>
                </div>

                <div className="flex flex-col gap-2 bg-[#0b1120] p-4 rounded-xl border border-sys-border mt-2">
                   <label className="flex items-center gap-3 cursor-pointer group/chk">
                     <div className="relative flex items-center justify-center">
                        <input type="checkbox" checked={editor.is_fixed || false} onChange={e => setEditor({...editor, is_fixed: e.target.checked})} className="peer appearance-none w-5 h-5 border border-sys-border rounded bg-sys-input checked:bg-sys-accent checked:border-sys-accent transition-colors" />
                        <svg className="absolute w-3.5 h-3.5 text-[#0b1120] opacity-0 peer-checked:opacity-100 pointer-events-none transition-opacity" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5l10 -10"/></svg>
                     </div>
                     <div>
                       <span className="text-[14px] font-semibold text-sys-text-primary px-1">Жорстко закріплено 🔒</span>
                       <p className="text-[12px] text-sys-text-muted">Генератор поставить це заняття у фіксований слот і не буде його рухати.</p>
                     </div>
                   </label>
                   
                   {editor.is_fixed && (
                     <div className="flex gap-4 mt-2 ml-8">
                       <select value={editor.strict_day || ""} onChange={e => setEditor({...editor, strict_day: parseInt(e.target.value)})} className="rounded-[8px] border-[0.5px] border-sys-border bg-sys-input px-3 py-1.5 text-[14px] text-sys-text-primary outline-none">
                         <option value="" disabled>Оберіть день</option>
                         <option value="1">Понеділок</option>
                         <option value="2">Вівторок</option>
                         <option value="3">Середа</option>
                         <option value="4">Четвер</option>
                         <option value="5">П'ятниця</option>
                       </select>
                       <select value={editor.strict_lesson || ""} onChange={e => setEditor({...editor, strict_lesson: parseInt(e.target.value)})} className="rounded-[8px] border-[0.5px] border-sys-border bg-sys-input px-3 py-1.5 text-[14px] text-sys-text-primary outline-none">
                         <option value="" disabled>Пара</option>
                         <option value="1">1 пара</option>
                         <option value="2">2 пара</option>
                         <option value="3">3 пара</option>
                         <option value="4">4 пара</option>
                       </select>
                     </div>
                   )}
                   
                   <hr className="border-sys-border/50 my-1" />
                   
                   <label className="flex items-center gap-3 cursor-pointer group/chk">
                     <div className="relative flex items-center justify-center">
                        <input type="checkbox" checked={editor.is_stream || false} onChange={e => setEditor({...editor, is_stream: e.target.checked})} className="peer appearance-none w-5 h-5 border border-sys-border rounded bg-sys-input checked:bg-sys-accent checked:border-sys-accent transition-colors" />
                        <svg className="absolute w-3.5 h-3.5 text-[#0b1120] opacity-0 peer-checked:opacity-100 pointer-events-none transition-opacity" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5l10 -10"/></svg>
                     </div>
                     <div>
                       <span className="text-[14px] font-semibold text-sys-text-primary px-1">Потокова лекція 🌊</span>
                       <p className="text-[12px] text-sys-text-muted">Групи об'єднаються у велику лекцію. (Увага: створіть потоки з однаковим предметом і викладачем).</p>
                     </div>
                   </label>
                </div>

              </form>
            </div>
            
            <div className="px-6 py-4 bg-[#0b1120]/80 border-t border-sys-border flex justify-end gap-3 rounded-b-2xl">
               <button onClick={() => setEditor(null)} className="px-5 py-2.5 rounded-lg text-[14px] font-bold text-sys-text-secondary hover:text-sys-text-primary hover:bg-white/5 transition-colors">
                  Скасувати
               </button>
               <button type="submit" form="curr-form" className="px-6 py-2.5 rounded-lg text-[14px] font-bold text-[#0b1120] bg-sys-accent hover:opacity-90 transition-opacity flex items-center justify-center gap-2">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
                  Зберегти
               </button>
            </div>
          </div>
        </div>
      )}

      {itemToDelete && (
         <ConfirmModal 
            isOpen 
            title={`Видалити запис "${itemToDelete.subject.name}" для ${itemToDelete.group.name}?`} 
            onConfirm={remove} 
            onCancel={() => setItemToDelete(null)} 
         />
      )}

      {toast && (
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
      )}
    </>
  );
}
