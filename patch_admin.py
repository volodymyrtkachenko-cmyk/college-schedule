import re

with open("frontend/app/admin/page.tsx", "r") as f:
    text = f.read()

# 1. Imports
import_insert = 'import { ConfirmModal } from "../../components/admin/ConfirmModal";\nimport { ApiError } from "../../lib/api";\n'
text = text.replace('import { useAuth } from "../../lib/auth";', 'import { useAuth } from "../../lib/auth";\n' + import_insert)

# 2. Resource config
config_insert = """
const resourceConfig: Record<ReferenceResource, {
  addLabel: string;
  needsFaculties?: boolean;
  needsTeachers?: boolean;
  hasBulkAction?: boolean;
  affectsSchedule?: boolean;
}> = {
  faculties: { addLabel: "спеціальність" },
  groups: { addLabel: "групу", needsFaculties: true, needsTeachers: true, hasBulkAction: true, affectsSchedule: true },
  teachers: { addLabel: "викладача", affectsSchedule: true },
  subjects: { addLabel: "предмет", affectsSchedule: true },
};
"""
text = text.replace('const resources = Object.keys(referenceLabels) as ReferenceResource[];', 'const resources = Object.keys(referenceLabels) as ReferenceResource[];\n' + config_insert)

# 3. State changes for toast and modal
old_state = '  const [message, setMessage] = useState<string | null>(null);'
new_state = '  const [toast, setToast] = useState<{message: string, type: "success" | "error"} | null>(null);\n  const [itemToDelete, setItemToDelete] = useState<ReferenceRecord | null>(null);'
text = text.replace(old_state, new_state)

old_effect_toast = """  // Toast auto-hide
  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [message]);"""
new_effect_toast = """  // Toast auto-hide
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [toast]);"""
text = text.replace(old_effect_toast, new_effect_toast)

# 4. Fetching using resourceConfig
old_fetch = """api.auth.ensureAuthenticated()
      .then((session) => Promise.all([
        api.references.list(resource, session.access_token),
        resource === "groups" ? api.directory.faculties() : Promise.resolve([]),
        resource === "groups" ? api.directory.teachers() : Promise.resolve([]),
      ]))"""
new_fetch = """api.auth.ensureAuthenticated()
      .then((session) => Promise.all([
        api.references.list(resource, session.access_token),
        resourceConfig[resource].needsFaculties ? api.directory.faculties() : Promise.resolve([]),
        resourceConfig[resource].needsTeachers ? api.directory.teachers() : Promise.resolve([]),
      ]))"""
text = text.replace(old_fetch, new_fetch)


# 5. Saving (and cache invalidation)
old_save = """    if (resource === "groups") window.sessionStorage.removeItem("schedule:groups");
    setEditor(undefined); 
    setMessage(editor ? "Запис оновлено." : "Запис створено.");"""
new_save = """    if (resourceConfig[resource].affectsSchedule) {
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
    setToast({ message: editor ? "Запис оновлено." : "Запис створено.", type: "success" });"""
text = text.replace(old_save, new_save)


# 6. Removing (and ConfirmModal logic)
old_remove = """  async function remove(item: ReferenceRecord) {
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
  }"""
new_remove = """  async function confirmRemove(item: ReferenceRecord) {
    try {
      const session = await api.auth.ensureAuthenticated();
      await api.references.remove(resource, item.id, session.access_token);
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
  }"""
text = text.replace(old_remove, new_remove)

# 7. Sorting locale
text = text.replace('.sort((a, b) => a.name.localeCompare(b.name));', '.sort((a, b) => a.name.localeCompare(b.name, "uk"));')


# 8. Render adjustments
old_render = """           <div className="flex gap-2">
             {resource === "groups" && (
                <button onClick={() => setBulkOpen(true)} className="shrink-0 rounded-[6px] border border-sys-accent/50 text-sys-accent px-4 py-2 text-sm font-semibold hover:bg-sys-accent/10 transition-colors">
                  Виховні години
                </button>
             )}
             <button onClick={() => setEditor(null)} className="shrink-0 rounded-[6px] bg-sys-accent px-4 py-2 text-sm font-semibold text-[#0b1120] hover:opacity-90 transition-opacity">
                + Додати {{ faculties: "спеціальність", groups: "групу", teachers: "викладача", subjects: "предмет" }[resource]}
             </button>
           </div>"""
new_render = """           <div className="flex gap-2">
             {resourceConfig[resource].hasBulkAction && (
                <button onClick={() => setBulkOpen(true)} className="shrink-0 rounded-[6px] border border-sys-accent/50 text-sys-accent px-4 py-2 text-sm font-semibold hover:bg-sys-accent/10 transition-colors">
                  Виховні години
                </button>
             )}
             <button onClick={() => setEditor(null)} className="shrink-0 rounded-[6px] bg-sys-accent px-4 py-2 text-sm font-semibold text-[#0b1120] hover:opacity-90 transition-opacity">
                + Додати {resourceConfig[resource].addLabel}
             </button>
           </div>"""
text = text.replace(old_render, new_render)

old_table = 'onDelete={remove}'
new_table = 'onDelete={setItemToDelete}'
text = text.replace(old_table, new_table)

old_bulk = 'onSuccess={(msg) => { setMessage(msg); }}'
new_bulk = 'onSuccess={(msg) => { setToast({ message: msg, type: "success" }); }}'
text = text.replace(old_bulk, new_bulk)

old_toast = """        {message && (
          <div className="fixed bottom-6 right-6 z-50 flex animate-in slide-in-from-bottom-5 items-center gap-2 rounded-[8px] border-[0.5px] border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300 shadow-xl">
             <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5l10 -10"/></svg>
             {message}
          </div>
        )}"""

new_toast = """        {toast && (
          <div className={`fixed bottom-6 right-6 z-50 flex animate-in slide-in-from-bottom-5 items-center gap-2 rounded-[8px] border-[0.5px] px-4 py-3 text-sm shadow-xl ${
            toast.type === "success" 
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" 
            : "border-rose-500/30 bg-rose-500/10 text-rose-300"
          }`}>
             {toast.type === "success" 
               ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5l10 -10"/></svg>
               : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
             }
             {toast.message}
          </div>
        )}
        <ConfirmModal 
           isOpen={itemToDelete !== null} 
           title={`Видалити запис «${itemToDelete?.name}»?`} 
           onConfirm={() => itemToDelete && confirmRemove(itemToDelete)} 
           onCancel={() => setItemToDelete(null)} 
        />"""
text = text.replace(old_toast, new_toast)

with open("frontend/app/admin/page.tsx", "w") as f:
    f.write(text)

