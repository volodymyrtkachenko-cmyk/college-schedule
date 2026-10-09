"use client";

import { useEffect, useState } from "react";
import { api, CurriculumRecord, CurriculumMutation, ReferenceRecord } from "../../lib/api";
import { ConfirmModal } from "./ConfirmModal";
import { SearchableSelect } from "../SearchableSelect";
import { SearchableMultiSelect } from "../SearchableMultiSelect";
import { useToast } from "../ToastProvider";

function formatGroupCount(count: number) {
  const remainder10 = count % 10;
  const remainder100 = count % 100;
  const noun = remainder10 === 1 && remainder100 !== 11
    ? "групи"
    : remainder10 >= 2 && remainder10 <= 4 && (remainder100 < 12 || remainder100 > 14)
      ? "груп"
      : "груп";
  return `${count} ${noun}`;
}

export function CurriculumPanel() {
  const [items, setItems] = useState<CurriculumRecord[]>([]);
  const [groups, setGroups] = useState<ReferenceRecord[]>([]);
  const [subjects, setSubjects] = useState<ReferenceRecord[]>([]);
  const [teachers, setTeachers] = useState<ReferenceRecord[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [searchTerm, setSearchTerm] = useState("");
  const { showToast: setToast } = useToast();
  
  const [editor, setEditor] = useState<Partial<CurriculumRecord> | null>(null);
  const [selectedGroupIds, setSelectedGroupIds] = useState<number[]>([]);
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

  const filteredItems = items.filter(i => {
    const q = searchTerm.toLowerCase();
    return i.group.name.toLowerCase().includes(q) || 
           i.teacher.name.toLowerCase().includes(q) || 
           i.subject.name.toLowerCase().includes(q);
  });
  
  const sortedItems = [...filteredItems].sort((a, b) =>
    a.group.name.localeCompare(b.group.name, "uk", { numeric: true, sensitivity: "base" }) ||
    a.subject.name.localeCompare(b.subject.name, "uk", { sensitivity: "base" }),
  );

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!editor || (!editor.id && selectedGroupIds.length === 0) || (editor.id && !editor.group_id) || !editor.subject_id || !editor.teacher_id) {
      setToast("Оберіть групу, предмет і викладача.", "error");
      return;
    }
    
    try {
      const session = await api.auth.ensureAuthenticated();
      
      const payload: CurriculumMutation = {
        group_id: editor.group_id ?? selectedGroupIds[0] ?? 0,
        subject_id: editor.subject_id,
        teacher_id: editor.teacher_id,
        second_teacher_id: editor.second_teacher_id || null,
        pairs_per_2_weeks: editor.pairs_per_2_weeks || 0,
        total_hours: editor.total_hours || 0,
        is_fixed: editor.is_fixed || false,
        is_stream: editor.is_stream || false,
        stream_id: editor.is_stream ? (editor.stream_id ?? null) : null,
        strict_day: editor.is_fixed ? (editor.strict_day || null) : null,
        strict_lesson: editor.is_fixed ? (editor.strict_lesson || null) : null,
        require_week: editor.require_week || null,
        allow_multiple_per_day: editor.allow_multiple_per_day || false,
      };
      
      if (editor.id) {
        const updated = await api.curriculums.update(editor.id, payload, session.access_token);
        setItems(curr => curr.map(c => c.id === updated.id ? updated : c));
        setToast("Навчальне навантаження оновлено.", "success");
      } else {
        const streamId = payload.is_stream ? `stream_${crypto.randomUUID()}` : null;
        const results = await Promise.allSettled(
          selectedGroupIds.map((group_id) => api.curriculums.create(
            { ...payload, group_id, stream_id: streamId },
            session.access_token,
          ))
        );
        const created = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
        const failed = results.length - created.length;
        if (created.length) setItems(curr => [...created, ...curr]);
        if (failed) {
          const latestItems = await api.curriculums.list(session.access_token);
          setItems(latestItems);
          setToast("", "error");
          return;
        }
        setToast(`Однакове навантаження додано для ${formatGroupCount(created.length)}.`, "success");
      }
      setEditor(null);
    } catch(err: any) {
      setToast(err.message, "error");
    }
  }

  async function remove() {
    if (!itemToDelete) return;
    try {
      const session = await api.auth.ensureAuthenticated();
      await api.curriculums.remove(itemToDelete.id, session.access_token);
      setItems(curr => curr.filter(c => c.id !== itemToDelete.id));
      setToast("Навчальне навантаження видалено.", "success");
    } catch(err: any) {
      setToast(err.message, "error");
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
             type="search"
             aria-label="Пошук навчального навантаження"
             placeholder="Знайти групу, предмет або викладача"
             value={searchTerm}
             onChange={(e) => setSearchTerm(e.target.value)}
             className="form-control w-full py-2 pl-9 pr-4"
           />
         </div>
         <button onClick={() => {
           setSelectedGroupIds([]);
           setEditor({ is_fixed: false, is_stream: false, pairs_per_2_weeks: 2, total_hours: 40 });
         }} className="shrink-0 rounded-lg bg-sys-accent px-4 py-2.5 text-sm font-semibold text-[#0b1120] transition-opacity hover:opacity-90">
            + Додати навантаження
         </button>
      </div>

      {loading ? (
        <div className="mt-8 text-center text-sys-text-secondary">Завантаження даних…</div>
      ) : error ? (
        <div className="mt-8 text-center text-rose-500">{error}</div>
      ) : (
        <div className="surface-panel mt-6 overflow-x-auto">
          <table className="w-full text-left text-sm border-collapse">
            <thead className="bg-[#111827] sticky top-0 z-10">
              <tr>
                <th className="px-5 py-4 font-semibold text-sys-text-secondary whitespace-nowrap border-b border-sys-border text-xs uppercase tracking-wider">Група</th>
                <th className="px-5 py-4 font-semibold text-sys-text-secondary border-b border-sys-border text-xs uppercase tracking-wider min-w-[200px]">Предмет</th>
                <th className="px-5 py-4 font-semibold text-sys-text-secondary border-b border-sys-border text-xs uppercase tracking-wider min-w-[150px]">Викладач</th>
                <th className="px-5 py-4 font-semibold text-sys-text-secondary border-b border-sys-border text-xs uppercase tracking-wider">Другий викладач</th>
                <th className="px-5 py-4 font-semibold text-sys-text-secondary border-b border-sys-border text-xs uppercase tracking-wider text-center">Занять за 2 тижні</th>
                <th className="px-5 py-4 font-semibold text-sys-text-secondary border-b border-sys-border text-xs uppercase tracking-wider text-center">Годин</th>
                <th className="px-5 py-4 font-semibold text-sys-text-secondary border-b border-sys-border text-xs uppercase tracking-wider">Позначки</th>
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
                    {item.is_fixed && <span title="Заняття закріплено за конкретним часом" className="rounded bg-sys-input px-2 py-1 text-xs text-sys-text-secondary">Закріплено</span>}
                    {item.is_stream && <span title="Заняття проводиться для спільного потоку" className="rounded bg-sys-accent/10 px-2 py-1 text-xs text-sys-accent">Потік</span>}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <button onClick={() => setEditor(item)} className="p-2 text-sys-text-muted hover:text-sys-accent rounded-full hover:bg-sys-accent/10 transition-colors" title="Редагувати" aria-label={`Редагувати навантаження з предмета ${item.subject.name} для групи ${item.group.name}`}>
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
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm shadow-2xl">
          <div className="flex max-h-[92dvh] w-full max-w-2xl flex-col rounded-2xl border border-sys-border bg-sys-card shadow-2xl overflow-hidden">
            <div className="bg-gradient-to-b from-white/5 to-transparent p-6 pb-4 border-b border-sys-border/50 sticky top-0 flex justify-between items-center z-10">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sys-accent/20 text-sys-accent">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg>
                </div>
                <div>
                  <h3 className="text-lg font-bold text-sys-text-primary">
                    {editor.id ? "Редагування навантаження" : "Нове навантаження"}
                  </h3>
                  <p className="text-sm text-sys-text-secondary">{editor.id ? "Змініть параметри плану для групи" : "Додайте план одразу для багатьох груп"}</p>
                </div>
              </div>
              <button onClick={() => setEditor(null)} className="rounded-full p-2 text-sys-text-secondary hover:bg-sys-bg hover:text-sys-text-primary transition-colors">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="p-6 overflow-y-auto">
              <form id="curr-form" onSubmit={handleSave} className="space-y-4">
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold uppercase tracking-wider text-sys-text-secondary pl-1">
                      {editor.id ? "Група" : "Групи для цього плану"}
                    </label>
                    {editor.id ? (
                      <SearchableSelect
                        options={[...groups].sort((a, b) => a.name.localeCompare(b.name, "uk"))}
                        value={editor.group_id}
                        onChange={(id) => setEditor({ ...editor, group_id: id ?? undefined })}
                        placeholder="Знайти групу"
                        ariaLabel="Група"
                      />
                    ) : (
                      <SearchableMultiSelect
                        options={[...groups].sort((a, b) => a.name.localeCompare(b.name, "uk"))}
                        value={selectedGroupIds}
                        onChange={setSelectedGroupIds}
                        placeholder="Знайти групу"
                        ariaLabel="Оберіть групи для однакового навчального плану"
                      />
                    )}
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold uppercase tracking-wider text-sys-text-secondary pl-1">Предмет</label>
                    <SearchableSelect
                      options={[...subjects].sort((a, b) => a.name.localeCompare(b.name, "uk"))}
                      value={editor.subject_id}
                      onChange={(id) => setEditor({ ...editor, subject_id: id ?? undefined })}
                      placeholder="Знайти предмет"
                      ariaLabel="Предмет"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold uppercase tracking-wider text-sys-text-secondary pl-1">Викладач</label>
                    <SearchableSelect
                      options={[...teachers].sort((a, b) => a.name.localeCompare(b.name, "uk"))}
                      value={editor.teacher_id}
                      onChange={(id) => setEditor({ ...editor, teacher_id: id ?? undefined })}
                      placeholder="Знайти викладача"
                      ariaLabel="Викладач"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold uppercase tracking-wider text-sys-text-secondary pl-1">Другий викладач</label>
                    <SearchableSelect
                      options={[...teachers].sort((a, b) => a.name.localeCompare(b.name, "uk"))}
                      value={editor.second_teacher_id}
                      onChange={(id) => setEditor({ ...editor, second_teacher_id: id })}
                      placeholder="Знайти викладача"
                      ariaLabel="Другий викладач"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                     <label className="text-xs font-bold uppercase tracking-wider text-sys-accent pl-1">Занять за два тижні</label>
                     <input type="number" min="0" max="50" required value={editor.pairs_per_2_weeks || 0} onChange={e => setEditor({...editor, pairs_per_2_weeks: parseInt(e.target.value)})} className="w-full rounded-lg border border-sys-accent/50 bg-sys-bg px-3 py-2.5 text-base font-black text-emerald-400 text-center shadow-inner outline-none focus:border-sys-accent focus:ring-1 focus:ring-sys-accent" />
                  </div>
                  <div className="space-y-1">
                     <label className="text-xs font-bold uppercase tracking-wider text-sys-text-secondary pl-1">Загальна кількість годин</label>
                     <input type="number" min="0" required value={editor.total_hours || 0} onChange={e => setEditor({...editor, total_hours: parseInt(e.target.value)})} className="w-full rounded-lg border border-sys-border bg-sys-bg px-3 py-2.5 text-[15px] font-medium text-sys-text-primary text-center shadow-sm outline-none focus:border-sys-accent focus:ring-1 focus:ring-sys-accent" />
                  </div>
                </div>

                <div className="flex flex-col gap-2 bg-sys-bg p-4 rounded-xl border border-sys-border mt-2">
                   <label className="flex items-center gap-3 cursor-pointer group/chk">
                     <div className="relative flex items-center justify-center">
                        <input type="checkbox" checked={editor.is_fixed || false} onChange={e => setEditor({...editor, is_fixed: e.target.checked})} className="peer appearance-none w-5 h-5 border border-sys-border rounded bg-sys-card checked:bg-sys-accent checked:border-sys-accent transition-colors" />
                        <svg className="absolute w-3.5 h-3.5 text-white opacity-0 peer-checked:opacity-100 pointer-events-none transition-opacity" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5l10 -10"/></svg>
                     </div>
                     <div>
                       <span className="text-[14px] font-semibold text-sys-text-primary px-1">Закріпити заняття</span>
                       <p className="text-[12px] text-sys-text-muted">Генератор поставить заняття у визначений день і пару.</p>
                     </div>
                   </label>
                   
    
               <div className="flex gap-4 mt-2">
                 <label className="flex items-center gap-2 cursor-pointer group">
                   <div className="relative flex items-center">
                     <input type="checkbox" checked={editor.allow_multiple_per_day || false} onChange={e => setEditor({...editor, allow_multiple_per_day: e.target.checked})} className="peer appearance-none w-5 h-5 border border-sys-border rounded bg-sys-card checked:bg-sys-accent checked:border-sys-accent transition-colors" />
                     <svg className="absolute inset-0 w-full h-full p-[2px] opacity-0 peer-checked:opacity-100 text-white pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                   </div>
                   <span className="text-sm font-medium text-sys-text-secondary group-hover:text-sys-text-primary transition-colors">Проводити всі заняття в один день</span>
                 </label>
               </div>

               <div className="flex gap-4 items-center">
                  <span className="text-sm font-medium text-sys-text-secondary w-32">Тип тижня:</span>
                  <select value={editor.require_week || ""} onChange={e => setEditor({...editor, require_week: e.target.value || null})} className="flex-1 rounded-[6px] border border-sys-border bg-sys-input px-3 py-1.5 text-sm text-sys-text focus:border-sys-accent focus:outline-none focus:ring-1 focus:ring-sys-accent">
                    <option value="">Без обмежень</option>
                    <option value="numerator">Тільки чисельник</option>
                    <option value="denominator">Тільки знаменник</option>
                  </select>
               </div>
               
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
                       {editor.allow_multiple_per_day ? (
                         <select value={editor.strict_lesson || ""} onChange={e => setEditor({...editor, strict_lesson: e.target.value ? parseInt(e.target.value) : null})} className="rounded-[8px] border-[0.5px] border-sys-border bg-sys-input px-3 py-1.5 text-[14px] text-sys-text-primary outline-none">
                           <option value="">Автоматичний підбір пар</option>
                           <option value="12">1 та 2 пари (2 пари)</option>
                           <option value="23">2 та 3 пари (2 пари)</option>
                           <option value="34">3 та 4 пари (2 пари)</option>
                           <option value="123">1, 2 та 3 пари (3 пари)</option>
                           <option value="234">2, 3 та 4 пари (3 пари)</option>
                           <option value="1234">Усі 4 пари</option>
                         </select>
                       ) : (
                         <select value={editor.strict_lesson || ""} onChange={e => setEditor({...editor, strict_lesson: e.target.value ? parseInt(e.target.value) : null})} className="rounded-[8px] border-[0.5px] border-sys-border bg-sys-input px-3 py-1.5 text-[14px] text-sys-text-primary outline-none">
                           <option value="" disabled>Оберіть пару</option>
                           <option value="1">1 пара</option>
                           <option value="2">2 пара</option>
                           <option value="3">3 пара</option>
                           <option value="4">4 пара</option>
                         </select>
                       )}
                     </div>
                   )}
                   
                   <hr className="border-sys-border/50 my-1" />
                   
                   <label className="flex items-center gap-3 cursor-pointer group/chk">
                     <div className="relative flex items-center justify-center">
                        <input type="checkbox" checked={editor.is_stream || false} onChange={e => setEditor({...editor, is_stream: e.target.checked})} className="peer appearance-none w-5 h-5 border border-sys-border rounded bg-sys-card checked:bg-sys-accent checked:border-sys-accent transition-colors" />
                        <svg className="absolute w-3.5 h-3.5 text-white opacity-0 peer-checked:opacity-100 pointer-events-none transition-opacity" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5l10 -10"/></svg>
                     </div>
                     <div>
                       <span className="text-[14px] font-semibold text-sys-text-primary px-1">Спільний потік</span>
                       <p className="text-[12px] text-sys-text-muted">Потоком стануть лише вибрані групи, додані разом. Збіг предмета й викладача сам по собі групи не об’єднує.</p>
                     </div>
                   </label>
                </div>

              </form>
            </div>
            
            <div className="bg-sys-bg/30 px-6 py-4 flex justify-end gap-3 border-t border-sys-border/50">
               <button onClick={() => setEditor(null)} className="rounded-lg border border-sys-border px-4 py-2 text-sm font-medium text-sys-text-primary hover:bg-sys-bg transition-colors">
                  Скасувати
               </button>
               <button type="submit" form="curr-form" className="flex items-center gap-2 rounded-lg bg-sys-accent px-5 py-2 text-sm font-medium text-[#0b1120] hover:opacity-90 transition-colors">
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

      
    </>
  );
}
