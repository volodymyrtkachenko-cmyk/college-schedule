import re

with open("frontend/lib/api.ts", "r") as f:
    text = f.read()

# Add schedule.wipe to the api object
# find `schedule: {` and add `wipe`
wipe_func = """    schedule: {
        wipe(token: string, secret: string) {
            return rawRequest<{ message: string }>("/api/schedule/wipe", {
                method: "POST",
                headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify({ secret })
            });
        },"""

text = text.replace("    schedule: {", wipe_func)

with open("frontend/lib/api.ts", "w") as f:
    f.write(text)

with open("frontend/app/admin/page.tsx", "r") as f:
    text = f.read()

# Replace the manual fetch in admin/page.tsx with api.schedule.wipe
fetch_old = """      const res = await fetch("/api/schedule/wipe", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session.access_token}` },
        body: JSON.stringify({ secret: wipePassword })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Не вдалося очистити розклад");"""
fetch_new = """      await api.schedule.wipe(session.access_token, wipePassword);"""
text = text.replace(fetch_old, fetch_new)

with open("frontend/app/admin/page.tsx", "w") as f:
    f.write(text)
