
"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AdminNav, referenceLabels } from "../../components/admin/AdminNav";
import { ReferenceForm } from "../../components/admin/ReferenceForm";
import { ReferenceTable } from "../../components/admin/ReferenceTable";
import { api, ReferenceMutation, ReferenceRecord, ReferenceResource } from "../../lib/api";
import { useAuth } from "../../lib/auth";

const resources = Object.keys(referenceLabels) as ReferenceResource[];

function SearchIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0" /><path d="M21 21l-6 -6" /></svg>;
}

function AdminContent() {
  const { user, loading: authLoading, logout } = useAuth();
  const searchParams = useSearchParams();
  const requested = searchParams.get("resource") as ReferenceResource | null;
  const resource = requested && resources.includes(requested) ? requested : "faculties";
  const [items, setItems] = useState<ReferenceRecord[]>([]);
  const [faculties, setFaculties] = useState<ReferenceRecord[]>([]);
  const [teachers, setTeachers] = useState<ReferenceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // undefined = list view, null = add new, object = edit existing
  const [editor, setEditor] = useState<ReferenceRecord | null | undefined>(undefined);
  
  const [message, setMessage] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    if (authLoading || user?.role !== "admin") return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setItems([]);
    setEditor(undefined);
    setSearchTerm("");
    api.auth.ensureAuthenticated()
      .then((session) => Promise.all([
        api.references.list(resource, session.access_token),
        resource === "groups" ? api.directory.faculties() : Promise.resolve([]),
        resource === "groups" ? api.directory.teachers() : Promise.resolve([]),
      ]))
      .then(([nextItems, nextFaculties, nextTeachers]) => {
        if (!cancelled) {
          setItems(nextItems);
          setFaculties(nextFaculties);
          setTeachers(nextTeachers ?? []);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Не вдалося завантажити дані.");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [authLoading, resource, user]);

  // Toast auto-hide
  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  if (authLoading) return <main className="min-h-screen bg-sys-bg p-8 text-sys-text-secondary">Перевірка доступу…</main>;
  if (!user || user.role !== "admin") return <main className="flex min-h-screen items-center justify-center bg-sys-bg p-6 text-center text-sys-text-primary"><div><h1 className="text-2xl font-bold">Доступ заборонено</h1><p className="mt-2 text-sys-text-secondary">Розділ доступний лише адміністраторам.</p><a href="/" className="mt-5 inline-block text-sys-accent hover:underline">Повернутися до розкладу</a></div></main>;

  async function save(payload: ReferenceMutation) {
    const session = await api.auth.ensureAuthenticated();
    const saved = editor
      ? await api.references.update(resource, editor.id, payload, session.access_token)
      : await api.references.create(resource, payload, session.access_token);
    setItems((current) => editor ? current.map((item) => item.id === saved.id ? saved : item) : [...current, saved]);
    if (resource === "groups") window.sessionStorage.removeItem("schedule:groups");
    setEditor(undefined); 
    setMessage(editor ? "Запис оновлено." : "Запис створено.");
  }

  async function remove(item: ReferenceRecord) {
    if (!window.confirm(`Видалити запис «${item.name}»?`)) return;
    try {
      const session = await api.auth.ensureAuthenticated();
      await api.references.remove(resource, item.id, session.access_token);
      setItems((current) => current.filter((value) => value.id !== item.id)); 
      setMessage("Запис успішно видалено.");
    }
    catch (e) {
      if (e instanceof Error) {
         if (e.message.toLowerCase().includes("conflict") || e.message.toLowerCase().includes("used") || e.message.includes("конфлікт")) {
            alert("Помилка видалення: цей запис вже використовується в розкладі або інших даних!");
         } else {
            alert(e.message);
         }
      } else alert("Не вдалося видалити запис.");
    }
  }
  
  const filteredAndSortedItems = items
    .filter(item => item.name.toLowerCase().includes(searchTerm.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <main className="min-h-screen bg-sys-bg pb-10 text-sys-text-primary">
      <header className="border-b-[0.5px] border-sys-border bg-sys-bg px-4 py-4">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4">
          <div>
            <a href="https://kre.dp.ua/" target="_blank" rel="noopener noreferrer" className="inline-block hover:opacity-80 transition-opacity" title="Головна сторінка закладу">
              <p className="text-[10px] font-bold uppercase tracking-widest text-sys-accent">ДФКР</p>
            </a>
            <h1 className="text-xl font-bold">Адміністрування</h1>
          </div>
          <div className="flex gap-3">
            <a href="/" className="rounded-[6px] border-[0.5px] border-sys-border px-3 py-1.5 text-sm hover:bg-slate-800 transition-colors">Розклад</a>
            <button onClick={logout} className="rounded-[6px] border-[0.5px] border-sys-border px-3 py-1.5 text-sm hover:bg-slate-800 transition-colors">Вийти</button>
          </div>
        </div>
      </header>
      
      <div className="mx-auto max-w-6xl space-y-5 px-4 py-6">
        <AdminNav active={resource} />
        
        <div className="flex flex-wrap items-center justify-between gap-4 mt-2">
           <div className="relative w-full max-w-[320px]">
             <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sys-text-muted"><SearchIcon /></span>
             <input 
               type="text" 
               placeholder="Пошук..." 
               value={searchTerm}
               onChange={(e) => setSearchTerm(e.target.value)}
               className="w-full rounded-[6px] border-[0.5px] border-sys-border bg-sys-input py-2 pl-9 pr-4 text-sm text-sys-text-primary outline-none transition-colors focus:border-sys-accent focus:ring-1 focus:ring-sys-accent"
             />
           </div>
           
           <button onClick={() => setEditor(null)} className="shrink-0 rounded-[6px] bg-sys-accent px-4 py-2 text-sm font-semibold text-[#0b1120] hover:opacity-90 transition-opacity">
              + Додати {{ faculties: "спеціальність", groups: "групу", teachers: "викладача", subjects: "предмет" }[resource]}
           </button>
        </div>

        {editor !== undefined && (
          <ReferenceForm resource={resource} item={editor ?? undefined} faculties={faculties} teachers={teachers} onCancel={() => setEditor(undefined)} onSubmit={save} />
        )}
        
        <ReferenceTable resource={resource} items={filteredAndSortedItems} faculties={faculties} teachers={teachers} loading={loading} error={error} onEdit={setEditor} onDelete={remove} />
        
        {/* Toast */}
        {message && (
          <div className="fixed bottom-6 right-6 z-50 flex animate-in slide-in-from-bottom-5 items-center gap-2 rounded-[8px] border-[0.5px] border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300 shadow-xl">
             <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5l10 -10"/></svg>
             {message}
          </div>
        )}
      </div>
    </main>
  );
}

export default function AdminPage() {
  return <Suspense fallback={<main className="min-h-screen bg-sys-bg p-8 text-sys-text-secondary">Завантаження…</main>}><AdminContent /></Suspense>;
}
