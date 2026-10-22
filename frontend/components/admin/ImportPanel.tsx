"use client";

import { useState, useEffect, useRef } from "react";
import { api, ImportCancellation, ImportSubstitution, ImporterResponse, ImportStatusResponse, ReferenceRecord, ScheduleVersion } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { SearchableSelect } from "../SearchableSelect";
import { PublicationHistory } from "./PublicationHistory";
import { PageHeader } from "./PageHeader";

export function ImportPanel() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [versions, setVersions] = useState<ScheduleVersion[]>([]);
  const [targetVersionId, setTargetVersionId] = useState<number | null>(null);
  const [status, setStatus] = useState<"idle" | "importing" | "mapping" | "ready" | "unchanged" | "success">("idle");
  const [report, setReport] = useState<ImporterResponse["report"] | null>(null);
  const [importStatus, setImportStatus] = useState<ImportStatusResponse | null>(null);
  const [autoPublish, setAutoPublish] = useState<boolean>(true);
  const [savingSettings, setSavingSettings] = useState(false);
  
  // Dictionaries for mapping
  const [teachers, setTeachers] = useState<ReferenceRecord[]>([]);
  const [subjects, setSubjects] = useState<ReferenceRecord[]>([]);
  const [groups, setGroups] = useState<ReferenceRecord[]>([]);
  
  // Mapping state: { rawName: actual_id }
  const [mappings, setMappings] = useState<Record<string, number>>({});
  const [substitutions, setSubstitutions] = useState<ImportSubstitution[]>([]);
  const [cancelled, setCancelled] = useState<ImportCancellation[]>([]);
  const [draftId, setDraftId] = useState<number | null>(null);
  const importRequestId = useRef(0);

  const loadDicts = async () => {
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
  };

  useEffect(() => {
    void loadDicts();
  }, []);

  useEffect(() => {
    async function loadPendingImport() {
      const requestId = importRequestId.current;
      try {
        const session = await api.auth.ensureAuthenticated();
        const drafts = await api.generator.listDrafts(session.access_token);
        if (requestId !== importRequestId.current) return;
        const pending = drafts.find(
          (draft) => draft.draft_type === "import" && draft.status === "pending",
        );
        if (!pending) return;
        if (requestId !== importRequestId.current) return;
        setDraftId(pending.id);
        if (!pending.data) {
          setReport({ unresolved: [], base_slots: [], substitutions: [], cancelled: [] });
          return;
        }
        const nextSubstitutions = pending.data.substitutions ?? [];
        const nextCancelled = pending.data.cancelled ?? [];
        setSubstitutions(nextSubstitutions);
        setCancelled(nextCancelled);
        setReport({
          unresolved: [],
          base_slots: (pending.data as any).base_slots ?? [],
          substitutions: nextSubstitutions,
          cancelled: nextCancelled,
        });
        // Keep status as "idle" on initial mount if it's an anomaly draft (the anomaly banner has a button to review it)
        if (!(pending.data as any).is_anomaly) {
          const hasNewChanges =
            nextSubstitutions.some((s) => (s as any).is_new !== false) ||
            nextCancelled.some((c) => (c as any).is_new !== false);
          setStatus(hasNewChanges ? "mapping" : "ready");
        }
      } catch {
        // The import button remains available when no pending draft can be loaded.
      }
    }
    void loadPendingImport();
  }, []);

  const loadStatus = async () => {
    try {
      const res = await api.importer.getStatus();
      setImportStatus(res);
      setAutoPublish(res.settings?.auto_publish ?? true);
    } catch (e) {
      console.error("Failed to load import status", e);
    }
  };

  useEffect(() => {
    void loadStatus();
  }, []);

  const handleToggleAutoPublish = async (enabled: boolean) => {
    setAutoPublish(enabled);
    try {
      setSavingSettings(true);
      await api.importer.updateSettings({ auto_publish: enabled });
      await loadStatus();
    } catch (e) {
      console.error("Failed to update auto_publish", e);
      setAutoPublish(!enabled);
    } finally {
      setSavingSettings(false);
    }
  };

  const handleImport = async () => {
    importRequestId.current += 1;
    setLoading(true);
    setError(null);
    setStatus("importing");

    try {
      const session = await api.auth.ensureAuthenticated();
      const res = await api.importer.importData(session.access_token);
      setDraftId(res.meta?.draft_created ?? null);

      if (res.meta?.auto_published) {
        setReport(res.report);
        setSubstitutions(res.report.substitutions);
        setCancelled(res.report.cancelled ?? []);
        setStatus("success");
        await loadStatus();
        return;
      }

      if (res.meta?.unchanged) {
        setReport({ ...res.report, substitutions: [], cancelled: [] });
        setSubstitutions([]);
        setCancelled([]);
        setMappings({});
        setStatus("unchanged");
        await loadStatus();
        return;
      }

      if (res.meta?.is_anomaly) {
        setReport(res.report);
        setSubstitutions(res.report.substitutions);
        setCancelled(res.report.cancelled ?? []);
        setStatus("mapping");
        await loadStatus();
        return;
      }

      if (res.report.unresolved.length > 0) {
        await loadDicts();
      }

      const hasNewSubs = res.report.substitutions.some((s: any) => s.is_new !== false);
      const hasNewCancels = (res.report.cancelled ?? []).some((c: any) => c.is_new !== false);

      setReport(res.report);
      setSubstitutions(res.report.substitutions);
      setCancelled(res.report.cancelled ?? []);

      if (res.report.unresolved.length > 0 || hasNewSubs || hasNewCancels) {
        const initialMap: Record<string, number> = {};
        res.report.unresolved.forEach((item) => {
          initialMap[item.raw] = item.actual_id ?? 0;
        });
        setMappings(initialMap);
        setStatus("mapping");
      } else if (res.meta?.draft_created) {
        setStatus("ready");
      } else {
        setStatus("unchanged");
      }
      await loadStatus();
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

  const publishImportMode = async (mode: "substitutions_only" | "explicit_only" | "all", force: boolean = false) => {
    if (!draftId) return;
    setLoading(true);
    setError(null);
    try {
      const session = await api.auth.ensureAuthenticated();
      const draft = await api.generator.getDraft(draftId, session.access_token);
      await api.generator.publish(draftId, session.access_token, undefined, draft.revision, force, mode);
      setStatus("success");
      await loadStatus();
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
    <div className="space-y-6">
      <PageHeader
        eyebrow="СИНХРОНІЗАЦІЯ"
        title="Імпорт розкладу"
        description="Автоматичний парсинг розкладу та замін з офіційного сайту kre.dp.ua та історія публікацій"
      />

      <div className="bg-sys-card rounded-xl p-4 sm:p-6 border border-sys-border">
        <div>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
            <div>
              <h2 className="text-lg font-bold text-sys-text-primary">Парсинг з kre.dp.ua</h2>
              {importStatus?.last_publication && (
                <div className="mt-1.5 text-xs text-sys-text-secondary flex items-start gap-2">
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]" />
                  <span className="leading-relaxed">
                    Остання публікація: <strong className="text-sys-text-primary">{importStatus.last_publication.source}</strong>,{" "}
                    {new Date(importStatus.last_publication.timestamp).toLocaleString("uk-UA")},{" "}
                    <strong className="text-sys-text-primary">{importStatus.last_publication.changes_count} змін</strong>
                  </span>
                </div>
              )}
              {importStatus?.last_check && (
                <div className="mt-1 text-xs text-sys-text-secondary flex items-start gap-2">
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.5)]" />
                  <span className="leading-relaxed">
                    Остання перевірка сайту: <strong className="text-sys-text-primary">{importStatus.last_check.source}</strong>,{" "}
                    {new Date(importStatus.last_check.checked_at).toLocaleString("uk-UA")} —{" "}
                    <strong className="text-sys-text-primary">
                      {importStatus.last_check.status === "unchanged"
                        ? "нових замін не виявлено"
                        : importStatus.last_check.status === "published"
                        ? `опубліковано (${importStatus.last_check.changes_count} змін)`
                        : importStatus.last_check.status === "anomaly"
                        ? `виявлено аномалію (${importStatus.last_check.changes_count} змін)`
                        : importStatus.last_check.status === "error"
                        ? `помилка зв'язку з сайтом коледжу (${(importStatus.last_check as any).error_message || "таймаут"})`
                        : `створено чернетку (${importStatus.last_check.changes_count} змін)`}
                    </strong>
                  </span>
                </div>
              )}
            </div>

            {user?.role === "admin" && (
              <div className="flex items-center gap-3 bg-white/5 border border-sys-border rounded-xl px-3.5 py-2">
                <span className="text-xs font-semibold text-sys-text-primary">Автопублікація</span>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoPublish}
                    disabled={savingSettings}
                    onChange={(e) => void handleToggleAutoPublish(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-sys-border peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-sys-accent"></div>
                </label>
              </div>
            )}
          </div>

        {/* Anomaly / Cancellation draft warning banner */}
        {importStatus?.pending_anomaly_draft && (
          <div className="mb-6 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-amber-200 animate-in fade-in">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <svg className="w-5 h-5 shrink-0 text-amber-400 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div>
                  <div className="font-bold text-sm text-amber-300">
                    {importStatus.pending_anomaly_draft.auto_publish_skipped_reason === "cancellations_require_review"
                      ? `Автоімпорт виявив скасування пар (${importStatus.pending_anomaly_draft.changes_count}). Перевірте й підтвердіть`
                      : `Автоімпорт знайшов багато змін (${importStatus.pending_anomaly_draft.changes_count}). Перевірте й опублікуйте`}
                  </div>
                  {importStatus.pending_anomaly_draft.auto_publish_skipped_reason && (
                    <div className="text-xs font-medium text-amber-300/90 mt-0.5">
                      Причина:{" "}
                      {importStatus.pending_anomaly_draft.auto_publish_skipped_reason === "cancellations_require_review"
                        ? "заміни опубліковано автоматично; скасування пар вимагають підтвердження"
                        : importStatus.pending_anomaly_draft.auto_publish_skipped_reason === "anomaly"
                        ? "виявлено аномалію (потребує ручної перевірки)"
                        : importStatus.pending_anomaly_draft.auto_publish_skipped_reason === "disabled"
                        ? "автопублікацію вимкнено в налаштуваннях"
                        : importStatus.pending_anomaly_draft.auto_publish_skipped_reason}
                    </div>
                  )}
                  {importStatus.pending_anomaly_draft.anomaly_reasons?.length > 0 && (
                    <p className="text-xs text-amber-200/80 mt-1">
                      {importStatus.pending_anomaly_draft.anomaly_reasons.join(" • ")}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
                <button
                  type="button"
                  onClick={async () => {
                    if (!confirm("Відхилити цю чернетку імпорту?")) return;
                    try {
                      const session = await api.auth.ensureAuthenticated();
                      await api.generator.deleteDraft(importStatus.pending_anomaly_draft!.id, session.access_token);
                      await loadStatus();
                    } catch (e) {
                      console.error("Failed to dismiss draft", e);
                    }
                  }}
                  className="rounded-lg border border-sys-border bg-white/5 hover:bg-white/10 text-sys-text-secondary hover:text-white px-3 py-1.5 text-xs font-semibold transition-colors"
                >
                  Відхилити
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDraftId(importStatus.pending_anomaly_draft!.id);
                    setStatus("ready");
                  }}
                  className="rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/30 px-3.5 py-1.5 text-xs font-semibold transition-colors"
                >
                  Перевірити та опублікувати
                </button>
              </div>
            </div>
          </div>
        )}
        
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
                   Система сама обходить усі групи на kre.dp.ua, знаходить зміни й одразу застосовує їх. Останню публікацію можна відкотити.
               </p>
               <button onClick={handleImport} disabled={loading} className="bg-sys-accent text-[#0b1120] font-bold py-2.5 px-6 rounded-lg disabled:opacity-50 flex items-center gap-2 hover:opacity-90 active:scale-98 transition-all">
                   {loading ? (
                     <><svg className="animate-spin -ml-1 mr-2 h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Імпортуємо...</>
                   ) : "Почати імпорт"}
               </button>
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
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-semibold text-sys-text-primary">
                                {item.is_swap ? "Перестановка пар" : item.is_move ? "Перенесення пари" : "Заміна заняття"}
                              </span>
                              {item.is_swap && item.swap_with_lesson && (
                                <span className="rounded-full bg-purple-500/15 border border-purple-500/30 px-2 py-0.5 text-[11px] font-semibold text-purple-300 flex items-center gap-1">
                                  🔀 Пара {item.lesson_number} ↔ Пара {item.swap_with_lesson}
                                </span>
                              )}
                              {item.is_move && item.moved_from_lesson && (
                                <span className="rounded-full bg-blue-500/15 border border-blue-500/30 px-2 py-0.5 text-[11px] font-semibold text-blue-300 flex items-center gap-1">
                                  ➡️ Перенесено з {item.moved_from_lesson}-ї пари
                                </span>
                              )}
                              {item.is_explicit_substitution && (
                                <span className="rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
                                  🏷️ Позначка заміни
                                </span>
                              )}
                              {item.is_equal_to_base && (
                                <span className="rounded-full bg-gray-500/15 border border-gray-500/30 px-2 py-0.5 text-[11px] font-semibold text-gray-400">
                                  ⚠️ Відповідає основному розкладу
                                </span>
                              )}
                            </div>
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
                
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                    <button onClick={handlePrimaryAction} disabled={loading} className="w-full sm:w-auto bg-sys-accent text-[#0b1120] font-bold py-2.5 px-6 rounded-lg disabled:opacity-50">
                        {loading ? "Зберігаємо…" : report.unresolved.length > 0 ? "Зберегти відповідності та продовжити" : "Зберегти зміни"}
                    </button>
                    <button onClick={() => void cancelImport()} className="w-full sm:w-auto py-2.5 px-4 text-center rounded-lg border border-sys-border sm:border-0 bg-white/5 sm:bg-transparent text-sys-text-secondary hover:text-white" disabled={loading}>Скасувати імпорт</button>
                </div>
            </div>
        )}
        
        {status === "ready" && (
            <div className="animate-in fade-in text-center p-4 sm:py-8 bg-amber-500/5 border border-amber-500/20 rounded-2xl">
                <h3 className="text-xl sm:text-2xl font-bold text-amber-200 mb-2">Імпорт готовий до публікації</h3>
                <p className="text-sys-text-secondary max-w-lg mx-auto mb-6 text-xs sm:text-sm">
                  Оберіть режим публікації: опублікувати тільки зміни без скасувань, тільки пари з позначкою заміни або повний імпорт.
                </p>

                {/* Counters */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6 max-w-2xl mx-auto text-sm">
                  <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-center flex flex-col justify-center">
                    <div className="text-[11px] sm:text-xs text-amber-300 truncate">Заміни та перестановки</div>
                    <div className="text-base sm:text-lg font-bold text-amber-200 mt-0.5">
                      {substitutions.filter(s => !s.is_equal_to_base).length}
                    </div>
                    {substitutions.filter(s => s.is_swap).length > 0 && (
                      <div className="text-[10px] text-purple-300 font-medium mt-0.5">
                        {substitutions.filter(s => s.is_swap).length} перестановок
                      </div>
                    )}
                  </div>

                  <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-center flex flex-col justify-center">
                    <div className="text-[11px] sm:text-xs text-emerald-300 truncate">З позначкою заміни</div>
                    <div className="text-base sm:text-lg font-bold text-emerald-200 mt-0.5">
                      {substitutions.filter(s => s.is_explicit_substitution && !s.is_equal_to_base).length}
                    </div>
                  </div>

                  <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-center flex flex-col justify-center">
                    <div className="text-[11px] sm:text-xs text-rose-300 truncate">Скасування</div>
                    <div className="text-base sm:text-lg font-bold text-rose-200 mt-0.5">{cancelled.length}</div>
                  </div>

                  <div className="rounded-xl border border-sys-border bg-sys-card p-3 text-center flex flex-col justify-center">
                    <div className="text-[11px] sm:text-xs text-sys-text-secondary truncate">Збігаються з базою</div>
                    <div className="text-base sm:text-lg font-bold text-sys-text-muted mt-0.5">
                      {substitutions.filter(s => s.is_equal_to_base).length}
                    </div>
                    <div className="text-[10px] text-sys-text-muted/80 mt-0.5">пропускаються</div>
                  </div>
                </div>

                {/* Publish Action Buttons */}
                <div className="flex flex-col sm:flex-row flex-wrap justify-center items-stretch sm:items-center gap-3 max-w-2xl mx-auto">
                  <button
                    type="button"
                    onClick={() => void publishImportMode("substitutions_only")}
                    disabled={loading || !draftId}
                    className="flex-1 bg-sys-accent text-[#0b1120] font-bold py-2.5 px-4 rounded-xl disabled:opacity-50 shadow-sm hover:opacity-90 active:scale-98 transition-all flex flex-col items-center justify-center text-xs sm:text-sm"
                  >
                    <span>Опублікувати тільки зміни</span>
                    <span className="text-[10px] font-normal opacity-85">(без скасувань та дублів)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => void publishImportMode("explicit_only")}
                    disabled={loading || !draftId}
                    className="flex-1 bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-bold py-2.5 px-4 rounded-xl disabled:opacity-50 hover:bg-emerald-500/25 active:scale-98 transition-all flex flex-col items-center justify-center text-xs sm:text-sm"
                  >
                    <span>Тільки з позначкою заміни</span>
                    <span className="text-[10px] font-normal opacity-85">(із сайту kre.dp.ua)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => void publishImportMode("all", true)}
                    disabled={loading || !draftId}
                    className="w-full sm:w-auto py-2.5 px-4 rounded-xl border border-sys-border bg-white/5 text-sys-text-secondary hover:text-sys-text-primary hover:bg-white/10 active:scale-98 transition-all text-xs sm:text-sm"
                  >
                    Опублікувати все (зі скасуваннями)
                  </button>

                  <button
                    type="button"
                    onClick={() => void cancelImport()}
                    disabled={loading}
                    className="w-full sm:w-auto py-2.5 px-4 rounded-xl border border-rose-500/20 bg-rose-500/5 text-rose-300 hover:bg-rose-500/10 active:scale-98 transition-all text-xs sm:text-sm"
                  >
                    Скасувати імпорт
                  </button>
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

      {status !== "importing" && status !== "mapping" && (
        <PublicationHistory />
      )}
    </div>
  );
}
