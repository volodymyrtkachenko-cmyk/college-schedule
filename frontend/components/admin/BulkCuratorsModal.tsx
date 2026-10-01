"use client";

import { useState } from "react";
import { api, ReferenceRecord } from "../../lib/api";
import { SearchableMultiSelect } from "../SearchableMultiSelect";

type Props = {
  groups: ReferenceRecord[];
  onClose: () => void;
  onSuccess: (message: string) => void;
};

export function BulkCuratorsModal({ groups, onClose, onSuccess }: Props) {
  const [day, setDay] = useState<number>(4);
  const [lesson, setLesson] = useState<number>(4);
  const [week, setWeek] = useState<"numerator"|"denominator"|"both">("both");
  const [selectedGroups, setSelectedGroups] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  
  async function submit(action: "create" | "delete") {
    if (selectedGroups.length === 0 && !window.confirm("Увага: групи не обрані. Зміна буде застосована до ВСІХ груп у системі. Продовжити?")) return;
    
    setBusy(true);
    try {
      const response = await api.schedule.bulkCurator({
          day_of_week: day,
          lesson_number: lesson,
          week_type: week,
          group_ids: selectedGroups,
          action: action
      });
      onSuccess(action === "create" ? `Успішно створено: ${response.created} пар. Пропущено (через існуючі пари): ${response.skipped}.` : `Успішно видалено: ${response.deleted} виховних годин.`);
      onClose();
    } catch (e: any) {
      alert("Сталася помилка при масовій операції: " + (e.message || "Невідома помилка"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[rgba(5,8,16,0.7)] backdrop-blur-[2px]">
      <div className="surface-panel max-h-[92dvh] w-full max-w-xl overflow-y-auto p-5 shadow-2xl sm:p-6">
        <h2 className="mb-2 text-center text-lg font-semibold text-sys-text-primary">Генерація виховних годин</h2>
        <p className="text-xs text-sys-text-secondary text-center mb-5">Цей інструмент автоматично знайде предмет "Виховна година" (або створить його) і призначить пару викладачам-кураторам їхніх груп.</p>
        
        <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-sm text-sys-text-secondary">
            День
            <select value={day} onChange={e => setDay(Number(e.target.value))} className="form-control">
              <option value={1}>Понеділок</option><option value={2}>Вівторок</option><option value={3}>Середа</option><option value={4}>Четвер</option><option value={5}>П'ятниця</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-sys-text-secondary">
            Пара
            <select value={lesson} onChange={e => setLesson(Number(e.target.value))} className="form-control">
              <option value={1}>1 пара</option><option value={2}>2 пара</option><option value={3}>3 пара</option><option value={4}>4 пара</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-sys-text-secondary">
            Тиждень
            <select value={week} onChange={e => setWeek(e.target.value as any)} className="form-control">
              <option value="both">Щотижня</option><option value="numerator">Чисельник</option><option value="denominator">Знаменник</option>
            </select>
          </label>
        </div>
        
        <div className="mb-5 space-y-2 text-sm text-sys-text-secondary">
          <div className="flex items-center justify-between gap-3">
            <span>Оберіть групи <span className="text-xs text-sys-text-muted">(порожньо = усі групи)</span></span>
            {selectedGroups.length > 0 && (
              <button type="button" onClick={() => setSelectedGroups([])} className="text-xs font-medium text-sys-accent hover:underline">
                Очистити
              </button>
            )}
          </div>
          <SearchableMultiSelect
            options={groups}
            value={selectedGroups}
            onChange={setSelectedGroups}
            placeholder="Пошук групи..."
          />
        </div>
        
        <div className="flex gap-2">
          <button type="button" disabled={busy} onClick={() => submit("create")} className="flex-1 rounded-[6px] bg-sys-accent px-4 py-2 text-sm font-semibold text-[#0b1120] hover:opacity-90">
            Згенерувати Виховні
          </button>
          <button type="button" disabled={busy} onClick={() => submit("delete")} className="rounded-[6px] border border-rose-500/50 text-rose-400 bg-transparent px-4 py-2 text-sm font-semibold hover:bg-rose-500/10 transition-colors">
            Видалити
          </button>
        </div>
        
        <button type="button" onClick={onClose} disabled={busy} className="mt-3 w-full rounded-[6px] border border-sys-border bg-transparent px-4 py-2 text-sm text-sys-text-primary hover:bg-slate-800 transition-colors">
          Скасувати / Закрити
        </button>
      </div>
    </div>
  );
}
