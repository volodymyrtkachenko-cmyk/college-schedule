"use client";

import { useEffect, useState } from "react";
import { ReferenceMutation, ReferenceRecord, ReferenceResource } from "../../lib/api";

type Props = { resource: ReferenceResource; item?: ReferenceRecord; faculties?: ReferenceRecord[]; onCancel: () => void; onSubmit: (value: ReferenceMutation) => Promise<void> };
const fields: Record<ReferenceResource, { key: keyof ReferenceMutation; label: string; type?: string }[]> = {
  faculties: [{ key: "name", label: "Назва" }, { key: "short_name", label: "Скорочення" }],
  groups: [{ key: "name", label: "Назва" }],
  teachers: [{ key: "name", label: "Ім’я" }, { key: "email", label: "Email", type: "email" }],
  rooms: [{ key: "name", label: "Назва" }, { key: "building", label: "Корпус" }, { key: "capacity", label: "Місткість", type: "number" }],
  subjects: [{ key: "name", label: "Назва" }, { key: "short_name", label: "Скорочення" }],
};

export function ReferenceForm({ resource, item, faculties = [], onCancel, onSubmit }: Props) {
  const [value, setValue] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setValue(Object.fromEntries([...fields[resource], ...(resource === "groups" ? [{ key: "faculty_id" as keyof ReferenceMutation }] : [])].map(({ key }) => [key, item?.[key] == null ? "" : String(item[key])]))) }, [resource, item]);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError(null);
    try {
      const payload = Object.fromEntries([...fields[resource], ...(resource === "groups" ? [{ key: "faculty_id" as keyof ReferenceMutation, type: "number" }] : [])].map(({ key, type }) => [key, type === "number" ? (value[key] ? Number(value[key]) : null) : (value[key]?.trim() || null)])) as ReferenceMutation;
      if (!payload.name) throw new Error("Вкажіть назву.");
      await onSubmit(payload);
    } catch (e) { setError(e instanceof Error ? e.message : "Не вдалося зберегти."); } finally { setSaving(false); }
  }
  return <form onSubmit={submit} className="rounded-xl border border-slate-800 bg-slate-900 p-4">
    <h2 className="mb-4 text-lg font-semibold">{item ? "Редагувати запис" : "Новий запис"}</h2>
    <div className="grid gap-3 sm:grid-cols-2">{fields[resource].map(({ key, label, type }) => <label key={key}>{label}<input required={key === "name"} type={type ?? "text"} value={value[key] ?? ""} onChange={(e) => setValue({ ...value, [key]: e.target.value })} /></label>)}{resource === "groups" && <label>Факультет<select value={value.faculty_id ?? ""} onChange={(e) => setValue({ ...value, faculty_id: e.target.value })}><option value="">Без факультету</option>{faculties.map((faculty) => <option key={faculty.id} value={faculty.id}>{faculty.name}</option>)}</select></label>}</div>
    {error && <p role="alert" className="mt-3 text-sm text-rose-300">{error}</p>}
    <div className="mt-4 flex gap-2"><button disabled={saving} className="rounded-lg bg-cyan-400 px-4 py-2 font-semibold text-slate-950">{saving ? "Збереження…" : "Зберегти"}</button><button type="button" onClick={onCancel} className="rounded-lg border border-slate-700 px-4 py-2">Скасувати</button></div>
  </form>;
}
