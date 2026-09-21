import re

with open("frontend/app/admin/page.tsx", "r") as f:
    text = f.read()

config_old = """const resourceConfig: Record<ReferenceResource, {
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
config_new = """const resourceConfig: Record<ReferenceResource, {
  addLabel: string;
  needsFaculties?: boolean;
  needsTeachers?: boolean;
  hasBulkAction?: boolean;
  affectsSchedule?: boolean;
  searchFields?: (keyof ReferenceRecord)[];
  searchRelations?: (item: ReferenceRecord, faculties: ReferenceRecord[], teachers: ReferenceRecord[]) => (string | undefined | null)[];
}> = {
  faculties: { addLabel: "спеціальність", searchFields: ["name", "short_name"] },
  groups: { 
    addLabel: "групу", needsFaculties: true, needsTeachers: true, hasBulkAction: true, affectsSchedule: true,
    searchFields: ["name"],
    searchRelations: (item, faculties, teachers) => [
      faculties.find(f => f.id === item.faculty_id)?.name,
      teachers.find(t => t.id === item.curator_id)?.name,
    ],
  },
  teachers: { addLabel: "викладача", affectsSchedule: true, searchFields: ["name", "room"] },
  subjects: { addLabel: "предмет", affectsSchedule: true, searchFields: ["name"] },
};"""

text = text.replace(config_old, config_new)

filter_old = """    // 2. Пошук по зв'язаних даних спеціально для категорій "groups"
    if (resource === "groups") {
      if (item.faculty_id) {
         const faculty = faculties.find(f => f.id === item.faculty_id);
         if (faculty && faculty.name.toLowerCase().includes(q)) return true;
      }
      if (item.curator_id) {
         const teacher = teachers.find(t => t.id === item.curator_id);
         if (teacher && teacher.name.toLowerCase().includes(q)) return true;
      }
    }"""
    
filter_old2 = """      if (resource === "groups") {
        if (item.faculty_id) {
           const faculty = faculties.find(f => f.id === item.faculty_id);
           if (faculty && faculty.name.toLowerCase().includes(q)) return true;
        }
        if (item.curator_id) {
           const teacher = teachers.find(t => t.id === item.curator_id);
           if (teacher && teacher.name.toLowerCase().includes(q)) return true;
        }
      }"""    

filter_new = """      const rels = resourceConfig[resource].searchRelations?.(item, faculties, teachers) || [];
      if (rels.some(r => r && r.toLowerCase().includes(q))) return true;"""

text = text.replace(filter_old, filter_new)
text = text.replace(filter_old2, filter_new)

# Update ConfirmModal rendering to be conditional
modal_old = """        <ConfirmModal 
           isOpen={itemToDelete !== null} 
           title={`Видалити запис «${itemToDelete?.name}»?`} 
           onConfirm={() => itemToDelete && confirmRemove(itemToDelete)} 
           onCancel={() => setItemToDelete(null)} 
        />"""
modal_new = """        {itemToDelete && (
          <ConfirmModal 
             isOpen 
             title={`Видалити запис «${itemToDelete.name}»?`} 
             onConfirm={() => confirmRemove(itemToDelete)} 
             onCancel={() => setItemToDelete(null)} 
          />
        )}"""
text = text.replace(modal_old, modal_new)

with open("frontend/app/admin/page.tsx", "w") as f:
    f.write(text)
