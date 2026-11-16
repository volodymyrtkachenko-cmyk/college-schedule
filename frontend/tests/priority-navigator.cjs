const test = require("node:test");
const assert = require("node:assert/strict");
const { loadTsModule } = require("./helpers/load-ts-module.cjs");

function makeLesson(overrides = {}) {
  return {
    id: 1,
    lesson_number: 1,
    time: "09:00-10:20",
    subject_id: 10,
    subject_name: "Мережі",
    teacher_id: 101,
    teacher_name: "Викладач А. Б.",
    group_id: 1,
    group_name: "КІ-24-1",
    room: "204",
    day_of_week: 1,
    week_type: "both",
    is_cancelled: false,
    is_replacement: false,
    is_relevant_this_week: true,
    note: null,
    ...overrides,
  };
}

function makeDay(date, lessons, overrides = {}) {
  return {
    date,
    week_type: "numerator",
    is_shortened_day: false,
    learning_mode: "offline",
    lessons,
    ...overrides,
  };
}

function makeTask(overrides = {}) {
  return {
    id: "t-1",
    title: "Лабораторна №1",
    subject: "Мережі",
    teacher: "Викладач А. Б.",
    label: "до 17.11",
    url: "https://classroom.google.com/c/1/a/1/details",
    deadline: {
      date: new Date("2026-11-17T21:59:59Z"),
      formattedDate: "17.11",
      isOverdue: false,
      overdueDays: 0,
      isUrgent: true,
      statusText: "до завтра",
      badgeTone: "urgent",
    },
    state: "NEW",
    assignedGrade: null,
    maxPoints: 12,
    dueDateIso: "2026-11-17",
    brief: null,
    ...overrides,
  };
}

test("scorePriorityTasks ranks urgent heavy tasks with imminent lessons above low-urgency tasks and skips done", () => {
  const nav = loadTsModule("lib/schedule/priorityNavigator.ts");

  const week = [
    makeDay("2026-11-16", [
      makeLesson({ lesson_number: 1, time: "09:00-10:20", subject_name: "Історія" }),
      makeLesson({ id: 2, lesson_number: 3, time: "12:30-13:50", subject_name: "Мережі" }),
    ]),
    makeDay("2026-11-17", [
      makeLesson({ id: 3, lesson_number: 1, time: "09:00-10:20", subject_name: "Фізика" }),
    ]),
  ];

  const tasks = [
    makeTask({
      id: "done-1",
      title: "Здана робота",
      subject: "Мережі",
      url: "https://classroom.google.com/c/1/a/99/details",
      state: "TURNED_IN",
    }),
    makeTask({
      id: "low-1",
      title: "Конспект без дати",
      subject: "Історія",
      url: "https://classroom.google.com/c/2/a/2/details",
      dueDateIso: null,
      maxPoints: 2,
      deadline: {
        date: null,
        formattedDate: "",
        isOverdue: false,
        overdueDays: 0,
        isUrgent: false,
        statusText: "",
        badgeTone: "normal",
      },
    }),
    makeTask({
      id: "crit-1",
      title: "Тест з мереж",
      subject: "Мережі",
      url: "https://classroom.google.com/c/1/a/3/details",
      dueDateIso: "2026-11-17",
      maxPoints: 12,
      brief: {
        summary: "Пройти тест за модулем 1",
        steps: ["Повторити протоколи", "Пройти тест"],
        estimatedMinutes: 20,
        workFormat: "phone",
        source: "gemini",
      },
    }),
  ];

  const result = nav.scorePriorityTasks({
    tasks,
    week,
    subjectGrades: [{ subject: "Мережі", average5: 2.8, scaleType: "12", level: "risk" }],
    isLinked: true,
    now: { dateIso: "2026-11-16", minutes: 9 * 60 + 30 },
  });

  assert.equal(result.prioritizedTasks.length, 2);
  assert.equal(result.prioritizedTasks[0].task.id, "crit-1");
  assert.equal(result.prioritizedTasks[0].priorityTier, "critical");
  assert.equal(result.prioritizedTasks[0].weightLabel, "12 б.");
  assert.ok(result.prioritizedTasks[0].reasons.some((r) => r.includes("пара сьогодні")));
  assert.equal(result.prioritizedTasks[1].task.id, "low-1");
});

test("findFreeStudyWindows skips regular 20-min breaks and finds >=45-min windows and online/shortened slots", () => {
  const nav = loadTsModule("lib/schedule/priorityNavigator.ts");

  const week = [
    makeDay("2026-11-16", [
      makeLesson({ lesson_number: 1, time: "09:00-10:20" }),
      // 20-min normal break -> ignored
      makeLesson({ id: 2, lesson_number: 2, time: "10:40-12:00" }),
      // 130-min real window if lesson 3 is skipped -> lesson 4 at 14:00
      makeLesson({ id: 3, lesson_number: 4, time: "14:00-15:20" }),
    ]),
    makeDay(
      "2026-11-17",
      [
        makeLesson({ id: 4, lesson_number: 1, time: "09:00-09:50" }),
        makeLesson({ id: 5, lesson_number: 2, time: "10:00-10:50" }),
      ],
      { is_shortened_day: true, learning_mode: "online" }
    ),
  ];

  const windows = nav.findFreeStudyWindows(week, {
    dateIso: "2026-11-16",
    minutes: 10 * 60 + 30,
  });

  assert.equal(windows.length, 2);
  assert.equal(windows[0].kind, "gap");
  assert.equal(windows[0].environment, "campus");
  assert.equal(windows[0].durationMinutes, 120);
  assert.equal(windows[1].kind, "online_day");
  assert.equal(windows[1].environment, "home");
});

test("matchTasksToWindows avoids PC labs in campus gaps, accepts phone tasks, and respects dismissed/accepted decisions", () => {
  const nav = loadTsModule("lib/schedule/priorityNavigator.ts");

  const windows = [
    {
      id: "2026-11-16:gap:12:00-14:00",
      dateIso: "2026-11-16",
      dayOffset: 0,
      dayLabel: "Сьогодні",
      startTime: "12:00",
      endTime: "14:00",
      durationMinutes: 120,
      kind: "gap",
      environment: "campus",
      description: "Сьогодні, вікно 12:00–14:00 (120 хв)",
    },
    {
      id: "2026-11-17:online_day",
      dateIso: "2026-11-17",
      dayOffset: 1,
      dayLabel: "Завтра",
      startTime: "15:00",
      endTime: "20:30",
      durationMinutes: 90,
      kind: "online_day",
      environment: "home",
      description: "Завтра, дистанційний день",
    },
  ];

  const { prioritizedTasks } = nav.scorePriorityTasks({
    tasks: [
      makeTask({
        id: "pc-heavy",
        title: "Лаба у Packet Tracer",
        url: "https://classroom.google.com/c/1/a/pc/details",
        brief: {
          summary: "Налаштувати маршрутизацію",
          steps: ["Зібрати схему"],
          estimatedMinutes: 45,
          workFormat: "pc",
          source: "gemini",
        },
      }),
      makeTask({
        id: "phone-quick",
        title: "Тест IPv4",
        url: "https://classroom.google.com/c/1/a/phone/details",
        maxPoints: 5,
        brief: {
          summary: "Пройти тест у Google Forms",
          steps: ["Відкрити тест"],
          estimatedMinutes: 15,
          workFormat: "phone",
          source: "gemini",
        },
      }),
    ],
    isLinked: true,
    now: { dateIso: "2026-11-16", minutes: 10 * 60 },
  });

  const matched = nav.matchTasksToWindows(
    prioritizedTasks,
    windows,
    { dateIso: "2026-11-16", accepted: [], dismissed: [] },
    2
  );

  assert.equal(matched.length, 2);
  // Campus window gets the phone task, NOT the PC task!
  assert.equal(matched[0].window.environment, "campus");
  assert.equal(matched[0].item.task.id, "phone-quick");
  // Online/home window gets the PC task!
  assert.equal(matched[1].window.environment, "home");
  assert.equal(matched[1].item.task.id, "pc-heavy");

  // Dismissing the campus pairing hides it cleanly
  const afterDismiss = nav.matchTasksToWindows(
    prioritizedTasks,
    windows,
    {
      dateIso: "2026-11-16",
      accepted: [matched[1].suggestionId],
      dismissed: [matched[0].suggestionId],
    },
    2
  );
  assert.equal(afterDismiss.length, 1);
  assert.equal(afterDismiss[0].suggestionId, matched[1].suggestionId);
  assert.equal(afterDismiss[0].isAccepted, true);
});

test("aggregateClassroomTasks propagates brief and maxPoints fallback onto FullTaskItem", () => {
  const agg = loadTsModule("lib/schedule/tasksAggregation.ts");

  const items = agg.aggregateClassroomTasks({
    mode: "student",
    week: [],
    classroomTasks: [
      {
        id: "cw-10",
        title: "Практична №2",
        subject: "Бази даних",
        url: "https://classroom.google.com/c/10/a/10/details",
        due_date: "2026-11-20",
        max_points: 12,
        brief: {
          summary: "Спроєктувати схему БД та написати SQL-запити.",
          steps: ["Створити таблиці", "Додати SELECT-запити"],
          estimated_minutes: 40,
          work_format: "pc",
          source: "gemini",
        },
      },
    ],
    isLinked: false,
    submissions: {},
    personalTeachers: [],
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].maxPoints, 12);
  assert.deepEqual(JSON.parse(JSON.stringify(items[0].brief)), {
    summary: "Спроєктувати схему БД та написати SQL-запити.",
    steps: ["Створити таблиці", "Додати SELECT-запити"],
    estimatedMinutes: 40,
    workFormat: "pc",
    source: "gemini",
  });
});
