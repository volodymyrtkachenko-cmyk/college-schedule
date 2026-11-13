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
