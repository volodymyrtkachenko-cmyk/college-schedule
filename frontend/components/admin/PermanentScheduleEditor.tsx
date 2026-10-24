"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useSearchParams } from "next/navigation";
import { api, DirectoryItem, Lesson, LessonMutation, ReferenceRecord, ScheduleVersion, TemplateScheduleResponse } from "../../lib/api";
import { getMondayOf } from "../../lib/date";
import { DEFAULT_LESSON_TIMES } from "../../lib/constants/lessons";
import { useToast } from "../ToastProvider";
import { SearchableSelect } from "../SearchableSelect";
import { LessonCard, QuickJumpTarget } from "../LessonCard";
import dynamic from "next/dynamic";
const LessonEditor = dynamic(() => import("../LessonEditor").then((m) => m.LessonEditor), { ssr: false });
import { PageHeader } from "./PageHeader";

const DAYS: Array<{ day: number; name: string; short: string }> = [
  { day: 1, name: "Понеділок", short: "Пн" },
  { day: 2, name: "Вівторок", short: "Вт" },
  { day: 3, name: "Середа", short: "Ср" },
  { day: 4, name: "Четвер", short: "Чт" },
  { day: 5, name: "П’ятниця", short: "Пт" },
];

export type PermBuffer =
  | { type: "single"; mode: "copy" | "move"; lesson: Lesson; sourceWeekType: "numerator" | "denominator" }
  | { type: "day"; mode: "copy" | "move"; sourceDay: number; sourceWeekType: "numerator" | "denominator"; lessons: Lesson[] }
  | null;

export interface PermSwapState {
  lesson: Lesson;
  weekType: "numerator" | "denominator";
}

export function PermanentScheduleEditor() {
  const searchParams = useSearchParams();
  const { showToast: setToast } = useToast();
  const [isPending, startTransition] = useTransition();

  // URL / Initial state
  const initialVersionId = searchParams.get("version_id") ? Number(searchParams.get("version_id")) : null;
  const initialWeekType = searchParams.get("week_type") === "denominator" ? "denominator" : "numerator";
  const initialMode = searchParams.get("mode") === "teacher" ? "teacher" : "student";
  const initialGroupId = searchParams.get("group_id") ? Number(searchParams.get("group_id")) : null;
  const initialTeacherId = searchParams.get("teacher_id") ? Number(searchParams.get("teacher_id")) : null;
  const highlightParam = searchParams.get("highlight");

  const [versions, setVersions] = useState<ScheduleVersion[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(initialVersionId);
  const [weekType, setWeekType] = useState<"numerator" | "denominator">(initialWeekType);
  const [mode, setMode] = useState<"student" | "teacher">(initialMode);
  const [groupId, setGroupId] = useState<number | null>(initialGroupId);
  const [teacherId, setTeacherId] = useState<number | null>(initialTeacherId);

  // Reference directories
  const [groups, setGroups] = useState<ReferenceRecord[]>([]);
  const [teachers, setTeachers] = useState<ReferenceRecord[]>([]);

  // Template data
  const [templateData, setTemplateData] = useState<TemplateScheduleResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [isFetching, setIsFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mobileScheduleRef = useRef<HTMLDivElement>(null);
  const scrollToMobileSchedule = useCallback(() => {
    if (typeof window !== "undefined" && window.innerWidth < 640 && mobileScheduleRef.current) {
      mobileScheduleRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  // Affected overrides notice
  const [affectedNotice, setAffectedNotice] = useState<string[] | null>(null);

  // Buffer and Swap state
  const [buffer, setBuffer] = useState<PermBuffer>(null);
  const [swapSource, setSwapSource] = useState<PermSwapState | null>(null);

  // Highlight state
  const [highlightSlot, setHighlightSlot] = useState<string | null>(highlightParam);

  // Modal editor
  const [editor, setEditor] = useState<{
    lesson?: Lesson;
    day_of_week: number;
    lesson_number?: number;
  } | null>(null);

  // Mobile state
  const shouldReduceMotion = useReducedMotion();
  const [daySlideDir, setDaySlideDir] = useState(0);
  const [selectedMobileDayIndex, setSelectedMobileDayIndex] = useState(0);
  const [mobileActionsDay, setMobileActionsDay] = useState<number | null>(null);

  // Touch handling for mobile swipe
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  const selectedVersion = useMemo(
    () => {
      if (selectedVersionId) {
        const found = versions.find((v) => v.id === selectedVersionId);
        if (found) return found;
      }
      const todayStr = new Date().toISOString().slice(0, 10);
      return (
        versions.find((v) => v.is_active && v.valid_from <= todayStr && v.valid_until >= todayStr) ||
        versions.find((v) => v.is_active) ||
        versions[0] ||
        null
      );
    },
    [versions, selectedVersionId]
  );

  const isSelectedVersionCurrentlyValid = useMemo(() => {
    if (!selectedVersion) return true;
    const todayStr = new Date().toISOString().slice(0, 10);
    return selectedVersion.valid_from <= todayStr && selectedVersion.valid_until >= todayStr;
  }, [selectedVersion]);

  const currentMonday = useMemo(() => getMondayOf(new Date()), []);
  const mondayStr = useMemo(() => {
    return new Intl.DateTimeFormat("uk-UA", { day: "numeric", month: "short" }).format(currentMonday);
  }, [currentMonday]);

  // Load versions and directories
  useEffect(() => {
    let active = true;
    Promise.all([
      api.scheduleVersions.list(),
      api.groups(),
      api.directory.teachers(),
    ])
      .then(([vList, gList, tList]) => {
        if (!active) return;
        setVersions(vList);
        setGroups(gList);
        setTeachers(tList);
        if (!selectedVersionId && vList.length > 0) {
          const todayStr = new Date().toISOString().slice(0, 10);
          const currentValidV = vList.find(
            (v) => v.is_active && v.valid_from <= todayStr && v.valid_until >= todayStr
          );
          const activeV = currentValidV || vList.find((v) => v.is_active) || vList[0];
          setSelectedVersionId(activeV.id);
        }
        if (!groupId && gList.length > 0 && initialMode === "student") {
          setGroupId(gList[0].id);
        }
        if (!teacherId && tList.length > 0 && initialMode === "teacher") {
          setTeacherId(tList[0].id);
        }
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : "Не вдалося завантажити довідники.");
      });
    return () => {
      active = false;
    };
  }, []);

  // Fetch template data
  const loadTemplate = async () => {
    if (!selectedVersionId) return;
    if (mode === "student" && !groupId) return;
    if (mode === "teacher" && !teacherId) return;

    if (!templateData) {
      setLoading(true);
    } else {
      setIsFetching(true);
    }
    setError(null);
    try {
      const data = await api.template.get({
        version_id: selectedVersionId,
        week_type: weekType,
        group_id: mode === "student" ? (groupId ?? undefined) : undefined,
        teacher_id: mode === "teacher" ? (teacherId ?? undefined) : undefined,
      });
      setTemplateData(data);
    } catch (e: any) {
      setError(e instanceof Error ? e.message : "Помилка завантаження постійного розкладу.");
    } finally {
      setLoading(false);
      setIsFetching(false);
    }
  };

  useEffect(() => {
    if (selectedVersionId && ((mode === "student" && groupId) || (mode === "teacher" && teacherId))) {
      void loadTemplate();
    }
  }, [selectedVersionId, weekType, mode, groupId, teacherId]);

  // Auto-scroll down on mobile when template is loaded with a selected group or teacher
  const hasAutoScrolled = useRef(false);
  useEffect(() => {
    if (!loading && templateData && (groupId || teacherId) && !hasAutoScrolled.current) {
      hasAutoScrolled.current = true;
      const timer = setTimeout(scrollToMobileSchedule, 300);
      return () => clearTimeout(timer);
    }
  }, [loading, templateData, groupId, teacherId, scrollToMobileSchedule]);

  // Handle URL highlight
  useEffect(() => {
    if (!highlightSlot || loading || !templateData) return;
    const timer = setTimeout(() => {
      const el = document.getElementById(`perm-slot-${highlightSlot}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("ring-4", "ring-indigo-500", "bg-indigo-500/20");
        setTimeout(() => {
          el.classList.remove("ring-4", "ring-indigo-500", "bg-indigo-500/20");
          setHighlightSlot(null);
        }, 1500);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [highlightSlot, loading, templateData]);

  // Esc clears buffer & swap
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (swapSource) setSwapSource(null);
        else if (buffer) setBuffer(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [swapSource, buffer]);

  const weekTypeTitle = weekType === "numerator" ? "Чисельник" : "Знаменник";

  // Actions
  const handleCreateOrUpdate = async (payload: LessonMutation) => {
    if (!selectedVersionId) return;
    try {
      if (editor?.lesson) {
        const res = await api.template.updateLesson(editor.lesson.id, {
          subject_id: payload.subject_id,
          teacher_id: payload.teacher_id,
          second_teacher_id: payload.second_teacher_id,
          day_of_week: payload.day_of_week,
          lesson_number: payload.lesson_number,
          week_type: payload.week_type || weekType,
          room: payload.room || "",
        });
        setToast("Постійний розклад оновлено.", "success");
        if (res.affected_dates?.length) {
          setAffectedNotice(res.affected_dates);
        }
      } else {
        const res = await api.template.createLesson({
          version_id: selectedVersionId,
          group_id: payload.group_id || groupId || 0,
          subject_id: payload.subject_id,
          teacher_id: payload.teacher_id,
          second_teacher_id: payload.second_teacher_id,
          day_of_week: payload.day_of_week,
          lesson_number: payload.lesson_number,
          week_type: payload.week_type || weekType,
          room: payload.room || "",
        });
        setToast("Пару додано до постійного розкладу.", "success");
        if (res.affected_dates?.length) {
          setAffectedNotice(res.affected_dates);
        }
      }
      setEditor(null);
      await loadTemplate();
    } catch (e: any) {
      setToast(e instanceof Error ? e.message : "Помилка збереження", "error");
      throw e;
    }
  };

  const handleDelete = async (lesson: Lesson) => {
    if (!confirm(`Видалити «${lesson.subject_name}» з постійного розкладу?`)) return;
    try {
      const res = await api.template.deleteLesson(lesson.id);
      setToast("Пару видалено з постійного розкладу.", "success");
      if (res.affected_dates?.length) {
        setAffectedNotice(res.affected_dates);
      }
      await loadTemplate();
    } catch (e: any) {
      setToast(e instanceof Error ? e.message : "Помилка видалення", "error");
    }
  };

  const handleCopySelect = (lesson: Lesson) => {
    setBuffer({ type: "single", mode: "copy", lesson, sourceWeekType: weekType });
    setToast(`Пару «${lesson.subject_name}» скопійовано в буфер. Оберіть слот для вставки.`, "info");
  };

  const handleMoveSelect = (lesson: Lesson) => {
    setBuffer({ type: "single", mode: "move", lesson, sourceWeekType: weekType });
    setToast(`Перенесення пари «${lesson.subject_name}». Оберіть вільний слот.`, "info");
  };

  const handleSwapSelect = async (lesson: Lesson) => {
    if (!selectedVersionId) return;
    if (!swapSource) {
      setSwapSource({ lesson, weekType });
      setToast(`Пару «${lesson.subject_name}» вибрано для обміну. Оберіть іншу пару.`, "info");
      return;
    }

    if (swapSource.lesson.id === lesson.id) {
      setSwapSource(null);
      return;
    }

    try {
      const res = await api.template.swap({
        version_id: selectedVersionId,
        first_lesson_id: swapSource.lesson.id,
        second_lesson_id: lesson.id,
      });
      setToast("Пари успішно обміняно місцями в постійному розкладі!", "success");
      setSwapSource(null);
      if (res.affected_dates?.length) {
        setAffectedNotice(res.affected_dates);
      }
      await loadTemplate();
    } catch (e: any) {
      setToast(e instanceof Error ? e.message : "Не вдалося виконати обмін парами", "error");
    }
  };

  const handlePasteToSlot = async (dayOfWeek: number, lessonNumber: number) => {
    if (!selectedVersionId || !buffer) return;

    if (buffer.type === "single") {
      try {
        if (buffer.mode === "copy") {
          const res = await api.template.copy({
            version_id: selectedVersionId,
            source_lesson_id: buffer.lesson.id,
            target_day_of_week: dayOfWeek,
            target_lesson_number: lessonNumber,
            target_week_type: weekType,
          });
          setToast("Пару скопійовано.", "success");
          if (res.affected_dates?.length) {
            setAffectedNotice(res.affected_dates);
          }
        } else {
          const res = await api.template.move({
            version_id: selectedVersionId,
            source_lesson_id: buffer.lesson.id,
            target_day_of_week: dayOfWeek,
            target_lesson_number: lessonNumber,
            target_week_type: weekType,
          });
          setToast("Пару переміщено в постійному розкладі.", "success");
          setBuffer(null);
          if (res.affected_dates?.length) {
            setAffectedNotice(res.affected_dates);
          }
        }
        await loadTemplate();
      } catch (e: any) {
        setToast(e instanceof Error ? e.message : "Помилка вставки заняття", "error");
      }
    }
  };

  const handleCopyDay = (dayNum: number) => {
    const dayObj = templateData?.days.find((d) => d.day_of_week === dayNum);
    const dayLessons = dayObj?.lessons || [];
    if (!dayLessons.length) {
      setToast("У цей день немає пар для копіювання", "info");
      return;
    }
    setBuffer({ type: "day", mode: "copy", sourceDay: dayNum, sourceWeekType: weekType, lessons: dayLessons });
    setToast(`Скопійовано день (${dayLessons.length} пар). Оберіть колонку дня для вставки через меню ⋮ дня.`, "info");
  };

  const handleMoveDay = (dayNum: number) => {
    const dayObj = templateData?.days.find((d) => d.day_of_week === dayNum);
    const dayLessons = dayObj?.lessons || [];
    if (!dayLessons.length) {
      setToast("У цей день немає пар для перенесення", "info");
      return;
    }
    setBuffer({ type: "day", mode: "move", sourceDay: dayNum, sourceWeekType: weekType, lessons: dayLessons });
    setToast(`Перенесення дня (${dayLessons.length} пар). Оберіть колонку дня для вставки через меню ⋮ дня.`, "info");
  };

  const handlePasteDay = async (targetDayNum: number) => {
    if (!selectedVersionId || buffer?.type !== "day") return;
    try {
      const res = await api.template.dayAction({
        version_id: selectedVersionId,
        action: buffer.mode,
        source_day_of_week: buffer.sourceDay,
        source_week_type: buffer.sourceWeekType,
        target_day_of_week: targetDayNum,
        target_week_type: weekType,
        group_id: groupId || 0,
      });
      setToast(
        buffer.mode === "copy"
          ? `Скопійовано ${res.count} пар дня.`
          : `Переміщено ${res.count} пар дня.`,
        "success"
      );
      if (buffer.mode === "move") setBuffer(null);
      if (res.affected_dates?.length) {
        setAffectedNotice(res.affected_dates);
      }
      await loadTemplate();
    } catch (e: any) {
      setToast(e instanceof Error ? e.message : "Помилка вставки дня", "error");
    }
  };

  // Touch handlers for mobile day swipe (stops at edges, no week wrap)
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const diffX = touchStartX.current - e.touches[0].clientX;
    const diffY = touchStartY.current - e.touches[0].clientY;

    if (Math.abs(diffX) > 40 && Math.abs(diffX) > Math.abs(diffY) * 1.5) {
      if (diffX > 0) {
        setDaySlideDir(1);
        if (selectedMobileDayIndex < 4) {
          setSelectedMobileDayIndex((prev) => prev + 1);
        }
      } else {
        setDaySlideDir(-1);
        if (selectedMobileDayIndex > 0) {
          setSelectedMobileDayIndex((prev) => prev - 1);
        }
      }
      touchStartX.current = null;
      touchStartY.current = null;
    }
  };

  const handleTouchEnd = () => {
    touchStartX.current = null;
    touchStartY.current = null;
  };

  return (
    <div className="w-full space-y-4">
      <PageHeader
        eyebrow="ПОСТІЙНИЙ РОЗКЛАД"
        title={`Шаблон розкладу: ${selectedVersion?.name || "Постійний розклад"}`}
        description={`Базовий тижневий розклад версії (${selectedVersion ? `${selectedVersion.valid_from} — ${selectedVersion.valid_until}` : "без прив'язки до дат"}).`}
        actions={
          <div className="flex items-center gap-2">
            <a
              href="/admin?resource=schedule"
              className="inline-flex items-center gap-1.5 rounded-lg border border-sys-border bg-sys-card px-3.5 py-2 text-xs font-semibold text-sys-text-primary hover:bg-white/5 transition-colors"
            >
              ← До змінного розкладу
            </a>
          </div>
        }
      />

      {/* Prominent warning if editing a version not valid today */}
      {selectedVersion && !isSelectedVersionCurrentlyValid && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm">
          <div className="flex items-center gap-3">
            <span className="text-2xl">⚠️</span>
            <div>
              <p className="font-bold text-sm text-amber-100">
                Ви редагуєте версію, яка зараз не діє!
              </p>
              <p className="text-xs text-amber-300/90 mt-0.5">
                Версія «{selectedVersion.name}» діє з {selectedVersion.valid_from} до {selectedVersion.valid_until}. Сьогодні розклад за цією версією не використовується.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-amber-300 font-medium">Перемкнути версію:</span>
            <select
              className="form-control text-xs py-1.5 px-3 bg-black/60 border-amber-500/50 text-amber-100 rounded-lg font-semibold"
              value={selectedVersionId ?? ""}
              onChange={(e) => setSelectedVersionId(Number(e.target.value))}
              aria-label="Швидкий вибір версії"
            >
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} ({v.valid_from} — {v.valid_until})
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Version selector & Filters bar */}
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center justify-between gap-3">
        <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2.5 w-full lg:w-auto">
          {/* Version Switcher (hidden when warning banner above already provides a version switcher) */}
          {(!selectedVersion || isSelectedVersionCurrentlyValid) && (
            <div className="w-full sm:w-auto">
              <select
                className="form-control text-sm py-1.5 w-full sm:w-60 font-semibold"
                value={selectedVersionId ?? ""}
                onChange={(e) => setSelectedVersionId(Number(e.target.value))}
                aria-label="Вибір версії розкладу"
              >
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} {v.is_active ? "(активна)" : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Group / Teacher Toggle */}
          <div role="tablist" aria-label="Режим перегляду" className="flex w-full sm:w-auto rounded-lg border border-sys-border bg-sys-card p-1 text-sm relative">
            <div
              className="absolute top-1 bottom-1 w-[calc(50%-4px)] bg-sys-accent rounded-md shadow-sm transition-all duration-300 ease-out z-0"
              style={{ left: mode === "student" ? "4px" : "50%" }}
            />
            <button
              role="tab"
              aria-selected={mode === "student"}
              type="button"
              onClick={() => startTransition(() => setMode("student"))}
              className={`relative z-10 flex-1 sm:flex-none sm:w-28 text-center rounded-md px-3 py-2 sm:py-1.5 transition-colors ${
                mode === "student" ? "text-white font-semibold" : "text-sys-text-secondary hover:text-sys-text-primary"
              }`}
            >
              Група
            </button>
            <button
              role="tab"
              aria-selected={mode === "teacher"}
              type="button"
              onClick={() => startTransition(() => setMode("teacher"))}
              className={`relative z-10 flex-1 sm:flex-none sm:w-28 text-center rounded-md px-3 py-2 sm:py-1.5 transition-colors ${
                mode === "teacher" ? "text-white font-semibold" : "text-sys-text-secondary hover:text-sys-text-primary"
              }`}
            >
              Викладач
            </button>
          </div>

          {mode === "student" ? (
            <div className="w-full sm:w-60">
              <SearchableSelect
                options={groups}
                value={groupId}
                onChange={(id) => {
                  setGroupId(id);
                  if (id) setTimeout(scrollToMobileSchedule, 100);
                }}
                placeholder="Оберіть групу"
                disabled={isPending}
                ariaLabel="Оберіть групу"
              />
            </div>
          ) : (
            <div className="w-full sm:w-60">
              <SearchableSelect
                options={teachers}
                value={teacherId}
                onChange={(id) => {
                  setTeacherId(id);
                  if (id) setTimeout(scrollToMobileSchedule, 100);
                }}
                placeholder="Оберіть викладача"
                disabled={isPending}
                ariaLabel="Оберіть викладача"
              />
            </div>
          )}
        </div>

        {/* Segmented Switch: Чисельник | Знаменник */}
        <div className="relative flex items-center rounded-xl border border-sys-border bg-sys-card p-1 shadow-sm">
          <div
            className={`absolute top-1 bottom-1 w-[calc(50%-4px)] rounded-lg shadow-sm transition-all duration-200 ease-out z-0 ${
              weekType === "numerator" ? "bg-indigo-600" : "bg-emerald-600"
            }`}
            style={{ left: weekType === "numerator" ? "4px" : "50%" }}
          />
          <button
            type="button"
            onClick={() => setWeekType("numerator")}
            className={`relative z-10 flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold transition-colors ${
              weekType === "numerator"
                ? "text-white"
                : "text-sys-text-secondary hover:text-sys-text-primary"
            }`}
          >
            <span>Чисельник</span>
          </button>
          <button
            type="button"
            onClick={() => setWeekType("denominator")}
            className={`relative z-10 flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold transition-colors ${
              weekType === "denominator"
                ? "text-white"
                : "text-sys-text-secondary hover:text-sys-text-primary"
            }`}
          >
            <span>Знаменник</span>
          </button>
        </div>
      </div>

      {/* Distinct Permanent Schedule Banner */}
      <div className="rounded-xl border-2 border-indigo-500/40 bg-indigo-950/25 p-3.5 shadow-sm backdrop-blur-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 flex-wrap min-w-0">
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-black uppercase tracking-wider bg-indigo-500 text-white">
            ПОСТІЙНИЙ РОЗКЛАД
          </span>
          <p className="text-xs sm:text-sm font-semibold text-sys-text-primary break-words">
            Постійний розклад · «{selectedVersion?.name || "Версія"}» · {weekTypeTitle} — зміни діють з понеділка {mondayStr} і далі, минулі тижні не змінюються
          </p>
        </div>
      </div>

      {/* Affected Future Overrides Alert Banner */}
      {affectedNotice && affectedNotice.length > 0 && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5 text-xs text-amber-200 flex flex-wrap items-center justify-between gap-2 shadow-sm animate-in fade-in duration-200">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <span className="text-base shrink-0">⚠️</span>
            <span>
              <strong>Увага:</strong> На наступні дати існують разові зміни (заміни/скасування), яких може стосуватися це оновлення:
            </span>
            <div className="flex flex-wrap gap-1.5">
              {affectedNotice.map((d) => (
                <a
                  key={d}
                  href={`/admin?resource=schedule&date=${d}`}
                  className="rounded bg-amber-500/20 px-2 py-0.5 font-bold text-amber-300 underline hover:bg-amber-500/30 transition-colors"
                >
                  {d}
                </a>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setAffectedNotice(null)}
            className="text-amber-400 hover:text-white text-base px-1"
            aria-label="Закрити повідомлення"
          >
            ✕
          </button>
        </div>
      )}

      {/* Buffer Active Panel */}
      <AnimatePresence>
        {buffer ? (
          <motion.div
            key="perm-buffer"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.2, ease: [0.2, 0, 0, 1] }}
            className="sticky top-2 z-40 mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-indigo-500/60 bg-sys-card p-3.5 shadow-xl backdrop-blur-md"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="text-lg shrink-0">{buffer.mode === "copy" ? "📋" : "✂️"}</span>
              <div className="min-w-0">
                <p className="text-xs font-bold text-sys-text-primary">
                  {buffer.mode === "copy" ? "Копіювання в постійний розклад" : "Перенесення в постійному розкладі"} · {weekTypeTitle}
                </p>
                <p className="text-[11px] text-sys-text-secondary break-words">
                  {buffer.mode === "copy"
                    ? `Зміна для всіх тижнів «${weekTypeTitle}» з ${mondayStr}. Можна вставляти в обидва типи тижнів (перемикайте вгорі).`
                    : `Перенесення для всіх тижнів «${weekTypeTitle}» з ${mondayStr}.`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setBuffer(null)}
                className="rounded-lg bg-indigo-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-indigo-500 transition-colors shadow-sm"
              >
                {buffer.mode === "copy" ? "Готово (Esc)" : "✕ Скасувати"}
              </button>
            </div>
          </motion.div>
        ) : swapSource ? (
          <motion.div
            key="perm-swap"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.2, ease: [0.2, 0, 0, 1] }}
            className="sticky top-2 z-40 mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-indigo-500/60 bg-sys-card p-3.5 shadow-xl backdrop-blur-md"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="text-lg shrink-0">⇄</span>
              <div className="min-w-0">
                <p className="text-xs font-bold text-sys-text-primary">
                  Обмін у постійному розкладі · «{swapSource.lesson.subject_name}»
                </p>
                <p className="text-[11px] text-sys-text-secondary break-words">
                  Оберіть іншу пару в розкладі для взаємного обміну місцями (зміна для всіх тижнів з {mondayStr}).
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSwapSource(null)}
              className="rounded-lg border border-sys-border bg-white/5 px-3 py-1.5 text-xs font-semibold text-sys-text-secondary hover:text-sys-text-primary"
            >
              ✕ Скасувати
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Main Grid: Desktop 5 columns without dates */}
      {loading && !templateData ? (
        <div className="rounded-2xl border border-sys-border bg-sys-card/50 p-12 text-center text-sys-text-secondary">
          Завантаження постійного розкладу…
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-rose-400/20 bg-rose-400/5 p-8 text-center text-rose-200">
          {error}
        </div>
      ) : templateData ? (
        <div className={`w-full min-w-0 transition-opacity duration-200 ${isFetching ? "opacity-60 pointer-events-none" : "opacity-100"}`}>
          {/* Desktop Grid (>= 640px) */}
          <div className="hidden sm:grid sm:grid-cols-5 gap-3 items-start pb-4">
            {DAYS.map(({ day, name }) => {
              const dayLessons = templateData.days.find((d) => d.day_of_week === day)?.lessons || [];
              const isDayBufferTarget = buffer?.type === "day";

              return (
                <div key={day} className="flex flex-col rounded-2xl border border-sys-border bg-sys-card/60 p-3 shadow-xs min-w-0">
                  {/* Day Header without dates */}
                  <div className="flex items-center justify-between pb-2 mb-2 border-b border-sys-border/40">
                    <span className="font-bold text-sm text-sys-text-primary capitalize">{name}</span>
                    <div className="relative group">
                      <button
                        type="button"
                        aria-label={`Дії для дня ${name}`}
                        className="w-7 h-7 flex items-center justify-center rounded-lg text-sys-text-muted hover:text-sys-text-primary hover:bg-white/5 text-base"
                      >
                        ⋮
                      </button>
                      <div className="absolute right-0 top-8 z-30 hidden group-hover:flex group-focus-within:flex flex-col rounded-xl border border-sys-border bg-sys-card p-1.5 shadow-xl min-w-[170px]">
                        <button
                          type="button"
                          onClick={() => handleCopyDay(day)}
                          className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium text-sys-text-secondary hover:text-sys-text-primary hover:bg-slate-100 dark:hover:bg-white/5 text-left"
                        >
                          <span>📋</span>
                          <span>Копіювати день</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMoveDay(day)}
                          className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium text-sys-text-secondary hover:text-sys-text-primary hover:bg-slate-100 dark:hover:bg-white/5 text-left"
                        >
                          <span>✂️</span>
                          <span>Перемістити день</span>
                        </button>
                        {isDayBufferTarget && (
                          <button
                            type="button"
                            onClick={() => handlePasteDay(day)}
                            className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-bold text-indigo-400 bg-indigo-500/10 hover:bg-indigo-500/20 text-left"
                          >
                            <span>📥</span>
                            <span>Вставити день сюди</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 4 standard lesson slots */}
                  <div className="space-y-2.5">
                    {[1, 2, 3, 4].map((slotNum) => {
                      const slotLessons = dayLessons.filter((l) => l.lesson_number === slotNum);
                      const hasLessons = slotLessons.length > 0;
                      const slotId = `perm-slot-${day}-${slotNum}`;

                      return (
                        <div
                          key={slotNum}
                          id={slotId}
                          className="rounded-xl border border-sys-border/60 bg-sys-bg/40 p-2 transition-all duration-300"
                        >
                          <div className="flex items-center justify-between pb-1 mb-1.5 border-b border-sys-border/20 text-[11px] text-sys-text-muted">
                            <span className="font-semibold">{slotNum}-та пара</span>
                            <span>{DEFAULT_LESSON_TIMES[slotNum]}</span>
                          </div>

                          {hasLessons ? (
                            <div className="space-y-2">
                              {slotLessons.map((lesson) => (
                                <LessonCard
                                  key={lesson.id}
                                  lesson={lesson}
                                  targetDate=""
                                  mode="week"
                                  scheduleMode={mode}
                                  canEdit={true}
                                  isTemplateMode={true}
                                  hideTimeColumn={true}
                                  onEdit={() => setEditor({ lesson, day_of_week: day, lesson_number: slotNum })}
                                  onDeleteTemplate={handleDelete}
                                  onCopySelect={() => handleCopySelect(lesson)}
                                  onMoveSelect={() => handleMoveSelect(lesson)}
                                  onSwapSelect={() => handleSwapSelect(lesson)}
                                  isSwapSource={swapSource?.lesson.id === lesson.id}
                                />
                              ))}
                            </div>
                          ) : (
                            <div className="flex flex-col items-center justify-center py-2 text-center">
                              {buffer ? (
                                <button
                                  type="button"
                                  onClick={() => handlePasteToSlot(day, slotNum)}
                                  className="w-full rounded-lg border border-dashed border-indigo-500/50 bg-indigo-500/10 py-1.5 text-xs font-bold text-indigo-300 hover:bg-indigo-500/20 transition-colors"
                                >
                                  📥 {buffer.mode === "copy" ? "Вставити сюди" : "Перемістити сюди"}
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setEditor({ day_of_week: day, lesson_number: slotNum })}
                                  className="w-full rounded-lg border border-dashed border-sys-border/60 bg-white/5 py-1 text-xs font-medium text-sys-text-secondary hover:text-sys-text-primary hover:border-sys-accent/60 transition-colors"
                                >
                                  + Додати
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Mobile View (<640px) */}
          <div ref={mobileScheduleRef} id="perm-mobile-schedule" className="sm:hidden -mx-4 -mt-2 space-y-2">
            {/* Unified Mobile Days Strip */}
            <div
              role="tablist"
              aria-label="Дні тижня"
              className="relative flex h-11 w-full border-b border-sys-border/60 bg-sys-card/95 backdrop-blur-xs select-none"
            >
              {/* Sliding indicator line at bottom */}
              <div
                aria-hidden="true"
                className="absolute bottom-0 left-0 h-[2.5px] bg-indigo-500 transition-transform duration-180 ease-smooth motion-reduce:transition-none"
                style={{
                  width: "20%",
                  transform: `translateX(${selectedMobileDayIndex * 100}%)`,
                }}
              />

              {DAYS.map(({ day, short }, idx) => {
                const isSelected = selectedMobileDayIndex === idx;
                const dayLessons = templateData.days.find((d) => d.day_of_week === day)?.lessons || [];
                const count = dayLessons.length;
                return (
                  <button
                    key={day}
                    type="button"
                    role="tab"
                    aria-selected={isSelected}
                    tabIndex={isSelected ? 0 : -1}
                    onClick={() => {
                      setDaySlideDir(idx > selectedMobileDayIndex ? 1 : -1);
                      setSelectedMobileDayIndex(idx);
                      scrollToMobileSchedule();
                    }}
                    className={`relative flex h-full w-1/5 flex-col items-center justify-center py-1 transition-colors duration-150 active:scale-[0.96] motion-reduce:transition-none focus:outline-none ${
                      isSelected
                        ? "text-indigo-400 font-bold"
                        : "text-sys-text-secondary hover:text-sys-text-primary"
                    }`}
                  >
                    <span className="text-[12px] font-semibold leading-tight">
                      {short}
                    </span>
                    <div className="flex items-center gap-0.5 mt-0.5">
                      <span className={`text-[11px] leading-tight ${isSelected ? "font-bold text-indigo-400" : "text-sys-text-muted font-medium"}`}>
                        {count > 0 ? `${count} ${count === 1 ? "пара" : count < 5 ? "пари" : "пар"}` : "—"}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Mobile Day Content */}
            <div
              className="px-4 py-2 space-y-3 touch-pan-y min-h-[300px]"
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
            >
              <AnimatePresence initial={false} custom={daySlideDir} mode="popLayout">
                {(() => {
                  const currentDayDef = DAYS[selectedMobileDayIndex];
                  const dayLessons = templateData.days.find((d) => d.day_of_week === currentDayDef.day)?.lessons || [];

                  return (
                    <motion.div
                      key={`${currentDayDef.day}-${weekType}`}
                      custom={daySlideDir}
                      variants={{
                        enter: (dir: number) => ({
                          x: dir > 0 ? 8 : dir < 0 ? -8 : 0,
                          opacity: 0,
                        }),
                        center: {
                          x: 0,
                          opacity: 1,
                        },
                        exit: (dir: number) => ({
                          x: dir > 0 ? -8 : dir < 0 ? 8 : 0,
                          opacity: 0,
                        }),
                      }}
                      initial="enter"
                      animate="center"
                      exit="exit"
                      transition={{
                        duration: shouldReduceMotion ? 0 : 0.15,
                        ease: "easeOut",
                      }}
                      className="space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-semibold capitalize text-sys-text-primary">
                          {currentDayDef.name}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setMobileActionsDay(currentDayDef.day)}
                            className="min-h-[40px] px-3 rounded-lg border border-sys-border bg-sys-card text-xs font-semibold text-sys-text-secondary hover:text-sys-text-primary"
                          >
                            ⋯ Дії
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditor({ day_of_week: currentDayDef.day })}
                            className="min-h-[40px] px-3.5 rounded-lg bg-sys-accent text-xs font-semibold text-white shadow-xs hover:opacity-95 active:scale-95 transition-all"
                          >
                            + Додати
                          </button>
                        </div>
                      </div>

                    <div className="space-y-3">
                      {[1, 2, 3, 4].map((slotNum) => {
                        const slotLessons = dayLessons.filter((l) => l.lesson_number === slotNum);
                        const hasLessons = slotLessons.length > 0;
                        const slotId = `perm-slot-${currentDayDef.day}-${slotNum}`;

                        return (
                          <div
                            key={slotNum}
                            id={slotId}
                            className="rounded-xl border border-sys-border bg-sys-card/70 p-3 shadow-xs"
                          >
                            <div className="flex items-center justify-between pb-1.5 mb-2 border-b border-sys-border/30 text-xs">
                              <span className="font-bold text-sys-text-primary">{slotNum}-та пара</span>
                              <span className="text-[11px] text-sys-text-muted">{DEFAULT_LESSON_TIMES[slotNum]}</span>
                            </div>

                            {hasLessons ? (
                              <div className="space-y-2">
                                {slotLessons.map((lesson) => (
                                  <LessonCard
                                    key={lesson.id}
                                    lesson={lesson}
                                    targetDate=""
                                    mode="day"
                                    scheduleMode={mode}
                                    canEdit={true}
                                    isTemplateMode={true}
                                    hideTimeColumn={true}
                                    onEdit={() => setEditor({ lesson, day_of_week: currentDayDef.day, lesson_number: slotNum })}
                                    onDeleteTemplate={handleDelete}
                                    onCopySelect={() => handleCopySelect(lesson)}
                                    onMoveSelect={() => handleMoveSelect(lesson)}
                                    onSwapSelect={() => handleSwapSelect(lesson)}
                                    isSwapSource={swapSource?.lesson.id === lesson.id}
                                  />
                                ))}
                              </div>
                            ) : (
                              <div className="flex flex-col sm:flex-row items-center justify-between gap-2 py-1">
                                <span className="text-xs text-sys-text-muted/60">Пари немає</span>
                                <div className="flex items-center gap-2 w-full sm:w-auto">
                                  {buffer ? (
                                    <button
                                      type="button"
                                      onClick={() => handlePasteToSlot(currentDayDef.day, slotNum)}
                                      className="flex-1 sm:flex-none min-h-[38px] px-3 rounded-lg border border-dashed border-indigo-500/50 bg-indigo-500/10 text-xs font-bold text-indigo-300 hover:bg-indigo-500/20"
                                    >
                                      📥 {buffer.mode === "copy" ? "Вставити сюди" : "Перемістити сюди"}
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => setEditor({ day_of_week: currentDayDef.day, lesson_number: slotNum })}
                                      className="flex-1 sm:flex-none min-h-[38px] px-3 rounded-lg border border-dashed border-sys-border bg-white/5 text-xs font-medium text-sys-text-secondary hover:text-sys-text-primary"
                                    >
                                      + Додати пару
                                    </button>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </motion.div>
                );
              })()}
              </AnimatePresence>
            </div>
          </div>
        </div>
      ) : null}

      {/* Lesson Editor Modal */}
      {editor && (
        <LessonEditor
          lesson={editor.lesson}
          date=""
          scheduleMode={mode}
          defaultGroupId={groupId}
          defaultTeacherId={teacherId}
          groups={groups}
          initialWeekType={weekType}
          onClose={() => setEditor(null)}
          onSave={handleCreateOrUpdate}
          onDelete={editor.lesson ? () => handleDelete(editor.lesson!) : undefined}
          isTemplate={true}
        />
      )}

      {/* Mobile Day Actions Sheet */}
      <AnimatePresence>
        {mobileActionsDay !== null && (
          <div
            onClick={(e) => {
              if (e.target === e.currentTarget) setMobileActionsDay(null);
            }}
            className="fixed inset-0 z-50 flex items-end sm:hidden"
          >
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: shouldReduceMotion ? 0 : 0.18 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-xs"
              onClick={() => setMobileActionsDay(null)}
            />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{
                duration: shouldReduceMotion ? 0 : 0.22,
                ease: [0.2, 0, 0, 1],
              }}
              className="relative z-10 w-full rounded-t-2xl border-t border-sys-border bg-sys-card p-5 space-y-4 shadow-xl pb-safe"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-sys-text-primary">
                  Дії для дня: {DAYS.find((d) => d.day === mobileActionsDay)?.name}
                </span>
                <button
                  type="button"
                  onClick={() => setMobileActionsDay(null)}
                  className="h-8 w-8 rounded-lg flex items-center justify-center text-sys-text-secondary hover:text-sys-text-primary"
                >
                  ✕
                </button>
              </div>
              <div className="grid grid-cols-1 gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    const d = mobileActionsDay;
                    setMobileActionsDay(null);
                    handleCopyDay(d);
                  }}
                  className="flex items-center gap-3 w-full rounded-xl border border-sys-border bg-sys-bg/60 p-3 text-left text-sm font-medium text-sys-text-primary hover:bg-sys-bg"
                >
                  <span className="text-base">📋</span>
                  <span>Копіювати цей день</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const d = mobileActionsDay;
                    setMobileActionsDay(null);
                    handleMoveDay(d);
                  }}
                  className="flex items-center gap-3 w-full rounded-xl border border-sys-border bg-sys-bg/60 p-3 text-left text-sm font-medium text-sys-text-primary hover:bg-sys-bg"
                >
                  <span className="text-base">✂️</span>
                  <span>Перемістити цей день</span>
                </button>
                {buffer?.type === "day" && (
                  <button
                    type="button"
                    onClick={() => {
                      const d = mobileActionsDay;
                      setMobileActionsDay(null);
                      handlePasteDay(d);
                    }}
                    className="flex items-center gap-3 w-full rounded-xl border border-indigo-500/40 bg-indigo-500/15 p-3 text-left text-sm font-bold text-indigo-400 hover:bg-indigo-500/25"
                  >
                    <span className="text-base">📥</span>
                    <span>Вставити день у цей день</span>
                  </button>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
