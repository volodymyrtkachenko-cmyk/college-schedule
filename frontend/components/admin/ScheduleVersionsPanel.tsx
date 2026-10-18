"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { api, ScheduleVersion } from "../../lib/api";
import { ConfirmModal } from "./ConfirmModal";
import { PageHeader } from "./PageHeader";

type VersionDraft = Partial<ScheduleVersion> & { key: string };

export function ScheduleVersionsPanel() {
  const [versions, setVersions] = useState<ScheduleVersion[]>([]);
  const [draft, setDraft] = useState<VersionDraft | null>(null);
  const [versionToDelete, setVersionToDelete] = useState<ScheduleVersion | null>(null);
  const [cloneTarget, setCloneTarget] = useState<ScheduleVersion | null>(null);
  const [cloneSourceId, setCloneSourceId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    api.scheduleVersions.list().then((res) => {
      if (active) {
        setVersions(res);
        setLoading(false);
      }
    });
    return () => { active = false; };
  }, []);

  async function saveVersion(e: FormEvent) {
    e.preventDefault();
    if (!draft || !draft.name || !draft.valid_from || !draft.valid_until) return;
    setIsSubmitting(true);
    try {
      if (draft.id) {
        const updated = await api.scheduleVersions.update(draft.id, {
          name: draft.name,
          valid_from: draft.valid_from,
          valid_until: draft.valid_until,
        });
        setVersions(versions.map(v => v.id === draft.id ? updated : v));
      } else {
        const created = await api.scheduleVersions.create({
          name: draft.name,
          valid_from: draft.valid_from,
          valid_until: draft.valid_until,
        });
        setVersions([created, ...versions].sort((a, b) => b.valid_from.localeCompare(a.valid_from)));
      }
      setDraft(null);
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : "Помилка збереження");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function deleteVersion() {
    if (!versionToDelete) return;
    try {
      await api.scheduleVersions.remove(versionToDelete.id);
      setVersions(versions.filter(v => v.id !== versionToDelete.id));
      setVersionToDelete(null);
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : "Не вдалося видалити версію");
    }
  }

  async function handleClone() {
    if (!cloneTarget || !cloneSourceId) return;
    setIsSubmitting(true);
    try {
      const res = await api.scheduleVersions.clone(cloneTarget.id, parseInt(cloneSourceId, 10));
      alert(`Успішно склоновано ${res.count} пар!`);
      setCloneTarget(null);
      setCloneSourceId("");
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : "Помилка клонування");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (loading) {
    return <div className="p-8 text-center text-sys-text-secondary">Завантаження...</div>;
  }

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' });
    } catch {
      return dateStr;
    }
  };

  const todayIso = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(new Date());

  return (
    <section className="space-y-6">
      <PageHeader
        eyebrow="РОЗКЛАД"
        title="Версії розкладу"
        description="Керуйте періодами дії різних шаблонів розкладу та копіюйте розклад між ними."
        actions={
          <button
            onClick={() => setDraft({ key: Date.now().toString(), name: "", valid_from: "", valid_until: "" })}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-sys-accent px-4 py-2 text-sm font-semibold text-[#0b1120] hover:opacity-90 active:scale-95 transition-all"
          >
            + Додати версію
          </button>
        }
      />

      {versions.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-sys-border bg-sys-card/50 p-12 text-center">
          <div className="rounded-full bg-sys-bg p-4 mb-4">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-sys-text-secondary opacity-50"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>
          </div>
          <h3 className="text-lg font-medium text-sys-text-primary">Немає жодної версії</h3>
          <p className="mt-2 text-sm text-sys-text-secondary max-w-sm">Створіть першу версію розкладу, щоб мати змогу додавати та редагувати заняття для всього коледжу.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {versions.map((version) => {
            const isActiveNow = version.is_active && version.valid_from <= todayIso && version.valid_until >= todayIso;
            return (
              <div key={version.id} className={`group flex flex-col justify-between rounded-2xl border p-5 transition-all duration-300 hover:shadow-lg ${isActiveNow ? 'border-sys-accent/40 bg-gradient-to-b from-white/5 to-sys-bg shadow-[0_0_15px_rgba(14,165,233,0.1)]' : 'border-sys-border/60 bg-sys-card hover:border-sys-border hover:bg-sys-card/80'}`}>
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold text-sys-text-primary text-lg leading-tight line-clamp-2">{version.name}</h3>
                    {isActiveNow && (
                      <span className="shrink-0 flex items-center gap-1.5 text-[10px] uppercase font-bold text-sys-accent bg-sys-accent/15 px-2.5 py-1 rounded-full border border-sys-accent/20">
                        <span className="w-1.5 h-1.5 rounded-full bg-sys-accent animate-pulse"></span>
                        Діє зараз
                      </span>
                    )}
                  </div>
                  
                  <div className="mt-4 flex items-center gap-2 text-sm text-sys-text-secondary bg-sys-bg/50 rounded-lg p-2.5 border border-sys-border/30">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-sys-text-secondary/70"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>
                    <div className="flex flex-col">
                      <span className="text-xs text-sys-text-secondary/70 uppercase font-semibold tracking-wider">Період дії</span>
                      <span className="font-medium text-sys-text-primary">{formatDate(version.valid_from)} — {formatDate(version.valid_until)}</span>
                    </div>
                  </div>
                </div>
                
                <div className="mt-5 grid grid-cols-4 gap-1.5 border-t border-sys-border/40 pt-4">
                  <Link
                    href={`/admin?resource=permanent-schedule&version_id=${version.id}`}
                    className="flex items-center justify-center gap-1 rounded-lg py-1.5 text-[11px] font-semibold text-sys-accent hover:bg-sys-accent/10 transition-colors"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/><path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/><path d="M8 18h.01"/><path d="M12 18h.01"/><path d="M16 18h.01"/></svg>
                    Розклад
                  </Link>
                  <button onClick={() => setDraft({ ...version, key: version.id.toString() })} className="flex items-center justify-center gap-1 rounded-lg py-1.5 text-[11px] font-semibold text-sys-text-secondary hover:bg-sys-bg hover:text-sys-text-primary transition-colors">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                    Параметри
                  </button>
                  <button onClick={() => setCloneTarget(version)} className="flex items-center justify-center gap-1 rounded-lg py-1.5 text-[11px] font-semibold text-sky-400 hover:bg-sys-accent/10 hover:text-sky-300 transition-colors">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                    Клонувати
                  </button>
                  <button onClick={() => setVersionToDelete(version)} className="flex items-center justify-center gap-1 rounded-lg py-1.5 text-[11px] font-semibold text-rose-400 hover:bg-rose-500/10 hover:text-rose-300 transition-colors">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
                    Видалити
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {draft && (
        <div
          className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center overflow-y-auto bg-black/60 p-0 sm:p-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDraft(null);
          }}
        >
          <form
            onSubmit={saveVersion}
            role="dialog"
            aria-modal="true"
            aria-label={draft.id ? "Редагувати версію" : "Нова версія розкладу"}
            className="flex max-h-[92dvh] w-full max-w-md flex-col rounded-t-2xl sm:rounded-2xl border border-sys-border bg-sys-card shadow-2xl overflow-hidden pb-safe animate-in slide-in-from-bottom-6 sm:slide-in-from-bottom-2 duration-200"
          >
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-sys-border/50 bg-sys-card px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sys-accent/20 text-sys-accent">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                </div>
                <div>
                  <h2 className="text-base sm:text-lg font-bold text-sys-text-primary">{draft.id ? "Редагувати версію" : "Нова версія розкладу"}</h2>
                  <p className="text-xs text-sys-text-secondary mt-0.5">{draft.id ? "Змініть назву або період дії" : "Задайте параметри для нового шаблону"}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDraft(null)}
                aria-label="Закрити"
                className="w-8 h-8 flex items-center justify-center rounded-lg text-sys-text-secondary hover:bg-white/5 hover:text-white text-base transition-colors"
              >
                ✕
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              <div>
                <label className="form-label text-sys-text-secondary">
                  <span>Назва версії</span>
                  <input required type="text" placeholder="напр. Осінній семестр" value={draft.name || ""} onChange={e => setDraft({...draft, name: e.target.value})} className="form-control mt-1 shadow-sm bg-sys-bg w-full" />
                </label>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div>
                  <label className="form-label text-sys-text-secondary">
                    <span>Діє з</span>
                    <input required type="date" value={draft.valid_from || ""} onChange={e => setDraft({...draft, valid_from: e.target.value})} className="form-control mt-1 shadow-sm bg-sys-bg w-full" />
                  </label>
                </div>
                <div>
                  <label className="form-label text-sys-text-secondary">
                    <span>Діє до</span>
                    <input required type="date" value={draft.valid_until || ""} onChange={e => setDraft({...draft, valid_until: e.target.value})} className="form-control mt-1 shadow-sm bg-sys-bg w-full" />
                  </label>
                </div>
              </div>
            </div>

            <div className="sticky bottom-0 z-10 flex flex-col-reverse sm:flex-row justify-end gap-2.5 border-t border-sys-border/50 bg-sys-bg/80 backdrop-blur-xs px-5 py-3.5">
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="w-full sm:w-auto min-h-[44px] sm:min-h-[40px] rounded-lg border border-sys-border bg-sys-card px-4 py-2 text-sm font-semibold text-sys-text-primary hover:bg-white/5 active:scale-[0.98] transition-all"
              >
                Скасувати
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full sm:w-auto min-h-[44px] sm:min-h-[40px] flex items-center justify-center gap-2 rounded-lg bg-sys-accent px-6 py-2 text-sm font-bold text-[#0b1120] hover:opacity-90 active:scale-[0.98] disabled:opacity-50 transition-all shadow-sm"
              >
                {isSubmitting ? (
                  <>
                    <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                    Збереження...
                  </>
                ) : (
                  "Зберегти"
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {cloneTarget && (
        <div
          className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center overflow-y-auto bg-black/60 p-0 sm:p-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setCloneTarget(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Клонувати розклад"
            className="flex max-h-[92dvh] w-full max-w-md flex-col rounded-t-2xl sm:rounded-2xl border border-sky-500/20 bg-sys-card shadow-2xl overflow-hidden pb-safe animate-in slide-in-from-bottom-6 sm:slide-in-from-bottom-2 duration-200"
          >
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-sys-border/50 bg-sys-card px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sys-accent/20 text-sky-400">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                </div>
                <div>
                  <h2 className="text-base sm:text-lg font-bold text-sys-text-primary">Клонувати розклад</h2>
                  <p className="text-xs text-sys-text-secondary mt-0.5">У версію «{cloneTarget.name}»</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCloneTarget(null)}
                aria-label="Закрити"
                className="w-8 h-8 flex items-center justify-center rounded-lg text-sys-text-secondary hover:bg-white/5 hover:text-white text-base transition-colors"
              >
                ✕
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs sm:text-sm text-amber-200">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-0.5"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>
                <p>Увага! Це повністю перезапише існуючий розклад у вибраній версії.</p>
              </div>
              
              <div>
                <label className="form-label text-sys-text-secondary">
                  <span>З якої версії скопіювати заняття?</span>
                  <select value={cloneSourceId} onChange={e => setCloneSourceId(e.target.value)} className="form-control mt-1 shadow-sm bg-sys-bg w-full">
                    <option value="" disabled>Оберіть версію-джерело...</option>
                    {versions.filter(v => v.id !== cloneTarget.id).map(v => (
                      <option key={v.id} value={v.id}>{v.name} ({formatDate(v.valid_from)})</option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            <div className="sticky bottom-0 z-10 flex flex-col-reverse sm:flex-row justify-end gap-2.5 border-t border-sys-border/50 bg-sys-bg/80 backdrop-blur-xs px-5 py-3.5">
              <button
                type="button"
                onClick={() => setCloneTarget(null)}
                className="w-full sm:w-auto min-h-[44px] sm:min-h-[40px] rounded-lg border border-sys-border bg-sys-card px-4 py-2 text-sm font-semibold text-sys-text-primary hover:bg-white/5 active:scale-[0.98] transition-all"
              >
                Скасувати
              </button>
              <button
                type="button"
                onClick={handleClone}
                disabled={!cloneSourceId || isSubmitting}
                className="w-full sm:w-auto min-h-[44px] sm:min-h-[40px] flex items-center justify-center gap-2 rounded-lg bg-sys-accent px-6 py-2 text-sm font-bold text-[#0b1120] hover:opacity-90 active:scale-[0.98] disabled:opacity-50 transition-all shadow-sm"
              >
                {isSubmitting ? (
                  <>
                    <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                    Копіюємо...
                  </>
                ) : (
                  "Скопіювати розклад"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {versionToDelete && (
        <ConfirmModal
          isOpen={true}
          title="Видалити версію?"
          message={`Ви впевнені, що хочете видалити версію "${versionToDelete.name}"? Усі шаблони розкладу для неї будуть втрачені!`}
          onConfirm={deleteVersion}
          onCancel={() => setVersionToDelete(null)}
        />
      )}
    </section>
  );
}
