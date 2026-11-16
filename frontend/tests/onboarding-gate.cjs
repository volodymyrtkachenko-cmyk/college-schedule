const test = require("node:test");
const assert = require("node:assert/strict");
const { loadTsModule } = require("./helpers/load-ts-module.cjs");

test("isOnboardingExemptPath allows service routes and gates all public routes", () => {
  const mod = loadTsModule("lib/onboarding.ts");

  for (const exemptPath of [
    "/login",
    "/login?next=/admin",
    "/admin",
    "/admin/",
    "/admin/import",
    "/~offline",
  ]) {
    assert.equal(mod.isOnboardingExemptPath(exemptPath), true, `Expected exempt: ${exemptPath}`);
  }

  for (const gatedPath of [
    "/",
    "/group/75",
    "/teacher/ivanenko-o-v",
    "/groups",
    "/teachers",
    "/bells",
    "/statistics",
    "/educational-process",
    "/atlas",
    "/settings",
    "/admin-panel",
    "/login-help",
    null,
    undefined,
    "",
  ]) {
    assert.equal(mod.isOnboardingExemptPath(gatedPath), false, `Expected gated: ${String(gatedPath)}`);
  }
});

test("readStoredSetupComplete and writeStoredSetupComplete handle keys, admin session, errors, and events", () => {
  const dispatchedEvents = [];
  const storeMap = new Map();
  const mockStorage = {
    getItem: (key) => (storeMap.has(key) ? storeMap.get(key) : null),
    setItem: (key, val) => storeMap.set(key, String(val)),
  };

  class MockEvent {
    constructor(type) {
      this.type = type;
    }
  }

  const mod = loadTsModule("lib/onboarding.ts", {
    Event: MockEvent,
    window: {
      localStorage: mockStorage,
      dispatchEvent: (event) => {
        dispatchedEvents.push(event.type);
        return true;
      },
    },
  });

  assert.equal(mod.readStoredSetupComplete(mockStorage), false);

  storeMap.set(mod.ADMIN_SESSION_STORAGE_KEY, "1");
  assert.equal(mod.readStoredSetupComplete(mockStorage), true);

  storeMap.clear();
  assert.equal(mod.readStoredSetupComplete(mockStorage), false);

  mod.writeStoredSetupComplete(mockStorage);
  assert.equal(storeMap.get(mod.SETUP_COMPLETE_STORAGE_KEY), "1");
  assert.equal(mod.readStoredSetupComplete(mockStorage), true);
  assert.deepEqual(dispatchedEvents, [mod.ONBOARDING_CHANGE_EVENT]);

  const throwingStorage = {
    getItem: () => {
      throw new Error("storage blocked");
    },
    setItem: () => {
      throw new Error("quota exceeded");
    },
  };
  assert.equal(mod.readStoredSetupComplete(throwingStorage), false);
  assert.doesNotThrow(() => mod.writeStoredSetupComplete(throwingStorage));
});

test("buildBlurredPreviewScheduleDay and buildBlurredPreviewWeek prefer real SSR week and fall back neutrally", () => {
  const mod = loadTsModule("lib/onboarding.ts");

  const emptyDay = mod.buildBlurredPreviewScheduleDay("2026-11-16", null);
  assert.equal(emptyDay.date, "2026-11-16");
  assert.equal(emptyDay.lessons.length, 4);
  for (const lesson of emptyDay.lessons) {
    assert.equal(lesson.teacher, "Викладач коледжу");
    assert.ok(!String(lesson.subject).includes("75"));
    assert.ok(!String(lesson.room).includes("75"));
  }

  const fallbackWeek = Array.from(mod.buildBlurredPreviewWeek("2026-11-16", []));
  assert.equal(fallbackWeek.length, 5);
  assert.deepEqual(
    fallbackWeek.map((d) => d.date),
    ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"]
  );

  const realWeek = [
    {
      date: "2026-11-16",
      week_type: "numerator",
      lessons: [],
    },
    {
      date: "2026-11-17",
      week_type: "numerator",
      lessons: [
        {
          id: 101,
          lesson_number: 1,
          time: "09:00-10:20",
          subject: "Комп'ютерні мережі",
          subject_id: 12,
          teacher: "Коваленко І. П.",
          teacher_id: 5,
          second_teacher_id: null,
          day_of_week: 1,
          room: "305",
          week_type: "numerator",
          is_relevant_this_week: true,
        },
      ],
    },
  ];

  const exactPreview = mod.buildBlurredPreviewScheduleDay("2026-11-17", realWeek);
  assert.equal(exactPreview.date, "2026-11-17");
  assert.equal(exactPreview.lessons[0].subject, "Комп'ютерні мережі");

  const reassignedPreview = mod.buildBlurredPreviewScheduleDay("2026-11-21", realWeek);
  assert.equal(reassignedPreview.date, "2026-11-21");
  assert.equal(reassignedPreview.lessons[0].subject, "Комп'ютерні мережі");

  const reusedWeek = mod.buildBlurredPreviewWeek("2026-11-16", realWeek);
  assert.equal(reusedWeek, realWeek);
});
