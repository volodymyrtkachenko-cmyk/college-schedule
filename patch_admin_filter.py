import re

with open("frontend/app/admin/page.tsx", "r") as f:
    text = f.read()

filter_regex = re.compile(r'const filteredAndSortedItems = items\s*\.filter\(item => \{.*?\n\s*\}\)\s*\.sort\(\(a, b\) => a\.name\.localeCompare\(b\.name, "uk"\)\);', re.DOTALL)

new_filter = """const filteredAndSortedItems = items
    .filter(item => {
      const q = searchTerm.toLowerCase();
      
      const searchFields = resourceConfig[resource].searchFields || ["name"];
      const matchesField = searchFields.some(field => {
        const val = item[field];
        return val && String(val).toLowerCase().includes(q);
      });
      if (matchesField) return true;

      const rels = resourceConfig[resource].searchRelations?.(item, faculties, teachers) || [];
      if (rels.some(r => r && r.toLowerCase().includes(q))) return true;
      
      return false;
    })
    .sort((a, b) => a.name.localeCompare(b.name, "uk"));"""

text = filter_regex.sub(new_filter, text)

# Just in case `searchFields` was defined outside:
text = re.sub(r'const searchFields = resourceConfig\[resource\]\.searchFields \|\| \["name"\];\n\s*const filteredAndSortedItems =', 'const filteredAndSortedItems =', text)

with open("frontend/app/admin/page.tsx", "w") as f:
    f.write(text)
