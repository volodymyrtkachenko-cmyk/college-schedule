const test = require("node:test");
const assert = require("node:assert/strict");
const { loadTsModule } = require("./helpers/load-ts-module.cjs");

function makeLesson(overrides = {}) {
  return {
    id: 1,
    lesson_number: 1,
    time: "08:30-09:50",
    subject_id: 10,
    subject_name: "Програмування",
    teacher_id: 101,
    teacher_name: "Викладач А. Б.",
    group_id: 1,
    group_name: "ПЗ-01",
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

test("lessonMatchesSubject respects IDs first and guards blank targets", () => {
  const hub = loadTsModule("lib/schedule/subjectHub.ts");

  assert.equal(hub.lessonMatchesSubject(makeLesson({ subject_id: 10 }), 10, "Інша назва"), true);
  assert.equal(hub.lessonMatchesSubject(makeLesson({ subject_id: 10 }), 99, "Програмування"), false);
  assert.equal(hub.lessonMatchesSubject(makeLesson({ subject_id: 0, subject_name: "Програмування (практика)" }), null, "Програмування"), true);
  assert.equal(hub.lessonMatchesSubject(makeLesson(), null, ""), false);
  assert.equal(hub.lessonMatchesSubject(makeLesson({ subject_id: 0, subject_name: "" }), null, "Програмування"), false);
});

test("filterAndMergeWeekDays deduplicates dates and keeps populated entries", () => {
  const hub = loadTsModule("lib/schedule/subjectHub.ts");

  const merged = hub.filterAndMergeWeekDays([
    [
      makeDay("2026-10-20", []),
      makeDay("2026-10-19", [makeLesson({ id: 1 })]),
    ],
    [
      makeDay("2026-10-20", [makeLesson({ id: 2, day_of_week: 2 })]),
      makeDay("2026-10-26", [makeLesson({ id: 3, week_type: "denominator" })], { week_type: "denominator" }),
    ],
  ]);

  assert.deepEqual(
    Array.from(merged.map((d) => d.date)),
    ["2026-10-19", "2026-10-20", "2026-10-26"],
  );
  assert.equal(merged[1].lessons.length, 1);
  assert.equal(merged[1].lessons[0].id, 2);
});

test("findNextSubjectOccurrence detects live, upcoming today, skips past/irrelevant/cancelled, and falls back to week 2", () => {
  const hub = loadTsModule("lib/schedule/subjectHub.ts");

  const days = [
    makeDay("2026-10-19", [
      makeLesson({ id: 1, lesson_number: 1, time: "08:30-09:50" }),
      makeLesson({ id: 2, lesson_number: 2, time: "10:05-11:25", is_cancelled: true }),
      makeLesson({ id: 3, lesson_number: 3, time: "11:55-13:15", is_relevant_this_week: false }),
    ]),
    makeDay(
      "2026-10-26",
      [makeLesson({ id: 4, lesson_number: 1, time: "08:30-09:20" })],
      { week_type: "denominator", is_shortened_day: true, learning_mode: "online" },
    ),
  ];

  const live = hub.findNextSubjectOccurrence(days, 10, "Програмування", {
    dateIso: "2026-10-19",
    minutes: 9 * 60, // 09:00
  });
  assert.equal(live.lesson.id, 1);
  assert.equal(live.isToday, true);
  assert.equal(live.isLive, true);
  assert.equal(live.remainingMinutes, 50);
  assert.equal(live.minutesUntilStart, null);

  const upcomingToday = hub.findNextSubjectOccurrence(days, 10, "Програмування", {
    dateIso: "2026-10-19",
    minutes: 8 * 60 + 10, // 08:10
  });
  assert.equal(upcomingToday.isLive, false);
  assert.equal(upcomingToday.minutesUntilStart, 20);

  const nextWeek = hub.findNextSubjectOccurrence(days, 10, "Програмування", {
    dateIso: "2026-10-19",
    minutes: 10 * 60, // 10:00 (after pair 1; pair 2 cancelled; pair 3 irrelevant)
  });
  assert.equal(nextWeek.lesson.id, 4);
  assert.equal(nextWeek.date, "2026-10-26");
  assert.equal(nextWeek.isToday, false);
  assert.equal(nextWeek.isShortenedDay, true);
  assert.equal(nextWeek.learningMode, "online");
});

test("collectRecurringSubjectSlots merges numerator and denominator weeks across 2-week cycle", () => {
  const hub = loadTsModule("lib/schedule/subjectHub.ts");

  const days = [
    makeDay("2026-10-19", [
      makeLesson({ id: 1, day_of_week: 1, lesson_number: 1, time: "08:30-09:50", is_replacement: true }),
      makeLesson({ id: 2, day_of_week: 1, lesson_number: 2, time: "10:05-11:25", week_type: "numerator" }),
    ], { week_type: "numerator" }),
    makeDay("2026-10-26", [
      makeLesson({ id: 3, day_of_week: 1, lesson_number: 1, time: "08:30-09:50", is_replacement: false }),
      makeLesson({ id: 4, day_of_week: 1, lesson_number: 3, time: "11:55-13:15", week_type: "denominator" }),
      makeLesson({ id: 5, day_of_week: 1, lesson_number: 4, time: "13:30-14:50", is_relevant_this_week: false }),
    ], { week_type: "denominator" }),
  ];

  const slots = Array.from(hub.collectRecurringSubjectSlots(days, 10, "Програмування", "2026-10-19"));
  assert.equal(slots.length, 3);
  assert.deepEqual(
    Array.from(slots, (s) => ({ lesson: s.lessonNumber, freq: s.frequency, repl: s.hasReplacement, sampleId: s.sampleLesson.id })),
    [
      { lesson: 1, freq: "both", repl: true, sampleId: 3 },
      { lesson: 2, freq: "numerator", repl: false, sampleId: 2 },
      { lesson: 3, freq: "denominator", repl: false, sampleId: 4 },
    ],
  );
});

test("filterEventsForSubject filters past events, matches subject, and sorts chronologically", () => {
  const hub = loadTsModule("lib/schedule/subjectHub.ts");

  const events = [
    { id: 1, title: "Стара консультація", event_type: "consultation", event_date: "2026-10-10", start_time: "10:00", subject_id: 10 },
    { id: 2, title: "Екзамен", event_type: "exam", event_date: "2026-11-20", start_time: "11:00", subject_id: 10 },
    { id: 3, title: "Консультація", event_type: "consultation", event_date: "2026-11-20", start_time: "09:00", subject_id: null, subject_name: "Програмування" },
    { id: 4, title: "Чужий залік", event_type: "credit", event_date: "2026-11-18", start_time: "09:00", subject_id: 99, subject_name: "Фізика" },
  ];

  const matched = Array.from(hub.filterEventsForSubject(events, 10, "Програмування", "2026-10-19"));
  assert.deepEqual(
    Array.from(matched, (e) => e.id),
    [3, 2],
  );
});

test("findSubjectStatistics resolves both student entries and teacher subjects", () => {
  const hub = loadTsModule("lib/schedule/subjectHub.ts");

  const studentStats = {
    mode: "student",
    total_hours: 100,
    completed_hours: 50,
    total_planned_hours: 120,
    entries: [
      { id: 10, name: "Програмування", planned_hours: 90, completed_hours: 45, progress_percent: 50, cancelled_count: 1, replaced_count: 2 },
    ],
  };
  const sEntry = hub.findSubjectStatistics(studentStats, 10, "Програмування");
  assert.equal(sEntry.completed_hours, 45);
  assert.equal(sEntry.planned_hours, 90);
  assert.equal(sEntry.replaced_count, 2);

  const teacherStats = {
    mode: "teacher",
    total_hours: 60,
    completed_hours: 30,
    subjects: [
      { id: 10, name: "Програмування", lessons_count: 15, completed_hours: 30 },
    ],
  };
  const tEntry = hub.findSubjectStatistics(teacherStats, null, "Програмування");
  assert.equal(tEntry.completed_hours, 30);
  assert.equal(tEntry.planned_hours, null);
  assert.equal(tEntry.lessons_count, 15);
});

test("partitionSubjectTasks splits overdue, active sorted by deadline, and completed tasks", () => {
  const hub = loadTsModule("lib/schedule/subjectHub.ts");

  const tasks = [
    { id: "1", subject: "Програмування", title: "Лаб 1", state: "TURNED_IN", deadline: { isOverdue: false, date: new Date(1000) } },
    { id: "2", subject: "Програмування", title: "Лаб 2", state: "CREATED", deadline: { isOverdue: true, badgeTone: "overdue", date: new Date(2000) } },
    { id: "3", subject: "Програмування", title: "Лаб 3", state: "CREATED", deadline: { isOverdue: false, date: new Date(4000) } },
    { id: "4", subject: "Програмування", title: "Лаб 4", state: "CREATED", deadline: { isOverdue: false, date: new Date(3000) } },
    { id: "5", subject: "Математика", title: "ДЗ", state: "CREATED", deadline: { isOverdue: false, date: new Date(2500) } },
  ];

  const linkedPart = hub.partitionSubjectTasks(tasks, "Програмування", true);
  assert.deepEqual(Array.from(linkedPart.overdue, (t) => t.id), ["2"]);
  assert.deepEqual(Array.from(linkedPart.active, (t) => t.id), ["4", "3"]);
  assert.deepEqual(Array.from(linkedPart.completed, (t) => t.id), ["1"]);

  const unlinkedPart = hub.partitionSubjectTasks(tasks, "Програмування", false);
  assert.equal(unlinkedPart.completed.length, 0);
  assert.equal(unlinkedPart.active.length, 3);

  const blankPart = hub.partitionSubjectTasks(tasks, "", true);
  assert.equal(blankPart.all.length, 0);
});

test("resolveSubjectLessonDetails handles subgroup meetings priority vs physical room and locked links", () => {
  const hub = loadTsModule("lib/schedule/subjectHub.ts");

  const dualLesson = makeLesson({
    teacher_id: 101,
    second_teacher_id: 102,
    teacher_name: "Викладач А. Б. / Наставник В. Г.",
    room: "204 / 305",
    teacher_room: "204",
    second_teacher_room: "305",
    note: "Викладач: https://meet.google.com/aaa-bbbb-ccc",
  });

  const sub1 = hub.resolveSubjectLessonDetails(dualLesson, {
    defaultSubgroup: 1,
    hasGroupAccess: true,
  });
  assert.equal(sub1.isDualTeachers, true);
  assert.equal(sub1.effectiveSubgroup, 1);
  assert.equal(sub1.primaryMeeting.platform, "meet");
  assert.deepEqual(Array.from(sub1.displayRooms), []);

  const sub2 = hub.resolveSubjectLessonDetails(dualLesson, {
    defaultSubgroup: 2,
    hasGroupAccess: true,
  });
  assert.equal(sub2.effectiveSubgroup, 2);
  assert.equal(sub2.primaryMeeting, null);
  assert.deepEqual(Array.from(sub2.displayRooms), ["305"]);

  const protectedLesson = makeLesson({
    room: "",
    is_online: true,
    has_protected_link: true,
  });
  const locked = hub.resolveSubjectLessonDetails(protectedLesson, { hasGroupAccess: false });
  assert.equal(locked.hasProtectedOnline, true);
});
