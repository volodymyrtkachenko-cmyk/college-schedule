import re

with open("frontend/app/admin/page.tsx", "r") as f:
    text = f.read()

# Remove state
text = re.sub(r'  const \[wipeModalOpen, setWipeModalOpen\] = useState\(false\);\n  const \[wipePassword, setWipePassword\] = useState\(""\);\n  const \[wipeBusy, setWipeBusy\] = useState\(false\);\n\n  async function handleWipe\(\) \{[\s\S]*?finally \{\n\s*setWipeBusy\(false\);\n\s*\}\n  \}\n', '', text)

# Remove JSX
text = re.sub(r'\s*\{\/\* Danger Zone \*\/\}\n\s*<div className="mt-16 rounded-xl border border-rose-500\/30 bg-rose-500\/5 p-6">[\s\S]*?<\/div>\n\n\s*\{wipeModalOpen && \([\s\S]*?\}\)', '', text)

with open("frontend/app/admin/page.tsx", "w") as f:
    f.write(text)
