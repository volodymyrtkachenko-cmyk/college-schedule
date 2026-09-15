"use client";

import { ReferenceRecord, ReferenceResource } from "../../lib/api";
import { referenceLabels } from "./AdminNav";

export function ReferenceTable({ resource, items, faculties = [], loading, error, onEdit, onDelete }: { resource: ReferenceResource; items: ReferenceRecord[]; faculties?: ReferenceRecord[]; loading: boolean; error: string | null; onEdit: (item: ReferenceRecord) => void; onDelete: (item: ReferenceRecord) => void }) {
  if (loading) return <div className="rounded-xl border border-slate-800 p-10 text-center text-slate-400">Завантаження…</div>;
  if (error) return <div role="alert" className="rounded-xl border border-rose-400/30 p-6 text-rose-200">{error}</div>;
  const facultyNames = new Map(faculties.map((faculty) => [faculty.id, faculty.name]));
  return <div className="overflow-x-auto rounded-xl border border-slate-800"><table className="w-full text-left text-sm"><caption className="sr-only">{referenceLabels[resource]}</caption><thead className="bg-slate-900 text-slate-400"><tr><th className="px-4 py-3">Назва</th>{resource === "groups" && <th className="px-4 py-3">Факультет</th>}<th className="px-4 py-3">Статус</th><th className="px-4 py-3 text-right">Дії</th></tr></thead><tbody className="divide-y divide-slate-800">{items.map((item) => <tr key={item.id}><td className="px-4 py-3 font-medium">{item.name}</td>{resource === "groups" && <td className="px-4 py-3 text-slate-300">{item.faculty_id ? facultyNames.get(item.faculty_id) ?? "Невідомий факультет" : "Без факультету"}</td>}<td className="px-4 py-3">{item.is_active ? <span className="text-emerald-300">Активний</span> : <span className="text-slate-500">Видалений</span>}</td><td className="space-x-2 px-4 py-3 text-right"><button onClick={() => onEdit(item)} className="text-cyan-300 hover:underline">Змінити</button>{item.is_active && <button onClick={() => onDelete(item)} className="text-rose-300 hover:underline">Видалити</button>}</td></tr>)}</tbody></table>{!items.length && <p className="p-8 text-center text-slate-400">Записів немає.</p>}</div>;
}
