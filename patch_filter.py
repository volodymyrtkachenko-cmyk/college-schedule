import sys

with open("frontend/app/admin/page.tsx", "r") as f:
    text = f.read()


filter_old = """  const searchFields = resourceConfig[resource].searchFields || ["name"];
  const filteredAndSortedItems = items
    .filter(item => {
      const q = searchTerm.toLowerCase();
      return searchFields.some(field => {
        const val = item[field];
        return val && String(val).toLowerCase().includes(q);
      });
    })
    .sort((a, b) => a.name.localeCompare(b.name, "uk"));"""

filter_new = """  const searchFields = resourceConfig[resource].searchFields || ["name"];
  const filteredAndSortedItems = items
    .filter(item => {
      const q = searchTerm.toLowerCase();
      
      const matchesField = searchFields.some(field => {
        const val = item[field];
        return val && String(val).toLowerCase().includes(q);
      });
      
      if (matchesField) return true;

      if (resource === "groups") {
        if (item.faculty_id) {
           const faculty = faculties.find(f => f.id === item.faculty_id);
           if (faculty && faculty.name.toLowerCase().includes(q)) return true;
        }
        if (item.curator_id) {
           const teacher = teachers.find(t => t.id === item.curator_id);
           if (teacher && teacher.name.toLowerCase().includes(q)) return true;
        }
      }
      
      return false;
    })
    .sort((a, b) => a.name.localeCompare(b.name, "uk"));"""

text = text.replace(filter_old, filter_new)

with open("frontend/app/admin/page.tsx", "w") as f:
    f.write(text)
