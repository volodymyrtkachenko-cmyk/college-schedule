import { useState, useEffect } from "react";
import { api, ImportCancellation, ImportSubstitution, ImporterResponse, ReferenceRecord } from "../../lib/api";
import { useAuth } from "../../lib/auth";

export function ImportPanel() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "importing" | "mapping" | "success">("idle");
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
        const pending = drafts.find((draft) => draft.status === "pending" && draft.data);
        if (!pending?.data) return;
        const nextSubstitutions = pending.data.substitutions ?? [];
        const nextCancelled = pending.data.cancelled ?? [];
        if (!nextSubstitutions.length && !nextCancelled.length) return;
        setDraftId(pending.id);
        setSubstitutions(nextSubstitutions);
        setCancelled(nextCancelled);
        setReport({
          unresolved: [],
          base_slots: [],
          substitutions: nextSubstitutions,
          cancelled: nextCancelled,
        });
        setStatus("mapping");
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
        setStatus("success");
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
      setStatus("success");
    } catch (err: any) {
      setError(err?.message || "Не вдалося зберегти зміни імпорту.");
    } finally {
      setLoading(false);
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
                   зібрала актуальний розклад та віднайшла всі заміни.
               </p>
               <button onClick={handleImport} disabled={loading} className="bg-sys-accent text-[#0b1120] font-bold py-2 px-5 rounded-lg disabled:opacity-50 flex items-center gap-2">
                   {loading ? (
                     <><svg className="animate-spin -ml-1 mr-2 h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Імпортуємо...</>
                   ) : "Почати імпорт"}
               </button>
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
                    <h3 className="font-semibold">Заміни — перевірте та відредагуйте перед публікацією</h3>
                    {substitutions.map((item, index) => (
                      <div key={`${item.date}-${item.group_id}-${item.lesson_number}-${index}`} className="grid gap-2 rounded-lg border border-sys-border bg-sys-bg/40 p-3 sm:grid-cols-2 lg:grid-cols-7">
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
                    ))}
                  </div>
                )}

                {cancelled.length > 0 && (
                  <div className="mb-6 space-y-3">
                    <h3 className="font-semibold">Скасовані пари</h3>
                    {cancelled.map((item, index) => (
                      <div key={`${item.date}-${item.group_id}-${item.lesson_number}-${index}`} className="grid gap-2 rounded-lg border border-rose-500/20 bg-rose-500/5 p-3 sm:grid-cols-4">
                        <input type="date" value={item.date} onChange={(e) => setCancelled(current => current.map((value, i) => i === index ? { ...value, date: e.target.value } : value))} className="form-control" />
                        <select value={item.group_id} onChange={(e) => setCancelled(current => current.map((value, i) => i === index ? { ...value, group_id: Number(e.target.value) } : value))} className="form-control">
                          {groups.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
                        </select>
                        <select value={item.lesson_number} onChange={(e) => setCancelled(current => current.map((value, i) => i === index ? { ...value, lesson_number: Number(e.target.value) } : value))} className="form-control">
                          {[1, 2, 3, 4].map(lesson => <option key={lesson} value={lesson}>{lesson}-та пара</option>)}
                        </select>
                        <button type="button" onClick={() => setCancelled(current => current.filter((_, i) => i !== index))} className="rounded-lg border border-rose-400/20 px-3 py-2 text-sm text-rose-300 hover:bg-rose-500/10">Видалити</button>
                      </div>
                    ))}
                  </div>
                )}
                
                <div className="flex items-center gap-3">
                    <button onClick={handleMappingSubmit} disabled={loading} className="bg-sys-accent text-[#0b1120] font-bold py-2.5 px-6 rounded-lg disabled:opacity-50">
                        {loading ? "Зберігаємо та продовжуємо..." : "Зберегти відповідності та Продовжити"}
                    </button>
                    <button type="button" onClick={saveChanges} disabled={loading || report.unresolved.length > 0} className="rounded-lg border border-sys-accent/40 px-4 py-2.5 text-sm font-semibold text-sys-accent disabled:opacity-50">
                      Зберегти зміни
                    </button>
                    <button onClick={() => setStatus("idle")} className="py-2.5 px-4 text-sys-text-secondary hover:text-white" disabled={loading}>Скасувати</button>
                </div>
            </div>
        )}
        
        {status === "success" && report && (
            <div className="animate-in zoom-in-95 fade-in text-center py-10 bg-emerald-500/5 border border-emerald-500/20 rounded-2xl">
                <div className="w-16 h-16 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                </div>
                <h3 className="text-2xl font-bold text-emerald-300 mb-2">Імпорт завершено успішно!</h3>
                <p className="text-emerald-500/80 max-w-md mx-auto mb-6">Всі заняття було успішно оброблено. Конфліктів чи невідомих викладачів/предметів більше немає.</p>
                
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
