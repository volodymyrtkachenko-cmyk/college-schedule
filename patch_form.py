with open("frontend/components/admin/ReferenceForm.tsx", "r") as f:
    text = f.read()

import_insert = 'import { useState, FormEvent } from "react";\n'
if "import { useState" not in text:
    text = import_insert + text.replace('import { ReferenceMutation', 'import { ReferenceMutation')
else:
    text = text.replace('import { useState }', 'import { useState, FormEvent }')

# Fix form function signature
old_sig = """export function ReferenceForm({ resource, initial = { name: "" }, onSubmit, onCancel, extraKeys = [], hideFields = [] }: {
    resource: ReferenceResource
    initial?: Partial<ReferenceMutation>
    onSubmit: (value: ReferenceMutation) => Promise<void>
    onCancel: () => void
    extraKeys?: string[]
    hideFields?: string[]
}) {"""
new_sig = """export function ReferenceForm({ resource, initial = { name: "" }, onSubmit, onCancel, extraKeys = [], hideFields = [] }: {
    resource: ReferenceResource
    initial?: Partial<ReferenceMutation>
    onSubmit: (value: ReferenceMutation) => Promise<void>
    onCancel: () => void
    extraKeys?: string[]
    hideFields?: string[]
}) {
  const [isSaving, setIsSaving] = useState(false);"""
text = text.replace(old_sig, new_sig)

old_submit = """    return (
        <form className={"space-y-4"} onSubmit={(e) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            
            const payload = Object.fromEntries(
                [...fields[resource], ...extraKeys.map(k => ({key: k as keyof ReferenceMutation, type: "number"}))]
                    .filter(f => !hideFields.includes(f.key))
                    .map(field => [field.key, field.type === "number" ? Number(formData.get(field.key)) || null : formData.get(field.key)])
            ) as ReferenceMutation;
            
            onSubmit(payload);
        }}>"""
new_submit = """    const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        
        const payload = Object.fromEntries(
            [...fields[resource], ...extraKeys.map(k => ({key: k as keyof ReferenceMutation, type: "number"}))]
                .filter(f => !hideFields.includes(f.key))
                .map(field => [field.key, field.type === "number" ? Number(formData.get(field.key)) || null : formData.get(field.key)])
        ) as ReferenceMutation;
        
        setIsSaving(true);
        try {
            await onSubmit(payload);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <form className={"space-y-4"} onSubmit={handleSubmit}>"""
text = text.replace(old_submit, new_submit)

old_buttons = """            <div className="flex gap-2">
                <button type="submit" className="rounded-[6px] bg-sky-500/10 px-4 py-2 text-sm font-medium text-sky-400 hover:bg-sky-500/20">Зберегти</button>
                <button type="button" onClick={onCancel} className="rounded-[6px] border border-sys-border px-4 py-2 text-sm font-medium hover:bg-zinc-800">Скасувати</button>
            </div>"""
new_buttons = """            <div className="flex gap-2">
                <button disabled={isSaving} type="submit" className={`rounded-[6px] px-4 py-2 text-sm font-medium transition-colors ${isSaving ? 'bg-sky-500/5 text-sky-400/50 cursor-not-allowed' : 'bg-sky-500/10 text-sky-400 hover:bg-sky-500/20'}`}>
                    {isSaving ? "Збереження..." : "Зберегти"}
                </button>
                <button disabled={isSaving} type="button" onClick={onCancel} className="rounded-[6px] border border-sys-border px-4 py-2 text-sm font-medium hover:bg-zinc-800 disabled:opacity-50">Скасувати</button>
            </div>"""
text = text.replace(old_buttons, new_buttons)

with open("frontend/components/admin/ReferenceForm.tsx", "w") as f:
    f.write(text)
