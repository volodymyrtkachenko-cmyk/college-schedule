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
