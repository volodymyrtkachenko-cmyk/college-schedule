const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadTsModule } = require("./helpers/load-ts-module.cjs");

const {
  formatPairsFromHours,
  normalizeDisplaySemesterStart,
  summarizeStudentStatistics,
  evaluateTeacherPlanStatus,
  filterAndSortStudentEntries,
  sortTeacherItems,
} = loadTsModule(path.resolve(__dirname, "../lib/statistics.ts"));

test("formatPairsFromHours preserves .5 for odd weekly academic hours", () => {
  assert.equal(formatPairsFromHours(380), "190");
  assert.equal(formatPairsFromHours(19), "9.5");
  assert.equal(formatPairsFromHours(33), "16.5");
  assert.equal(formatPairsFromHours(0), "0");
});

test("normalizeDisplaySemesterStart maps Monday Aug 31 to Sept 1 for display", () => {
  assert.equal(normalizeDisplaySemesterStart("2026-08-31"), "2026-09-01");
  assert.equal(normalizeDisplaySemesterStart("2026-09-01"), "2026-09-01");
  assert.equal(normalizeDisplaySemesterStart("2027-02-01"), "2027-02-01");
});

test("summarizeStudentStatistics separates planned vs unplanned hours accurately", () => {
  const summary = summarizeStudentStatistics({
    mode: "student",
    semester_start: "2026-08-31",
    through_date: "2026-11-17",
    total_hours: 380,
    planned_hours: 680,
    entries: [
      {
        id: 1,
        name: "Системи автоматичного керування",
        completed_hours: 308,
        planned_hours: 680,
        progress_percent: 45.29,
        replaced_count: 2,
        cancelled_count: 1,
      },
      {
        id: 2,
        name: "Мікропроцесорні пристрої",
        completed_hours: 42,
        planned_hours: 0,
        progress_percent: null,
        replaced_count: 0,
        cancelled_count: 0,
      },
      {
        id: 3,
        name: "Основи національного спротиву",
        completed_hours: 30,
        planned_hours: 0,
        progress_percent: null,
        replaced_count: 1,
        cancelled_count: 0,
      },
    ],
  });

  assert.equal(summary.totalCompletedHours, 380);
  assert.equal(summary.plannedCompletedHours, 308);
  assert.equal(summary.unplannedCompletedHours, 72);
  assert.equal(summary.planCompletionPercent, 45);
  assert.equal(summary.remainingPlannedHours, 372);
  assert.equal(summary.totalReplacedCount, 3);
  assert.equal(summary.totalCancelledCount, 1);
  assert.equal(summary.plannedSubjectsCount, 1);
  assert.equal(summary.unplannedSubjectsCount, 2);
  assert.equal(summary.changesSubjectsCount, 2);
});

test("evaluateTeacherPlanStatus flags partial curriculum plan when total_hours >> planned_hours", () => {
  const partial = evaluateTeacherPlanStatus(340, 34, [
    {
      id: 56,
      name: "Основи національного спротиву",
      completed_hours: 340,
      lessons_count: 170,
      planned_hours: 34,
      groups: ["75", "76", "77"],
    },
  ]);
  assert.equal(partial.hasPlan, true);
  assert.equal(partial.isPartialPlan, true);

  const complete = evaluateTeacherPlanStatus(224, 434, [
    {
      id: 39,
      name: "Економіка",
      completed_hours: 224,
      lessons_count: 112,
      planned_hours: 434,
      groups: ["79", "80"],
    },
  ]);
  assert.equal(complete.hasPlan, true);
  assert.equal(complete.isPartialPlan, false);
  assert.equal(complete.completionPercent, 52);
  assert.equal(complete.remainingHours, 210);
});

test("filterAndSortStudentEntries and sortTeacherItems sort and filter reliably", () => {
  const entries = [
    { id: 1, name: "Я-предмет", completed_hours: 20, planned_hours: 40, progress_percent: 50 },
    { id: 2, name: "А-предмет", completed_hours: 30, planned_hours: 0, progress_percent: null, replaced_count: 1 },
    { id: 3, name: "Б-предмет", completed_hours: 24, planned_hours: 30, progress_percent: 80 },
  ];

  assert.deepEqual(
    Array.from(filterAndSortStudentEntries(entries, "all", "hours"), (e) => e.id),
    [2, 3, 1]
  );
  assert.deepEqual(
    Array.from(filterAndSortStudentEntries(entries, "all", "progress"), (e) => e.id),
    [3, 1, 2]
  );
  assert.deepEqual(
    Array.from(filterAndSortStudentEntries(entries, "unplanned", "name"), (e) => e.id),
    [2]
  );
  assert.deepEqual(
    Array.from(filterAndSortStudentEntries(entries, "changes", "hours"), (e) => e.id),
    [2]
  );

  const groups = [
    { id: 1, name: "99", completed_hours: 20, lessons_count: 10, subject_names: ["Математика"] },
    { id: 2, name: "75", completed_hours: 40, lessons_count: 20, subject_names: ["Фізика"] },
  ];
  assert.deepEqual(
    Array.from(sortTeacherItems(groups, "name"), (g) => g.name),
    ["75", "99"]
  );
});
