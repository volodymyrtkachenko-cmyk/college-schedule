"use client";

import React, { useEffect, useMemo, useState, startTransition } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { ScheduleResponse, Lesson, ReferenceRecord } from "../lib/api";
import {
  extractClassroomTaskKey,
  useClassroomSubmissions,
} from "../lib/useClassroomSubmissions";
import { useTeacherAccess } from "../lib/useTeacherAccess";
import { useUserSettings } from "../lib/useUserSettings";
import { useMobileNav } from "../lib/useMobileNav";
import {
  checkScheduleHasSubgroups,
  extractSubgroupTeacherHints,
  normalizeSubjectName,
} from "../lib/format";
import { getGroupFullCode } from "../lib/groupInfo";

export interface GuideHubModalProps {
  isOpen?: boolean;
  onClose: () => void;
  initialRole?: "student" | "teacher";
  mode?: "student" | "teacher";
  groupId?: number | null;
  teacherId?: number | null;
}

interface GuideStepMeta {
  id: string;
  tabLabel: string;
  title: string;
  points: [string, string];
}

interface PersonalizedContext {
  groupName: string;
  groupFullCode: string;
  teacherName: string;
  hasSubgroups: boolean;
  /* Student lessons */
  mainSubject: string;
  mainTeacher: string;
  splitSubject: string;
  sub1Teacher: string;
  sub2Teacher: string;
  sub2Room: string;
  zoomSubject: string;
  zoomTeacher: string;
  jumpSubject: string;
  jumpTeacher: string;
  jumpRoom: string;
  /* Student Classroom data */
  sampleTaskTitle: string;
  sampleTaskSubject: string;
  sampleTaskTeacher: string;
  sampleTaskDue: string;
  overdueTaskTitle: string;
  overdueTaskSubject: string;
  pendingCount: number;
  overdueCount: number;
  doneCount: number;
  gpa5: string;
  gpa12: string;
  gradeSubject: string;
  gradeTeacher: string;
  gradeChips: string[];
  /* Teacher data */
  teacherSubject: string;
  teacherSecondSubject: string;
  teacherGroup: string;
  teacherSecondGroup: string;
  teacherRoom: string;
}

const FINAL_MS = 4800;
const TICK_MS = 80;

function PlatformSvg({ platform }: { platform: "meet" | "zoom" }) {
  if (platform === "zoom") {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="shrink-0">
        <path d="M15 8c0-.55-.45-1-1-1H3c-.55 0-1 .45-1 1v8c0 .55.45 1 1 1h11c.55 0 1-.45 1-1v-3.24l4.39 3.59c.35.29.88 0 .88-.45V7.1c0-.45-.53-.74-.88-.45L15 10.24V8z" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="shrink-0">
      <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" />
    </svg>
  );
}

function UserSvg() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-sys-text-muted shrink-0"
    >
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function ClipboardSvg() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-sys-text-muted"
    >
      <path d="M16 4h2a2 2 0 0 1 2 2v14l-8-4-8 4V6a2 2 0 0 1 2-2h2" />
      <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
    </svg>
  );
}

function DemoCursor({
  x,
  y,
  clicking,
  hidden = false,
}: {
  x: string;
  y: string;
  clicking: boolean;
  hidden?: boolean;
}) {
  return (
    <motion.div
      aria-hidden="true"
      initial={false}
      animate={{
        left: x,
        top: y,
        scale: clicking ? 0.84 : 1,
        opacity: hidden ? 0 : 1,
      }}
      transition={{
        left: { type: "tween", duration: 0.36, ease: [0.22, 1, 0.36, 1] },
        top: { type: "tween", duration: 0.36, ease: [0.22, 1, 0.36, 1] },
        scale: { duration: 0.12, ease: "easeOut" },
        opacity: { duration: 0.25, ease: "easeOut" },
      }}
      className="pointer-events-none absolute z-30 -translate-x-1 -translate-y-1 will-change-[left,top,transform,opacity]"
    >
      <AnimatePresence>
        {clicking && !hidden && (
          <motion.span
            key="click-ripple"
            initial={{ scale: 0.35, opacity: 0.95 }}
            animate={{ scale: 2.25, opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.42, ease: "easeOut" }}
            className="absolute -left-2.5 -top-2.5 h-7 w-7 rounded-full border-2 border-sys-accent bg-sys-accent/35"
          />
        )}
      </AnimatePresence>

      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        className="drop-shadow-[0_4px_10px_rgba(0,0,0,0.65)]"
      >
        <path
          d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87c.45 0 .67-.53.35-.85L6.35 2.86a.5.5 0 0 0-.85.35Z"
          fill="#ffffff"
          stroke="#0f172a"
          strokeWidth="1.75"
          strokeLinejoin="round"
        />
      </svg>
    </motion.div>
  );
}

/**
 * Зчитує реальні дані користувача з localStorage (група, викладач, предмети, підгрупи, завдання, оцінки)
 * без жодних мережевих запитів.
 */
function buildPersonalizedContext(
  groupId: number | null | undefined,
  teacherId: number | null | undefined,
  isLinked: boolean,
  submissions: Record<string, { state: string; grade?: number | null; maxPoints?: number | null }>
): PersonalizedContext {
  const ctx: PersonalizedContext = {
    groupName: "85",
    groupFullCode: "КІ-24-1/9-85",
    teacherName: "Дворніченко Н.Ф.",
    hasSubgroups: true,
    mainSubject: "Дискретна математика",
    mainTeacher: "Гончаров О.М.",
    splitSubject: "Іноземна мова (за проф. спрямуванням)",
    sub1Teacher: "Хочинська О.С.",
    sub2Teacher: "Токарєва О.В.",
    sub2Room: "419",
    zoomSubject: "Комп'ютерна електроніка",
    zoomTeacher: "Філімончук А.В.",
    jumpSubject: "Комп'ютерна схемотехніка",
    jumpTeacher: "Дворніченко Н.Ф.",
    jumpRoom: "305",
    sampleTaskTitle: "Практична робота №5",
    sampleTaskSubject: "Комп'ютерна схемотехніка",
    sampleTaskTeacher: "Дворніченко Н.Ф.",
    sampleTaskDue: "до 15 лист.",
    overdueTaskTitle: "Лабораторна робота №2",
    overdueTaskSubject: "Дискретна математика",
    pendingCount: 3,
    overdueCount: 1,
    doneCount: 14,
    gpa5: "4.75",
    gpa12: "11.0",
    gradeSubject: "Дискретна математика",
    gradeTeacher: "Гончаров О.М.",
    gradeChips: ["11 б.", "12 б.", "10 б."],
    teacherSubject: "Комп'ютерна схемотехніка",
    teacherSecondSubject: "Мікропроцесорні системи",
    teacherGroup: "85",
    teacherSecondGroup: "86",
    teacherRoom: "305",
  };

  if (typeof window === "undefined") return ctx;

  try {
    const resolvedGid =
      groupId ||
      Number(window.localStorage.getItem("schedule:groupId")) ||
      Number(window.localStorage.getItem("schedule:classroom_linked_group_id")) ||
      null;

    const resolvedTid =
      teacherId || Number(window.localStorage.getItem("schedule:teacherId")) || null;

    // 1. Назва та шифр групи
    const rawGroups = window.localStorage.getItem("schedule:groups");
    if (rawGroups && resolvedGid) {
      const groups = JSON.parse(rawGroups) as ReferenceRecord[];
      const foundGroup = groups.find((g) => Number(g.id) === Number(resolvedGid));
      if (foundGroup?.name) {
        ctx.groupName = foundGroup.name;
        ctx.groupFullCode = getGroupFullCode(foundGroup);
      }
    }

    // 2. Ім'я викладача
    const rawTeachers = window.localStorage.getItem("schedule:teachers");
    if (rawTeachers && resolvedTid) {
      const teachers = JSON.parse(rawTeachers) as ReferenceRecord[];
      const foundTeacher = teachers.find((t) => Number(t.id) === Number(resolvedTid));
      if (foundTeacher?.name) {
        ctx.teacherName = foundTeacher.name;
      }
    }

    // 3. Реальні пари з кешу тижня студента
    if (resolvedGid) {
      const prefix = `schedule:week:groupId:${resolvedGid}:`;
      let studentLessons: Lesson[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k && k.startsWith(prefix)) {
          const raw = window.localStorage.getItem(k);
          if (raw) {
            const parsed = JSON.parse(raw) as ScheduleResponse[];
            if (Array.isArray(parsed) && parsed.length > 0) {
              studentLessons = parsed.flatMap((d) => d.lessons || []).filter((l) => !l.is_cancelled);
              if (studentLessons.length > 0) break;
            }
          }
        }
      }

      if (studentLessons.length > 0) {
        ctx.hasSubgroups = checkScheduleHasSubgroups(studentLessons);
        const hints = extractSubgroupTeacherHints(studentLessons);
        if (hints.sub1[0]) {
          ctx.sub1Teacher = hints.sub1[0].teacher;
          if (hints.sub1[0].subject) ctx.splitSubject = hints.sub1[0].subject;
        }
        if (hints.sub2[0]) {
          ctx.sub2Teacher = hints.sub2[0].teacher;
        }

        const splitLesson = studentLessons.find(
          (l) => l.second_teacher_id != null || (l.teacher_name && /[,/]/.test(l.teacher_name))
        );
        if (splitLesson) {
          const r = splitLesson.second_teacher_room || splitLesson.room;
          if (r) ctx.sub2Room = r.replace(/^ауд\.?\s*/i, "").split(/[,/]/)[0].trim();
        }

        // Унікальні не-розділені предмети цієї групи
        const singleLessons = studentLessons.filter(
          (l) =>
            l.subject_name &&
            l.teacher_name &&
            !l.second_teacher_id &&
            !/[,/]/.test(l.teacher_name) &&
            !l.subject_name.toLowerCase().includes("виховна") &&
            !l.subject_name.toLowerCase().includes("фізичн")
        );

        const uniqueSingles: Lesson[] = [];
        const seenSubj = new Set<string>();
        for (const l of singleLessons) {
          if (!seenSubj.has(l.subject_name)) {
            seenSubj.add(l.subject_name);
            uniqueSingles.push(l);
          }
        }

        if (uniqueSingles[0]) {
          ctx.mainSubject = uniqueSingles[0].subject_name;
          ctx.mainTeacher = uniqueSingles[0].teacher_name || ctx.mainTeacher;
          ctx.gradeSubject = uniqueSingles[0].subject_name;
          ctx.gradeTeacher = uniqueSingles[0].teacher_name || ctx.gradeTeacher;
        }
        if (uniqueSingles[1]) {
          ctx.zoomSubject = uniqueSingles[1].subject_name;
          ctx.zoomTeacher = uniqueSingles[1].teacher_name || ctx.zoomTeacher;
        }
        const jumpCandidate = uniqueSingles[2] || uniqueSingles[1] || uniqueSingles[0];
        if (jumpCandidate) {
          ctx.jumpSubject = jumpCandidate.subject_name;
          ctx.jumpTeacher = jumpCandidate.teacher_name || ctx.jumpTeacher;
          if (jumpCandidate.room) {
            ctx.jumpRoom = jumpCandidate.room.replace(/^ауд\.?\s*/i, "").trim();
          }
        }
      }

      // 4. Реальні завдання та оцінки групи з Classroom кешу
      const rawTasks =
        window.localStorage.getItem(`schedule:classroom_group_tasks:${resolvedGid}`) ||
        window.localStorage.getItem("schedule:classroom_tasks");
      if (rawTasks) {
        const taskList = JSON.parse(rawTasks);
        if (Array.isArray(taskList) && taskList.length > 0) {
          let pending = 0;
          let overdue = 0;
          let done = 0;
          const todayIso = new Date().toISOString().split("T")[0];

          for (const t of taskList) {
            const url = t?.url || t?.alternate_link;
            const key = extractClassroomTaskKey(url);
            const sub = url ? submissions[url] || (key ? submissions[key] : null) : null;
            const st = sub?.state || t?.state || "NEW";
            const isTaskDone = isLinked && (st === "TURNED_IN" || st === "RETURNED");

            if (isTaskDone) {
              done++;
            } else if (t?.due_date && t.due_date < todayIso) {
              overdue++;
              if (overdue === 1 && t.title) {
                ctx.overdueTaskTitle = t.title;
                ctx.overdueTaskSubject =
                  normalizeSubjectName(t.subject || t.course_name) || ctx.mainSubject;
              }
            } else {
              pending++;
              if (pending === 1 && t.title) {
                ctx.sampleTaskTitle = t.title;
                ctx.sampleTaskSubject =
                  normalizeSubjectName(t.subject || t.course_name) || ctx.jumpSubject;
                if (t.due_date) {
                  const parts = String(t.due_date).split("-");
                  if (parts.length === 3) {
                    ctx.sampleTaskDue = `до ${parseInt(parts[2], 10)}.${parts[1]}`;
                  }
                }
              }
            }
          }

          if (pending + overdue + done > 0) {
            ctx.pendingCount = pending;
            ctx.overdueCount = overdue;
            ctx.doneCount = done;
          }
        }
      }
    }

    // 5. Реальні пари з кешу тижня викладача
    if (resolvedTid) {
      const tPrefix = `schedule:week:teacherId:${resolvedTid}:`;
      let teacherLessons: Lesson[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k && k.startsWith(tPrefix)) {
          const raw = window.localStorage.getItem(k);
          if (raw) {
            const parsed = JSON.parse(raw) as ScheduleResponse[];
            if (Array.isArray(parsed) && parsed.length > 0) {
              teacherLessons = parsed.flatMap((d) => d.lessons || []).filter((l) => !l.is_cancelled);
              if (teacherLessons.length > 0) break;
            }
          }
        }
      }

      if (teacherLessons.length > 0) {
        const firstL = teacherLessons[0];
        if (firstL.subject_name) ctx.teacherSubject = firstL.subject_name;
        if (firstL.group_name) ctx.teacherGroup = firstL.group_name;
        if (firstL.room) ctx.teacherRoom = firstL.room.replace(/^ауд\.?\s*/i, "").trim();

        const otherSubj = teacherLessons.find(
          (l) => l.subject_name && l.subject_name !== ctx.teacherSubject
        );
        if (otherSubj?.subject_name) ctx.teacherSecondSubject = otherSubj.subject_name;

        const otherGrp = teacherLessons.find(
          (l) => l.group_name && l.group_name !== ctx.teacherGroup
        );
        if (otherGrp?.group_name) ctx.teacherSecondGroup = otherGrp.group_name;
      }
    }
  } catch {}

  return ctx;
}

export function GuideHubModal({
  isOpen = true,
  onClose,
  initialRole,
  mode,
  groupId,
  teacherId,
}: GuideHubModalProps) {
  const router = useRouter();
  const { setHomeTab } = useMobileNav();
  const { isLinked, linkedEmail, submissions } = useClassroomSubmissions();
  const { isTeacherUnlocked } = useTeacherAccess();
  const { settings, updateSetting } = useUserSettings();

  const [role, setRole] = useState<"student" | "teacher">(initialRole ?? mode ?? "student");
  const [stepIdx, setStepIdx] = useState(0);
  const [slideDir, setSlideDir] = useState(1);
  const [elapsedMs, setElapsedMs] = useState(0);

  // Персоналізовані дані поточного користувача
  const pCtx = useMemo(
    () => buildPersonalizedContext(groupId, teacherId, isLinked, submissions),
    [groupId, teacherId, isLinked, submissions]
  );

  // Яку підгрупу показувати як цільову в демо (якщо студент обрав 2 — показуємо 2 підгр.)
  const targetDemoSubgroup: 1 | 2 = settings.defaultSubgroup === 2 ? 2 : 1;

  const studentSteps = useMemo<GuideStepMeta[]>(
    () => [
      {
        id: "st-1-classroom",
        tabLabel: isLinked ? "Classroom ✓" : "Classroom",
        title: `1. Пошта @kre.dp.ua для групи ${pCtx.groupName}`,
        points: [
          "Натисніть на «🔒 Meet / Zoom» або кнопку Classroom у шапці й оберіть свій акаунт @kre.dp.ua.",
          "Замочки зникнуть, до карток пар підтягнуться ваші домашні завдання, а дані синхронізуються між ПК і телефоном.",
        ],
      },
      {
        id: "st-2-subgroup",
        tabLabel: settings.defaultSubgroup !== "all" ? `Підгрупи (${settings.defaultSubgroup}) ✓` : "Підгрупи",
        title: `2. Фільтр своєї підгрупи (${pCtx.sub1Teacher} / ${pCtx.sub2Teacher})`,
        points: [
          "Натисніть на бейдж «1 підгр.» або «2 підгр.» прямо на картці пари — інший викладач і чужий кабінет сховаються.",
          "Повторний клік по бейджу підгрупи миттєво повертає показ обох підгруп.",
        ],
      },
      {
        id: "st-3-zoom",
        tabLabel: "Код Zoom",
        title: "3. Автокопіювання пароля Zoom при кліку",
        points: [
          "Система сама знаходить ID та пароль у тексті викладача з Classroom і створює кнопку «Zoom ↗».",
          "При натисканні на «Zoom ↗» пароль конференції автоматично копіюється в буфер обміну.",
        ],
      },
      {
        id: "st-4-tasks",
        tabLabel: "Завдання",
        title: "4. Усі завдання в одному списку без гортання тижнів",
        points: [
          "У вкладці «Завдання» роботи поділені на «До здачі», «Борги» та «Здано», щоб старі борги не губилися.",
          "Фільтр «Усі предмети» дозволяє залишити завдання лише з потрібної дисципліни.",
        ],
      },
      {
        id: "st-5-grades",
        tabLabel: "Оцінки",
        title: "5. Середній бал та всі оцінки за семестр",
        points: [
          "Вкладка «Оцінки» автоматично рахує загальний середній бал (за 5-бальною та 12-бальною шкалами).",
          "Натисніть на предмет, щоб переглянути всі оцінені роботи з автоматичним перерахунком зі 100-бальної шкали.",
        ],
      },
      {
        id: "st-7-teacher-jump",
        tabLabel: "Викладач",
        title: `6. Швидкий перехід у розклад викладача (${pCtx.jumpTeacher})`,
        points: [
          "Натисніть на прізвище викладача на картці пари, щоб побачити його розклад та аудиторію на сьогодні.",
          `Кнопка «← До ${pCtx.groupName}» у верхній плашці миттєво поверне вас назад до розкладу своєї групи.`,
        ],
      },
    ],
    [isLinked, settings.defaultSubgroup, pCtx]
  );

  const teacherSteps = useMemo<GuideStepMeta[]>(
    () => [
      {
        id: "tc-1-pin",
        tabLabel: isTeacherUnlocked ? "PIN-код ✓" : "PIN-код",
        title: "1. PIN-код для відкриття посилань Meet та Zoom",
        points: [
          "Натисніть на «🔒 Zoom / Meet» або кнопку «Вхід викладача» у шапці та введіть PIN-код один раз.",
          "Усі посилання на онлайн-пари відкриються на цьому пристрої для всіх навчальних груп.",
        ],
      },
      {
        id: "tc-4-stats",
        tabLabel: "Статистика",
        title: `2. Статистика проведених пар та годин (${pCtx.teacherName})`,
        points: [
          "Сторінка «Статистика» автоматично рахує вичитані академічні години та пари від початку семестру.",
          "Доступний розподіл навантаження за кожною дисципліною та кожною навчальною групою.",
        ],
      },
      {
        id: "tc-5-radar",
        tabLabel: "Заміни",
        title: "3. Позначки замін та перенесень у розкладі",
        points: [
          "Перенесені заняття підписуються новою датою й номером пари («↪ Перенесено → Четвер, 3 пара»).",
          "Призначені разові заміни виділяються жовтою рамкою та бейджем «⚡ Заміна».",
        ],
      },
    ],
    [isTeacherUnlocked, pCtx.teacherName]
  );

  const steps = role === "student" ? studentSteps : teacherSteps;
  const stepsCount = steps.length;

  // Розумний вибір стартової вкладки: якщо базова дія вже виконана, одразу показуємо наступну корисну фішку
  useEffect(() => {
    if (!isOpen || typeof window === "undefined") return;
    setElapsedMs(0);

    let resolvedRole: "student" | "teacher" = initialRole ?? mode ?? "student";
    try {
      const storedMode = window.localStorage.getItem("schedule:mode");
      if (!initialRole && !mode && (storedMode === "student" || storedMode === "teacher")) {
        resolvedRole = storedMode;
      }
    } catch {}
    setRole(resolvedRole);

    if (resolvedRole === "student") {
      if (!isLinked) {
        setStepIdx(0); // Пошта ще не прив'язана -> показуємо крок 1 (Classroom)
      } else if (pCtx.hasSubgroups && settings.defaultSubgroup === "all") {
        setStepIdx(1); // Пошта прив'язана, але підгрупа не обрана -> показуємо крок 2 (Підгрупи)
      } else {
        setStepIdx(2); // Обидва базові кроки вже налаштовані -> показуємо крок 3 (Код Zoom)
      }
    } else {
      setStepIdx(isTeacherUnlocked ? 1 : 0);
    }
  }, [isOpen, initialRole, mode]);

  useEffect(() => {
    if (!isOpen || elapsedMs >= FINAL_MS) return;
    const timer = setInterval(() => {
      setElapsedMs((prev) => Math.min(FINAL_MS, prev + TICK_MS));
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [isOpen, elapsedMs, stepIdx, role]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") {
        setSlideDir(1);
        setStepIdx((c) => Math.min(stepsCount - 1, c + 1));
        setElapsedMs(0);
      }
      if (e.key === "ArrowLeft") {
        setSlideDir(-1);
        setStepIdx((c) => Math.max(0, c - 1));
        setElapsedMs(0);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose, stepsCount]);

  if (!isOpen) return null;

  const safeIdx = stepIdx < stepsCount ? stepIdx : 0;
  const activeStep = steps[safeIdx] ?? steps[0];

  const stage =
    elapsedMs < 900
      ? 0
      : elapsedMs < 1750
      ? 1
      : elapsedMs < 2350
      ? 2
      : 3;

  const isCursorHidden = elapsedMs >= 3400;

  const goToStep = (nextIdx: number) => {
    startTransition(() => {
      setSlideDir(nextIdx >= safeIdx ? 1 : -1);
      setStepIdx(nextIdx);
      setElapsedMs(0);
    });
  };

  const handleRoleChange = (nextRole: "student" | "teacher") => {
    if (nextRole === role) return;
    startTransition(() => {
      setSlideDir(nextRole === "teacher" ? 1 : -1);
      setRole(nextRole);
      setStepIdx(0);
      setElapsedMs(0);
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 sm:bg-black/70 sm:backdrop-blur-xs p-0 sm:p-4 animate-in fade-in duration-150"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="guide-title"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-[500px] max-h-[92dvh] flex flex-col rounded-t-2xl sm:rounded-2xl border border-sys-border bg-sys-card text-sys-text-primary shadow-2xl overflow-hidden select-none"
      >
        {/* 1. ШАПКА З ПЕРСОНАЛЬНИМ КОНТЕКСТОМ ГРУПИ / ВИКЛАДАЧА */}
        <div className="px-4 pt-3.5 pb-2.5 bg-sys-surface border-b border-sys-border space-y-2.5 shrink-0">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h2 id="guide-title" className="text-sm sm:text-base font-bold text-sys-text-primary truncate">
                Як користуватися розкладом
              </h2>
              <p className="text-[11px] font-medium text-sys-text-secondary truncate">
                {role === "student"
                  ? `Група ${pCtx.groupName} (${pCtx.groupFullCode})${
                      settings.defaultSubgroup !== "all" ? ` · ${settings.defaultSubgroup} підгр.` : ""
                    }`
                  : `Викладач: ${pCtx.teacherName}`}
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <div className="relative inline-grid grid-cols-2 rounded-lg border border-sys-border bg-sys-bg p-0.5 text-xs font-semibold isolate">
                <div
                  aria-hidden="true"
                  className="absolute top-0.5 bottom-0.5 pointer-events-none transition-transform duration-200 ease-out transform-gpu will-change-transform z-0"
                  style={{
                    left: "2px",
                    width: "calc((100% - 4px) / 2)",
                    transform: `translate3d(${role === "teacher" ? "100%" : "0%"}, 0, 0)`,
                  }}
                >
                  <div className="h-full w-full rounded-md bg-sys-accentSolid shadow-2xs" />
                </div>
                <button
                  type="button"
                  onClick={() => handleRoleChange("student")}
                  className={`relative z-10 px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                    role === "student" ? "text-white font-bold" : "text-sys-text-secondary hover:text-sys-text-primary"
                  }`}
                >
                  Студент
                </button>
                <button
                  type="button"
                  onClick={() => handleRoleChange("teacher")}
                  className={`relative z-10 px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                    role === "teacher" ? "text-white font-bold" : "text-sys-text-secondary hover:text-sys-text-primary"
                  }`}
                >
                  Викладач
                </button>
              </div>

              <button
                type="button"
                onClick={onClose}
                aria-label="Закрити"
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-sys-border bg-sys-bg text-sys-text-secondary hover:text-sys-text-primary active:scale-95 transition-colors cursor-pointer text-xs"
              >
                ✕
              </button>
            </div>
          </div>

          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar rounded-xl border border-sys-border bg-sys-bg p-1 text-[11px] font-semibold">
            {steps.map((s, idx) => {
              const isCurrent = idx === safeIdx;
              const isConfigured = s.tabLabel.endsWith("✓");
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => goToStep(idx)}
                  className={`shrink-0 flex-1 py-1.5 px-2 rounded-lg transition-colors duration-150 cursor-pointer whitespace-nowrap ${
                    isCurrent
                      ? "bg-sys-card text-sys-accent font-bold border border-sys-border shadow-2xs"
                      : isConfigured
                      ? "text-sys-status-okText font-semibold hover:text-sys-text-primary"
                      : "text-sys-text-secondary hover:text-sys-text-primary"
                  }`}
                >
                  {s.tabLabel}
                </button>
              );
            })}
          </div>
        </div>

        {/* 2. СЦЕНА З ВАШИМИ РЕАЛЬНИМИ ПРЕДМЕТАМИ ТА ВИКЛАДАЧАМИ */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
          <AnimatePresence mode="wait" initial={false} custom={slideDir}>
            <motion.div
              key={`${role}-${activeStep.id}`}
              custom={slideDir}
              initial={{ opacity: 0, x: slideDir * 14 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: slideDir * -14 }}
              transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
              className="space-y-3.5"
            >
              {/* STAGE (h-[228px]) */}
              <div className="relative mx-auto w-full h-[228px] rounded-2xl border border-sys-border bg-sys-bg p-3.5 flex flex-col justify-center overflow-hidden shadow-inner">
                {elapsedMs >= FINAL_MS && (
                  <button
                    type="button"
                    onClick={() => setElapsedMs(0)}
                    title="Повторити анімацію"
                    className="absolute top-2.5 right-2.5 z-40 rounded-lg border border-sys-border bg-sys-card/90 px-2 py-0.5 text-[11px] font-semibold text-sys-text-secondary hover:text-sys-accent active:scale-95 transition-colors cursor-pointer shadow-2xs"
                  >
                    ↻ Повторити
                  </button>
                )}

                {/* =====================================================
                    СТУДЕНТ 0: ПОШТА @kre.dp.ua (Реальна пара вашої групи)
                   ===================================================== */}
                {role === "student" && safeIdx === 0 && (
                  <div className="relative w-full max-w-[400px] mx-auto">
                    <DemoCursor
                      x={stage === 0 ? "45%" : stage <= 2 ? "84%" : "86%"}
                      y={stage === 0 ? "78%" : stage <= 2 ? "24%" : "72%"}
                      clicking={stage === 2}
                      hidden={isCursorHidden}
                    />

                    <div className="rounded-2xl border border-sys-border bg-sys-card p-4 shadow-sm space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-base font-black text-sys-text-primary leading-none">1</span>
                          <span className="text-sys-text-muted font-bold text-xs">·</span>
                          <span className="text-xs font-semibold text-sys-text-secondary">09:00–10:20</span>
                        </div>

                        {stage < 3 ? (
                          <span
                            className={`inline-flex h-8 px-2.5 items-center gap-1.5 rounded-lg border border-sys-status-warnBg/40 bg-sys-status-warnBg/15 text-sys-status-warnText text-xs font-bold transition-transform ${
                              stage === 2 ? "scale-95" : ""
                            }`}
                          >
                            <span>🔒</span>
                            <span>Meet</span>
                          </span>
                        ) : (
                          <span className="inline-flex h-8 px-2.5 items-center gap-1.5 rounded-lg border border-sys-status-okBg/50 bg-sys-status-okBg/15 text-sys-status-okText text-xs font-bold shadow-xs animate-in fade-in duration-150">
                            <PlatformSvg platform="meet" />
                            <span>Meet</span>
                            <span className="opacity-75">↗</span>
                          </span>
                        )}
                      </div>

                      <div>
                        <div className="text-base font-semibold text-sys-text-subject leading-snug truncate">
                          {pCtx.mainSubject}
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-sys-text-secondary mt-1">
                          <UserSvg />
                          <span>{pCtx.mainTeacher}</span>
                        </div>
                      </div>

                      {stage >= 3 && (
                        <div
                          className="flex items-center justify-between rounded-xl bg-sys-bg/60 border border-sys-border px-3.5 py-2.5 text-xs animate-in fade-in duration-150"
                          style={{ boxShadow: "inset 3px 0 0 #8b5cf6" }}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <ClipboardSvg />
                            <span className="font-semibold text-sys-text-primary truncate">
                              {pCtx.sampleTaskTitle}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0 ml-2">
                            <span className="h-1.5 w-1.5 rounded-full bg-sys-status-denomBg" />
                            <span className="text-sys-status-denomText font-medium">{pCtx.sampleTaskDue}</span>
                            <span className="text-sys-text-muted ml-0.5">↗</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* =====================================================
                    СТУДЕНТ 1: ПІДГРУПИ (Реальні викладачі 1 і 2 підгрупи вашої групи)
                   ===================================================== */}
                {role === "student" && safeIdx === 1 && (
                  <div className="relative w-full max-w-[400px] mx-auto">
                    <DemoCursor
                      x={stage === 0 ? "62%" : stage <= 2 ? "18%" : "78%"}
                      y={
                        stage === 0
                          ? "82%"
                          : stage <= 2
                          ? targetDemoSubgroup === 2
                            ? "78%"
                            : "56%"
                          : "24%"
                      }
                      clicking={stage === 2}
                      hidden={isCursorHidden}
                    />

                    <div className="rounded-2xl border border-sys-border bg-sys-card p-4 shadow-sm space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-base font-black text-sys-text-primary leading-none">2</span>
                          <span className="text-sys-text-muted font-bold text-xs">·</span>
                          <span className="text-xs font-semibold text-sys-text-secondary">10:40–12:00</span>
                        </div>
                        {stage >= 3 && (
                          <span className="inline-flex h-8 px-2.5 items-center gap-1.5 rounded-lg border border-sys-status-okBg/50 bg-sys-status-okBg/15 text-sys-status-okText text-xs font-bold animate-in fade-in duration-150">
                            <PlatformSvg platform="meet" />
                            <span>Meet</span>
                            <span className="opacity-75">↗</span>
                          </span>
                        )}
                      </div>

                      <div className="text-base font-semibold text-sys-text-subject leading-snug truncate">
                        {pCtx.splitSubject}
                      </div>

                      {/* Subgroup 1 Row */}
                      {(stage < 3 || targetDemoSubgroup === 1) && (
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className={`inline-flex shrink-0 items-center gap-1.5 h-6 px-2 rounded-md border text-xs font-semibold transition-colors ${
                                stage >= 3 && targetDemoSubgroup === 1
                                  ? "border-sys-accent/35 bg-sys-accent/15 text-sys-accent"
                                  : stage >= 1 && targetDemoSubgroup === 1
                                  ? "border-sys-accent/50 bg-sys-accent/10 text-sys-text-primary"
                                  : "bg-sys-bg/80 border-sys-border text-sys-text-secondary"
                              }`}
                            >
                              <span
                                className={`h-1.5 w-1.5 rounded-full ${
                                  stage >= 3 && targetDemoSubgroup === 1 ? "bg-sys-accent" : "bg-sys-text-muted/60"
                                }`}
                              />
                              <span>1 підгр.</span>
                            </span>
                            <UserSvg />
                            <span className="text-xs font-medium text-sys-text-secondary truncate">
                              {pCtx.sub1Teacher}
                            </span>
                          </div>

                          {stage < 3 && (
                            <span className="inline-flex h-7 px-2.5 items-center gap-1.5 rounded-lg border border-sys-status-okBg/50 bg-sys-status-okBg/15 text-sys-status-okText text-xs font-semibold">
                              <PlatformSvg platform="meet" />
                              <span>Meet ↗</span>
                            </span>
                          )}
                        </div>
                      )}

                      {/* Subgroup 2 Row */}
                      {(stage < 3 || targetDemoSubgroup === 2) && (
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className={`inline-flex shrink-0 items-center gap-1.5 h-6 px-2 rounded-md border text-xs font-semibold transition-colors ${
                                stage >= 3 && targetDemoSubgroup === 2
                                  ? "border-sys-accent/35 bg-sys-accent/15 text-sys-accent"
                                  : stage >= 1 && targetDemoSubgroup === 2
                                  ? "border-sys-accent/50 bg-sys-accent/10 text-sys-text-primary"
                                  : "bg-sys-bg/80 border-sys-border text-sys-text-secondary"
                              }`}
                            >
                              <span
                                className={`h-1.5 w-1.5 rounded-full ${
                                  stage >= 3 && targetDemoSubgroup === 2 ? "bg-sys-accent" : "bg-sys-text-muted/60"
                                }`}
                              />
                              <span>2 підгр.</span>
                            </span>
                            <UserSvg />
                            <span className="text-xs font-medium text-sys-text-secondary truncate">
                              {pCtx.sub2Teacher}
                            </span>
                          </div>
                          {stage < 3 && (
                            <span className="shrink-0 rounded-md border border-sys-border bg-sys-bg px-2 py-1 text-xs font-semibold leading-none text-sys-text-secondary">
                              ауд. {pCtx.sub2Room}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* =====================================================
                    СТУДЕНТ 2: КОД ZOOM (Реальний предмет і викладач групи)
                   ===================================================== */}
                {role === "student" && safeIdx === 2 && (
                  <div className="relative w-full max-w-[400px] mx-auto space-y-2.5">
                    <DemoCursor
                      x={stage === 0 ? "35%" : stage <= 2 ? "84%" : "86%"}
                      y={stage === 0 ? "76%" : stage <= 2 ? "26%" : "72%"}
                      clicking={stage === 2}
                      hidden={isCursorHidden}
                    />

                    <div className="rounded-2xl border border-sys-border bg-sys-card p-4 shadow-sm space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-base font-black text-sys-text-primary leading-none">3</span>
                          <span className="text-sys-text-muted font-bold text-xs">·</span>
                          <span className="text-xs font-semibold text-sys-text-secondary">12:30–13:50</span>
                        </div>

                        <span
                          className={`inline-flex h-8 px-2.5 items-center gap-1.5 rounded-lg border border-sys-status-infoBg/50 bg-sys-status-infoBg/15 text-sys-status-infoText text-xs font-bold shadow-xs transition-transform ${
                            stage === 2 ? "scale-95" : ""
                          }`}
                        >
                          <PlatformSvg platform="zoom" />
                          <span>Zoom</span>
                          <span className="opacity-75">↗</span>
                        </span>
                      </div>

                      <div>
                        <div className="text-base font-semibold text-sys-text-subject leading-snug truncate">
                          {pCtx.zoomSubject}
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-sys-text-secondary mt-1">
                          <UserSvg />
                          <span>{pCtx.zoomTeacher}</span>
                        </div>
                      </div>
                    </div>

                    {stage >= 3 && (
                      <div className="flex items-center gap-2 rounded-[8px] border border-sys-status-okBg/40 bg-sys-card px-3.5 py-2.5 text-xs font-semibold text-sys-status-okText shadow-lg animate-in fade-in duration-150">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                          <path d="M5 12l5 5l10 -10" />
                        </svg>
                        <span>Код доступу Zoom (dfkr) скопійовано!</span>
                      </div>
                    )}
                  </div>
                )}

                {/* =====================================================
                    СТУДЕНТ 3: ЗАВДАННЯ (Реальні лічильники і предмети групи)
                   ===================================================== */}
                {role === "student" && safeIdx === 3 && (
                  <div className="relative w-full max-w-[400px] mx-auto space-y-2">
                    <DemoCursor
                      x={stage === 0 ? "18%" : stage <= 2 ? "50%" : "82%"}
                      y={stage === 0 ? "16%" : stage <= 2 ? "16%" : "68%"}
                      clicking={stage === 2}
                      hidden={isCursorHidden}
                    />

                    <div className="relative grid grid-cols-3 rounded-xl border border-sys-border bg-sys-card p-1 text-xs font-semibold isolate">
                      <div
                        className="absolute top-1 bottom-1 transition-transform duration-150 ease-out transform-gpu z-0"
                        style={{
                          left: "4px",
                          width: "calc((100% - 8px) / 3)",
                          transform: `translate3d(${stage >= 3 ? "100%" : "0%"}, 0, 0)`,
                        }}
                      >
                        <div className={`h-full w-full rounded-lg shadow-xs ${stage >= 3 ? "bg-sys-destructive" : "bg-sys-accentSolid"}`} />
                      </div>

                      <div className={`relative z-10 flex items-center justify-center gap-1 py-1.5 ${stage < 3 ? "text-white font-bold" : "text-sys-text-secondary"}`}>
                        <span>До здачі</span>
                        <span className={`inline-flex h-4 min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold ${stage < 3 ? "bg-white/20 text-white" : "bg-sys-bg text-sys-text-secondary"}`}>
                          {pCtx.pendingCount}
                        </span>
                      </div>

                      <div className={`relative z-10 flex items-center justify-center gap-1 py-1.5 ${stage >= 3 ? "text-white font-bold" : "text-sys-status-dangerText"}`}>
                        <span>Борги</span>
                        <span className={`inline-flex h-4 min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold ${stage >= 3 ? "bg-white/20 text-white" : "bg-sys-status-dangerBg/20 text-sys-status-dangerText"}`}>
                          {pCtx.overdueCount}
                        </span>
                      </div>

                      <div className="relative z-10 flex items-center justify-center gap-1 py-1.5 text-sys-text-secondary">
                        <span>Здано</span>
                        <span className="inline-flex h-4 min-w-[18px] items-center justify-center rounded-full bg-sys-bg px-1 text-[10px] font-bold text-sys-text-secondary">
                          {pCtx.doneCount}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between rounded-xl border border-sys-border bg-sys-card px-3 py-1.5 text-xs font-semibold text-sys-text-secondary">
                      <div className="flex items-center gap-2">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-80">
                          <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                        </svg>
                        <span>Усі предмети групи {pCtx.groupName}</span>
                      </div>
                      <span>▾</span>
                    </div>

                    {stage < 3 ? (
                      <div
                        className="rounded-xl bg-sys-card border border-sys-border p-3 shadow-xs space-y-1"
                        style={{ boxShadow: "inset 3px 0 0 #f59e0b" }}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-xs font-semibold text-sys-text-primary truncate">{pCtx.sampleTaskTitle}</span>
                          <span className="text-xs text-sys-text-muted">↗</span>
                        </div>
                        <p className="text-[11px] text-sys-text-muted truncate">
                          {pCtx.sampleTaskSubject} · {pCtx.sampleTaskTeacher}
                        </p>
                        <div className="flex items-center gap-1.5 text-xs font-medium text-sys-status-warnText pt-0.5">
                          <span className="h-1.5 w-1.5 rounded-full bg-sys-status-warnBg" />
                          <span>Завтра</span>
                        </div>
                      </div>
                    ) : (
                      <div
                        className="rounded-xl bg-sys-card border border-sys-border p-3 shadow-xs space-y-1 animate-in fade-in duration-150"
                        style={{ boxShadow: "inset 3px 0 0 #ef4444" }}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-xs font-semibold text-sys-text-primary truncate">{pCtx.overdueTaskTitle}</span>
                          <span className="text-xs text-sys-text-muted">↗</span>
                        </div>
                        <p className="text-[11px] text-sys-text-muted truncate">
                          {pCtx.overdueTaskSubject} · {pCtx.mainTeacher}
                        </p>
                        <div className="flex items-center gap-1.5 text-xs font-medium text-sys-status-dangerText pt-0.5">
                          <span className="h-1.5 w-1.5 rounded-full bg-sys-status-dangerBg" />
                          <span>10 лист. · прострочено 2 дні</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* =====================================================
                    СТУДЕНТ 4: ОЦІНКИ (Реальний предмет і викладач групи)
                   ===================================================== */}
                {role === "student" && safeIdx === 4 && (
                  <div className="relative w-full max-w-[400px] mx-auto space-y-2">
                    <DemoCursor
                      x={stage === 0 ? "30%" : stage <= 2 ? "88%" : "88%"}
                      y={stage === 0 ? "24%" : stage <= 2 ? "62%" : "78%"}
                      clicking={stage === 2}
                      hidden={isCursorHidden}
                    />

                    <div className="rounded-2xl border border-sys-border bg-sys-card px-3.5 py-2.5 shadow-xs flex items-center justify-between">
                      <div>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-sys-text-muted block">
                          Середній бал
                        </span>
                        <div className="flex items-baseline gap-2.5 mt-0.5">
                          <div className="flex items-baseline gap-1">
                            <span className="text-xl font-black text-sys-text-primary">{pCtx.gpa5}</span>
                            <span className="text-xs font-semibold text-sys-text-secondary">/ 5.00</span>
                          </div>
                          <div className="flex items-baseline gap-1 pl-2.5 border-l border-sys-border/80">
                            <span className="text-base font-bold text-sys-accent">{pCtx.gpa12}</span>
                            <span className="text-xs font-semibold text-sys-text-secondary">/ 12 б.</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1">
                        <div className="rounded-lg border border-sys-status-okBg/30 bg-sys-status-okBg/10 px-2 py-1 text-center">
                          <span className="text-[10px] font-bold text-sys-status-okText block">«5»</span>
                          <span className="text-xs font-black text-sys-text-primary">8</span>
                        </div>
                        <div className="rounded-lg border border-sys-status-infoBg/30 bg-sys-status-infoBg/10 px-2 py-1 text-center">
                          <span className="text-[10px] font-bold text-sys-status-infoText block">«4»</span>
                          <span className="text-xs font-black text-sys-text-primary">3</span>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-sys-border bg-sys-card p-3 shadow-xs space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-sys-text-primary truncate">{pCtx.gradeSubject}</div>
                          <div className="text-[11px] text-sys-text-muted truncate">
                            3 оцінки • 👨🏫 {pCtx.gradeTeacher}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <div className="text-right">
                            <div className="text-xs font-black text-sys-text-primary leading-none">
                              4.83 <span className="text-[10px] font-semibold text-sys-text-secondary">/ 5</span>
                            </div>
                            <div className="text-[10px] font-bold text-sys-accent mt-0.5">11.0 / 12 б.</div>
                          </div>
                          <span className="text-xs text-sys-text-muted">{stage >= 3 ? "▴" : "▾"}</span>
                        </div>
                      </div>

                      {stage < 3 ? (
                        <div className="flex items-center gap-1 pt-1.5 border-t border-sys-border/40">
                          {pCtx.gradeChips.map((mark) => (
                            <span
                              key={mark}
                              className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] font-bold border border-sys-status-okBg/30 bg-sys-status-okBg/15 text-sys-status-okText"
                            >
                              {mark}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <div className="flex items-center justify-between rounded-xl border border-sys-border/60 bg-sys-bg/60 px-2.5 py-1.5 text-xs animate-in fade-in duration-150">
                          <span className="font-semibold text-sys-text-primary truncate">{pCtx.sampleTaskTitle}</span>
                          <span className="font-bold text-sys-text-primary shrink-0 ml-2">
                            95<span className="text-[10px] text-sys-text-secondary">/100 б.</span>{" "}
                            <span className="text-sys-status-okText">(5 за 5-б.)</span>
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* =====================================================
                    СТУДЕНТ 5 (#7): ПЕРЕХІД ДО ВИКЛАДАЧА ВАШОЇ ГРУПИ
                   ===================================================== */}
                {role === "student" && safeIdx === 5 && (
                  <div className="relative w-full max-w-[400px] mx-auto">
                    <DemoCursor
                      x={stage === 0 ? "70%" : stage <= 2 ? "26%" : "82%"}
                      y={stage === 0 ? "28%" : stage <= 2 ? "74%" : "22%"}
                      clicking={stage === 2}
                      hidden={isCursorHidden}
                    />

                    {stage < 3 ? (
                      <div className="rounded-2xl border border-sys-border bg-sys-card p-4 shadow-sm space-y-2.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-base font-black text-sys-text-primary leading-none">2</span>
                            <span className="text-sys-text-muted font-bold text-xs">·</span>
                            <span className="text-xs font-semibold text-sys-text-secondary">10:40–12:00</span>
                          </div>
                          <span className="inline-flex h-8 px-2.5 items-center rounded-lg border border-sys-border bg-sys-bg text-xs font-medium text-sys-text-secondary">
                            ауд. {pCtx.jumpRoom}
                          </span>
                        </div>

                        <div className="text-base font-semibold text-sys-text-subject truncate">
                          {pCtx.jumpSubject}
                        </div>

                        <div className="flex items-center gap-1.5 text-xs">
                          <UserSvg />
                          <span
                            className={`font-medium transition-colors ${
                              stage >= 1 ? "text-sys-accent underline underline-offset-2" : "text-sys-text-secondary"
                            }`}
                          >
                            {pCtx.jumpTeacher}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2.5 animate-in fade-in duration-150">
                        <div className="flex items-center justify-between rounded-xl border border-sys-accent/30 bg-sys-accent/10 px-3 py-2 text-xs">
                          <span className="text-sys-text-secondary truncate mr-2">
                            Розклад: <strong className="text-sys-text-primary">{pCtx.jumpTeacher}</strong>
                          </span>
                          <span className="shrink-0 rounded-lg bg-sys-accent px-2.5 py-1 text-xs font-semibold text-white">
                            ← До {pCtx.groupName}
                          </span>
                        </div>

                        <div className="rounded-2xl border border-sys-border bg-sys-card p-3.5 shadow-sm space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-sys-text-secondary">2 · 10:40–12:00</span>
                            <span className="rounded-lg border border-sys-border bg-sys-bg px-2.5 py-1 text-xs font-medium text-sys-text-secondary">
                              ауд. {pCtx.jumpRoom}
                            </span>
                          </div>
                          <div className="text-sm font-semibold text-sys-text-subject truncate">
                            {pCtx.jumpSubject}
                          </div>
                          <div className="flex items-center gap-1.5 text-xs text-sys-text-secondary">
                            <UserSvg />
                            <span className="text-sys-text-muted">Група:</span>
                            <span className="font-medium text-sys-text-secondary">{pCtx.groupName}</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* =====================================================
                    ВИКЛАДАЧ 0 (#1): PIN-ДОСТУП (Ваші реальні предмет і група)
                   ===================================================== */}
                {role === "teacher" && safeIdx === 0 && (
                  <div className="relative w-full max-w-[400px] mx-auto">
                    <DemoCursor
                      x={stage === 0 ? "35%" : stage <= 2 ? "74%" : "84%"}
                      y={stage === 0 ? "25%" : stage <= 2 ? "80%" : "26%"}
                      clicking={stage === 2}
                      hidden={isCursorHidden}
                    />

                    {stage < 3 ? (
                      <div className="rounded-2xl border border-sys-border bg-sys-card p-4 shadow-lg space-y-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-xl flex items-center justify-center border border-sys-status-infoBg/30 bg-sys-status-infoBg/15 text-sys-status-infoText shrink-0">
                            🔒
                          </div>
                          <div>
                            <div className="text-xs font-bold text-sys-text-primary">Вхід для викладача</div>
                            <div className="text-[11px] text-sys-text-secondary">PIN-код для доступу до посилань</div>
                          </div>
                        </div>

                        <div className="h-9 px-3 rounded-xl border border-sys-accent bg-sys-bg flex items-center text-xs font-mono tracking-widest text-sys-text-primary">
                          {stage >= 1 ? "••••••" : "•••"}
                        </div>

                        <div className="flex gap-2">
                          <span className="flex-1 h-8 rounded-xl border border-sys-border bg-sys-bg text-xs font-semibold text-sys-text-secondary flex items-center justify-center">
                            Скасувати
                          </span>
                          <span
                            className={`flex-1 h-8 rounded-xl bg-sys-accent text-white text-xs font-bold flex items-center justify-center transition-transform ${
                              stage === 2 ? "scale-95" : ""
                            }`}
                          >
                            Розблокувати
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-sys-border bg-sys-card p-4 shadow-sm space-y-2.5 animate-in fade-in duration-150">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-base font-black text-sys-text-primary leading-none">1</span>
                            <span className="text-sys-text-muted font-bold text-xs">·</span>
                            <span className="text-xs font-semibold text-sys-text-secondary">09:00–10:20</span>
                          </div>
                          <span className="inline-flex h-8 px-2.5 items-center gap-1.5 rounded-lg border border-sys-status-infoBg/50 bg-sys-status-infoBg/15 text-sys-status-infoText text-xs font-bold shadow-xs">
                            <PlatformSvg platform="zoom" />
                            <span>Zoom</span>
                            <span className="opacity-75">↗</span>
                          </span>
                        </div>
                        <div className="text-base font-semibold text-sys-text-subject truncate">
                          {pCtx.teacherSubject}
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-sys-text-secondary">
                          <UserSvg />
                          <span className="text-sys-text-muted">Група:</span>
                          <span className="font-medium text-sys-text-secondary">{pCtx.teacherGroup}</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* =====================================================
                    ВИКЛАДАЧ 1 (#4): СТАТИСТИКА (Ваші реальні предмет і групи)
                   ===================================================== */}
                {role === "teacher" && safeIdx === 1 && (
                  <div className="relative w-full max-w-[400px] mx-auto space-y-2.5">
                    <DemoCursor
                      x={stage === 0 ? "30%" : stage <= 2 ? "65%" : "82%"}
                      y={stage === 0 ? "25%" : stage <= 2 ? "72%" : "72%"}
                      clicking={stage === 2}
                      hidden={isCursorHidden}
                    />

                    <div className="grid grid-cols-2 gap-2.5">
                      <div className="rounded-2xl border border-sys-border bg-sys-card p-2.5 text-center">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-sys-text-secondary">
                          Проведено
                        </p>
                        <p className="text-xl font-black text-sys-accent leading-tight mt-0.5">96</p>
                        <p className="text-[10px] text-sys-text-muted">акад. год · 48 пар</p>
                      </div>
                      <div className="rounded-2xl border border-sys-border bg-sys-card p-2.5 text-center">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-sys-text-secondary">
                          Навантаження
                        </p>
                        <p className="text-xl font-black text-sys-text-primary leading-tight mt-0.5">16</p>
                        <p className="text-[10px] text-sys-text-muted">акад. год/тиждень · 8 пар</p>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-sys-border bg-sys-card p-3 flex items-center gap-3.5">
                      <div className="relative w-12 h-12 shrink-0 flex items-center justify-center">
                        <svg className="w-full h-full -rotate-90" viewBox="0 0 48 48">
                          <circle cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="4" fill="none" className="text-sys-border" />
                          <circle
                            cx="24"
                            cy="24"
                            r="20"
                            stroke="currentColor"
                            strokeWidth="4"
                            fill="none"
                            strokeDasharray={125.6}
                            strokeDashoffset={32}
                            className="text-sys-accent"
                            strokeLinecap="round"
                          />
                        </svg>
                        <span className="absolute text-[11px] font-bold text-sys-text-primary">68г</span>
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-sys-text-primary truncate">
                          {pCtx.teacherSubject}
                        </div>
                        <div className="text-[11px] text-sys-text-secondary mt-0.5">
                          68 акад. год · 34 пар
                        </div>
                        <div className="flex items-center gap-1 mt-1">
                          <span className="text-[10px] text-sys-text-muted">Групи:</span>
                          <span className="rounded bg-sys-elevated border border-sys-border px-1.5 py-0.5 text-[10px] font-medium text-sys-text-secondary">
                            {pCtx.teacherGroup}
                          </span>
                          <span className="rounded bg-sys-elevated border border-sys-border px-1.5 py-0.5 text-[10px] font-medium text-sys-text-secondary">
                            {pCtx.teacherSecondGroup}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* =====================================================
                    ВИКЛАДАЧ 2 (#5): ЗАМІНИ ТА ПЕРЕНЕСЕННЯ (Ваші предмет і група)
                   ===================================================== */}
                {role === "teacher" && safeIdx === 2 && (
                  <div className="relative w-full max-w-[400px] mx-auto space-y-2.5">
                    <DemoCursor
                      x={stage === 0 ? "50%" : stage <= 2 ? "70%" : "82%"}
                      y={stage === 0 ? "18%" : stage <= 2 ? "18%" : "68%"}
                      clicking={stage === 2}
                      hidden={isCursorHidden}
                    />

                    <div className="relative flex h-10 w-full rounded-xl border border-sys-border bg-sys-card overflow-hidden text-xs">
                      <div
                        className="absolute bottom-0 left-0 h-[3px] bg-sys-accent transition-transform duration-200 ease-out"
                        style={{
                          width: "20%",
                          transform: `translateX(${(stage >= 3 ? 3 : 2) * 100}%)`,
                        }}
                      />
                      {["Пн 10", "Вт 11", "Ср 12", "Чт 13", "Пт 14"].map((d, i) => {
                        const active = (stage >= 3 ? 3 : 2) === i;
                        return (
                          <div
                            key={d}
                            className={`flex-1 flex items-center justify-center font-semibold transition-colors ${
                              active ? "text-sys-text-primary font-bold" : "text-sys-text-secondary"
                            }`}
                          >
                            {d}
                          </div>
                        );
                      })}
                    </div>

                    {stage < 3 ? (
                      <div className="rounded-2xl border border-sys-status-dangerBg/40 border-dashed bg-sys-card p-3.5 space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-sys-text-secondary">3 · 12:30–13:50</span>
                          <span className="rounded px-1.5 py-0.5 text-xs font-bold border border-sys-status-warnBg/40 bg-sys-status-warnBg/15 text-sys-status-warnText">
                            ↪ Перенесено → Четвер, 3 пара
                          </span>
                        </div>
                        <div className="text-base font-semibold line-through text-sys-text-muted truncate">
                          {pCtx.teacherSubject}
                        </div>
                        <div className="text-xs text-sys-text-secondary">Група: {pCtx.teacherGroup}</div>
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-sys-warning/40 ring-1 ring-sys-warning/60 bg-sys-card p-3.5 space-y-1.5 animate-in fade-in duration-150">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-sys-text-secondary">3 · 12:30–13:50</span>
                          <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-bold bg-sys-warning uppercase tracking-wider text-sys-warningText">
                            ⚡ Заміна
                          </span>
                        </div>
                        <div className="text-base font-semibold text-sys-text-subject truncate">
                          {pCtx.teacherSubject}
                        </div>
                        <div className="text-xs text-sys-text-secondary">
                          Група: {pCtx.teacherGroup} • ауд. {pCtx.teacherRoom}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* 3. ОПИС + ПЕРСОНАЛЬНА ШВИДКА ДІЯ ПРЯМО З ПОТОЧНОГО СЛАЙДУ */}
              <div className="space-y-2.5 px-0.5">
                <h3 className="text-sm sm:text-base font-bold text-sys-text-primary leading-snug">
                  {activeStep.title}
                </h3>

                <ul className="space-y-1.5 text-xs text-sys-text-secondary leading-relaxed">
                  <li className="flex items-start gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-sys-accent shrink-0" />
                    <span>{activeStep.points[0]}</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-sys-accent shrink-0" />
                    <span>{activeStep.points[1]}</span>
                  </li>
                </ul>

                {role === "student" && safeIdx === 0 && (
                  <div className="flex items-center justify-between rounded-xl border border-sys-border bg-sys-bg px-3 py-2 text-xs">
                    <span className="font-semibold text-sys-text-secondary truncate mr-2">
                      {isLinked ? `✓ Підключено: ${linkedEmail}` : `Пошту для групи ${pCtx.groupName} ще не прив'язано`}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        setTimeout(() => window.dispatchEvent(new CustomEvent("trigger-classroom-sync")), 120);
                      }}
                      className="shrink-0 rounded-lg bg-sys-accent px-3 py-1.5 text-[11px] font-bold text-white hover:opacity-95 active:scale-95 transition-opacity cursor-pointer"
                    >
                      {isLinked ? "Оновити" : "Прив'язати →"}
                    </button>
                  </div>
                )}

                {role === "student" && safeIdx === 1 && (
                  <div className="flex items-center justify-between rounded-xl border border-sys-border bg-sys-bg px-3 py-2 text-xs">
                    <span className="font-semibold text-sys-text-secondary">
                      {pCtx.hasSubgroups
                        ? `Підгрупа в гр. ${pCtx.groupName}:`
                        : `У гр. ${pCtx.groupName} пари спільні:`}
                    </span>
                    <div className="inline-flex gap-1">
                      {(["all", 1, 2] as const).map((sub) => (
                        <button
                          key={String(sub)}
                          type="button"
                          onClick={() => {
                            updateSetting("defaultSubgroup", sub);
                            setElapsedMs(2500);
                          }}
                          className={`rounded-lg px-2.5 py-1 text-[11px] font-bold transition-colors cursor-pointer ${
                            settings.defaultSubgroup === sub
                              ? "bg-sys-accent text-white"
                              : "bg-sys-card text-sys-text-secondary border border-sys-border hover:text-sys-text-primary"
                          }`}
                        >
                          {sub === "all" ? "Обидві" : `${sub} підгр.`}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {role === "student" && (safeIdx === 3 || safeIdx === 4) && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      setHomeTab("tasks");
                    }}
                    className="w-full rounded-xl bg-sys-accent/15 border border-sys-accent/35 py-2 text-xs font-bold text-sys-accent hover:bg-sys-accent/25 active:scale-[0.99] transition-colors cursor-pointer"
                  >
                    {safeIdx === 3
                      ? `Відкрити завдання групи ${pCtx.groupName} →`
                      : `Відкрити оцінки групи ${pCtx.groupName} →`}
                  </button>
                )}

                {role === "teacher" && safeIdx === 0 && !isTeacherUnlocked && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      router.push("/settings?mode=teacher");
                    }}
                    className="w-full rounded-xl bg-sys-accent py-2 text-xs font-bold text-white hover:opacity-95 active:scale-[0.99] transition-opacity cursor-pointer"
                  >
                    Ввести PIN-код викладача →
                  </button>
                )}

                {role === "teacher" && safeIdx === 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      router.push("/statistics");
                    }}
                    className="w-full rounded-xl bg-sys-accent/15 border border-sys-accent/35 py-2 text-xs font-bold text-sys-accent hover:bg-sys-accent/25 active:scale-[0.99] transition-colors cursor-pointer"
                  >
                    Відкрити статистику ({pCtx.teacherName}) →
                  </button>
                )}
              </div>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* 4. НИЖНЯ НАВІГАЦІЯ */}
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-sys-border bg-sys-surface shrink-0">
          <button
            type="button"
            disabled={safeIdx === 0}
            onClick={() => goToStep(Math.max(0, safeIdx - 1))}
            className="rounded-xl border border-sys-border bg-sys-card px-3.5 py-2 text-xs font-semibold text-sys-text-secondary hover:text-sys-text-primary disabled:opacity-40 disabled:pointer-events-none active:scale-95 transition-colors cursor-pointer"
          >
            ← Назад
          </button>

          <span className="text-xs font-semibold text-sys-text-muted">
            {safeIdx + 1} / {stepsCount}
          </span>

          <button
            type="button"
            onClick={() => {
              if (safeIdx === stepsCount - 1) {
                onClose();
              } else {
                goToStep(safeIdx + 1);
              }
            }}
            className="rounded-xl bg-sys-accent px-4 py-2 text-xs font-bold text-white hover:opacity-95 active:scale-95 transition-opacity cursor-pointer"
          >
            {safeIdx === stepsCount - 1 ? "Зрозуміло ✓" : "Далі →"}
          </button>
        </div>
      </div>
    </div>
  );
}
