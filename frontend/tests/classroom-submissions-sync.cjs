const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadTsModule } = require("./helpers/load-ts-module.cjs");

const toPlain = (v) => JSON.parse(JSON.stringify(v));

function createMemoryStorage(initial = {}) {
  const store = new Map(Object.entries(initial).map(([k, v]) => [String(k), String(v)]));
  return {
    get length() {
      return store.size;
    },
    key(index) {
      return Array.from(store.keys())[index] ?? null;
    },
    getItem(k) {
      return store.has(k) ? store.get(k) : null;
    },
    setItem(k, v) {
      store.set(String(k), String(v));
    },
    removeItem(k) {
      store.delete(k);
    },
  };
}

test("resolveManualTaskIdentities, toggleManualDoneInStorage, and filterStaleManualDoneKeys prevent stale manual flags", () => {
  const filterMod = loadTsModule(path.join(__dirname, "../lib/classroomTaskFilter.ts"));
  const localStorage = createMemoryStorage();

  const ids = filterMod.resolveManualTaskIdentities({
    url: "https://classroom.google.com/u/0/c/123/a/456/details",
    id: "456",
  });
  assert.deepEqual(toPlain(ids).sort(), [
    "123_456",
    "456",
    "https://classroom.google.com/u/0/c/123/a/456/details",
  ]);

  // Mark via card with id, then unmark via URL alone (without explicit id): trailing cwId "456" is cleaned too
  assert.equal(
    filterMod.toggleManualDoneInStorage(
      localStorage,
      { url: "https://classroom.google.com/c/123/a/456/details", id: "456" },
      true
    ),
    true
  );
  const overlaid = filterMod.applyManualDoneOverlay(
    { "123_456": { state: "NEW" } },
    filterMod.parseManualDoneList(localStorage.getItem(filterMod.MANUAL_DONE_STORAGE_KEY))
  );
  assert.equal(overlaid["123_456"].state, filterMod.MANUAL_DONE_STATE);

  filterMod.toggleManualDoneInStorage(
    localStorage,
    { url: "https://classroom.google.com/c/123/a/456/details" },
    false
  );
  assert.equal(localStorage.getItem(filterMod.MANUAL_DONE_STORAGE_KEY), null);

  // When Classroom confirms TURNED_IN/RETURNED, stale manual keys for that task are pruned, others kept
  const remaining = filterMod.filterStaleManualDoneKeys(
    ["123_456", "456", "789_999", "999"],
    [
      {
        id: "456",
        url: "https://classroom.google.com/c/123/a/456/details",
        state: "TURNED_IN",
      },
      {
        id: "999",
        url: "https://classroom.google.com/c/789/a/999/details",
        state: "NEW",
      },
    ]
  );
  assert.deepEqual(toPlain(remaining), ["789_999", "999"]);
});

test("consumePendingClassroomReturn respects minimum away time and clears after consumption", () => {
  const sessionStorage = createMemoryStorage();
  const filterMod = loadTsModule(path.join(__dirname, "../lib/classroomTaskFilter.ts"), {
    window: { sessionStorage },
    sessionStorage,
  });

  assert.equal(filterMod.consumePendingClassroomReturn(2000), false);
  filterMod.markPendingClassroomReturn();
  assert.equal(filterMod.consumePendingClassroomReturn(2000), false);
  sessionStorage.setItem(filterMod.CLASSROOM_RETURN_TS_KEY, String(Date.now() - 5000));
  assert.equal(filterMod.consumePendingClassroomReturn(2000), true);
  assert.equal(filterMod.consumePendingClassroomReturn(2000), false);
});

test("aggregateClassroomTasks carries matchedTask.id onto week-bound FullTaskItem entries", () => {
  const aggMod = loadTsModule(path.join(__dirname, "../lib/schedule/tasksAggregation.ts"));
  const tasks = aggMod.aggregateClassroomTasks({
    mode: "student",
    week: [
      {
        date: "2026-11-16",
        week_type: "numerator",
        lessons: [
          {
            id: 1,
            lesson_number: 1,
            day_of_week: 1,
            week_type: "both",
            subject_name: "Математика",
            teacher_name: "Іванов І.І.",
            note: "[TASK: Лабораторна 1 (до 10.11): https://classroom.google.com/c/123/a/456/details]",
          },
        ],
      },
    ],
    classroomTasks: [
      {
        id: "456",
        alternate_link: "https://classroom.google.com/c/123/a/456/details",
        state: "NEW",
      },
    ],
    isLinked: true,
    submissions: {
      "123_456": { state: "NEW" },
    },
    personalTeachers: [],
  });

  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].id, "456");
});
