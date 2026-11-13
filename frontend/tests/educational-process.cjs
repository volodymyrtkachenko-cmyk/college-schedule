const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadTsModule } = require("./helpers/load-ts-module.cjs");

const ep = loadTsModule(path.resolve(__dirname, "../lib/educationalProcess.ts"));

function makeWeeks(count = 40) {
  const start = Date.UTC(2026, 7, 31); // 2026-08-31 (Monday of week containing Sep 1)
  const out = [];
  for (let i = 1; i <= count; i++) {
    const s = new Date(start + (i - 1) * 7 * 86_400_000);
    const e = new Date(start + ((i - 1) * 7 + 6) * 86_400_000);
    out.push({
      week_number: i,
      start_date: s.toISOString().slice(0, 10),
      end_date: e.toISOString().slice(0, 10),
    });
  }
  return out;
}

test("mergeProcessCells merges contiguous weeks and preserves gaps", () => {
  const weeks = makeWeeks(10);
  const cells = [
    { week_number: 2, period_type: "practice", name: "Практика" },
    { week_number: 3, period_type: "practice", name: "Практика" },
    { week_number: 6, period_type: "practice", name: "Практика" },
  ];
  const merged = ep.mergeProcessCells(cells, weeks);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].start_week, 2);
  assert.equal(merged[0].end_week, 3);
  assert.equal(merged[0].weeks_count, 2);
  assert.equal(merged[1].start_week, 6);
  assert.equal(merged[1].end_week, 6);
  assert.equal(merged[1].weeks_count, 1);
});

test("partitionSemesterPeriods never duplicates boundary-spanning periods in both semesters", () => {
  const weeks = makeWeeks(40);
  // Semester 1 ends week 17 (Dec 27), Semester 2 starts week 20 (Jan 11)
  const semesters = [
    {
      semester_number: 1,
      name: "I семестр",
      start_date: weeks[0].start_date,
      end_date: weeks[16].end_date,
      start_week: 1,
      end_week: 17,
    },
    {
      semester_number: 2,
      name: "II семестр",
      start_date: weeks[19].start_date,
      end_date: weeks[39].end_date,
      start_week: 20,
      end_week: 40,
    },
  ];

  // Winter holiday spanning weeks 17..20 (majority before Sem 2 start)
  const winterHoliday = {
    start_date: weeks[16].start_date,
    end_date: weeks[19].end_date,
    start_week: 17,
    end_week: 20,
    weeks_count: 4,
    period_type: "holiday",
    name: "Зимові канікули",
  };

  // Practice starting week 19 (1 week before Sem 2) and ending week 22 (3 weeks inside Sem 2)
  const springPractice = {
    start_date: weeks[18].start_date,
    end_date: weeks[21].end_date,
    start_week: 19,
    end_week: 22,
    weeks_count: 4,
    period_type: "practice",
    name: "Виробнича практика",
  };

  // Summer session cleanly in Semester 2
  const summerSession = {
    start_date: weeks[37].start_date,
    end_date: weeks[39].end_date,
    start_week: 38,
    end_week: 40,
    weeks_count: 3,
    period_type: "session",
    name: "Екзаменаційна сесія",
  };

  const { semester1, semester2 } = ep.partitionSemesterPeriods(
    [winterHoliday, springPractice, summerSession],
    semesters,
    weeks
  );

  assert.equal(semester1.length, 1);
  assert.equal(semester1[0].name, "Зимові канікули");

  assert.equal(semester2.length, 2);
  assert.deepEqual(
    Array.from(semester2, (item) => item.name),
    ["Виробнича практика", "Екзаменаційна сесія"]
  );
});

test("partitionSemesterPeriods handles fallback week 22 boundary cleanly without duplication", () => {
  const weeks = makeWeeks(40);
  const spanningFallback = {
    start_date: weeks[20].start_date, // week 21
    end_date: weeks[21].end_date, // week 22
    start_week: 21,
    end_week: 22,
    weeks_count: 2,
    period_type: "holiday",
    name: "Зимові канікули",
  };

  const { semester1, semester2 } = ep.partitionSemesterPeriods([spanningFallback], null, weeks);
  assert.equal(semester1.length + semester2.length, 1);
  assert.equal(semester1.length, 1);
  assert.equal(semester2.length, 0);
});
