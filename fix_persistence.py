import re

with open("frontend/lib/hooks.ts", "r") as f:
    text = f.read()

text = text.replace('window.sessionStorage', 'window.localStorage')

# In hooks.ts, the dateKey logic will pile up LocalStorage keys over time if we just replace it.
# Instead of replacing it broadly, I will manually patch next.config.mjs to cache ALL api requests, 
# and also swap sessionStorage to localStorage for 'schedule:groups', 'teachers', 'subjects', etc., which is bounded.
