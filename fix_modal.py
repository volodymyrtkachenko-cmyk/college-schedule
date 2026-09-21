import re

with open("frontend/app/admin/page.tsx", "r") as f:
    text = f.read()

text = re.sub(r'\s*\{wipeModalOpen && \([\s\S]*?\}\)\n', '\n', text)

with open("frontend/app/admin/page.tsx", "w") as f:
    f.write(text)
