import re

with open("frontend/app/admin/page.tsx", "r") as f:
    text = f.read()

# Add to state:
state_find = '  const [searchTerm, setSearchTerm] = useState("");'
state_replace = """  const [searchTerm, setSearchTerm] = useState("");
  const [wipeModalOpen, setWipeModalOpen] = useState(false);
  const [wipePassword, setWipePassword] = useState("");
  const [wipeBusy, setWipeBusy] = useState(false);

  async function handleWipe() {
    setWipeBusy(true);
    try {
      const session = await api.auth.ensureAuthenticated();
      const res = await fetch("/api/schedule/wipe", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session.access_token}` },
        body: JSON.stringify({ secret: wipePassword })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Не вдалося очистити розклад");
      // clear cache 
      for (let i = 0; i < window.localStorage.length; i++) {
         const key = window.localStorage.key(i);
         if (key && (key.startsWith("schedule:today:") || key.startsWith("schedule:week:"))) {
             window.localStorage.removeItem(key);
             i--; 
         }
      }
      setToast({ message: "Увесь розклад успішно видалено!", type: "success" });
      setWipeModalOpen(false);
      setWipePassword("");
    } catch (e) {
      setToast({ message: e instanceof Error ? e.message : "Помилка очищення", type: "error" });
    } finally {
      setWipeBusy(false);
    }
  }
"""
text = text.replace(state_find, state_replace)


# Add Danger Zone before the <ConfirmModal> at the bottom
danger_zone = """        {/* Danger Zone */}
        <div className="mt-16 rounded-xl border border-rose-500/30 bg-rose-500/5 p-6">
           <h3 className="text-lg font-bold text-rose-400">Небезпечна зона</h3>
           <p className="mt-2 text-sm text-sys-text-secondary">Тут ви можете видалити всі наявні заняття та розклад повністю. Дана дія неминуча і потребує спеціального системного пароля.</p>
           <button onClick={() => setWipeModalOpen(true)} className="mt-4 rounded-lg bg-rose-500/10 border border-rose-500/20 px-4 py-2 text-sm font-semibold text-rose-400 hover:bg-rose-500/20 transition-colors">
              Очистити весь розклад
           </button>
        </div>

        {wipeModalOpen && (
           <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
             <div className="w-full max-w-sm rounded-2xl border border-sys-border bg-sys-card p-5 shadow-2xl">
               <h3 className="font-semibold text-rose-400">Очищення розкладу</h3>
               <p className="mt-2 text-sm text-sys-text-secondary">Уведіть системний пароль для підтвердження видалення <b>всіх</b> занять з бази.</p>
               <input 
                 type="password" 
                 value={wipePassword} 
                 onChange={(e) => setWipePassword(e.target.value)} 
                 placeholder="Пароль скидання" 
                 className="mt-4 w-full rounded-lg border border-sys-border bg-sys-input px-3 py-2 text-sys-text-primary outline-none focus:border-rose-400 transition-colors"
               />
               <div className="mt-5 flex justify-end gap-2">
                 <button type="button" disabled={wipeBusy} onClick={() => { setWipeModalOpen(false); setWipePassword(""); }} className="rounded-lg border border-sys-border px-4 py-2 text-sm text-sys-text-primary">
                   Скасувати
                 </button>
                 <button type="button" disabled={wipeBusy || !wipePassword} onClick={handleWipe} className="rounded-lg bg-rose-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                   {wipeBusy ? "Видалення..." : "Видалити все"}
                 </button>
               </div>
             </div>
           </div>
        )}"""

text = text.replace('{itemToDelete && (', danger_zone + '\n        {itemToDelete && (')

with open("frontend/app/admin/page.tsx", "w") as f:
    f.write(text)
