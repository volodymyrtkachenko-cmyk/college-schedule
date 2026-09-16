"use client";

import { useEffect, useRef, useState } from "react";
import { ReferenceMutation, ReferenceRecord, ReferenceResource } from "../../lib/api";

type Props = {
    resource: ReferenceResource;
    item?: ReferenceRecord;
    faculties?: ReferenceRecord[];
    teachers?: ReferenceRecord[];
    onCancel: () => void;
    onSubmit: (value: ReferenceMutation) => Promise<void>
};

const fields: Record<ReferenceResource, { key: keyof ReferenceMutation; label: string; type?: string }[]> = {
    faculties: [{key: "name", label: "Назва"}, {key: "short_name", label: "Скорочення"}],
    groups: [{key: "name", label: "Назва"}],
    teachers: [{key: "name", label: "Ім’я"}, {key: "room", label: "Аудиторія (постійна)"}],
    subjects: [{key: "name", label: "Назва"}],
};

export function ReferenceForm({ resource, item, faculties = [], teachers = [], onCancel, onSubmit }: Props) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [value, setValue] = useState<Record<string, string>>({});
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const extraKeys = resource === "groups" ? ["faculty_id", "curator_id"] : [];

    useEffect(() => {
        setValue(Object.fromEntries(
            [...fields[resource], ...extraKeys.map(k => ({key: k as keyof ReferenceMutation}))]
                .map(({key}) => [key, item?.[key] == null ? "" : String(item[key])])
        ));
        setTimeout(() => inputRef.current?.focus(), 100);
    }, [resource, item]);

    async function submit(event: React.FormEvent) {
        event.preventDefault();
        setSaving(true);
        setError(null);
        try {
            const payload = Object.fromEntries(
                [...fields[resource], ...extraKeys.map(k => ({key: k as keyof ReferenceMutation, type: "number"}))]
                    .map(({key, type}) => [key, type === "number" ? (value[key] ? Number(value[key]) : null) : (value[key]?.trim() || null)])
            ) as ReferenceMutation;
            if (!payload.name) throw new Error("Вкажіть назву.");
            await onSubmit(payload);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Не вдалося зберегти.");
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(5,8,16,0.7)] backdrop-blur-[2px] p-4">
            <form onSubmit={submit} className="w-full max-w-[380px] rounded-[10px] bg-sys-card p-5 shadow-2xl border-[0.5px] border-sys-border">
                <h2 className="mb-5 text-lg font-medium text-sys-text-subject">{item ? "Редагувати запис" : "Новий запис"}</h2>
                <div className="grid gap-4">
                    {fields[resource].map(({key, label, type}, i) => (
                        <label key={key} className="flex flex-col gap-1.5 text-sm text-sys-text-secondary">
                            {label}
                            <input
                                ref={i === 0 ? inputRef : null}
                                required={key === "name"}
                                type={type ?? "text"}
                                value={value[key] ?? ""}
                                onChange={(e) => setValue({ ...value, [key]: e.target.value })}
                                className="rounded-[6px] border-[0.5px] border-sys-border bg-sys-input px-3 py-2 text-sys-text-primary outline-none focus:border-sys-accent focus:ring-1 focus:ring-sys-accent transition-colors"
                            />
                        </label>
                    ))}
                    {resource === "groups" && (<>
                        <label className="flex flex-col gap-1.5 text-sm text-sys-text-secondary">
                            Спеціальність
                            <select
                                value={value.faculty_id ?? ""}
                                onChange={(e) => setValue({ ...value, faculty_id: e.target.value })}
                                className="rounded-[6px] border-[0.5px] border-sys-border bg-sys-input px-3 py-2 text-sys-text-primary outline-none focus:border-sys-accent transition-colors"
                            >
                                <option value="">Без спеціальності</option>
                                {faculties.map((faculty) => <option key={faculty.id} value={faculty.id}>{faculty.name}</option>)}
                            </select>
                        </label>
                        <label className="flex flex-col gap-1.5 text-sm text-sys-text-secondary">
                            Куратор
                            <select
                                value={value.curator_id ?? ""}
                                onChange={(e) => setValue({ ...value, curator_id: e.target.value })}
                                className="rounded-[6px] border-[0.5px] border-sys-border bg-sys-input px-3 py-2 text-sys-text-primary outline-none focus:border-sys-accent transition-colors"
                            >
                                <option value="">Без куратора</option>
                                {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                            </select>
                        </label>
                    </>)}
                </div>
                {error && <p role="alert" className="mt-4 text-sm text-sys-destructive">{error}</p>}
                <div className="mt-6 flex justify-end gap-3">
                    <button type="button" onClick={onCancel} className="rounded-[6px] border-[0.5px] border-sys-border bg-transparent px-4 py-2 text-sm text-sys-text-primary hover:bg-slate-800 transition-colors">
                        Скасувати
                    </button>
                    <button disabled={saving} className="rounded-[6px] bg-sys-accent px-4 py-2 text-sm font-semibold text-[#0b1120] hover:opacity-90 transition-opacity disabled:opacity-50">
                        {saving ? "Збереження…" : "Зберегти"}
                    </button>
                </div>
            </form>
        </div>
    );
}