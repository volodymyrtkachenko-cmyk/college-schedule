"use client";

import { useEffect, useState } from "react";
import { api, CurriculumRecord, CurriculumMutation, ReferenceRecord } from "../../lib/api";
import { ConfirmModal } from "./ConfirmModal";
import { SearchableSelect } from "../SearchableSelect";
import { SearchableMultiSelect } from "../SearchableMultiSelect";
import { useToast } from "../ToastProvider";
import { PageHeader } from "./PageHeader";

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

  const [filterGroupId, setFilterGroupId] = useState<number | null>(null);
  const [filterTeacherId, setFilterTeacherId] = useState<number | null>(null);

  const filteredItems = items.filter(i => {
    if (filterGroupId !== null && i.group.id !== filterGroupId) return false;
    if (filterTeacherId !== null && i.teacher.id !== filterTeacherId && i.second_teacher?.id !== filterTeacherId) return false;
    if (!searchTerm) return true;
    const q = searchTerm.toLowerCase();
    return i.group.name.toLowerCase().includes(q) || 
           i.teacher.name.toLowerCase().includes(q) || 
           i.subject.name.toLowerCase().includes(q);
  });
  
  const sortedItems = [...filteredItems].sort((a, b) =>
    a.group.name.localeCompare(b.group.name, "uk", { numeric: true, sensitivity: "base" }) ||
    a.subject.name.localeCompare(b.subject.name, "uk", { sensitivity: "base" }),
  );

  const pairsPerWeekSum = filteredItems.reduce((acc, curr) => acc + (curr.pairs_per_2_weeks || 0), 0) / 2;
  const totalHoursSum = filteredItems.reduce((acc, curr) => acc + (curr.total_hours || 0), 0);

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
      <PageHeader
        eyebrow="ПЛАНУВАННЯ"
        title="Навчальне навантаження"
        description="Розподіл предметів, аудиторних годин та викладачів між групами для розкладу"
        actions={
          <button
            onClick={() => {
              setSelectedGroupIds([]);
              setEditor({ is_fixed: false, is_stream: false, pairs_per_2_weeks: 2, total_hours: 40 });
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-sys-accent px-4 py-2 text-sm font-semibold text-[#0b1120] hover:opacity-90 transition-opacity"
          >
            + Додати навантаження
          </button>
        }
      />

      <div className="flex flex-col gap-3 mt-2">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sys-text-muted pointer-events-none">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0" /><path d="M21 21l-6 -6" /></svg>
            </span>
            <input 
              type="search"
              aria-label="Пошук навчального навантаження"
              placeholder="Знайти предмет або викладача..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="form-control w-full py-2 pl-9 pr-4 text-sm"
            />
          </div>

          <div className="w-full sm:w-52">
            <SearchableSelect
              options={[...groups].sort((a, b) => a.name.localeCompare(b.name, "uk"))}
              value={filterGroupId}
              onChange={setFilterGroupId}
              placeholder="Фільтр за групою"
              emptyLabel="Усі групи"
              ariaLabel="Фільтр за групою"
            />
          </div>

          <div className="w-full sm:w-56">
            <SearchableSelect
              options={[...teachers].sort((a, b) => a.name.localeCompare(b.name, "uk"))}
              value={filterTeacherId}
              onChange={setFilterTeacherId}
              placeholder="Фільтр за викладачем"
              emptyLabel="Усі викладачі"
              ariaLabel="Фільтр за викладачем"
            />
          </div>

          {(searchTerm || filterGroupId !== null || filterTeacherId !== null) && (
            <button
              type="button"
              onClick={() => {
                setSearchTerm("");
                setFilterGroupId(null);
                setFilterTeacherId(null);
              }}
              className="text-xs font-semibold text-sys-accent hover:underline py-1"
            >
              Скинути фільтри
            </button>
          )}
        </div>

        {/* Summary Bar */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border border-sys-border bg-sys-card px-4 py-2.5 text-xs text-sys-text-secondary">
          <div className="flex items-center gap-1.5 font-medium">
            <span className="text-sys-text-muted">Знайдено записів:</span>
            <span className="font-bold text-sys-text-primary">{filteredItems.length}</span>
          </div>
          <span className="text-sys-border hidden sm:inline">•</span>
          <div className="flex items-center gap-1.5 font-medium">
            <span className="text-sys-text-muted">Сума пар на тиждень:</span>
            <span className="font-bold text-emerald-400">{pairsPerWeekSum % 1 === 0 ? pairsPerWeekSum : pairsPerWeekSum.toFixed(1)}</span>
          </div>
          <span className="text-sys-border hidden sm:inline">•</span>
          <div className="flex items-center gap-1.5 font-medium">
            <span className="text-sys-text-muted">Всього заплановано годин:</span>
            <span className="font-bold text-sys-text-primary">{totalHoursSum} год</span>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="mt-8 text-center text-sys-text-secondary">Завантаження даних…</div>
      ) : error ? (
        <div className="mt-8 text-center text-rose-500">{error}</div>
      ) : (
        <>
          {/* Desktop Table View (>=768px) */}
          <div className="surface-panel mt-4 overflow-x-auto hidden md:block">
            <table className="w-full text-left text-sm border-collapse">
              <thead className="bg-[#111827] sticky top-0 z-10">
                <tr>
                  <th className="px-5 py-3.5 font-semibold text-sys-text-secondary whitespace-nowrap border-b border-sys-border text-xs uppercase tracking-wider">Група</th>
                  <th className="px-5 py-3.5 font-semibold text-sys-text-secondary border-b border-sys-border text-xs uppercase tracking-wider min-w-[200px]">Предмет</th>
                  <th className="px-5 py-3.5 font-semibold text-sys-text-secondary border-b border-sys-border text-xs uppercase tracking-wider min-w-[150px]">Викладач</th>
                  <th className="px-5 py-3.5 font-semibold text-sys-text-secondary border-b border-sys-border text-xs uppercase tracking-wider">Другий викладач</th>
                  <th className="px-5 py-3.5 font-semibold text-sys-text-secondary border-b border-sys-border text-xs uppercase tracking-wider text-center">Пари / 2 тижні</th>
                  <th className="px-5 py-3.5 font-semibold text-sys-text-secondary border-b border-sys-border text-xs uppercase tracking-wider text-center">Годин</th>
                  <th className="px-5 py-3.5 font-semibold text-sys-text-secondary border-b border-sys-border text-xs uppercase tracking-wider">Позначки</th>
                  <th className="px-5 py-3.5 font-semibold text-sys-text-secondary border-b border-sys-border text-right min-w-[100px]">Дії</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-sys-border/50">
                {sortedItems.map(item => (
                  <tr key={item.id} className="hover:bg-white/[0.02] transition-colors group">
                    <td className="px-5 py-3 whitespace-nowrap">
                      <span className="font-semibold text-sys-text-primary px-2 py-0.5 bg-sys-accent/10 text-sys-accent rounded text-xs">{item.group.name}</span>
                    </td>
                    <td className="px-5 py-3 text-sys-text-primary font-medium">{item.subject.name}</td>
                    <td className="px-5 py-3 text-sys-text-secondary">{item.teacher.name}</td>
                    <td className="px-5 py-3 text-sys-text-secondary text-[13px]">{item.second_teacher?.name || <span className="text-sys-text-muted">—</span>}</td>
                    <td className="px-5 py-3 text-center text-emerald-400 font-black text-lg">{item.pairs_per_2_weeks}</td>
                    <td className="px-5 py-3 text-center text-sys-text-secondary font-medium">{item.total_hours}</td>
                    <td className="px-5 py-3 flex gap-2">
                      {item.is_fixed && <span title="Заняття закріплено за конкретним часом" className="inline-flex items-center rounded bg-sys-input px-2 py-0.5 text-xs text-sys-text-secondary border border-sys-border/60">Закріплено</span>}
                      {item.is_stream && <span title="Заняття проводиться для спільного потоку" className="inline-flex items-center rounded bg-sys-accent/15 px-2 py-0.5 text-xs text-sys-accent border border-sys-accent/30 font-medium">Потік</span>}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setEditor(item)}
                          className="h-9 w-9 flex items-center justify-center rounded-lg text-sys-text-secondary hover:text-sys-accent hover:bg-sys-accent/10 transition-colors"
                          title="Редагувати"
                          aria-label={`Редагувати навантаження з предмета ${item.subject.name} для групи ${item.group.name}`}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>
                        </button>
                        <button
                          onClick={() => setItemToDelete(item)}
                          className="h-9 w-9 flex items-center justify-center rounded-lg text-sys-text-secondary hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                          title="Видалити"
                          aria-label={`Видалити навантаження`}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        </button>
                      </div>
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

          {/* Mobile Card List View (<768px) */}
          <div className="md:hidden space-y-3 mt-4">
            {sortedItems.map(item => (
              <div key={item.id} className="rounded-xl border border-sys-border bg-sys-card p-4 space-y-2.5 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-sys-accent px-2 py-0.5 bg-sys-accent/10 rounded text-xs">
                    {item.group.name}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {item.is_fixed && (
                      <span className="rounded bg-sys-input px-2 py-0.5 text-xs text-sys-text-secondary border border-sys-border/60">
                        Закріплено
                      </span>
                    )}
                    {item.is_stream && (
                      <span className="rounded bg-sys-accent/15 px-2 py-0.5 text-xs text-sys-accent border border-sys-accent/30 font-medium">
                        Потік
                      </span>
                    )}
                  </div>
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-sys-text-primary">{item.subject.name}</h4>
                  <p className="text-xs text-sys-text-secondary mt-0.5">
                    {item.teacher.name}
                    {item.second_teacher && ` • ${item.second_teacher.name}`}
                  </p>
                </div>
                <div className="flex items-center justify-between pt-1 border-t border-sys-border/50 text-xs text-sys-text-muted">
                  <div>
                    <span className="text-emerald-400 font-bold">{item.pairs_per_2_weeks}</span> пар/2 тиж. •{" "}
                    <span className="text-sys-text-secondary">{item.total_hours} год.</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setEditor(item)}
                      className="h-9 w-9 flex items-center justify-center rounded-lg text-sys-text-secondary hover:text-sys-accent hover:bg-sys-accent/10 active:scale-95 transition-all"
                      title="Редагувати"
                      aria-label={`Редагувати ${item.subject.name}`}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                    </button>
                    <button
                      onClick={() => setItemToDelete(item)}
                      className="h-9 w-9 flex items-center justify-center rounded-lg text-sys-text-secondary hover:text-rose-400 hover:bg-rose-500/10 active:scale-95 transition-all"
                      title="Видалити"
                      aria-label={`Видалити ${item.subject.name}`}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {sortedItems.length === 0 && (
              <div className="rounded-xl border border-dashed border-sys-border p-8 text-center text-sys-text-secondary text-sm">
                Нічого не знайдено за вашим запитом.
              </div>
            )}
          </div>
        </>
      )}

      {editor && (
        <div
          className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4 backdrop-blur-sm shadow-2xl"
          onClick={(e) => {
            if (e.target === e.currentTarget) setEditor(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={editor.id ? "Редагування навантаження" : "Нове навантаження"}
            className="flex max-h-[92dvh] w-full sm:max-w-2xl flex-col rounded-t-2xl sm:rounded-2xl border border-sys-border bg-sys-card shadow-2xl overflow-hidden pb-safe animate-in slide-in-from-bottom-6 sm:slide-in-from-bottom-2 duration-200"
          >
            <div className="bg-gradient-to-b from-white/5 to-transparent p-5 sm:p-6 pb-4 border-b border-sys-border/50 sticky top-0 flex justify-between items-center z-10 bg-sys-card">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sys-accent/20 text-sys-accent">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg>
                </div>
                <div>
                  <h3 className="text-base sm:text-lg font-bold text-sys-text-primary">
                    {editor.id ? "Редагування навантаження" : "Нове навантаження"}
                  </h3>
                  <p className="text-xs text-sys-text-secondary mt-0.5">{editor.id ? "Змініть параметри плану для групи" : "Додайте план одразу для багатьох груп"}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditor(null)}
                aria-label="Закрити"
                className="w-8 h-8 flex items-center justify-center rounded-lg text-sys-text-secondary hover:bg-white/5 hover:text-sys-text-primary transition-colors text-base"
              >
                ✕
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

               <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 mt-1">
                  <span className="text-sm font-medium text-sys-text-secondary w-auto sm:w-32 shrink-0">Тип тижня:</span>
                  <select value={editor.require_week || ""} onChange={e => setEditor({...editor, require_week: e.target.value || null})} className="form-control text-sm flex-1">
                    <option value="">Без обмежень</option>
                    <option value="numerator">Тільки чисельник</option>
                    <option value="denominator">Тільки знаменник</option>
                  </select>
               </div>
               
               {editor.is_fixed && (
                     <div className="flex flex-col sm:flex-row gap-2.5 mt-2 ml-0 sm:ml-8">
                       <select value={editor.strict_day || ""} onChange={e => setEditor({...editor, strict_day: parseInt(e.target.value)})} className="form-control text-sm flex-1">
                         <option value="" disabled>Оберіть день</option>
                         <option value="1">Понеділок</option>
                         <option value="2">Вівторок</option>
                         <option value="3">Середа</option>
                         <option value="4">Четвер</option>
                         <option value="5">П'ятниця</option>
                       </select>
                       {editor.allow_multiple_per_day ? (
                         <select value={editor.strict_lesson || ""} onChange={e => setEditor({...editor, strict_lesson: e.target.value ? parseInt(e.target.value) : null})} className="form-control text-sm flex-1">
                           <option value="">Автоматичний підбір пар</option>
                           <option value="12">1 та 2 пари (2 пари)</option>
                           <option value="23">2 та 3 пари (2 пари)</option>
                           <option value="34">3 та 4 пари (2 пари)</option>
                           <option value="123">1, 2 та 3 пари (3 пари)</option>
                           <option value="234">2, 3 та 4 пари (3 пари)</option>
                           <option value="1234">Усі 4 пари</option>
                         </select>
                       ) : (
                         <select value={editor.strict_lesson || ""} onChange={e => setEditor({...editor, strict_lesson: e.target.value ? parseInt(e.target.value) : null})} className="form-control text-sm flex-1">
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
            
            <div className="sticky bottom-0 z-10 bg-sys-bg/80 backdrop-blur-xs p-4 sm:px-6 sm:py-3.5 flex flex-col-reverse sm:flex-row justify-end gap-2.5 border-t border-sys-border/50">
               <button
                  type="button"
                  onClick={() => setEditor(null)}
                  className="w-full sm:w-auto min-h-[44px] sm:min-h-[40px] rounded-lg border border-sys-border bg-sys-card px-4 py-2 text-sm font-semibold text-sys-text-primary hover:bg-white/5 active:scale-[0.98] transition-all"
               >
                  Скасувати
               </button>
               <button
                  type="submit"
                  form="curr-form"
                  className="w-full sm:w-auto min-h-[44px] sm:min-h-[40px] flex items-center justify-center gap-2 rounded-lg bg-sys-accent px-6 py-2 text-sm font-bold text-[#0b1120] hover:opacity-90 active:scale-[0.98] transition-all shadow-sm"
               >
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
