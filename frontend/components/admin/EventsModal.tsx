"use client";

import { useEffect, useState } from "react";
import { AcademicEvent, AcademicEventType, api, ReferenceRecord } from "../../lib/api";
import { SearchableSelect } from "../SearchableSelect";

export function EventsModal({
  defaultGroupId,
  groups,
  subjects: initialSubjects,
  teachers: initialTeachers,
  onClose,
  setToast,
}: {
  defaultGroupId: number | null;
  groups: ReferenceRecord[];
  subjects?: ReferenceRecord[];
  teachers?: ReferenceRecord[];
  onClose: () => void;
  setToast: (msg: string, tone?: "success" | "error") => void;
}) {
  const [groupId, setGroupId] = useState<number | null>(defaultGroupId ?? groups[0]?.id ?? null);
  const [eventType, setEventType] = useState<AcademicEventType>("exam");
  const [subjectId, setSubjectId] = useState<number | null>(null);
  const [teacherId, setTeacherId] = useState<number | null>(null);
  const [customTitle, setCustomTitle] = useState("");
  const [subjects, setSubjects] = useState<ReferenceRecord[]>(initialSubjects ?? []);
  const [teachers, setTeachers] = useState<ReferenceRecord[]>(initialTeachers ?? []);

  useEffect(() => {
    if (!initialSubjects || initialSubjects.length === 0) {
      api.directory.subjects().then(setSubjects).catch(() => {});
    }
  }, [initialSubjects]);

  useEffect(() => {
    if (!initialTeachers || initialTeachers.length === 0) {
      api.directory.teachers().then(setTeachers).catch(() => {});
    }
  }, [initialTeachers]);
  const [eventDate, setEventDate] = useState(
    new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(new Date())
  );
  const [startTime, setStartTime] = useState("09:00");
  const [room, setRoom] = useState("");
  const [note, setNote] = useState("");
  const [events, setEvents] = useState<AcademicEvent[]>([]);
  const [saving, setSaving] = useState(false);

  const loadEvents = async (gid: number | null) => {
    if (!gid) return;
    try {
      const list = await api.events.list({ group_id: gid });
      setEvents(list);
    } catch {
      setEvents([]);
    }
  };

  useEffect(() => {
    void loadEvents(groupId);
  }, [groupId]);

  const handleCreate = async () => {
    if (!groupId) return;
    if (!subjectId && !customTitle.trim()) {
      setToast("Оберіть предмет або введіть назву події", "error");
      return;
    }
    setSaving(true);
    try {
      await api.events.create({
        group_id: groupId,
        subject_id: subjectId,
        teacher_id: teacherId,
        title: customTitle.trim() || null,
        event_type: eventType,
        event_date: eventDate,
        start_time: startTime,
        room: room.trim() || null,
        note: note.trim() || null,
      });
      setCustomTitle("");
      setNote("");
      await loadEvents(groupId);
      setToast("Подію додано", "success");
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Не вдалося створити подію", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await api.events.remove(id);
      setEvents((prev) => prev.filter((item) => item.id !== id));
      setToast("Подію видалено", "success");
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Помилка видалення", "error");
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-sys-border bg-sys-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-sys-border px-6 py-4">
          <h3 className="text-lg font-bold text-sys-text-primary">📅 Розклад сесії та спеціальних подій</h3>
          <button type="button" onClick={onClose} className="text-sm text-sys-text-secondary hover:text-white">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs text-sys-text-secondary">Група</span>
              <SearchableSelect
                options={groups}
                value={groupId}
                onChange={(id) => setGroupId(id)}
                placeholder="Оберіть групу"
                ariaLabel="Група"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-sys-text-secondary">Тип події</span>
              <select
                value={eventType}
                onChange={(e) => setEventType(e.target.value as AcademicEventType)}
                className="form-control w-full text-sm"
              >
                <option value="exam">📝 Екзамен</option>
                <option value="consultation">💬 Консультація</option>
                <option value="credit">✅ Залік</option>
                <option value="defense">🎓 Захист курсової / практики</option>
                <option value="general">📌 Інша подія</option>
              </select>
            </label>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs text-sys-text-secondary">Предмет (з довідника)</span>
              <SearchableSelect
                options={subjects}
                value={subjectId}
                onChange={(id) => setSubjectId(id)}
                placeholder="Оберіть предмет..."
                emptyLabel="Власна назва"
                ariaLabel="Предмет"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-sys-text-secondary">Викладач</span>
              <SearchableSelect
                options={teachers}
                value={teacherId}
                onChange={(id) => setTeacherId(id)}
                placeholder="Оберіть викладача..."
                emptyLabel="Без викладача"
                ariaLabel="Викладач"
              />
            </label>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <label className="space-y-1">
              <span className="text-xs text-sys-text-secondary">Дата</span>
              <input
                type="date"
                value={eventDate}
                onChange={(e) => setEventDate(e.target.value)}
                className="form-control w-full text-sm"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-sys-text-secondary">Час початку</span>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="form-control w-full text-sm"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-sys-text-secondary">Аудиторія</span>
              <input
                type="text"
                value={room}
                onChange={(e) => setRoom(e.target.value)}
                placeholder="напр. 303"
                className="form-control w-full text-sm"
              />
            </label>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input
              type="text"
              value={customTitle}
              onChange={(e) => setCustomTitle(e.target.value)}
              placeholder="Власна назва (якщо не з довідника)..."
              className="form-control text-sm"
            />
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Примітка (напр. принести заліковку)..."
              className="form-control text-sm"
            />
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              disabled={saving || !groupId}
              onClick={() => void handleCreate()}
              className="rounded-lg bg-sys-accent px-4 py-2 text-xs font-bold text-[#0b1120] hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "Додаємо..." : "+ Додати подію"}
            </button>
          </div>

          <div className="border-t border-sys-border pt-4">
            <h4 className="mb-2 text-xs font-semibold uppercase text-sys-text-muted">
              Призначені події групи ({events.length})
            </h4>
            {events.length === 0 ? (
              <p className="text-xs text-sys-text-secondary">Подій для цієї групи ще немає.</p>
            ) : (
              <div className="space-y-2">
                {events.map((ev) => (
                  <div
                    key={ev.id}
                    className="flex items-center justify-between rounded-xl border border-sys-border bg-sys-bg/50 px-3 py-2 text-xs"
                  >
                    <div>
                      <span className="font-bold text-white">{ev.event_date} о {ev.start_time}</span>
                      {" — "}
                      <span className="text-sys-accent font-semibold">{ev.title}</span>
                      {ev.room && <span className="text-sys-text-secondary"> (ауд. {ev.room})</span>}
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleDelete(ev.id)}
                      className="text-rose-400 hover:text-rose-300 font-semibold"
                    >
                      Видалити
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
