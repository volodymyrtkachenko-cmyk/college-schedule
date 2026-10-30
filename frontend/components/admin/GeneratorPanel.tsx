"use client";

import { useEffect, useState } from "react";
import {
  api,
  DraftRecord,
  DraftSlotRecord,
  DraftSubstitutionRecord,
  GeneratorPriorities,
  GeneratorSettings,
} from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { ConfirmModal } from "./ConfirmModal";
import { SearchableSelect } from "../SearchableSelect";
import { formatLessonCount, formatTeacherName } from "../../lib/format";
import { useToast } from "../ToastProvider";
import { PageHeader } from "./PageHeader";

const draftStatusLabels: Record<string, string> = {
  DRAFT: "Чернетка",
  GENERATING: "Створюється",
  pending: "Імпорт на розгляді",
  published: "Опубліковано",
  FAILED: "Помилка",
  TIMEOUT: "Час вичерпано",
  INFEASIBLE: "Несумісні обмеження",
};

const DEFAULT_GENERATOR_SETTINGS: GeneratorSettings = {
  max_time_seconds: 600,
  optimization_time_seconds: 60,
  hint_mode: "previous",
  priorities: {
    teacher_windows: 2,
    late_start: 2,
    three_consecutive_days: 2,
    subject_week_balance: 2,
    group_week_balance: 2,
    soft_teacher_constraints: 2,
  },
};

const PRIORITY_LEVELS: { value: number; label: string; short: string }[] = [
  { value: 0, label: "Вимкнено", short: "Вимк." },
  { value: 1, label: "Низький", short: "Низьк." },
  { value: 2, label: "Звичайний", short: "Звич." },
  { value: 3, label: "Високий", short: "Висок." },
  { value: 4, label: "Максимальний", short: "Макс." },
];

const CRITERIA_CONFIG: {
  key: keyof GeneratorPriorities;
  label: string;
  description: string;
}[] = [
  {
    key: "teacher_windows",
    label: "Мінімізація вікон викладачів",
    description: "Уникати порожніх пар між заняттями викладача протягом одного дня",
  },
  {
    key: "soft_teacher_constraints",
    label: "М’які побажання викладачів",
    description: "Уникати пар у слотах, позначених як «Небажано» в матриці доступності",
  },
  {
    key: "late_start",
    label: "Початок занять з 1-ї пари",
    description: "Надавати перевагу розкладу груп з 1-ї пари замість 2–4 пар",
  },
  {
    key: "three_consecutive_days",
    label: "Без предмета 3 дні поспіль",
    description: "Рівномірно розподіляти предмет протягом тижня замість трьох днів підряд",
  },
  {
    key: "subject_week_balance",
    label: "Баланс предмета між тижнями",
    description: "Вирівнювати кількість пар кожного предмета між чисельником і знаменником",
  },
  {
    key: "group_week_balance",
    label: "Баланс тижневого навантаження групи",
    description: "Однакове загальне навантаження групи в чисельнику та знаменнику",
  },
];

const GENERATION_STAGES = [
  { label: "Аналіз навантаження та груп", detail: "Зчитування годин, потоків і підгруп" },
  { label: "Перевірка обмежень викладачів", detail: "Врахування зайнятості та кураторських годин" },
  { label: "Математичний CP-SAT пошук", detail: "Паралельний портфельний розрахунок розкладу" },
  { label: "Оптимізація вікон і пар", detail: "Мінімізація розривів та вирівнювання занять" },
];

function formatTimer(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function formatDurationShort(sec: number): string {
  if (sec < 60) return `${sec} с`;
  const m = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem === 0 ? `${m} хв` : `${m} хв ${rem} с`;
}

export function GeneratorPanel() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [drafts, setDrafts] = useState<DraftRecord[]>([]);
  const [versions, setVersions] = useState<import("../../lib/api").ScheduleVersion[]>([]);
  const [targetVersionId, setTargetVersionId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [generatingJob, setGeneratingJob] = useState<{ id: number; startedAt: number } | null>(null);
  const [showGenModal, setShowGenModal] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [savedSettings, setSavedSettings] = useState<GeneratorSettings>(DEFAULT_GENERATOR_SETTINGS);
  const [formSettings, setFormSettings] = useState<GeneratorSettings>(DEFAULT_GENERATOR_SETTINGS);
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  
  const [activeDraft, setActiveDraft] = useState<DraftRecord | null>(null);
  const [bellTimes, setBellTimes] = useState<Record<number, string>>({1:"09:00–10:20", 2:"10:40–12:00", 3:"12:30–13:50", 4:"14:00–15:20"});
  const [slots, setSlots] = useState<DraftSlotRecord[]>([]);
  const [subs, setSubs] = useState<DraftSubstitutionRecord[]>([]);
  const [filterMode, setFilterMode] = useState<"group" | "teacher">("group");
  const [filterGroupId, setFilterGroupId] = useState<number | null>(null);
  const [filterTeacherId, setFilterTeacherId] = useState<number | null>(null);
  const [activeWeek, setActiveWeek] = useState<"numerator" | "denominator">("numerator");
  const [selectedSlotId, setSelectedSlotId] = useState<number | null>(null);
  const [draftToDelete, setDraftToDelete] = useState<DraftRecord | null>(null);
  const [publishingId, setPublishingId] = useState<number | null>(null);
  const [moving, setMoving] = useState(false);
  const [draftToPublish, setDraftToPublish] = useState<DraftRecord | null>(null);
  const [publishTargetVersionId, setPublishTargetVersionId] = useState<number | null>(null);
  
  const { showToast: setToast } = useToast();

  const generatingDraft = drafts.find((d) => d.status === "GENERATING");
  const isGeneratingActive = generating || generatingDraft !== undefined;
  const hasUnsavedChanges = JSON.stringify(formSettings) !== JSON.stringify(savedSettings);

  useEffect(() => {
    loadDrafts(true);
  }, []);

  useEffect(() => {
    if (!isGeneratingActive) {
      setElapsed(0);
      return;
    }
    const timer = setInterval(() => {
      setElapsed((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [isGeneratingActive]);

  useEffect(() => {
    if (!isGeneratingActive || showGenModal) return;
    const interval = setInterval(() => {
      loadDrafts(false);
    }, 6000);
    return () => clearInterval(interval);
  }, [isGeneratingActive, showGenModal]);

  async function loadDrafts(includeSettings: boolean = false) {
    try {
      const session = await api.auth.ensureAuthenticated();
      const [res, versionsRes, settingsRes] = await Promise.all([
        api.generator.listDrafts(session.access_token),
        api.scheduleVersions.list(),
        includeSettings
          ? api.generator.getSettings(session.access_token).catch(() => null)
          : Promise.resolve(null),
      ]);
      setVersions(versionsRes);
      if (settingsRes) {
        setSavedSettings(settingsRes);
        setFormSettings(settingsRes);
      }
      // Import reviews have their own workflow and must not appear as generated schedule drafts.
      setDrafts(res.filter(
        (draft) => draft.draft_type !== "import" && !draft.name.startsWith("Імпорт "),
      ));
    } catch(err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveSettings() {
    try {
      setSavingSettings(true);
      const session = await api.auth.ensureAuthenticated();
      const updated = await api.generator.updateSettings(formSettings, session.access_token);
      setSavedSettings(updated);
      setFormSettings(updated);
      setToast("Налаштування генерації збережено в системі.", "success");
    } catch (err: any) {
      setToast(err.message || "Не вдалося зберегти налаштування", "error");
    } finally {
      setSavingSettings(false);
    }
  }

  function handleResetDefaults() {
    setFormSettings(DEFAULT_GENERATOR_SETTINGS);
  }

  function updatePriority(key: keyof GeneratorPriorities, level: number) {
    setFormSettings((prev) => ({
      ...prev,
      priorities: {
        ...prev.priorities,
        [key]: level,
      },
    }));
  }

  async function loadSlots(d: DraftRecord) {
    try {
      setLoading(true);
      const session = await api.auth.ensureAuthenticated();
      const res = await api.generator.getSlots(d.id, session.access_token);
      setSlots(res);
      try {
        setSubs(await api.generator.getSubstitutions(d.id, session.access_token));
      } catch {
        setSubs([]);
      }
      setActiveDraft(d);
      setFilterMode("group");
      setFilterGroupId(null);
      setFilterTeacherId(null);
      setActiveWeek("numerator");
      setSelectedSlotId(null);
    } catch(err: any) {
      setToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerate() {
    try {
      setGenerating(true);
      setShowGenModal(true);
      let session = await api.auth.ensureAuthenticated();
      const job = await api.generator.generate(
        session.access_token,
        formSettings.max_time_seconds,
        formSettings,
      );
      setGeneratingJob({ id: job.id, startedAt: Date.now() });
      const startedAt = Date.now();
      let completed = job;
      let consecutiveErrors = 0;
      const pollTimeoutMs = Math.max(12 * 60 * 1000, (formSettings.max_time_seconds + formSettings.optimization_time_seconds + 60) * 1000);
      while (completed.status === "GENERATING" && Date.now() - startedAt < pollTimeoutMs) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        try {
          const freshSession = await api.auth.ensureAuthenticated().catch(() => session);
          if (freshSession) session = freshSession;
          completed = await api.generator.getDraft(job.id, session.access_token);
          consecutiveErrors = 0;
        } catch (pollErr) {
          consecutiveErrors++;
          // Allow transient network or token refresh pauses without closing modal
          if (consecutiveErrors >= 6) {
            throw pollErr;
          }
        }
      }
      if (completed.status === "TIMEOUT") {
        throw new Error("Не вдалося створити розклад за відведений час. Перевірте навчальне навантаження або збільшіть час пошуку в налаштуваннях.");
      }
      if (completed.status === "INFEASIBLE") {
        throw new Error("Не вдалося узгодити обмеження. Перевірте навчальне навантаження, закріплені заняття й доступність викладачів.");
      }
      if (completed.status === "FAILED") {
        throw new Error("Не вдалося створити розклад. Перевірте дані та спробуйте ще раз.");
      }
      if (completed.status === "GENERATING") {
        throw new Error(`Створення ще триває. Перевірте чернетку №${job.id} трохи пізніше.`);
      }
      if (completed.status !== "DRAFT") {
        throw new Error("Створення не завершилося. Спробуйте ще раз або зверніться до адміністратора.");
      }
      setToast("Розклад створено.", "success");
      setShowGenModal(false);
      setGeneratingJob(null);
      await loadDrafts();
      await loadSlots(completed);
    } catch(err: any) {
      setToast(err.message, "error");
      setShowGenModal(false);
      setGeneratingJob(null);
    } finally {
      setGenerating(false);
    }
  }

  async function handleDelete(id: number) {
    try {
      const session = await api.auth.ensureAuthenticated();
      await api.generator.deleteDraft(id, session.access_token);
      setToast("Розклад видалено.", "success");
      await loadDrafts();
    } catch(err: any) {
      setToast(err.message, "error");
    } finally {
      setDraftToDelete(null);
    }
  }

  async function handleConfirmPublish() {
    if (!draftToPublish) return;
    try {
      setPublishingId(draftToPublish.id);
      const session = await api.auth.ensureAuthenticated();
      await api.generator.publish(
        draftToPublish.id,
        session.access_token,
        publishTargetVersionId || undefined,
        draftToPublish.revision || 1
      );
      setToast("Розклад опубліковано.", "success");
      setDraftToPublish(null);
      await loadDrafts();
    } catch(err: any) {
      setToast(err.message, "error");
    } finally {
      setPublishingId(null);
    }
  }

  async function handleMove(slotId: number, day: number, lesson: number, week: string) {
    if (moving) return;
    try {
      setMoving(true);
      const session = await api.auth.ensureAuthenticated();
      const updated = await api.generator.moveSlot(slotId, day, lesson, week, session.access_token);
      setSlots(curr => curr.map(s => s.id === updated.id ? updated : s));
      setSelectedSlotId(null);
      setToast("Заняття переміщено.", "success");
    } catch(err: any) {
      setToast(err.message, "error");
    } finally {
      setMoving(false);
    }
  }

  if (activeDraft) {
    const days = [1,2,3,4,5];
    const dayNames: Record<number, string> = {1:"Понеділок", 2:"Вівторок", 3:"Середа", 4:"Четвер", 5:"П’ятниця"};
    const lessonTimes = bellTimes;
    const groups = Array.from(new Map(slots.map((slot) => [slot.curriculum.group.id, slot.curriculum.group])).values())
      .sort((a, b) => a.name.localeCompare(b.name, "uk"));
    const teachers = Array.from(new Map(slots.flatMap((slot) => [
      slot.curriculum.teacher,
      ...(slot.curriculum.second_teacher ? [slot.curriculum.second_teacher] : []),
    ]).map((teacher) => [teacher.id, teacher])).values())
      .sort((a, b) => a.name.localeCompare(b.name, "uk"));
    const visibleSlots = slots.filter((slot) =>
      (slot.week_type === activeWeek || slot.week_type === "both") &&
      (filterMode === "group"
        ? filterGroupId === null || slot.curriculum.group.id === filterGroupId
        : filterTeacherId === null || slot.curriculum.teacher.id === filterTeacherId || slot.curriculum.second_teacher?.id === filterTeacherId)
    );
    const visibleSubs = subs.filter((sub) =>
      sub.week_type === activeWeek &&
      (filterMode === "group"
        ? filterGroupId === null || sub.group_id === filterGroupId
        : filterTeacherId === null || sub.teacher_id === filterTeacherId || sub.second_teacher_id === filterTeacherId)
    ).sort((left, right) =>
      left.lesson_number - right.lesson_number ||
      (left.group_name ?? "").localeCompare(right.group_name ?? "", "uk") ||
      left.date.localeCompare(right.date),
    );
    const fmtSubDate = (iso: string) => iso.split("-").reverse().slice(0, 2).join(".");
    const selectedSlot = slots.find((slot) => slot.id === selectedSlotId);
    const selectOptions = (filterMode === "group" ? groups : teachers).map(({ id, name }) => ({ id, name }));
    const canMoveTo = (day: number, lesson: number) => {
      if (!selectedSlot || (selectedSlot.day_of_week === day && selectedSlot.lesson_number === lesson)) return false;

      const movingTeacherIds = new Set([
        selectedSlot.curriculum.teacher.id,
        ...(selectedSlot.curriculum.second_teacher ? [selectedSlot.curriculum.second_teacher.id] : []),
      ]);
      return !slots.some((slot) => {
        if (slot.id === selectedSlot.id || slot.day_of_week !== day || slot.lesson_number !== lesson) return false;
        if (slot.week_type !== "both" && slot.week_type !== activeWeek) return false;
        if (slot.curriculum.group.id === selectedSlot.curriculum.group.id) return true;

        const targetTeacherIds = [
          slot.curriculum.teacher.id,
          ...(slot.curriculum.second_teacher ? [slot.curriculum.second_teacher.id] : []),
        ];
        return targetTeacherIds.some((teacherId) => movingTeacherIds.has(teacherId));
      });
    };
    
    return (
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-4 rounded-2xl border border-sys-border bg-sys-card p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <button onClick={() => setActiveDraft(null)} className="mb-2 text-sm font-medium text-sys-accent hover:underline">← До списку</button>
            <h2 className="truncate text-xl font-bold">{activeDraft.name}</h2>
            <span className="mt-1 inline-block rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-300">
              {draftStatusLabels[activeDraft.status] ?? "Невідомий статус"}
            </span>
          </div>
          <div className="w-full sm:w-72">
            <label className="form-label">{filterMode === "group" ? "Група" : "Викладач"}</label>
            <SearchableSelect
              value={filterMode === "group" ? filterGroupId : filterTeacherId}
              onChange={(id) => filterMode === "group" ? setFilterGroupId(id) : setFilterTeacherId(id)}
              options={selectOptions}
              placeholder={filterMode === "group" ? "Знайти групу" : "Знайти викладача"}
              emptyLabel={filterMode === "group" ? "Усі групи" : "Усі викладачі"}
              ariaLabel={filterMode === "group" ? "Фільтр за групою" : "Фільтр за викладачем"}
            />
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div role="tablist" aria-label="Тип тижня" className="flex w-full rounded-xl border border-sys-border bg-sys-card p-1 sm:w-fit">
            {(["numerator", "denominator"] as const).map((week) => (
              <button
                key={week}
                role="tab"
                aria-selected={activeWeek === week}
                onClick={() => {
                  setActiveWeek(week);
                  setSelectedSlotId(null);
                }}
                className={`flex-1 rounded-lg px-5 py-2 text-sm font-semibold transition-colors sm:flex-none ${
                  activeWeek === week ? "bg-sys-accent text-white shadow-xs" : "text-sys-text-secondary hover:text-sys-text-primary"
                }`}
              >
                {week === "numerator" ? "Чисельник" : "Знаменник"}
              </button>
            ))}
          </div>
          <div role="tablist" aria-label="Показати розклад" className="flex w-full rounded-xl border border-sys-border bg-sys-card p-1 sm:w-fit">
            {(["group", "teacher"] as const).map((mode) => (
              <button
                key={mode}
                role="tab"
                aria-selected={filterMode === mode}
                onClick={() => {
                  setFilterMode(mode);
                  setSelectedSlotId(null);
                }}
                className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition-colors sm:flex-none ${
                  filterMode === mode ? "bg-white/10 text-sys-text-primary" : "text-sys-text-secondary hover:text-sys-text-primary"
                }`}
              >
                {mode === "group" ? "За групами" : "За викладачами"}
              </button>
            ))}
          </div>
        </div>

        {selectedSlot && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sys-accent/40 bg-sys-accent/10 px-4 py-3">
            <p className="text-sm text-sys-text-primary">
            Оберіть зелену клітинку, щоб перемістити заняття <strong>{selectedSlot.curriculum.group.name} · {selectedSlot.curriculum.subject.name}</strong>. Зелені клітинки — вільні місця.
            </p>
            <button type="button" onClick={() => setSelectedSlotId(null)} className="rounded-lg border border-sys-border px-3 py-1.5 text-sm font-medium text-sys-text-secondary hover:text-sys-text-primary">
              Скасувати
            </button>
          </div>
        )}

        <div className="overflow-x-auto rounded-2xl border border-sys-border bg-sys-card/50">
          <div className="grid min-w-[900px] grid-cols-[5.5rem_repeat(5,minmax(10rem,1fr))]">
            <div className="sticky left-0 z-20 border-b border-r border-sys-border bg-sys-card p-3 text-center text-xs font-semibold uppercase text-sys-text-muted">
              Пара
            </div>
            {days.map((day) => (
              <div key={day} className="border-b border-r border-sys-border bg-sys-card px-3 py-3 text-center">
                <h3 className="font-semibold text-sys-text-primary">{dayNames[day]}</h3>
                <span className="text-xs text-sys-text-muted">{formatLessonCount(visibleSlots.filter((slot) => slot.day_of_week === day).length)}</span>
              </div>
            ))}

            {[1, 2, 3, 4].flatMap((lesson) => [
              <div key={`lesson-${lesson}`} className="sticky left-0 z-10 border-b border-r border-sys-border bg-sys-card p-3 text-center">
                <div className="text-lg font-bold text-sys-text-primary">{lesson}</div>
                <div className="text-[10px] text-sys-text-muted">{lessonTimes[lesson]}</div>
              </div>,
              ...days.map((day) => {
                const cellSlots = visibleSlots.filter((slot) => slot.day_of_week === day && slot.lesson_number === lesson);
                const cellSubs = visibleSubs.filter((sub) => sub.day_of_week === day && sub.lesson_number === lesson);
                const canChooseTarget = selectedSlot !== undefined && canMoveTo(day, lesson);
                return (
                  <div
                    key={`${lesson}-${day}`}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      const slotId = Number(event.dataTransfer.getData("slot_id"));
                      if (slotId) void handleMove(slotId, day, lesson, activeWeek);
                    }}
                    className={`min-h-32 border-b border-r border-sys-border p-2 transition-colors ${
                      canChooseTarget ? "bg-emerald-500/[0.08] ring-1 ring-inset ring-emerald-400/40" : "hover:bg-white/[0.02]"
                    }`}
                  >
                    {cellSubs.length > 0 && (
                      <div className="mb-2 space-y-2">
                        {cellSubs.map((sub, i) => (
                          <article key={`sub-${sub.date}-${sub.group_id}-${i}`} className={`relative min-w-0 overflow-hidden rounded-xl border p-3 shadow-sm transition-colors duration-200 ${sub.kind === "cancelled" ? "border-rose-500/40 bg-rose-500/5" : "ring-1 ring-sys-accent/60 !border-sys-accent/40 bg-sys-accent/[0.02]"}`}>
                            <div className="flex flex-wrap items-center justify-between gap-x-2 mb-1">
                              <span className="font-semibold text-sys-text-muted text-xs">
                                {sub.lesson_number}-та пара · {sub.group_name} · {fmtSubDate(sub.date)}
                              </span>
                              <span className={`inline-block px-1.5 py-0.5 text-[0.65rem] font-bold rounded leading-none ${sub.kind === "cancelled" ? "bg-rose-500/20 text-rose-300" : "bg-sys-accent text-white"}`}>
                                {sub.kind === "cancelled" ? "Скасовано" : "Заміна"}
                              </span>
                            </div>
                            {sub.kind === "substitution" && (
                              <>
                                <h3 className="min-w-0 break-words font-medium text-sys-text-subject text-[13px] [overflow-wrap:anywhere]">
                                  {sub.subject_name}
                                </h3>
                                <p className="text-sys-text-secondary break-words [overflow-wrap:anywhere] mt-0.5 text-[12px]">
                                  {[sub.teacher_name ? formatTeacherName(sub.teacher_name) : null, sub.room].filter(Boolean).join(" · ")}
                                </p>
                              </>
                            )}
                          </article>
                        ))}
                      </div>
                    )}
                    {cellSlots.length > 0 && (
                      <div className="space-y-2">
                        {cellSlots.map((slot) => (
                          <article
                            key={slot.id}
                            draggable
                            onDragStart={(event) => event.dataTransfer.setData("slot_id", slot.id.toString())}
                            className={`rounded-lg border bg-sys-card p-2.5 text-sm shadow-sm ${
                              selectedSlotId === slot.id ? "border-sys-accent ring-1 ring-sys-accent" : "border-sys-border"
                            } cursor-grab active:cursor-grabbing`}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-x-2">
                              <span className="font-semibold text-sys-accent">{slot.curriculum.group.name}</span>
                              {slot.week_type === "both" && <span className="rounded bg-sys-accent/10 px-1.5 py-0.5 text-[10px] font-semibold text-sys-accent">Щотижня</span>}
                            </div>
                            <p className="mt-1 font-medium leading-snug text-sys-text-primary">{slot.curriculum.subject.name}</p>
                            <p className="mt-1 break-words text-xs leading-snug text-sys-text-secondary">
                              {[
                                [
                                  formatTeacherName(slot.curriculum.teacher.name),
                                  ...(slot.curriculum.second_teacher ? [formatTeacherName(slot.curriculum.second_teacher.name)] : []),
                                ].join(" / "),
                                slot.room_override || [
                                  slot.curriculum.teacher.room,
                                  slot.curriculum.second_teacher?.room,
                                ].filter(Boolean).join(" / "),
                              ].filter(Boolean).join(" · ")}
                            </p>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelectedSlotId(selectedSlotId === slot.id ? null : slot.id);
                              }}
                              className="mt-2 rounded-md border border-sys-border px-2 py-1 text-xs font-medium text-sys-text-secondary transition-colors hover:border-sys-accent/50 hover:text-sys-accent"
                            >
                              {selectedSlotId === slot.id ? "Обрано для переміщення" : "Перемістити"}
                            </button>
                          </article>
                        ))}
                      </div>
                    )}
                    {canChooseTarget ? (
                      <button
                        type="button"
                        aria-label={`Перемістити пару на ${dayNames[day]}, ${lesson}-ту пару`}
                        onClick={() => {
                          if (selectedSlot && !moving) void handleMove(selectedSlot.id, day, lesson, activeWeek);
                        }}
                        disabled={moving} className="mt-2 flex min-h-10 w-full items-center justify-center rounded-lg border border-emerald-400/40 bg-emerald-500/10 px-2 py-2 text-xs font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
                      >
                        Перемістити сюди
                      </button>
                    ) : cellSlots.length === 0 && cellSubs.length === 0 ? (
                      <div className="flex min-h-28 items-center justify-center text-xs text-sys-text-muted">—</div>
                    ) : null}
                  </div>
                );
              }),
            ])}
          </div>
        </div>
        {visibleSlots.length === 0 && (
          <p className="rounded-xl border border-dashed border-sys-border p-6 text-center text-sm text-sys-text-secondary">
            {filterMode === "teacher" && filterTeacherId !== null
              ? "У вибраного викладача немає пар у цьому тижні."
              : filterMode === "group" && filterGroupId !== null
                ? "У вибраної групи немає пар у цьому тижні."
                : "У цьому тижні пар немає."}
          </p>
        )}
        
      </div>
    );
  }

  const activeStageIndex = elapsed < 4 ? 0 : elapsed < 9 ? 1 : elapsed < 28 ? 2 : 3;
  const progressPercent = Math.min(
    95,
    Math.round(
      elapsed < 4
        ? 15 + elapsed * 5
        : elapsed < 9
        ? 35 + (elapsed - 4) * 4
        : elapsed < 28
        ? 55 + (elapsed - 9) * 1.5
        : 83 + Math.min(11, (elapsed - 28) * 0.3)
    )
  );

  return (
    <>
      <PageHeader
        eyebrow="АВТОМАТИЗАЦІЯ"
        title="Генерація розкладу"
        description="Створює чернетку з навчального навантаження, доступності викладачів і практик. Після перевірки її можна опублікувати як розклад."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowSettingsPanel((prev) => !prev)}
              className={`shrink-0 rounded-lg border px-3.5 py-2 text-sm font-semibold transition-all flex items-center gap-2 ${
                showSettingsPanel || hasUnsavedChanges
                  ? "border-sys-accent/50 bg-sys-accent/15 text-sys-accent"
                  : "border-sys-border bg-sys-card text-sys-text-primary hover:bg-slate-100 dark:hover:bg-white/5"
              }`}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
              </svg>
              Налаштування
              {hasUnsavedChanges && (
                <span className="h-2 w-2 rounded-full bg-amber-400" title="Є незбережені зміни" />
              )}
            </button>

            <button
              onClick={handleGenerate}
              disabled={isGeneratingActive}
              className="shrink-0 rounded-lg bg-emerald-600 dark:bg-emerald-500 px-4 py-2 text-sm font-semibold text-white shadow-xs hover:opacity-95 transition-all disabled:opacity-50 disabled:cursor-wait flex items-center gap-2"
            >
              {isGeneratingActive ? (
                <>
                  <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                  Створюємо розклад…
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Створити розклад
                </>
              )}
            </button>
          </div>
        }
      />

      {/* Compact summary strip when settings panel is collapsed */}
      {!showSettingsPanel && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sys-border/70 bg-sys-card/70 px-4 py-2.5 text-xs text-sys-text-secondary">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>
              Режим:{" "}
              <strong className="text-sys-text-primary">
                {formSettings.hint_mode === "previous" ? "На основі попереднього" : "З нуля"}
              </strong>
            </span>
            <span>
              Час пошуку:{" "}
              <strong className="text-sys-text-primary">
                {formatDurationShort(formSettings.max_time_seconds)}
              </strong>
            </span>
            <span>
              Оптимізація якості:{" "}
              <strong className="text-sys-text-primary">
                {formSettings.optimization_time_seconds === 0
                  ? "Вимкнено"
                  : formatDurationShort(formSettings.optimization_time_seconds)}
              </strong>
            </span>
            {hasUnsavedChanges && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-400">
                ● Змінено для наступного запуску
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setShowSettingsPanel(true)}
            className="text-xs font-semibold text-sys-accent hover:underline"
          >
            Змінити параметри →
          </button>
        </div>
      )}

      {/* Expandable Generator Settings Panel */}
      {showSettingsPanel && (
        <div className="surface-panel mt-4 p-4 sm:p-6 space-y-6 animate-in fade-in duration-150">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 border-b border-sys-border/60 pb-4">
            <div>
              <h3 className="text-base font-bold text-sys-text-primary flex items-center gap-2">
                Параметри генерації та оптимізації
                {hasUnsavedChanges && (
                  <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-amber-400 border border-amber-500/30">
                    Не збережено глобально
                  </span>
                )}
              </h3>
              <p className="text-xs text-sys-text-secondary mt-0.5">
                Зміни одразу застосовуються до кнопки «Створити розклад». Адміністратор може зберегти їх як стандартні для всієї системи.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowSettingsPanel(false)}
              className="self-end sm:self-start rounded-lg px-2.5 py-1 text-xs font-semibold text-sys-text-secondary hover:bg-slate-100 dark:hover:bg-white/5 hover:text-sys-text-primary"
            >
              Згорнути ✕
            </button>
          </div>

          {/* Row 1: Strategy & Time Budgets */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Strategy / Hint Mode */}
            <div className="rounded-xl border border-sys-border bg-sys-bg/50 p-3.5 space-y-2">
              <label className="block text-xs font-bold uppercase tracking-wider text-sys-text-secondary">
                Початкова точка пошуку
              </label>
              <div className="grid grid-cols-2 gap-1.5 rounded-lg border border-sys-border bg-sys-card p-1">
                <button
                  type="button"
                  onClick={() => setFormSettings((p) => ({ ...p, hint_mode: "previous" }))}
                  className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition ${
                    formSettings.hint_mode === "previous"
                      ? "bg-sys-accent text-white shadow-xs"
                      : "text-sys-text-secondary hover:text-sys-text-primary"
                  }`}
                >
                  На основі попереднього
                </button>
                <button
                  type="button"
                  onClick={() => setFormSettings((p) => ({ ...p, hint_mode: "fresh" }))}
                  className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition ${
                    formSettings.hint_mode === "fresh"
                      ? "bg-sys-accent text-white shadow-xs"
                      : "text-sys-text-secondary hover:text-sys-text-primary"
                  }`}
                >
                  З нуля
                </button>
              </div>
              <p className="text-[11px] text-sys-text-muted leading-snug">
                {formSettings.hint_mode === "previous"
                  ? "Використовує останню чернетку або діючий розклад як підказку для швидшого пошуку та меншої кількості змін."
                  : "Починає пошук без прив’язки до попереднього розкладу — корисно для пошуку принципово іншого варіанта."}
              </p>
            </div>

            {/* Max Search Time */}
            <div className="rounded-xl border border-sys-border bg-sys-bg/50 p-3.5 space-y-2">
              <label htmlFor="gen-max-time" className="block text-xs font-bold uppercase tracking-wider text-sys-text-secondary">
                Ліміт часу на пошук розкладу
              </label>
              <select
                id="gen-max-time"
                value={formSettings.max_time_seconds}
                onChange={(e) => setFormSettings((p) => ({ ...p, max_time_seconds: Number(e.target.value) }))}
                className="form-control w-full bg-sys-card text-sm font-semibold"
              >
                <option value={120}>2 хвилини (швидка перевірка)</option>
                <option value={300}>5 хвилин</option>
                <option value={600}>10 хвилин (рекомендовано)</option>
                <option value={900}>15 хвилин</option>
                <option value={1200}>20 хвилин</option>
                <option value={1800}>30 хвилин (складне навантаження)</option>
              </select>
              <p className="text-[11px] text-sys-text-muted leading-snug">
                Максимальний час на пошук допустимого розкладу без порушення жорстких обмежень.
              </p>
            </div>

            {/* Optimization Budget */}
            <div className="rounded-xl border border-sys-border bg-sys-bg/50 p-3.5 space-y-2">
              <label htmlFor="gen-opt-time" className="block text-xs font-bold uppercase tracking-wider text-sys-text-secondary">
                Час на покращення якості
              </label>
              <select
                id="gen-opt-time"
                value={formSettings.optimization_time_seconds}
                onChange={(e) => setFormSettings((p) => ({ ...p, optimization_time_seconds: Number(e.target.value) }))}
                className="form-control w-full bg-sys-card text-sm font-semibold"
              >
                <option value={0}>Вимкнено (перший знайдений)</option>
                <option value={15}>15 секунд (швидко)</option>
                <option value={30}>30 секунд</option>
                <option value={60}>1 хвилина (рекомендовано)</option>
                <option value={120}>2 хвилини (глибока оптимізація)</option>
                <option value={300}>5 хвилин (максимальна якість)</option>
              </select>
              <p className="text-[11px] text-sys-text-muted leading-snug">
                Додатковий час після знаходження розкладу для мінімізації вікон, дисбалансу та небажаних пар.
              </p>
            </div>
          </div>

          {/* Row 2: Soft Criteria Priorities */}
          <div className="space-y-3">
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-sys-text-secondary">
                Важливість критеріїв якості (м’які правила)
              </h4>
              <p className="text-xs text-sys-text-muted mt-0.5">
                Визначає, чим генератор жертвуватиме в останню чергу під час оптимізації. «Вимкнено» повністю прибирає критерій.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {CRITERIA_CONFIG.map((item) => {
                const currentLevel = formSettings.priorities[item.key];
                return (
                  <div
                    key={item.key}
                    className="flex flex-col justify-between gap-2.5 rounded-xl border border-sys-border bg-sys-bg/40 p-3.5"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-sys-text-primary">{item.label}</span>
                        <span
                          className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${
                            currentLevel === 0
                              ? "bg-slate-500/15 text-sys-text-muted"
                              : currentLevel >= 3
                              ? "bg-emerald-500/15 text-emerald-400"
                              : "bg-sys-accent/15 text-sys-accent"
                          }`}
                        >
                          {PRIORITY_LEVELS[currentLevel]?.label ?? "Звичайний"}
                        </span>
                      </div>
                      <p className="text-xs text-sys-text-secondary mt-0.5">{item.description}</p>
                    </div>

                    <div
                      role="radiogroup"
                      aria-label={item.label}
                      className="grid grid-cols-5 gap-1 rounded-lg border border-sys-border bg-sys-card p-1"
                    >
                      {PRIORITY_LEVELS.map((lvl) => {
                        const active = currentLevel === lvl.value;
                        return (
                          <button
                            key={lvl.value}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            onClick={() => updatePriority(item.key, lvl.value)}
                            className={`rounded-md py-1 px-1 text-[11px] font-semibold transition ${
                              active
                                ? lvl.value === 0
                                  ? "bg-slate-600 text-white shadow-xs"
                                  : "bg-sys-accent text-white shadow-xs"
                                : "text-sys-text-secondary hover:text-sys-text-primary"
                            }`}
                          >
                            <span className="hidden sm:inline">{lvl.label}</span>
                            <span className="sm:hidden">{lvl.short}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Actions Footer */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-sys-border/60 pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleResetDefaults}
                className="rounded-lg border border-sys-border bg-sys-card px-3 py-1.5 text-xs font-semibold text-sys-text-secondary hover:text-sys-text-primary transition"
              >
                Скинути до стандартних
              </button>
              {hasUnsavedChanges && (
                <button
                  type="button"
                  onClick={() => setFormSettings(savedSettings)}
                  className="rounded-lg border border-sys-border bg-sys-card px-3 py-1.5 text-xs font-semibold text-sys-text-secondary hover:text-sys-text-primary transition"
                >
                  Повернути збережені
                </button>
              )}
            </div>

            {isAdmin && (
              <button
                type="button"
                onClick={handleSaveSettings}
                disabled={savingSettings || !hasUnsavedChanges}
                className="rounded-lg bg-sys-accent px-4 py-2 text-xs font-semibold text-white shadow-xs hover:opacity-95 transition disabled:opacity-40"
              >
                {savingSettings ? "Збереження…" : "Зберегти як стандартні для системи"}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Persistent live banner when generation is active and modal is minimized */}
      {isGeneratingActive && !showGenModal && (
        <div className="relative overflow-hidden rounded-2xl border border-emerald-500/30 bg-gradient-to-r from-emerald-500/10 via-teal-500/10 to-sys-card p-4 shadow-sm animate-in fade-in duration-200 mt-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="relative flex h-3 w-3 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
              </span>
              <div className="min-w-0">
                <div className="font-semibold text-sm text-sys-text-primary flex items-center gap-2 flex-wrap">
                  <span>Створення розкладу #{generatingJob?.id ?? generatingDraft?.id ?? ""}</span>
                  <span className="font-mono text-xs px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-bold">
                    {formatTimer(elapsed)}
                  </span>
                  <span className="text-xs text-sys-text-muted font-normal hidden sm:inline">
                    · {GENERATION_STAGES[activeStageIndex]?.label}
                  </span>
                </div>
                <p className="text-xs text-sys-text-secondary mt-0.5">
                  Математичний солвер шукає оптимальний розклад у фоні на сервері
                </p>
              </div>
            </div>
            <button
              onClick={() => setShowGenModal(true)}
              className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 transition flex items-center justify-center gap-1.5 shrink-0"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
              </svg>
              Показати анімацію
            </button>
          </div>
          <div className="mt-3 relative h-1.5 w-full bg-sys-border/60 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-400 transition-all duration-700 ease-out"
              style={{ width: `${progressPercent}%` }}
            />
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent animate-splash-beam" />
          </div>
        </div>
      )}

      {loading ? (
        <div className="mt-8 text-center text-sys-text-secondary">Завантаження…</div>
      ) : error ? (
        <div className="mt-8 text-center text-rose-500">{error}</div>
      ) : (
        <div className="surface-panel mt-6">
          {/* Desktop Table (>=640px) */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full min-w-[700px] border-collapse text-left text-sm">
              <thead className="bg-slate-100 dark:bg-[#111827] sticky top-0 z-10 border-b border-sys-border">
                <tr>
                  <th className="px-5 py-4 font-semibold text-slate-700 dark:text-sys-text-secondary text-xs uppercase tracking-wider">№</th>
                  <th className="px-5 py-4 font-semibold text-slate-700 dark:text-sys-text-secondary text-xs uppercase tracking-wider">Назва розкладу</th>
                  <th className="px-5 py-4 font-semibold text-slate-700 dark:text-sys-text-secondary text-xs uppercase tracking-wider">Статус</th>
                  <th className="px-5 py-4 font-semibold text-slate-700 dark:text-sys-text-secondary text-right min-w-[200px]">Дії</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-sys-border/50">
                {drafts.map(d => {
                  const gen = d.generation ?? d.data?.generation;
                  return (
                  <tr key={d.id} className="hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors">
                    <td className="px-5 py-3 whitespace-nowrap text-sys-text-muted">#{d.id}</td>
                    <td className="px-5 py-3">
                      <div className="font-semibold text-sys-text-primary">{d.name}</div>
                      {gen && (
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-sys-text-muted">
                          {gen.settings?.hint_mode && (
                            <span>
                              {gen.settings.hint_mode === "fresh" ? "З нуля" : "На основі попереднього"}
                            </span>
                          )}
                          {typeof gen.elapsed_seconds === "number" && gen.elapsed_seconds > 0 && (
                            <span>· {gen.elapsed_seconds} с</span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      {d.status === "GENERATING" ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 animate-pulse shadow-xs">
                          <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                          </span>
                          Створюється…
                        </span>
                      ) : (
                        <span className={`px-2 py-0.5 rounded text-xs font-bold tracking-wider ${
                          d.status === 'published' ? 'bg-emerald-500/10 text-emerald-400' :
                          (d.status === 'DRAFT' || d.status === 'pending') ? 'bg-amber-500/10 text-amber-400' :
                          (d.status === 'FAILED' || d.status === 'TIMEOUT' || d.status === 'INFEASIBLE') ? 'bg-rose-500/10 text-rose-400' :
                          'bg-gray-500/10 text-gray-400'
                        }`}>
                          {draftStatusLabels[d.status] ?? "Невідомий статус"}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {d.status === "GENERATING" ? (
                          <button
                            onClick={() => setShowGenModal(true)}
                            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 transition flex items-center gap-1.5"
                          >
                            <span className="relative flex h-1.5 w-1.5">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                            </span>
                            Прогрес
                          </button>
                        ) : (
                          <button onClick={() => loadSlots(d)} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-sys-accent/10 text-sys-accent hover:bg-sys-accent/20 transition">Переглянути</button>
                        )}
                        {d.status === 'DRAFT' && (
                           <button onClick={() => { setDraftToPublish(d); setPublishTargetVersionId(targetVersionId); }} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 transition">Опублікувати</button>
                        )}
                        {d.status !== 'published' && d.status !== 'GENERATING' && (
                          <button onClick={() => setDraftToDelete(d)} title="Видалити" aria-label="Видалити чернетку" className="p-1.5 rounded-lg text-sys-text-secondary hover:text-rose-400 hover:bg-rose-500/10 transition">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  );
                })}
                {drafts.length === 0 && (
                  <tr>
                     <td colSpan={4} className="px-5 py-8 text-center text-sys-text-secondary">Чернеток ще немає. Створіть розклад, щоб він з’явився тут.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile Card View (<640px) */}
          <div className="sm:hidden space-y-2.5 p-4">
            {drafts.map((d) => {
              const gen = d.generation ?? d.data?.generation;
              return (
              <div key={d.id} className="rounded-xl border border-sys-border bg-sys-card p-4 space-y-3 shadow-xs">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <span className="text-[11px] font-mono text-sys-text-muted">#{d.id}</span>
                    <h4 className="font-semibold text-sm text-sys-text-primary leading-tight mt-0.5">{d.name}</h4>
                    {gen && (
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-sys-text-muted">
                        {gen.settings?.hint_mode && (
                          <span>{gen.settings.hint_mode === "fresh" ? "З нуля" : "На основі попереднього"}</span>
                        )}
                        {typeof gen.elapsed_seconds === "number" && gen.elapsed_seconds > 0 && (
                          <span>· {gen.elapsed_seconds} с</span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {d.status === "GENERATING" ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold tracking-wider bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 animate-pulse">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
                        Створюється…
                      </span>
                    ) : (
                      <span className={`px-2 py-0.5 rounded text-[11px] font-bold tracking-wider ${
                        d.status === 'published' ? 'bg-emerald-500/10 text-emerald-400' :
                        (d.status === 'DRAFT' || d.status === 'pending') ? 'bg-amber-500/10 text-amber-400' :
                        (d.status === 'FAILED' || d.status === 'TIMEOUT' || d.status === 'INFEASIBLE') ? 'bg-rose-500/10 text-rose-400' :
                        'bg-gray-500/10 text-gray-400'
                      }`}>
                        {draftStatusLabels[d.status] ?? "Невідомий статус"}
                      </span>
                    )}
                    {d.status !== 'published' && d.status !== 'GENERATING' && (
                      <button
                        onClick={() => setDraftToDelete(d)}
                        title="Видалити"
                        aria-label="Видалити чернетку"
                        className="w-8 h-8 flex items-center justify-center rounded-lg text-sys-text-secondary hover:text-rose-400 hover:bg-rose-500/10 transition"
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-sys-border/40">
                  {d.status === "GENERATING" ? (
                    <button
                      onClick={() => setShowGenModal(true)}
                      className="flex-1 min-h-[44px] px-3 py-2 text-xs font-semibold rounded-lg bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 transition flex items-center justify-center gap-2"
                    >
                      <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
                      Переглянути анімацію
                    </button>
                  ) : (
                    <button
                      onClick={() => loadSlots(d)}
                      className="flex-1 min-h-[44px] px-3 py-2 text-xs font-semibold rounded-lg bg-sys-accent/10 text-sys-accent hover:bg-sys-accent/20 transition flex items-center justify-center"
                    >
                      Переглянути
                    </button>
                  )}
                  {d.status === 'DRAFT' && (
                    <button
                      onClick={() => { setDraftToPublish(d); setPublishTargetVersionId(targetVersionId); }}
                      className="flex-1 min-h-[44px] px-3 py-2 text-xs font-semibold rounded-lg bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 transition flex items-center justify-center"
                    >
                      Опублікувати
                    </button>
                  )}
                </div>
              </div>
              );
            })}
            {drafts.length === 0 && (
              <div className="py-8 text-center text-sys-text-secondary text-sm">
                Чернеток ще немає. Створіть розклад, щоб він з’явився тут.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Fullscreen Interactive Generation Animation Modal */}
      {showGenModal && isGeneratingActive && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-md animate-in fade-in duration-200"
          role="dialog"
          aria-modal="true"
          aria-label="Генерація розкладу"
        >
          <div className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-sys-border bg-sys-card p-6 shadow-2xl space-y-6 animate-in zoom-in-95 duration-200">
            {/* Ambient background glow orbs */}
            <div className="pointer-events-none absolute -left-20 -top-20 h-56 w-56 rounded-full bg-emerald-500/15 blur-3xl" />
            <div className="pointer-events-none absolute -right-20 -bottom-20 h-56 w-56 rounded-full bg-sys-accent/15 blur-3xl" />

            {/* Header: Title and Close/Minimize */}
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
                  Штучний інтелект & CP-SAT
                </span>
                <h3 className="mt-1.5 text-xl font-bold text-sys-text-primary">
                  Генеруємо розклад
                </h3>
                <p className="text-xs text-sys-text-secondary mt-0.5">
                  Чернетка #{generatingJob?.id ?? generatingDraft?.id ?? ""} · Автоматичний розподіл занять
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowGenModal(false)}
                title="Згорнути у фон"
                className="rounded-lg px-2.5 py-1 text-sys-text-secondary hover:bg-white/5 hover:text-sys-text-primary transition-colors text-xs font-semibold flex items-center gap-1 border border-sys-border/50"
              >
                Згорнути ✕
              </button>
            </div>

            {/* Central Orbital Animation */}
            <div className="py-2 flex flex-col items-center justify-center">
              <div className="relative flex h-28 w-28 items-center justify-center">
                {/* Outer glowing pulsing aura */}
                <div className="absolute inset-0 rounded-full bg-emerald-500/20 blur-xl animate-pulse" />
                
                {/* Outer spinning dashed ring */}
                <div className="absolute inset-0 rounded-full border-2 border-dashed border-emerald-400/40 animate-[spin_12s_linear_infinite]" />
                
                {/* Middle counter-rotating dotted ring */}
                <div className="absolute inset-2.5 rounded-full border border-teal-400/30 border-t-teal-400 animate-[spin_6s_linear_infinite_reverse]" />
                
                {/* Radiating ping wave */}
                <div className="absolute inset-4 rounded-full border border-emerald-400/40 animate-ping opacity-25" />
                
                {/* Center glowing crystal badge with Calendar icon */}
                <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-tr from-emerald-600 via-teal-500 to-cyan-400 text-white shadow-lg shadow-emerald-500/30">
                  <svg className="h-8 w-8 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
              </div>

              {/* Timer badge */}
              <div className="mt-4 flex items-center gap-2">
                <span className="font-mono text-sm font-bold text-emerald-400 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/25 flex items-center gap-2 shadow-xs">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                  {formatTimer(elapsed)}
                </span>
                <span className="text-xs text-sys-text-muted">триває оптимізація</span>
              </div>
            </div>

            {/* Sleek Animated Progress Bar */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-sys-text-secondary">
                <span>Прогрес генерації</span>
                <span className="font-mono font-semibold text-emerald-400">{progressPercent}%</span>
              </div>
              <div className="relative h-2 w-full overflow-hidden rounded-full bg-slate-800 dark:bg-slate-900">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-400 transition-all duration-700 ease-out"
                  style={{ width: `${progressPercent}%` }}
                />
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent animate-splash-beam" />
              </div>
            </div>

            {/* Stages Checklist */}
            <div className="space-y-2 rounded-xl border border-sys-border/60 bg-sys-bg/60 p-3.5">
              {GENERATION_STAGES.map((st, idx) => {
                const isDone = idx < activeStageIndex;
                const isCurrent = idx === activeStageIndex;
                return (
                  <div
                    key={idx}
                    className={`flex items-start gap-3 rounded-lg p-2 transition-colors ${
                      isCurrent
                        ? "bg-emerald-500/10 border border-emerald-500/20"
                        : "opacity-75"
                    }`}
                  >
                    <div className="mt-0.5 shrink-0">
                      {isDone ? (
                        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-slate-950">
                          <svg className="h-3.5 w-3.5 stroke-[3]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                      ) : isCurrent ? (
                        <div className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-emerald-400 border-t-transparent animate-spin" />
                      ) : (
                        <div className="flex h-5 w-5 items-center justify-center rounded-full border border-sys-border text-sys-text-muted text-[10px]">
                          {idx + 1}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={`text-xs font-semibold leading-tight ${isCurrent ? "text-emerald-400" : isDone ? "text-sys-text-primary" : "text-sys-text-muted"}`}>
                        {st.label}
                      </p>
                      <p className="text-[11px] text-sys-text-secondary mt-0.5 leading-snug">
                        {st.detail}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Note & Action */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-1 border-t border-sys-border/40">
              <p className="text-[11px] text-sys-text-muted leading-tight text-center sm:text-left">
                ⚡ Процес ізольований і не навантажує вебсервер. Можна безпечно згорнути вікно.
              </p>
              <button
                type="button"
                onClick={() => setShowGenModal(false)}
                className="w-full sm:w-auto shrink-0 px-4 py-2 rounded-lg text-xs font-semibold border border-sys-border bg-sys-card hover:bg-white/5 text-sys-text-primary transition-colors"
              >
                Працювати у фоні
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Publish Modal with Target Version Choice */}
      {draftToPublish && (
        <div
          className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDraftToPublish(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Опублікувати розклад"
            className="flex max-h-[92dvh] w-full max-w-md flex-col rounded-t-2xl sm:rounded-2xl border border-sys-border bg-sys-card shadow-2xl overflow-hidden pb-safe animate-in slide-in-from-bottom-4 duration-200"
          >
            <div className="flex items-center justify-between border-b border-sys-border/50 bg-sys-card px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                </div>
                <div>
                  <h3 className="text-base font-bold text-sys-text-primary">Опублікувати розклад</h3>
                  <p className="text-xs text-sys-text-secondary mt-0.5">Чернетка «{draftToPublish.name}»</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDraftToPublish(null)}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-sys-text-secondary hover:bg-slate-100 dark:hover:bg-white/5 hover:text-sys-text-primary text-base transition-colors"
              >
                ✕
              </button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto">
              <p className="text-sm text-sys-text-secondary">
                Цей розклад буде записано як діючий для обраної версії. Всі поточні заняття у вибраній версії буде оновлено.
              </p>

              <div>
                <label className="form-label text-sys-text-secondary mb-1">
                  Цільова версія розкладу:
                </label>
                <select
                  value={publishTargetVersionId || ""}
                  onChange={(e) => setPublishTargetVersionId(e.target.value ? Number(e.target.value) : null)}
                  className="form-control w-full bg-sys-bg text-sm"
                >
                  <option value="">Поточна активна версія</option>
                  {versions.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} {v.is_active ? "(діє зараз)" : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2.5 border-t border-sys-border/50 bg-sys-bg/80 px-5 py-3.5">
              <button
                type="button"
                onClick={() => setDraftToPublish(null)}
                className="w-full sm:w-auto min-h-[44px] sm:min-h-[40px] rounded-lg border border-sys-border bg-sys-card px-4 py-2 text-sm font-semibold text-sys-text-primary hover:bg-slate-100 dark:hover:bg-white/5 transition-all"
              >
                Скасувати
              </button>
              <button
                type="button"
                onClick={handleConfirmPublish}
                disabled={publishingId === draftToPublish.id}
                className="w-full sm:w-auto min-h-[44px] sm:min-h-[40px] flex items-center justify-center gap-2 rounded-lg bg-emerald-500 px-6 py-2 text-sm font-semibold text-white shadow-xs hover:opacity-95 disabled:opacity-50 transition-all"
              >
                {publishingId === draftToPublish.id ? "Публікація..." : "Опублікувати розклад"}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={draftToDelete !== null}
        title="Видалити розклад?"
        message={draftToDelete ? `Розклад «${draftToDelete.name}» і всі заняття в ньому буде видалено без можливості відновлення.` : undefined}
        onConfirm={() => {
          if (draftToDelete) void handleDelete(draftToDelete.id);
        }}
        onCancel={() => setDraftToDelete(null)}
      />
    </>
  );
}


