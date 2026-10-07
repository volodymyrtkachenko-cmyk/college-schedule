import { FormEvent, useEffect, useState } from "react";
import { api, ScheduleVersion } from "../../lib/api";
import { ConfirmModal } from "./ConfirmModal";

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
      alert("Помилка збереження");
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
      alert("Не вдалося видалити версію");
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
      alert("Помилка клонування");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (loading) {
    return <div className="p-8 text-center text-sys-text-secondary">Завантаження...</div>;
  }

  return (
    <section className="space-y-5">
      <header className="flex items-center justify-between gap-3 border-b border-sys-border pb-4">
        <div>
          <h2 className="text-xl font-bold">Версії розкладу</h2>
          <p className="mt-1 text-sm text-sys-text-secondary">
            Керуйте періодами дії різних шаблонів розкладу та копіюйте розклад між ними.
          </p>
        </div>
        <button
          onClick={() => setDraft({ key: Date.now().toString(), name: "", valid_from: "", valid_until: "" })}
          className="rounded-lg bg-sys-accent px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-sys-accent-hover active:scale-95 transition-all"
        >
          Додати версію
        </button>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        {versions.map((version) => {
          const isActiveNow = new Date(version.valid_from) <= new Date() && new Date(version.valid_until) >= new Date();
          return (
            <div key={version.id} className={`flex flex-col justify-between rounded-xl border p-4 transition-colors ${isActiveNow ? 'border-sys-accent/30 bg-sys-accent/5' : 'border-sys-border bg-sys-card hover:bg-sys-bg'}`}>
              <div>
                <div className="flex items-start justify-between">
                  <h3 className="font-medium text-sys-text-primary">{version.name}</h3>
                  {isActiveNow && <span className="text-[10px] uppercase font-bold text-sys-accent bg-sys-accent/10 px-2 py-0.5 rounded">Діє зараз</span>}
                </div>
                <div className="mt-2 text-sm text-sys-text-secondary font-mono">
                  {version.valid_from} — {version.valid_until}
                </div>
              </div>
              <div className="mt-4 flex gap-2 border-t border-sys-border/50 pt-3">
                <button onClick={() => setDraft({ ...version, key: version.id.toString() })} className="text-xs font-medium text-sys-accent hover:underline">Редагувати</button>
                <button onClick={() => setCloneTarget(version)} className="text-xs font-medium text-sky-400 hover:underline">Клонувати сюди</button>
                <button onClick={() => setVersionToDelete(version)} className="text-xs font-medium text-rose-400 hover:underline">Видалити</button>
              </div>
            </div>
          );
        })}
      </div>

      {draft && (
        <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-[rgba(5,8,16,0.76)] p-4 pt-[10vh] backdrop-blur-sm sm:p-6">
          <form onSubmit={saveVersion} className="surface-panel w-full max-w-md space-y-5 p-5 sm:p-6 relative shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg font-bold">{draft.id ? "Редагувати версію" : "Нова версія"}</h2>
              <button type="button" onClick={() => setDraft(null)} className="rounded-lg border border-sys-border px-3 py-2 text-sm text-sys-text-secondary hover:text-sys-text-primary">Скасувати</button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="form-label">Назва версії (напр. "Осінній семестр")</label>
                <input required type="text" value={draft.name || ""} onChange={e => setDraft({...draft, name: e.target.value})} className="form-input" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="form-label">Діє з</label>
                  <input required type="date" value={draft.valid_from || ""} onChange={e => setDraft({...draft, valid_from: e.target.value})} className="form-input" />
                </div>
                <div>
                  <label className="form-label">Діє до</label>
                  <input required type="date" value={draft.valid_until || ""} onChange={e => setDraft({...draft, valid_until: e.target.value})} className="form-input" />
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-4 border-t border-sys-border">
              <button type="submit" disabled={isSubmitting} className="rounded-lg bg-sys-accent px-4 py-2 font-medium text-white shadow-sm hover:bg-sys-accent-hover active:scale-95 disabled:opacity-50 transition-all">
                {isSubmitting ? "Збереження..." : "Зберегти"}
              </button>
            </div>
          </form>
        </div>
      )}

      {cloneTarget && (
        <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-[rgba(5,8,16,0.76)] p-4 pt-[10vh] backdrop-blur-sm sm:p-6">
          <div className="surface-panel w-full max-w-md space-y-5 p-5 sm:p-6 shadow-2xl border-sky-400/20 border-2">
            <h2 className="text-lg font-bold text-sky-400">Клонувати розклад</h2>
            <p className="text-sm text-sys-text-secondary">Виберіть версію, з якої хочете скопіювати весь розклад у версію <strong>"{cloneTarget.name}"</strong>.</p>
            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-xs text-amber-200">
              <strong>Увага:</strong> Це дія повністю перезапише існуючий шаблон розкладу у версії "{cloneTarget.name}".
            </div>
            
            <select value={cloneSourceId} onChange={e => setCloneSourceId(e.target.value)} className="form-input mt-4">
              <option value="" disabled>Оберіть версію-джерело...</option>
              {versions.filter(v => v.id !== cloneTarget.id).map(v => (
                <option key={v.id} value={v.id}>{v.name} ({v.valid_from} — {v.valid_until})</option>
              ))}
            </select>

            <div className="flex justify-end gap-3 pt-4">
              <button onClick={() => setCloneTarget(null)} className="rounded-lg border border-sys-border px-3 py-2 text-sm text-sys-text-secondary hover:text-sys-text-primary">Скасувати</button>
              <button onClick={handleClone} disabled={!cloneSourceId || isSubmitting} className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-sky-400 disabled:opacity-50">
                {isSubmitting ? "Копіювання..." : "Скопіювати"}
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
