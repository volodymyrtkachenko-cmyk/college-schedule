import { useState, useEffect } from "react";
import { api, DraftSlotRecord, ImportCancellation, ImportSubstitution, ImporterResponse, ReferenceRecord } from "../../lib/api";
import { useAuth } from "../../lib/auth";

export function ImportPanel() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "importing" | "mapping" | "ready" | "success">("idle");
  const [report, setReport] = useState<ImporterResponse["report"] | null>(null);
  
  // Dictionaries for mapping
  const [teachers, setTeachers] = useState<ReferenceRecord[]>([]);
  const [subjects, setSubjects] = useState<ReferenceRecord[]>([]);
  const [groups, setGroups] = useState<ReferenceRecord[]>([]);
  
  // Mapping state: { rawName: actual_id }
  const [mappings, setMappings] = useState<Record<string, number>>({});
  const [substitutions, setSubstitutions] = useState<ImportSubstitution[]>([]);
  const [cancelled, setCancelled] = useState<ImportCancellation[]>([]);
  const [draftId, setDraftId] = useState<number | null>(null);
  const [importSlots, setImportSlots] = useState<DraftSlotRecord[]>([]);
  const [selectedHistory, setSelectedHistory] = useState<number | null>(null);
  const [historySlots, setHistorySlots] = useState<DraftSlotRecord[]>([]);
  const [historyChanges, setHistoryChanges] = useState<Awaited<ReturnType<typeof api.generator.getSubstitutions>>>([]);
  const [importHistory, setImportHistory] = useState<Array<{ id: number; name: string; status: string; created_at: string; data?: { substitutions?: ImportSubstitution[]; cancelled?: ImportCancellation[] } | null }>>([]);

  useEffect(() => {
    async function loadDicts() {
      try {
        const session = await api.auth.ensureAuthenticated();
        const [t, s, g] = await Promise.all([
          api.references.list("teachers", session.access_token),
          api.references.list("subjects", session.access_token),
          api.references.list("groups", session.access_token)
        ]);
        setTeachers(t);
        setSubjects(s);
        setGroups(g);
      } catch (err) {
        console.error("Failed to load dictionaries", err);
      }
    }
    loadDicts();
  }, []);

  useEffect(() => {
    async function loadPendingImport() {
      try {
        const session = await api.auth.ensureAuthenticated();
        const drafts = await api.generator.listDrafts(session.access_token);
        setImportHistory(
          drafts.filter((draft) => draft.draft_type === "import" && draft.status !== "pending").slice(0, 10),
        );
        const pending = drafts.find(
          (draft) => draft.draft_type === "import" && draft.status === "pending",
        );
        if (!pending) return;
        setDraftId(pending.id);
        setImportSlots(await api.generator.getSlots(pending.id, session.access_token));
        if (!pending.data) {
          setReport({ unresolved: [], base_slots: [], substitutions: [], cancelled: [] });
          setStatus("ready");
          return;
        }
        const nextSubstitutions = pending.data.substitutions ?? [];
        const nextCancelled = pending.data.cancelled ?? [];
        setSubstitutions(nextSubstitutions);
        setCancelled(nextCancelled);
        setReport({
          unresolved: [],
          base_slots: [],
          substitutions: nextSubstitutions,
          cancelled: nextCancelled,
        });
        setStatus(nextSubstitutions.length || nextCancelled.length ? "mapping" : "ready");
      } catch {
        // The import button remains available when no pending draft can be loaded.
      }
    }
    void loadPendingImport();
  }, []);

  const handleImport = async () => {
    setLoading(true);
    setError(null);
    setStatus("importing");
    
    try {
      const session = await api.auth.ensureAuthenticated();
      const res = await api.importer.importData(session.access_token);
      setDraftId(res.meta?.draft_created ?? null);
      if (res.meta?.draft_created) {
        setImportSlots(await api.generator.getSlots(res.meta.draft_created, session.access_token));
      }
      
      if (res.report.unresolved.length > 0 || res.report.substitutions.length > 0 || (res.report.cancelled?.length ?? 0) > 0) {
        setReport(res.report);
        setSubstitutions(res.report.substitutions);
        setCancelled(res.report.cancelled ?? []);
        setStatus("mapping");
        // Initialize mappings state
        const initialMap: Record<string, number> = {};
        res.report.unresolved.forEach(item => { initialMap[item.raw] = 0; });
        setMappings(initialMap);
      } else {
        setReport(res.report);
        setSubstitutions(res.report.substitutions);
        setCancelled(res.report.cancelled ?? []);
        setStatus("ready");
      }
    } catch (err: any) {
      setError(err?.message || "Скоріш за все сталася помилка з'єднання.");
      setStatus("idle");
    } finally {
      setLoading(false);
    }
  };

  const handleMappingSubmit = async () => {
    if (!report) return;
    
    // Check if everything is mapped
    const unmapped = report.unresolved.some(item => !mappings[item.raw]);
    if (unmapped) {
        setError("Будь ласка, оберіть відповідності для всіх записів.");
        return;
    }
    
    setLoading(true);
    setError(null);
    try {
        const session = await api.auth.ensureAuthenticated();
        const body = report.unresolved.map(item => ({
            entity_type: item.type,
            parsed_name: item.raw,
            actual_id: mappings[item.raw]
        }));
        await api.importer.bulkCreateAliases(body, session.access_token);
        
        // Retry import immediately!
        await handleImport();
    } catch (err: any) {
        setError(err?.message || "Помилка при збереженні аліасів.");
        setLoading(false);
    }
  };

  const saveChanges = async () => {
    if (!draftId || !report) return;
    setLoading(true);
    setError(null);
    try {
      const session = await api.auth.ensureAuthenticated();
      await api.generator.updateImportChanges(draftId, { substitutions, cancelled }, session.access_token);
      setReport({
        unresolved: report.unresolved ?? [],
        base_slots: report.base_slots ?? [],
        substitutions,
        cancelled,
      });
      setStatus("ready");
    } catch (err: any) {
      setError(err?.message || "Не вдалося зберегти зміни імпорту.");
    } finally {
      setLoading(false);
    }
  };

  const publishImport = async () => {
    if (!draftId) return;
    setLoading(true);
    setError(null);
    try {
      const session = await api.auth.ensureAuthenticated();
      await api.generator.publish(draftId, session.access_token);
      setStatus("success");
    } catch (err: any) {
      setError(err?.message || "Не вдалося опублікувати імпорт.");
    } finally {
      setLoading(false);
    }
  };

  const viewHistory = async (id: number) => {
    try {
      const session = await api.auth.ensureAuthenticated();
      const [nextSlots, nextChanges] = await Promise.all([
        api.generator.getSlots(id, session.access_token),
        api.generator.getSubstitutions(id, session.access_token),
      ]);
      setHistorySlots(nextSlots);
      setHistoryChanges(nextChanges);
      setSelectedHistory(id);
    } catch (err: any) {
      setError(err?.message || "Не вдалося завантажити імпорт.");
    }
  };

  const deleteHistory = async (id: number) => {
    if (!window.confirm("Видалити цей імпорт з архіву? Відновити його буде неможливо.")) return;
    try {
      const session = await api.auth.ensureAuthenticated();
      await api.generator.deleteDraft(id, session.access_token);
      setImportHistory(current => current.filter(item => item.id !== id));
      if (selectedHistory === id) setSelectedHistory(null);
    } catch (err: any) {
      setError(err?.message || "Не вдалося видалити імпорт.");
    }
  };

  const moveImportSlot = async (slot: DraftSlotRecord, day: number, lesson: number) => {
    if (!draftId) return;
    try {
      const session = await api.auth.ensureAuthenticated();
      const updated = await api.generator.moveSlot(slot.id, day, lesson, slot.week_type, session.access_token);
      setImportSlots(current => current.map(item => item.id === updated.id ? updated : item));
    } catch (err: any) {
      setError(err?.message || "Не вдалося змінити імпорт.");
    }
  };

  const handlePrimaryAction = async () => {
    if (!report) return;
    if (report.unresolved.length > 0) {
      await handleMappingSubmit();
    } else {
      await saveChanges();
    }
  };

  const getOptions = (type: string) => {
      switch (type) {
          case 'teacher': return teachers;
          case 'subject': return subjects;
          case 'group': return groups;
          default: return [];
      }
  };

  return (
    <div className="bg-sys-card rounded-xl p-6 border border-sys-border">
      <div>
        <h2 className="text-xl font-bold mb-4">Імпорт з кре.дп.юа</h2>
        
        {error && (
            <div className="mb-4 bg-red-500/10 border border-red-500/30 text-rose-300 p-3 rounded-lg text-sm">
                {error}
            </div>
        )}

        {status === "idle" && (
            <div>
               <p className="text-sys-text-secondary text-sm mb-6 max-w-lg">
                   Натисніть кнопку нижче, щоб система автоматично обійшла всі групи на сайті kre.dp.ua,
                   зібрала актуальний розклад та віднайшла зміни. Базовий розклад при цьому не змінюється.
               </p>
               <button onClick={handleImport} disabled={loading} className="bg-sys-accent text-[#0b1120] font-bold py-2 px-5 rounded-lg disabled:opacity-50 flex items-center gap-2">
                   {loading ? (
                     <><svg className="animate-spin -ml-1 mr-2 h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Імпортуємо...</>
                   ) : "Почати імпорт"}
               </button>
               {importHistory.length > 0 && (
                 <div className="mt-8 border-t border-sys-border pt-5">
                   <h3 className="mb-3 text-sm font-semibold text-sys-text-primary">Історія імпортів</h3>
                   <div className="space-y-2">
                     {importHistory.map((item) => (
                       <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sys-border bg-sys-card p-3 text-sm">
                         <div>
                           <div className="font-medium text-sys-text-primary">{item.name}</div>
                           <div className="text-xs text-sys-text-muted">
                             {new Intl.DateTimeFormat("uk-UA", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.created_at))}
                           </div>
                         </div>
                         <div className="flex flex-wrap items-center gap-2 text-xs text-sys-text-secondary">
                           <span>Заміни: {item.data?.substitutions?.length ?? 0}</span>
                           <span>Скасування: {item.data?.cancelled?.length ?? 0}</span>
                           <span className="rounded bg-white/5 px-2 py-1">{item.status === "published" ? "Опубліковано" : "Архів"}</span>
                           <button type="button" onClick={() => void viewHistory(item.id)} className="rounded-lg border border-sys-accent/30 px-2 py-1 text-sys-accent hover:bg-sys-accent/10">Переглянути</button>
                           {item.status === "archived" && (
                             <button type="button" onClick={() => void deleteHistory(item.id)} className="rounded-lg border border-rose-400/30 px-2 py-1 text-rose-300 hover:bg-rose-500/10">Видалити</button>
                           )}
                         </div>
                       </div>
                     ))}
                   </div>
                   {selectedHistory !== null && (
                     <div className="mt-4 rounded-xl border border-sys-border bg-sys-bg/40 p-4">
                       <div className="mb-3 flex items-center justify-between">
                         <h4 className="font-semibold">Перегляд імпорту</h4>
                         <button type="button" onClick={() => setSelectedHistory(null)} className="text-sm text-sys-text-secondary hover:text-white">Закрити</button>
                       </div>
                       <div className="max-h-80 overflow-auto text-xs">
                         <table className="w-full text-left">
                           <thead><tr className="border-b border-sys-border text-sys-text-muted"><th className="p-2">Група</th><th className="p-2">Предмет</th><th className="p-2">День</th><th className="p-2">Пара</th><th className="p-2">Тиждень</th></tr></thead>
                           <tbody>
                             {historySlots.map(slot => (
                               <tr key={slot.id} className="border-b border-sys-border/50">
                                 <td className="p-2">{slot.curriculum.group.name}</td>
                                 <td className="p-2">{slot.curriculum.subject.name}</td>
                                 <td className="p-2">{slot.day_of_week}</td>
                                 <td className="p-2">{slot.lesson_number}</td>
                                 <td className="p-2">{slot.week_type}</td>
                               </tr>
                             ))}
                           </tbody>
                         </table>
                         {historyChanges.length > 0 && (
                           <div className="mt-4 space-y-1 border-t border-sys-border pt-3">
                             <div className="mb-2 font-semibold text-sys-text-secondary">Імпортні зміни</div>
                             {historyChanges.map((change, index) => (
                               <div key={`${change.date}-${change.group_id}-${change.lesson_number}-${index}`} className="flex flex-wrap gap-x-3 gap-y-1 rounded-lg bg-white/[0.03] p-2">
                                 <span>{change.date}</span>
                                 <span>{change.group_name ?? "Невідома група"}</span>
                                 <span>{change.lesson_number}-та пара</span>
                                 <span className={change.kind === "cancelled" ? "text-rose-300" : "text-amber-200"}>
                                   {change.kind === "cancelled" ? "Скасовано" : `${change.subject_name ?? "Заміна"} · ${change.teacher_name ?? "Без викладача"}`}
                                 </span>
                               </div>
                             ))}
                           </div>
                         )}
                         {!historySlots.length && !historyChanges.length && <p className="p-3 text-sys-text-muted">В імпорті немає слотів або змін.</p>}
                       </div>
                     </div>
                   )}
                 </div>
               )}
            </div>
        )}

        {status === "mapping" && report && (
            <div className="animate-in fade-in slide-in-from-bottom-2">
                <div className="bg-yellow-500/10 border border-yellow-500/30 text-amber-300 p-4 rounded-lg text-sm mb-6">
                    <h3 className="font-bold flex items-center gap-2 mb-1">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
                        Знайдено нові записи
                    </h3>
                    <p className="opacity-80">Перед тим, як залити розклад у базу, переконайтеся, що ви зв'язали ці нові назви з наявними в системі. Заповніть усі поля.</p>
                </div>

                {importSlots.length > 0 && (
                  <div className="mb-6 space-y-3">
                    <h3 className="font-semibold">Базовий розклад імпорту</h3>
                    <div className="max-h-80 overflow-auto rounded-xl border border-sys-border">
                      {importSlots.map(slot => (
                        <div key={slot.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 border-b border-sys-border/50 p-2 text-xs last:border-0">
                          <span>{slot.curriculum.group.name} · {slot.curriculum.subject.name}</span>
                          <select value={slot.day_of_week} onChange={e => void moveImportSlot(slot, Number(e.target.value), slot.lesson_number)} className="form-control py-1">
                            {[1, 2, 3, 4, 5].map(day => <option key={day} value={day}>{day}</option>)}
                          </select>
                          <select value={slot.lesson_number} onChange={e => void moveImportSlot(slot, slot.day_of_week, Number(e.target.value))} className="form-control py-1">
                            {[1, 2, 3, 4].map(lesson => <option key={lesson} value={lesson}>{lesson}</option>)}
                          </select>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-3 mb-6 bg-slate-900/50 p-4 rounded-xl border border-sys-border">
                    {report.unresolved.map((item, idx) => (
                        <div key={idx} className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 py-2 border-b border-white/5 last:border-0">
                            <div className="flex-1">
                                <span className="inline-block text-[10px] uppercase font-bold text-sys-text-secondary bg-white/5 px-2 py-0.5 rounded mr-3">
                                    {item.type === 'teacher' ? 'Викладач' : item.type === 'subject' ? 'Предмет' : 'Група'}
                                </span>
                                <strong className="text-gray-200">{item.raw}</strong>
                            </div>
                            <select
                                className="w-full sm:w-[300px] form-control py-2 text-sm"
                                value={mappings[item.raw] || 0}
                                onChange={(e) => setMappings({...mappings, [item.raw]: Number(e.target.value)})}
                            >
                                <option value={0}>-- Оберіть з бази --</option>
                                {getOptions(item.type).map(opt => (
                                    <option key={opt.id} value={opt.id}>{opt.name}</option>
                                ))}
                            </select>
                        </div>
                    ))}
                </div>

                {substitutions.length > 0 && (
                  <div className="mb-6 space-y-3">
                    <h3 className="font-semibold">Заміни — перегляд у форматі чернетки розкладу</h3>
                    {substitutions.map((item, index) => (
                      <div key={`${item.date}-${item.group_id}-${item.lesson_number}-${index}`} className="rounded-xl border border-sys-border bg-sys-card p-3 shadow-sm">
                        <div className="mb-2 flex items-center justify-between gap-2 text-xs font-semibold text-sys-text-muted">
                          <span>{item.date} · імпортна зміна</span>
                          <span className="rounded bg-sys-accent px-1.5 py-0.5 text-[10px] font-bold text-slate-950">Заміна</span>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-7">
                        <input type="date" value={item.date} onChange={(e) => setSubstitutions(current => current.map((value, i) => i === index ? { ...value, date: e.target.value } : value))} className="form-control" />
                        <select value={item.group_id} onChange={(e) => setSubstitutions(current => current.map((value, i) => i === index ? { ...value, group_id: Number(e.target.value) } : value))} className="form-control">
                          {groups.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
                        </select>
                        <select value={item.subject_id} onChange={(e) => setSubstitutions(current => current.map((value, i) => i === index ? { ...value, subject_id: Number(e.target.value) } : value))} className="form-control">
                          {subjects.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
                        </select>
                        <select value={item.teacher_id} onChange={(e) => setSubstitutions(current => current.map((value, i) => i === index ? { ...value, teacher_id: Number(e.target.value) } : value))} className="form-control">
                          {teachers.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
                        </select>
                        <select value={item.second_teacher_id ?? 0} onChange={(e) => setSubstitutions(current => current.map((value, i) => i === index ? { ...value, second_teacher_id: Number(e.target.value) || null } : value))} className="form-control">
                          <option value={0}>Без другого викладача</option>
                          {teachers.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
                        </select>
                        <select value={item.lesson_number} onChange={(e) => setSubstitutions(current => current.map((value, i) => i === index ? { ...value, lesson_number: Number(e.target.value) } : value))} className="form-control">
                          {[1, 2, 3, 4].map(lesson => <option key={lesson} value={lesson}>{lesson}-та пара</option>)}
                        </select>
                        <div className="flex gap-2">
                          <input value={item.room ?? ""} onChange={(e) => setSubstitutions(current => current.map((value, i) => i === index ? { ...value, room: e.target.value || null } : value))} placeholder="Аудиторія" className="form-control min-w-0 flex-1" />
                          <button type="button" onClick={() => setSubstitutions(current => current.filter((_, i) => i !== index))} className="rounded-lg px-2 text-rose-300 hover:bg-rose-500/10" aria-label="Видалити заміну">×</button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {cancelled.length > 0 && (
                  <div className="mb-6 space-y-3">
                    <h3 className="font-semibold">Скасовані пари — перегляд у форматі чернетки розкладу</h3>
                    {cancelled.map((item, index) => (
                      <div key={`${item.date}-${item.group_id}-${item.lesson_number}-${index}`} className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-3 shadow-sm">
                        <div className="mb-2 flex items-center justify-between gap-2 text-xs font-semibold text-rose-200">
                          <span>{item.date} · імпортна зміна</span>
                          <span className="rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-bold text-rose-200">Скасовано</span>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-4">
                        <input type="date" value={item.date} onChange={(e) => setCancelled(current => current.map((value, i) => i === index ? { ...value, date: e.target.value } : value))} className="form-control" />
                        <select value={item.group_id} onChange={(e) => setCancelled(current => current.map((value, i) => i === index ? { ...value, group_id: Number(e.target.value) } : value))} className="form-control">
                          {groups.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
                        </select>
                        <select value={item.lesson_number} onChange={(e) => setCancelled(current => current.map((value, i) => i === index ? { ...value, lesson_number: Number(e.target.value) } : value))} className="form-control">
                          {[1, 2, 3, 4].map(lesson => <option key={lesson} value={lesson}>{lesson}-та пара</option>)}
                        </select>
                        <button type="button" onClick={() => setCancelled(current => current.filter((_, i) => i !== index))} className="rounded-lg border border-rose-400/20 px-3 py-2 text-sm text-rose-300 hover:bg-rose-500/10">Видалити</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                
                <div className="flex items-center gap-3">
                    <button onClick={handlePrimaryAction} disabled={loading} className="bg-sys-accent text-[#0b1120] font-bold py-2.5 px-6 rounded-lg disabled:opacity-50">
                        {loading ? "Зберігаємо…" : report.unresolved.length > 0 ? "Зберегти відповідності та продовжити" : "Зберегти зміни"}
                    </button>
                    <button onClick={() => setStatus("idle")} className="py-2.5 px-4 text-sys-text-secondary hover:text-white" disabled={loading}>Скасувати</button>
                </div>
            </div>
        )}
        
        {status === "ready" && (
            <div className="animate-in fade-in text-center py-10 bg-amber-500/5 border border-amber-500/20 rounded-2xl">
                <h3 className="text-2xl font-bold text-amber-200 mb-2">Імпорт готовий до публікації</h3>
                <p className="text-sys-text-secondary max-w-md mx-auto mb-6">Перевірте зміни імпорту, а потім опублікуйте чернетку окремою дією.</p>
                <div className="flex justify-center gap-3">
                  <button onClick={publishImport} disabled={loading || !draftId} className="bg-sys-accent text-[#0b1120] font-bold py-2.5 px-6 rounded-lg disabled:opacity-50">
                    {loading ? "Публікуємо…" : "Опублікувати імпорт"}
                  </button>
                  <button onClick={() => setStatus("idle")} disabled={loading} className="py-2.5 px-4 text-sys-text-secondary hover:text-white">Скасувати</button>
                </div>
            </div>
        )}

        {status === "success" && report && (
            <div className="animate-in zoom-in-95 fade-in text-center py-10 bg-emerald-500/5 border border-emerald-500/20 rounded-2xl">
                <div className="w-16 h-16 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                </div>
                <h3 className="text-2xl font-bold text-emerald-300 mb-2">Імпорт опубліковано успішно!</h3>
                <p className="text-emerald-500/80 max-w-md mx-auto mb-6">Зміни імпорту додано до опублікованого розкладу.</p>
                
                <div className="flex justify-center gap-8 mb-8 text-left">
                    <div className="bg-[#0b1120] px-4 py-3 rounded-lg border border-white/5">
                        <div className="text-xs text-sys-text-secondary font-bold uppercase mb-1">Знайдено замін</div>
                        <div className="text-xl text-white font-black">{substitutions.length}</div>
                    </div>
                </div>
                
                <button onClick={() => setStatus("idle")} className="bg-sys-bg border border-sys-border px-6 py-2 rounded-lg text-sm font-bold text-gray-300 hover:bg-white/5 transition-colors">
                    Готово
                </button>
            </div>
        )}
      </div>
    </div>
  );
}
