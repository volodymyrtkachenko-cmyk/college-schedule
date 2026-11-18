const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadTsModule } = require("./helpers/load-ts-module.cjs");

test("motion helpers clamp stagger indices safely", () => {
  const motionMod = loadTsModule(path.resolve(__dirname, "../lib/motion.ts"));

  assert.equal(motionMod.clampStaggerIndex(-2), 0);
  assert.equal(motionMod.clampStaggerIndex(0), 0);
  assert.equal(motionMod.clampStaggerIndex(3.8), 3);
  assert.equal(motionMod.clampStaggerIndex(8, 5), 5);
  assert.equal(motionMod.clampStaggerIndex(Number.NaN), 0);
});

test("resolveNetDirection resolves forward/backward across day indices and ISO dates", () => {
  const motionMod = loadTsModule(path.resolve(__dirname, "../lib/motion.ts"));

  assert.equal(motionMod.resolveNetDirection(0, 3), 1);
  assert.equal(motionMod.resolveNetDirection(4, 1), -1);
  assert.equal(motionMod.resolveNetDirection(2, 2), 0);

  assert.equal(motionMod.resolveNetDirection("2026-11-18", "2026-11-20"), 1);
  assert.equal(motionMod.resolveNetDirection("2026-11-20", "2026-11-17"), -1);
  assert.equal(motionMod.resolveNetDirection("2026-11-18", "2026-11-18"), 0);
  assert.equal(motionMod.resolveNetDirection(null, "2026-11-18"), 0);
});

test("motion curve constants match calm non-overshooting desktop-panel standard", () => {
  const motionMod = loadTsModule(path.resolve(__dirname, "../lib/motion.ts"));

  assert.deepEqual([...motionMod.EASE_SMOOTH], [0.22, 1, 0.36, 1]);
  assert.deepEqual([...motionMod.EASE_EXIT], [0.32, 0, 0.24, 1]);
  assert.equal(motionMod.DURATION_FAST, 0.15);
  assert.equal(motionMod.DURATION_BASE, 0.24);
  assert.equal(motionMod.DURATION_PANEL, 0.34);
  assert.equal(motionMod.DURATION_SHELL, 0.46);
});

test("computeMobileSwipeEntryOffset produces continuous directional handoff offsets", () => {
  const motionMod = loadTsModule(path.resolve(__dirname, "../lib/motion.ts"));

  assert.equal(motionMod.computeMobileSwipeEntryOffset(0, -40), 0);
  assert.equal(motionMod.computeMobileSwipeEntryOffset(1, 0), 22);
  assert.equal(motionMod.computeMobileSwipeEntryOffset(-1, 0), -22);

  const forwardFromDrag = motionMod.computeMobileSwipeEntryOffset(1, -50);
  const forwardFromDeepDrag = motionMod.computeMobileSwipeEntryOffset(1, -110);
  assert.ok(forwardFromDrag >= 28 && forwardFromDrag <= 72);
  assert.ok(forwardFromDrag > forwardFromDeepDrag);

  const backwardFromDrag = motionMod.computeMobileSwipeEntryOffset(-1, 50);
  assert.ok(backwardFromDrag <= -28 && backwardFromDrag >= -72);
});
