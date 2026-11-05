"use client";

import { useEffect, useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useUserSettings } from "../lib/useUserSettings";
import { useTheme, ACCENT_OPTIONS, AccentColor } from "../lib/useTheme";
import { useClassroomSubmissions } from "../lib/useClassroomSubmissions";
import { requestClassroomAuth } from "../lib/classroomAuth";
import { api, Lesson, ScheduleResponse } from "../lib/api";
import { extractOnlineMeetings, formatRoom, MeetingInfo, checkScheduleHasSubgroups } from "../lib/format";
import { parseLessonTeachers } from "../lib/quickJump";

export interface StudentGuideModalProps {
  isOnboarding?: boolean;
  groupId?: number | null;
  onClose: () => void;
  onComplete?: (finalGroupId?: number | null) => void;
}

interface StepItem {
  id: string;
  shortTitle: string;
  icon: string;
  fullTitle: string;
  subtitle: string;
}

const ONBOARDING_STEPS: StepItem[] = [
  {
    id: "subgroups",
    shortTitle: "Підгрупа",
    icon: "👥",
    fullTitle: "Обери свою підгрупу",
    subtitle: "Якщо предмет ділиться на підгрупи, розклад показуватиме твого викладача.",
  },
  {
    id: "appearance",
    shortTitle: "Оформлення",
    icon: "🎨",
    fullTitle: "Тема та улюблений колір",
    subtitle: "Обирай світлу або темну тему та свій улюблений кольоровий акцент.",
  },
  {
    id: "schedule",
    shortTitle: "Дзвінки та пари",
    icon: "⏱️",
    fullTitle: "Розклад дзвінків та «жива» пара",
    subtitle: "Як влаштовані 4 пари та швидке підключення до відеоуроків.",
  },
  {
    id: "classroom",
    shortTitle: "Classroom",
    icon: "📋",
    fullTitle: "Google Classroom та оцінки",
    subtitle: "Синхронізація завдань, перегляд дедлайнів та особистих оцінок.",
  },
  {
    id: "install",
    shortTitle: "Додаток PWA",
    icon: "📲",
    fullTitle: "Встановлення на пристрій",
    subtitle: "Додай розклад на екран смартфона чи ПК для роботи без інтернету.",
  },
];

const GUIDE_STEPS: StepItem[] = [
  {
    id: "subgroups",
    shortTitle: "Група і підгрупи",
    icon: "👥",
    fullTitle: "Твоя група та підгрупи",
    subtitle: "Як налаштувати показ потрібних викладачів та перемикати групи.",
  },
  {
    id: "schedule",
    shortTitle: "Розклад і дзвінки",
    icon: "⏱️",
    fullTitle: "Дні тижня та «жива» пара",
    subtitle: "Розклад дзвінків, відстеження поточної пари та скорочені дні.",
  },
  {
    id: "online",
    shortTitle: "Онлайн-пари",
    icon: "💻",
    fullTitle: "Відеодзвінки та Meet / Zoom",
    subtitle: "Захищені посилання на онлайн-пари та перехід в один клік.",
  },
  {
    id: "homework",
    shortTitle: "Classroom і ДЗ",
    icon: "📋",
    fullTitle: "Домашні завдання та оцінки",
    subtitle: "Автоматична синхронізація дедлайнів, статус здачі та бали.",
  },
  {
    id: "appearance",
    shortTitle: "Теми і кольори",
    icon: "🎨",
    fullTitle: "Теми та колірні акценти",
    subtitle: "Зміна світлого/темного режиму та вибір однієї з 6 колірних тем.",
  },
  {
    id: "install",
    shortTitle: "Встановлення PWA",
    icon: "📲",
    fullTitle: "Додаток та робота офлайн",
    subtitle: "Як встановити розклад на смартфон чи ПК та переглядати пари офлайн.",
  },
];

interface ExtractedDemoData {
  subgroupLesson: {
    lessonNumber: number;
    time: string;
    subjectName: string;
    teacher1Name: string;
    teacher1Room: string;
    teacher2Name: string;
    teacher2Room: string;
  };
  scheduleDays: {
    day: "Пн" | "Вт" | "Ср" | "Чт" | "Пт";
    hasLessons: boolean;
    lessonNumber: number;
    time: string;
    subjectName: string;
    teacher: string;
    room: string;
  }[];
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

function extractDemoData(weekSchedule: ScheduleResponse[]): ExtractedDemoData {
  const allLessons: Lesson[] = [];
  weekSchedule.forEach((day) => {
    if (Array.isArray(day?.lessons)) {
      allLessons.push(...day.lessons);
    }
  });

  const uniqueSubjects = Array.from(
    new Set(allLessons.map((l) => l.subject_name?.trim()).filter(Boolean))
  );

  // 1. Subgroup Lesson: look for lesson with 2 teachers or split
  const dualLesson = allLessons.find(
    (l) =>
      !l.is_cancelled &&
      (l.second_teacher_id != null ||
        (l.teacher_name && (l.teacher_name.includes(",") || l.teacher_name.includes("/"))) ||
        (l.teacher_room && l.second_teacher_room))
  );

  let subgroupDemo: ExtractedDemoData["subgroupLesson"];
  if (dualLesson) {
    const parsedTeachers = parseLessonTeachers(dualLesson);
    const t1 = parsedTeachers[0]?.name || dualLesson.teacher_name?.split(/[,/]/)[0]?.trim() || "Токарєва О.В.";
    const t2 = parsedTeachers[1]?.name || dualLesson.teacher_name?.split(/[,/]/)[1]?.trim() || "Хочинська В.В.";
    subgroupDemo = {
      lessonNumber: dualLesson.lesson_number || 1,
      time: dualLesson.time || "09:00–10:20",
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
      time: firstLesson.time || "09:00–10:20",
      subjectName: firstLesson.subject_name,
      teacher1Name: firstLesson.teacher_name || "Токарєва О.В.",
      teacher1Room: safeFormatRoom(firstLesson.room, "ауд. 101"),
      teacher2Name: otherTeacherLesson?.teacher_name || "Хочинська В.В.",
      teacher2Room: "ауд. 102",
    };
  } else {
    subgroupDemo = {
      lessonNumber: 1,
      time: "09:00–10:20",
      subjectName: "Комп'ютерні мережі",
      teacher1Name: "Токарєва О.В.",
      teacher1Room: "ауд. 101",
      teacher2Name: "Хочинська В.В.",
      teacher2Room: "ауд. 102",
    };
  }

  // 2. Online Lesson: look for lesson with meeting link
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

  let onlineDemo: ExtractedDemoData["onlineLesson"];
  if (foundOnline) {
    const plat = foundOnline.meeting.platform;
    const platName: "Meet" | "Zoom" | "Teams" | "Онлайн" =
      plat === "zoom" ? "Zoom" : plat === "meet" ? "Meet" : plat === "teams" ? "Teams" : "Онлайн";
    onlineDemo = {
      lessonNumber: foundOnline.lesson.lesson_number || 2,
      time: foundOnline.lesson.time || "10:40–12:00",
      subjectName: foundOnline.lesson.subject_name,
      teacher: foundOnline.lesson.teacher_name || "Викладач",
      platform: platName,
      url: foundOnline.meeting.url,
      hasRealLink: true,
    };
  } else if (allLessons.length > 0) {
    // If no lesson has an online link, take a real lesson and attach a fixed Meet badge!
    const target = allLessons.find((l) => !l.is_cancelled && l.subject_name !== subgroupDemo.subjectName) || allLessons[0];
    onlineDemo = {
      lessonNumber: target.lesson_number || 2,
      time: target.time || "10:40–12:00",
      subjectName: `${target.subject_name} (Онлайн)`,
      teacher: target.teacher_name || "Хочинська В.В.",
      platform: "Meet",
      url: "",
      hasRealLink: false,
    };
  } else {
    onlineDemo = {
      lessonNumber: 2,
      time: "10:40–12:00",
      subjectName: "Комп'ютерна графіка (Онлайн)",
      teacher: "Хочинська В.В.",
      platform: "Meet",
      url: "",
      hasRealLink: false,
    };
  }

  // 3. Schedule Days ("Пн", "Вт", "Ср", "Чт", "Пт")
  const dayNames: ("Пн" | "Вт" | "Ср" | "Чт" | "Пт")[] = ["Пн", "Вт", "Ср", "Чт", "Пт"];
  const scheduleDays = dayNames.map((dayName, idx) => {
    const dayData = weekSchedule[idx];
    const dayLessons = (dayData?.lessons || []).filter((l) => !l.is_cancelled);
    if (dayLessons.length > 0) {
      const l = dayLessons[0];
      return {
        day: dayName,
        hasLessons: true,
        lessonNumber: l.lesson_number || (idx + 1),
        time: l.time || (idx === 3 ? "09:00–09:50" : "09:00–10:20"),
        subjectName: l.subject_name,
        teacher: l.teacher_name || "Викладач",
        room: safeFormatRoom(l.room, `ауд. ${100 + (idx + 1) * 10}`),
      };
    }
    if (idx === 4) {
      return {
        day: dayName,
        hasLessons: false,
        lessonNumber: 1,
        time: "09:00–10:20",
        subjectName: "",
        teacher: "",
        room: "",
      };
    }
    const fallbackSubj =
      uniqueSubjects[idx] ||
      (idx === 0
        ? "Програмування та алгоритми"
        : idx === 1
        ? "Бази даних та SQL"
        : idx === 2
        ? "Вища математика"
        : "Комп'ютерні системи");
    return {
      day: dayName,
      hasLessons: true,
      lessonNumber: 1,
      time: idx === 3 ? "09:00–09:50" : "09:00–10:20",
      subjectName: fallbackSubj,
      teacher:
        idx === 0
          ? "Іванов І.І."
          : idx === 1
          ? "Петренко П.П."
          : idx === 2
          ? "Сидоренко С.С."
          : "Ковальчук К.К.",
      room: safeFormatRoom(idx === 0 ? "201" : idx === 1 ? "305" : idx === 2 ? "104" : "101", "ауд. 101"),
    };
  });

  // 4. Homework demo lesson: pick a real subject from schedule
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
        time: hwLesson.time || "12:30–13:50",
        subjectName: hwLesson.subject_name,
        room: safeFormatRoom(hwLesson.room, "ауд. 101"),
      }
    : {
        lessonNumber: 3,
        time: "12:30–13:50",
        subjectName: uniqueSubjects[2] || "Операційні системи",
        room: "ауд. 101",
      };

  return {
    subgroupLesson: subgroupDemo,
    scheduleDays,
    onlineLesson: onlineDemo,
    homeworkLesson: homeworkDemo,
  };
}

export function StudentGuideModal({ isOnboarding = false, groupId, onClose, onComplete }: StudentGuideModalProps) {
  const { settings, updateSetting } = useUserSettings();
  const { theme, resolvedTheme, setTheme, accent, setAccent } = useTheme();
  const { isLinked, linkedEmail } = useClassroomSubmissions();

  const effectiveGroupId =
    groupId ??
    (typeof window !== "undefined"
      ? Number(localStorage.getItem("schedule:groupId")) ||
        Number(localStorage.getItem("schedule:classroom_linked_group_id")) ||
        null
      : null);

  const [activeGroupId, setActiveGroupId] = useState<number | null>(effectiveGroupId);
  const [groupSwitchInfo, setGroupSwitchInfo] = useState<string | null>(null);

  useEffect(() => {
    if (groupId) setActiveGroupId(groupId);
  }, [groupId]);

  const [weekSchedule, setWeekSchedule] = useState<ScheduleResponse[]>(() => {
    if (typeof window === "undefined" || !effectiveGroupId) return [];
    try {
      const targetPrefix = `schedule:week:groupId:${effectiveGroupId}:`;
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k && k.startsWith(targetPrefix)) {
          const raw = window.localStorage.getItem(k);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length > 0) return parsed;
          }
        }
      }
      const todayRaw = window.localStorage.getItem(`schedule:today:groupId:${effectiveGroupId}`);
      if (todayRaw) {
        const parsedToday = JSON.parse(todayRaw);
        if (parsedToday && parsedToday.lessons) return [parsedToday];
      }
    } catch {}
    return [];
  });

  useEffect(() => {
    let isCancelled = false;
    if (activeGroupId) {
      api.week(activeGroupId)
        .then((data) => {
          if (!isCancelled && Array.isArray(data) && data.length > 0) {
            setWeekSchedule(data);
          }
        })
        .catch(() => {});
    } else {
      api.directory.groups().then((grps) => {
        if (!isCancelled && grps && grps.length > 0) {
          api.week(grps[0].id).then((data) => {
            if (!isCancelled && Array.isArray(data) && data.length > 0) {
              setWeekSchedule(data);
            }
          }).catch(() => {});
        }
      }).catch(() => {});
    }

    return () => {
      isCancelled = true;
    };
  }, [activeGroupId]);

  const demoData = useMemo(() => {
    return extractDemoData(weekSchedule);
  }, [weekSchedule]);

  const groupHasSubgroups = useMemo(() => {
    if (weekSchedule && weekSchedule.length > 0) {
      const allLessons = weekSchedule.flatMap((day) => day.lessons || []);
      const has = checkScheduleHasSubgroups(allLessons);
      if (typeof window !== "undefined" && activeGroupId) {
        try {
          localStorage.setItem(`schedule:has_subgroups:${activeGroupId}`, has ? "1" : "0");
        } catch {}
      }
      return has;
    }
    if (typeof window !== "undefined" && activeGroupId) {
      const cached = localStorage.getItem(`schedule:has_subgroups:${activeGroupId}`);
      if (cached !== null) return cached === "1";
      const targetPrefix = `schedule:week:groupId:${activeGroupId}:`;
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k && k.startsWith(targetPrefix)) {
          const raw = window.localStorage.getItem(k);
          if (raw) {
            try {
              const parsed = JSON.parse(raw);
              if (Array.isArray(parsed) && parsed.length > 0) {
                const lessons = parsed.flatMap((d: any) => d.lessons || []);
                if (lessons.length > 0) return checkScheduleHasSubgroups(lessons);
              }
            } catch {}
          }
        }
      }
    }
    return false;
  }, [weekSchedule, activeGroupId]);

  const baseSteps = isOnboarding ? ONBOARDING_STEPS : GUIDE_STEPS;
  const steps = useMemo(() => {
    return baseSteps.filter((s) => groupHasSubgroups || s.id !== "subgroups");
  }, [baseSteps, groupHasSubgroups]);
  const totalSteps = steps.length;
  const [activeStepId, setActiveStepId] = useState<string>("");

  const effectiveStepId = useMemo(() => {
    if (activeStepId && steps.some((s) => s.id === activeStepId)) {
      return activeStepId;
    }
    return steps[0]?.id || "";
  }, [activeStepId, steps]);

  const safeCurrentStep = useMemo(() => {
    const idx = steps.findIndex((s) => s.id === effectiveStepId);
    return idx !== -1 ? idx : 0;
  }, [steps, effectiveStepId]);

  const goToStep = (idx: number) => {
    const clamped = Math.max(0, Math.min(idx, totalSteps - 1));
    const target = steps[clamped];
    if (target) {
      setActiveStepId(target.id);
    }
  };

  // Responsive state
  const [isDesktop, setIsDesktop] = useState(false);

  // Subgroup selection
  const initialSubgroup: 1 | 2 | null =
    settings.defaultSubgroup === 1 || settings.defaultSubgroup === 2
      ? settings.defaultSubgroup
      : null;
  const [chosenSubgroup, setChosenSubgroup] = useState<1 | 2 | null>(initialSubgroup);
  const [demoSubgroup, setDemoSubgroup] = useState<1 | 2 | null>(initialSubgroup);

  // Schedule demo
  const [demoDay, setDemoDay] = useState<"Пн" | "Вт" | "Ср" | "Чт" | "Пт">("Пн");

  // Online meet demo
  const [demoLinked, setDemoLinked] = useState(isLinked);
  const [demoToast, setDemoToast] = useState("");

  // Classroom demo
  const [demoActiveHwOpen, setDemoActiveHwOpen] = useState(false);
  const [demoDoneHwOpen, setDemoDoneHwOpen] = useState(false);
  const [isLinkingClassroom, setIsLinkingClassroom] = useState(false);
  const [classroomSuccess, setClassroomSuccess] = useState(false);
  const [classroomError, setClassroomError] = useState("");

  // PWA Install state
  const [pwaPrompt, setPwaPrompt] = useState<any>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [pwaFeedback, setPwaFeedback] = useState("");

  // Initialize PWA and screen detection
  useEffect(() => {
    if (typeof window === "undefined") return;

    const checkStandalone = () => {
      const standalone =
        ("standalone" in window.navigator && (window.navigator as any).standalone === true) ||
        window.matchMedia("(display-mode: standalone)").matches;
      setIsStandalone(standalone);
    };
    checkStandalone();

    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent || "");
    setIsIos(ios);

    const checkScreen = () => {
      setIsDesktop(window.innerWidth >= 768);
    };
    checkScreen();
    window.addEventListener("resize", checkScreen);

    // Capture saved prompt event from head script if available
    if ((window as any).__pwaInstallEvent) {
      setPwaPrompt((window as any).__pwaInstallEvent);
    }

    const onInstallReady = (e: any) => {
      setPwaPrompt(e.detail || (window as any).__pwaInstallEvent);
    };

    const onBeforeInstall = (e: any) => {
      e.preventDefault();
      (window as any).__pwaInstallEvent = e;
      setPwaPrompt(e);
    };

    const onAppInstalled = () => {
      setIsStandalone(true);
      setPwaPrompt(null);
      if (typeof window !== "undefined") (window as any).__pwaInstallEvent = null;
      setPwaFeedback("✅ Додаток успішно встановлено!");
    };

    window.addEventListener("pwa-install-ready", onInstallReady);
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onAppInstalled);
    window.addEventListener("pwa-installed", onAppInstalled);

    return () => {
      window.removeEventListener("resize", checkScreen);
      window.removeEventListener("pwa-install-ready", onInstallReady);
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onAppInstalled);
      window.removeEventListener("pwa-installed", onAppInstalled);
    };
  }, []);

  const handleNext = () => {
    if (safeCurrentStep < totalSteps - 1) {
      goToStep(safeCurrentStep + 1);
    } else {
      handleFinish();
    }
  };

  const handlePrev = () => {
    if (safeCurrentStep > 0) {
      goToStep(safeCurrentStep - 1);
    }
  };

  const handleFinish = () => {
    if (isOnboarding && onComplete) {
      onComplete(activeGroupId);
    } else {
      onClose();
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isOnboarding && onComplete) {
          onComplete(activeGroupId);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOnboarding, onComplete, onClose, activeGroupId]);

  const handleSubgroupSelect = (subgroup: 1 | 2 | null) => {
    setChosenSubgroup(subgroup);
    setDemoSubgroup(subgroup);
    updateSetting("defaultSubgroup", subgroup);
  };

  const handleClassroomAuth = async () => {
    if (isLinkingClassroom) return;
    setIsLinkingClassroom(true);
    setClassroomError("");
    setGroupSwitchInfo(null);
    try {
      const cachedGroupId = activeGroupId ?? (
        typeof window !== "undefined"
          ? (Number(localStorage.getItem("schedule:groupId")) || Number(localStorage.getItem("schedule:classroom_linked_group_id")) || undefined)
          : undefined
      );

      await requestClassroomAuth({
        groupId: cachedGroupId,
        onSuccess: (res: any) => {
          setIsLinkingClassroom(false);
          setClassroomSuccess(true);
          setDemoLinked(true);
          setActiveStepId(isOnboarding ? "classroom" : "homework");

          if (res?.group_id) {
            const detectedId = Number(res.group_id);
            if (activeGroupId && detectedId !== activeGroupId) {
              setGroupSwitchInfo(
                `Твою реальну групу визначено як «${res.group_name || detectedId}» за курсами Classroom.`
              );
            }
            setActiveGroupId(detectedId);
            if (typeof window !== "undefined") {
              try {
                localStorage.setItem("schedule:groupId", String(detectedId));
                localStorage.setItem("schedule:classroom_linked_group_id", String(detectedId));
              } catch {}
            }
            api.week(detectedId).then((data) => {
              if (Array.isArray(data) && data.length > 0) {
                setWeekSchedule(data);
                setActiveStepId(isOnboarding ? "classroom" : "homework");
              }
            }).catch(() => {});
          }
        },
        onError: (err: any) => {
          setIsLinkingClassroom(false);
          setClassroomError(err.message || "Не вдалося підключити Google Classroom.");
        },
      });
    } catch (err: any) {
      setIsLinkingClassroom(false);
      setClassroomError(err.message || "Помилка підключення Google Classroom.");
    }
  };

  const handleInstallClick = async () => {
    const promptToUse = pwaPrompt || (typeof window !== "undefined" ? (window as any).__pwaInstallEvent : null);
    if (promptToUse && typeof promptToUse.prompt === "function") {
      try {
        await promptToUse.prompt();
        const choice = await promptToUse.userChoice;
        if (choice?.outcome === "accepted") {
          setIsStandalone(true);
          setPwaPrompt(null);
          if (typeof window !== "undefined") (window as any).__pwaInstallEvent = null;
          setPwaFeedback("✅ Чудово! Додаток додано на ваш пристрій.");
        } else {
          setPwaFeedback("Встановлення відкладено. Ви завжди можете встановити додаток пізніше в налаштуваннях.");
        }
      } catch (err) {
        console.error("Install prompt error:", err);
      }
    } else if (isStandalone) {
      setPwaFeedback("✅ Застосунок уже встановлено на цьому пристрої! 👍");
    } else if (isIos) {
      setPwaFeedback("На iPhone натисніть «Поділитися» ⎋ у нижній панелі Safari, а потім — «На початковий екран» ⊞.");
    } else if (isDesktop) {
      setPwaFeedback("Натисніть на іконку ⊕ праворуч в адресному рядку браузера (Chrome / Edge), щоб закріпити розклад.");
    } else {
      setPwaFeedback("Відкрийте меню браузера (⋮) та оберіть «Встановити додаток» або «Додати на головний екран».");
    }
  };

  const currentStepData = steps[safeCurrentStep] || steps[0];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-2 sm:p-5 backdrop-blur-md overflow-hidden animate-in fade-in duration-150">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="student-guide-title"
        className="relative flex flex-col w-full max-w-4xl h-[92dvh] sm:h-[620px] max-h-[720px] rounded-3xl border border-sys-border bg-sys-card text-sys-text-primary shadow-2xl overflow-hidden"
      >
        
        {/* Top Header */}
        <header className="flex items-center justify-between border-b border-sys-border/50 px-4 sm:px-6 py-3.5 bg-sys-card shrink-0">
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-xl bg-sys-accent/15 text-lg shadow-xs">
              {isOnboarding ? "✨" : "🎓"}
            </span>
            <div>
              <h2 id="student-guide-title" className="text-sm sm:text-base font-bold leading-tight text-sys-text-primary">
                {isOnboarding ? "Швидке налаштування розкладу" : "Гід студента"}
              </h2>
              <p className="text-[11px] text-sys-text-secondary">
                {isOnboarding ? "Персоналізуй розклад під себе" : "Довідник та підказки щодо розкладу"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isOnboarding ? (
              <button
                type="button"
                onClick={handleFinish}
                className="rounded-xl px-3 py-1.5 text-xs font-semibold text-sys-text-secondary hover:text-sys-text-primary hover:bg-sys-bg transition-colors"
              >
                Пропустити
              </button>
            ) : (
              <button
                type="button"
                onClick={onClose}
                aria-label="Закрити"
                className="flex h-8 w-8 items-center justify-center rounded-xl text-sys-text-secondary hover:text-sys-text-primary hover:bg-sys-bg transition-colors font-bold text-sm"
              >
                ✕
              </button>
            )}
          </div>
        </header>

        {/* Mobile Horizontal Section Tabs Strip (scrollable) */}
        <div className="md:hidden flex items-center gap-1.5 overflow-x-auto overscroll-x-contain px-4 py-2 border-b border-sys-border/40 bg-sys-bg/60 shrink-0 no-scrollbar">
          {steps.map((step) => {
            const isActive = step.id === effectiveStepId;
            return (
              <button
                key={step.id}
                type="button"
                onClick={() => setActiveStepId(step.id)}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors duration-fast ease-smooth ${
                  isActive
                    ? "bg-sys-accent text-slate-900 shadow-xs font-bold"
                    : "bg-sys-card border border-sys-border text-sys-text-secondary hover:text-sys-text-primary"
                }`}
              >
                <span aria-hidden="true">{step.icon}</span>
                <span>{step.shortTitle}</span>
              </button>
            );
          })}
        </div>

        {/* Main Body Area: Sidebar (Desktop) + Content (Right) */}
        <div className="flex-1 flex overflow-hidden min-h-0">
          
          {/* Desktop Left Sidebar: Direct Clickable Sections */}
          <aside className="hidden md:flex flex-col w-60 border-r border-sys-border/50 bg-sys-bg/40 p-3 space-y-1 shrink-0 overflow-y-auto overscroll-contain custom-scrollbar">
            <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-sys-text-muted">
              {isOnboarding ? "Кроки налаштування" : "Розділи гіда"}
            </div>
            {steps.map((step) => {
              const isActive = step.id === effectiveStepId;
              return (
                <button
                  key={step.id}
                  type="button"
                  onClick={() => setActiveStepId(step.id)}
                  className={`flex items-center gap-2.5 w-full text-left px-3 py-2.5 rounded-xl text-xs font-semibold transition-colors duration-fast ease-smooth ${
                    isActive
                      ? "bg-sys-accent/15 text-sys-accent font-bold border border-sys-accent/40 shadow-xs"
                      : "text-sys-text-secondary hover:text-sys-text-primary hover:bg-sys-card/70 border border-transparent"
                  }`}
                >
                  <span aria-hidden="true" className="text-base shrink-0">{step.icon}</span>
                  <span className="truncate">{step.shortTitle}</span>
                </button>
              );
            })}
          </aside>

          {/* Right Column: Scrollable Content + Stationary Bottom Footer */}
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
            
            {/* Scrollable Content Area */}
            <main className="flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6 custom-scrollbar">
              <AnimatePresence initial={false}>
                
                {/* STEP: SUBGROUPS */}
                {currentStepData.id === "subgroups" && (
                  <motion.div
                    key="subgroups"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.12 }}
                    className="space-y-4"
                  >
                  <div>
                    <h3 className="text-xl sm:text-2xl font-black text-sys-text-primary tracking-tight">
                      {currentStepData.fullTitle}
                    </h3>
                    <p className="text-xs sm:text-sm text-sys-text-secondary mt-1">
                      {currentStepData.subtitle}
                    </p>
                  </div>

                  {/* Onboarding Mode: Real Setting Selector */}
                  {isOnboarding ? (
                    <div className="rounded-2xl border border-sys-border/80 bg-sys-bg p-4 space-y-3 shadow-xs">
                      <div className="text-xs font-bold text-sys-text-primary">
                        Обери свою підгрупу:
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <button
                          type="button"
                          onClick={() => handleSubgroupSelect(1)}
                          className={`rounded-xl py-2.5 px-3 text-xs sm:text-sm font-bold border transition-all ${
                            chosenSubgroup === 1
                              ? "bg-sys-accent text-slate-900 border-sys-accent shadow-sm scale-[1.02]"
                              : "bg-sys-card border-sys-border text-sys-text-secondary hover:text-sys-text-primary"
                          }`}
                        >
                          1 підгрупа
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSubgroupSelect(2)}
                          className={`rounded-xl py-2.5 px-3 text-xs sm:text-sm font-bold border transition-all ${
                            chosenSubgroup === 2
                              ? "bg-sys-accent text-slate-900 border-sys-accent shadow-sm scale-[1.02]"
                              : "bg-sys-card border-sys-border text-sys-text-secondary hover:text-sys-text-primary"
                          }`}
                        >
                          2 підгрупа
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSubgroupSelect(null)}
                          className={`rounded-xl py-2.5 px-3 text-xs sm:text-sm font-bold border transition-all ${
                            chosenSubgroup === null
                              ? "bg-sys-accent text-slate-900 border-sys-accent shadow-sm scale-[1.02]"
                              : "bg-sys-card border-sys-border text-sys-text-secondary hover:text-sys-text-primary"
                          }`}
                        >
                          Обидві
                        </button>
                      </div>
                      <div className="text-[11px] text-sys-text-muted flex items-center gap-1.5 pt-0.5">
                        <span className="text-sys-accent font-bold">✓</span>
                        <span>
                          {chosenSubgroup
                            ? `Налаштовано: показуватиметься тільки ${chosenSubgroup}-а підгрупа.`
                            : "Налаштовано: показуватимуться всі викладачі обох підгруп."}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2 text-xs sm:text-sm text-sys-text-secondary">
                      <div className="flex items-start gap-2">
                        <span className="text-sys-accent font-bold mt-0.5">✦</span>
                        <span>
                          <strong>Фільтрація підгрупи:</strong> натискай кнопки <span className="font-semibold text-sky-400">1 підгр.</span> або <span className="font-semibold text-indigo-400">2 підгр.</span> прямо в картці пари — чужий викладач та аудиторія зникнуть.
                        </span>
                      </div>
                      <div className="flex items-start gap-2">
                        <span className="text-sys-accent font-bold mt-0.5">✦</span>
                        <span>
                          <strong>Зміна групи або викладача:</strong> у верхньому кутку є вибір групи з миттєвим пошуком та закріпленням (📌).
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Preview Card matching real LessonCard.tsx */}
                  <div className="rounded-2xl border border-sys-border bg-sys-bg p-4 sm:p-5 shadow-lg space-y-3">
                    <div className="flex items-start justify-between gap-4">
                      {/* Time Column */}
                      <div className="flex flex-col items-start pr-3 border-r border-sys-border/50 shrink-0">
                        <span className="text-2xl font-black leading-none text-sys-text-primary">
                          {demoData.subgroupLesson.lessonNumber}
                        </span>
                        <span className="text-xs font-bold text-sys-text-primary mt-1">
                          {demoData.subgroupLesson.time.split(/[-–]/)[0]?.trim() || "09:00"}
                        </span>
                        <span className="text-[11px] text-sys-text-muted">
                          {demoData.subgroupLesson.time.split(/[-–]/)[1]?.trim() || "10:20"}
                        </span>
                      </div>

                      {/* Main Info */}
                      <div className="flex-1 min-w-0 space-y-2">
                        <div className="font-bold text-base text-sys-text-primary leading-tight">
                          {demoData.subgroupLesson.subjectName}
                        </div>

                        {/* Dual Teachers List exactly as in LessonCard.tsx */}
                        <div className="flex flex-col gap-2 pt-0.5">
                          {(demoSubgroup === null || demoSubgroup === 1) && (
                            <div className="flex items-center justify-between gap-2 w-full">
                              <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                                <button
                                  type="button"
                                  onClick={() => setDemoSubgroup(demoSubgroup === 1 ? null : 1)}
                                  className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-bold border transition-colors ${
                                    demoSubgroup === 1
                                      ? "bg-sky-500/20 text-sky-400 border-sky-500/40"
                                      : "bg-sys-card border-sys-border text-slate-400 hover:text-slate-200"
                                  }`}
                                  title="Натисніть для фільтрації"
                                >
                                  1 підгр.
                                </button>
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-sys-text-muted shrink-0">
                                  <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                                  <circle cx="12" cy="7" r="4" />
                                </svg>
                                <span className="text-xs sm:text-sm font-medium text-sys-text-secondary truncate">
                                  {demoData.subgroupLesson.teacher1Name}
                                </span>
                              </div>
                              <span className="shrink-0 rounded-md border border-sys-border bg-sys-card px-2 py-1 text-xs font-semibold text-sys-text-secondary">
                                {demoData.subgroupLesson.teacher1Room}
                              </span>
                            </div>
                          )}

                          {(demoSubgroup === null || demoSubgroup === 2) && (
                            <div className="flex items-center justify-between gap-2 w-full">
                              <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                                <button
                                  type="button"
                                  onClick={() => setDemoSubgroup(demoSubgroup === 2 ? null : 2)}
                                  className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-bold border transition-colors ${
                                    demoSubgroup === 2
                                      ? "bg-indigo-500/20 text-indigo-400 border-indigo-500/40"
                                      : "bg-sys-card border-sys-border text-slate-400 hover:text-slate-200"
                                  }`}
                                  title="Натисніть для фільтрації"
                                >
                                  2 підгр.
                                </button>
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-sys-text-muted shrink-0">
                                  <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                                  <circle cx="12" cy="7" r="4" />
                                </svg>
                                <span className="text-xs sm:text-sm font-medium text-sys-text-secondary truncate">
                                  {demoData.subgroupLesson.teacher2Name}
                                </span>
                              </div>
                              <span className="shrink-0 rounded-md border border-sys-border bg-sys-card px-2 py-1 text-xs font-semibold text-sys-text-secondary">
                                {demoData.subgroupLesson.teacher2Room}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="text-[11px] text-center text-sys-text-muted pt-1">
                      {demoSubgroup !== null ? (
                        <button
                          type="button"
                          onClick={() => setDemoSubgroup(null)}
                          className="text-sys-accent underline hover:opacity-80"
                        >
                          Скинути фільтр у картці й показати обидві підгрупи
                        </button>
                      ) : (
                        "👆 Натискай на кнопки «1 підгр.» чи «2 підгр.» прямо на картці"
                      )}
                    </div>
                  </div>
                </motion.div>
              )}

              {/* STEP: APPEARANCE (THEME & ACCENT) */}
              {currentStepData.id === "appearance" && (
                <motion.div
                  key="appearance"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.12 }}
                  className="space-y-4"
                >
                  <div>
                    <h3 className="text-xl sm:text-2xl font-black text-sys-text-primary tracking-tight">
                      {currentStepData.fullTitle}
                    </h3>
                    <p className="text-xs sm:text-sm text-sys-text-secondary mt-1">
                      {currentStepData.subtitle}
                    </p>
                  </div>

                  {/* Theme Mode Switcher */}
                  <div className="rounded-2xl border border-sys-border/80 bg-sys-bg p-4 space-y-3 shadow-xs">
                    <div className="text-xs font-bold text-sys-text-primary">
                      Режим теми:
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setTheme("dark")}
                        className={`flex items-center justify-center gap-2 rounded-xl py-2.5 px-3 text-xs sm:text-sm font-bold border transition-all ${
                          resolvedTheme === "dark"
                            ? "bg-sys-accent text-slate-900 border-sys-accent shadow-xs scale-[1.02]"
                            : "bg-sys-card border-sys-border text-sys-text-secondary hover:text-sys-text-primary"
                        }`}
                      >
                        <span>🌙</span>
                        <span>Темна</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setTheme("light")}
                        className={`flex items-center justify-center gap-2 rounded-xl py-2.5 px-3 text-xs sm:text-sm font-bold border transition-all ${
                          resolvedTheme === "light"
                            ? "bg-sys-accent text-slate-900 border-sys-accent shadow-xs scale-[1.02]"
                            : "bg-sys-card border-sys-border text-sys-text-secondary hover:text-sys-text-primary"
                        }`}
                      >
                        <span>☀️</span>
                        <span>Світла</span>
                      </button>
                    </div>

                    {/* Accent Colors Palette */}
                    <div className="pt-2">
                      <div className="text-xs font-bold text-sys-text-primary mb-2">
                        Колірний акцент:
                      </div>
                      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                        {ACCENT_OPTIONS.map((opt) => {
                          const isSelected = accent === opt.id;
                          return (
                            <button
                              key={opt.id}
                              type="button"
                              onClick={() => setAccent(opt.id as AccentColor)}
                              className={`flex flex-col items-center gap-1.5 rounded-xl p-2.5 border transition-all ${
                                isSelected
                                  ? "border-sys-accent bg-sys-accent/15 shadow-xs scale-105"
                                  : "border-sys-border bg-sys-card hover:border-sys-border/80 text-sys-text-secondary"
                              }`}
                            >
                              <span
                                className="h-5 w-5 rounded-full shadow-xs"
                                style={{ backgroundColor: opt.colorHex }}
                              />
                              <span className="text-[11px] font-bold truncate">
                                {opt.label}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Real-time Theme Preview Card */}
                  <div className="rounded-2xl border border-sys-accent/50 bg-sys-card p-4 space-y-2 shadow-lg">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-sys-accent">Прев'ю інтерфейсу</span>
                      <span className="rounded-full bg-sys-accent/20 text-sys-accent px-2 py-0.5 text-[10px] font-bold">
                        Активний стиль
                      </span>
                    </div>
                    <div className="text-xs text-sys-text-secondary">
                      Інтерфейс розкладу, кнопок та карток автоматично застосовує твої налаштування.
                    </div>
                  </div>
                </motion.div>
              )}

              {/* STEP: SCHEDULE & LIVE LESSON */}
              {currentStepData.id === "schedule" && (
                <motion.div
                  key="schedule"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.12 }}
                  className="space-y-4"
                >
                  <div>
                    <h3 className="text-xl sm:text-2xl font-black text-sys-text-primary tracking-tight">
                      {currentStepData.fullTitle}
                    </h3>
                    <p className="text-xs sm:text-sm text-sys-text-secondary mt-1">
                      {currentStepData.subtitle}
                    </p>
                  </div>

                  <div className="space-y-2 text-xs sm:text-sm text-sys-text-secondary">
                    <div className="flex items-start gap-2">
                      <span className="text-sys-accent font-bold mt-0.5">✦</span>
                      <span>
                        <strong>4 пари на день:</strong> 1 пара (09:00), 2 пара (10:40), 3 пара (12:30), 4 пара (14:00).
                      </span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-sys-accent font-bold mt-0.5">✦</span>
                      <span>
                        <strong>«Жива» пара:</strong> заняття, яке триває зараз, підсвічується плашкою <span className="font-semibold text-sys-accent">● ще N хв</span> та лінією часу внизу.
                      </span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-sys-accent font-bold mt-0.5">✦</span>
                      <span>
                        <strong>Відеоуроки:</strong> якщо пара дистанційна, у картці з'являється пряме посилання на відеоконференцію.
                      </span>
                    </div>
                  </div>

                  {/* Day strip & Card */}
                  <div className="rounded-2xl border border-sys-border bg-sys-bg p-4 space-y-3 shadow-lg">
                    <div className="grid grid-cols-5 gap-1.5">
                      {(["Пн", "Вт", "Ср", "Чт", "Пт"] as const).map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setDemoDay(d)}
                          className={`rounded-xl py-1.5 text-xs font-bold border transition-all ${
                            demoDay === d
                              ? "bg-sys-accent text-slate-900 border-sys-accent shadow-xs"
                              : "bg-sys-card border-sys-border text-sys-text-secondary hover:border-sys-accent/40"
                          }`}
                        >
                          {d}
                        </button>
                      ))}
                    </div>

                    {demoDay === "Пн" && (
                      <div className="relative rounded-2xl border border-sys-accent/60 bg-gradient-to-r from-sys-accent/10 via-sys-card to-sys-card p-4 space-y-2 shadow-[0_0_20px_rgba(56,189,248,0.12)]">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-black text-sys-accent">
                            {demoData.scheduleDays[0].lessonNumber} · {demoData.scheduleDays[0].time}
                          </span>
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-sys-accent/20 border border-sys-accent/40 px-2.5 py-0.5 text-xs font-bold text-sys-accent">
                            <span className="h-2 w-2 rounded-full bg-sys-accent animate-pulse" />
                            ще 25 хв
                          </span>
                        </div>
                        <div className="font-bold text-base text-sys-text-primary">
                          {demoData.scheduleDays[0].subjectName}
                        </div>
                        <div className="text-xs text-sys-text-secondary">
                          {demoData.scheduleDays[0].teacher} {demoData.scheduleDays[0].room ? `· ${demoData.scheduleDays[0].room}` : ""}
                        </div>
                        <div className="h-1 w-full rounded-full bg-sys-accent/20 overflow-hidden mt-1">
                          <div className="h-full bg-sys-accent rounded-full w-3/5" />
                        </div>
                      </div>
                    )}

                    {demoDay === "Вт" && (
                      <div className="rounded-2xl border border-sys-border bg-sys-card p-4 space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-bold text-sys-text-secondary">
                            {demoData.scheduleDays[1].lessonNumber} · {demoData.scheduleDays[1].time}
                          </span>
                          <span className="rounded-md bg-amber-500/20 text-amber-400 font-bold px-2 py-0.5 text-xs">Заміна</span>
                        </div>
                        <div className="font-bold text-base text-sys-text-primary">
                          {demoData.scheduleDays[1].subjectName}
                        </div>
                        <div className="text-xs text-sys-text-secondary">
                          {demoData.scheduleDays[1].teacher} {demoData.scheduleDays[1].room ? `· ${demoData.scheduleDays[1].room}` : ""}
                        </div>
                      </div>
                    )}

                    {demoDay === "Ср" && (
                      <div className="rounded-2xl border border-sys-border bg-sys-card p-4 space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-bold text-sys-text-secondary">
                            {demoData.scheduleDays[2].lessonNumber} · {demoData.scheduleDays[2].time}
                          </span>
                          {demoData.scheduleDays[2].room && (
                            <span className="text-xs font-semibold text-sys-text-muted">
                              {demoData.scheduleDays[2].room}
                            </span>
                          )}
                        </div>
                        <div className="font-bold text-base text-sys-text-primary">
                          {demoData.scheduleDays[2].subjectName}
                        </div>
                        <div className="text-xs text-sys-text-secondary">
                          {demoData.scheduleDays[2].teacher}
                        </div>
                      </div>
                    )}

                    {demoDay === "Чт" && (
                      <div className="rounded-2xl border border-sys-border bg-sys-card p-4 space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-bold text-sys-text-secondary">
                            {demoData.scheduleDays[3].lessonNumber} · 09:00–09:50
                          </span>
                          <span className="rounded-md bg-blue-500/20 text-blue-400 font-bold px-2 py-0.5 text-xs">⏱ 50 хв</span>
                        </div>
                        <div className="font-bold text-base text-sys-text-primary">
                          {demoData.scheduleDays[3].subjectName}
                        </div>
                        <div className="text-xs text-sys-text-secondary">
                          {demoData.scheduleDays[3].teacher} {demoData.scheduleDays[3].room ? `· ${demoData.scheduleDays[3].room}` : ""}
                        </div>
                      </div>
                    )}

                    {demoDay === "Пт" && (
                      demoData.scheduleDays[4].hasLessons ? (
                        <div className="rounded-2xl border border-sys-border bg-sys-card p-4 space-y-1.5">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-bold text-sys-text-secondary">
                              {demoData.scheduleDays[4].lessonNumber} · {demoData.scheduleDays[4].time}
                            </span>
                            {demoData.scheduleDays[4].room && (
                              <span className="text-xs font-semibold text-sys-text-muted">
                                {demoData.scheduleDays[4].room}
                              </span>
                            )}
                          </div>
                          <div className="font-bold text-base text-sys-text-primary">
                            {demoData.scheduleDays[4].subjectName}
                          </div>
                          <div className="text-xs text-sys-text-secondary">
                            {demoData.scheduleDays[4].teacher}
                          </div>
                        </div>
                      ) : (
                        <div className="py-6 text-center text-sys-text-muted text-xs font-semibold">
                          🎉 Пар немає · Розклад на цей день вільний
                        </div>
                      )
                    )}
                  </div>
                </motion.div>
              )}

              {/* STEP: ONLINE MEETINGS (GUIDE ONLY) */}
              {currentStepData.id === "online" && (
                <motion.div
                  key="online"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.12 }}
                  className="space-y-4"
                >
                  <div>
                    <h3 className="text-xl sm:text-2xl font-black text-sys-text-primary tracking-tight">
                      {currentStepData.fullTitle}
                    </h3>
                    <p className="text-xs sm:text-sm text-sys-text-secondary mt-1">
                      {currentStepData.subtitle}
                    </p>
                  </div>

                  <div className="space-y-2 text-xs sm:text-sm text-sys-text-secondary">
                    <div className="flex items-start gap-2">
                      <span className="text-sys-accent font-bold mt-0.5">✦</span>
                      <span>
                        <strong>Захист посилань:</strong> студенти своєї групи переходять на відеоуроки через пряму кнопку <span className="font-semibold text-emerald-400">Meet ↗</span> або <span className="font-semibold text-blue-400">Zoom ↗</span>.
                      </span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-sys-accent font-bold mt-0.5">✦</span>
                      <span>
                        <strong>Для гостей:</strong> посилання захищені позначкою <span className="font-semibold text-slate-300">🔒 Meet</span> для безпеки навчального процесу.
                      </span>
                    </div>
                  </div>

                  {/* Card with Meet Toggle */}
                  <div className="rounded-2xl border border-sys-border bg-sys-bg p-4 space-y-3 shadow-lg">
                    <div className="flex items-center justify-between pb-2 border-b border-sys-border/40">
                      <span className="text-xs font-bold text-sys-text-secondary">Студентська пошта:</span>
                      <button
                        type="button"
                        onClick={() => { setDemoLinked((prev) => !prev); setDemoToast(""); }}
                        className={`rounded-xl px-3 py-1.5 text-xs font-bold border transition-all ${
                          demoLinked
                            ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/50"
                            : "bg-sys-card text-sys-text-muted border-sys-border"
                        }`}
                      >
                        {demoLinked ? "✓ Classroom прив'язано" : "🔒 Не прив'язано"}
                      </button>
                    </div>

                    <div className="rounded-2xl border border-sys-border bg-sys-card p-4 space-y-2.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-sys-text-secondary">
                          {demoData.onlineLesson.lessonNumber} · {demoData.onlineLesson.time}
                        </span>
                        {demoLinked ? (
                          <button
                            type="button"
                            onClick={() => {
                              if (demoData.onlineLesson.url) {
                                setDemoToast(`Відеоконференція ${demoData.onlineLesson.platform} (${demoData.onlineLesson.url}) відкривається у новій вкладці.`);
                              } else {
                                setDemoToast(`Відеоконференція Google ${demoData.onlineLesson.platform} відкривається у новій вкладці.`);
                              }
                            }}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500/15 border border-emerald-500/40 px-3 py-1 text-xs font-bold text-emerald-400 hover:bg-emerald-500/25 active:scale-95 transition-all shadow-xs"
                          >
                            {demoData.onlineLesson.platform} ↗
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setDemoToast("Для перегляду онлайн-пари прив'яжіть Google Classroom цієї групи")}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-sys-bg border border-sys-border px-3 py-1 text-xs font-bold text-sys-text-muted hover:border-sys-accent/40 active:scale-95 transition-all"
                          >
                            🔒 {demoData.onlineLesson.platform}
                          </button>
                        )}
                      </div>
                      <div className="font-bold text-base text-sys-text-primary">
                        {demoData.onlineLesson.subjectName}
                      </div>
                      <div className="text-xs text-sys-text-secondary">
                        {demoData.onlineLesson.teacher}
                      </div>

                      {demoToast && (
                        <div className="rounded-xl border border-sys-border bg-sys-bg p-2.5 text-xs text-sys-text-primary font-medium animate-in fade-in">
                          {demoToast}
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}

              {/* STEP: CLASSROOM (ONBOARDING & GUIDE) */}
              {(currentStepData.id === "classroom" || currentStepData.id === "homework") && (
                <motion.div
                  key="classroom"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.12 }}
                  className="space-y-4"
                >
                  <div>
                    <h3 className="text-xl sm:text-2xl font-black text-sys-text-primary tracking-tight">
                      {currentStepData.fullTitle}
                    </h3>
                    <p className="text-xs sm:text-sm text-sys-text-secondary mt-1">
                      {currentStepData.subtitle}
                    </p>
                  </div>

                  {/* Interactive Connect Button for Onboarding */}
                  {isOnboarding ? (
                    <div className="space-y-3">
                      <div className="rounded-2xl border border-sys-border/80 bg-sys-bg p-4 space-y-3 shadow-xs">
                        {isLinked || classroomSuccess ? (
                          <div className="flex items-center gap-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-emerald-400 font-bold text-xs sm:text-sm">
                            <span className="text-lg">✅</span>
                            <div>
                              <div>Google Classroom успішно підключено!</div>
                              <div className="text-xs font-normal text-emerald-300/80">
                                {linkedEmail || "Студентський акаунт активний"}
                              </div>
                              {groupSwitchInfo && (
                                <div className="text-xs font-semibold text-amber-300 mt-1">
                                  {groupSwitchInfo}
                                </div>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <button
                              type="button"
                              onClick={handleClassroomAuth}
                              disabled={isLinkingClassroom}
                              className="w-full flex items-center justify-center gap-2 rounded-xl bg-sys-accent px-4 py-2.5 text-xs sm:text-sm font-bold text-slate-900 hover:opacity-95 active:scale-95 transition-all shadow-xs disabled:opacity-50"
                            >
                              <span>🔗</span>
                              <span>{isLinkingClassroom ? "Підключення..." : "Підключити студентську пошту Classroom"}</span>
                            </button>
                            {classroomError && (
                              <p className="text-xs text-rose-400 text-center">{classroomError}</p>
                            )}
                            <p className="text-[11px] text-sys-text-muted text-center">
                              Це необов'язково. Ви можете підключити Classroom пізніше в налаштуваннях.
                            </p>
                          </div>
                        )}
                      </div>

                      {/* Direct Toggle for Homework Badges on Lesson Cards */}
                      <div className="flex items-center justify-between rounded-2xl border border-sys-border/80 bg-sys-bg p-3.5 shadow-xs">
                        <div className="space-y-0.5 pr-3 min-w-0">
                          <div className="text-xs sm:text-sm font-bold text-sys-text-primary">
                            Показувати завдання (ДЗ) на парах
                          </div>
                          <div className="text-[11px] text-sys-text-secondary leading-snug">
                            {settings.showHomeworkBadges
                              ? "Увімкнено: мітки ДЗ з дедлайнами відображаються прямо в картці пари."
                              : "Вимкнено: картки пар чисті, а всі ДЗ доступні у вкладці «Завдання»."}
                          </div>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={settings.showHomeworkBadges}
                          onClick={() => updateSetting("showHomeworkBadges", !settings.showHomeworkBadges)}
                          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                            settings.showHomeworkBadges ? "bg-sys-accent" : "bg-slate-700"
                          }`}
                        >
                          <span
                            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                              settings.showHomeworkBadges ? "translate-x-5" : "translate-x-0"
                            }`}
                          />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2 text-xs sm:text-sm text-sys-text-secondary">
                      <div className="flex items-start gap-2">
                        <span className="text-sys-accent font-bold mt-0.5">✦</span>
                        <span>
                          <strong>ДЗ на картці:</strong> активні завдання з дедлайнами відображаються прямо під назвою предмета.
                        </span>
                      </div>
                      <div className="flex items-start gap-2">
                        <span className="text-sys-accent font-bold mt-0.5">✦</span>
                        <span>
                          <strong>Оцінки:</strong> після здачі роботи плашка стає зеленою (<span className="font-semibold text-emerald-400">Усе здано</span>), де можна побачити оцінку викладача.
                        </span>
                      </div>
                      <div className="flex items-start gap-2">
                        <span className="text-sys-accent font-bold mt-0.5">✦</span>
                        <span>
                          <strong>Вимкнення завдань на парах:</strong> якщо ви бажаєте чистий розклад без блоків ДЗ, показ завдань на парах можна вимкнути в <em>Налаштуваннях</em> (тумблер «Показувати завдання (ДЗ) на парах»). Самі завдання залишаться у вкладці «Завдання».
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Accordion Demo */}
                  <div className="rounded-2xl border border-sys-border bg-sys-bg p-4 space-y-2.5 shadow-lg">
                    <div className="flex items-center justify-between pb-0.5">
                      <span className="text-xs font-bold text-sys-text-secondary">Прев'ю пари з ДЗ:</span>
                      <button
                        type="button"
                        onClick={() => updateSetting("showHomeworkBadges", !settings.showHomeworkBadges)}
                        className="text-[11px] font-bold text-sys-accent hover:underline"
                      >
                        {settings.showHomeworkBadges ? "Спробувати приховати ДЗ на картці" : "Увімкнути показ ДЗ"}
                      </button>
                    </div>

                    <div className="rounded-2xl border border-sys-border bg-sys-card p-4 space-y-2.5">
                      <div className="flex items-center justify-between text-xs font-bold text-sys-text-secondary">
                        <span>{demoData.homeworkLesson.lessonNumber} · {demoData.homeworkLesson.time}</span>
                        <span className="text-sys-text-muted font-normal">{demoData.homeworkLesson.room}</span>
                      </div>
                      <div className="font-bold text-base text-sys-text-primary">
                        {demoData.homeworkLesson.subjectName}
                      </div>

                      {settings.showHomeworkBadges ? (
                        <>
                          {/* Active tasks accordion */}
                          <button
                            type="button"
                            onClick={() => setDemoActiveHwOpen((prev) => !prev)}
                            className="w-full flex items-center justify-between rounded-xl border border-purple-500/30 bg-purple-500/10 px-3 py-2 text-xs font-bold text-purple-400 hover:bg-purple-500/15 transition-colors"
                          >
                            <span>2 завдання · Сьогодні</span>
                            <span>{demoActiveHwOpen ? "▴" : "▾"}</span>
                          </button>
                          {demoActiveHwOpen && (
                            <div className="rounded-xl border border-sys-border bg-sys-bg p-2 space-y-1 text-xs animate-in fade-in">
                              <div className="flex justify-between py-0.5">
                                <span className="text-sys-text-secondary">Практична робота №4</span>
                                <span className="text-amber-400 font-bold">Сьогодні ↗</span>
                              </div>
                              <div className="flex justify-between py-0.5">
                                <span className="text-sys-text-secondary">Тест: процеси та потоки</span>
                                <span className="text-purple-300">до 28 жовт. ↗</span>
                              </div>
                            </div>
                          )}

                          {/* Completed tasks accordion */}
                          <button
                            type="button"
                            onClick={() => setDemoDoneHwOpen((prev) => !prev)}
                            className="w-full flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-400 hover:bg-emerald-500/15 transition-colors"
                          >
                            <span>✓ Здано: 1 завдання</span>
                            <span>{demoDoneHwOpen ? "▴" : "▾"}</span>
                          </button>
                          {demoDoneHwOpen && (
                            <div className="rounded-xl border border-sys-border bg-sys-bg p-2 text-xs flex justify-between animate-in fade-in">
                              <span className="text-sys-text-secondary">Лабораторна робота №3</span>
                              <span className="text-emerald-400 font-bold">Оцінка: 12/12 ↗</span>
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="rounded-xl border border-dashed border-sys-border bg-sys-bg/60 p-3 text-center text-xs text-sys-text-muted space-y-1 animate-in fade-in">
                          <div className="font-semibold text-sys-text-secondary">Блоки завдань на парах приховано</div>
                          <p className="text-[11px]">Розклад залишається чистим і компактним, а всі ДЗ доступні на окремому екрані «Завдання»</p>
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}

              {/* STEP: PWA INSTALLATION */}
              {currentStepData.id === "install" && (
                <motion.div
                  key="install"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.12 }}
                  className="space-y-4"
                >
                  <div>
                    <h3 className="text-xl sm:text-2xl font-black text-sys-text-primary tracking-tight">
                      {currentStepData.fullTitle}
                    </h3>
                    <p className="text-xs sm:text-sm text-sys-text-secondary mt-1">
                      {currentStepData.subtitle}
                    </p>
                  </div>

                  <div className="space-y-2 text-xs sm:text-sm text-sys-text-secondary">
                    <div className="flex items-start gap-2">
                      <span className="text-sys-accent font-bold mt-0.5">✦</span>
                      <span>
                        <strong>Офлайн-режим:</strong> уже відкритий розклад зберігається на пристрої й відкривається навіть без підключення до інтернету.
                      </span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-sys-accent font-bold mt-0.5">✦</span>
                      <span>
                        <strong>Швидкий запуск:</strong> розклад запускається як окремий додаток без адресної панелі браузера.
                      </span>
                    </div>
                  </div>

                  {/* Real install action box */}
                  <div className="rounded-2xl border border-sys-border bg-sys-bg p-4 sm:p-5 space-y-3 shadow-lg">
                    <div className="rounded-xl border border-sys-border bg-sys-card p-3 space-y-1.5 text-xs text-sys-text-secondary leading-relaxed">
                      <div className="font-bold text-sys-text-primary text-xs sm:text-sm">
                        {isStandalone
                          ? "✓ Застосунок уже встановлено"
                          : isIos
                          ? "🍎 Встановлення на iPhone / iPad"
                          : isDesktop
                          ? "💻 Встановлення на комп'ютер"
                          : "🤖 Встановлення на Android"}
                      </div>
                      <p>
                        {isStandalone
                          ? "Ви вже використовуєте розклад як автономний додаток."
                          : isIos
                          ? "У нижній панелі Safari натисніть «Поділитися» ⎋, а потім — «На початковий екран» ⊞."
                          : isDesktop
                          ? "Натисніть кнопку нижче або іконку встановлення в адресному рядку браузера."
                          : "Натисніть кнопку нижче або скористайтеся меню браузера (⋮) → «Встановити додаток»."}
                      </p>
                    </div>

                    {!isStandalone && (
                      <button
                        type="button"
                        onClick={handleInstallClick}
                        className="w-full flex items-center justify-center gap-2 rounded-xl bg-sys-accent px-4 py-3 text-sm font-bold text-slate-900 hover:opacity-95 active:scale-95 transition-all shadow-md"
                      >
                        <span>📲 Встановити додаток</span>
                      </button>
                    )}

                    {pwaFeedback && (
                      <div className="rounded-xl border border-sys-border bg-sys-card p-3 text-xs text-sys-text-primary text-center font-medium animate-in fade-in">
                        {pwaFeedback}
                      </div>
                    )}
                  </div>
                </motion.div>
              )}

            </AnimatePresence>
          </main>

          {/* Stationary Persistent Bottom Navigation Footer */}
          <footer className="flex items-center justify-between border-t border-sys-border/50 px-4 sm:px-6 py-3.5 bg-sys-card shrink-0">
            <button
              type="button"
              onClick={handlePrev}
              disabled={safeCurrentStep === 0}
              className="rounded-xl border border-sys-border bg-sys-bg px-4 py-2 text-xs sm:text-sm font-bold text-sys-text-secondary hover:text-sys-text-primary disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
            >
              ← Назад
            </button>

            <span className="text-xs font-bold text-sys-text-muted">
              {safeCurrentStep + 1} з {totalSteps}
            </span>

            <button
              type="button"
              onClick={handleNext}
              className="rounded-xl bg-sys-accent px-5 py-2 text-xs sm:text-sm font-bold text-slate-900 hover:opacity-95 active:scale-95 transition-[opacity,transform] duration-fast ease-smooth shadow-md"
            >
              {safeCurrentStep === totalSteps - 1
                ? (isOnboarding ? "🚀 Перейти до розкладу" : "Зрозуміло ✓")
                : "Далі →"}
            </button>
          </footer>

        </div>

      </div>

    </div>
  </div>
);
}
