import re

with open("frontend/components/admin/ReferenceForm.tsx", "r") as f:
    text = f.read()

if "SearchableSelect" not in text:
    text = text.replace('import { ReferenceMutation,', 'import { SearchableSelect } from "../SearchableSelect";\nimport { ReferenceMutation,')


old_faculty = """                        <label className="flex flex-col gap-1.5 text-sm text-sys-text-secondary">
                            Спеціальність
                            <select
                                value={value.faculty_id ?? ""}
                                onChange={(e) => setValue({ ...value, faculty_id: e.target.value })}
                                className="rounded-[6px] border-[0.5px] border-sys-border bg-sys-input px-3 py-2 text-sys-text-primary outline-none focus:border-sys-accent transition-colors"
                            >
                                <option value="">Без спеціальності</option>
                                {faculties.map((faculty) => <option key={faculty.id} value={faculty.id}>{faculty.name}</option>)}
                            </select>
                        </label>"""
new_faculty = """                        <div className="flex flex-col gap-1.5 text-sm text-sys-text-secondary">
                            Спеціальність
                            <SearchableSelect
                                options={faculties}
                                value={value.faculty_id ? Number(value.faculty_id) : null}
                                onChange={(id) => setValue({ ...value, faculty_id: id ? String(id) : "" })}
                                placeholder="Без спеціальності"
                            />
                        </div>"""
text = text.replace(old_faculty, new_faculty)

old_curator = """                        <label className="flex flex-col gap-1.5 text-sm text-sys-text-secondary">
                            Куратор
                            <select
                                value={value.curator_id ?? ""}
                                onChange={(e) => setValue({ ...value, curator_id: e.target.value })}
                                className="rounded-[6px] border-[0.5px] border-sys-border bg-sys-input px-3 py-2 text-sys-text-primary outline-none focus:border-sys-accent transition-colors"
                            >
                                <option value="">Без куратора</option>
                                {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                            </select>
                        </label>"""
new_curator = """                        <div className="flex flex-col gap-1.5 text-sm text-sys-text-secondary">
                            Куратор
                            <SearchableSelect
                                options={teachers}
                                value={value.curator_id ? Number(value.curator_id) : null}
                                onChange={(id) => setValue({ ...value, curator_id: id ? String(id) : "" })}
                                placeholder="Без куратора"
                            />
                        </div>"""
text = text.replace(old_curator, new_curator)

with open("frontend/components/admin/ReferenceForm.tsx", "w") as f:
    f.write(text)
