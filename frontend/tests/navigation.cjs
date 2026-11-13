const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadTsModule } = require("./helpers/load-ts-module.cjs");

const nav = loadTsModule(path.resolve(__dirname, "../lib/navigation.ts"));
const cacheSnapshot = loadTsModule(path.resolve(__dirname, "../lib/cacheSnapshot.ts"));

test("normalizeRoutePath strips query, hash, and trailing slash", () => {
  assert.equal(nav.normalizeRoutePath("/"), "/");
  assert.equal(nav.normalizeRoutePath("/bells/"), "/bells");
  assert.equal(nav.normalizeRoutePath("/statistics?mode=teacher#top"), "/statistics");
  assert.equal(nav.normalizeRoutePath("group/pz-21"), "/group/pz-21");
});

test("resolveHrefString serializes string and UrlObject cleanly", () => {
  assert.equal(nav.resolveHrefString("/settings?mode=student"), "/settings?mode=student");
  assert.equal(
    nav.resolveHrefString({
      pathname: "/statistics",
      query: { mode: "teacher", skip: undefined },
      hash: "chart",
    }),
    "/statistics?mode=teacher#chart",
  );
});

test("getRouteDirection orders public routes forward and backward properly", () => {
  assert.equal(nav.getRouteDirection("/", "/bells"), "route-forward");
  assert.equal(nav.getRouteDirection("/bells", "/educational-process"), "route-forward");
  assert.equal(nav.getRouteDirection("/educational-process", "/statistics"), "route-forward");
  assert.equal(nav.getRouteDirection("/statistics", "/settings"), "route-forward");

  assert.equal(nav.getRouteDirection("/settings", "/"), "route-backward");
  assert.equal(nav.getRouteDirection("/statistics", "/bells"), "route-backward");
  assert.equal(nav.getRouteDirection("/group/pz-21-1", "/"), "route-backward");
  assert.equal(nav.getRouteDirection("/", "/group/pz-21-1"), "route-forward");

  assert.equal(nav.getRouteDirection("/statistics?mode=student", "/statistics?mode=teacher"), null);
  assert.equal(nav.getRouteDirection("/", "/?tab=tasks"), null);
});

test("isPublicSectionActive handles root, dynamic group/teacher routes, and subpages", () => {
  assert.equal(nav.isPublicSectionActive("/", "schedule"), true);
  assert.equal(nav.isPublicSectionActive("/group/pz-21", "schedule"), true);
  assert.equal(nav.isPublicSectionActive("/teacher/ivanov", "schedule"), true);
  assert.equal(nav.isPublicSectionActive("/bells", "schedule"), false);
  assert.equal(nav.isPublicSectionActive("/bells", "bells"), true);
  assert.equal(nav.isPublicSectionActive("/educational-process/", "educational-process"), true);
  assert.equal(nav.isPublicSectionActive("/statistics", "statistics"), true);
  assert.equal(nav.isPublicSectionActive("/settings", "settings"), true);
});

test("isModifiedMouseClick detects modifier keys and secondary mouse buttons", () => {
  assert.equal(nav.isModifiedMouseClick({ button: 0 }), false);
  assert.equal(nav.isModifiedMouseClick({ button: 1 }), true);
  assert.equal(nav.isModifiedMouseClick({ metaKey: true, button: 0 }), true);
  assert.equal(nav.isModifiedMouseClick({ ctrlKey: true, button: 0 }), true);
  assert.equal(nav.isModifiedMouseClick({ shiftKey: true, button: 0 }), true);
  assert.equal(nav.isModifiedMouseClick({ altKey: true, button: 0 }), true);
});

test("cacheSnapshot stores and expires memory snapshots cleanly", () => {
  const payload = { ok: true, items: [1, 2, 3] };
  cacheSnapshot.writeCacheSnapshot("test:key", payload);

  const hit = cacheSnapshot.readCacheSnapshot("test:key", 60_000);
  assert.ok(hit);
  assert.deepEqual(hit.data, payload);
  assert.equal(hit.fresh, true);

  assert.equal(cacheSnapshot.readCacheSnapshot("test:missing"), null);
});

test("getCurrentAcademicYear handles August boundary", () => {
  assert.equal(cacheSnapshot.getCurrentAcademicYear(new Date("2026-09-01T12:00:00Z")), 2026);
  assert.equal(cacheSnapshot.getCurrentAcademicYear(new Date("2026-08-15T12:00:00Z")), 2026);
  assert.equal(cacheSnapshot.getCurrentAcademicYear(new Date("2026-05-15T12:00:00Z")), 2025);
});

test("resolveHomeTabFromLocation resets mobile tab to schedule unless explicit tab=tasks", () => {
  assert.equal(nav.resolveHomeTabFromLocation("/", ""), "schedule");
  assert.equal(nav.resolveHomeTabFromLocation("/", "?mode=teacher"), "schedule");
  assert.equal(nav.resolveHomeTabFromLocation("/group/КІ-24-1", ""), "schedule");
  assert.equal(nav.resolveHomeTabFromLocation("/teacher/ivanenko", ""), "schedule");
  assert.equal(nav.resolveHomeTabFromLocation("/", "?tab=tasks"), "tasks");
  assert.equal(nav.resolveHomeTabFromLocation("/group/КІ-24-1", "tab=tasks"), "tasks");
  assert.equal(nav.resolveHomeTabFromLocation("/bells", "?tab=tasks"), "schedule");
});

test("resolveActiveMobileTab hides active bottom tab indicator on auxiliary subpages", () => {
  assert.equal(nav.resolveActiveMobileTab("/", "schedule"), "schedule");
  assert.equal(nav.resolveActiveMobileTab("/", "tasks"), "tasks");
  assert.equal(nav.resolveActiveMobileTab("/group/КІ-24-1", "tasks"), "tasks");
  assert.equal(nav.resolveActiveMobileTab("/settings", "tasks"), "settings");
  assert.equal(nav.resolveActiveMobileTab("/bells", "tasks"), null);
  assert.equal(nav.resolveActiveMobileTab("/statistics", "schedule"), null);
  assert.equal(nav.resolveActiveMobileTab("/educational-process", "tasks"), null);
  assert.equal(nav.resolveActiveMobileTab("/groups", "tasks"), null);
  assert.equal(nav.resolveActiveMobileTab("/teachers", "tasks"), null);
});

test("isScheduleRoutePath distinguishes schedule routes from group/teacher indexes", () => {
  assert.equal(nav.isScheduleRoutePath("/"), true);
  assert.equal(nav.isScheduleRoutePath("/group/КІ-24-1"), true);
  assert.equal(nav.isScheduleRoutePath("/teacher/ivanenko"), true);
  assert.equal(nav.isScheduleRoutePath("/groups"), false);
  assert.equal(nav.isScheduleRoutePath("/teachers"), false);
  assert.equal(nav.isScheduleRoutePath("/bells"), false);
});

test("resolveEffectiveScheduleMode honors query param over stored mode", () => {
  assert.equal(nav.resolveEffectiveScheduleMode("?mode=teacher", "student"), "teacher");
  assert.equal(nav.resolveEffectiveScheduleMode("?mode=student", "teacher"), "student");
  assert.equal(nav.resolveEffectiveScheduleMode("", "teacher"), "teacher");
  assert.equal(nav.resolveEffectiveScheduleMode("", null), "student");
});

test("buildGuideTasksHref and resolveScheduleSubtabFromSearch wire tasks and grades CTAs", () => {
  assert.equal(nav.buildGuideTasksHref("tasks"), "/?tab=tasks&mode=student");
  assert.equal(nav.buildGuideTasksHref("grades"), "/?tab=tasks&mode=student&subtab=grades");
  assert.equal(nav.resolveScheduleSubtabFromSearch("?tab=tasks&subtab=grades"), "grades");
  assert.equal(nav.resolveScheduleSubtabFromSearch("?tab=tasks"), null);
});

test("sanitizeInternalRedirect blocks open redirects and login self-loops", () => {
  assert.equal(nav.sanitizeInternalRedirect("/admin"), "/admin");
  assert.equal(nav.sanitizeInternalRedirect("/settings?mode=teacher", "/"), "/settings?mode=teacher");
  assert.equal(nav.sanitizeInternalRedirect("https://evil.com", "/"), "/");
  assert.equal(nav.sanitizeInternalRedirect("//evil.com", "/"), "/");
  assert.equal(nav.sanitizeInternalRedirect("/\\evil.com", "/"), "/");
  assert.equal(nav.sanitizeInternalRedirect("/login?redirect=/admin", "/"), "/");
  assert.equal(nav.sanitizeInternalRedirect(null, "/admin"), "/admin");
});
