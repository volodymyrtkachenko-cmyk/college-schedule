"use client";

import { useEffect, useState } from "react";
import { api, TeacherConstraintRecord } from "../../lib/api";
import { SearchableSelect } from "../SearchableSelect";

export function ConstraintsPanel() {
  const [items, setItems] = useState<TeacherConstraintRecord[]>([]);
  const [teachers, setTeachers] = useState<{id:number, name:string}[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [teacherId, setTeacherId] = useState<number | "">("");
  const [day, setDay] = useState<number>(1);
  const [lesson, setLesson] = useState<number>(1);
  const [toast, setToast] = useState<{message: string, type: "success"|"error"} | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      const session = await api.auth.ensureAuthenticated();
      
      const t = await api.directory.teachers();
      setTeachers(t);
      
      const res = await api.constraints.list(session.access_token);
      setItems(res);
    } catch(err: any) {
      setToast({message: err.message, type: "error"});
    } finally {
      setLoading(false);
    }
  }

  async function handleAdd() {
    if (!teacherId) return setToast({message: "Оберіть викладача.", type: "error"});
    try {
      const session = await api.auth.ensureAuthenticated();
      const res = await api.constraints.create(Number(teacherId), day, lesson, session.access_token);
      setItems([res, ...items]);
      setToast({message: "Обмеження додано.", type: "success"});
    } catch(err: any) {
      setToast({message: err.message, type: "error"});
    }
  }

  async function handleDelete(id: number) {
    try {
      const session = await api.auth.ensureAuthenticated();
      await api.constraints.remove(id, session.access_token);
      setItems(items.filter(i => i.id !== id));
      setToast({message: "Обмеження видалено.", type: "success"});
    } catch(err: any) {
      setToast({message: err.message, type: "error"});
    }
  }

  const daysDict = {1: "Понеділок", 2: "Вівторок", 3: "Середа", 4: "Четвер", 5: "П’ятниця"};

  return (
    <>
      <div className="flex items-center justify-between mt-2">
         <div>
           <h1 className="text-xl font-bold">Доступність викладачів</h1>
           <p className="text-sm text-sys-text-secondary mt-1">Позначте дні та пари, коли викладач не може проводити заняття. Генератор врахує ці обмеження.</p>
         </div>
      </div>

      <div className="surface-panel mt-6 flex flex-wrap items-end gap-4 p-4 sm:p-5">
         <div>
           <label className="block text-xs font-semibold uppercase tracking-wider text-sys-text-secondary mb-1">Викладач</label>
           <SearchableSelect
             options={teachers}
             value={teacherId === "" ? null : teacherId}
             onChange={(id) => setTeacherId(id ?? "")}
             placeholder="Знайти викладача"
             disabled={loading}
             ariaLabel="Викладач"
           />
         </div>
         <div>
           <label className="block text-xs font-semibold uppercase tracking-wider text-sys-text-secondary mb-1">День тижня</label>
           <select value={day} onChange={e => setDay(Number(e.target.value))} className="form-control min-w-[150px]">
             {Object.entries(daysDict).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
           </select>
         </div>
         <div>
           <label className="block text-xs font-semibold uppercase tracking-wider text-sys-text-secondary mb-1">Пара</label>
           <select value={lesson} onChange={e => setLesson(Number(e.target.value))} className="form-control min-w-[120px]">
             <option value={1}>1 пара</option><option value={2}>2 пара</option>
             <option value={3}>3 пара</option><option value={4}>4 пара</option>
           </select>
         </div>
         <button onClick={handleAdd} className="h-[42px] rounded-lg bg-rose-600/90 px-4 py-2 text-sm font-semibold tracking-wide text-white transition-colors hover:bg-rose-600">
            Додати обмеження
         </button>
      </div>

      {loading ? (
        <div className="mt-8 text-center text-sys-text-secondary">Завантаження…</div>
      ) : (
        <div className="mt-6 rounded-[12px] border-[0.5px] border-sys-border bg-sys-card overflow-hidden shadow-sm">
          <table className="w-full text-left text-sm border-collapse">
            <thead className="bg-sys-bg">
              <tr>
                <th className="px-5 py-4 font-semibold text-sys-text-secondary text-xs uppercase tracking-wider">Викладач</th>
                <th className="px-5 py-4 font-semibold text-sys-text-secondary text-xs uppercase tracking-wider">День</th>
                <th className="px-5 py-4 font-semibold text-sys-text-secondary text-xs uppercase tracking-wider">Пара</th>
                <th className="px-5 py-4 font-semibold text-sys-text-secondary text-right min-w-[100px]">Дії</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sys-border/50">
              {items.map(i => (
                <tr key={i.id} className="hover:bg-white/[0.02] transition-colors">
                  <td className="px-5 py-3 font-semibold text-sys-text-primary">{i.teacher.name}</td>
                  <td className="px-5 py-3 text-rose-400 font-medium">{daysDict[i.day_of_week as keyof typeof daysDict] || i.day_of_week}</td>
                  <td className="px-5 py-3 font-bold text-sys-text-muted">{i.lesson_number} пара</td>
                  <td className="px-5 py-3 text-right">
                    <button onClick={() => handleDelete(i.id)} className="px-3 py-1 text-xs font-semibold rounded bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 transition">Видалити</button>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                   <td colSpan={4} className="px-5 py-8 text-center text-sys-text-secondary">Обмежень немає. Викладачі доступні в усі дні та пари.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {toast && (
          <div className={`fixed bottom-6 right-6 z-[200] flex animate-in slide-in-from-bottom-5 items-center gap-2 rounded-[8px] border px-4 py-3 text-sm shadow-2xl backdrop-blur-md ${toast.type === 'success' ? 'border-emerald-500/40 bg-emerald-950/90 text-emerald-200' : 'border-rose-500/40 bg-rose-950/90 text-rose-200'}`}>
            {toast.message}
          </div>
      )}
    </>
  );
}
