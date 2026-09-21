import re

with open("frontend/components/ScheduleWeekGrid.tsx", "r") as f:
    text = f.read()

# 1. Remove comment
text = text.replace("  // Wait we don't have this, let me just hardcode it\n", "")

# 2. Fix dayNames mapping
daynames_old = 'const dayNames = ["Пн", "Вт", "Ср", "Чт", "Пт"];\n  const activeDay = week[activeIdx];'
daynames_new = 'const activeDay = week[activeIdx];\n  const getDayName = (dateStr: string) => {\n     const d = new Date(dateStr);\n     return new Intl.DateTimeFormat("uk-UA", { weekday: "short" }).format(d);\n  };'
text = text.replace(daynames_old, daynames_new)

# 3. Use getDayName in button
btn_old = '{dayNames[idx] || dayNames[0]}'
btn_new = '{getDayName(day.date)}'
text = text.replace(btn_old, btn_new)

with open("frontend/components/ScheduleWeekGrid.tsx", "w") as f:
    f.write(text)
