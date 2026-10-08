import { useState, useEffect, useRef } from "react";
import { api, DraftSlotRecord, ImportCancellation, ImportSubstitution, ImporterResponse, ReferenceRecord } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { SearchableSelect } from "../SearchableSelect";

const DAY_NAMES: Record<number, string> = {
  1: "Понеділок",
  2: "Вівторок",
  3: "Середа",
  4: "Четвер",
  5: "П’ятниця",
  6: "Субота",
  7: "Неділя",
};

export function ImportPanel() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [versions, setVersions] = useState<import("../../lib/api").ScheduleVersion[]>([]);
  const [targetVersionId, setTargetVersionId] = useState<number | null>(null);
  const [status, setStatus] = useState<"idle" | "importing" | "mapping" | "ready" | "unchanged" | "success">("idle");
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
  const [selectedHistory, setSelectedHistory] = useState<number | null>(null);
  const [historySlots, setHistorySlots] = useState<DraftSlotRecord[]>([]);
  const [historyChanges, setHistoryChanges] = useState<Awaited<ReturnType<typeof api.generator.getSubstitutions>>>([]);
  const [importHistory, setImportHistory] = useState<Array<{ id: number; name: string; status: string; created_at: string; data?: { substitutions?: ImportSubstitution[]; cancelled?: ImportCancellation[] } | null }>>([]);
  const importRequestId = useRef(0);

  useEffect(() => {
    async function loadDicts() {
      try {
        const session = await api.auth.ensureAuthenticated();
        const [t, s, g, v] = await Promise.all([
          api.references.list("teachers", session.access_token),
          api.references.list("subjects", session.access_token),
          api.references.list("groups", session.access_token),
          api.scheduleVersions.list(),
        ]);
        setTeachers(t);
        setSubjects(s);
        setGroups(g);
        setVersions(v);
      } catch (err) {
        console.error("Failed to load dictionaries", err);
      }
    }
    loadDicts();
  }, []);

  useEffect(() => {
    async function loadPendingImport() {
      const requestId = importRequestId.current;
      try {
        const session = await api.auth.ensureAuthenticated();
        const drafts = await api.generator.listDrafts(session.access_token);
        if (requestId !== importRequestId.current) return;
        setImportHistory(
          drafts.filter((draft) => draft.draft_type === "import" && draft.status !== "pending").slice(0, 10),
        );
        const pending = drafts.find(
          (draft) => draft.draft_type === "import" && draft.status === "pending",
        );
        if (!pending) return;
        if (requestId !== importRequestId.current) return;
        setDraftId(pending.id);
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
                setStatus(nextSubstitutions.filter(s => (s as any).is_new !== false).length || nextCancelled.filter(c => (c as any).is_new !== false).length ? "mapping" : "unchanged");
      } catch {
        // The import button remains available when no pending draft can be loaded.
      }
    }
    void loadPendingImport();
  }, []);

  const handleImport = async () => {
    importRequestId.current += 1;
    setLoading(true);
    setError(null);
    setStatus("importing");
    
    try {
      const session = await api.auth.ensureAuthenticated();
      const res = await api.importer.importData(session.access_token);
      setDraftId(res.meta?.draft_created ?? null);
      if (res.meta?.unchanged) {
        setReport({ ...res.report, substitutions: [], cancelled: [] });
        setSubstitutions([]);
        setCancelled([]);
        setMappings({});
        setStatus("unchanged");
        return;
      }
      
      if (res.report.unresolved.length > 0 || res.report.substitutions.filter((s: any) => s.is_new !== false).length > 0 || (res.report.cancelled?.filter((c: any) => c.is_new !== false).length ?? 0) > 0) {
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
        if (res.meta?.draft_created) {
            api.generator.deleteDraft(res.meta.draft_created, session.access_token).catch(() => {});
        }
        setDraftId(null);
        setStatus("unchanged");
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
      const draft = await api.generator.getDraft(draftId, session.access_token);
      await api.generator.publish(draftId, session.access_token, targetVersionId || undefined, draft.revision);
      setStatus("success");
    } catch (err: any) {
      setError(err?.message || "Не вдалося опублікувати імпорт.");
    } finally {
      setLoading(false);
    }
  };

  const cancelImport = async () => {
    if (!draftId) {
      setStatus("idle");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const session = await api.auth.ensureAuthenticated();
      await api.generator.deleteDraft(draftId, session.access_token);
      setDraftId(null);
      setReport(null);
      setSubstitutions([]);
      setCancelled([]);
      setMappings({});
      setStatus("idle");
    } catch (err: any) {
      setError(err?.message || "Не вдалося скасувати імпорт.");
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

  const updateSubstitution = (item: ImportSubstitution, patch: Partial<ImportSubstitution>) => {
    setSubstitutions(current => current.map((value) => value === item ? { ...value, ...patch } : value));
  };

  const updateCancellation = (item: ImportCancellation, patch: Partial<ImportCancellation>) => {
    setCancelled(current => current.map((value) => value === item ? { ...value, ...patch } : value));
  };

  const formatChangeDate = (value: string) => {
    if (!value) return "Дата не вибрана";
    return new Intl.DateTimeFormat("uk-UA", { day: "numeric", month: "long", year: "numeric" }).format(new Date(`${value}T00:00:00`));
  };

  return (
    <div className="bg-sys-card rounded-xl p-6 border border-sys-border">
      <div>
        <h2 className="text-xl font-bold mb-4">Імпорт з kre.dp.ua</h2>
        
        {error && (
            <div className="mb-4 bg-red-500/10 border border-red-500/30 text-rose-300 p-3 rounded-lg text-sm">
                {error}
            </div>
        )}

        {status === "importing" && (
            <div className="animate-in fade-in py-10 text-center rounded-2xl border border-sys-accent/20 bg-sys-accent/5">
                <svg className="mx-auto mb-4 h-8 w-8 animate-spin text-sys-accent" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <h3 className="text-xl font-bold text-sys-text-primary mb-2">Збираємо розклад з kre.dp.ua</h3>
                <p className="text-sm text-sys-text-secondary max-w-md mx-auto">Обходимо групи на сайті коледжу й шукаємо заміни та скасування. Це може зайняти кілька хвилин — сторінку краще не закривати.</p>
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
                           {item.status === "published" && (
                             <a href="/admin?resource=schedule" className="rounded-lg bg-sys-accent px-2 py-1 font-semibold text-[#0b1120] hover:opacity-90">
                               Редагувати розклад
                             </a>
                           )}
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
                                 <td className="p-2">{DAY_NAMES[slot.day_of_week] ?? slot.day_of_week}</td>
                                 <td className="p-2">{slot.lesson_number}</td>
                                 <td className="p-2">{slot.week_type === "numerator" ? "Чисельник" : slot.week_type === "denominator" ? "Знаменник" : "Обидва"}</td>
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
                {report.unresolved.length > 0 && (
                    <>
                        <div className="bg-yellow-500/10 border border-yellow-500/30 text-amber-300 p-4 rounded-lg text-sm mb-6">
                    <h3 className="font-bold flex items-center gap-2 mb-1">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
                        Знайдено нові записи
                    </h3>
                    <p className="opacity-80">Перед тим, як залити розклад у базу, переконайтеся, що ви зв'язали ці нові назви з наявними в системі. Заповніть усі поля.</p>
                </div>

                <div className="space-y-3 mb-6 bg-slate-900/50 p-4 rounded-xl border border-sys-border">
                    {report.unresolved.map((item, idx) => (
                        <div key={idx} className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 py-2 border-b border-white/5 last:border-0">
                            <div className="flex-1">
                                <span className="inline-block text-[10px] uppercase font-bold text-sys-text-secondary bg-white/5 px-2 py-0.5 rounded mr-3">
                                    {item.type === 'teacher' ? 'Викладач' : item.type === 'subject' ? 'Предмет' : 'Група'}
                                </span>
                                <strong className="text-gray-200">{item.raw}</strong>
                            </div>
                            <div className="w-full sm:w-[300px]">
                                <SearchableSelect
                                    options={getOptions(item.type)}
                                    value={mappings[item.raw] || null}
                                    onChange={(id) => setMappings({...mappings, [item.raw]: id ?? 0})}
                                    placeholder="Оберіть з бази"
                                    emptyLabel="Не вибрано"
                                    ariaLabel={`Відповідність для ${item.raw}`}
                                />
                            </div>
                        </div>
                    ))}
                </div>
                    </>
                )}

                {substitutions.filter(s => (s as any).is_new !== false).length > 0 && (
                  <div className="mb-6 space-y-3">
                    <div className="flex items-end justify-between gap-3">
                      <div>
                        <h3 className="font-semibold">Заміни</h3>
                        <p className="mt-1 text-xs text-sys-text-muted">Оберіть дату, групу та нову пару. Дані збережуться після натискання кнопки внизу.</p>
                      </div>
                      <span className="rounded-full bg-sys-accent/10 px-2.5 py-1 text-xs font-semibold text-sys-accent">{substitutions.filter(s => (s as any).is_new !== false).length} нових</span>
                    </div>
                    {substitutions.filter(s => (s as any).is_new !== false).map((item, index) => (
                      <div key={`${item.date}-${item.group_id}-${item.lesson_number}-${index}`} className="min-w-0 overflow-hidden rounded-2xl border border-sys-accent/20 bg-sys-accent/[0.04] p-4 shadow-sm">
                        <div className="mb-4 flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold text-sys-text-primary">Заміна заняття</div>
                            <div className="mt-1 text-xs text-sys-text-muted">Зміна на {formatChangeDate(item.date)}, {item.lesson_number}-та пара</div>
                          </div>
                          <button type="button" onClick={() => setSubstitutions(current => current.filter((value) => value !== item))} className="rounded-lg border border-rose-400/20 px-2.5 py-1.5 text-xs font-medium text-rose-300 transition hover:bg-rose-500/10" aria-label={`Видалити заміну ${index + 1}`}>
                            Видалити
                          </button>
                        </div>
                        <div className="grid min-w-0 gap-4 md:grid-cols-2">
                          <label className="min-w-0 space-y-1.5">
                            <span className="text-xs font-medium text-sys-text-secondary">Дата заміни</span>
                            <input type="date" value={item.date} onChange={(e) => updateSubstitution(item, { date: e.target.value })} className="form-control w-full max-w-full" />
                          </label>
                          <label className="min-w-0 space-y-1.5">
                            <span className="text-xs font-medium text-sys-text-secondary">Пара</span>
                            <select value={item.lesson_number} onChange={(e) => updateSubstitution(item, { lesson_number: Number(e.target.value) })} className="form-control w-full max-w-full min-w-0">
                              {[1, 2, 3, 4].map(lesson => <option key={lesson} value={lesson}>{lesson}-та пара</option>)}
                            </select>
                          </label>
                          <label className="min-w-0 space-y-1.5">
                            <span className="text-xs font-medium text-sys-text-secondary">Група</span>
                            <SearchableSelect
                              options={groups}
                              value={item.group_id}
                              onChange={(id) => { if (id !== null) updateSubstitution(item, { group_id: id }); }}
                              placeholder="Оберіть групу"
                              ariaLabel="Група заміни"
                            />
                          </label>
                          <label className="min-w-0 space-y-1.5">
                            <span className="text-xs font-medium text-sys-text-secondary">Предмет</span>
                            <SearchableSelect
                              options={subjects}
                              value={item.subject_id}
                              onChange={(id) => { if (id !== null) updateSubstitution(item, { subject_id: id }); }}
                              placeholder="Оберіть предмет"
                              ariaLabel="Предмет заміни"
                            />
                          </label>
                          <label className="min-w-0 space-y-1.5">
                            <span className="text-xs font-medium text-sys-text-secondary">Викладач</span>
                            <SearchableSelect
                              options={teachers}
                              value={item.teacher_id}
                              onChange={(id) => { if (id !== null) updateSubstitution(item, { teacher_id: id }); }}
                              placeholder="Оберіть викладача"
                              ariaLabel="Викладач заміни"
                            />
                          </label>
                          <label className="min-w-0 space-y-1.5">
                            <span className="text-xs font-medium text-sys-text-secondary">Другий викладач <span className="font-normal text-sys-text-muted">(необов’язково)</span></span>
                            <SearchableSelect
                              options={teachers}
                              value={item.second_teacher_id}
                              onChange={(id) => updateSubstitution(item, { second_teacher_id: id })}
                              placeholder="Без другого викладача"
                              emptyLabel="Без другого викладача"
                              ariaLabel="Другий викладач заміни"
                            />
                          </label>
                          <label className="min-w-0 space-y-1.5 md:col-span-2">
                            <span className="text-xs font-medium text-sys-text-secondary">Аудиторія <span className="font-normal text-sys-text-muted">(необов’язково)</span></span>
                            <input type="text" value={item.room ?? ""} onChange={(e) => updateSubstitution(item, { room: e.target.value || null })} placeholder="Наприклад, 302 або спортзал" className="form-control w-full max-w-full" />
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {cancelled.filter(c => (c as any).is_new !== false).length > 0 && (
                  <div className="mb-6 space-y-3">
                    <div className="flex items-end justify-between gap-3">
                      <div>
                        <h3 className="font-semibold">Скасовані пари</h3>
                        <p className="mt-1 text-xs text-sys-text-muted">Вкажіть день і пару, яка не відбудеться.</p>
                      </div>
                      <span className="rounded-full bg-rose-500/10 px-2.5 py-1 text-xs font-semibold text-rose-300">{cancelled.filter(c => (c as any).is_new !== false).length} нових</span>
                    </div>
                    {cancelled.filter(c => (c as any).is_new !== false).map((item, index) => (
                      <div key={`${item.date}-${item.group_id}-${item.lesson_number}-${index}`} className="min-w-0 overflow-hidden rounded-2xl border border-rose-500/25 bg-rose-500/[0.04] p-4 shadow-sm">
                        <div className="mb-4 flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold text-rose-100">Скасування {index + 1}</div>
                            <div className="mt-1 text-xs text-rose-200/70">{formatChangeDate(item.date)} · {item.lesson_number}-та пара</div>
                          </div>
                          <button type="button" onClick={() => setCancelled(current => current.filter((value) => value !== item))} className="rounded-lg border border-rose-400/20 px-2.5 py-1.5 text-xs font-medium text-rose-300 transition hover:bg-rose-500/10" aria-label={`Видалити скасування ${index + 1}`}>
                            Видалити
                          </button>
                        </div>
                        <div className="grid min-w-0 gap-4 md:grid-cols-3">
                          <label className="min-w-0 space-y-1.5">
                            <span className="text-xs font-medium text-sys-text-secondary">Дата скасування</span>
                            <input type="date" value={item.date} onChange={(e) => updateCancellation(item, { date: e.target.value })} className="form-control w-full max-w-full" />
                          </label>
                          <label className="min-w-0 space-y-1.5">
                            <span className="text-xs font-medium text-sys-text-secondary">Група</span>
                            <SearchableSelect
                              options={groups}
                              value={item.group_id}
                              onChange={(id) => { if (id !== null) updateCancellation(item, { group_id: id }); }}
                              placeholder="Оберіть групу"
                              ariaLabel="Група скасування"
                            />
                          </label>
                          <label className="min-w-0 space-y-1.5">
                            <span className="text-xs font-medium text-sys-text-secondary">Пара</span>
                            <select value={item.lesson_number} onChange={(e) => updateCancellation(item, { lesson_number: Number(e.target.value) })} className="form-control w-full max-w-full min-w-0">
                              {[1, 2, 3, 4].map(lesson => <option key={lesson} value={lesson}>{lesson}-та пара</option>)}
                            </select>
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                
                <div className="flex items-center gap-3">
                    <button onClick={handlePrimaryAction} disabled={loading} className="bg-sys-accent text-[#0b1120] font-bold py-2.5 px-6 rounded-lg disabled:opacity-50">
                        {loading ? "Зберігаємо…" : report.unresolved.length > 0 ? "Зберегти відповідності та продовжити" : "Зберегти зміни"}
                    </button>
                    <button onClick={() => void cancelImport()} className="py-2.5 px-4 text-sys-text-secondary hover:text-white" disabled={loading}>Скасувати імпорт</button>
                </div>
            </div>
        )}
        
                        {status === "ready" && (
            <div className="animate-in fade-in text-center py-10 bg-amber-500/5 border border-amber-500/20 rounded-2xl">
                <h3 className="text-2xl font-bold text-amber-200 mb-2">Імпорт готовий до публікації</h3>
                <p className="text-sys-text-secondary max-w-md mx-auto mb-6">Перевірте зміни імпорту, а потім опублікуйте чернетку окремою дією.</p>
                {versions.length > 0 && (
                  <div className="flex justify-center items-center gap-3 mb-6">
                    <span className="text-sm font-medium text-sys-text-secondary">Публікувати у версію:</span>
                    <select className="form-control text-sm w-64" value={targetVersionId || ""} onChange={e => setTargetVersionId(e.target.value ? Number(e.target.value) : null)}>
                      <option value="">Поточна активна версія</option>
                      {versions.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                    </select>
                  </div>
                )}
                <div className="flex justify-center gap-3">
                  <button onClick={publishImport} disabled={loading || !draftId} className="bg-sys-accent text-[#0b1120] font-bold py-2.5 px-6 rounded-lg disabled:opacity-50">
                    {loading ? "Публікуємо…" : "Опублікувати імпорт"}
                  </button>
                  <button onClick={() => void cancelImport()} disabled={loading} className="py-2.5 px-4 text-sys-text-secondary hover:text-white">Скасувати імпорт</button>
                </div>
            </div>
        )}

        {status === "unchanged" && (
            <div className="animate-in fade-in text-center py-10 bg-sys-card/60 border border-sys-border rounded-2xl">
                <div className="w-16 h-16 bg-sys-accent/10 text-sys-accent rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                </div>
                <h3 className="text-2xl font-bold text-sys-text-primary mb-2">Змін не знайдено</h3>
                <p className="text-sys-text-secondary max-w-md mx-auto mb-6">Поточний розклад та імпортні зміни такі самі, як у попередньому імпорті. Нову чернетку створювати не потрібно.</p>
                <button onClick={() => setStatus("idle")} className="bg-sys-bg border border-sys-border px-6 py-2 rounded-lg text-sm font-bold text-gray-300 hover:bg-white/5 transition-colors">
                    Зрозуміло
                </button>
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
                        <div className="text-xl text-white font-black">{substitutions.filter(s => (s as any).is_new !== false).length} нових</div>
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
