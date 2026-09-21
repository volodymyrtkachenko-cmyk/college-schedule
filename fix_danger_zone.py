import re

with open("frontend/app/admin/page.tsx", "r") as f:
    text = f.read()

text = re.sub(r'\s*\{\/\* Danger Zone \*\/\}\n\s*<div className="mt-16 rounded-xl border border-rose-500/30 bg-rose-500/5 p-6">\s*<h3 className="text-lg font-bold text-rose-400">Небезпечна зона</h3>\s*<p className="mt-2 text-sm text-sys-text-secondary">Тут ви можете видалити всі наявні заняття та розклад повністю\. Дана дія неминуча і потребує спеціального системного пароля\.</p>\s*<button onClick=\{\(\) => setWipeModalOpen\(true\)\} className="mt-4 rounded-lg bg-rose-500/10 border border-rose-500/20 px-4 py-2 text-sm font-semibold text-rose-400 hover:bg-rose-500/20 transition-colors">\s*Очистити весь розклад\s*</button>\s*</div>\n', '', text)

with open("frontend/app/admin/page.tsx", "w") as f:
    f.write(text)
