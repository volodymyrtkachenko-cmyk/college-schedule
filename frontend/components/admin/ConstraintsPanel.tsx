"use client";

import { useEffect, useState } from "react";
import { api, TeacherConstraintRecord } from "../../lib/api";
import { SearchableSelect } from "../SearchableSelect";
import { useToast } from "../ToastProvider";
import { PageHeader } from "./PageHeader";

export function ConstraintsPanel() {
  const [items, setItems] = useState<TeacherConstraintRecord[]>([]);
  const [teachers, setTeachers] = useState<{id:number, name:string}[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [teacherId, setTeacherId] = useState<number | "">("");
  const [day, setDay] = useState<number>(1);
  const [lesson, setLesson] = useState<number>(1);
  const { showToast: setToast } = useToast();

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
      setToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  }

  async function handleAdd() {
    if (!teacherId) return setToast("Оберіть викладача.", "error");
    try {
      const session = await api.auth.ensureAuthenticated();
      const res = await api.constraints.create(Number(teacherId), day, lesson, session.access_token);
      setItems([res, ...items]);
      setToast("Обмеження додано.", "success");
    } catch(err: any) {
      setToast(err.message, "error");
    }
  }

  async function handleDelete(id: number) {
    try {
      const session = await api.auth.ensureAuthenticated();
      await api.constraints.remove(id, session.access_token);
      setItems(items.filter(i => i.id !== id));
      setToast("Обмеження видалено.", "success");
    } catch(err: any) {
      setToast(err.message, "error");
    }
  }

  const daysDict = {1: "Понеділок", 2: "Вівторок", 3: "Середа", 4: "Четвер", 5: "П’ятниця"};

  return (
    <>
      <PageHeader
        eyebrow="АВТОМАТИЗАЦІЯ"
        title="Доступність викладачів"
        description="Позначте дні та пари, коли викладач не може проводити заняття. Генератор врахує ці обмеження."
      />

      <div className="surface-panel mt-4 flex flex-wrap items-end gap-3 p-4 sm:p-5">
         <div className="w-full sm:w-auto sm:min-w-[220px]">
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
         <div className="flex-1 sm:flex-initial">
           <label className="block text-xs font-semibold uppercase tracking-wider text-sys-text-secondary mb-1">День тижня</label>
           <select value={day} onChange={e => setDay(Number(e.target.value))} className="form-control w-full min-w-[140px] text-sm">
             {Object.entries(daysDict).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
           </select>
         </div>
         <div className="flex-1 sm:flex-initial">
           <label className="block text-xs font-semibold uppercase tracking-wider text-sys-text-secondary mb-1">Пара</label>
           <select value={lesson} onChange={e => setLesson(Number(e.target.value))} className="form-control w-full min-w-[110px] text-sm">
             <option value={1}>1 пара</option><option value={2}>2 пара</option>
             <option value={3}>3 пара</option><option value={4}>4 пара</option>
           </select>
         </div>
         <button onClick={handleAdd} className="w-full sm:w-auto h-[38px] rounded-lg bg-rose-600/90 px-4 text-sm font-semibold text-white transition-colors hover:bg-rose-600 active:scale-95">
            + Додати обмеження
         </button>
      </div>

      {loading ? (
        <div className="mt-8 text-center text-sys-text-secondary">Завантаження…</div>
      ) : (
        <>
          {/* Desktop Table (>=640px) */}
          <div className="hidden sm:block mt-6 rounded-xl border border-sys-border bg-sys-card overflow-hidden shadow-sm">
            <table className="w-full text-left text-sm border-collapse">
              <thead className="bg-[#111827] sticky top-0 z-10 border-b border-sys-border">
                <tr>
                  <th className="px-5 py-3.5 font-semibold text-sys-text-secondary text-xs uppercase tracking-wider">Викладач</th>
                  <th className="px-5 py-3.5 font-semibold text-sys-text-secondary text-xs uppercase tracking-wider">День</th>
                  <th className="px-5 py-3.5 font-semibold text-sys-text-secondary text-xs uppercase tracking-wider">Пара</th>
                  <th className="px-5 py-3.5 font-semibold text-sys-text-secondary text-right min-w-[100px]">Дії</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-sys-border/50">
                {items.map(i => (
                  <tr key={i.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-5 py-3 font-semibold text-sys-text-primary">{i.teacher.name}</td>
                    <td className="px-5 py-3 text-rose-400 font-medium">{daysDict[i.day_of_week as keyof typeof daysDict] || i.day_of_week}</td>
                    <td className="px-5 py-3 font-bold text-sys-text-muted">{i.lesson_number} пара</td>
                    <td className="px-5 py-3 text-right">
                      <button onClick={() => handleDelete(i.id)} className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-rose-500/20 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 transition-colors">Видалити</button>
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

          {/* Mobile Card View (<640px) */}
          <div className="sm:hidden space-y-2.5 mt-4">
            {items.map(i => (
              <div key={i.id} className="rounded-xl border border-sys-border bg-sys-card p-3.5 flex items-center justify-between gap-3 shadow-sm">
                <div>
                  <h4 className="font-semibold text-sm text-sys-text-primary">{i.teacher.name}</h4>
                  <p className="text-xs text-rose-400 font-medium mt-0.5">
                    {daysDict[i.day_of_week as keyof typeof daysDict] || i.day_of_week} • {i.lesson_number} пара
                  </p>
                </div>
                <button
                  onClick={() => handleDelete(i.id)}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-rose-500/20 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 active:scale-95 transition-colors"
                >
                  Видалити
                </button>
              </div>
            ))}
            {items.length === 0 && (
              <div className="rounded-xl border border-dashed border-sys-border p-8 text-center text-sm text-sys-text-secondary">
                Обмежень немає. Викладачі доступні в усі дні та пари.
              </div>
            )}
          </div>
        </>
      )}

      
    </>
  );
}
