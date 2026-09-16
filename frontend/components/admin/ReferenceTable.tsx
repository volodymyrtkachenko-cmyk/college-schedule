"use client";

import { ReferenceRecord, ReferenceResource } from "../../lib/api";
import { referenceLabels } from "./AdminNav";

function EditIcon() {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4" /><path d="M13.5 6.5l4 4" /></svg>;
}

function TrashIcon() {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12" /><path d="M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3" /></svg>;
}

export function ReferenceTable({ resource, items, faculties = [], teachers = [], loading, error, onEdit, onDelete }: { resource: ReferenceResource; items: ReferenceRecord[]; faculties?: ReferenceRecord[]; teachers?: ReferenceRecord[]; loading: boolean; error: string | null; onEdit: (item: ReferenceRecord) => void; onDelete: (item: ReferenceRecord) => void }) {
  if (loading) return <div className="rounded-[8px] border-[0.5px] border-sys-border bg-sys-card p-10 text-center text-sys-text-secondary">Завантаження…</div>;
  if (error) return <div role="alert" className="rounded-[8px] border-[0.5px] border-sys-destructive/30 bg-sys-card p-6 text-sys-destructive">{error}</div>;
  const facultyNames = new Map(faculties.map((faculty) => [faculty.id, faculty.name]));
  const teacherNames = new Map(teachers.map((t) => [t.id, t.name]));
  return (
    <div className="overflow-x-auto rounded-[8px] border-[0.5px] border-sys-border bg-sys-bg">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{referenceLabels[resource]}</caption>
        <thead className="bg-[#0b1120] text-sys-text-muted text-[12px]">
          <tr>
            <th className="px-5 py-3 font-medium">Назва</th>
            {resource === "groups" && <th className="px-5 py-3 font-medium">Спеціальність</th>}
            {resource === "groups" && <th className="px-5 py-3 font-medium">Куратор</th>}
            <th className="px-5 py-3 text-right font-medium">Дії</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-sys-border">
          {items.map((item) => (
            <tr key={item.id} className="hover:bg-sys-card/50 transition-colors">
              <td className="px-5 py-3 text-sys-text-subject">{item.name}</td>
              {resource === "groups" && (
                <td className="px-5 py-3 text-sys-text-secondary">
                  {item.faculty_id ? facultyNames.get(item.faculty_id) ?? "Невідома спеціальність" : "Без спеціальності"}
                </td>
              )}
              {resource === "groups" && (
                <td className="px-5 py-3 text-sys-text-secondary">
                  {item.curator_id ? teacherNames.get(item.curator_id) ?? "Невідомий куратор" : "Без куратора"}
                </td>
              )}
              <td className="px-5 py-3 text-right space-x-3">
                <button aria-label="Змінити" onClick={() => onEdit(item)} className="text-sys-text-muted hover:text-sys-text-primary transition-colors inline-flex align-middle">
                  <EditIcon />
                </button>
                <button aria-label="Видалити" onClick={() => onDelete(item)} className="text-sys-destructive hover:opacity-80 transition-opacity inline-flex align-middle">
                  <TrashIcon />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!items.length && <p className="p-8 text-center text-sys-text-secondary">Записів немає.</p>}
    </div>
  );
}