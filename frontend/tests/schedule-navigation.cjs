const test = require("node:test");
const assert = require("node:assert/strict");
const { loadTsModule } = require("./helpers/load-ts-module.cjs");

test("classroomTaskFilter extracts task keys and checks personal submissions", () => {
  const mod = loadTsModule("lib/classroomTaskFilter.ts");

  assert.equal(
    mod.extractClassroomTaskKey("https://classroom.google.com/c/MTIz/a/NDU2/details"),
    "MTIz_NDU2",
  );
  assert.equal(
    mod.extractClassroomTaskKey("https://example.com/task/42/?usp=sharing#top"),
    "https://example.com/task/42",
  );

  assert.equal(mod.isOwnTask(false, {}, "https://classroom.google.com/c/1/a/2"), true);
  assert.equal(
    mod.isOwnTask(true, { "1_2": { state: "TURNED_IN" } }, "https://classroom.google.com/c/1/a/2/details"),
    true,
  );
  assert.equal(
    mod.isOwnTask(true, { "1_2": { state: "NEW" } }, "https://classroom.google.com/c/1/a/999/details"),
    false,
  );
});

test("schedule/navigation computes academic week numbers, week types, mini days, and learning modes", () => {
  const nav = loadTsModule("lib/schedule/navigation.ts");

  const anchor = new Date(2026, 9, 19, 12, 0, 0); // Monday 19 Oct 2026
  assert.equal(nav.computeCurrentWeekNumber("2026-09-01", anchor), 8);
  assert.equal(nav.resolveWeekType([], 8, true, null), "denominator");
  assert.equal(nav.resolveWeekType([], 7, true, null), "numerator");
  assert.equal(nav.resolveWeekType([{ week_type: "numerator" }], 8, false, null), "numerator");

  const miniDays = Array.from(nav.buildWeekDaysMini(anchor));
  assert.equal(miniDays.length, 5);
  assert.equal(miniDays[0].name, "Пн");
  assert.equal(miniDays[0].iso, "2026-10-19");
  assert.equal(miniDays[4].name, "Пт");
  assert.equal(miniDays[4].iso, "2026-10-23");

  assert.equal(nav.canNavigatePrevWeekDate(anchor, "2026-10-19"), false);
  assert.equal(nav.canNavigateNextWeekDate(anchor, "2026-10-26"), true);
  assert.equal(nav.canNavigateNextWeekDate(anchor, "2026-10-25"), false);

  const learningBadge = nav.computeHeaderLearningMode({
    view: "today",
    week: [],
    todayActualIso: "2026-10-19",
    selectedDaySchedule: {
      date: "2026-10-19",
      week_type: "denominator",
      lessons: [],
      learning_mode: "offline",
      learning_mode_override: {
        mode: "online",
        start: "2026-10-19",
        end: "2026-10-23",
        reason: "Осінні канікули онлайн",
      },
    },
  });
  assert.equal(learningBadge.mode, "online");
  assert.equal(learningBadge.baseLabel, "Дистанційно");
  assert.ok(learningBadge.title.includes("Осінні канікули онлайн"));
});

test("schedule/tasksAggregation merges lists, maps submission grades, and counts overdue tasks", () => {
  const agg = loadTsModule("lib/schedule/tasksAggregation.ts");

  const merged = Array.from(
    agg.mergeTasksLists(
      [{ url: "https://classroom.google.com/c/10/a/20", title: "Лаб 1", creationTime: "2026-10-01T10:00:00Z" }],
      [{ alternate_link: "https://classroom.google.com/c/10/a/20", due_date: "2026-10-10" }],
    ),
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].title, "Лаб 1");
  assert.equal(merged[0].due_date, "2026-10-10");

  const items = Array.from(
    agg.aggregateClassroomTasks({
      mode: "student",
      week: [
        {
          date: "2026-10-19",
          week_type: "denominator",
          lessons: [
            {
              lesson_number: 1,
              time: "09:00-10:20",
              subject_name: "Програмування (Панченко В.)",
              teacher_name: "Панченко В.",
              room: "207",
              is_cancelled: false,
              note: "[TASK] Лаб 1 (до 18.10) | https://classroom.google.com/c/10/a/20",
            },
          ],
        },
      ],
      classroomTasks: [
        {
          id: "10_30",
          title: "Тест 2",
          course_name: "Фізика",
          due_date: "2026-10-25",
          alternate_link: "https://classroom.google.com/c/10/a/30",
        },
      ],
      isLinked: true,
      submissions: {
        "10_20": { state: "RETURNED", grade: 11, maxPoints: 12 },
        "10_30": { state: "NEW", grade: null, maxPoints: 100 },
      },
      personalTeachers: [],
    }),
  );

  assert.equal(items.length, 2);
  const doneTask = items.find((i) => i.url.endsWith("/20"));
  assert.equal(doneTask.state, "RETURNED");
  assert.equal(doneTask.deadline.statusText, "Оцінка: 11/12");
  assert.equal(doneTask.deadline.isOverdue, false);
  assert.equal(doneTask.isBoundToWeek, true);

  const overdueTask = items.find((i) => i.url.endsWith("/30"));
  assert.equal(overdueTask.isBoundToWeek, false);

  assert.equal(agg.countOverdueClassroomTasks(items, true, "2026-10-26"), 1);
  assert.equal(agg.aggregateClassroomTasks({
    mode: "teacher",
    week: [],
    classroomTasks: [],
    isLinked: false,
    submissions: {},
    personalTeachers: [],
  }).length, 0);
});

test("mergeTasksLists preserves richer brief and metadata when note-reconstructed fallback arrives", () => {
  const agg = loadTsModule("lib/schedule/tasksAggregation.ts");

  const merged = JSON.parse(JSON.stringify(
    agg.mergeTasksLists(
      [
        {
          id: "cw-1",
          title: "Лабораторна №1",
          subject: "Комп'ютерні мережі",
          teacher: "Викладач А. Б.",
          url: "https://classroom.google.com/c/10/a/20/details",
          max_points: 12,
          creation_time: "2026-11-10T10:00:00Z",
          brief: {
            summary: "Зібрати схему у Packet Tracer.",
            deliverable: "Файл .pkt",
            materials: [{ title: "Методичка.pdf", url: "https://drive.google.com/file/d/x/view", kind: "pdf" }],
            source: "gemini",
          },
        },
      ],
      [
        {
          id: "https://classroom.google.com/c/10/a/20/details",
          title: "Лабораторна №1",
          subject: "Інша назва",
          teacher: null,
          alternate_link: "https://classroom.google.com/c/10/a/20/details",
          max_points: null,
          creation_time: null,
          brief: null,
          is_reconstructed: true,
        },
      ],
    ),
  ));

  assert.equal(merged.length, 1);
  assert.equal(merged[0].subject, "Комп'ютерні мережі");
  assert.equal(merged[0].teacher, "Викладач А. Б.");
  assert.equal(merged[0].max_points, 12);
  assert.equal(merged[0].creation_time, "2026-11-10T10:00:00Z");
  assert.equal(merged[0].brief.summary, "Зібрати схему у Packet Tracer.");
});

test("buildTelegramShareText and formatWeekShareText include owner, shortened day, overrides, subgroups, cancelled lessons, and period days", () => {
  const fmt = loadTsModule("lib/format.ts");
  const nav = loadTsModule("lib/schedule/navigation.ts");

  const daySchedule = {
    date: "2026-11-16",
    week_type: "denominator",
    is_shortened_day: true,
    learning_mode_override: { mode: "online", start: "2026-11-16", end: "2026-11-20" },
    lessons: [
      {
        id: 1,
        lesson_number: 1,
        time: "09:00-09:50",
        subject_name: "Мікропроцесори",
        teacher_name: "Криволап Віктор Володимирович",
        room: "414",
        is_replacement: true,
        is_cancelled: false,
        note: "Zoom: [protected link]",
        week_type: "both",
        day_of_week: 1,
      },
      {
        id: 2,
        lesson_number: 2,
        time: "10:00-10:50",
        subject_name: "Фізика",
        teacher_name: "Іваненко Іван Іванович",
        room: "209",
        is_cancelled: true,
        week_type: "both",
        day_of_week: 1,
      },
    ],
  };

  const dayText = fmt.buildTelegramShareText(daySchedule, "student", 12, "Група 75");
  assert.match(dayText, /Група 75/);
  assert.match(dayText, /12 тиждень · знаменник/);
  assert.match(dayText, /⏱ 50 хв/);
  assert.match(dayText, /Дистанційно/);
  assert.match(dayText, /Мікропроцесори · ⚡ Заміна/);
  assert.match(dayText, /Фізика \(Скасовано\)/);

  const weekText = nav.formatWeekShareText({
    week: [
      daySchedule,
      {
        date: "2026-11-17",
        week_type: "denominator",
        lessons: [],
        period_info: {
          id: 9,
          period_type: "practice",
          name: "Технологічна практика",
          start_date: "2026-11-17",
          end_date: "2026-11-28",
        },
      },
    ],
    mode: "student",
    groupId: 75,
    teacherId: null,
    groups: [{ id: 75, name: "75" }],
    teachers: [],
    weekRange: "16–20 листопада 2026 року",
    currentWeekNumber: 12,
    weekType: "denominator",
  });

  assert.match(weekText, /📅 Група 75/);
  assert.match(weekText, /⏱ 50 хв/);
  assert.match(weekText, /Дистанційно/);
  assert.match(weekText, /Мікропроцесори ⚡ Заміна/);
  assert.match(weekText, /Технологічна практика/);
  assert.doesNotMatch(weekText, /Фізика/);
});
