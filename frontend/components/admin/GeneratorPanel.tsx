"use client";

import { useEffect, useState } from "react";
import { api, DraftRecord, DraftSlotRecord } from "../../lib/api";
import { ConfirmModal } from "./ConfirmModal";
import { SearchableSelect } from "../SearchableSelect";

export function GeneratorPanel() {
  const [drafts, setDrafts] = useState<DraftRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [activeDraft, setActiveDraft] = useState<DraftRecord | null>(null);
  const [slots, setSlots] = useState<DraftSlotRecord[]>([]);
  const [filterMode, setFilterMode] = useState<"group" | "teacher">("group");
  const [filterGroupId, setFilterGroupId] = useState<number | null>(null);
  const [filterTeacherId, setFilterTeacherId] = useState<number | null>(null);
  const [activeWeek, setActiveWeek] = useState<"numerator" | "denominator">("numerator");
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
      setFilterMode("group");
      setFilterGroupId(null);
      setFilterTeacherId(null);
      setActiveWeek("numerator");
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
    const dayNames: Record<number, string> = {1:"Понеділок", 2:"Вівторок", 3:"Середа", 4:"Четвер", 5:"П’ятниця"};
    const lessonTimes: Record<number, string> = {1:"09:00–10:20", 2:"10:40–12:00", 3:"12:30–13:50", 4:"14:00–15:20"};
    const groups = Array.from(new Map(slots.map((slot) => [slot.curriculum.group.id, slot.curriculum.group])).values())
      .sort((a, b) => a.name.localeCompare(b.name, "uk"));
    const teachers = Array.from(new Map(slots.flatMap((slot) => [
      slot.curriculum.teacher,
      ...(slot.curriculum.second_teacher ? [slot.curriculum.second_teacher] : []),
    ]).map((teacher) => [teacher.id, teacher])).values())
      .sort((a, b) => a.name.localeCompare(b.name, "uk"));
    const visibleSlots = slots.filter((slot) =>
      (slot.week_type === activeWeek || slot.week_type === "both") &&
      (filterMode === "group"
        ? filterGroupId === null || slot.curriculum.group.id === filterGroupId
        : filterTeacherId === null || slot.curriculum.teacher.id === filterTeacherId || slot.curriculum.second_teacher?.id === filterTeacherId)
    );
    const selectOptions = (filterMode === "group" ? groups : teachers).map(({ id, name }) => ({ id, name }));
    
    return (
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-4 rounded-2xl border border-sys-border bg-sys-card p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <button onClick={() => setActiveDraft(null)} className="mb-2 text-sm font-medium text-sys-accent hover:underline">← До списку розкладів</button>
            <h2 className="truncate text-xl font-bold">{activeDraft.name}</h2>
            <span className="mt-1 inline-block rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-300">
              {activeDraft.status === "DRAFT" ? "Чернетка" : activeDraft.status}
            </span>
          </div>
          <div className="w-full sm:w-72">
            <label className="form-label">{filterMode === "group" ? "Група" : "Викладач"}</label>
            <SearchableSelect
              value={filterMode === "group" ? filterGroupId : filterTeacherId}
              onChange={(id) => filterMode === "group" ? setFilterGroupId(id) : setFilterTeacherId(id)}
              options={selectOptions}
              placeholder={filterMode === "group" ? "Знайти групу..." : "Знайти викладача..."}
              emptyLabel={filterMode === "group" ? "Усі групи" : "Усі викладачі"}
              ariaLabel={filterMode === "group" ? "Фільтр за групою" : "Фільтр за викладачем"}
            />
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div role="tablist" aria-label="Тип тижня" className="flex w-full rounded-xl border border-sys-border bg-sys-card p-1 sm:w-fit">
            {(["numerator", "denominator"] as const).map((week) => (
              <button
                key={week}
                role="tab"
                aria-selected={activeWeek === week}
                onClick={() => setActiveWeek(week)}
                className={`flex-1 rounded-lg px-5 py-2 text-sm font-semibold transition-colors sm:flex-none ${
                  activeWeek === week ? "bg-sys-accent text-[#0b1120]" : "text-sys-text-secondary hover:text-sys-text-primary"
                }`}
              >
                {week === "numerator" ? "Чисельник" : "Знаменник"}
              </button>
            ))}
          </div>
          <div role="tablist" aria-label="Показати розклад" className="flex w-full rounded-xl border border-sys-border bg-sys-card p-1 sm:w-fit">
            {(["group", "teacher"] as const).map((mode) => (
              <button
                key={mode}
                role="tab"
                aria-selected={filterMode === mode}
                onClick={() => setFilterMode(mode)}
                className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition-colors sm:flex-none ${
                  filterMode === mode ? "bg-white/10 text-sys-text-primary" : "text-sys-text-secondary hover:text-sys-text-primary"
                }`}
              >
                {mode === "group" ? "За групами" : "За викладачами"}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {days.map((day) => (
            <section key={day} className="overflow-hidden rounded-2xl border border-sys-border bg-sys-card/50">
              <header className="flex items-center justify-between border-b border-sys-border px-4 py-3">
                <h3 className="font-semibold text-sys-text-primary">{dayNames[day]}</h3>
                <span className="text-xs text-sys-text-muted">
                  {visibleSlots.filter((slot) => slot.day_of_week === day).length} пар
                </span>
              </header>
              <div className="space-y-2 p-3">
                {[1, 2, 3, 4].map((lesson) => {
                  const cellSlots = visibleSlots.filter((slot) => slot.day_of_week === day && slot.lesson_number === lesson);
                  return (
                    <div
                      key={lesson}
                      className="grid min-h-20 grid-cols-[3.5rem_minmax(0,1fr)] gap-2 rounded-xl border border-dashed border-sys-border/70 p-2 transition-colors hover:border-sys-accent/40"
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        event.preventDefault();
                        const slotId = Number(event.dataTransfer.getData("slot_id"));
                        if (slotId) void handleMove(slotId, day, lesson, activeWeek);
                      }}
                    >
                      <div className="pt-1 text-center">
                        <div className="text-lg font-bold leading-none text-sys-text-primary">{lesson}</div>
                        <div className="mt-1 text-[10px] text-sys-text-muted">{lessonTimes[lesson]}</div>
                      </div>
                      <div className="min-w-0 space-y-1.5">
                        {cellSlots.length ? cellSlots.map((slot) => (
                          <article
                            key={slot.id}
                            draggable
                            onDragStart={(event) => event.dataTransfer.setData("slot_id", slot.id.toString())}
                            className="cursor-grab rounded-lg border border-sys-border bg-sys-card p-2.5 text-sm shadow-sm active:cursor-grabbing"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-x-2">
                              <span className="font-semibold text-sys-accent">{slot.curriculum.group.name}</span>
                              {slot.week_type === "both" && <span className="rounded bg-sys-accent/10 px-1.5 py-0.5 text-[10px] font-semibold text-sys-accent">Обидва тижні</span>}
                            </div>
                            <p className="mt-1 font-medium leading-snug text-sys-text-primary">{slot.curriculum.subject.name}</p>
                            <p className="mt-1 text-xs leading-snug text-sys-text-secondary">
                              {slot.curriculum.teacher.name}
                              {slot.curriculum.second_teacher ? ` · ${slot.curriculum.second_teacher.name}` : ""}
                            </p>
                          </article>
                        )) : (
                          <div className="flex min-h-14 items-center text-xs text-sys-text-muted">Вільна пара</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
        {visibleSlots.length === 0 && (
          <p className="rounded-xl border border-dashed border-sys-border p-6 text-center text-sm text-sys-text-secondary">
            {filterMode === "teacher" && filterTeacherId !== null
              ? "У вибраного викладача немає пар у цьому тижні."
              : filterMode === "group" && filterGroupId !== null
                ? "У вибраної групи немає пар у цьому тижні."
                : "У цьому тижні пар немає."}
          </p>
        )}
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
