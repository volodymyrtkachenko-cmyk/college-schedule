"use client";

import { useEffect, useState } from "react";
import { AcademicEvent, AcademicEventType, api, ReferenceRecord } from "../../lib/api";
import { SearchableSelect } from "../SearchableSelect";
import { invalidateScheduleCache } from "../../lib/hooks";

const LESSON_START_TIMES: Record<number, string> = {
  1: "09:00",
  2: "10:40",
  3: "12:30",
  4: "14:00",
  5: "15:30",
};

export function EventsModal({
  defaultGroupId,
  groups,
  subjects: initialSubjects,
  teachers: initialTeachers,
  eventToEdit,
  onClose,
  setToast,
  onEventsChanged,
}: {
  defaultGroupId: number | null;
  groups: ReferenceRecord[];
  subjects?: ReferenceRecord[];
  teachers?: ReferenceRecord[];
  eventToEdit?: AcademicEvent | null;
  onClose: () => void;
  setToast: (msg: string, tone?: "success" | "error") => void;
  onEventsChanged?: () => void;
}) {
  const [groupId, setGroupId] = useState<number | null>(
    eventToEdit ? eventToEdit.group_id : (defaultGroupId ?? groups[0]?.id ?? null)
  );
  const [eventType, setEventType] = useState<AcademicEventType>(
    eventToEdit ? eventToEdit.event_type : "exam"
  );
  const [lessonNumber, setLessonNumber] = useState<number | null>(
    eventToEdit !== undefined ? (eventToEdit?.lesson_number ?? null) : 1
  );
  const [subjectId, setSubjectId] = useState<number | null>(
    eventToEdit ? (eventToEdit.subject_id ?? null) : null
  );
  const [customSubject, setCustomSubject] = useState(
    eventToEdit?.custom_subject ?? ""
  );
  const [customTitle, setCustomTitle] = useState(
    eventToEdit?.title ?? ""
  );
  const [teacherId, setTeacherId] = useState<number | null>(
    eventToEdit ? (eventToEdit.teacher_id ?? null) : null
  );
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
    eventToEdit?.event_date ?? new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(new Date())
  );
  const [startTime, setStartTime] = useState(
    eventToEdit?.start_time ?? "09:00"
  );
  const [room, setRoom] = useState(
    eventToEdit?.room ?? ""
  );
  const [note, setNote] = useState(
    eventToEdit?.note ?? ""
  );
  const [events, setEvents] = useState<AcademicEvent[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (eventToEdit) {
      setGroupId(eventToEdit.group_id);
      setEventType(eventToEdit.event_type);
      setLessonNumber(eventToEdit.lesson_number ?? null);
      setSubjectId(eventToEdit.subject_id ?? null);
      setCustomSubject(eventToEdit.custom_subject ?? "");
      setCustomTitle(eventToEdit.title ?? "");
      setTeacherId(eventToEdit.teacher_id ?? null);
      setEventDate(eventToEdit.event_date);
      setStartTime(eventToEdit.start_time);
      setRoom(eventToEdit.room ?? "");
      setNote(eventToEdit.note ?? "");
    }
  }, [eventToEdit]);

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

  const handleLessonNumberChange = (num: number | null) => {
    setLessonNumber(num);
    if (num && LESSON_START_TIMES[num]) {
      setStartTime(LESSON_START_TIMES[num]);
    }
  };

  const handleSave = async () => {
    if (!groupId) return;
    const hasSubject = Boolean(subjectId || customSubject.trim());
    const hasTitle = Boolean(customTitle.trim());
    if (!hasSubject && !hasTitle) {
      setToast("Оберіть предмет, введіть власну назву предмету або назву події", "error");
      return;
    }
    setSaving(true);
    try {
      if (eventToEdit && eventToEdit.id) {
        await api.events.update(eventToEdit.id, {
          group_id: groupId,
          subject_id: subjectId,
          custom_subject: customSubject.trim() || null,
          teacher_id: teacherId,
          title: customTitle.trim() || null,
          event_type: eventType,
          event_date: eventDate,
          lesson_number: lessonNumber,
          start_time: startTime,
          room: room.trim() || null,
          note: note.trim() || null,
        });
        invalidateScheduleCache();
        onEventsChanged?.();
        setToast("Зміни у події збережено", "success");
        onClose();
        return;
      }

      await api.events.create({
        group_id: groupId,
        subject_id: subjectId,
        custom_subject: customSubject.trim() || null,
        teacher_id: teacherId,
        title: customTitle.trim() || null,
        event_type: eventType,
        event_date: eventDate,
        lesson_number: lessonNumber,
        start_time: startTime,
        room: room.trim() || null,
        note: note.trim() || null,
      });
      setCustomTitle("");
      setCustomSubject("");
      setNote("");
      await loadEvents(groupId);
      invalidateScheduleCache();
      onEventsChanged?.();
      setToast("Подію додано та включено в розклад як пару", "success");
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Не вдалося зберегти подію", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await api.events.remove(id);
      setEvents((prev) => prev.filter((item) => item.id !== id));
      invalidateScheduleCache();
      onEventsChanged?.();
      setToast("Подію видалено з розкладу", "success");
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Помилка видалення", "error");
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-sys-border bg-sys-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-sys-border px-6 py-4">
          <div className="flex items-center gap-2">
            <span className="text-xl">📅</span>
            <div>
              <h3 className="text-base font-bold text-sys-text-primary">
                {eventToEdit ? "Редагування події сесії" : "Розклад сесії та спеціальних подій"}
              </h3>
              <p className="text-xs text-sys-text-secondary">Події автоматично відображаються у розкладі як звичайні пари</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-sm text-sys-text-secondary hover:text-white">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Група та тип події */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs font-medium text-sys-text-secondary">Група</span>
              <SearchableSelect
                options={groups}
                value={groupId}
                onChange={(id) => setGroupId(id)}
                placeholder="Оберіть групу"
                ariaLabel="Група"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-sys-text-secondary">Тип події</span>
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

          {/* Номер пари у розкладі */}
          <div className="space-y-1">
            <span className="text-xs font-medium text-sys-text-secondary">Номер пари у розкладі</span>
            <div className="grid grid-cols-6 gap-2">
              {[1, 2, 3, 4, 5].map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => handleLessonNumberChange(num)}
                  className={`rounded-lg border px-2 py-1.5 text-xs font-bold transition-colors ${
                    lessonNumber === num
                      ? "border-sys-accent bg-sys-accent/20 text-sys-accent shadow-xs"
                      : "border-sys-border bg-sys-bg/60 text-sys-text-secondary hover:border-sys-border/80 hover:text-sys-text-primary"
                  }`}
                >
                  {num} пара
                </button>
              ))}
              <button
                type="button"
                onClick={() => handleLessonNumberChange(null)}
                className={`rounded-lg border px-2 py-1.5 text-xs font-semibold transition-colors ${
                  lessonNumber === null
                    ? "border-sys-accent bg-sys-accent/20 text-sys-accent shadow-xs"
                    : "border-sys-border bg-sys-bg/60 text-sys-text-secondary hover:border-sys-border/80 hover:text-sys-text-primary"
                }`}
              >
                Власний
              </button>
            </div>
          </div>

          {/* Предмет з довідника або Власна назва предмету */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs font-medium text-sys-text-secondary">Предмет (з довідника)</span>
              <SearchableSelect
                options={subjects}
                value={subjectId}
                onChange={(id) => {
                  setSubjectId(id);
                  if (id) setCustomSubject("");
                }}
                placeholder="Оберіть предмет..."
                emptyLabel="Власна назва"
                ariaLabel="Предмет"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-sys-text-secondary">Власна назва предмету</span>
              <input
                type="text"
                value={customSubject}
                onChange={(e) => {
                  setCustomSubject(e.target.value);
                  if (e.target.value) setSubjectId(null);
                }}
                placeholder="напр. Основи ШІ або Практика..."
                className="form-control w-full text-sm"
              />
            </label>
          </div>

          {/* Назва події та Викладач */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs font-medium text-sys-text-secondary">Назва події (необов&apos;язково)</span>
              <input
                type="text"
                value={customTitle}
                onChange={(e) => setCustomTitle(e.target.value)}
                placeholder="напр. Консультація перед іспитом..."
                className="form-control w-full text-sm"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-sys-text-secondary">Викладач</span>
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

          {/* Дата, Час, Аудиторія */}
          <div className="grid grid-cols-3 gap-3">
            <label className="space-y-1">
              <span className="text-xs font-medium text-sys-text-secondary">Дата</span>
              <input
                type="date"
                value={eventDate}
                onChange={(e) => setEventDate(e.target.value)}
                className="form-control w-full text-sm"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-sys-text-secondary">Час початку</span>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="form-control w-full text-sm"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-sys-text-secondary">Аудиторія</span>
              <input
                type="text"
                value={room}
                onChange={(e) => setRoom(e.target.value)}
                placeholder="напр. 303"
                className="form-control w-full text-sm"
              />
            </label>
          </div>

          {/* Примітка до події */}
          <div>
            <label className="space-y-1">
              <span className="text-xs font-medium text-sys-text-secondary">Примітка до пари</span>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="напр. Принести заліковку та курсовий проект..."
                className="form-control w-full text-sm"
              />
            </label>
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-sys-border">
            {eventToEdit ? (
              <>
                <button
                  type="button"
                  disabled={saving}
                  onClick={async () => {
                    if (typeof window !== "undefined" && window.confirm("Ви дійсно бажаєте видалити цю подію з розкладу?")) {
                      await handleDelete(eventToEdit.id);
                      onClose();
                    }
                  }}
                  className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3.5 py-2 text-xs font-bold text-rose-400 transition-colors hover:bg-rose-500/20 disabled:opacity-50"
                >
                  Видалити подію
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-lg border border-sys-border px-3.5 py-2 text-xs font-semibold text-sys-text-secondary hover:text-sys-text-primary"
                  >
                    Скасувати
                  </button>
                  <button
                    type="button"
                    disabled={saving || !groupId}
                    onClick={() => void handleSave()}
                    className="rounded-lg bg-sys-accent px-4 py-2 text-xs font-bold text-[#0b1120] shadow-sm transition-all hover:opacity-90 disabled:opacity-50"
                  >
                    {saving ? "Зберігаємо..." : "Зберегти зміни"}
                  </button>
                </div>
              </>
            ) : (
              <div className="flex w-full justify-end">
                <button
                  type="button"
                  disabled={saving || !groupId}
                  onClick={() => void handleSave()}
                  className="rounded-lg bg-sys-accent px-4 py-2 text-xs font-bold text-[#0b1120] shadow-sm transition-all hover:opacity-90 disabled:opacity-50"
                >
                  {saving ? "Додаємо..." : "+ Додати подію у розклад"}
                </button>
              </div>
            )}
          </div>

          {/* Список призначених подій (тільки у режимі створення) */}
          {!eventToEdit && (
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
                      className="flex items-center justify-between rounded-xl border border-sys-border bg-sys-bg/50 px-3.5 py-2.5 text-xs transition-colors hover:border-sys-border/80"
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-white">{ev.event_date}</span>
                          <span className="rounded bg-sys-bg px-1.5 py-0.5 font-mono text-[11px] text-sys-accent">
                            {ev.lesson_number ? `${ev.lesson_number} пара` : ""} {ev.start_time}
                          </span>
                          <span className="font-semibold text-sys-accent">
                            {ev.custom_subject || ev.subject_name || ev.title}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-sys-text-secondary">
                          {ev.title && ev.title !== ev.custom_subject && ev.title !== ev.subject_name && (
                            <span className="italic">{ev.title}</span>
                          )}
                          {ev.teacher_name && <span>• {ev.teacher_name}</span>}
                          {ev.room && <span>• ауд. {ev.room}</span>}
                          {ev.note && <span className="text-amber-300/80">• {ev.note}</span>}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleDelete(ev.id)}
                        className="ml-3 rounded-md px-2 py-1 text-rose-400 transition-colors hover:bg-rose-500/10 hover:text-rose-300 font-semibold"
                      >
                        Видалити
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
