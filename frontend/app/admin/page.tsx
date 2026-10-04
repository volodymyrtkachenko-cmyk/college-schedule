
"use client";

import dynamic from "next/dynamic";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AdminNav, referenceLabels } from "../../components/admin/AdminNav";
import { ReferenceForm } from "../../components/admin/ReferenceForm";
import { ReferenceTable } from "../../components/admin/ReferenceTable";
import { api, invalidateDirectoryCache, ReferenceMutation, ReferenceRecord, ReferenceResource } from "../../lib/api";
import { useAuth, canAccessAdmin } from "../../lib/auth";
import { ConfirmModal } from "../../components/admin/ConfirmModal";
import { AdminScheduleEditor } from "../../components/admin/AdminScheduleEditor";
const UsersPanel = dynamic(() => import("../../components/admin/users/UsersPanel").then((module) => module.UsersPanel), { ssr: false });
const CurriculumPanel = dynamic(() => import("../../components/admin/CurriculumPanel").then((module) => module.CurriculumPanel), { ssr: false });
const GeneratorPanel = dynamic(() => import("../../components/admin/GeneratorPanel").then((module) => module.GeneratorPanel), { ssr: false });
const ConstraintsPanel = dynamic(() => import("../../components/admin/ConstraintsPanel").then((module) => module.ConstraintsPanel), { ssr: false });
const SchedulePeriodsPanel = dynamic(() => import("../../components/admin/SchedulePeriodsPanel").then((module) => module.SchedulePeriodsPanel), { ssr: false });
const ScheduleVersionsPanel = dynamic(() => import("../../components/admin/ScheduleVersionsPanel").then((module) => module.ScheduleVersionsPanel), { ssr: false });
const SemesterSettingsPanel = dynamic(() => import("../../components/admin/SemesterSettingsPanel").then((module) => module.SemesterSettingsPanel), { ssr: false });
const ImportPanel = dynamic(() => import("../../components/admin/ImportPanel").then((module) => module.ImportPanel), { ssr: false });

import { ApiError } from "../../lib/api";


const resources = Object.keys(referenceLabels) as ReferenceResource[];

const resourceConfig: Record<ReferenceResource, {
  addLabel: string;
  needsFaculties?: boolean;
  affectsSchedule?: boolean;
  searchFields?: (keyof ReferenceRecord)[];
  searchRelations?: (item: ReferenceRecord, faculties: ReferenceRecord[]) => (string | undefined | null)[];
}> = {
  faculties: { addLabel: "спеціальність", searchFields: ["name", "short_name"] },
  groups: {
    addLabel: "групу", needsFaculties: true, affectsSchedule: true,
    searchFields: ["name"],
    searchRelations: (item, faculties) => [
      faculties.find(f => f.id === item.faculty_id)?.name,
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
  
  const activeResource = resources.includes(currentTab as ReferenceResource)
  ? (currentTab as ReferenceResource)
  : null;
  const [items, setItems] = useState<ReferenceRecord[]>([]);
  const [faculties, setFaculties] = useState<ReferenceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // undefined = list view, null = add new, object = edit existing
  const [editor, setEditor] = useState<ReferenceRecord | null | undefined>(undefined);
  
  const [toast, setToast] = useState<{message: string, type: "success" | "error"} | null>(null);
  const [itemToDelete, setItemToDelete] = useState<ReferenceRecord | null>(null);
  const [searchTerm, setSearchTerm] = useState("");


  useEffect(() => {
    if (authLoading) return;
    if (currentTab === "semester" || !activeResource) return;
    if (user?.role !== "admin" && !isSchedule) return;
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
  }, [authLoading, activeResource, currentTab, user]);

  // Toast auto-hide
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  if (authLoading) return <main className="min-h-screen bg-sys-bg p-8 text-sys-text-secondary">Перевірка доступу…</main>;
  if (!canAccessAdmin(user)) return <main className="flex min-h-screen items-center justify-center bg-sys-bg p-6 text-center text-sys-text-primary"><div><h1 className="text-2xl font-bold">Доступ заборонено</h1><p className="mt-2 text-sys-text-secondary">Цей розділ доступний лише адміністраторам.</p><a href="/" className="mt-5 inline-block text-sys-accent hover:underline">На головну</a></div></main>;

  async function save(payload: ReferenceMutation) {
    if (!activeResource) return;
    const session = await api.auth.ensureAuthenticated();
    const saved = editor
      ? await api.references.update(activeResource, editor.id, payload, session.access_token)
      : await api.references.create(activeResource, payload, session.access_token);
    setItems((current) => editor ? current.map((item) => item.id === saved.id ? saved : item) : [...current, saved]);
    if (resourceConfig[activeResource].affectsSchedule) {
      invalidateDirectoryCache();
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
    setToast({ message: editor ? "Зміни збережено." : "Запис додано.", type: "success" });
  }

  async function confirmRemove(item: ReferenceRecord) {
    if (!activeResource) return;
    try {
      const session = await api.auth.ensureAuthenticated();
      await api.references.remove(activeResource, item.id, session.access_token);
      invalidateDirectoryCache();
      setItems((current) => current.filter((value) => value.id !== item.id)); 
      setToast({ message: "Запис видалено.", type: "success" });
    }
    catch (e) {
      if (e instanceof ApiError && e.status === 409) {
         setToast({ message: "Запис не можна видалити, оскільки він використовується в розкладі.", type: "error" });
      } else if (e instanceof Error) {
         setToast({ message: e.message, type: "error" });
      } else {
         setToast({ message: "Не вдалося видалити запис.", type: "error" });
      }
    } finally {
      setItemToDelete(null);
    }
  }
  
  const filteredAndSortedItems = activeResource ? items
    .filter(item => {
      const q = searchTerm.toLowerCase();
      
      const searchFields = resourceConfig[activeResource].searchFields || ["name"];
      const matchesField = searchFields.some(field => {
        const val = item[field];
        return val && String(val).toLowerCase().includes(q);
      });
      if (matchesField) return true;

      const rels = resourceConfig[activeResource].searchRelations?.(item, faculties) || [];
      if (rels.some(r => r && r.toLowerCase().includes(q))) return true;
      
      return false;
    })
    .sort((a, b) => a.name.localeCompare(b.name, "uk")) : [];

  return (
    <main className="flex flex-col sm:flex-row h-[100dvh] bg-sys-bg text-sys-text-primary overflow-hidden">
      <AdminNav active={currentTab} />
      
      <div className="flex-1 overflow-y-auto overflow-x-hidden pb-20 relative">
        <div className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:p-8">
        
        {currentTab === "schedule" ? (
          <AdminScheduleEditor />
        ) : currentTab === "curriculum" ? (
          <CurriculumPanel />
        ) : currentTab === "generator" ? (
          <GeneratorPanel />
        ) : currentTab === "constraints" ? (
          <ConstraintsPanel />
        ) : currentTab === "periods" && user?.role === "admin" ? (
          <SchedulePeriodsPanel />
        ) : currentTab === "versions" && user?.role === "admin" ? (
          <ScheduleVersionsPanel />
        ) : currentTab === "semester" && user?.role === "admin" ? (
          <SemesterSettingsPanel />
        ) : currentTab === "import" && user?.role === "admin" ? (
          <ImportPanel />

        ) : currentTab === "users" && user?.role === "admin" ? (
          <UsersPanel />
        ) : !activeResource ? (
          <div className="surface-panel mt-2 max-w-xl p-6">
            <h1 className="text-xl font-bold">Розділ не знайдено</h1>
            <p className="mt-2 text-sm text-sys-text-secondary">Оберіть розділ адміністрування з меню.</p>
            <a href="/admin?resource=schedule" className="mt-5 inline-block rounded-lg bg-sys-accent px-4 py-2 text-sm font-semibold text-[#0b1120]">
              До розкладу
            </a>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-4 mt-2">
           <div className="relative w-full max-w-[320px]">
             <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sys-text-muted"><SearchIcon /></span>
             <input 
               type="search"
               aria-label={`Пошук у розділі ${referenceLabels[activeResource]}`}
               placeholder="Знайти запис"
               value={searchTerm}
               onChange={(e) => setSearchTerm(e.target.value)}
               className="form-control w-full py-2 pl-9 pr-4"
             />
           </div>
           
           <div className="flex gap-2">
             <button onClick={() => setEditor(null)} className="shrink-0 rounded-[6px] bg-sys-accent px-4 py-2 text-sm font-semibold text-[#0b1120] hover:opacity-90 transition-opacity">
                + Додати {resourceConfig[activeResource].addLabel}
             </button>
           </div>
        </div>

        {editor !== undefined && (
          <ReferenceForm resource={activeResource} item={editor ?? undefined} faculties={faculties} onCancel={() => setEditor(undefined)} onSubmit={save} />
        )}
        
        <ReferenceTable resource={activeResource} items={filteredAndSortedItems} faculties={faculties} loading={loading} error={error} onEdit={setEditor} onDelete={setItemToDelete} />
        
        {/* Toast */}
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
      </div>
    </main>
  );
}

export default function AdminPage() {
  return <Suspense fallback={<main className="min-h-screen bg-sys-bg p-8 text-sys-text-secondary">Завантаження…</main>}><AdminContent /></Suspense>;
}
