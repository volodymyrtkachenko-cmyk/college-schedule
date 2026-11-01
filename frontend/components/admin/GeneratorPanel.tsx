"use client";

import { useEffect, useState } from "react";
import {
  api,
  DraftQualityReport,
  DraftRecord,
  DraftSlotRecord,
  DraftSubstitutionRecord,
  TeacherConstraintRecord,
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

const GENERATION_STAGES = [
  {
    key: "validating",
    label: "Аналіз навантаження та перевірка даних",
    detail: "Зчитування годин, потоків, груп та обмежень викладачів",
  },
  {
    key: "feasibility",
    label: "Пошук допустимого розкладу",
    detail: "Математичний CP-SAT пошук розкладу без конфліктів і накладок",
  },
  {
    key: "optimizing",
    label: "Оптимізація якості розкладу",
    detail: "Усунення «вікон», дисбалансу та врахування побажань викладачів",
  },
  {
    key: "saving",
    label: "Збереження чернетки розкладу",
    detail: "Формування сітки занять та запис чернетки до бази даних",
  },
];

function formatTimer(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
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

  const [activeDraft, setActiveDraft] = useState<DraftRecord | null>(null);
  const [bellTimes, setBellTimes] = useState<Record<number, string>>({1:"09:00–10:20", 2:"10:40–12:00", 3:"12:30–13:50", 4:"14:00–15:20"});
  const [slots, setSlots] = useState<DraftSlotRecord[]>([]);
  const [subs, setSubs] = useState<DraftSubstitutionRecord[]>([]);
  const [teacherConstraints, setTeacherConstraints] = useState<TeacherConstraintRecord[]>([]);
  const [expandedQualityTab, setExpandedQualityTab] = useState<"windows" | "late" | "soft" | null>(null);
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

  const generatingDraft =
    drafts.find((d) => d.status === "GENERATING") ??
    (generatingJob ? drafts.find((d) => d.id === generatingJob.id) : undefined);
  const isGeneratingActive = generating || drafts.some((d) => d.status === "GENERATING");

  useEffect(() => {
    loadDrafts();
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
      loadDrafts();
    }, 1500);
    return () => clearInterval(interval);
  }, [isGeneratingActive, showGenModal]);

  async function loadDrafts() {
    try {
      const session = await api.auth.ensureAuthenticated();
      const [res, versionsRes] = await Promise.all([
        api.generator.listDrafts(session.access_token),
        api.scheduleVersions.list(),
      ]);
      setVersions(versionsRes);
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

  async function loadSlots(d: DraftRecord) {
    try {
      setLoading(true);
      const session = await api.auth.ensureAuthenticated();
      const [res, consRes] = await Promise.all([
        api.generator.getSlots(d.id, session.access_token),
        api.constraints.list(session.access_token).catch(() => [] as TeacherConstraintRecord[]),
      ]);
      setSlots(res);
      setTeacherConstraints(consRes);
      try {
        setSubs(await api.generator.getSubstitutions(d.id, session.access_token));
      } catch {
        setSubs([]);
      }
      setActiveDraft(d);
      setExpandedQualityTab(null);
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
      const job = await api.generator.generate(session.access_token);
      setGeneratingJob({ id: job.id, startedAt: Date.now() });
      setDrafts(prev => [job, ...prev.filter(d => d.id !== job.id)]);
      const startedAt = Date.now();
      let completed = job;
      let consecutiveErrors = 0;
      const pollTimeoutMs = 10 * 60 * 1000;
      while (completed.status === "GENERATING" && Date.now() - startedAt < pollTimeoutMs) {
        await new Promise(resolve => setTimeout(resolve, 750));
        try {
          const freshSession = await api.auth.ensureAuthenticated().catch(() => session);
          if (freshSession) session = freshSession;
          completed = await api.generator.getDraft(job.id, session.access_token);
          setDrafts(prev => {
            const exists = prev.some(d => d.id === completed.id);
            if (exists) return prev.map(d => d.id === completed.id ? completed : d);
            return [completed, ...prev];
          });
          consecutiveErrors = 0;
        } catch (pollErr) {
          consecutiveErrors++;
          // Allow transient network or token refresh pauses without closing modal
          if (consecutiveErrors >= 8) {
            throw pollErr;
          }
        }
      }
      if (completed.status === "TIMEOUT") {
        throw new Error("Не вдалося створити розклад за відведений час. Спробуйте ще раз або перевірте навчальне навантаження.");
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
      await new Promise(resolve => setTimeout(resolve, 450));
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
      const targetSlot = slots.find((s) => s.id === slotId);
      const updated = await api.generator.moveSlot(slotId, day, lesson, week, session.access_token);
      setSlots((curr) =>
        curr.map((s) => {
          if (s.id === updated.id) return updated;
          if (
            targetSlot &&
            targetSlot.curriculum.is_stream &&
            targetSlot.curriculum.stream_id &&
            s.curriculum.is_stream &&
            s.curriculum.stream_id === targetSlot.curriculum.stream_id &&
            s.day_of_week === targetSlot.day_of_week &&
            s.lesson_number === targetSlot.lesson_number &&
            s.week_type === targetSlot.week_type
          ) {
            return { ...s, day_of_week: updated.day_of_week, lesson_number: updated.lesson_number, week_type: updated.week_type };
          }
          return s;
        })
      );
      setSelectedSlotId(null);
      setToast(
        targetSlot?.curriculum.is_stream && targetSlot?.curriculum.stream_id
          ? "Потокове заняття синхронно переміщено."
          : "Заняття переміщено.",
        "success",
      );
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

    // Determine whether a slot has an identical pair in the opposite week ("Щотижня")
    const isSlotWeeklySymmetric = (slot: DraftSlotRecord) => {
      if (slot.week_type === "both") return true;
      const oppositeWeek = slot.week_type === "numerator" ? "denominator" : "numerator";
      return slots.some(
        (other) =>
          other.id !== slot.id &&
          other.curriculum.id === slot.curriculum.id &&
          other.day_of_week === slot.day_of_week &&
          other.lesson_number === slot.lesson_number &&
          (other.week_type === oppositeWeek || other.week_type === "both"),
      );
    };

    // Compute live quality report directly from current draft slots + constraints
    const computeLiveQuality = (): DraftQualityReport => {
      let symmetricCount = 0;
      let pairedTotal = 0;
      const seenPairKeys = new Set<string>();
      for (const s of slots) {
        if (s.curriculum.pairs_per_2_weeks >= 2 && !s.curriculum.require_week) {
          const key = `${s.curriculum.id}:${s.day_of_week}:${s.lesson_number}`;
          if (seenPairKeys.has(key)) continue;
          seenPairKeys.add(key);
          pairedTotal += 1;
          if (isSlotWeeklySymmetric(s)) {
            symmetricCount += 1;
          }
        }
      }
      const symmetry_percent = pairedTotal > 0 ? Math.round((symmetricCount / pairedTotal) * 100) : 100;

      // Group day starts
      const late_starts: DraftQualityReport["late_starts"] = [];
      let totalGroupDays = 0;
      let firstLessonStarts = 0;
      for (const g of groups) {
        for (const w of ["numerator", "denominator"] as const) {
          for (const d of days) {
            const dayLessons = slots
              .filter(
                (s) =>
                  s.curriculum.group.id === g.id &&
                  s.day_of_week === d &&
                  (s.week_type === w || s.week_type === "both"),
              )
              .map((s) => s.lesson_number);
            if (dayLessons.length === 0) continue;
            totalGroupDays += 1;
            const minL = Math.min(...dayLessons);
            if (minL === 1) {
              firstLessonStarts += 1;
            } else {
              late_starts.push({
                group_id: g.id,
                group_name: g.name,
                day_of_week: d,
                week_type: w,
                start_lesson: minL,
              });
            }
          }
        }
      }
      const first_lesson_start_percent =
        totalGroupDays > 0 ? Math.round((firstLessonStarts / totalGroupDays) * 100) : 100;

      // Teacher windows & methodical days
      const teacher_windows: DraftQualityReport["teacher_windows"] = [];
      let methodical_days_count = 0;
      for (const t of teachers) {
        for (const w of ["numerator", "denominator"] as const) {
          for (const d of days) {
            const occupied = Array.from(
              new Set(
                slots
                  .filter(
                    (s) =>
                      s.day_of_week === d &&
                      (s.week_type === w || s.week_type === "both") &&
                      (s.curriculum.teacher.id === t.id || s.curriculum.second_teacher?.id === t.id),
                  )
                  .map((s) => s.lesson_number),
              ),
            ).sort((a, b) => a - b);
            if (occupied.length === 0) {
              methodical_days_count += 1;
              continue;
            }
            if (occupied.length >= 2) {
              const firstL = occupied[0];
              const lastL = occupied[occupied.length - 1];
              const empty: number[] = [];
              for (let l = firstL; l <= lastL; l++) {
                if (!occupied.includes(l)) empty.push(l);
              }
              if (empty.length > 0) {
                teacher_windows.push({
                  teacher_id: t.id,
                  teacher_name: t.name,
                  day_of_week: d,
                  week_type: w,
                  empty_lessons: empty,
                  is_double: empty.length >= 2,
                });
              }
            }
          }
        }
      }

      // Soft constraint violations
      const soft_constraint_violations: DraftQualityReport["soft_constraint_violations"] = [];
      for (const s of slots) {
        const slotTeachers = [
          s.curriculum.teacher,
          ...(s.curriculum.second_teacher ? [s.curriculum.second_teacher] : []),
        ];
        const weeksToCheck: Array<"numerator" | "denominator"> =
          s.week_type === "both" ? ["numerator", "denominator"] : [s.week_type as "numerator" | "denominator"];
        for (const t of slotTeachers) {
          const hitSoft = teacherConstraints.some(
            (con) =>
              !con.is_hard_constraint &&
              con.teacher_id === t.id &&
              con.day_of_week === s.day_of_week &&
              (!con.lesson_number || con.lesson_number === s.lesson_number),
          );
          if (hitSoft) {
            for (const w of weeksToCheck) {
              soft_constraint_violations.push({
                teacher_id: t.id,
                teacher_name: t.name,
                group_id: s.curriculum.group.id,
                group_name: s.curriculum.group.name,
                subject_name: s.curriculum.subject.name,
                day_of_week: s.day_of_week,
                week_type: w,
                lesson_number: s.lesson_number,
              });
            }
          }
        }
      }

      // Shared room conflicts
      const roomMap = new Map<string, { room: string; day: number; week: "numerator" | "denominator"; lesson: number; units: Map<string, string> }>();
      for (const s of slots) {
        const rawRooms = [
          s.room_override,
          s.curriculum.teacher.room,
          s.curriculum.second_teacher?.room,
        ].filter((r): r is string => Boolean(r && r.trim()));
        const unitKey =
          s.curriculum.is_stream && s.curriculum.stream_id
            ? `stream:${s.curriculum.stream_id}`
            : `curr:${s.curriculum.id}`;
        const weeksToCheck: Array<"numerator" | "denominator"> =
          s.week_type === "both" ? ["numerator", "denominator"] : [s.week_type as "numerator" | "denominator"];
        for (const r of rawRooms) {
          const norm = r.trim().toLowerCase();
          if (
            !norm ||
            [
              "—",
              "-",
              "онлайн",
              "online",
              "дистанційно",
              "спортивний комплекс",
              "спорткомплекс",
              "спортзал",
              "спортивна зала",
              "актова зала",
              "читальна зала",
              "стадіон",
              "тир",
              "плац",
            ].includes(norm)
          )
            continue;
          for (const w of weeksToCheck) {
            const key = `${norm}|${w}|${s.day_of_week}|${s.lesson_number}`;
            const existing = roomMap.get(key) ?? {
              room: r.trim(),
              day: s.day_of_week,
              week: w,
              lesson: s.lesson_number,
              units: new Map<string, string>(),
            };
            existing.units.set(unitKey, s.curriculum.group.name);
            roomMap.set(key, existing);
          }
        }
      }
      const room_conflicts: DraftQualityReport["room_conflicts"] = [];
      roomMap.forEach((val) => {
        if (val.units.size > 1) {
          room_conflicts.push({
            room: val.room,
            day_of_week: val.day,
            week_type: val.week,
            lesson_number: val.lesson,
            groups: Array.from(val.units.values()),
          });
        }
      });

      return {
        symmetry_percent,
        first_lesson_start_percent,
        methodical_days_count,
        teacher_windows,
        late_starts,
        soft_constraint_violations,
        room_conflicts,
      };
    };

    const liveQuality = slots.length > 0 ? computeLiveQuality() : (activeDraft.generation?.quality ?? activeDraft.data?.generation?.quality ?? null);

    // Smart evaluation of each cell when moving a selected slot
    const evaluateMoveTarget = (
      day: number,
      lesson: number,
    ): {
      status: "none" | "current" | "ideal" | "warning" | "blocked";
      label?: string;
    } => {
      if (!selectedSlot) return { status: "none" };
      if (selectedSlot.day_of_week === day && selectedSlot.lesson_number === lesson) {
        return { status: "current" };
      }

      // Include synchronized stream peer slots if this is a stream lesson
      const movingSlots =
        selectedSlot.curriculum.is_stream && selectedSlot.curriculum.stream_id
          ? slots.filter(
              (s) =>
                s.curriculum.is_stream &&
                s.curriculum.stream_id === selectedSlot.curriculum.stream_id &&
                s.day_of_week === selectedSlot.day_of_week &&
                s.lesson_number === selectedSlot.lesson_number &&
                s.week_type === selectedSlot.week_type,
            )
          : [selectedSlot];

      const movingSlotIds = new Set(movingSlots.map((s) => s.id));
      const movingGroupIds = new Set(movingSlots.map((s) => s.curriculum.group.id));
      const movingTeacherIds = new Set(
        movingSlots.flatMap((s) => [
          s.curriculum.teacher.id,
          ...(s.curriculum.second_teacher ? [s.curriculum.second_teacher.id] : []),
        ]),
      );

      // 1. Check group or teacher collision in target cell
      for (const s of slots) {
        if (movingSlotIds.has(s.id) || s.day_of_week !== day || s.lesson_number !== lesson) continue;
        if (s.week_type !== "both" && s.week_type !== activeWeek) continue;

        if (movingGroupIds.has(s.curriculum.group.id)) {
          return {
            status: "blocked",
            label:
              movingSlots.length > 1 && s.curriculum.group.id !== selectedSlot.curriculum.group.id
                ? `Потік: зайнята ${s.curriculum.group.name}`
                : "Група вже має пару",
          };
        }

        const targetTeacherIds = [
          s.curriculum.teacher.id,
          ...(s.curriculum.second_teacher ? [s.curriculum.second_teacher.id] : []),
        ];
        if (targetTeacherIds.some((tId) => movingTeacherIds.has(tId))) {
          return {
            status: "blocked",
            label: `Викладач зайнятий (${s.curriculum.group.name})`,
          };
        }
      }

      // 2. Check Thursday 4th pair curator reservation
      if (day === 4 && lesson === 4 && selectedSlot.curriculum.subject.name !== "Виховна година") {
        return {
          status: "blocked",
          label: "Резерв під Виховну годину",
        };
      }

      // 3. Check hard teacher constraint
      const hardHit = teacherConstraints.find(
        (con) =>
          con.is_hard_constraint &&
          movingTeacherIds.has(con.teacher_id) &&
          con.day_of_week === day &&
          (!con.lesson_number || con.lesson_number === lesson),
      );
      if (hardHit) {
        return {
          status: "blocked",
          label: "Недоступність викладача",
        };
      }

      // 4. Check soft warnings (group window, late start, or soft teacher preference)
      const checkContiguous = (lessons: number[]) => {
        if (lessons.length <= 1) return true;
        const sorted = [...lessons].sort((a, b) => a - b);
        return sorted[sorted.length - 1] - sorted[0] + 1 === sorted.length;
      };

      const targetDayGroupLessons = slots
        .filter(
          (s) =>
            !movingSlotIds.has(s.id) &&
            s.curriculum.group.id === selectedSlot.curriculum.group.id &&
            s.day_of_week === day &&
            (s.week_type === activeWeek || s.week_type === "both"),
        )
        .map((s) => s.lesson_number);
      const newTargetLessons = Array.from(new Set([...targetDayGroupLessons, lesson])).sort((a, b) => a - b);

      const sourceDayGroupLessons =
        selectedSlot.day_of_week === day
          ? newTargetLessons
          : slots
              .filter(
                (s) =>
                  !movingSlotIds.has(s.id) &&
                  s.curriculum.group.id === selectedSlot.curriculum.group.id &&
                  s.day_of_week === selectedSlot.day_of_week &&
                  (s.week_type === activeWeek || s.week_type === "both"),
              )
              .map((s) => s.lesson_number)
              .sort((a, b) => a - b);

      if (!checkContiguous(newTargetLessons) || !checkContiguous(sourceDayGroupLessons)) {
        return {
          status: "warning",
          label: "Утвориться вікно у групи",
        };
      }

      const sameSubjectInTargetDay = slots.some(
        (s) =>
          !movingSlotIds.has(s.id) &&
          s.curriculum.group.id === selectedSlot.curriculum.group.id &&
          s.curriculum.subject.id === selectedSlot.curriculum.subject.id &&
          s.day_of_week === day &&
          (s.week_type === activeWeek || s.week_type === "both"),
      );
      if (sameSubjectInTargetDay) {
        return {
          status: "warning",
          label: "Цей предмет вже є в цей день",
        };
      }

      const softHit = teacherConstraints.find(
        (con) =>
          !con.is_hard_constraint &&
          movingTeacherIds.has(con.teacher_id) &&
          con.day_of_week === day &&
          (!con.lesson_number || con.lesson_number === lesson),
      );
      if (softHit) {
        return {
          status: "warning",
          label: "Небажаний час викладача",
        };
      }

      if (
        (newTargetLessons.length > 0 && newTargetLessons[0] > 1) ||
        (sourceDayGroupLessons.length > 0 && sourceDayGroupLessons[0] > 1)
      ) {
        return {
          status: "warning",
          label: "Старт дня не з 1-ї пари",
        };
      }

      return { status: "ideal" };
    };

    const canMoveTo = (day: number, lesson: number) => {
      const res = evaluateMoveTarget(day, lesson);
      return res.status === "ideal" || res.status === "warning";
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

        {/* Оцінка якості чернетки */}
        {liveQuality && slots.length > 0 && (
          <div className="rounded-2xl border border-sys-border bg-sys-card/70 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-sys-text-secondary">
                  Оцінка якості чернетки
                </h3>
              </div>
              <span className="text-xs text-sys-text-muted">
                Вільних (методичних) днів у викладачів: <strong className="text-sys-text-primary">{liveQuality.methodical_days_count}</strong>
              </span>
            </div>

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
              {/* 1. Стабільність тижнів */}
              <div className="rounded-xl border border-sys-border/70 bg-sys-bg/50 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-sys-text-secondary">Симетрія тижнів</span>
                  <span className={`text-sm font-bold ${liveQuality.symmetry_percent >= 70 ? "text-emerald-400" : "text-amber-300"}`}>
                    {liveQuality.symmetry_percent}%
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-sys-text-muted leading-snug">
                  Парні предмети на тому самому місці щотижня
                </p>
              </div>

              {/* 2. Старт з 1-ї пари */}
              <button
                type="button"
                onClick={() =>
                  setExpandedQualityTab(
                    expandedQualityTab === "late" ? null : liveQuality.late_starts.length > 0 ? "late" : null,
                  )
                }
                className={`rounded-xl border p-3 text-left transition-colors ${
                  expandedQualityTab === "late"
                    ? "border-sys-accent bg-sys-accent/10"
                    : "border-sys-border/70 bg-sys-bg/50 hover:border-sys-border"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs text-sys-text-secondary">Старт з 1-ї пари</span>
                  <span className={`text-sm font-bold ${liveQuality.first_lesson_start_percent >= 90 ? "text-emerald-400" : "text-amber-300"}`}>
                    {liveQuality.first_lesson_start_percent}%
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-sys-text-muted leading-snug">
                  {liveQuality.late_starts.length === 0
                    ? "✓ Усі дні починаються о 09:00"
                    : `З 2-ї пари: ${liveQuality.late_starts.length} дн. (натисніть)`}
                </p>
              </button>

              {/* 3. Вікна викладачів */}
              <button
                type="button"
                onClick={() =>
                  setExpandedQualityTab(
                    expandedQualityTab === "windows" ? null : liveQuality.teacher_windows.length > 0 ? "windows" : null,
                  )
                }
                className={`rounded-xl border p-3 text-left transition-colors ${
                  expandedQualityTab === "windows"
                    ? "border-sys-accent bg-sys-accent/10"
                    : "border-sys-border/70 bg-sys-bg/50 hover:border-sys-border"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs text-sys-text-secondary">Вікна викладачів</span>
                  <span className={`text-sm font-bold ${liveQuality.teacher_windows.length === 0 ? "text-emerald-400" : "text-amber-300"}`}>
                    {liveQuality.teacher_windows.length}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-sys-text-muted leading-snug">
                  {liveQuality.teacher_windows.length === 0
                    ? "✓ Жодного вікна у викладачів"
                    : `Подвійних: ${liveQuality.teacher_windows.filter((w) => w.is_double).length} (натисніть для списку)`}
                </p>
              </button>

              {/* 4. Побажання та аудиторії */}
              <button
                type="button"
                onClick={() => {
                  const totalIssues =
                    liveQuality.soft_constraint_violations.length + liveQuality.room_conflicts.length;
                  setExpandedQualityTab(
                    expandedQualityTab === "soft" ? null : totalIssues > 0 ? "soft" : null,
                  );
                }}
                className={`rounded-xl border p-3 text-left transition-colors ${
                  expandedQualityTab === "soft"
                    ? "border-sys-accent bg-sys-accent/10"
                    : "border-sys-border/70 bg-sys-bg/50 hover:border-sys-border"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs text-sys-text-secondary">Побажання та кабінети</span>
                  <span
                    className={`text-sm font-bold ${
                      liveQuality.soft_constraint_violations.length + liveQuality.room_conflicts.length === 0
                        ? "text-emerald-400"
                        : "text-amber-300"
                    }`}
                  >
                    {liveQuality.soft_constraint_violations.length + liveQuality.room_conflicts.length === 0
                      ? "100%"
                      : liveQuality.soft_constraint_violations.length + liveQuality.room_conflicts.length}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-sys-text-muted leading-snug">
                  {liveQuality.soft_constraint_violations.length + liveQuality.room_conflicts.length === 0
                    ? "✓ Усі побажання й кабінети враховано"
                    : `Зауважень: ${liveQuality.soft_constraint_violations.length + liveQuality.room_conflicts.length} (натисніть)`}
                </p>
              </button>
            </div>

            {/* Розгорнутий список деталей */}
            {expandedQualityTab === "windows" && liveQuality.teacher_windows.length > 0 && (
              <div className="rounded-xl border border-sys-border/60 bg-sys-bg/70 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-sys-text-primary">
                    Викладачі з вікнами (натисніть для швидкого переходу):
                  </span>
                  <button
                    type="button"
                    onClick={() => setExpandedQualityTab(null)}
                    className="text-xs text-sys-text-muted hover:text-sys-text-primary"
                  >
                    Згорнути
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {liveQuality.teacher_windows.map((w, idx) => (
                    <button
                      key={`${w.teacher_id}-${w.week_type}-${w.day_of_week}-${idx}`}
                      type="button"
                      onClick={() => {
                        setFilterMode("teacher");
                        setFilterTeacherId(w.teacher_id);
                        setActiveWeek(w.week_type);
                      }}
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                        w.is_double
                          ? "border-rose-500/40 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20"
                          : "border-amber-500/30 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20"
                      }`}
                    >
                      <span>{formatTeacherName(w.teacher_name)}</span>
                      <span className="opacity-75">
                        · {dayNames[w.day_of_week]} ({w.week_type === "numerator" ? "Чис." : "Знам."}, пара {w.empty_lessons.join(", ")})
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {expandedQualityTab === "late" && liveQuality.late_starts.length > 0 && (
              <div className="rounded-xl border border-sys-border/60 bg-sys-bg/70 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-sys-text-primary">
                    Дні з початком не з 1-ї пари (натисніть для переходу до групи):
                  </span>
                  <button
                    type="button"
                    onClick={() => setExpandedQualityTab(null)}
                    className="text-xs text-sys-text-muted hover:text-sys-text-primary"
                  >
                    Згорнути
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {liveQuality.late_starts.map((item, idx) => (
                    <button
                      key={`${item.group_id}-${item.week_type}-${item.day_of_week}-${idx}`}
                      type="button"
                      onClick={() => {
                        setFilterMode("group");
                        setFilterGroupId(item.group_id);
                        setActiveWeek(item.week_type);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-200 hover:bg-amber-500/20 transition-colors"
                    >
                      <strong>{item.group_name}</strong>
                      <span className="opacity-80">
                        · {dayNames[item.day_of_week]} ({item.week_type === "numerator" ? "Чис." : "Знам."}, з {item.start_lesson}-ї пари)
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {expandedQualityTab === "soft" &&
              (liveQuality.soft_constraint_violations.length > 0 || liveQuality.room_conflicts.length > 0) && (
                <div className="rounded-xl border border-sys-border/60 bg-sys-bg/70 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-sys-text-primary">
                      Компроміси побажань та аудиторій:
                    </span>
                    <button
                      type="button"
                      onClick={() => setExpandedQualityTab(null)}
                      className="text-xs text-sys-text-muted hover:text-sys-text-primary"
                    >
                      Згорнути
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {liveQuality.soft_constraint_violations.map((v, idx) => (
                      <button
                        key={`soft-${v.teacher_id}-${v.week_type}-${v.day_of_week}-${v.lesson_number}-${idx}`}
                        type="button"
                        onClick={() => {
                          setFilterMode("teacher");
                          setFilterTeacherId(v.teacher_id);
                          setActiveWeek(v.week_type);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-200 hover:bg-amber-500/20 transition-colors"
                      >
                        <span>👨‍🏫 {formatTeacherName(v.teacher_name)}</span>
                        <span className="opacity-80">
                          · {v.group_name}, {dayNames[v.day_of_week]} ({v.lesson_number}-та пара)
                        </span>
                      </button>
                    ))}
                    {liveQuality.room_conflicts.map((rc, idx) => (
                      <span
                        key={`room-${rc.room}-${rc.week_type}-${rc.day_of_week}-${rc.lesson_number}-${idx}`}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-xs font-medium text-rose-200"
                      >
                        <span>🚪 Каб. {rc.room}</span>
                        <span className="opacity-80">
                          · {dayNames[rc.day_of_week]} ({rc.lesson_number}-та пара: {rc.groups.join(", ")})
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
          </div>
        )}

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
            <div className="space-y-1">
              <p className="text-sm text-sys-text-primary">
                Переміщення заняття: <strong>{selectedSlot.curriculum.group.name} · {selectedSlot.curriculum.subject.name}</strong>
                {selectedSlot.curriculum.is_stream && selectedSlot.curriculum.stream_id && (
                  <span className="ml-2 rounded bg-purple-500/20 px-2 py-0.5 text-xs font-semibold text-purple-300">
                    🔗 Потокове заняття (переміститься синхронно)
                  </span>
                )}
              </p>
              <div className="flex flex-wrap items-center gap-3 text-xs text-sys-text-secondary">
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-emerald-400" /> Зелені — ідеальне місце
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-amber-400" /> Жовті — допустимо з попередженням
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-rose-400" /> Червоні — зайнято (вказана причина)
                </span>
              </div>
            </div>
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
                const targetEval = evaluateMoveTarget(day, lesson);
                const canChooseTarget = targetEval.status === "ideal" || targetEval.status === "warning";
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
                      targetEval.status === "ideal"
                        ? "bg-emerald-500/[0.08] ring-1 ring-inset ring-emerald-400/40"
                        : targetEval.status === "warning"
                          ? "bg-amber-500/[0.08] ring-1 ring-inset ring-amber-400/40"
                          : targetEval.status === "blocked"
                            ? "bg-rose-500/[0.04]"
                            : "hover:bg-white/[0.02]"
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
                        {cellSlots.map((slot) => {
                          const isWeekly = isSlotWeeklySymmetric(slot);
                          return (
                            <article
                              key={slot.id}
                              draggable
                              onDragStart={(event) => event.dataTransfer.setData("slot_id", slot.id.toString())}
                              className={`rounded-lg border bg-sys-card p-2.5 text-sm shadow-sm ${
                                selectedSlotId === slot.id ? "border-sys-accent ring-1 ring-sys-accent" : "border-sys-border"
                              } cursor-grab active:cursor-grabbing`}
                            >
                              <div className="flex flex-wrap items-center justify-between gap-1">
                                <span className="font-semibold text-sys-accent">{slot.curriculum.group.name}</span>
                                <div className="flex flex-wrap items-center gap-1">
                                  {slot.curriculum.is_stream && slot.curriculum.stream_id && (
                                    <span className="rounded bg-purple-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-purple-300">
                                      Потік
                                    </span>
                                  )}
                                  {isWeekly && (
                                    <span className="rounded bg-sys-accent/10 px-1.5 py-0.5 text-[10px] font-semibold text-sys-accent">
                                      Щотижня
                                    </span>
                                  )}
                                </div>
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
                          );
                        })}
                      </div>
                    )}
                    {canChooseTarget ? (
                      <button
                        type="button"
                        aria-label={`Перемістити пару на ${dayNames[day]}, ${lesson}-ту пару`}
                        onClick={() => {
                          if (selectedSlot && !moving) void handleMove(selectedSlot.id, day, lesson, activeWeek);
                        }}
                        disabled={moving}
                        className={`mt-2 flex min-h-10 w-full flex-col items-center justify-center rounded-lg border px-2 py-2 text-xs font-semibold transition-colors disabled:opacity-50 ${
                          targetEval.status === "warning"
                            ? "border-amber-400/40 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25"
                            : "border-emerald-400/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
                        }`}
                      >
                        <span>Перемістити сюди</span>
                        {targetEval.status === "warning" && targetEval.label && (
                          <span className="mt-0.5 text-[10px] font-normal opacity-90">⚠ {targetEval.label}</span>
                        )}
                      </button>
                    ) : targetEval.status === "blocked" && targetEval.label ? (
                      <div className="mt-2 flex min-h-9 w-full items-center justify-center rounded-lg border border-rose-500/25 bg-rose-500/10 px-2 py-1.5 text-center text-[11px] font-medium text-rose-300/90">
                        ⛔ {targetEval.label}
                      </div>
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

  const genInfo = generatingDraft?.generation ?? generatingDraft?.data?.generation;

  const serverStartedAtMs = genInfo?.started_at ? new Date(genInfo.started_at).getTime() : null;
  const serverElapsed = typeof genInfo?.elapsed_seconds === "number" ? Math.floor(genInfo.elapsed_seconds) : 0;
  const clockElapsed = serverStartedAtMs && !isNaN(serverStartedAtMs)
    ? Math.max(0, Math.floor((Date.now() - serverStartedAtMs) / 1000))
    : 0;
  const currentElapsed = Math.max(elapsed, serverElapsed, clockElapsed);

  const timeStageIndex = currentElapsed < 2 ? 0 : currentElapsed < 8 ? 1 : currentElapsed < 35 ? 2 : 3;
  const activePhase = genInfo?.phase;
  let activeStageIndex = timeStageIndex;
  if (activePhase === "completed") activeStageIndex = 4;
  else if (activePhase === "saving") activeStageIndex = 3;
  else if (activePhase === "optimizing") activeStageIndex = 2;
  else if (activePhase === "feasibility") activeStageIndex = Math.max(1, timeStageIndex >= 2 && currentElapsed >= 12 ? 2 : 1);
  else if (activePhase === "validating") activeStageIndex = currentElapsed >= 2 ? timeStageIndex : 0;

  const timeBasedPercent = Math.min(92, Math.round(
    currentElapsed < 2 ? 6 + currentElapsed * 4 :
    currentElapsed < 8 ? 15 + (currentElapsed - 2) * 5.5 :
    currentElapsed < 25 ? 48 + (currentElapsed - 8) * 2.2 :
    85 + Math.min(7, (currentElapsed - 25) * 0.35)
  ));
  const rawBackendPercent = typeof genInfo?.progress_percent === "number" ? genInfo.progress_percent : 0;
  const progressPercent = activePhase === "completed" || generatingDraft?.status === "DRAFT"
    ? 100
    : rawBackendPercent <= 8 && currentElapsed >= 2
      ? Math.max(rawBackendPercent, timeBasedPercent)
      : rawBackendPercent > 0
        ? Math.min(99, Math.max(rawBackendPercent, Math.min(rawBackendPercent + 6, timeBasedPercent)))
        : timeBasedPercent;

  return (
    <>
      <PageHeader
        eyebrow="АВТОМАТИЗАЦІЯ"
        title="Генерація розкладу"
        description="Створює чернетку з навчального навантаження, доступності викладачів і практик. Після перевірки її можна опублікувати як розклад."
        actions={
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
        }
      />

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
                    {formatTimer(currentElapsed)}
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
                  {formatTimer(currentElapsed)}
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
                      {idx === 2 && typeof genInfo?.solutions_found === "number" && genInfo.solutions_found > 0 && (
                        <span className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-400 border border-emerald-500/25">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          Знайдено покращень розкладу: {genInfo.solutions_found}
                        </span>
                      )}
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


