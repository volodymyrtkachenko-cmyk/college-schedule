import re

toast_old_page = """        {toast && (
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
        )}"""

toast_new = """        {toast && (
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
        )}"""

with open("frontend/app/page.tsx", "r") as f:
    text = f.read()

# Replace toast element
text = text.replace(toast_old_page, toast_new)

# Remove catch from create
text = re.sub(r'setToast\(\{ message: e instanceof Error \? e.message : "Не вдалося додати заняття.", type: "error" \}\);\n\s*', '', text)
# Remove catch from edit
text = re.sub(r'setToast\(\{ message: e instanceof Error \? e.message : "Помилка оновлення", type: "error" \}\);\n\s*', '', text)
# Remove catch from saveNote
text = re.sub(r'setToast\(\{ message: e instanceof Error \? e.message : "Не вдалося зберегти примітку.", type: "error" \}\);\n\s*', '', text)

with open("frontend/app/page.tsx", "w") as f:
    f.write(text)

with open("frontend/app/admin/page.tsx", "r") as f:
    text = f.read()

# Replace toast element
text = text.replace(toast_old_page, toast_new)
with open("frontend/app/admin/page.tsx", "w") as f:
    f.write(text)

