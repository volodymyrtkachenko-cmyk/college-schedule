"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { useUserSettings } from "../lib/useUserSettings";
import { api, Lesson, ScheduleResponse } from "../lib/api";
import { formatRoom } from "../lib/format";
import { parseLessonTeachers } from "../lib/quickJump";
import { DEFAULT_LESSON_TIMES } from "../lib/constants/lessons";

export interface GuideHubModalProps {
  groupId?: number | null;
  teacherId?: number | null;
  mode?: "student" | "teacher";
  onClose: () => void;
}

interface StudentDemoData {
  subgroupSubject: string;
  teacher1: string;
  teacher1Room: string;
  teacher2: string;
  teacher2Room: string;
  hwSubject: string;
  hwRoom: string;
  daysPreview: {
    day: "Пн" | "Вт" | "Ср" | "Чт" | "Пт";
    lessonNumber: number;
    time: string;
    subject: string;
    teacher: string;
    room: string;
  }[];
  statSubjects: {
    name: string;
    hours: number;
    plannedHours: number;
    percent: number;
  }[];
  distinctCount: number;
}

interface TeacherDemoData {
  teacherName: string;
  liveSubject: string;
  liveGroup: string;
  liveRoom: string;
  daysPreview: {
    day: "Пн" | "Вт" | "Ср" | "Чт" | "Пт";
    lessonNumber: number;
    time: string;
    subject: string;
    group: string;
    room: string;
  }[];
  groupsList: string[];
  statSubjects: {
    name: string;
    hours: number;
    plannedHours: number;
    percent: number;
  }[];
  totalHours: number;
  totalLessons: number;
}

const DEFAULT_DAYS: ("Пн" | "Вт" | "Ср" | "Чт" | "Пт")[] = ["Пн", "Вт", "Ср", "Чт", "Пт"];
const FALLBACK_SUBJECTS = [
  "Комп'ютерні мережі",
  "Бази даних та SQL",
  "Веб-технології та розробка",
  "Архітектура комп'ютерів",
  "Операційні системи",
];

function extractStudentGuideData(weekSchedule: ScheduleResponse[]): StudentDemoData {
  const allLessons: Lesson[] = [];
  weekSchedule.forEach((day) => {
    if (Array.isArray(day?.lessons)) {
      allLessons.push(...day.lessons);
    }
  });

  // Find dual lesson
  const dualLesson = allLessons.find(
    (l) =>
      !l.is_cancelled &&
      (l.second_teacher_id != null ||
        (l.teacher_name && /[,/]/.test(l.teacher_name)) ||
        (l.teacher_room && l.second_teacher_room))
  );

  let subgroupSubject = "Комп'ютерні мережі";
  let teacher1 = "Викладач 1";
  let teacher1Room = "ауд. 101";
  let teacher2 = "Викладач 2";
  let teacher2Room = "ауд. 102";

  if (dualLesson) {
    subgroupSubject = dualLesson.subject_name;
    const teachers = parseLessonTeachers(dualLesson);
    teacher1 = teachers[0]?.displayName || teachers[0]?.name || "Викладач 1";
    teacher2 = teachers[1]?.displayName || teachers[1]?.name || "Викладач 2";
    teacher1Room = formatRoom(dualLesson.teacher_room || dualLesson.room || "101");
    teacher2Room = formatRoom(dualLesson.second_teacher_room || dualLesson.room || "102");
  } else if (allLessons.length > 0) {
    const firstWithTeacher = allLessons.find((l) => !l.is_cancelled && l.teacher_name);
    if (firstWithTeacher) {
      subgroupSubject = firstWithTeacher.subject_name;
      teacher1 = firstWithTeacher.teacher_name || "Викладач 1";
      teacher1Room = formatRoom(firstWithTeacher.room || "101");
      const otherTeacher = allLessons.find(
        (l) => !l.is_cancelled && l.teacher_name && l.teacher_name !== firstWithTeacher.teacher_name
      );
      teacher2 = otherTeacher?.teacher_name || "Викладач 2";
      teacher2Room = "ауд. 102";
    }
  }

  // HW lesson
  const hwL = allLessons.find((l) => !l.is_cancelled && l.subject_name !== subgroupSubject) || allLessons[0];
  const hwSubject = hwL?.subject_name || "Бази даних та SQL";
  const hwRoom = formatRoom(hwL?.room || "204");

  // Days preview
  const daysPreview = DEFAULT_DAYS.map((d, idx) => {
    const dayData = weekSchedule[idx];
    const dayLessons = (dayData?.lessons || []).filter((l) => !l.is_cancelled);
    if (dayLessons.length > 0) {
      const l = dayLessons[0];
      return {
        day: d,
        lessonNumber: l.lesson_number || 1,
        time: l.time || DEFAULT_LESSON_TIMES[1],
        subject: l.subject_name,
        teacher: l.teacher_name || teacher1,
        room: formatRoom(l.room || "101"),
      };
    }
    return {
      day: d,
      lessonNumber: 1,
      time: DEFAULT_LESSON_TIMES[1],
      subject: FALLBACK_SUBJECTS[idx] || "Спеціальна дисципліна",
      teacher: teacher1,
      room: `ауд. ${100 + (idx + 1) * 10}`,
    };
  });

  const uniqueSubjects = Array.from(
    new Set(allLessons.map((l) => l.subject_name).filter(Boolean))
  );
  const sub1 = uniqueSubjects[0] || "Комп'ютерні мережі";
  const sub2 = uniqueSubjects[1] || "Бази даних та SQL";
  const statSubjects = [
    { name: sub1, hours: 38, plannedHours: 50, percent: 76 },
    { name: sub2, hours: 24, plannedHours: 50, percent: 48 },
  ];
  const distinctCount = uniqueSubjects.length || 10;

  return {
    subgroupSubject,
    teacher1,
    teacher1Room,
    teacher2,
    teacher2Room,
    hwSubject,
    hwRoom,
    daysPreview,
    statSubjects,
    distinctCount,
  };
}

function extractTeacherGuideData(weekSchedule: ScheduleResponse[], currentTeacherName?: string): TeacherDemoData {
  const allLessons: Lesson[] = [];
  weekSchedule.forEach((day) => {
    if (Array.isArray(day?.lessons)) {
      allLessons.push(...day.lessons);
    }
  });

  const validLessons = allLessons.filter((l) => !l.is_cancelled && l.subject_name);

  const firstL = validLessons[0];
  const liveSubject = firstL?.subject_name || "Комп'ютерні мережі";
  const liveGroup = firstL?.group_name || "Група коледжу";
  const liveRoom = formatRoom(firstL?.teacher_room || firstL?.room || "309");

  // Distinct groups
  const uniqueGroups = Array.from(
    new Set(validLessons.map((l) => l.group_name).filter(Boolean) as string[])
  );
  if (uniqueGroups.length === 0) {
    uniqueGroups.push("Група 1", "Група 2");
  } else if (uniqueGroups.length === 1) {
    uniqueGroups.push("Група 2");
  }

  // Days preview
  const daysPreview = DEFAULT_DAYS.map((d, idx) => {
    const dayData = weekSchedule[idx];
    const dayLessons = (dayData?.lessons || []).filter((l) => !l.is_cancelled);
    if (dayLessons.length > 0) {
      const l = dayLessons[0];
      return {
        day: d,
        lessonNumber: l.lesson_number || 1,
        time: l.time || DEFAULT_LESSON_TIMES[1],
        subject: l.subject_name,
        group: l.group_name || uniqueGroups[0] || "Група",
        room: formatRoom(l.teacher_room || l.room || "309"),
      };
    }
    return {
      day: d,
      lessonNumber: 1,
      time: DEFAULT_LESSON_TIMES[1],
      subject: FALLBACK_SUBJECTS[idx] || "Спеціальна дисципліна",
      group: uniqueGroups[idx % uniqueGroups.length] || "Група",
      room: `ауд. ${300 + (idx + 1) * 2}`,
    };
  });

  const uniqueSubjects = Array.from(
    new Set(validLessons.map((l) => l.subject_name).filter(Boolean))
  );
  const sub1 = uniqueSubjects[0] || "Комп'ютерні мережі";
  const sub2 = uniqueSubjects[1] || "Бази даних та SQL";
  const statSubjects = [
    { name: sub1, hours: 44, plannedHours: 60, percent: 73 },
    { name: sub2, hours: 28, plannedHours: 40, percent: 70 },
  ];

  return {
    teacherName: currentTeacherName || firstL?.teacher_name || "Викладач коледжу",
    liveSubject,
    liveGroup,
    liveRoom,
    daysPreview,
    groupsList: uniqueGroups.slice(0, 3),
    statSubjects,
    totalHours: 72,
    totalLessons: 36,
  };
}

export function GuideHubModal({ groupId, teacherId, mode, onClose }: GuideHubModalProps) {
  const { updateSetting } = useUserSettings();

  const effectiveGroupId =
    groupId ??
    (typeof window !== "undefined"
      ? Number(localStorage.getItem("schedule:groupId")) ||
        Number(localStorage.getItem("schedule:classroom_linked_group_id")) ||
        null
      : null);

  const effectiveTeacherId =
    teacherId ??
    (typeof window !== "undefined"
      ? Number(localStorage.getItem("schedule:teacherId")) || null
      : null);

  // Guide mode: student vs teacher
  const [guideMode, setGuideMode] = useState<"student" | "teacher">(() => {
    if (mode) return mode;
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("schedule:mode");
      if (stored === "teacher") return "teacher";
    }
    return "student";
  });

  const [groupName, setGroupName] = useState<string>("Група коледжу");
  const [teacherName, setTeacherName] = useState<string>("Викладач коледжу");
  const [studentWeekSchedule, setStudentWeekSchedule] = useState<ScheduleResponse[]>([]);
  const [teacherWeekSchedule, setTeacherWeekSchedule] = useState<ScheduleResponse[]>([]);
  const [activeSlide, setActiveSlide] = useState(0);

  // Device type detection (desktop vs touch/mobile)
  const [isTouchDevice, setIsTouchDevice] = useState(false);

  // Interactive demo states (Student)
  const [demoNavDay, setDemoNavDay] = useState<"Пн" | "Вт" | "Ср" | "Чт" | "Пт">("Пн");
  const [demoSubgroup, setDemoSubgroup] = useState<1 | 2 | null>(null);

  // Interactive demo states (Teacher)
  const [demoPinUnlocked, setDemoPinUnlocked] = useState(false);
  const [demoTeacherGroup, setDemoTeacherGroup] = useState<string>("Група коледжу");

  // Touch tracking for demo card (prevents conflict with story slides)
  const [cardTouchStart, setCardTouchStart] = useState<number | null>(null);
  const [cardTouchEnd, setCardTouchEnd] = useState<number | null>(null);

  // PWA detection
  const [pwaPrompt, setPwaPrompt] = useState<any>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [pwaFeedback, setPwaFeedback] = useState("");

  // Touch swipe support for main story transitions
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchEnd, setTouchEnd] = useState<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const updateModality = () => {
      const hasTouch =
        ("ontouchstart" in window || navigator.maxTouchPoints > 0) &&
        window.matchMedia("(pointer: coarse)").matches;
      const isNarrow = window.innerWidth < 768;
      setIsTouchDevice(hasTouch || isNarrow);
    };
    updateModality();
    window.addEventListener("resize", updateModality);
    return () => window.removeEventListener("resize", updateModality);
  }, []);

  // Prevent background scrolling and scrollbar-toggle layout shifts while modal is open
  useEffect(() => {
    if (typeof document === "undefined") return;
    const prevOverflow = document.body.style.overflow;
    const prevPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.paddingRight = prevPaddingRight;
    };
  }, []);

  // Fetch Student data
  useEffect(() => {
    if (typeof window === "undefined") return;
    const storedName = localStorage.getItem("schedule:groupName");
    if (storedName) {
      setGroupName(storedName);
    } else if (effectiveGroupId) {
      api.groups()
        .then((grps) => {
          const found = grps.find((g) => g.id === effectiveGroupId);
          if (found?.name) setGroupName(found.name);
        })
        .catch(() => {});
    }
  }, [effectiveGroupId]);

  useEffect(() => {
    let isMounted = true;
    if (effectiveGroupId) {
      api.week(effectiveGroupId)
        .then((data) => {
          if (isMounted && Array.isArray(data)) setStudentWeekSchedule(data);
        })
        .catch(() => {});
    }
    return () => {
      isMounted = false;
    };
  }, [effectiveGroupId]);

  // Fetch Teacher data
  useEffect(() => {
    let isMounted = true;
    api.directory.teachers()
      .then((teachers) => {
        if (!isMounted) return;
        const found = effectiveTeacherId
          ? teachers.find((t) => t.id === effectiveTeacherId)
          : teachers[0];
        if (found?.name) {
          setTeacherName(found.name);
        }
        const tid = found?.id || effectiveTeacherId;
        if (tid) {
          api.week(undefined, tid)
            .then((data) => {
              if (isMounted && Array.isArray(data)) setTeacherWeekSchedule(data);
            })
            .catch(() => {});
        }
      })
      .catch(() => {});
    return () => {
      isMounted = false;
    };
  }, [effectiveTeacherId]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const standalone =
      ("standalone" in window.navigator && (window.navigator as any).standalone === true) ||
      window.matchMedia("(display-mode: standalone)").matches;
    setIsStandalone(standalone);

    setIsIos(/iphone|ipad|ipod/i.test(navigator.userAgent || ""));

    if ((window as any).__pwaInstallEvent) {
      setPwaPrompt((window as any).__pwaInstallEvent);
    }

    const onInstallReady = (e: any) => setPwaPrompt(e.detail || (window as any).__pwaInstallEvent);
    const onAppInstalled = () => {
      setIsStandalone(true);
      setPwaPrompt(null);
      setPwaFeedback("✅ Додаток встановлено на екран!");
    };

    window.addEventListener("pwa-install-ready", onInstallReady);
    window.addEventListener("appinstalled", onAppInstalled);

    return () => {
      window.removeEventListener("pwa-install-ready", onInstallReady);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  const studentDemoData = useMemo(() => extractStudentGuideData(studentWeekSchedule), [studentWeekSchedule]);
  const teacherDemoData = useMemo(() => extractTeacherGuideData(teacherWeekSchedule, teacherName), [teacherWeekSchedule, teacherName]);

  const activeNavLessonStudent = useMemo(() => {
    return studentDemoData.daysPreview.find((d) => d.day === demoNavDay) || studentDemoData.daysPreview[0];
  }, [studentDemoData, demoNavDay]);

  const activeNavLessonTeacher = useMemo(() => {
    return teacherDemoData.daysPreview.find((d) => d.day === demoNavDay) || teacherDemoData.daysPreview[0];
  }, [teacherDemoData, demoNavDay]);

  // Card swipe gesture handlers
  const handleCardTouchStart = (e: React.TouchEvent) => {
    e.stopPropagation();
    setCardTouchEnd(null);
    setCardTouchStart(e.targetTouches[0].clientX);
  };

  const handleCardTouchMove = (e: React.TouchEvent) => {
    e.stopPropagation();
    setCardTouchEnd(e.targetTouches[0].clientX);
  };

  const handleCardTouchEnd = (e: React.TouchEvent) => {
    e.stopPropagation();
    if (cardTouchStart === null || cardTouchEnd === null) return;
    const diff = cardTouchStart - cardTouchEnd;
    if (diff > 35) {
      const idx = DEFAULT_DAYS.indexOf(demoNavDay);
      if (idx < DEFAULT_DAYS.length - 1) {
        setDemoNavDay(DEFAULT_DAYS[idx + 1]);
      }
    } else if (diff < -35) {
      const idx = DEFAULT_DAYS.indexOf(demoNavDay);
      if (idx > 0) {
        setDemoNavDay(DEFAULT_DAYS[idx - 1]);
      }
    }
    setCardTouchStart(null);
    setCardTouchEnd(null);
  };

  // Student Slides
  const studentSlides = [
    {
      id: "student-live",
      icon: "🔴",
      title: "«Жива» пара в реальному часі",
      caption: "Заняття, яке триває просто зараз, автоматично підсвічується акцентним кольором та показує точний таймер до перерви.",
      render: () => (
        <div
          onTouchStart={(e) => e.stopPropagation()}
          className="guide-interactive-demo relative rounded-2xl border border-sys-accent bg-gradient-to-br from-sys-accent/15 via-sys-card to-sys-card p-4 space-y-3 shadow-lg"
        >
          <div className="flex items-center justify-between text-xs">
            <span className="font-black text-sys-accent">
              1 пара · 09:00–10:20
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-sys-accent/20 border border-sys-accent/40 px-2.5 py-0.5 text-xs font-bold text-sys-accent">
              <span className="h-2 w-2 rounded-full bg-sys-accent animate-ping" />
              ще 25 хв
            </span>
          </div>
          <div className="font-bold text-base text-sys-text-primary">
            {studentDemoData.subgroupSubject}
          </div>
          <div className="text-xs text-sys-text-secondary">
            {studentDemoData.teacher1} · {studentDemoData.teacher1Room}
          </div>
          <div className="h-2 w-full rounded-full bg-sys-accent/20 overflow-hidden mt-1">
            <div className="h-full bg-sys-accent rounded-full w-2/3 transition-all duration-500" />
          </div>
        </div>
      ),
    },
    {
      id: "student-navigation",
      icon: isTouchDevice ? "📱" : "💻",
      title: isTouchDevice ? "Свайпи та швидкі дні тижня" : "Сітка тижня та швидкі дні",
      caption: isTouchDevice
        ? "Гортайте дні природними свайпами пальцем вліво або вправо, або швидко торкайтеся потрібного дня у верхній смужці."
        : "На комп'ютері розклад відкривається у повній тижневій сітці (Пн–Пт). Окремі дні можна перемикати кліком або стрілками ← / →.",
      render: () => (
        <div
          onTouchStart={(e) => e.stopPropagation()}
          className="guide-interactive-demo rounded-2xl border border-sys-border bg-sys-card p-4 space-y-3 shadow-md"
        >
          {!isTouchDevice ? (
            <div className="flex items-center justify-between text-xs border-b border-sys-border/50 pb-2">
              <span className="font-bold text-sys-text-primary flex items-center gap-1.5">
                <span>🖥️</span> Режим перегляду на ПК
              </span>
              <span className="rounded-md bg-sys-accent/15 border border-sys-accent/30 text-sys-accent font-semibold px-2 py-0.5 text-[10px]">
                Тижнева сітка / День
              </span>
            </div>
          ) : null}

          <div className="grid grid-cols-5 gap-1 text-center">
            {DEFAULT_DAYS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDemoNavDay(d)}
                className={`py-1.5 rounded-xl border text-xs font-bold transition-all ${
                  demoNavDay === d
                    ? "bg-sys-accent text-white border-sys-accent shadow-xs scale-105"
                    : "bg-sys-bg border-sys-border text-sys-text-secondary hover:text-sys-text-primary"
                }`}
              >
                {d}
              </button>
            ))}
          </div>

          {isTouchDevice ? (
            <div className="flex items-center justify-between px-2 text-[11px] text-sys-text-muted">
              <button
                type="button"
                onClick={() => {
                  const idx = DEFAULT_DAYS.indexOf(demoNavDay);
                  if (idx > 0) setDemoNavDay(DEFAULT_DAYS[idx - 1]);
                }}
                className="hover:text-sys-text-primary transition-colors font-semibold"
              >
                👈 Вчора
              </button>
              <span className="text-sys-accent font-medium">Свайпайте картку</span>
              <button
                type="button"
                onClick={() => {
                  const idx = DEFAULT_DAYS.indexOf(demoNavDay);
                  if (idx < DEFAULT_DAYS.length - 1) setDemoNavDay(DEFAULT_DAYS[idx + 1]);
                }}
                className="hover:text-sys-text-primary transition-colors font-semibold"
              >
                Завтра 👉
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-2 py-0.5 text-[11px] text-sys-text-muted">
              <span className="inline-flex items-center gap-1 rounded bg-sys-bg border border-sys-border px-1.5 py-0.5 font-mono text-[10px] text-sys-text-secondary">
                ←
              </span>
              <span>або</span>
              <span className="inline-flex items-center gap-1 rounded bg-sys-bg border border-sys-border px-1.5 py-0.5 font-mono text-[10px] text-sys-text-secondary">
                →
              </span>
              <span>на клавіатурі для швидкої зміни дня</span>
            </div>
          )}

          <div
            onTouchStart={handleCardTouchStart}
            onTouchMove={handleCardTouchMove}
            onTouchEnd={handleCardTouchEnd}
            className="rounded-xl border border-sys-border/80 bg-sys-bg p-3.5 space-y-1.5 transition-all select-none cursor-grab active:cursor-grabbing"
          >
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-sys-text-secondary flex items-center gap-1.5">
                <span className="rounded bg-sys-card border border-sys-border px-1.5 py-0.5 text-[10px] font-bold text-sys-accent">
                  {activeNavLessonStudent.day}
                </span>
                <span>{activeNavLessonStudent.lessonNumber} пара · {activeNavLessonStudent.time}</span>
              </span>
              <span className="rounded-md border border-sys-border bg-sys-card px-2 py-0.5 text-[11px] font-semibold text-sys-text-secondary">
                {activeNavLessonStudent.room}
              </span>
            </div>
            <div className="font-bold text-sm text-sys-text-primary truncate">
              {activeNavLessonStudent.subject}
            </div>
            <div className="text-xs text-sys-text-secondary truncate">
              {activeNavLessonStudent.teacher}
            </div>
          </div>
        </div>
      ),
    },
    {
      id: "student-subgroups",
      icon: "👥",
      title: "Обидві підгрупи та швидкий фільтр",
      caption: "Розклад показує обох викладачів паралельно. Натискайте прямо на «1 підгр.» чи «2 підгр.», щоб залишити тільки свого викладача.",
      render: () => (
        <div
          onTouchStart={(e) => e.stopPropagation()}
          className="guide-interactive-demo rounded-2xl border border-sys-border bg-sys-card p-4 space-y-3 shadow-md"
        >
          <div className="flex items-center justify-between text-xs border-b border-sys-border/50 pb-2">
            <span className="font-bold text-sys-text-secondary">2 пара · 10:40–12:00</span>
            <span className="text-[11px] text-sys-accent font-semibold">
              {demoSubgroup === null ? "Обидві підгрупи" : `${demoSubgroup} підгрупа`}
            </span>
          </div>
          <div className="font-bold text-sm sm:text-base text-sys-text-primary">
            {studentDemoData.subgroupSubject}
          </div>
          <div className="space-y-2 pt-1">
            {(demoSubgroup === null || demoSubgroup === 1) && (
              <div className={`flex items-center justify-between rounded-xl border p-2.5 transition-colors ${
                demoSubgroup === 1
                  ? "border-sys-accent/40 bg-sys-accent/10"
                  : "border-sys-border bg-sys-bg"
              }`}>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setDemoSubgroup(demoSubgroup === 1 ? null : 1)}
                    className={`inline-flex shrink-0 items-center gap-1.5 h-6 px-2 rounded-md border text-xs font-semibold active:scale-95 transition-colors duration-fast ease-smooth shadow-2xs ${
                      demoSubgroup === 1
                        ? "border-sys-accent/35 bg-sys-accent/15 text-sys-accent hover:bg-sys-accent/25"
                        : "bg-sys-bg/80 border-sys-border text-sys-text-secondary hover:text-sys-text-primary hover:border-sys-accent/40 hover:bg-sys-accent/5"
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                        demoSubgroup === 1 ? "bg-sys-accent" : "bg-sys-text-muted/60"
                      }`}
                      aria-hidden="true"
                    />
                    <span>1 підгр.</span>
                  </button>
                  <span className="text-xs font-semibold text-sys-text-primary">
                    {studentDemoData.teacher1}
                  </span>
                </div>
                <span className="text-xs font-medium text-sys-text-secondary">
                  {studentDemoData.teacher1Room}
                </span>
              </div>
            )}
            {(demoSubgroup === null || demoSubgroup === 2) && (
              <div className={`flex items-center justify-between rounded-xl border p-2.5 transition-colors ${
                demoSubgroup === 2
                  ? "border-sys-accent/40 bg-sys-accent/10"
                  : "border-sys-border bg-sys-bg"
              }`}>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setDemoSubgroup(demoSubgroup === 2 ? null : 2)}
                    className={`inline-flex shrink-0 items-center gap-1.5 h-6 px-2 rounded-md border text-xs font-semibold active:scale-95 transition-colors duration-fast ease-smooth shadow-2xs ${
                      demoSubgroup === 2
                        ? "border-sys-accent/35 bg-sys-accent/15 text-sys-accent hover:bg-sys-accent/25"
                        : "bg-sys-bg/80 border-sys-border text-sys-text-secondary hover:text-sys-text-primary hover:border-sys-accent/40 hover:bg-sys-accent/5"
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                        demoSubgroup === 2 ? "bg-sys-accent" : "bg-sys-text-muted/60"
                      }`}
                      aria-hidden="true"
                    />
                    <span>2 підгр.</span>
                  </button>
                  <span className="text-xs font-semibold text-sys-text-primary">
                    {studentDemoData.teacher2}
                  </span>
                </div>
                <span className="text-xs font-medium text-sys-text-secondary">
                  {studentDemoData.teacher2Room}
                </span>
              </div>
            )}
          </div>
          <div className="text-center">
            {demoSubgroup !== null ? (
              <button
                type="button"
                onClick={() => setDemoSubgroup(null)}
                className="text-xs text-sys-accent font-bold hover:underline"
              >
                Показати обидві підгрупи ✓
              </button>
            ) : (
              <span className="text-[11px] text-sys-text-muted">
                👆 Натискайте на бейджі підгруп прямо на картці
              </span>
            )}
          </div>
        </div>
      ),
    },
    {
      id: "student-classroom",
      icon: "📋",
      title: "Classroom: дедлайни та оцінки",
      caption: "Усі завдання синхронізуються автоматично. Підключивши студентську пошту, ви бачите особистий статус здачі та оцінки викладачів.",
      render: () => (
        <div
          onTouchStart={(e) => e.stopPropagation()}
          className="guide-interactive-demo rounded-2xl border border-sys-border bg-sys-card p-4 space-y-2.5 shadow-md"
        >
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-sys-text-secondary">{studentDemoData.hwSubject}</span>
            <span className="text-emerald-700 dark:text-emerald-400 font-bold text-[11px]">Classroom ✓</span>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between rounded-xl border border-purple-500/30 bg-purple-500/10 p-2.5 text-xs">
              <div>
                <div className="font-bold text-sys-text-primary">Практична робота №3</div>
                <div className="text-purple-700 dark:text-purple-300 text-[11px]">Термін: сьогодні до 23:59 ↗</div>
              </div>
              <span className="rounded-md bg-amber-500/20 text-amber-800 dark:text-amber-300 font-bold px-2 py-0.5 text-[10px]">
                Дедлайн
              </span>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-2.5 text-xs">
              <div>
                <div className="font-bold text-sys-text-primary">Лабораторна робота №2</div>
                <div className="text-emerald-700 dark:text-emerald-300 text-[11px]">Роботу перевірено ✓</div>
              </div>
              <span className="rounded-md bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 font-bold px-2 py-0.5 text-xs">
                12 / 12
              </span>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: "student-stats",
      icon: "📊",
      title: "Статистика занять та графік семестру",
      caption: "Слідкуйте за академічним навантаженням групи, годинами за кожним предметом та семестровим планом у розділі «Статистика».",
      render: () => (
        <div
          onTouchStart={(e) => e.stopPropagation()}
          className="guide-interactive-demo rounded-2xl border border-sys-border bg-sys-card p-4 space-y-3 shadow-md"
        >
          <div className="flex items-center justify-between text-xs border-b border-sys-border/50 pb-2">
            <div className="flex items-center gap-1.5">
              <span className="font-black text-sys-text-primary text-sm sm:text-base">{groupName}</span>
              <span className="rounded-full bg-sys-accent/15 text-sys-accent px-2 py-0.5 font-bold text-[10px]">
                Семестр 2
              </span>
            </div>
            <span className="text-[10px] text-sys-text-muted">
              Розрахунок за семестр
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-center">
            <div className="rounded-xl border border-sys-border bg-sys-bg p-2 flex flex-col justify-center items-center">
              <span className="text-[10px] font-bold uppercase tracking-wider text-sys-text-secondary">
                Вивчено
              </span>
              <span className="mt-0.5 text-xl font-black text-sys-accent leading-none">
                164
              </span>
              <span className="mt-0.5 text-[10px] text-sys-text-muted">
                акад. год · 82 пари
              </span>
            </div>
            <div className="rounded-xl border border-sys-border bg-sys-bg p-2 flex flex-col justify-center items-center">
              <span className="text-[10px] font-bold uppercase tracking-wider text-sys-text-secondary">
                Дисциплін
              </span>
              <span className="mt-0.5 text-xl font-black text-sys-text-primary leading-none">
                {studentDemoData.distinctCount}
              </span>
              <span className="mt-0.5 text-[10px] text-sys-text-muted">
                у поточному семестрі
              </span>
            </div>
          </div>

          <div className="rounded-xl border border-sys-border bg-sys-bg p-2 flex items-center gap-3">
            <div className="relative w-9 h-9 shrink-0 flex items-center justify-center">
              <svg className="w-full h-full transform -rotate-90" viewBox="0 0 44 44">
                <circle
                  cx="22" cy="22" r="18"
                  stroke="currentColor" strokeWidth="3.5" fill="none"
                  className="text-sys-border/70"
                />
                <circle
                  cx="22" cy="22" r="18"
                  stroke="currentColor" strokeWidth="3.5" fill="none"
                  strokeDasharray={2 * Math.PI * 18}
                  strokeDashoffset={2 * Math.PI * 18 - (studentDemoData.statSubjects[0].percent / 100) * (2 * Math.PI * 18)}
                  className="text-sys-accent transition-all duration-700"
                  strokeLinecap="round"
                />
              </svg>
              <span className="absolute text-[10px] font-bold text-sys-text-primary">
                {studentDemoData.statSubjects[0].percent}%
              </span>
            </div>
            <div className="flex-1 min-w-0 text-left">
              <div className="font-semibold text-xs text-sys-text-primary truncate">
                {studentDemoData.statSubjects[0].name}
              </div>
              <div className="text-[10px] text-sys-text-secondary">
                {studentDemoData.statSubjects[0].hours} з {studentDemoData.statSubjects[0].plannedHours} акад. год · {Math.round(studentDemoData.statSubjects[0].hours / 2)} пар
              </div>
            </div>
          </div>

          <Link
            href="/statistics"
            onClick={onClose}
            className="w-full flex items-center justify-center gap-1.5 rounded-xl bg-sys-accent px-4 py-2 text-xs font-bold text-white shadow-xs hover:opacity-95 active:scale-95 transition-colors duration-fast ease-smooth"
          >
            <span>Відкрити детальну статистику</span>
            <span>↗</span>
          </Link>
        </div>
      ),
    },
    {
      id: "student-pwa",
      icon: "📲",
      title: "Працює без інтернету (PWA)",
      caption: "Розклад автоматично зберігається на вашому пристрої та відкривається навіть під час відключень зв'язку чи світла.",
      render: () => (
        <div
          onTouchStart={(e) => e.stopPropagation()}
          className="guide-interactive-demo rounded-2xl border border-sys-border bg-sys-card p-4 space-y-3 shadow-md"
        >
          <div className="flex items-center gap-3">
            <span className="text-2xl">⚡</span>
            <div className="text-left">
              <div className="font-bold text-xs sm:text-sm text-sys-text-primary">
                {isStandalone ? "✓ Застосунок уже на вашому екрані" : "Встановлення на головний екран"}
              </div>
              <div className="text-[11px] text-sys-text-secondary">
                Працює як рідний мобільний додаток
              </div>
            </div>
          </div>
          <p className="text-xs text-sys-text-secondary text-left leading-relaxed">
            {isStandalone
              ? "Ви вже використовуєте автономну версію розкладу."
              : isIos
              ? "Натисніть кнопку «Поділитися» ⎋ у Safari, потім — «На початковий екран» ⊞."
              : "Натисніть кнопку нижче або скористайтеся меню браузера (⋮) → «Встановити додаток»."}
          </p>
          {!isStandalone && (
            <button
              type="button"
              onClick={async () => {
                if (pwaPrompt && typeof pwaPrompt.prompt === "function") {
                  try {
                    await pwaPrompt.prompt();
                    const choice = await pwaPrompt.userChoice;
                    if (choice?.outcome === "accepted") {
                      setIsStandalone(true);
                      setPwaFeedback("✅ Додаток успішно встановлено!");
                    }
                  } catch {}
                } else if (isIos) {
                  setPwaFeedback("В Safari: «Поділитися» ⎋ → «На початковий екран» ⊞");
                } else {
                  setPwaFeedback("Відкрийте меню браузера (⋮) → «Встановити додаток».");
                }
              }}
              className="w-full rounded-xl bg-sys-accent py-2.5 text-xs sm:text-sm font-bold text-white shadow-md active:scale-95 transition-all"
            >
              📲 Додати розклад на екран
            </button>
          )}
          {pwaFeedback && (
            <div className="text-xs text-center text-sys-accent font-semibold pt-1">
              {pwaFeedback}
            </div>
          )}
        </div>
      ),
    },
  ];

  // Teacher Slides
  const teacherSlides = [
    {
      id: "teacher-live",
      icon: "🔴",
      title: "«Жива» пара та аудиторія",
      caption: "Пара, яку ви ведете просто зараз, автоматично виділяється акцентним кольором. Ви одразу бачите номер аудиторії, групу студентів та точний таймер до дзвінка.",
      render: () => (
        <div
          onTouchStart={(e) => e.stopPropagation()}
          className="guide-interactive-demo relative rounded-2xl border border-sys-accent bg-gradient-to-br from-sys-accent/15 via-sys-card to-sys-card p-4 space-y-3 shadow-lg"
        >
          <div className="flex items-center justify-between text-xs">
            <span className="font-black text-sys-accent">
              1 пара · 09:00–10:20
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-sys-accent/20 border border-sys-accent/40 px-2.5 py-0.5 text-xs font-bold text-sys-accent">
              <span className="h-2 w-2 rounded-full bg-sys-accent animate-ping" />
              ще 25 хв
            </span>
          </div>
          <div className="font-bold text-base text-sys-text-primary truncate">
            {teacherDemoData.liveSubject}
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="inline-flex items-center gap-1.5 font-bold text-sys-text-primary">
              <span className="h-2 w-2 rounded-full bg-sys-accent" />
              Група: {teacherDemoData.liveGroup}
            </span>
            <span className="rounded-md border border-sys-border bg-sys-bg px-2 py-0.5 font-bold text-sys-text-secondary">
              {teacherDemoData.liveRoom}
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-sys-accent/20 overflow-hidden mt-1">
            <div className="h-full bg-sys-accent rounded-full w-2/3 transition-all duration-500" />
          </div>
        </div>
      ),
    },
    {
      id: "teacher-navigation",
      icon: isTouchDevice ? "📱" : "💻",
      title: isTouchDevice ? "Свайпи та робочі дні тижня" : "Тижнева сітка та робочі дні",
      caption: isTouchDevice
        ? "Гортайте робочі дні свайпами пальцем вліво або вправо, або швидко переходьте до потрібного дня у верхній панелі."
        : "На комп'ютері розклад відкривається у повній сітці тижня (Пн–Пт). Швидко перемикайте дні кліком або стрілками ← / → на клавіатурі.",
      render: () => (
        <div
          onTouchStart={(e) => e.stopPropagation()}
          className="guide-interactive-demo rounded-2xl border border-sys-border bg-sys-card p-4 space-y-3 shadow-md"
        >
          {!isTouchDevice ? (
            <div className="flex items-center justify-between text-xs border-b border-sys-border/50 pb-2">
              <span className="font-bold text-sys-text-primary flex items-center gap-1.5">
                <span>🖥️</span> Розклад викладача на ПК
              </span>
              <span className="rounded-md bg-sys-accent/15 border border-sys-accent/30 text-sys-accent font-semibold px-2 py-0.5 text-[10px]">
                Тижнева сітка / День
              </span>
            </div>
          ) : null}

          <div className="grid grid-cols-5 gap-1 text-center">
            {DEFAULT_DAYS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDemoNavDay(d)}
                className={`py-1.5 rounded-xl border text-xs font-bold transition-all ${
                  demoNavDay === d
                    ? "bg-sys-accent text-white border-sys-accent shadow-xs scale-105"
                    : "bg-sys-bg border-sys-border text-sys-text-secondary hover:text-sys-text-primary"
                }`}
              >
                {d}
              </button>
            ))}
          </div>

          {isTouchDevice ? (
            <div className="flex items-center justify-between px-2 text-[11px] text-sys-text-muted">
              <button
                type="button"
                onClick={() => {
                  const idx = DEFAULT_DAYS.indexOf(demoNavDay);
                  if (idx > 0) setDemoNavDay(DEFAULT_DAYS[idx - 1]);
                }}
                className="hover:text-sys-text-primary transition-colors font-semibold"
              >
                👈 Вчора
              </button>
              <span className="text-sys-accent font-medium">Свайпайте картку</span>
              <button
                type="button"
                onClick={() => {
                  const idx = DEFAULT_DAYS.indexOf(demoNavDay);
                  if (idx < DEFAULT_DAYS.length - 1) setDemoNavDay(DEFAULT_DAYS[idx + 1]);
                }}
                className="hover:text-sys-text-primary transition-colors font-semibold"
              >
                Завтра 👉
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-2 py-0.5 text-[11px] text-sys-text-muted">
              <span className="inline-flex items-center gap-1 rounded bg-sys-bg border border-sys-border px-1.5 py-0.5 font-mono text-[10px] text-sys-text-secondary">
                ←
              </span>
              <span>або</span>
              <span className="inline-flex items-center gap-1 rounded bg-sys-bg border border-sys-border px-1.5 py-0.5 font-mono text-[10px] text-sys-text-secondary">
                →
              </span>
              <span>на клавіатурі для швидкої зміни дня</span>
            </div>
          )}

          <div
            onTouchStart={handleCardTouchStart}
            onTouchMove={handleCardTouchMove}
            onTouchEnd={handleCardTouchEnd}
            className="rounded-xl border border-sys-border/80 bg-sys-bg p-3.5 space-y-1.5 transition-all select-none cursor-grab active:cursor-grabbing"
          >
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-sys-text-secondary flex items-center gap-1.5">
                <span className="rounded bg-sys-card border border-sys-border px-1.5 py-0.5 text-[10px] font-bold text-sys-accent">
                  {activeNavLessonTeacher.day}
                </span>
                <span>{activeNavLessonTeacher.lessonNumber} пара · {activeNavLessonTeacher.time}</span>
              </span>
              <span className="rounded-md border border-sys-border bg-sys-card px-2 py-0.5 text-[11px] font-semibold text-sys-text-secondary">
                {activeNavLessonTeacher.room}
              </span>
            </div>
            <div className="font-bold text-sm text-sys-text-primary truncate">
              {activeNavLessonTeacher.subject}
            </div>
            <div className="flex items-center justify-between text-xs text-sys-text-secondary pt-0.5">
              <span className="font-semibold text-sys-accent">Група: {activeNavLessonTeacher.group}</span>
              <span className="text-[11px] text-sys-text-muted">{teacherDemoData.teacherName}</span>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: "teacher-pin",
      icon: "🔒",
      title: "Захист онлайн-посилань та PIN-код",
      caption: "Студенти бачать відкриті посилання лише для своєї групи. Ввівши персональний PIN-код викладача, ви розблоковуєте доступ до всіх своїх занять у Google Meet та Zoom.",
      render: () => (
        <div
          onTouchStart={(e) => e.stopPropagation()}
          className="guide-interactive-demo rounded-2xl border border-sys-border bg-sys-card p-4 space-y-3 shadow-md"
        >
          <div className="flex items-center justify-between text-xs border-b border-sys-border/50 pb-2">
            <span className="font-bold text-sys-text-secondary">Онлайн-заняття · {teacherDemoData.liveGroup}</span>
            <span className={`text-[11px] font-bold ${demoPinUnlocked ? "text-emerald-700 dark:text-emerald-400" : "text-amber-800 dark:text-amber-300"}`}>
              {demoPinUnlocked ? "Розблоковано ✓" : "Потрібен PIN 🔒"}
            </span>
          </div>
          <div className="font-bold text-sm text-sys-text-primary">
            {teacherDemoData.liveSubject}
          </div>
          <div className="pt-1">
            {demoPinUnlocked ? (
              <div className="space-y-2">
                <div className="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-600 dark:bg-emerald-500 text-white py-2.5 px-3 text-xs font-bold shadow-md">
                  <span>🎥</span>
                  <span>Meet · Підключитися до пари</span>
                </div>
                <div className="flex items-center justify-between px-1 text-[11px]">
                  <span className="text-emerald-700 dark:text-emerald-400 font-semibold">✓ Усі посилання відкрито</span>
                  <button
                    type="button"
                    onClick={() => setDemoPinUnlocked(false)}
                    className="text-sys-accent font-bold hover:underline"
                  >
                    Заблокувати назад ↺
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => setDemoPinUnlocked(true)}
                  className="w-full flex items-center justify-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 text-amber-800 dark:text-amber-300 py-2.5 px-3 text-xs font-bold transition-all active:scale-95"
                >
                  <span>🔒</span>
                  <span>Ввести PIN-код для відкриття Meet</span>
                </button>
                <p className="text-[11px] text-sys-text-muted text-center">
                  👆 Натисніть кнопку вище для перевірки розблокування
                </p>
              </div>
            )}
          </div>
        </div>
      ),
    },
    {
      id: "teacher-groups",
      icon: "👥",
      title: "Групи та аудиторії викладача",
      caption: "У розкладі викладача чітко позначено, для якої групи проводиться заняття. Спільні лекційні потоки об'єднуються, а номер аудиторії вказується окремо для кожної пари.",
      render: () => (
        <div
          onTouchStart={(e) => e.stopPropagation()}
          className="guide-interactive-demo rounded-2xl border border-sys-border bg-sys-card p-4 space-y-3 shadow-md"
        >
          <div className="flex items-center justify-between text-xs border-b border-sys-border/50 pb-2">
            <span className="font-bold text-sys-text-secondary">2 пара · 10:40–12:00</span>
            <span className="rounded-full bg-sys-accent/15 text-sys-accent px-2 py-0.5 text-[10px] font-bold">
              Розклад викладача
            </span>
          </div>
          <div className="font-bold text-sm sm:text-base text-sys-text-primary">
            {teacherDemoData.liveSubject}
          </div>
          <div className="flex items-center gap-2 pt-1">
            <span className="text-xs text-sys-text-secondary font-medium">Закріплена група:</span>
            <div className="flex gap-1.5">
              {teacherDemoData.groupsList.slice(0, 2).map((grp) => (
                <button
                  key={grp}
                  type="button"
                  onClick={() => setDemoTeacherGroup(grp)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-all ${
                    demoTeacherGroup === grp
                      ? "bg-sys-accent text-white border-sys-accent shadow-xs"
                      : "bg-sys-bg border-sys-border text-sys-text-secondary hover:text-sys-text-primary"
                  }`}
                >
                  {grp}
                </button>
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-sys-border bg-sys-bg p-2.5 flex items-center justify-between text-xs">
            <span className="font-semibold text-sys-text-primary">
              Аудиторія для групи {demoTeacherGroup}:
            </span>
            <span className="font-bold text-sys-accent">
              {teacherDemoData.liveRoom}
            </span>
          </div>
        </div>
      ),
    },
    {
      id: "teacher-stats",
      icon: "📊",
      title: "Навантаження та години за семестр",
      caption: "Слідкуйте за виконанням академічного навантаження, відпрацьованими годинами та парами за кожним закріпленим предметом і групою у розділі «Статистика».",
      render: () => (
        <div
          onTouchStart={(e) => e.stopPropagation()}
          className="guide-interactive-demo rounded-2xl border border-sys-border bg-sys-card p-4 space-y-3 shadow-md"
        >
          <div className="flex items-center justify-between text-xs border-b border-sys-border/50 pb-2">
            <div className="flex items-center gap-1.5">
              <span className="font-black text-sys-text-primary text-sm sm:text-base truncate max-w-[200px]">
                {teacherDemoData.teacherName}
              </span>
              <span className="rounded-full bg-sys-accent/15 text-sys-accent px-2 py-0.5 font-bold text-[10px]">
                Семестр 2
              </span>
            </div>
            <span className="text-[10px] text-sys-text-muted">
              Викладач
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-center">
            <div className="rounded-xl border border-sys-border bg-sys-bg p-2 flex flex-col justify-center items-center">
              <span className="text-[10px] font-bold uppercase tracking-wider text-sys-text-secondary">
                Вичитано
              </span>
              <span className="mt-0.5 text-xl font-black text-sys-accent leading-none">
                {teacherDemoData.totalHours}
              </span>
              <span className="mt-0.5 text-[10px] text-sys-text-muted">
                акад. год · {teacherDemoData.totalLessons} пар
              </span>
            </div>
            <div className="rounded-xl border border-sys-border bg-sys-bg p-2 flex flex-col justify-center items-center">
              <span className="text-[10px] font-bold uppercase tracking-wider text-sys-text-secondary">
                Дисциплін
              </span>
              <span className="mt-0.5 text-xl font-black text-sys-text-primary leading-none">
                {teacherDemoData.statSubjects.length}
              </span>
              <span className="mt-0.5 text-[10px] text-sys-text-muted">
                у поточному семестрі
              </span>
            </div>
          </div>

          <div className="rounded-xl border border-sys-border bg-sys-bg p-2 flex items-center gap-3">
            <div className="relative w-9 h-9 shrink-0 flex items-center justify-center">
              <svg className="w-full h-full transform -rotate-90" viewBox="0 0 44 44">
                <circle
                  cx="22" cy="22" r="18"
                  stroke="currentColor" strokeWidth="3.5" fill="none"
                  className="text-sys-border/70"
                />
                <circle
                  cx="22" cy="22" r="18"
                  stroke="currentColor" strokeWidth="3.5" fill="none"
                  strokeDasharray={2 * Math.PI * 18}
                  strokeDashoffset={2 * Math.PI * 18 - (teacherDemoData.statSubjects[0].percent / 100) * (2 * Math.PI * 18)}
                  className="text-sys-accent transition-all duration-700"
                  strokeLinecap="round"
                />
              </svg>
              <span className="absolute text-[10px] font-bold text-sys-text-primary">
                {teacherDemoData.statSubjects[0].percent}%
              </span>
            </div>
            <div className="flex-1 min-w-0 text-left">
              <div className="font-semibold text-xs text-sys-text-primary truncate">
                {teacherDemoData.statSubjects[0].name}
              </div>
              <div className="text-[10px] text-sys-text-secondary">
                {teacherDemoData.statSubjects[0].hours} з {teacherDemoData.statSubjects[0].plannedHours} акад. год · {Math.round(teacherDemoData.statSubjects[0].hours / 2)} пар
              </div>
            </div>
          </div>

          <Link
            href="/statistics"
            onClick={onClose}
            className="w-full flex items-center justify-center gap-1.5 rounded-xl bg-sys-accent px-4 py-2 text-xs font-bold text-white shadow-xs hover:opacity-95 active:scale-95 transition-colors duration-fast ease-smooth"
          >
            <span>Відкрити статистику викладача</span>
            <span>↗</span>
          </Link>
        </div>
      ),
    },
    {
      id: "teacher-pwa",
      icon: "📲",
      title: "Розклад завжди офлайн (PWA)",
      caption: "Розклад викладача кешується безпосередньо у пам'ять телефону чи ноутбука. Він миттєво відкривається навіть під час блекаутів та відсутності зв'язку.",
      render: () => (
        <div
          onTouchStart={(e) => e.stopPropagation()}
          className="guide-interactive-demo rounded-2xl border border-sys-border bg-sys-card p-4 space-y-3 shadow-md"
        >
          <div className="flex items-center gap-3">
            <span className="text-2xl">⚡</span>
            <div className="text-left">
              <div className="font-bold text-xs sm:text-sm text-sys-text-primary">
                {isStandalone ? "✓ Застосунок уже на вашому екрані" : "Встановлення на головний екран"}
              </div>
              <div className="text-[11px] text-sys-text-secondary">
                Працює як рідний додаток викладача
              </div>
            </div>
          </div>
          <p className="text-xs text-sys-text-secondary text-left leading-relaxed">
            {isStandalone
              ? "Ви вже використовуєте автономну версію розкладу."
              : isIos
              ? "Натисніть кнопку «Поділитися» ⎋ у Safari, потім — «На початковий екран» ⊞."
              : "Натисніть кнопку нижче або скористайтеся меню браузера (⋮) → «Встановити додаток»."}
          </p>
          {!isStandalone && (
            <button
              type="button"
              onClick={async () => {
                if (pwaPrompt && typeof pwaPrompt.prompt === "function") {
                  try {
                    await pwaPrompt.prompt();
                    const choice = await pwaPrompt.userChoice;
                    if (choice?.outcome === "accepted") {
                      setIsStandalone(true);
                      setPwaFeedback("✅ Додаток успішно встановлено!");
                    }
                  } catch {}
                } else if (isIos) {
                  setPwaFeedback("В Safari: «Поділитися» ⎋ → «На початковий екран» ⊞");
                } else {
                  setPwaFeedback("Відкрийте меню браузера (⋮) → «Встановити додаток».");
                }
              }}
              className="w-full rounded-xl bg-sys-accent py-2.5 text-xs sm:text-sm font-bold text-white shadow-md active:scale-95 transition-all"
            >
              📲 Додати розклад викладача на екран
            </button>
          )}
          {pwaFeedback && (
            <div className="text-xs text-center text-sys-accent font-semibold pt-1">
              {pwaFeedback}
            </div>
          )}
        </div>
      ),
    },
  ];

  const slides = guideMode === "teacher" ? teacherSlides : studentSlides;
  const total = slides.length;
  const current = slides[activeSlide] || slides[0];

  // Story swipe handling
  const minSwipeDistance = 50;
  const onTouchStartHandler = (e: React.TouchEvent) => {
    if ((e.target as HTMLElement).closest(".guide-interactive-demo")) {
      setTouchStart(null);
      setTouchEnd(null);
      return;
    }
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
  };
  const onTouchMoveHandler = (e: React.TouchEvent) => {
    if (touchStart === null) return;
    setTouchEnd(e.targetTouches[0].clientX);
  };
  const onTouchEndHandler = () => {
    if (touchStart === null || touchEnd === null) return;
    const distance = touchStart - touchEnd;
    if (distance > minSwipeDistance && activeSlide < total - 1) {
      setActiveSlide((prev) => prev + 1);
    } else if (distance < -minSwipeDistance && activeSlide > 0) {
      setActiveSlide((prev) => prev - 1);
    }
    setTouchStart(null);
    setTouchEnd(null);
  };

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }

      if (slides[activeSlide]?.id.includes("nav")) {
        const currentIdx = DEFAULT_DAYS.indexOf(demoNavDay);
        if (e.key === "ArrowRight") {
          if (currentIdx < DEFAULT_DAYS.length - 1) {
            setDemoNavDay(DEFAULT_DAYS[currentIdx + 1]);
            return;
          }
        } else if (e.key === "ArrowLeft") {
          if (currentIdx > 0) {
            setDemoNavDay(DEFAULT_DAYS[currentIdx - 1]);
            return;
          }
        }
      }

      if (e.key === "ArrowRight" && activeSlide < total - 1) {
        setActiveSlide((prev) => prev + 1);
      } else if (e.key === "ArrowLeft" && activeSlide > 0) {
        setActiveSlide((prev) => prev - 1);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [activeSlide, total, demoNavDay, slides, onClose]);

  return (
    <motion.div
      key="guide-hub-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-5 backdrop-blur-md overflow-hidden"
    >
      <motion.div
        key="guide-hub-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="guide-title"
        initial={{ opacity: 0, scale: 0.94, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.94, y: 16 }}
        transition={{ type: "spring", stiffness: 350, damping: 28 }}
        onClick={(e) => e.stopPropagation()}
        className="relative flex flex-col w-full max-w-[480px] h-[565px] max-h-[94vh] rounded-3xl border border-sys-border bg-sys-card text-sys-text-primary shadow-2xl overflow-hidden"
      >
        {/* Top Header: Title, Mode switcher, Close, Story Progress */}
        <header className="px-5 pt-4 pb-2 bg-sys-card shrink-0 space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-lg">💡</span>
              <h2 id="guide-title" className="text-sm font-bold text-sys-text-primary">
                Як користуватися розкладом
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Закрити"
              className="flex h-8 w-8 items-center justify-center rounded-xl text-sys-text-secondary hover:text-sys-text-primary hover:bg-sys-bg transition-colors font-bold text-sm"
            >
              ✕
            </button>
          </div>

          {/* Guide Mode Toggle: Student vs Teacher */}
          <div className="flex items-center justify-between pt-0.5">
            <div className="inline-flex items-center rounded-xl bg-sys-bg border border-sys-border p-0.5 text-xs font-semibold">
              <button
                type="button"
                onClick={() => {
                  setGuideMode("student");
                  setActiveSlide(0);
                }}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                  guideMode === "student"
                    ? "bg-sys-accent text-white shadow-xs"
                    : "text-sys-text-secondary hover:text-sys-text-primary"
                }`}
              >
                🎓 Студент
              </button>
              <button
                type="button"
                onClick={() => {
                  setGuideMode("teacher");
                  setActiveSlide(0);
                }}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                  guideMode === "teacher"
                    ? "bg-sys-accent text-white shadow-xs"
                    : "text-sys-text-secondary hover:text-sys-text-primary"
                }`}
              >
                👨‍🏫 Викладач
              </button>
            </div>

            <span className="text-[11px] font-semibold text-sys-text-muted truncate max-w-[160px]">
              {guideMode === "student" ? groupName : teacherDemoData.teacherName}
            </span>
          </div>

          {/* Story Progress Bars */}
          <div className="flex items-center gap-1.5 pt-0.5">
            {slides.map((s, idx) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setActiveSlide(idx)}
                aria-label={`Слайд ${idx + 1}: ${s.title}`}
                className="flex-1 py-1 group focus:outline-hidden"
              >
                <div
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    idx === activeSlide
                      ? "bg-sys-accent shadow-xs"
                      : idx < activeSlide
                      ? "bg-sys-accent/40"
                      : "bg-sys-border"
                  }`}
                />
              </button>
            ))}
          </div>
        </header>

        {/* Center: Slide Visual Card + Punchy Caption */}
        <main
          onTouchStart={onTouchStartHandler}
          onTouchMove={onTouchMoveHandler}
          onTouchEnd={onTouchEndHandler}
          className="px-5 py-2.5 sm:px-6 flex-1 w-full flex flex-col justify-center overflow-hidden select-none relative"
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={`${guideMode}-${current.id}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.16, ease: "easeOut" }}
              className="w-full space-y-2.5 my-auto"
            >
              {/* Slide Title */}
              <div className="flex items-center gap-2">
                <span className="text-xl shrink-0">{current.icon}</span>
                <h3 className="font-black text-base sm:text-lg text-sys-text-primary tracking-tight truncate">
                  {current.title}
                </h3>
              </div>

              {/* Visual Mockup */}
              <div className="py-0.5 w-full">{current.render()}</div>

              {/* 1-2 Clear Sentences */}
              <p className="text-xs sm:text-sm text-sys-text-secondary leading-relaxed">
                {current.caption}
              </p>
            </motion.div>
          </AnimatePresence>
        </main>

        {/* Bottom Navigation: Prev, Dots, Next */}
        <footer className="flex items-center justify-between border-t border-sys-border/50 px-5 py-3.5 bg-sys-card shrink-0">
          <button
            type="button"
            onClick={() => setActiveSlide((prev) => Math.max(0, prev - 1))}
            disabled={activeSlide === 0}
            className="rounded-xl border border-sys-border bg-sys-bg px-4 py-2 text-xs sm:text-sm font-bold text-sys-text-secondary hover:text-sys-text-primary disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
          >
            ← Назад
          </button>

          <span className="text-xs font-bold text-sys-text-muted">
            {activeSlide + 1} з {total}
          </span>

          <button
            type="button"
            onClick={() => {
              if (activeSlide < total - 1) {
                setActiveSlide((prev) => prev + 1);
              } else {
                onClose();
              }
            }}
            className="rounded-xl bg-sys-accent px-5 py-2 text-xs sm:text-sm font-bold text-white hover:opacity-95 active:scale-95 transition-all shadow-md"
          >
            {activeSlide === total - 1 ? "Зрозуміло ✓" : "Далі →"}
          </button>
        </footer>
      </motion.div>
    </motion.div>
  );
}
