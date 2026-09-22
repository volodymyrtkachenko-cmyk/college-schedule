
"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AdminNav, referenceLabels } from "../../components/admin/AdminNav";
import { ReferenceForm } from "../../components/admin/ReferenceForm";
import { ReferenceTable } from "../../components/admin/ReferenceTable";
import { BulkCuratorsModal } from "../../components/admin/BulkCuratorsModal";
import { api, ReferenceMutation, ReferenceRecord, ReferenceResource } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { ConfirmModal } from "../../components/admin/ConfirmModal";
import { AdminScheduleEditor } from "../../components/admin/AdminScheduleEditor";
import { UsersPanel } from "../../components/admin/users/UsersPanel";
import { ApiError } from "../../lib/api";


const resources = Object.keys(referenceLabels) as ReferenceResource[];

const resourceConfig: Record<ReferenceResource, {
  addLabel: string;
  needsFaculties?: boolean;
  needsTeachers?: boolean;
  hasBulkAction?: boolean;
  affectsSchedule?: boolean;
  searchFields?: (keyof ReferenceRecord)[];
  searchRelations?: (item: ReferenceRecord, faculties: ReferenceRecord[], teachers: ReferenceRecord[]) => (string | undefined | null)[];
}> = {
  faculties: { addLabel: "спеціальність", searchFields: ["name", "short_name"] },
  groups: { 
    addLabel: "групу", needsFaculties: true, needsTeachers: true, hasBulkAction: true, affectsSchedule: true,
    searchFields: ["name"],
    searchRelations: (item, faculties, teachers) => [
      faculties.find(f => f.id === item.faculty_id)?.name,
      teachers.find(t => t.id === item.curator_id)?.name,
    ],
  },
  teachers: { addLabel: "викладача", affectsSchedule: true, searchFields: ["name", "room"] },
  subjects: { addLabel: "предмет", affectsSchedule: true, searchFields: ["name"] },
};


function SearchIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0" /><path d="M21 21l-6 -6" /></svg>;
}

function AdminContent() {
  const { user, loading: authLoading, logout } = useAuth();
  const searchParams = useSearchParams();
  const requested = searchParams.get("resource");
  
  let currentTab = requested || "schedule";
  if (user && user.role !== "admin") {
      currentTab = "schedule";
  }
  
  const isSchedule = currentTab === "schedule";
  const isUsers = currentTab === "users";
  
  const resource = (!isSchedule && !isUsers && requested && resources.includes(requested as ReferenceResource)) ? requested as ReferenceResource : (currentTab === "schedule" || currentTab === "users" ? undefined : "groups");
  const activeResource = typeof currentTab === "string" && !isSchedule && !isUsers ? currentTab as ReferenceResource : "groups";
  const [items, setItems] = useState<ReferenceRecord[]>([]);
  const [faculties, setFaculties] = useState<ReferenceRecord[]>([]);
  const [teachers, setTeachers] = useState<ReferenceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // undefined = list view, null = add new, object = edit existing
  const [editor, setEditor] = useState<ReferenceRecord | null | undefined>(undefined);
  const [bulkOpen, setBulkOpen] = useState(false);
  
  const [toast, setToast] = useState<{message: string, type: "success" | "error"} | null>(null);
  const [itemToDelete, setItemToDelete] = useState<ReferenceRecord | null>(null);
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
        api.references.list(activeResource, session.access_token),
        resourceConfig[activeResource].needsFaculties ? api.directory.faculties() : Promise.resolve([]),
        resourceConfig[activeResource].needsTeachers ? api.directory.teachers() : Promise.resolve([]),
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
    if (toast) {
      const timer = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  if (authLoading) return <main className="min-h-screen bg-sys-bg p-8 text-sys-text-secondary">Перевірка доступу…</main>;
  if (!user || user.role !== "admin") return <main className="flex min-h-screen items-center justify-center bg-sys-bg p-6 text-center text-sys-text-primary"><div><h1 className="text-2xl font-bold">Доступ заборонено</h1><p className="mt-2 text-sys-text-secondary">Розділ доступний лише адміністраторам.</p><a href="/" className="mt-5 inline-block text-sys-accent hover:underline">Повернутися до розкладу</a></div></main>;

  async function save(payload: ReferenceMutation) {
    const session = await api.auth.ensureAuthenticated();
    const saved = editor
      ? await api.references.update(activeResource, editor.id, payload, session.access_token)
      : await api.references.create(activeResource, payload, session.access_token);
    setItems((current) => editor ? current.map((item) => item.id === saved.id ? saved : item) : [...current, saved]);
    if (resourceConfig[activeResource].affectsSchedule) {
      // Wiping related schedule caches to force a refetch on main page
      window.localStorage.removeItem("schedule:groups");
      for (let i = 0; i < window.localStorage.length; i++) {
         const key = window.localStorage.key(i);
         if (key && (key.startsWith("schedule:today:") || key.startsWith("schedule:week:"))) {
             window.localStorage.removeItem(key);
             i--; // adjust index since we just removed an item
         }
      }
    }
    setEditor(undefined); 
    setToast({ message: editor ? "Запис оновлено." : "Запис створено.", type: "success" });
  }

  async function confirmRemove(item: ReferenceRecord) {
    try {
      const session = await api.auth.ensureAuthenticated();
      await api.references.remove(activeResource, item.id, session.access_token);
      setItems((current) => current.filter((value) => value.id !== item.id)); 
      setToast({ message: "Запис успішно видалено.", type: "success" });
    }
    catch (e) {
      if (e instanceof ApiError && e.status === 409) {
         setToast({ message: "Помилка: запис вже використовується в розкладі!", type: "error" });
      } else if (e instanceof Error) {
         setToast({ message: e.message, type: "error" });
      } else {
         setToast({ message: "Не вдалося видалити запис.", type: "error" });
      }
    } finally {
      setItemToDelete(null);
    }
  }
  
  const filteredAndSortedItems = items
    .filter(item => {
      const q = searchTerm.toLowerCase();
      
      const searchFields = resourceConfig[activeResource].searchFields || ["name"];
      const matchesField = searchFields.some(field => {
        const val = item[field];
        return val && String(val).toLowerCase().includes(q);
      });
      if (matchesField) return true;

      const rels = resourceConfig[activeResource].searchRelations?.(item, faculties, teachers) || [];
      if (rels.some(r => r && r.toLowerCase().includes(q))) return true;
      
      return false;
    })
    .sort((a, b) => a.name.localeCompare(b.name, "uk"));

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
        <AdminNav active={currentTab} />
        
        {currentTab === "schedule" ? (
          <AdminScheduleEditor />
        ) : (
          <>
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
           
           <div className="flex gap-2">
             {resourceConfig[activeResource].hasBulkAction && (
                <button onClick={() => setBulkOpen(true)} className="shrink-0 rounded-[6px] border border-sys-accent/50 text-sys-accent px-4 py-2 text-sm font-semibold hover:bg-sys-accent/10 transition-colors">
                  Виховні години
                </button>
             )}
             <button onClick={() => setEditor(null)} className="shrink-0 rounded-[6px] bg-sys-accent px-4 py-2 text-sm font-semibold text-[#0b1120] hover:opacity-90 transition-opacity">
                + Додати {resourceConfig[activeResource].addLabel}
             </button>
           </div>
        </div>

        {editor !== undefined && (
          <ReferenceForm resource={activeResource} item={editor ?? undefined} faculties={faculties} teachers={teachers} onCancel={() => setEditor(undefined)} onSubmit={save} />
        )}
        
        <ReferenceTable resource={activeResource} items={filteredAndSortedItems} faculties={faculties} teachers={teachers} loading={loading} error={error} onEdit={setEditor} onDelete={setItemToDelete} />
        
        {/* Toast */}
        {bulkOpen && <BulkCuratorsModal groups={items} onClose={() => setBulkOpen(false)} onSuccess={(msg) => { setToast({ message: msg, type: "success" }); }} />}
        
        {toast && (
          <div className={`fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:bottom-6 z-[100] flex animate-in slide-in-from-bottom-5 items-center gap-2 rounded-[8px] border px-4 py-3 text-sm shadow-2xl backdrop-blur-md ${
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
        )}
        {itemToDelete && (
          <ConfirmModal 
             isOpen 
             title={`Видалити запис «${itemToDelete.name}»?`} 
             onConfirm={() => confirmRemove(itemToDelete)} 
             onCancel={() => setItemToDelete(null)} 
          />
        )}
          </>
        )}
      </div>
    </main>
  );
}

export default function AdminPage() {
  return <Suspense fallback={<main className="min-h-screen bg-sys-bg p-8 text-sys-text-secondary">Завантаження…</main>}><AdminContent /></Suspense>;
}
