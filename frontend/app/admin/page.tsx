"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AdminNav, referenceLabels } from "../../components/admin/AdminNav";
import { ReferenceForm } from "../../components/admin/ReferenceForm";
import { ReferenceTable } from "../../components/admin/ReferenceTable";
import { api, ReferenceMutation, ReferenceRecord, ReferenceResource } from "../../lib/api";
import { useAuth } from "../../lib/auth";

const resources = Object.keys(referenceLabels) as ReferenceResource[];

function AdminContent() {
  const { user, loading: authLoading, logout } = useAuth();
  const searchParams = useSearchParams();
  const requested = searchParams.get("resource") as ReferenceResource | null;
  const resource = requested && resources.includes(requested) ? requested : "faculties";
  const [items, setItems] = useState<ReferenceRecord[]>([]);
  const [faculties, setFaculties] = useState<ReferenceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<ReferenceRecord | null | undefined>();
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading || user?.role !== "admin") return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setItems([]);
    setEditor(undefined);
    api.auth.ensureAuthenticated()
      .then((session) => Promise.all([
        api.references.list(resource, session.access_token),
        resource === "groups" ? api.directory.faculties() : Promise.resolve([]),
      ]))
      .then(([nextItems, nextFaculties]) => {
        if (!cancelled) {
          setItems(nextItems);
          setFaculties(nextFaculties);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Не вдалося завантажити дані.");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [authLoading, resource, user]);

  if (authLoading) return <main className="min-h-screen bg-slate-950 p-8 text-slate-400">Перевірка доступу…</main>;
  if (!user || user.role !== "admin") return <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-center text-slate-100"><div><h1 className="text-2xl font-bold">Доступ заборонено</h1><p className="mt-2 text-slate-400">Розділ доступний лише адміністраторам.</p><a href="/" className="mt-5 inline-block text-cyan-300 hover:underline">Повернутися до розкладу</a></div></main>;

  async function save(payload: ReferenceMutation) {
    const session = await api.auth.ensureAuthenticated();
    const saved = editor
      ? await api.references.update(resource, editor.id, payload, session.access_token)
      : await api.references.create(resource, payload, session.access_token);
    setItems((current) => editor ? current.map((item) => item.id === saved.id ? saved : item) : [...current, saved]);
    if (resource === "groups") window.sessionStorage.removeItem("schedule:groups");
    setEditor(undefined); setMessage(editor ? "Запис оновлено." : "Запис створено.");
  }

  async function remove(item: ReferenceRecord) {
    if (!window.confirm(`Видалити «${item.name}»? Запис буде деактивовано.`)) return;
    try {
      const session = await api.auth.ensureAuthenticated();
      await api.references.remove(resource, item.id, session.access_token);
      setItems((current) => current.map((value) => value.id === item.id ? { ...value, is_active: false } : value)); setMessage("Запис деактивовано.");
    }
    catch (e) { setError(e instanceof Error ? e.message : "Не вдалося видалити запис."); }
  }
  return <main className="min-h-screen bg-slate-950 pb-10 text-slate-100"><header className="border-b border-slate-800 px-4 py-5"><div className="mx-auto flex max-w-6xl items-center justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-400">College Schedule</p><h1 className="text-2xl font-bold">Адміністрування</h1></div><div className="flex gap-3"><a href="/" className="rounded-lg border border-slate-700 px-3 py-2 text-sm">Розклад</a><button onClick={logout} className="rounded-lg border border-slate-700 px-3 py-2 text-sm">Вийти</button></div></div></header><div className="mx-auto max-w-6xl space-y-5 px-4 py-6"><AdminNav active={resource} /><div className="flex items-center justify-between"><h2 className="text-xl font-semibold">{referenceLabels[resource]}</h2>{editor === undefined && <button onClick={() => setEditor(null)} className="rounded-lg bg-cyan-400 px-4 py-2 font-semibold text-slate-950">Додати</button>}</div>{message && <p role="status" className="rounded-lg border border-emerald-400/30 bg-emerald-400/5 px-4 py-3 text-emerald-200">{message}</p>}{editor !== undefined && <ReferenceForm resource={resource} item={editor ?? undefined} faculties={faculties} onCancel={() => setEditor(undefined)} onSubmit={save} />}<ReferenceTable resource={resource} items={items} faculties={faculties} loading={loading} error={error} onEdit={setEditor} onDelete={remove} /></div></main>;
}

export default function AdminPage() {
  return <Suspense fallback={<main className="min-h-screen bg-slate-950 p-8 text-slate-400">Завантаження…</main>}><AdminContent /></Suspense>;
}
