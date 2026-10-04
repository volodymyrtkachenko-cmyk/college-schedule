"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  api,
  SchedulePeriodMutation,
  SchedulePeriodRecord,
  SchedulePeriodSlotMutation,
  SchedulePeriodType,
} from "../../lib/api";
import { invalidateScheduleCache } from "../../lib/hooks";
import { SearchableMultiSelect } from "../SearchableMultiSelect";
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
  const [groups, setGroups] = useState<{ id: number; name: string }[]>([]);
  const [subjects, setSubjects] = useState<{ id: number; name: string }[]>([]);
  const [teachers, setTeachers] = useState<{ id: number; name: string }[]>([]);
  const [draft, setDraft] = useState<PeriodDraft | null>(null);
  const [periodToDelete, setPeriodToDelete] = useState<SchedulePeriodRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

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
        setPeriods(nextPeriods);
        setGroups(nextGroups.filter((item) => !item.disabled).sort((a, b) => a.name.localeCompare(b.name, "uk")));
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
      if (current.period_type === "holiday") {
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
      holiday_all_groups: period.period_type === "holiday" && period.groups.length === 0,
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
      setToast({ message: "Оберіть хоча б одну групу або застосуйте канікули до всіх груп.", type: "error" });
      return;
    }

    const payload: SchedulePeriodMutation = {
      name: draft.name,
      period_type: draft.period_type,
      start_date: draft.start_date,
      end_date: draft.end_date,
      group_ids: draft.period_type === "holiday"
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

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sys-accent">Календар</p>
          <h1 className="mt-1 text-xl font-bold">Практики й канікули</h1>
          <p className="mt-1 max-w-2xl text-sm text-sys-text-secondary">
            Практика тимчасово замінює звичайний розклад вибраних груп. Після завершення періоду звичайний розклад відновиться автоматично.
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

      {draft && (
        <div className="fixed inset-0 z-[100] flex items-start sm:items-center justify-center bg-[rgba(5,8,16,0.76)] p-4 sm:p-6 backdrop-blur-sm overflow-y-auto">
        <form onSubmit={savePeriod} className="surface-panel w-full max-w-2xl space-y-5 p-5 sm:p-6 relative mt-10 sm:mt-0 shadow-2xl">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold">{draft.id ? "Редагувати період" : "Новий період"}</h2>
              <p className="mt-1 text-sm text-sys-text-secondary">Період охоплює обидві зазначені дати.</p>
            </div>
            <button type="button" onClick={() => setDraft(null)} className="rounded-lg border border-sys-border px-3 py-2 text-sm text-sys-text-secondary hover:text-sys-text-primary">
              Скасувати
            </button>
          </div>

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
                    holiday_all_groups: period_type === "holiday" && !draft.group_ids.length,
                    slots: period_type === "holiday" ? [] : draft.slots,
                  });
                }}
                className="form-control w-full"
              >
                <option value="practice">Практика</option>
                <option value="holiday">Канікули</option>
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
              <div className="max-w-xl">
                <label className="form-label">Групи, для яких діятиме практика</label>
                <SearchableMultiSelect
                  options={sortedGroups}
                  value={draft.group_ids}
                  onChange={setGroupsForDraft}
                  placeholder="Знайти групу"
                  ariaLabel="Оберіть групи для практики"
                />
              </div>

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
                        <div className="flex items-end xl:col-span-3">
                          <button
                            type="button"
                            disabled={groupSlots.length <= 1}
                            onClick={() => setDraft({ ...draft, slots: draft.slots.filter((item) => item.key !== slot.key) })}
                            className="rounded-lg px-3 py-2 text-sm font-medium text-rose-300 hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            Видалити пару
                          </button>
                        </div>
                      </div>
                    ))}
                    <p className="text-xs text-sys-text-muted">Задані пари повторюватимуться щотижня в межах вибраних дат.</p>
                  </section>
                );
              })}
            </div>
          ) : (
            <div className="space-y-3 rounded-xl border border-sys-border bg-sys-bg/40 p-4">
              <label className="flex items-center gap-3 text-sm font-medium text-sys-text-primary">
                <input
                  type="checkbox"
                  checked={draft.holiday_all_groups}
                  onChange={(event) => setDraft({ ...draft, holiday_all_groups: event.target.checked })}
                  className="h-4 w-4 accent-sys-accent"
                />
                Застосувати канікули до всіх груп
              </label>
              {!draft.holiday_all_groups && (
                <div className="max-w-xl space-y-1">
                  <label className="form-label">Групи, для яких діятимуть канікули</label>
                  <SearchableMultiSelect
                    options={sortedGroups}
                    value={draft.group_ids}
                    onChange={setGroupsForDraft}
                    placeholder="Знайти групу"
                    ariaLabel="Оберіть групи для канікул"
                  />
                </div>
              )}
              <p className="text-xs text-sys-text-secondary">
                У вибраних груп розклад буде прихований на цей період. Для інших груп заняття залишаться без змін.
              </p>
            </div>
          )}

          <div className="flex justify-end border-t border-sys-border pt-4">
            <button type="submit" disabled={saving} className="rounded-lg bg-sys-accent px-5 py-2.5 text-sm font-semibold text-[#0b1120] disabled:cursor-wait disabled:opacity-60">
              {saving ? "Збереження…" : draft.id ? "Зберегти зміни" : "Створити період"}
            </button>
          </div>
        </form>
        </div>
      )}

      {error ? (
        <p role="alert" className="rounded-xl border border-rose-400/20 bg-rose-400/5 p-5 text-sm text-rose-200">{error}</p>
      ) : loading ? (
        <p className="py-8 text-center text-sm text-sys-text-secondary">Завантаження календаря…</p>
      ) : periods.length ? (
        <div className="grid gap-3">
          {periods.map((period) => {
            const state = periodState(period, today);
            return (
              <article key={period.id} className="surface-panel flex flex-col justify-between gap-4 p-4 sm:flex-row sm:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-semibold text-sys-text-primary">{period.name}</h2>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                      state === "Триває" ? "bg-emerald-500/10 text-emerald-300" : "bg-sys-input text-sys-text-secondary"
                    }`}>{state}</span>
                    <span className="rounded-full bg-sys-accent/10 px-2.5 py-1 text-xs font-semibold text-sys-accent">
                      {period.period_type === "practice" ? "Практика" : "Канікули"}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-sys-text-secondary">{formatDate(period.start_date)} — {formatDate(period.end_date)}</p>
                  {period.period_type === "practice" ? (
                    <p className="mt-1 text-xs text-sys-text-muted">
                      {period.groups.map((group) => group.name).join(", ")} · {formatPairCount(period.slots.length)}
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-sys-text-muted">
                      {period.groups.length ? period.groups.map((group) => group.name).join(", ") : "Усі групи"}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 gap-2">
                  <button type="button" onClick={() => editPeriod(period)} className="rounded-lg border border-sys-border px-3 py-2 text-sm font-medium text-sys-text-secondary hover:text-sys-accent">Редагувати</button>
                  <button type="button" onClick={() => setPeriodToDelete(period)} className="rounded-lg border border-rose-400/20 px-3 py-2 text-sm font-medium text-rose-300 hover:bg-rose-500/10">Видалити</button>
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
