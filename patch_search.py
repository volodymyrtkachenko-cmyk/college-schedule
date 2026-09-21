import sys

with open("frontend/app/admin/page.tsx", "r") as f:
    text = f.read()

config_old = """const resourceConfig: Record<ReferenceResource, {
  addLabel: string;
  needsFaculties?: boolean;
  needsTeachers?: boolean;
  hasBulkAction?: boolean;
  affectsSchedule?: boolean;
}> = {
  faculties: { addLabel: "спеціальність" },
  groups: { addLabel: "групу", needsFaculties: true, needsTeachers: true, hasBulkAction: true, affectsSchedule: true },
  teachers: { addLabel: "викладача", affectsSchedule: true },
  subjects: { addLabel: "предмет", affectsSchedule: true },
};"""

config_new = """const resourceConfig: Record<ReferenceResource, {
  addLabel: string;
  needsFaculties?: boolean;
  needsTeachers?: boolean;
  hasBulkAction?: boolean;
  affectsSchedule?: boolean;
  searchFields?: (keyof ReferenceRecord)[];
}> = {
  faculties: { addLabel: "спеціальність", searchFields: ["name", "short_name"] },
  groups: { addLabel: "групу", needsFaculties: true, needsTeachers: true, hasBulkAction: true, affectsSchedule: true },
  teachers: { addLabel: "викладача", affectsSchedule: true, searchFields: ["name", "room"] },
  subjects: { addLabel: "предмет", affectsSchedule: true },
};"""

text = text.replace(config_old, config_new)

filter_old = """  const filteredAndSortedItems = items
    .filter(item => item.name.toLowerCase().includes(searchTerm.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name, "uk"));"""

filter_new = """  const searchFields = resourceConfig[resource].searchFields || ["name"];
  const filteredAndSortedItems = items
    .filter(item => {
      const q = searchTerm.toLowerCase();
      return searchFields.some(field => {
        const val = item[field];
        return val && String(val).toLowerCase().includes(q);
      });
    })
    .sort((a, b) => a.name.localeCompare(b.name, "uk"));"""

text = text.replace(filter_old, filter_new)

with open("frontend/app/admin/page.tsx", "w") as f:
    f.write(text)

