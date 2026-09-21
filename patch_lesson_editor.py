import re

with open("frontend/components/LessonEditor.tsx", "r") as f:
    text = f.read()

# Make sure we import SearchableSelect
if "SearchableSelect" not in text:
    text = text.replace('import { ReferenceRecord } from "../lib/api";', 'import { ReferenceRecord } from "../lib/api";\nimport { SearchableSelect } from "./SearchableSelect";')


old_subject = """          <label className="sm:col-span-2">Предмет
            <select required disabled={loadingDirectories} value={form.subject_id ?? ""} onChange={(e) => update("subject_id", Number(e.target.value) || undefined)}>
              <option value="">{loadingDirectories ? "Завантаження…" : "Оберіть предмет"}</option>
              {subjects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>"""
new_subject = """          <label className="sm:col-span-2">Предмет
            <SearchableSelect
              options={subjects}
              value={form.subject_id ?? null}
              onChange={(id) => update("subject_id", id ?? undefined)}
              disabled={loadingDirectories}
              placeholder={loadingDirectories ? "Завантаження…" : "Пошук предмета..."}
            />
          </label>"""
text = text.replace(old_subject, new_subject)

old_teacher = """          <label>Викладач
            <select disabled={loadingDirectories} value={form.teacher_id ?? ""} onChange={(e) => update("teacher_id", Number(e.target.value) || null)}>
              <option value="">Без викладача</option>
              {teachers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>"""
new_teacher = """          <label>Викладач
            <SearchableSelect
              options={teachers}
              value={form.teacher_id}
              onChange={(id) => update("teacher_id", id)}
              disabled={loadingDirectories}
              placeholder="Пошук викладача..."
            />
          </label>"""
text = text.replace(old_teacher, new_teacher)

old_second_teacher = """          <label>Другий викладач (опційно)
            <select disabled={loadingDirectories} value={form.second_teacher_id ?? ""} onChange={(e) => update("second_teacher_id", Number(e.target.value) || null)}>
              <option value="">Немає</option>
              {teachers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>"""
new_second_teacher = """          <label>Другий викладач (опційно)
            <SearchableSelect
              options={teachers}
              value={form.second_teacher_id}
              onChange={(id) => update("second_teacher_id", id)}
              disabled={loadingDirectories}
              placeholder="Немає"
            />
          </label>"""
text = text.replace(old_second_teacher, new_second_teacher)

old_group = """          {scheduleMode === "teacher" && (
            <label>Група
              <select required value={form.group_id || ""} onChange={(e) => update("group_id", Number(e.target.value))}>
                <option value="">Оберіть групу</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </label>
          )}"""
new_group = """          {scheduleMode === "teacher" && (
            <label>Група
              <SearchableSelect
                options={groups}
                value={form.group_id || null}
                onChange={(id) => update("group_id", id ?? 0)}
                placeholder="Пошук групи..."
              />
            </label>
          )}"""
text = text.replace(old_group, new_group)

with open("frontend/components/LessonEditor.tsx", "w") as f:
    f.write(text)
