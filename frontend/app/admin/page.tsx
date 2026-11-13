
"use client";

import dynamic from "next/dynamic";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { AdminNav, referenceLabels } from "../../components/admin/AdminNav";
import { ReferenceForm } from "../../components/admin/ReferenceForm";
import { ReferenceTable } from "../../components/admin/ReferenceTable";
import {
  api,
  invalidateDirectoryCache,
  ReferenceMutation,
  ReferenceRecord,
  ReferenceResource,
} from "../../lib/api";
import { useAuth, canAccessAdmin } from "../../lib/auth";
import { ConfirmModal } from "../../components/admin/ConfirmModal";
const GroupRosterModal = dynamic(
  () => import("../../components/admin/GroupRosterModal").then((module) => module.GroupRosterModal),
  { ssr: false },
);
const AdminScheduleEditor = dynamic(() => import("../../components/admin/AdminScheduleEditor").then((module) => module.AdminScheduleEditor), {
  ssr: false,
  loading: () => <div className="h-96 animate-pulse rounded-2xl bg-sys-card/40" />
});
const PermanentScheduleEditor = dynamic(() => import("../../components/admin/PermanentScheduleEditor").then((module) => module.PermanentScheduleEditor), { ssr: false });
const UsersPanel = dynamic(() => import("../../components/admin/users/UsersPanel").then((module) => module.UsersPanel), { ssr: false });
const CurriculumPanel = dynamic(() => import("../../components/admin/CurriculumPanel").then((module) => module.CurriculumPanel), { ssr: false });
const GeneratorPanel = dynamic(() => import("../../components/admin/GeneratorPanel").then((module) => module.GeneratorPanel), { ssr: false });
const ConstraintsPanel = dynamic(() => import("../../components/admin/ConstraintsPanel").then((module) => module.ConstraintsPanel), { ssr: false });
const SchedulePeriodsPanel = dynamic(() => import("../../components/admin/SchedulePeriodsPanel").then((module) => module.SchedulePeriodsPanel), { ssr: false });
const ScheduleVersionsPanel = dynamic(() => import("../../components/admin/ScheduleVersionsPanel").then((module) => module.ScheduleVersionsPanel), { ssr: false });
const SemesterSettingsPanel = dynamic(() => import("../../components/admin/SemesterSettingsPanel").then((module) => module.SemesterSettingsPanel), { ssr: false });
const LearningModePanel = dynamic(() => import("../../components/admin/LearningModePanel").then((module) => module.LearningModePanel), { ssr: false });
const ImportPanel = dynamic(() => import("../../components/admin/ImportPanel").then((module) => module.ImportPanel), { ssr: false });

import { ApiError } from "../../lib/api";
import { useToast } from "../../components/ToastProvider";
import { PageHeader } from "../../components/admin/PageHeader";
import { PublicationChangesModal } from "../../components/admin/PublicationChangesModal";
import { invalidateScheduleCache } from "../../lib/hooks";
import { TeacherPinAdminCard } from "../../components/admin/TeacherPinAdminCard";
import { formatPlural } from "../../lib/format";

const resources = Object.keys(referenceLabels) as ReferenceResource[];

const resourceConfig: Record<ReferenceResource, {
  addLabel: string;
  needsFaculties?: boolean;
  affectsSchedule?: boolean;
  searchFields?: (keyof ReferenceRecord)[];
  searchRelations?: (item: ReferenceRecord, faculties: ReferenceRecord[], teachers?: ReferenceRecord[]) => (string | undefined | null)[];
}> = {
  faculties: { addLabel: "спеціальність", searchFields: ["name", "short_name"] },
  groups: {
    addLabel: "групу",
    needsFaculties: true,
    affectsSchedule: true,
    searchFields: ["name"],
    searchRelations: (item, faculties, teachers = []) => [
      faculties.find((f) => f.id === item.faculty_id)?.name,
      teachers.find((t) => t.id === item.curator_id)?.name,
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
  const shouldReduceMotion = useReducedMotion();
  const searchParams = useSearchParams();
  const requested = searchParams.get("resource");
  
  let currentTab = requested || "schedule";
  if (user && user.role !== "admin" && currentTab !== "groups") {
      currentTab = "schedule";
  }
  
  const isSchedule = currentTab === "schedule";
  const isUsers = currentTab === "users";
  
  const activeResource = resources.includes(currentTab as ReferenceResource)
  ? (currentTab as ReferenceResource)
  : null;
  const [items, setItems] = useState<ReferenceRecord[]>([]);
  const [faculties, setFaculties] = useState<ReferenceRecord[]>([]);
  const [teachers, setTeachers] = useState<ReferenceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // undefined = list view, null = add new, object = edit existing
  const [editor, setEditor] = useState<ReferenceRecord | null | undefined>(undefined);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkFacultyId, setBulkFacultyId] = useState<number | null>(null);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  
  const { showToast: setToast } = useToast();
  const [itemToDelete, setItemToDelete] = useState<ReferenceRecord | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  // Auto-import notification banner state
  const [importNotification, setImportNotification] = useState<
    import("../../lib/api").ImportStatusResponse["active_notification"]
  >(null);
  const [selectedNotifPubId, setSelectedNotifPubId] = useState<number | null>(null);
  const [revertingNotif, setRevertingNotif] = useState(false);

  const [rosterGroup, setRosterGroup] = useState<{ id: number; name: string } | null>(null);

  const parsedLines = bulkText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  useEffect(() => {
    if (authLoading || user?.role !== "admin") return;
    let cancelled = false;
    api.importer
      .getStatus()
      .then((st) => {
        if (!cancelled && st?.active_notification) {
          setImportNotification(st.active_notification);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [authLoading, user]);

  const handleDismissNotification = async () => {
    try {
      await api.importer.dismissNotification();
    } catch {
      // ignore
    } finally {
      setImportNotification(null);
    }
  };

  const handleRevertNotification = async () => {
    if (!importNotification) return;
    if (
      !window.confirm(
        `Ви дійсно хочете відкотити автопублікацію #${importNotification.publication_id}? Розклад повернеться до попереднього стану.`
      )
    ) {
      return;
    }
    setRevertingNotif(true);
    try {
      await api.publications.revert(importNotification.publication_id);
      invalidateScheduleCache();
      setToast("Автопублікацію успішно скасовано.", "success");
      setImportNotification(null);
    } catch (e: any) {
      setToast(e instanceof Error ? e.message : "Помилка відкату публікації", "error");
    } finally {
      setRevertingNotif(false);
    }
  };

  useEffect(() => {
    if (authLoading || !user || !canAccessAdmin(user)) return;
    if (currentTab === "semester" || currentTab === "learning-mode" || !activeResource) return;
    if (user?.role !== "admin" && currentTab !== "groups") return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setItems([]);
    setEditor(undefined);
    setSearchTerm("");
    setBulkOpen(false);
    setBulkText("");
    setBulkFacultyId(null);
    setBulkError(null);
    api.auth.ensureAuthenticated()
      .then((session) => Promise.all([
        api.references.list(activeResource, session.access_token),
        resourceConfig[activeResource].needsFaculties ? api.directory.faculties() : Promise.resolve([]),
        activeResource === "groups" ? api.directory.teachers() : Promise.resolve([]),
      ]))
      .then(([nextItems, nextFaculties, nextTeachers]) => {
        if (!cancelled) {
          setItems(nextItems);
          setFaculties(nextFaculties);
          setTeachers(nextTeachers);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Не вдалося завантажити дані.");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [authLoading, activeResource, currentTab, user]);

  if (authLoading) return <main className="min-h-screen bg-sys-bg p-8 text-sys-text-secondary">Перевірка доступу…</main>;
  if (!user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-sys-bg p-6 text-center text-sys-text-primary">
        <div className="surface-panel w-full max-w-md p-8 shadow-xl text-center space-y-4">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-sys-accent/15 text-sys-accent text-xl font-black">
            🔒
          </div>
          <h1 className="text-2xl font-bold">Потрібна авторизація</h1>
          <p className="text-sm text-sys-text-secondary">
            Для доступу до панелі керування розкладом необхідно увійти під обліковим записом адміністратора.
          </p>
          <div className="pt-2 flex flex-col sm:flex-row gap-3 justify-center">
            <a
              href="/login?redirect=/admin"
              className="inline-flex items-center justify-center rounded-xl bg-sys-accent px-5 py-2.5 text-sm font-semibold text-white hover:bg-sys-accent/90 transition-colors shadow-sm"
            >
              Увійти в систему →
            </a>
            <a
              href="/"
              className="inline-flex items-center justify-center rounded-xl border border-sys-border/80 px-4 py-2.5 text-sm font-medium text-sys-text-secondary hover:text-sys-text-primary hover:bg-sys-card/50 transition-colors"
            >
              На головну
            </a>
          </div>
        </div>
      </main>
    );
  }
  if (!canAccessAdmin(user)) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-sys-bg p-6 text-center text-sys-text-primary">
        <div className="surface-panel w-full max-w-md p-8 shadow-xl text-center space-y-3">
          <h1 className="text-2xl font-bold">Недостатньо прав</h1>
          <p className="text-sm text-sys-text-secondary">Ваш обліковий запис (<span className="font-semibold">{user.username}</span>) не має прав адміністратора чи редактора.</p>
          <div className="pt-2">
            <a href="/" className="inline-flex items-center justify-center rounded-xl bg-sys-accent px-5 py-2.5 text-sm font-semibold text-white hover:bg-sys-accent/90 transition-colors">На головну</a>
          </div>
        </div>
      </main>
    );
  }

  async function saveBulk() {
    if (!activeResource || parsedLines.length === 0) return;
    if (activeResource === "groups" && faculties.length > 0 && !bulkFacultyId) {
      setBulkError("Оберіть спеціальність для груп зі списку.");
      return;
    }
    setBulkSaving(true);
    setBulkError(null);
    try {
      const session = await api.auth.ensureAuthenticated();
      const createdItems: ReferenceRecord[] = [];

      for (const line of parsedLines) {
        let payload: ReferenceMutation;
        if (activeResource === "teachers") {
          let name = line;
          let room: string | null = null;
          if (line.includes("\t")) {
            const parts = line.split("\t");
            name = parts[0].trim();
            room = parts[1]?.trim() || null;
          } else if (line.includes(",")) {
            const parts = line.split(",");
            name = parts[0].trim();
            room = parts[1]?.trim() || null;
          } else {
            const bracketMatch = line.match(/^(.*?)\s*\[(.*?)\]$/);
            const roomMatch = line.match(/^(.*?)\s+([0-9]+[а-яА-Яa-zA-Z0-9\-\/]*)$/);
            if (bracketMatch) {
              name = bracketMatch[1].trim();
              room = bracketMatch[2].trim() || null;
            } else if (roomMatch) {
              name = roomMatch[1].trim();
              room = roomMatch[2].trim() || null;
            }
          }
          payload = { name, room } as ReferenceMutation;
        } else if (activeResource === "groups") {
          payload = { name: line, faculty_id: bulkFacultyId } as unknown as ReferenceMutation;
        } else {
          payload = { name: line } as ReferenceMutation;
        }

        if (!payload.name) continue;
        const created = await api.references.create(activeResource, payload, session.access_token);
        createdItems.push(created);
      }

      setItems((current) => [...current, ...createdItems]);
      if (resourceConfig[activeResource].affectsSchedule) {
        invalidateDirectoryCache();
        window.localStorage.removeItem("schedule:groups");
      }
      setBulkOpen(false);
      setBulkText("");
      setToast(`Успішно імпортовано ${createdItems.length} записів.`, "success");
    } catch (e) {
      setBulkError(e instanceof Error ? e.message : "Помилка при пакетному імпорті.");
    } finally {
      setBulkSaving(false);
    }
  }

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
    setToast(editor ? "Зміни збережено." : "Запис додано.", "success");
  }

  async function confirmRemove(item: ReferenceRecord) {
    if (!activeResource) return;
    try {
      const session = await api.auth.ensureAuthenticated();
      await api.references.remove(activeResource, item.id, session.access_token);
      invalidateDirectoryCache();
      setItems((current) => current.filter((value) => value.id !== item.id)); 
      setToast("Запис видалено.", "success");
    }
    catch (e) {
      if (e instanceof ApiError && e.status === 409) {
         setToast("Запис не можна видалити, оскільки він використовується в розкладі.", "error");
      } else if (e instanceof Error) {
         setToast(e.message, "error");
      } else {
         setToast("Не вдалося видалити запис.", "error");
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

      const rels = resourceConfig[activeResource].searchRelations?.(item, faculties, teachers) || [];
      if (rels.some(r => r && r.toLowerCase().includes(q))) return true;
      
      return false;
    })
    .sort((a, b) => a.name.localeCompare(b.name, "uk")) : [];

  return (
    <main className="flex flex-col lg:flex-row h-[100dvh] bg-sys-bg text-sys-text-primary overflow-hidden">
      <AdminNav active={currentTab} />
      
      <div className="flex-1 overflow-y-auto overflow-x-auto pb-safe relative bg-sys-bg">
        <div className={`mx-auto space-y-5 px-4 py-4 sm:px-6 sm:py-6 ${currentTab === "schedule" || currentTab === "permanent-schedule" ? "max-w-[1700px] w-full" : "max-w-[1440px] w-full"}`}>

        {/* Auto-import notification banner */}
        {importNotification && (
          <div
            role="alert"
            className={`rounded-2xl p-4 sm:p-5 border transition-all shadow-lg flex flex-col md:flex-row items-start md:items-center justify-between gap-4 ${
              importNotification.urgent
                ? "bg-gradient-to-r from-amber-500/15 via-rose-500/10 to-amber-500/5 border-amber-500/40 text-sys-text-primary shadow-amber-950/20"
                : "bg-gradient-to-r from-sys-accent/15 via-sky-500/10 to-sys-accent/5 border-sys-accent/30 text-sys-text-primary shadow-cyan-950/15"
            }`}
          >
            <div className="flex items-start gap-3.5 min-w-0">
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-xl font-bold ${
                  importNotification.urgent
                    ? "bg-amber-500/20 border border-amber-500/40 text-amber-600 dark:text-amber-300 animate-bounce"
                    : "bg-sys-accent/15 border border-sys-accent/35 text-sys-accent"
                }`}
              >
                {importNotification.urgent ? "⚡" : "🤖"}
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm sm:text-base font-bold tracking-tight text-sys-text-primary">
                    Автоімпорт: застосовано {formatPlural(importNotification.changes_count, "зміну", "зміни", "змін")}
                  </h3>
                  {typeof importNotification.replacements_count === "number" && (
                    <span className="px-2 py-0.5 rounded-md text-xs font-semibold bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/30">
                      {formatPlural(importNotification.replacements_count, "заміна", "заміни", "замін")}
                    </span>
                  )}
                  {typeof importNotification.swaps_count === "number" && (
                    <span className="px-2 py-0.5 rounded-md text-xs font-semibold bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border border-indigo-500/30">
                      {formatPlural(importNotification.swaps_count, "перестановка", "перестановки", "перестановок")}
                    </span>
                  )}
                  {importNotification.urgent && (
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/20 text-amber-800 dark:text-amber-200 border border-amber-500/40 uppercase tracking-wide">
                      Терміново: розклад на сьогодні / завтра
                    </span>
                  )}
                </div>
                <p className="text-xs text-sys-text-secondary mt-1 leading-relaxed">
                  Оновлено разові заміни та перестановки пар у той же день. Постійний шаблон розкладу не змінено.
                  {importNotification.dates && importNotification.dates.length > 0 && (
                    <>
                      {" "}Дати змін:{" "}
                      <span className="font-mono font-medium text-sys-text-primary">
                        {importNotification.dates.join(", ")}
                      </span>
                      .
                    </>
                  )}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 self-end md:self-center shrink-0 w-full sm:w-auto justify-end">
              <button
                type="button"
                onClick={() => setSelectedNotifPubId(importNotification.publication_id)}
                className="px-3.5 py-2 rounded-xl text-xs font-semibold border border-sys-border bg-slate-100 hover:bg-slate-200 dark:bg-white/10 dark:hover:bg-white/15 text-sys-text-primary transition-all active:scale-95 shrink-0"
              >
                Показати зміни
              </button>
              <button
                type="button"
                onClick={() => void handleRevertNotification()}
                disabled={revertingNotif}
                className="px-3.5 py-2 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white shadow-xs transition-all active:scale-95 disabled:opacity-50 shrink-0"
              >
                {revertingNotif ? "Відкат..." : "Відкотити"}
              </button>
              <button
                type="button"
                onClick={() => void handleDismissNotification()}
                className="px-2.5 py-2 rounded-xl text-xs font-medium text-sys-text-muted hover:text-sys-text-primary hover:bg-slate-100 dark:hover:bg-white/5 transition-colors shrink-0"
                title="Приховати сповіщення"
              >
                Зрозуміло ✕
              </button>
            </div>
          </div>
        )}

        {/* Changes Modal for Notification */}
        <PublicationChangesModal
          publicationId={selectedNotifPubId}
          onClose={() => setSelectedNotifPubId(null)}
          onReverted={() => {
            setImportNotification(null);
            invalidateScheduleCache();
          }}
        />

        <AnimatePresence mode="wait">
          <motion.div
            key={currentTab}
            initial={{ opacity: 0, y: shouldReduceMotion ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: shouldReduceMotion ? 0 : -8 }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.18, ease: [0.2, 0, 0, 1] }}
            className="w-full space-y-5"
          >
        {currentTab === "schedule" ? (
          <AdminScheduleEditor />
        ) : currentTab === "permanent-schedule" ? (
          <PermanentScheduleEditor />
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
        ) : currentTab === "learning-mode" && user?.role === "admin" ? (
          <LearningModePanel />
        ) : currentTab === "import" && user?.role === "admin" ? (
          <ImportPanel />

        ) : currentTab === "users" && user?.role === "admin" ? (
          <UsersPanel />
        ) : !activeResource ? (
          <div className="surface-panel mt-2 max-w-xl p-6">
            <h1 className="text-xl font-bold">Розділ не знайдено</h1>
            <p className="mt-2 text-sm text-sys-text-secondary">Оберіть розділ адміністрування з меню.</p>
            <a href="/admin?resource=schedule" className="mt-5 inline-block rounded-lg bg-sys-accent px-4 py-2 text-sm font-semibold text-white shadow-xs hover:opacity-95">
              До розкладу
            </a>
          </div>
        ) : (
          <>
            <PageHeader
              eyebrow="ДОВІДНИК"
              title={referenceLabels[activeResource]}
              description={`Керування списком записів: редагування, додавання та пошук у довіднику «${referenceLabels[activeResource]}».`}
              actions={
                user?.role === "admin" ? (
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => { setBulkOpen(!bulkOpen); setBulkError(null); }}
                      className="shrink-0 min-h-[44px] sm:min-h-[40px] rounded-lg border border-sys-border bg-sys-card px-3 sm:px-4 py-2 text-xs sm:text-sm font-semibold text-sys-text-primary hover:bg-slate-100 dark:hover:bg-white/5 transition-colors"
                    >
                      📋 Списком
                    </button>
                    <button
                      onClick={() => setEditor(null)}
                      className="shrink-0 min-h-[44px] sm:min-h-[40px] rounded-lg bg-sys-accent px-3.5 sm:px-4 py-2 text-xs sm:text-sm font-semibold text-white shadow-xs hover:opacity-95 active:scale-95 transition-all"
                    >
                      + Додати {resourceConfig[activeResource].addLabel}
                    </button>
                  </div>
                ) : undefined
              }
            />
            {activeResource === "teachers" && user?.role === "admin" && (
              <TeacherPinAdminCard
                onNotify={(msg, tone) => setToast(msg, tone === "positive" ? "success" : "error")}
              />
            )}

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 w-full">
              <div className="relative w-full sm:max-w-md">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sys-text-muted"><SearchIcon /></span>
                <input 
                  type="search"
                  aria-label={`Пошук у розділі ${referenceLabels[activeResource]}`}
                  placeholder={`Пошук серед ${referenceLabels[activeResource].toLowerCase()}…`}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="form-control w-full py-2.5 pl-10 pr-4 min-h-[44px] text-sm"
                />
              </div>
              <div className="flex items-center gap-2 text-xs text-sys-text-secondary self-end sm:self-center">
                <span>
                  Усього: <strong className="font-semibold text-sys-text-primary">{filteredAndSortedItems.length}</strong>
                  {searchTerm && items.length !== filteredAndSortedItems.length && (
                    <span className="text-sys-text-muted font-normal"> (з {items.length})</span>
                  )}
                </span>
              </div>
            </div>

        {bulkOpen && (
          <div className="surface-panel p-4 rounded-xl border border-sys-border bg-sys-card space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-sys-text-primary">
                Пакетне додавання ({referenceLabels[activeResource]})
              </h3>
              <button
                type="button"
                onClick={() => setBulkOpen(false)}
                className="text-sys-text-secondary hover:text-sys-text-primary text-lg"
              >
                ×
              </button>
            </div>
            <p className="text-xs text-sys-text-secondary">
              {activeResource === "teachers" && "Введіть по одному запису на рядок у форматі: ПІБ [аудиторія] або ПІБ через кому/табуляцію (наприклад: Шевченко Т.Г. 204)."}
              {activeResource === "groups" && "Введіть назви груп по одній на рядок (наприклад: КН-21)."}
              {activeResource === "subjects" && "Введіть назви предметів по одній на рядок."}
              {activeResource === "faculties" && "Введіть назви спеціальностей по одній на рядок."}
            </p>

            {activeResource === "groups" && faculties.length > 0 && (
              <div>
                <label className="block text-xs font-medium text-sys-text-secondary mb-1">
                  Спеціальність для всіх груп зі списку:
                </label>
                <select
                  value={bulkFacultyId ?? ""}
                  onChange={(e) => setBulkFacultyId(e.target.value ? Number(e.target.value) : null)}
                  className="form-control text-sm w-full sm:w-72"
                >
                  <option value="">-- Оберіть спеціальність --</option>
                  {faculties.map((f) => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              </div>
            )}

            <textarea
              rows={6}
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              placeholder={"Вставте список...\nРядок 1\nРядок 2"}
              className="form-control w-full font-mono text-sm p-3"
              disabled={bulkSaving}
            />

            {bulkError && <p className="text-xs text-rose-600 dark:text-rose-400">{bulkError}</p>}

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2">
              <span className="text-xs text-sys-text-secondary">
                Виявлено рядків: <strong>{parsedLines.length}</strong>
              </span>
              <div className="flex flex-col-reverse sm:flex-row gap-2">
                <button
                  type="button"
                  onClick={() => setBulkOpen(false)}
                  disabled={bulkSaving}
                  className="min-h-[44px] sm:min-h-[36px] flex items-center justify-center rounded-lg border border-sys-border px-4 py-2 text-xs font-semibold text-sys-text-secondary hover:text-sys-text-primary active:scale-[0.98]"
                >
                  Скасувати
                </button>
                <button
                  type="button"
                  onClick={saveBulk}
                  disabled={bulkSaving || parsedLines.length === 0}
                  className="min-h-[44px] sm:min-h-[36px] flex items-center justify-center rounded-lg bg-sys-accent px-5 py-2 text-xs font-semibold text-white shadow-xs hover:opacity-95 active:scale-[0.98] disabled:opacity-50"
                >
                  {bulkSaving ? "Збереження…" : `Імпортувати (${parsedLines.length})`}
                </button>
              </div>
            </div>
          </div>
        )}

        <AnimatePresence>
          {editor !== undefined && (
            <ReferenceForm
              resource={activeResource}
              item={editor ?? undefined}
              faculties={faculties}
              teachers={teachers}
              onCancel={() => setEditor(undefined)}
              onSubmit={save}
            />
          )}
        </AnimatePresence>
        
        <ReferenceTable
          resource={activeResource}
          items={filteredAndSortedItems}
          faculties={faculties}
          teachers={teachers}
          loading={loading}
          error={error}
          onEdit={setEditor}
          onDelete={user?.role === "admin" ? setItemToDelete : undefined}
          onOpenRoster={setRosterGroup}
        />
        
        
        {itemToDelete && (
          <ConfirmModal 
             isOpen 
             title={`Видалити запис «${itemToDelete.name}»?`} 
             onConfirm={() => confirmRemove(itemToDelete)} 
             onCancel={() => setItemToDelete(null)} 
          />
        )}

        <GroupRosterModal
          group={rosterGroup}
          onClose={() => setRosterGroup(null)}
          onNotify={setToast}
        />
          </>
        )}
          </motion.div>
        </AnimatePresence>
        </div>
      </div>
    </main>
  );
}

export default function AdminPage() {
  return <Suspense fallback={<main className="min-h-screen bg-sys-bg p-8 text-sys-text-secondary">Завантаження…</main>}><AdminContent /></Suspense>;
}
