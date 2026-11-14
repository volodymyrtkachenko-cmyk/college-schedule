const { test } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const { loadTsModule } = require("./helpers/load-ts-module.cjs");

function snapshotCalendarOutputsInTimezone(tz) {
  const helperPath = path.join(__dirname, "helpers/load-ts-module.cjs");
  const calendarModPath = path.join(__dirname, "../lib/calendarDate.ts");
  const dateModPath = path.join(__dirname, "../lib/date.ts");
  const formatModPath = path.join(__dirname, "../lib/format.ts");
  const navModPath = path.join(__dirname, "../lib/schedule/navigation.ts");
  const apiScheduleModPath = path.join(__dirname, "../lib/api/schedule.ts");

  const script = `
    const { loadTsModule } = require(${JSON.stringify(helperPath)});
    const cal = loadTsModule(${JSON.stringify(calendarModPath)});
    const dt = loadTsModule(${JSON.stringify(dateModPath)});
    const fmt = loadTsModule(${JSON.stringify(formatModPath)});
    const nav = loadTsModule(${JSON.stringify(navModPath)});

    let lastWeekUrl = "";
    const apiSched = loadTsModule(${JSON.stringify(apiScheduleModPath)}, {
      fetch: async (url) => {
        lastWeekUrl = url;
        return { ok: true, status: 200, headers: new Headers(), json: async () => [] };
      },
    });

    (async () => {
      const novGrid = cal.buildCalendarMonthGrid(2026, 10);
      const decGrid = cal.buildCalendarMonthGrid(2026, 11);
      const janGrid = cal.buildCalendarMonthGrid(2027, 0);
      const febLeapGrid = cal.buildCalendarMonthGrid(2024, 1);

      const nov14Cell = novGrid.find((c) => c.isCurrentMonth && c.dayNum === 14);
      const selectedAnchor = cal.calendarDateIsoToUtcDate(cal.getMondayCalendarIso(nov14Cell.dateIso));
      const kyivSaturdayInstant = new Date("2026-11-14T12:00:00Z");
      const dstSpringInstant = new Date("2026-03-29T12:00:00Z");
      const dstFallInstant = new Date("2026-10-25T12:00:00Z");

      await apiSched.week(85, undefined, selectedAnchor);

      const snapshot = {
        nov14Iso: nov14Cell.dateIso,
        novGridIsos: novGrid.map((c) => [c.dayNum, c.dateIso, c.isCurrentMonth, c.isWeekend]),
        decGridFirstLast: [decGrid[0].dateIso, decGrid[41].dateIso],
        janGridFirstLast: [janGrid[0].dateIso, janGrid[41].dateIso],
        febLeap29: Boolean(febLeapGrid.find((c) => c.isCurrentMonth && c.dayNum === 29)),
        canPrevDecFromJan: cal.canNavigateCalendarPrevMonth(2027, 0, "2026-12-31"),
        canPrevDecFromJanBlocked: cal.canNavigateCalendarPrevMonth(2027, 0, "2027-01-01"),
        canNextJanFromDec: cal.canNavigateCalendarNextMonth(2026, 11, "2027-01-01"),
        canNextJanFromDecBlocked: cal.canNavigateCalendarNextMonth(2026, 11, "2026-12-31"),
        anchorIso: dt.formatKyivDateIso(selectedAnchor),
        weekDaysMini: nav.buildWeekDaysMini(selectedAnchor),
        compactWeekRange: nav.formatCompactWeekRange(selectedAnchor),
        fullWeekRange: fmt.formatFullWeekRange(selectedAnchor),
        shortWeekRange: fmt.formatShortWeekRange(selectedAnchor, 11),
        weekNum: fmt.calculateWeekNumber(selectedAnchor, "2026-09-01"),
        satAnchorIso: dt.formatKyivDateIso(dt.getKyivInitialWeekAnchor(kyivSaturdayInstant)),
        maxPublicIso: dt.getKyivMaxPublicDateIso(kyivSaturdayInstant),
        dstSpringAnchor: dt.formatKyivDateIso(dt.getMondayOf(dstSpringInstant)),
        dstFallAnchor: dt.formatKyivDateIso(dt.getMondayOf(dstFallInstant)),
        navBounds: [
          nav.canNavigatePrevWeekDate(selectedAnchor, "2026-11-08"),
          nav.canNavigatePrevWeekDate(selectedAnchor, "2026-11-07"),
          nav.canNavigateNextWeekDate(selectedAnchor, "2026-11-16"),
          nav.canNavigateNextDayDate(selectedAnchor, 4, "2026-11-16"),
        ],
        apiWeekUrl: lastWeekUrl,
      };
      console.log(JSON.stringify(snapshot));
    })();
  `;

  const stdout = execFileSync(process.execPath, ["-e", script], {
    env: { ...process.env, TZ: tz },
    encoding: "utf8",
  });
  return JSON.parse(stdout.trim());
}

test("calendar grids, bounds, week navigation, and API target_date are identical in Kyiv, Tokyo, New York, and Honolulu", () => {
  const kyiv = snapshotCalendarOutputsInTimezone("Europe/Kyiv");
  const tokyo = snapshotCalendarOutputsInTimezone("Asia/Tokyo");
  const newYork = snapshotCalendarOutputsInTimezone("America/New_York");
  const honolulu = snapshotCalendarOutputsInTimezone("Pacific/Honolulu");

  assert.equal(kyiv.nov14Iso, "2026-11-14");
  assert.equal(kyiv.anchorIso, "2026-11-09");
  assert.equal(kyiv.satAnchorIso, "2026-11-16");
  assert.equal(kyiv.maxPublicIso, "2026-11-29");
  assert.equal(kyiv.febLeap29, true);
  assert.equal(kyiv.canPrevDecFromJan, true);
  assert.equal(kyiv.canPrevDecFromJanBlocked, false);
  assert.equal(kyiv.canNextJanFromDec, true);
  assert.equal(kyiv.canNextJanFromDecBlocked, false);
  assert.deepEqual(kyiv.decGridFirstLast, ["2026-11-30", "2027-01-10"]);
  assert.deepEqual(kyiv.janGridFirstLast, ["2026-12-28", "2027-02-07"]);
  assert.equal(kyiv.dstSpringAnchor, "2026-03-23");
  assert.equal(kyiv.dstFallAnchor, "2026-10-19");
  assert.ok(kyiv.apiWeekUrl.includes("target_date=2026-11-09"));

  assert.deepEqual(tokyo, kyiv);
  assert.deepEqual(newYork, kyiv);
  assert.deepEqual(honolulu, kyiv);
});

test("calendar arithmetic handles year rollovers, leap days, and DST transitions cleanly", () => {
  const cal = loadTsModule(path.join(__dirname, "../lib/calendarDate.ts"));

  assert.equal(cal.addDaysToCalendarIso("2026-12-31", 1), "2027-01-01");
  assert.equal(cal.addDaysToCalendarIso("2027-01-01", -1), "2026-12-31");
  assert.equal(cal.addDaysToCalendarIso("2024-02-28", 1), "2024-02-29");
  assert.equal(cal.addDaysToCalendarIso("2026-02-28", 1), "2026-03-01");
  assert.equal(cal.addDaysToCalendarIso("2026-03-28", 1), "2026-03-29");
  assert.equal(cal.addDaysToCalendarIso("2026-10-24", 2), "2026-10-26");
  assert.equal(cal.diffCalendarDays("2026-10-26", "2026-10-25"), 1);
  assert.equal(cal.diffCalendarWeeks("2026-11-02", "2026-10-26"), 1);
  assert.equal(cal.parseCalendarDateIso("2026-02-30"), null);
  assert.equal(cal.parseCalendarDateIso("2026-02-28")?.day, 28);
});
