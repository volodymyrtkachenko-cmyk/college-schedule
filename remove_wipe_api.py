import re

with open("frontend/lib/api.ts", "r") as f:
    text = f.read()

text = re.sub(r'        wipe\(token: string, secret: string\) \{\n            return rawRequest<\{ message: string \}>\("\/api\/schedule\/wipe", \{\n                method: "POST",\n                headers: \{ "Authorization": `Bearer \$\{token\}`\, "Content-Type": "application\/json" \},\n                body: JSON\.stringify\(\{ secret \}\)\n            \}\);\n        \},\n?', '', text)

with open("frontend/lib/api.ts", "w") as f:
    f.write(text)
