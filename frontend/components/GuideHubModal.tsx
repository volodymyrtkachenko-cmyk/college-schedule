"use client";

import { useEffect, useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useUserSettings } from "../lib/useUserSettings";
import { useTheme } from "../lib/useTheme";
import { useClassroomSubmissions } from "../lib/useClassroomSubmissions";
import { api, Lesson, ScheduleResponse } from "../lib/api";
import { extractOnlineMeetings, formatRoom, MeetingInfo, checkScheduleHasSubgroups } from "../lib/format";
import { parseLessonTeachers } from "../lib/quickJump";
import { DEFAULT_LESSON_TIMES, SHORTENED_LESSON_TIMES } from "../lib/constants/lessons";

export interface GuideHubModalProps {
  groupId?: number | null;
  onClose: () => void;
}

type CategoryId =
  | "all"
  | "schedule"
  | "classroom"
  | "online"
  | "export"
  | "navigation"
  | "pwa"
  | "advanced";

interface ExtractedGuideData {
  subgroupLesson: {
    lessonNumber: number;
    time: string;
    subjectName: string;
    teacher1Name: string;
    teacher1Room: string;
    teacher2Name: string;
    teacher2Room: string;
  };
  onlineLesson: {
    lessonNumber: number;
    time: string;
    subjectName: string;
    teacher: string;
    platform: "Meet" | "Zoom" | "Teams" | "Онлайн";
    url: string;
    hasRealLink: boolean;
  };
  homeworkLesson: {
    lessonNumber: number;
    time: string;
    subjectName: string;
    room: string;
  };
}

function safeFormatRoom(room?: string | null, fallback = "ауд. 101"): string {
  if (!room || !room.trim()) return fallback;
  return formatRoom(room.trim());
}

function extractDemoData(weekSchedule: ScheduleResponse[]): ExtractedGuideData {
  const allLessons: Lesson[] = [];
  weekSchedule.forEach((day) => {
    if (Array.isArray(day?.lessons)) {
      allLessons.push(...day.lessons);
    }
  });

  const uniqueSubjects = Array.from(
    new Set(allLessons.map((l) => l.subject_name?.trim()).filter(Boolean))
  );

  // 1. Subgroup Lesson
  const dualLesson = allLessons.find(
    (l) =>
      !l.is_cancelled &&
      (l.second_teacher_id != null ||
        (l.teacher_name && (l.teacher_name.includes(",") || l.teacher_name.includes("/"))) ||
        (l.teacher_room && l.second_teacher_room))
  );

  let subgroupDemo: ExtractedGuideData["subgroupLesson"];
  if (dualLesson) {
    const parsedTeachers = parseLessonTeachers(dualLesson);
    const t1 = parsedTeachers[0]?.name || dualLesson.teacher_name?.split(/[,/]/)[0]?.trim() || "Викладач 1";
    const t2 = parsedTeachers[1]?.name || dualLesson.teacher_name?.split(/[,/]/)[1]?.trim() || "Викладач 2";
    subgroupDemo = {
      lessonNumber: dualLesson.lesson_number || 1,
      time: dualLesson.time || DEFAULT_LESSON_TIMES[1],
      subjectName: dualLesson.subject_name,
      teacher1Name: t1,
      teacher1Room: safeFormatRoom(dualLesson.teacher_room || dualLesson.room, "ауд. 101"),
      teacher2Name: t2,
      teacher2Room: safeFormatRoom(dualLesson.second_teacher_room || dualLesson.room, "ауд. 102"),
    };
  } else if (allLessons.length > 0) {
    const firstLesson = allLessons.find((l) => !l.is_cancelled && l.teacher_name) || allLessons[0];
    const otherTeacherLesson = allLessons.find(
      (l) => !l.is_cancelled && l.teacher_name && l.teacher_name !== firstLesson.teacher_name
    );
    subgroupDemo = {
      lessonNumber: firstLesson.lesson_number || 1,
      time: firstLesson.time || DEFAULT_LESSON_TIMES[1],
      subjectName: firstLesson.subject_name,
      teacher1Name: firstLesson.teacher_name || "Викладач 1",
      teacher1Room: safeFormatRoom(firstLesson.room, "ауд. 101"),
      teacher2Name: otherTeacherLesson?.teacher_name || "Викладач 2",
      teacher2Room: "ауд. 102",
    };
  } else {
    subgroupDemo = {
      lessonNumber: 1,
      time: DEFAULT_LESSON_TIMES[1],
      subjectName: "Комп'ютерні мережі",
      teacher1Name: "Викладач підгрупи 1",
      teacher1Room: "ауд. 101",
      teacher2Name: "Викладач підгрупи 2",
      teacher2Room: "ауд. 102",
    };
  }

  // 2. Online Lesson
  let foundOnline: { lesson: Lesson; meeting: MeetingInfo } | null = null;
  for (const l of allLessons) {
    if (l.is_cancelled) continue;
    const meetings = extractOnlineMeetings(
      l.note,
      l.room,
      l.teacher_name,
      l.subject_name,
      l.teacher_room,
      l.second_teacher_room
    );
    if (meetings && meetings.length > 0 && meetings[0].url) {
      foundOnline = { lesson: l, meeting: meetings[0] };
      break;
    }
  }

  let onlineDemo: ExtractedGuideData["onlineLesson"];
  if (foundOnline) {
    const plat = foundOnline.meeting.platform;
    const platName: "Meet" | "Zoom" | "Teams" | "Онлайн" =
      plat === "zoom" ? "Zoom" : plat === "meet" ? "Meet" : plat === "teams" ? "Teams" : "Онлайн";
    onlineDemo = {
      lessonNumber: foundOnline.lesson.lesson_number || 2,
      time: foundOnline.lesson.time || DEFAULT_LESSON_TIMES[2],
      subjectName: foundOnline.lesson.subject_name,
      teacher: foundOnline.lesson.teacher_name || "Викладач дисципліни",
      platform: platName,
      url: foundOnline.meeting.url,
      hasRealLink: true,
    };
  } else if (allLessons.length > 0) {
    const target =
      allLessons.find((l) => !l.is_cancelled && l.subject_name !== subgroupDemo.subjectName) || allLessons[0];
    onlineDemo = {
      lessonNumber: target.lesson_number || 2,
      time: target.time || DEFAULT_LESSON_TIMES[2],
      subjectName: `${target.subject_name} (Дистанційно)`,
      teacher: target.teacher_name || "Викладач",
      platform: "Meet",
      url: "",
      hasRealLink: false,
    };
  } else {
    onlineDemo = {
      lessonNumber: 2,
      time: DEFAULT_LESSON_TIMES[2],
      subjectName: "Програмування та веб-розробка",
      teacher: "Викладач дисципліни",
      platform: "Meet",
      url: "",
      hasRealLink: false,
    };
  }

  // 3. Homework demo lesson
  const hwLesson =
    allLessons.find(
      (l) =>
        !l.is_cancelled &&
        l.subject_name !== subgroupDemo.subjectName &&
        l.subject_name !== onlineDemo.subjectName
    ) || allLessons[0];

  const homeworkDemo = hwLesson
    ? {
        lessonNumber: hwLesson.lesson_number || 3,
        time: hwLesson.time || DEFAULT_LESSON_TIMES[3],
        subjectName: hwLesson.subject_name,
        room: safeFormatRoom(hwLesson.room, "ауд. 101"),
      }
    : {
        lessonNumber: 3,
        time: DEFAULT_LESSON_TIMES[3],
        subjectName: uniqueSubjects[2] || "Бази даних та SQL",
        room: "ауд. 101",
      };

  return {
    subgroupLesson: subgroupDemo,
    onlineLesson: onlineDemo,
    homeworkLesson: homeworkDemo,
  };
}

export function GuideHubModal({ groupId, onClose }: GuideHubModalProps) {
  const { settings, updateSetting } = useUserSettings();
  const { isLinked } = useClassroomSubmissions();

  const effectiveGroupId =
    groupId ??
    (typeof window !== "undefined"
      ? Number(localStorage.getItem("schedule:groupId")) ||
        Number(localStorage.getItem("schedule:classroom_linked_group_id")) ||
        null
      : null);

  const [weekSchedule, setWeekSchedule] = useState<ScheduleResponse[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<number | null>(effectiveGroupId);

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<CategoryId>("all");

  // Demos internal state
  const [demoSubgroup, setDemoSubgroup] = useState<1 | 2 | null>(
    settings.defaultSubgroup === 1 || settings.defaultSubgroup === 2
      ? settings.defaultSubgroup
      : null
  );
  const [demoLinked, setDemoLinked] = useState(isLinked);
  const [demoToast, setDemoToast] = useState("");
  const [demoHwOpen, setDemoHwOpen] = useState(false);
  const [demoShortenedTime, setDemoShortenedTime] = useState(false);

  // PWA detection
  const [pwaPrompt, setPwaPrompt] = useState<any>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [pwaFeedback, setPwaFeedback] = useState("");

  // Load schedule for demo
  useEffect(() => {
    let isMounted = true;
    if (activeGroupId) {
      api.week(activeGroupId)
        .then((data) => {
          if (isMounted && Array.isArray(data) && data.length > 0) {
            setWeekSchedule(data);
          }
        })
        .catch(() => {});
    } else {
      api.directory.groups().then((grps) => {
        if (isMounted && grps && grps.length > 0) {
          api.week(grps[0].id).then((data) => {
            if (isMounted && Array.isArray(data)) setWeekSchedule(data);
          }).catch(() => {});
        }
      }).catch(() => {});
    }

    return () => {
      isMounted = false;
    };
  }, [activeGroupId]);

  // PWA setup
  useEffect(() => {
    if (typeof window === "undefined") return;

    const standalone =
      ("standalone" in window.navigator && (window.navigator as any).standalone === true) ||
      window.matchMedia("(display-mode: standalone)").matches;
    setIsStandalone(standalone);

    setIsIos(/iphone|ipad|ipod/i.test(navigator.userAgent || ""));
    setIsDesktop(window.innerWidth >= 768);

    if ((window as any).__pwaInstallEvent) {
      setPwaPrompt((window as any).__pwaInstallEvent);
    }

    const onInstallReady = (e: any) => setPwaPrompt(e.detail || (window as any).__pwaInstallEvent);
    const onBeforeInstall = (e: any) => {
      e.preventDefault();
      (window as any).__pwaInstallEvent = e;
      setPwaPrompt(e);
    };
    const onAppInstalled = () => {
      setIsStandalone(true);
      setPwaPrompt(null);
      setPwaFeedback("✅ Додаток успішно встановлено на пристрій!");
    };

    window.addEventListener("pwa-install-ready", onInstallReady);
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onAppInstalled);

    return () => {
      window.removeEventListener("pwa-install-ready", onInstallReady);
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  // Keyboard close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const demoData = useMemo(() => extractDemoData(weekSchedule), [weekSchedule]);

  const handleInstallClick = async () => {
    const promptToUse = pwaPrompt || (typeof window !== "undefined" ? (window as any).__pwaInstallEvent : null);
    if (promptToUse && typeof promptToUse.prompt === "function") {
      try {
        await promptToUse.prompt();
        const choice = await promptToUse.userChoice;
        if (choice?.outcome === "accepted") {
          setIsStandalone(true);
          setPwaPrompt(null);
          setPwaFeedback("✅ Застосунок успішно додано на ваш екран!");
        } else {
          setPwaFeedback("Встановлення відкладено.");
        }
      } catch (err) {
        console.error("Install prompt error:", err);
      }
    } else if (isStandalone) {
      setPwaFeedback("✅ Застосунок уже встановлено!");
    } else if (isIos) {
      setPwaFeedback("Натисніть «Поділитися» ⎋ у Safari, потім — «На початковий екран» ⊞.");
    } else if (isDesktop) {
      setPwaFeedback("Натисніть на значок ⊕ в адресному рядку браузера (Chrome / Edge).");
    } else {
      setPwaFeedback("Відкрийте меню браузера (⋮) → «Встановити додаток».");
    }
  };

  // Categories list
  const categories: { id: CategoryId; label: string; icon: string }[] = [
    { id: "all", label: "Усі можливості", icon: "✨" },
    { id: "schedule", label: "Розклад і час", icon: "⏱️" },
    { id: "classroom", label: "Classroom і ДЗ", icon: "📋" },
    { id: "online", label: "Відеодзвінки", icon: "💻" },
    { id: "export", label: "Поділитися", icon: "📸" },
    { id: "navigation", label: "Свайпи та дні", icon: "📱" },
    { id: "pwa", label: "Офлайн та PWA", icon: "📲" },
    { id: "advanced", label: "Викладачі та графік", icon: "🎓" },
  ];

  // Cards definitions
  const guideCards = [
    {
      id: "live_lesson",
      category: "schedule",
      badge: "Real-time",
      title: "«Жива» пара та статус уроку",
      desc: "Розклад автоматично визначає поточне заняття за київським часом. Картка підсвічується акцентним кольором, показує таймер «● ще N хв» та плавний прогрес-бар.",
      keywords: ["жива пара", "прогрес", "ще хв", "зараз", "час", "таймер"],
      content: (
        <div className="rounded-2xl border border-sys-accent/60 bg-gradient-to-r from-sys-accent/15 via-sys-card to-sys-card p-4 space-y-2 shadow-[0_0_20px_rgba(56,189,248,0.12)]">
          <div className="flex items-center justify-between text-xs">
            <span className="font-black text-sys-accent">
              1 пара · {demoShortenedTime ? "09:00–09:50" : "09:00–10:20"}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-sys-accent/20 border border-sys-accent/40 px-2.5 py-0.5 text-xs font-bold text-sys-accent">
              <span className="h-2 w-2 rounded-full bg-sys-accent animate-pulse" />
              ще 25 хв
            </span>
          </div>
          <div className="font-bold text-sm sm:text-base text-sys-text-primary">
            {demoData.subgroupLesson.subjectName}
          </div>
          <div className="text-xs text-sys-text-secondary">
            {demoData.subgroupLesson.teacher1Name} · {demoData.subgroupLesson.teacher1Room}
          </div>
          <div className="h-1.5 w-full rounded-full bg-sys-accent/20 overflow-hidden mt-1">
            <div className="h-full bg-sys-accent rounded-full w-3/5" />
          </div>
        </div>
      ),
    },
    {
      id: "bells_shortened",
      category: "schedule",
      badge: "Дзвінки",
      title: "Розклад дзвінків та скорочені дні (⏱ 50 хв)",
      desc: "Стандартний розклад містить 4 основні пари по 80 хвилин. У дні скороченого розкладу з'являється бейдж «⏱ 50 хв», а пари тривають по 50 хв із перервами по 10 хв.",
      keywords: ["дзвінки", "скорочені дні", "50 хв", "перерва", "пари", "годинник"],
      content: (
        <div className="space-y-3">
          <div className="flex items-center justify-between pb-1">
            <span className="text-xs font-bold text-sys-text-secondary">Режим дзвінків:</span>
            <div className="inline-flex rounded-xl border border-sys-border bg-sys-bg p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setDemoShortenedTime(false)}
                className={`px-2.5 py-1 rounded-lg font-bold transition-all ${
                  !demoShortenedTime ? "bg-sys-accent text-slate-900 shadow-xs" : "text-sys-text-secondary"
                }`}
              >
                Звичайний (80 хв)
              </button>
              <button
                type="button"
                onClick={() => setDemoShortenedTime(true)}
                className={`px-2.5 py-1 rounded-lg font-bold transition-all ${
                  demoShortenedTime ? "bg-blue-500 text-white shadow-xs" : "text-sys-text-secondary"
                }`}
              >
                ⏱ Скорочений (50 хв)
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            {[1, 2, 3, 4].map((num) => {
              const timeStr = demoShortenedTime
                ? SHORTENED_LESSON_TIMES[num]
                : DEFAULT_LESSON_TIMES[num];
              return (
                <div key={num} className="rounded-xl border border-sys-border bg-sys-bg p-2 text-center">
                  <div className="text-[10px] font-bold text-sys-accent uppercase">{num} пара</div>
                  <div className="font-semibold text-sys-text-primary mt-0.5">{timeStr}</div>
                </div>
              );
            })}
          </div>
        </div>
      ),
    },
    {
      id: "subgroups_filtering",
      category: "schedule",
      badge: "Підгрупи",
      title: "Миттєва фільтрація підгруп прямо на картці",
      desc: "Якщо пара ділиться на підгрупи, вам не потрібно дивитися чужого викладача. Натисніть кнопку «1 підгр.» чи «2 підгр.» прямо на картці заняття — чужа аудиторія та посилання сховаються.",
      keywords: ["підгрупа", "підгрупи", "викладач", "поділ", "фільтр"],
      content: (
        <div className="rounded-2xl border border-sys-border bg-sys-bg p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col items-center pr-3 border-r border-sys-border/50 shrink-0">
              <span className="text-xl font-black text-sys-text-primary">1</span>
              <span className="text-[11px] font-bold text-sys-text-secondary">09:00</span>
            </div>
            <div className="flex-1 min-w-0 space-y-2">
              <div className="font-bold text-sm text-sys-text-primary leading-tight">
                {demoData.subgroupLesson.subjectName}
              </div>
              <div className="flex flex-col gap-2 pt-0.5">
                {(demoSubgroup === null || demoSubgroup === 1) && (
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setDemoSubgroup(demoSubgroup === 1 ? null : 1)}
                      className={`rounded px-1.5 py-0.5 text-xs font-bold border transition-colors ${
                        demoSubgroup === 1
                          ? "bg-sky-500/20 text-sky-400 border-sky-500/40"
                          : "bg-sys-card border-sys-border text-slate-400"
                      }`}
                    >
                      1 підгр.
                    </button>
                    <span className="text-xs font-medium text-sys-text-secondary truncate flex-1 pl-1">
                      {demoData.subgroupLesson.teacher1Name}
                    </span>
                    <span className="rounded-md border border-sys-border bg-sys-card px-2 py-0.5 text-xs font-semibold text-sys-text-secondary">
                      {demoData.subgroupLesson.teacher1Room}
                    </span>
                  </div>
                )}
                {(demoSubgroup === null || demoSubgroup === 2) && (
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setDemoSubgroup(demoSubgroup === 2 ? null : 2)}
                      className={`rounded px-1.5 py-0.5 text-xs font-bold border transition-colors ${
                        demoSubgroup === 2
                          ? "bg-indigo-500/20 text-indigo-400 border-indigo-500/40"
                          : "bg-sys-card border-sys-border text-slate-400"
                      }`}
                    >
                      2 підгр.
                    </button>
                    <span className="text-xs font-medium text-sys-text-secondary truncate flex-1 pl-1">
                      {demoData.subgroupLesson.teacher2Name}
                    </span>
                    <span className="rounded-md border border-sys-border bg-sys-card px-2 py-0.5 text-xs font-semibold text-sys-text-secondary">
                      {demoData.subgroupLesson.teacher2Room}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="text-[11px] text-center text-sys-text-muted">
            {demoSubgroup !== null ? (
              <button
                type="button"
                onClick={() => setDemoSubgroup(null)}
                className="text-sys-accent underline hover:opacity-80"
              >
                Скинути фільтр та показати обидві підгрупи
              </button>
            ) : (
              "👆 Натисніть на «1 підгр.» чи «2 підгр.», щоб приховати чужого викладача"
            )}
          </div>
        </div>
      ),
    },
    {
      id: "online_meet_zoom",
      category: "online",
      badge: "Онлайн",
      title: "Пряме підключення до Meet / Zoom та захист посилань",
      desc: "Для онлайн-занять картка показує кнопку відеодзвінка (Meet ↗ чи Zoom ↗). Посилання надійно захищені позначкою [🔒 Онлайн] від сторонніх гостей — вони автоматично розблоковані для авторизованих студентів вашої групи.",
      keywords: ["meet", "zoom", "відео", "онлайн", "посилання", "захист", "дзвінок", "teams"],
      content: (
        <div className="rounded-2xl border border-sys-border bg-sys-bg p-4 space-y-3">
          <div className="flex items-center justify-between pb-1 border-b border-sys-border/50">
            <span className="text-xs font-bold text-sys-text-secondary">Статус доступу:</span>
            <button
              type="button"
              onClick={() => {
                setDemoLinked((prev) => !prev);
                setDemoToast("");
              }}
              className={`rounded-xl px-2.5 py-1 text-xs font-bold border transition-all ${
                demoLinked
                  ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/40"
                  : "bg-sys-card text-sys-text-muted border-sys-border"
              }`}
            >
              {demoLinked ? "✓ Студент цієї групи" : "🔒 Сторонній гість"}
            </button>
          </div>

          <div className="rounded-xl border border-sys-border bg-sys-card p-3 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-sys-text-secondary">
                2 пара · {demoData.onlineLesson.time}
              </span>
              {demoLinked ? (
                <button
                  type="button"
                  onClick={() =>
                    setDemoToast(
                      `Посилання на ${demoData.onlineLesson.platform} готове для відкриття у новій вкладці!`
                    )
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/40 px-2.5 py-1 text-xs font-bold text-emerald-400 hover:bg-emerald-500/25 active:scale-95 transition-all shadow-xs"
                >
                  {demoData.onlineLesson.platform} ↗
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() =>
                    setDemoToast(
                      "Для захисту навчального процесу посилання закрите. Підключіть студентську пошту в Налаштуваннях."
                    )
                  }
                  className="inline-flex items-center gap-1 rounded-lg bg-sys-bg border border-sys-border px-2.5 py-1 text-xs font-bold text-sys-text-muted hover:border-sys-accent/40 active:scale-95 transition-all"
                >
                  🔒 {demoData.onlineLesson.platform}
                </button>
              )}
            </div>
            <div className="font-bold text-sm text-sys-text-primary">
              {demoData.onlineLesson.subjectName}
            </div>
            <div className="text-xs text-sys-text-secondary">{demoData.onlineLesson.teacher}</div>
            {demoToast && (
              <div className="rounded-lg border border-sys-border bg-sys-bg p-2 text-xs text-sys-text-primary font-medium animate-in fade-in">
                {demoToast}
              </div>
            )}
          </div>
        </div>
      ),
    },
    {
      id: "classroom_tasks",
      category: "classroom",
      badge: "Google Classroom",
      title: "Завдання, дедлайни та перевірка оцінок",
      desc: "Усі домашні завдання автоматично підтягуються з Google Classroom. Без підключеної пошти ви бачите спільні дедлайни групи у нейтральних тонах. Підключивши свою пошту, ви отримуєте персональний трекінг: статус «Здано» та оцінку викладача.",
      keywords: ["classroom", "дз", "завдання", "оцінки", "дедлайн", "робота"],
      content: (
        <div className="rounded-2xl border border-sys-border bg-sys-bg p-4 space-y-2.5">
          <div className="flex items-center justify-between pb-1">
            <span className="text-xs font-bold text-sys-text-secondary">Картка пари з ДЗ:</span>
            <span className="text-[11px] text-emerald-400 font-bold">Оцінки активні</span>
          </div>

          <div className="rounded-xl border border-sys-border bg-sys-card p-3 space-y-2">
            <div className="flex items-center justify-between text-xs font-bold text-sys-text-secondary">
              <span>3 пара · {demoData.homeworkLesson.time}</span>
              <span className="text-sys-text-muted font-normal">{demoData.homeworkLesson.room}</span>
            </div>
            <div className="font-bold text-sm text-sys-text-primary">
              {demoData.homeworkLesson.subjectName}
            </div>

            {/* Accordion task */}
            <button
              type="button"
              onClick={() => setDemoHwOpen((prev) => !prev)}
              className="w-full flex items-center justify-between rounded-xl border border-purple-500/30 bg-purple-500/10 px-3 py-2 text-xs font-bold text-purple-400 hover:bg-purple-500/15 transition-colors"
            >
              <span>1 завдання · До п'ятниці</span>
              <span>{demoHwOpen ? "▴" : "▾"}</span>
            </button>
            {demoHwOpen && (
              <div className="rounded-xl border border-sys-border bg-sys-bg p-2.5 space-y-2 text-xs animate-in fade-in">
                <div className="flex justify-between items-center py-0.5">
                  <span className="text-sys-text-secondary font-medium">Лабораторна робота №2</span>
                  <span className="text-amber-400 font-bold">до 23:59 ↗</span>
                </div>
                <div className="flex justify-between items-center py-0.5 border-t border-sys-border/40 pt-1.5">
                  <span className="text-sys-text-secondary font-medium">Практична робота №1</span>
                  <span className="text-emerald-400 font-bold">Оцінка: 12/12 ✓</span>
                </div>
              </div>
            )}
          </div>
        </div>
      ),
    },
    {
      id: "share_image",
      category: "export",
      badge: "Шеринг",
      title: "Генерація красивого фото розкладу та копіювання",
      desc: "Більше не потрібно робити неохайні скріншоти екрана! Натисніть кнопку «Поділитися» у шапці розкладу дня — застосунок згенерує стильне фірмове зображення з усіма парами дня, кабінетами та викладачами для відправки в Telegram, Viber чи збереження в галерею.",
      keywords: ["поділитися", "фото", "картинка", "копіювати", "скріншот", "експорт", "telegram", "зберегти"],
      content: (
        <div className="rounded-2xl border border-sys-border bg-sys-bg p-4 space-y-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-sys-accent/15 flex items-center justify-center text-xl shrink-0">
              📸
            </div>
            <div>
              <div className="font-bold text-xs sm:text-sm text-sys-text-primary">
                Дві кнопки для швидкого обміну:
              </div>
              <div className="text-[11px] text-sys-text-secondary">
                Доступні в меню дня та у верхній панелі
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-xl border border-sys-border bg-sys-card p-3 space-y-1">
              <div className="font-bold text-sys-text-primary flex items-center gap-1.5">
                <span>🖼️</span>
                <span>Зображення дня</span>
              </div>
              <p className="text-[11px] text-sys-text-secondary">
                Створює PNG-картку розкладу у стилі коледжу в один клік.
              </p>
            </div>
            <div className="rounded-xl border border-sys-border bg-sys-card p-3 space-y-1">
              <div className="font-bold text-sys-text-primary flex items-center gap-1.5">
                <span>📋</span>
                <span>Скопіювати текст</span>
              </div>
              <p className="text-[11px] text-sys-text-secondary">
                Копіює розклад текстом зі слотами, предметами та кабінетами.
              </p>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: "weeks_and_modes",
      category: "schedule",
      badge: "Семестр",
      title: "Чисельник / Знаменник та формат навчання (Очно / Онлайн)",
      desc: "У заголовку розкладу завжди видно номер тижня та його тип («1-й тиждень · Чисельник»). Бейдж формату навчання («Очне навчання» або «Дистанційне навчання») автоматично враховує курс вашої групи та рішення адміністрації.",
      keywords: ["чисельник", "знаменник", "очно", "дистанційно", "тиждень", "курс", "формат"],
      content: (
        <div className="rounded-2xl border border-sys-border bg-sys-bg p-4 space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-sys-border bg-sys-card px-3 py-1 text-xs font-bold text-sys-text-primary">
              <span className="h-2 w-2 rounded-full bg-sys-accent" />
              1-й тиждень · Чисельник
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-400">
              🏫 Очне навчання
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-500/40 bg-blue-500/10 px-3 py-1 text-xs font-bold text-blue-400">
              💻 Дистанційне навчання
            </span>
          </div>
          <p className="text-xs text-sys-text-secondary leading-relaxed">
            Перемикайте тижні стрілками ‹ та ›, щоб заздалегідь переглянути розклад чи дедлайни на наступний тиждень.
          </p>
        </div>
      ),
    },
    {
      id: "gestures_and_grid",
      category: "navigation",
      badge: "Мобільний + ПК",
      title: "Свайпи на смартфоні та тижнева сітка на ПК",
      desc: "На смартфоні перемикайте дні природними свайпами вліво чи вправо або натискайте на плашки днів (Пн–Пт). На комп'ютері ви можете перемикатися між повним оглядом усього тижня та зручним денним переглядом.",
      keywords: ["свайп", "жести", "сітка", "тиждень", "пк", "телефон", "гортати", "дні"],
      content: (
        <div className="rounded-2xl border border-sys-border bg-sys-bg p-4 space-y-3">
          <div className="grid grid-cols-5 gap-1 text-center text-xs">
            {["Пн", "Вт", "Ср", "Чт", "Пт"].map((d, idx) => (
              <div
                key={d}
                className={`py-2 rounded-xl border font-bold ${
                  idx === 0
                    ? "bg-sys-accent text-slate-900 border-sys-accent shadow-xs"
                    : "bg-sys-card border-sys-border text-sys-text-secondary"
                }`}
              >
                {d}
              </div>
            ))}
          </div>
          <div className="text-xs text-sys-text-secondary flex items-center justify-between pt-1">
            <span>👈 Гортайте свайпами вліво/вправо</span>
            <span className="font-semibold text-sys-accent">📌 Закріплюйте свою групу</span>
          </div>
        </div>
      ),
    },
    {
      id: "offline_pwa",
      category: "pwa",
      badge: "PWA та Офлайн",
      title: "Автономна робота без інтернету та встановлення PWA",
      desc: "Застосунок створено за технологією PWA. Усі завантажені розклади автоматично зберігаються в пам'яті вашого телефона чи комп'ютера — розклад відкриється в укритті, метро або під час відключень світла без доступу до мережі.",
      keywords: ["офлайн", "pwa", "встановити", "інтернет", "укриття", "блекаут", "додаток"],
      content: (
        <div className="rounded-2xl border border-sys-border bg-sys-bg p-4 space-y-3">
          <div className="rounded-xl border border-sys-border bg-sys-card p-3 space-y-1 text-xs text-sys-text-secondary">
            <div className="font-bold text-sys-text-primary text-xs sm:text-sm">
              {isStandalone
                ? "✓ Додаток успішно встановлено"
                : isIos
                ? "🍎 Встановлення на iPhone / iPad"
                : isDesktop
                ? "💻 Встановлення на ПК (Chrome / Edge)"
                : "🤖 Встановлення на Android"}
            </div>
            <p>
              {isStandalone
                ? "Ви вже використовуєте розклад як повноцінний автономний застосунок."
                : isIos
                ? "Натисніть «Поділитися» ⎋ у нижній панелі Safari, а потім — «На початковий екран» ⊞."
                : isDesktop
                ? "Натисніть кнопку нижче або іконку встановлення в адресному рядку браузера."
                : "Натисніть кнопку нижче або скористайтеся меню браузера (⋮) → «Встановити додаток»."}
            </p>
          </div>

          {!isStandalone && (
            <button
              type="button"
              onClick={handleInstallClick}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-sys-accent px-4 py-2.5 text-xs sm:text-sm font-bold text-slate-900 hover:opacity-95 active:scale-95 transition-all shadow-md"
            >
              <span>📲 Встановити додаток на екран</span>
            </button>
          )}

          {pwaFeedback && (
            <div className="rounded-xl border border-sys-border bg-sys-card p-2 text-xs text-sys-text-primary text-center font-medium animate-in fade-in">
              {pwaFeedback}
            </div>
          )}
        </div>
      ),
    },
    {
      id: "teachers_and_graph",
      category: "advanced",
      badge: "Корисні сервіси",
      title: "Розклад викладачів, графік семестру та статистика",
      desc: "Шукаєте викладача для консультації чи складання хвостів? У пошуку групи можна перемкнутися на «Викладач» та переглянути розклад будь-якого колеги. Також доступні сторінки аналітики навантаження та офіційний графік навчального процесу.",
      keywords: ["викладач", "статистика", "графік", "сесія", "канікули", "семестр", "pin", "пін"],
      content: (
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-xl border border-sys-border bg-sys-bg p-3 space-y-1">
            <div className="font-bold text-sys-text-primary flex items-center gap-1.5">
              <span>📊</span>
              <span>Статистика</span>
            </div>
            <p className="text-[11px] text-sys-text-secondary">
              Підрахунок пар, навантаження та предметів за семестр у розділі <em>/statistics</em>.
            </p>
          </div>
          <div className="rounded-xl border border-sys-border bg-sys-bg p-3 space-y-1">
            <div className="font-bold text-sys-text-primary flex items-center gap-1.5">
              <span>📅</span>
              <span>Графік процесу</span>
            </div>
            <p className="text-[11px] text-sys-text-secondary">
              Календар сесій, практики та канікул у розділі <em>/educational-process</em>.
            </p>
          </div>
        </div>
      ),
    },
  ];

  // Filtering cards by category & search query
  const filteredCards = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return guideCards.filter((card) => {
      const matchesCategory = activeCategory === "all" || card.category === activeCategory;
      if (!matchesCategory) return false;
      if (!query) return true;

      const inTitle = card.title.toLowerCase().includes(query);
      const inDesc = card.desc.toLowerCase().includes(query);
      const inKeywords = card.keywords.some((k) => k.toLowerCase().includes(query));
      return inTitle || inDesc || inKeywords;
    });
  }, [guideCards, activeCategory, searchQuery]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-2 sm:p-5 backdrop-blur-md overflow-hidden animate-in fade-in duration-150">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="guide-hub-title"
        className="relative flex flex-col w-full max-w-4xl h-[94dvh] sm:h-[85dvh] max-h-[820px] rounded-3xl border border-sys-border bg-sys-card text-sys-text-primary shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <header className="border-b border-sys-border/50 px-4 sm:px-6 py-3.5 bg-sys-card shrink-0 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-xl bg-sys-accent/15 text-lg shadow-xs">
                💡
              </span>
              <div>
                <h2 id="guide-hub-title" className="text-sm sm:text-base font-bold leading-tight text-sys-text-primary">
                  Гід та довідник можливостей
                </h2>
                <p className="text-[11px] text-sys-text-secondary">
                  Дізнайтеся про всі корисні фішки розкладу ДФКР
                </p>
              </div>
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

          {/* Search Bar */}
          <div className="relative">
            <input
              type="search"
              placeholder="Пошук фіч (наприклад: дз, офлайн, зустріч, картинка, дзвінки)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-9 pl-9 pr-8 rounded-xl border border-sys-border bg-sys-bg text-xs text-sys-text-primary placeholder:text-sys-text-muted focus:outline-hidden focus:border-sys-accent focus:ring-1 focus:ring-sys-accent/30 transition-all"
            />
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sys-text-muted text-xs">
              🔍
            </span>
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-sys-text-muted hover:text-sys-text-primary"
              >
                ✕
              </button>
            )}
          </div>

          {/* Category Filter Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto overscroll-x-contain no-scrollbar pt-0.5">
            {categories.map((cat) => {
              const isActive = activeCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setActiveCategory(cat.id)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors duration-fast ease-smooth ${
                    isActive
                      ? "bg-sys-accent text-slate-900 shadow-xs font-bold"
                      : "bg-sys-bg border border-sys-border text-sys-text-secondary hover:text-sys-text-primary hover:border-sys-accent/40"
                  }`}
                >
                  <span aria-hidden="true">{cat.icon}</span>
                  <span>{cat.label}</span>
                </button>
              );
            })}
          </div>
        </header>

        {/* Scrollable Cards Grid Area */}
        <main className="flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6 custom-scrollbar space-y-4">
          {filteredCards.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredCards.map((card) => (
                <article
                  key={card.id}
                  className="flex flex-col justify-between rounded-2xl border border-sys-border/80 bg-sys-card p-4 sm:p-5 shadow-sm hover:border-sys-accent/40 transition-all duration-200"
                >
                  <div className="space-y-2 mb-3">
                    <div className="flex items-center justify-between">
                      <span className="rounded-full bg-sys-accent/15 text-sys-accent px-2 py-0.5 text-[10px] font-bold">
                        {card.badge}
                      </span>
                    </div>
                    <h3 className="font-bold text-sm sm:text-base text-sys-text-primary leading-snug">
                      {card.title}
                    </h3>
                    <p className="text-xs text-sys-text-secondary leading-relaxed">
                      {card.desc}
                    </p>
                  </div>

                  <div className="pt-2">{card.content}</div>
                </article>
              ))}
            </div>
          ) : (
            <div className="py-16 text-center space-y-2">
              <div className="text-3xl">🔍</div>
              <div className="font-bold text-sm text-sys-text-primary">Нічого не знайдено</div>
              <p className="text-xs text-sys-text-secondary max-w-sm mx-auto">
                За запитом «{searchQuery}» підказок не знайдено. Спробуйте інше ключове слово або скиньте фільтр.
              </p>
              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  setActiveCategory("all");
                }}
                className="mt-2 inline-flex items-center justify-center rounded-xl bg-sys-accent px-3 py-1.5 text-xs font-bold text-slate-900 shadow-xs hover:opacity-90"
              >
                Показати всі можливості
              </button>
            </div>
          )}
        </main>

        {/* Footer */}
        <footer className="flex items-center justify-between border-t border-sys-border/50 px-4 sm:px-6 py-3 bg-sys-card shrink-0 text-xs">
          <span className="text-sys-text-secondary hidden sm:inline">
            💡 Підказка: ви завжди можете знайти цей довідник у Налаштуваннях
          </span>
          <button
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto rounded-xl bg-sys-accent px-5 py-2 text-xs sm:text-sm font-bold text-slate-900 hover:opacity-95 active:scale-95 transition-all shadow-md ml-auto"
          >
            Зрозуміло ✓
          </button>
        </footer>
      </div>
    </div>
  );
}
