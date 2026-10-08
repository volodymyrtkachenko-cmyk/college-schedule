"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  api,
  SchedulePeriodMutation,
  SchedulePeriodRecord,
  SchedulePeriodSlotMutation,
  SchedulePeriodType,
  ReferenceRecord,
} from "../../lib/api";
import { invalidateScheduleCache } from "../../lib/hooks";
import { SearchableSelect } from "../SearchableSelect";
import { ConfirmModal } from "./ConfirmModal";

type SlotDraft = SchedulePeriodSlotMutation & { key: string };
type PeriodDraft = {
  id?: number;
  name: string;
  period_type: SchedulePeriodType;
  start_date: string;
  end_date: string;
  group_ids: number[];
  holiday_all_groups: boolean;
  slots: SlotDraft[];
};

const weekdays = [
  { id: 1, name: "Понеділок" },
  { id: 2, name: "Вівторок" },
  { id: 3, name: "Середа" },
  { id: 4, name: "Четвер" },
  { id: 5, name: "П’ятниця" },
];

function localDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const periodTypeLabels: Record<SchedulePeriodType, string> = {
  theory: "Теоретичне навчання",
  practice: "Практика",
  holiday: "Канікули",
  session: "Екзаменаційна сесія",
  diploma: "Дипломне проєктування",
  attestation: "Атестація",
};

function blankSlot(group_id: number): SlotDraft {
  return {
    key: `${Date.now()}-${Math.random()}`,
    group_id,
    subject_id: 0,
    teacher_id: 0,
    second_teacher_id: null,
    day_of_week: 1,
    lesson_number: 1,
    room_override: null,
  };
}

function blankPeriod(): PeriodDraft {
  const start = new Date();
  const end = new Date(start);
  end.setDate(end.getDate() + 13);
  return {
    name: "",
    period_type: "practice",
    start_date: localDate(start),
    end_date: localDate(end),
    group_ids: [],
    holiday_all_groups: false,
    slots: [],
  };
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("uk-UA", { day: "numeric", month: "long", year: "numeric" })
    .format(new Date(`${value}T12:00:00`));
}

function periodState(period: SchedulePeriodRecord, today: string) {
  if (period.end_date < today) return "Завершено";
  if (period.start_date > today) return "Заплановано";
  return "Триває";
}

function formatPairCount(count: number) {
  const remainder10 = count % 10;
  const remainder100 = count % 100;
  const noun = remainder10 === 1 && remainder100 !== 11
    ? "пара"
    : remainder10 >= 2 && remainder10 <= 4 && (remainder100 < 12 || remainder100 > 14)
      ? "пари"
      : "пар";
  return `${count} ${noun} на тиждень`;
}

export function SchedulePeriodsPanel() {
  const [periods, setPeriods] = useState<SchedulePeriodRecord[]>([]);
  const [groups, setGroups] = useState<ReferenceRecord[]>([]);
  const [subjects, setSubjects] = useState<ReferenceRecord[]>([]);
  const [teachers, setTeachers] = useState<ReferenceRecord[]>([]);
  const [draft, setDraft] = useState<PeriodDraft | null>(null);
  const [periodToDelete, setPeriodToDelete] = useState<SchedulePeriodRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  
  // Filters
  const [filterType, setFilterType] = useState<string>("");
  const [filterState, setFilterState] = useState<string>("");

  useEffect(() => {
    async function load() {
      try {
        const session = await api.auth.ensureAuthenticated();
        const [nextPeriods, nextGroups, nextSubjects, nextTeachers] = await Promise.all([
          api.calendarPeriods.list(session.access_token),
          api.directory.groups(),
          api.directory.subjects(),
          api.directory.teachers(),
        ]);
        const sortedPeriods = [...nextPeriods].sort((a, b) => {
          const stateA = periodState(a, today);
          const stateB = periodState(b, today);
          
          const rank = { "Триває": 1, "Заплановано": 2, "Завершено": 3 };
          
          if (rank[stateA] !== rank[stateB]) {
            return rank[stateA] - rank[stateB];
          }
          
          // For planned, closest start date first
          if (stateA === "Заплановано") return a.start_date.localeCompare(b.start_date);
          
          // For completed and ongoing, most recent start date first
          return b.start_date.localeCompare(a.start_date);
        });
        setPeriods(sortedPeriods);
        setGroups(nextGroups.filter((item) => !item.disabled).sort((a, b) => a.name.localeCompare(b.name, "uk", { numeric: true, sensitivity: 'base' })));
        setSubjects(nextSubjects.filter((item) => !item.disabled).sort((a, b) => a.name.localeCompare(b.name, "uk")));
        setTeachers(nextTeachers.filter((item) => !item.disabled).sort((a, b) => a.name.localeCompare(b.name, "uk")));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Не вдалося завантажити календарні періоди.");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(timer);
  }, [toast]);

  function setGroupsForDraft(group_ids: number[]) {
    setDraft((current) => {
      if (!current) return current;
      if (current.period_type !== "practice") {
        return { ...current, group_ids };
      }
      const retained = current.slots.filter((slot) => group_ids.includes(slot.group_id));
      const missing = group_ids.filter((id) => !retained.some((slot) => slot.group_id === id));
      return { ...current, group_ids, slots: [...retained, ...missing.map(blankSlot)] };
    });
  }

  function editPeriod(period: SchedulePeriodRecord) {
    setDraft({
      id: period.id,
      name: period.name,
      period_type: period.period_type,
      start_date: period.start_date,
      end_date: period.end_date,
      group_ids: period.groups.map((group) => group.id),
      holiday_all_groups: period.period_type !== "practice" && period.groups.length === 0,
      slots: period.slots.map((slot) => ({
        key: `slot-${slot.id}`,
        group_id: slot.group_id,
        subject_id: slot.subject_id,
        teacher_id: slot.teacher_id,
        second_teacher_id: slot.second_teacher_id,
        day_of_week: slot.day_of_week,
        lesson_number: slot.lesson_number,
        room_override: slot.room_override,
      })),
    });
  }

  async function savePeriod(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    if (draft.start_date > draft.end_date) {
      setToast({ message: "Дата початку має бути не пізніше дати завершення.", type: "error" });
      return;
    }
    if (draft.period_type === "practice") {
      if (!draft.group_ids.length) {
        setToast({ message: "Оберіть хоча б одну групу для практики.", type: "error" });
        return;
      }
      if (draft.slots.some((slot) => !slot.subject_id || !slot.teacher_id)) {
        setToast({ message: "Для кожної пари оберіть предмет і викладача.", type: "error" });
        return;
      }
      if (draft.group_ids.some((group_id) => !draft.slots.some((slot) => slot.group_id === group_id))) {
        setToast({ message: "Додайте хоча б одну пару для кожної вибраної групи.", type: "error" });
        return;
      }
    } else if (!draft.holiday_all_groups && !draft.group_ids.length) {
      setToast({ message: "Оберіть хоча б одну групу або застосуйте період до всіх груп.", type: "error" });
      return;
    }

    const payload: SchedulePeriodMutation = {
      name: draft.name,
      period_type: draft.period_type,
      start_date: draft.start_date,
      end_date: draft.end_date,
      group_ids: draft.period_type !== "practice"
        ? (draft.holiday_all_groups ? [] : draft.group_ids)
        : draft.group_ids,
      slots: draft.period_type === "practice" ? draft.slots.map(({ key: _key, ...slot }) => slot) : [],
    };
    setSaving(true);
    try {
      const session = await api.auth.ensureAuthenticated();
      const saved = draft.id
        ? await api.calendarPeriods.update(draft.id, payload, session.access_token)
        : await api.calendarPeriods.create(payload, session.access_token);
      setPeriods((current) => [
        saved,
        ...current.filter((item) => item.id !== saved.id),
      ].sort((a, b) => b.start_date.localeCompare(a.start_date)));
      setDraft(null);
      invalidateScheduleCache();
      setToast({ message: "Період збережено.", type: "success" });
    } catch (cause) {
      setToast({ message: cause instanceof Error ? cause.message : "Не вдалося зберегти період.", type: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function deletePeriod() {
    if (!periodToDelete) return;
    try {
      const session = await api.auth.ensureAuthenticated();
      await api.calendarPeriods.remove(periodToDelete.id, session.access_token);
      setPeriods((current) => current.filter((item) => item.id !== periodToDelete.id));
      if (draft?.id === periodToDelete.id) setDraft(null);
      invalidateScheduleCache();
      setToast({ message: "Період видалено.", type: "success" });
    } catch (cause) {
      setToast({ message: cause instanceof Error ? cause.message : "Не вдалося видалити період.", type: "error" });
    } finally {
      setPeriodToDelete(null);
    }
  }

  const today = localDate(new Date());
  const sortedGroups = [...groups];
  const sortedSubjects = [...subjects];
  const sortedTeachers = [...teachers];
  
  const filteredPeriods = periods.filter(p => {
    if (filterType && p.period_type !== filterType) return false;
    if (filterState && periodState(p, today) !== filterState) return false;
    return true;
  });

  const renderGroupSelection = (title: string) => (
    <div className="max-w-2xl space-y-4 mt-4 bg-[#111827]/40 p-4 rounded-xl border border-sys-border/50">
      <div className="flex items-center justify-between">
         <label className="form-label mb-0">{title}</label>
         <button type="button" onClick={() => setGroupsForDraft([])} className="text-[10px] uppercase font-bold px-2 py-1 text-rose-400 border border-rose-400/20 rounded hover:bg-rose-500/10 transition-colors">Очистити все</button>
      </div>
      <div className="space-y-4">
      {[1, 2, 3, 4].map(courseNum => {
         const now = new Date();
         const currentAcademicStartYear = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
         const shortYear = currentAcademicStartYear % 100;
         const entryYear = shortYear - courseNum + 1;
         const courseGroups = sortedGroups.filter(g => g.course === courseNum || (g.course == null && g.name.includes(`-${entryYear}-`)));
         if (courseGroups.length === 0) return null;
         
         const allSelected = courseGroups.every(g => draft?.group_ids.includes(g.id));
         
         return (
           <div key={courseNum} className="space-y-2">
              <div className="flex items-center gap-3 border-b border-sys-border/50 pb-1">
                 <h4 className="text-xs font-semibold text-sys-accent">{courseNum} курс</h4>
                 <button type="button" className="text-[10px] uppercase font-bold px-2 py-0.5 rounded border border-sys-border/50 hover:bg-sys-card transition-colors"
                   onClick={() => {
                     if (!draft) return;
                     if (allSelected) {
                         setGroupsForDraft(draft.group_ids.filter(id => !courseGroups.some(g => g.id === id)));
                     } else {
                         const newIds = new Set([...draft.group_ids, ...courseGroups.map(g => g.id)]);
                         setGroupsForDraft(Array.from(newIds));
                     }
                   }}
                 >{allSelected ? "Зняти всі" : "Вибрати всі"}</button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                 {courseGroups.map(g => (
                   <label key={g.id} className={`flex items-center gap-2 cursor-pointer text-sm border px-3 py-1.5 rounded transition-colors ${draft?.group_ids.includes(g.id) ? "bg-sys-accent/10 border-sys-accent/30 text-sys-accent" : "bg-sys-card border-sys-border hover:bg-sys-card/80"}`}>
                      <input type="checkbox" checked={draft?.group_ids.includes(g.id)} className="accent-sys-accent" onChange={(e) => {
                          if (!draft) return;
                          if (e.target.checked) setGroupsForDraft([...draft.group_ids, g.id]);
                          else setGroupsForDraft(draft.group_ids.filter(id => id !== g.id));
                      }} />
                      <span className="truncate">{g.name}</span>
                   </label>
                 ))}
              </div>
           </div>
         )
      })}
      </div>
    </div>
  );

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sys-accent">Календар</p>
          <h1 className="mt-1 text-xl font-bold">Графік освітнього процесу</h1>
          <p className="mt-1 max-w-2xl text-sm text-sys-text-secondary">
            Управління періодами навчання, сесіями, практиками та канікулами. Нетеоретичні періоди автоматично приховують звичайний розклад.
          </p>
        </div>
        {!draft && (
          <button
            type="button"
            onClick={() => setDraft(blankPeriod())}
            className="rounded-lg bg-sys-accent px-4 py-2.5 text-sm font-semibold text-[#0b1120] transition-opacity hover:opacity-90"
          >
            + Додати період
          </button>
        )}
      </header>

      <div className="flex flex-wrap items-center gap-4 bg-[#111827]/40 p-4 rounded-xl border border-sys-border/50">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-sys-text-secondary">Статус:</span>
          <select className="form-control text-sm py-1.5" value={filterState} onChange={e => setFilterState(e.target.value)}>
            <option value="">Всі статуси</option>
            <option value="Триває">Триває</option>
            <option value="Заплановано">Заплановано</option>
            <option value="Завершено">Завершено</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-sys-text-secondary">Тип періоду:</span>
          <select className="form-control text-sm py-1.5" value={filterType} onChange={e => setFilterType(e.target.value)}>
            <option value="">Всі типи</option>
            <option value="holiday">Канікули</option>
            <option value="session">Екзаменаційна сесія</option>
            <option value="practice">Практика</option>
            <option value="diploma">Дипломне проєктування</option>
            <option value="attestation">Атестація</option>
            <option value="theory">Теоретичне навчання</option>
          </select>
        </div>
        {(filterType || filterState) && (
           <button onClick={() => { setFilterType(""); setFilterState(""); }} className="text-sm text-sys-accent hover:underline">Скинути фільтри</button>
        )}
      </div>

      {draft && (
        <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/60 p-4 sm:p-6 backdrop-blur-sm overflow-y-auto">
        <form onSubmit={savePeriod} className="w-full max-w-2xl rounded-2xl border border-sys-border bg-sys-card shadow-2xl overflow-hidden mt-0 my-auto sm:my-8 relative">
          <div className="bg-gradient-to-b from-white/5 to-transparent p-6 pb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sys-accent/20 text-sys-accent">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/><path d="M8 18h.01"/><path d="M12 18h.01"/><path d="M16 18h.01"/></svg>
              </div>
              <div>
                <h2 className="text-lg font-bold text-sys-text-primary">{draft.id ? "Редагувати період" : "Новий період"}</h2>
                <p className="text-sm text-sys-text-secondary">Період охоплює обидві зазначені дати.</p>
              </div>
            </div>
          </div>
          <div className="px-6 space-y-5 pb-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="form-label">Назва періоду</span>
              <input required maxLength={255} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Наприклад, виробнича практика" className="form-control w-full" />
            </label>
            <label className="space-y-1">
              <span className="form-label">Тип періоду</span>
              <select
                value={draft.period_type}
                onChange={(event) => {
                  const period_type = event.target.value as SchedulePeriodType;
                  setDraft({
                    ...draft,
                    period_type,
                    holiday_all_groups: period_type !== "practice" && !draft.group_ids.length,
                    slots: period_type !== "practice" ? [] : draft.slots,
                  });
                }}
                className="form-control w-full"
              >
                <option value="theory">{periodTypeLabels.theory}</option>
                <option value="practice">{periodTypeLabels.practice}</option>
                <option value="holiday">{periodTypeLabels.holiday}</option>
                <option value="session">{periodTypeLabels.session}</option>
                <option value="diploma">{periodTypeLabels.diploma}</option>
                <option value="attestation">{periodTypeLabels.attestation}</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="form-label">Початок</span>
              <input type="date" required value={draft.start_date} onChange={(event) => setDraft({ ...draft, start_date: event.target.value })} className="form-control w-full" />
            </label>
            <label className="space-y-1">
              <span className="form-label">Завершення</span>
              <input type="date" required value={draft.end_date} onChange={(event) => setDraft({ ...draft, end_date: event.target.value })} className="form-control w-full" />
            </label>
          </div>

          {draft.period_type === "practice" ? (
            <div className="space-y-5 border-t border-sys-border pt-5">
              {renderGroupSelection("Групи, для яких діятиме практика")}

              {draft.group_ids.map((group_id) => {
                const group = groups.find((item) => item.id === group_id);
                const groupSlots = draft.slots.filter((slot) => slot.group_id === group_id);
                return (
                  <section key={group_id} className="space-y-3 rounded-xl border border-sys-border bg-sys-bg/40 p-3 sm:p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="font-semibold text-sys-text-primary">{group?.name ?? "Група"}</h3>
                      <button
                        type="button"
                        onClick={() => setDraft({
                          ...draft,
                          slots: [...draft.slots, blankSlot(group_id)],
                        })}
                        className="rounded-lg border border-sys-accent/40 px-3 py-1.5 text-xs font-semibold text-sys-accent hover:bg-sys-accent/10"
                      >
                        + Додати пару
                      </button>
                    </div>

                    {groupSlots.map((slot) => (
                      <div key={slot.key} className="grid gap-3 rounded-lg border border-sys-border/70 bg-sys-card/60 p-3 sm:grid-cols-2 xl:grid-cols-6">
                        <label className="space-y-1 xl:col-span-2">
                          <span className="form-label">Предмет</span>
                          <SearchableSelect
                            value={slot.subject_id || null}
                            onChange={(id) => setDraft({ ...draft, slots: draft.slots.map((item) => item.key === slot.key ? { ...item, subject_id: id ?? 0 } : item) })}
                            options={sortedSubjects}
                            placeholder="Знайти предмет"
                            emptyLabel="Оберіть предмет"
                            ariaLabel={`Предмет практики для ${group?.name}`}
                          />
                        </label>
                        <label className="space-y-1 xl:col-span-2">
                          <span className="form-label">Викладач</span>
                          <SearchableSelect
                            value={slot.teacher_id || null}
                            onChange={(id) => setDraft({ ...draft, slots: draft.slots.map((item) => item.key === slot.key ? { ...item, teacher_id: id ?? 0 } : item) })}
                            options={sortedTeachers}
                            placeholder="Знайти викладача"
                            emptyLabel="Оберіть викладача"
                            ariaLabel={`Викладач практики для ${group?.name}`}
                          />
                        </label>
                        <label className="space-y-1 xl:col-span-2">
                          <span className="form-label">Другий викладач (необов’язково)</span>
                          <SearchableSelect
                            value={slot.second_teacher_id ?? null}
                            onChange={(id) => setDraft({ ...draft, slots: draft.slots.map((item) => item.key === slot.key ? { ...item, second_teacher_id: id } : item) })}
                            options={sortedTeachers}
                            placeholder="Оберіть другого викладача"
                            emptyLabel="Немає"
                            ariaLabel={`Другий викладач практики для ${group?.name}`}
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="form-label">День</span>
                          <select value={slot.day_of_week} onChange={(event) => setDraft({ ...draft, slots: draft.slots.map((item) => item.key === slot.key ? { ...item, day_of_week: Number(event.target.value) } : item) })} className="form-control w-full">
                            {weekdays.map((day) => <option key={day.id} value={day.id}>{day.name}</option>)}
                          </select>
                        </label>
                        <label className="space-y-1">
                          <span className="form-label">Пара</span>
                          <select value={slot.lesson_number} onChange={(event) => setDraft({ ...draft, slots: draft.slots.map((item) => item.key === slot.key ? { ...item, lesson_number: Number(event.target.value) } : item) })} className="form-control w-full">
                            {[1, 2, 3, 4].map((lesson) => <option key={lesson} value={lesson}>{lesson}-та пара</option>)}
                          </select>
                        </label>
                        <label className="space-y-1">
                          <span className="form-label">Аудиторія</span>
                          <input value={slot.room_override ?? ""} onChange={(event) => setDraft({ ...draft, slots: draft.slots.map((item) => item.key === slot.key ? { ...item, room_override: event.target.value || null } : item) })} placeholder="Необов’язково" className="form-control w-full" />
                        </label>

                      </div>
                    ))}
                    <p className="text-xs text-sys-text-muted">Задані пари повторюватимуться щотижня в межах вибраних дат.</p>
                  </section>
                );
              })}
            </div>
          ) : (
            <div className="space-y-3 rounded-xl border border-sys-border bg-sys-bg/40 p-4">
              <label className="flex items-center gap-3 text-sm font-medium text-sys-text-primary cursor-pointer mb-2">
                <input
                  type="checkbox"
                  checked={draft.holiday_all_groups}
                  onChange={(event) => setDraft({ ...draft, holiday_all_groups: event.target.checked })}
                  className="h-4 w-4 accent-sys-accent"
                />
                Застосувати цей період абсолютно до всіх груп коледжу
              </label>
              {!draft.holiday_all_groups && renderGroupSelection("Групи, для яких діятиме період")}
              <p className="text-xs text-sys-text-secondary">
                У вибраних груп розклад буде прихований на цей період. Для інших груп заняття залишаться без змін.
              </p>
            </div>
          )}

          </div>
          <div className="mt-8 flex justify-end gap-3 border-t border-sys-border bg-sys-bg/30 px-6 py-4">
            <button type="button" onClick={() => setDraft(null)} className="rounded-lg border border-sys-border px-4 py-2 text-sm font-medium text-sys-text-primary hover:bg-sys-bg transition-colors">
              Скасувати
            </button>
            <button type="submit" disabled={saving} className="flex items-center gap-2 rounded-lg bg-sys-accent px-5 py-2 text-sm font-medium text-[#0b1120] hover:opacity-90 disabled:opacity-50 transition-colors">
              {saving ? (
                <>
                  <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                  Збереження...
                </>
              ) : (
                draft.id ? "Зберегти зміни" : "Створити період"
              )}
            </button>
          </div>
        </form>
        </div>
      )}

      {error ? (
        <p role="alert" className="rounded-xl border border-rose-400/20 bg-rose-400/5 p-5 text-sm text-rose-200">{error}</p>
      ) : loading ? (
        <p className="py-8 text-center text-sm text-sys-text-secondary">Завантаження календаря…</p>
      ) : filteredPeriods.length ? (
        <div className="grid gap-3">
          {filteredPeriods.map((period) => {
            const state = periodState(period, today);
            return (
              <article key={period.id} className="surface-panel flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 border-l-4" style={{borderLeftColor: period.period_type === "practice" ? "#fb923c" : period.period_type === "theory" ? "#3b82f6" : period.period_type === "holiday" ? "#22c55e" : "#a855f7"}}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 mb-1.5">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider font-bold ${
                      period.period_type === "practice" ? "bg-orange-500/10 text-orange-400" :
                      period.period_type === "theory" ? "bg-blue-500/10 text-blue-400" :
                      period.period_type === "holiday" ? "bg-green-500/10 text-green-400" :
                      "bg-purple-500/10 text-purple-400"
                    }`}>
                      {periodTypeLabels[period.period_type] || "Інше"}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider font-bold ${
                      state === "Триває" ? "bg-emerald-500/10 text-emerald-400" : state === "Завершено" ? "bg-slate-500/10 text-slate-400" : "bg-blue-500/10 text-blue-400"
                    }`}>
                      {state}
                    </span>
                  </div>
                  
                  <h2 className="text-lg font-bold text-sys-text-primary leading-tight truncate" title={period.name}>
                    {period.name}
                  </h2>
                  <p className="mt-0.5 text-sm font-medium text-sys-text-secondary">
                    {formatDate(period.start_date)} — {formatDate(period.end_date)}
                  </p>
                  
                  <div className="mt-2 text-xs text-sys-text-muted flex items-center gap-1.5 flex-wrap">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-70"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                    <span className="truncate max-w-[200px] sm:max-w-[300px]" title={period.groups.length ? period.groups.map(g => g.name).join(", ") : "Усі групи"}>
                        {period.groups.length ? period.groups.map(g => g.name).join(", ") : "Усі групи"}
                    </span>
                    {period.period_type === "practice" && (
                        <>
                           <span className="opacity-50">•</span>
                           <span>{formatPairCount(period.slots.length)}</span>
                        </>
                    )}
                  </div>
                </div>
                
                <div className="flex sm:flex-col gap-2 shrink-0">
                  <button type="button" onClick={() => editPeriod(period)} className="flex-1 rounded-lg border border-sys-border bg-sys-bg/50 px-3 py-1.5 text-xs font-semibold text-sys-text-primary hover:border-sys-accent hover:text-sys-accent transition-colors">
                    Відкрити
                  </button>
                  <button type="button" onClick={() => setPeriodToDelete(period)} className="flex-1 rounded-lg border border-rose-500/20 bg-rose-500/5 px-3 py-1.5 text-xs font-semibold text-rose-300 hover:bg-rose-500/20 transition-colors">
                    Видалити
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : !draft ? (
        <p className="rounded-xl border border-dashed border-sys-border p-8 text-center text-sm text-sys-text-secondary">
          Календарних періодів ще немає. Додайте практику або канікули, щоб тимчасово змінити розклад на потрібні дати.
        </p>
      ) : null}

      {periodToDelete && (
        <ConfirmModal
          isOpen
          title={`Видалити період «${periodToDelete.name}»?`}
          message="Після видалення календарні дати знову використовуватимуть звичайний розклад."
          onConfirm={() => void deletePeriod()}
          onCancel={() => setPeriodToDelete(null)}
        />
      )}
      {toast && (
        <div role="status" className={`fixed bottom-4 left-4 right-4 z-[200] rounded-xl border px-4 py-3 text-sm shadow-2xl sm:left-auto sm:right-6 sm:w-auto ${
          toast.type === "success"
            ? "border-emerald-500/40 bg-emerald-950/90 text-emerald-200"
            : "border-rose-500/40 bg-rose-950/90 text-rose-200"
        }`}>
          {toast.message}
        </div>
      )}
    </section>
  );
}
