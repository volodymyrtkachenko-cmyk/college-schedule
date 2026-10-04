"use client";

import { useEffect, useState } from "react";
import { api, ScheduleVersion, ScheduleVersionMutation } from "../../lib/api";
import { ConfirmModal } from "./ConfirmModal";

export function ScheduleVersionsPanel() {
  const [versions, setVersions] = useState<ScheduleVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isEditing, setIsEditing] = useState(false);
  const [currentDraft, setCurrentDraft] = useState<Partial<ScheduleVersion>>({});
  
  const [cloneSourceId, setCloneSourceId] = useState<number>(0);
  const [showCloneModal, setShowCloneModal] = useState<number | null>(null);
  
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const loadData = async () => {
    try {
      setLoading(true);
      const data = await api.scheduleVersions.list();
      setVersions(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentDraft.name || !currentDraft.valid_from || !currentDraft.valid_until) return;
    
    try {
      if (currentDraft.id) {
        await api.scheduleVersions.update(currentDraft.id, currentDraft as ScheduleVersionMutation);
      } else {
        await api.scheduleVersions.create(currentDraft as ScheduleVersionMutation);
      }
      setIsEditing(false);
      setCurrentDraft({});
      await loadData();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Save failed");
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await api.scheduleVersions.remove(deleteId);
      setDeleteId(null);
      await loadData();
    } catch(e) {
      alert("Delete failed: " + (e instanceof Error ? e.message : String(e)));
    }
  };

  const handleClone = async () => {
    if (!showCloneModal) return;
    try {
      const res = await api.scheduleVersions.clone(showCloneModal, cloneSourceId);
      alert(`Клоновано пар: ${res.count}`);
      setShowCloneModal(null);
    } catch(e) {
      alert("Clone failed: " + (e instanceof Error ? e.message : String(e)));
    }
  };

  if (loading) return <div className="p-8 text-center text-sys-text-secondary">Завантаження...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-sys-text-primary">Версії розкладу</h2>
          <p className="text-sm text-sys-text-secondary mt-1">
            Керуйте періодами дії базового розкладу.
          </p>
        </div>
        <button
          onClick={() => {
            setCurrentDraft({ is_active: true, valid_from: new Date().toISOString().split('T')[0], valid_until: new Date().toISOString().split('T')[0] });
            setIsEditing(true);
          }}
          className="rounded-lg bg-sys-accent px-4 py-2 text-sm font-semibold text-[#0b1120] hover:bg-sys-accent/90"
        >
          + Створити версію
        </button>
      </div>

      {error && <div className="rounded-lg bg-rose-500/10 p-4 text-sm text-rose-400">{error}</div>}

      {isEditing && (
        <form onSubmit={handleSave} className="rounded-xl border border-sys-border bg-sys-card p-5 space-y-4 shadow-lg">
          <h3 className="font-semibold text-lg mb-4">{currentDraft.id ? "Редагувати версію" : "Нова версія"}</h3>
          
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-sys-text-secondary">Назва версії</label>
              <input
                required
                type="text"
                placeholder="Напр. 1 семестр 2026/2027"
                value={currentDraft.name || ""}
                onChange={(e) => setCurrentDraft({ ...currentDraft, name: e.target.value })}
                className="form-control"
              />
            </div>
            
            <div className="space-y-1.5 flex items-center pt-6">
              <label className="flex items-center gap-2 text-sm text-sys-text-primary cursor-pointer">
                <input
                  type="checkbox"
                  checked={currentDraft.is_active ?? true}
                  onChange={(e) => setCurrentDraft({ ...currentDraft, is_active: e.target.checked })}
                  className="rounded border-sys-border bg-sys-input text-sys-accent focus:ring-sys-accent/20"
                />
                Версія активна
              </label>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-sys-text-secondary">Діє З</label>
              <input
                required
                type="date"
                value={currentDraft.valid_from || ""}
                onChange={(e) => setCurrentDraft({ ...currentDraft, valid_from: e.target.value })}
                className="form-control"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-sys-text-secondary">Діє ДО</label>
              <input
                required
                type="date"
                value={currentDraft.valid_until || ""}
                onChange={(e) => setCurrentDraft({ ...currentDraft, valid_until: e.target.value })}
                className="form-control"
              />
            </div>
          </div>

          <div className="flex gap-3 justify-end pt-4 border-t border-sys-border/50">
            <button type="button" onClick={() => setIsEditing(false)} className="rounded-lg px-4 py-2 text-sm font-medium text-sys-text-secondary hover:text-white transition-colors">
              Скасувати
            </button>
            <button type="submit" className="rounded-lg bg-sys-accent px-4 py-2 text-sm font-semibold text-[#0b1120] hover:bg-sys-accent/90 transition-colors">
              Зберегти
            </button>
          </div>
        </form>
      )}

      <div className="overflow-x-auto rounded-xl border border-sys-border bg-sys-card">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-sys-border bg-sys-bg/50 text-sys-text-secondary">
            <tr>
              <th className="px-4 py-3 font-medium">ID</th>
              <th className="px-4 py-3 font-medium">Назва</th>
              <th className="px-4 py-3 font-medium">Період дії</th>
              <th className="px-4 py-3 font-medium">Статус</th>
              <th className="px-4 py-3 font-medium text-right">Дії</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-sys-border">
            {versions.map((v) => (
              <tr key={v.id} className="transition-colors hover:bg-sys-hover">
                <td className="px-4 py-3 text-sys-text-muted">#{v.id}</td>
                <td className="px-4 py-3 font-medium text-white">{v.name}</td>
                <td className="px-4 py-3 text-sys-text-secondary">
                  {v.valid_from} — {v.valid_until}
                </td>
                <td className="px-4 py-3">
                  {v.is_active 
                    ? <span className="inline-flex rounded-full bg-emerald-500/10 px-2 py-1 text-[10px] font-medium text-emerald-400 border border-emerald-500/20">Активно</span>
                    : <span className="inline-flex rounded-full bg-slate-500/10 px-2 py-1 text-[10px] font-medium text-slate-400 border border-slate-500/20">Вимкнено</span>
                  }
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => setShowCloneModal(v.id)}
                      className="rounded-md border border-sys-border px-2 py-1.5 text-xs font-medium text-sys-text-secondary hover:bg-sys-hover hover:text-white"
                      title="Скопіювати розклад з іншої версії"
                    >
                      Імпорт пар
                    </button>
                    <button
                      onClick={() => { setCurrentDraft(v); setIsEditing(true); }}
                      className="rounded-md border border-sys-border px-2 py-1.5 text-xs font-medium text-sys-text-secondary hover:bg-sys-hover hover:text-white"
                    >
                      Редагувати
                    </button>
                    <button
                      onClick={() => setDeleteId(v.id)}
                      className="rounded-md border border-rose-500/20 bg-rose-500/5 px-2 py-1.5 text-xs font-medium text-rose-400 hover:bg-rose-500/20"
                    >
                      Видалити
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {versions.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sys-text-muted">
                  Ще не створено жодної версії. <br/>
                  Базовий розклад наразі діє як "Безстроковий".
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      

      
    <ConfirmModal
        isOpen={deleteId !== null}
        title="Видалення версії"
        message="Ви впевнені? УВАГА: Це видалить САМУ ВЕРСІЮ ТА ВСІ ЇЇ ПАРИ! Цю дію неможливо скасувати."
        onConfirm={handleDelete}
        onCancel={() => setDeleteId(null)}
      />

      {showCloneModal !== null && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-sm rounded-2xl border border-sys-border bg-sys-card p-5 shadow-2xl animate-in zoom-in-95 duration-200">
            <h3 className="font-semibold text-sys-text-primary mb-2">Клонування розкладу</h3>
            <p className="text-sm text-sys-text-secondary mb-4">
              Оберіть, звідки скопіювати пари у цю версію. УВАГА: всі існуючі пари у цій версії будуть стерті!
            </p>
            <div className="mb-5 space-y-2">
                <label className="text-sm text-sys-text-secondary block">Версія-джерело:</label>
                <select 
                    className="form-control w-full"
                    value={cloneSourceId}
                    onChange={(e) => setCloneSourceId(Number(e.target.value))}
                >
                    <option value={0}>Базовий (Безстроковий) розклад</option>
                    {versions.filter(v => v.id !== showCloneModal).map(v => (
                        <option key={v.id} value={v.id}>[ID: {v.id}] {v.name}</option>
                    ))}
                </select>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowCloneModal(null)} className="rounded-lg border border-sys-border px-4 py-2 text-sm text-sys-text-primary hover:bg-sys-hover transition-colors">
                Скасувати
              </button>
              <button type="button" onClick={handleClone} className="rounded-lg bg-sys-accent px-4 py-2 text-sm font-semibold text-[#0b1120] hover:bg-sys-accent/90 transition-colors">
                Клонувати
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
