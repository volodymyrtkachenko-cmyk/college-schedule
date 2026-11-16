const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadTsModule } = require("./helpers/load-ts-module.cjs");

const undoMod = loadTsModule(path.join(__dirname, "../lib/admin/scheduleUndo.ts"));
const slotMod = loadTsModule(path.join(__dirname, "../lib/admin/slotTime.ts"));

const toPlain = (v) => JSON.parse(JSON.stringify(v));

test("pushUndoAction caps history at limit and popUndoAction pops LIFO", () => {
  let stack = [];
  for (let i = 1; i <= 20; i++) {
    stack = undoMod.pushUndoAction(stack, {
      kind: "cancel",
      label: `action-${i}`,
      groupId: 1,
      date: "2026-11-16",
      lessonNumber: (i % 4) + 1,
    });
  }
  assert.equal(stack.length, undoMod.MAX_ADMIN_UNDO_STACK);
  assert.equal(stack[0].label, "action-6");
  assert.equal(stack[stack.length - 1].label, "action-20");

  const { action, rest } = undoMod.popUndoAction(stack);
  assert.equal(action.label, "action-20");
  assert.equal(rest.length, undoMod.MAX_ADMIN_UNDO_STACK - 1);
});

test("reverseBatchMoveItems swaps source and target cleanly", () => {
  const reversed = undoMod.reverseBatchMoveItems([
    {
      source_group_id: 5,
      source_date: "2026-11-16",
      source_lesson_number: 2,
      target_group_id: 5,
      target_date: "2026-11-17",
      target_lesson_number: 3,
    },
  ]);
  assert.deepEqual(toPlain(reversed), [
    {
      source_group_id: 5,
      source_date: "2026-11-17",
      source_lesson_number: 3,
      target_group_id: 5,
      target_date: "2026-11-16",
      target_lesson_number: 2,
    },
  ]);
});

test("isAdminUndoShortcut supports Latin, Cmd/Ctrl, and Cyrillic KeyZ while ignoring form fields", () => {
  assert.equal(undoMod.isAdminUndoShortcut({ ctrlKey: true, key: "z", code: "KeyZ" }), true);
  assert.equal(undoMod.isAdminUndoShortcut({ metaKey: true, key: "я", code: "KeyZ" }), true);
  assert.equal(undoMod.isAdminUndoShortcut({ ctrlKey: true, shiftKey: true, key: "z", code: "KeyZ" }), false);
  assert.equal(undoMod.isAdminUndoShortcut({ ctrlKey: true, altKey: true, key: "z", code: "KeyZ" }), false);
  assert.equal(
    undoMod.isAdminUndoShortcut({ ctrlKey: true, key: "z", code: "KeyZ", target: { tagName: "INPUT" } }),
    false
  );
  assert.equal(
    undoMod.isAdminUndoShortcut({
      ctrlKey: true,
      key: "z",
      code: "KeyZ",
      target: { tagName: "DIV", isContentEditable: true },
    }),
    false
  );
});

test("isSlotInPast respects Kyiv time and shortened 50-min bells", () => {
  // 2026-11-16 10:05 Europe/Kyiv = 08:05 UTC (EET UTC+2)
  const at1005Kyiv = new Date("2026-11-16T08:05:00Z");

  // 1st lesson ends at 10:20 on regular day (not yet past), 09:50 on shortened day (past!)
  assert.equal(slotMod.isSlotInPast("2026-11-16", 1, false, at1005Kyiv), false);
  assert.equal(slotMod.isSlotInPast("2026-11-16", 1, true, at1005Kyiv), true);

  // 2nd lesson ends at 12:00 regular, 10:50 shortened -> neither is past at 10:05
  assert.equal(slotMod.isSlotInPast("2026-11-16", 2, false, at1005Kyiv), false);
  assert.equal(slotMod.isSlotInPast("2026-11-16", 2, true, at1005Kyiv), false);

  // Yesterday is always past; tomorrow is never past
  assert.equal(slotMod.isSlotInPast("2026-11-15", 1, false, at1005Kyiv), true);
  assert.equal(slotMod.isSlotInPast("2026-11-17", 1, true, at1005Kyiv), false);
});
