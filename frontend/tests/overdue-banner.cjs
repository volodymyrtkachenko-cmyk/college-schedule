const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadTsModule } = require("./helpers/load-ts-module.cjs");

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

function setupOverdueModule(initialStorage = {}) {
  const events = [];
  const localStorage = createMemoryStorage(initialStorage);
  const windowObj = {
    localStorage,
    dispatchEvent(evt) {
      events.push(evt?.type || String(evt));
    },
  };
  const mod = loadTsModule(path.join(__dirname, "../lib/schedule/overdueBanner.ts"), {
    window: windowObj,
    localStorage,
    Event: function FakeEvent(type) {
      return { type };
    },
  });
  return { mod, localStorage, events };
}

test("formatOverdueBannerMessage applies exact Ukrainian adjective and noun declension", () => {
  const { mod } = setupOverdueModule();

  assert.equal(mod.formatOverdueBannerMessage(0), "У вас 0 прострочених завдань");
  assert.equal(mod.formatOverdueBannerMessage(1), "У вас 1 прострочене завдання");
  assert.equal(mod.formatOverdueBannerMessage(2), "У вас 2 прострочені завдання");
  assert.equal(mod.formatOverdueBannerMessage(3), "У вас 3 прострочені завдання");
  assert.equal(mod.formatOverdueBannerMessage(4), "У вас 4 прострочені завдання");
  assert.equal(mod.formatOverdueBannerMessage(5), "У вас 5 прострочених завдань");
  assert.equal(mod.formatOverdueBannerMessage(10), "У вас 10 прострочених завдань");
  assert.equal(mod.formatOverdueBannerMessage(11), "У вас 11 прострочених завдань");
  assert.equal(mod.formatOverdueBannerMessage(12), "У вас 12 прострочених завдань");
  assert.equal(mod.formatOverdueBannerMessage(14), "У вас 14 прострочених завдань");
  assert.equal(mod.formatOverdueBannerMessage(21), "У вас 21 прострочене завдання");
  assert.equal(mod.formatOverdueBannerMessage(22), "У вас 22 прострочені завдання");
  assert.equal(mod.formatOverdueBannerMessage(25), "У вас 25 прострочених завдань");
  assert.equal(mod.formatOverdueBannerMessage(101), "У вас 101 прострочене завдання");
  assert.equal(mod.formatOverdueBannerMessage(111), "У вас 111 прострочених завдань");
});

test("formatOverduePriorityPreview highlights oldest overdue task across multiple items", () => {
  const { mod } = setupOverdueModule();

  assert.equal(mod.formatOverduePriorityPreview([]), null);

  assert.equal(
    mod.formatOverduePriorityPreview([
      {
        title: "Лабораторна №1",
        subject: "Вища математика (1 підгрупа)",
        deadline: { overdueDays: 1, formattedDate: "15 лист." },
      },
    ]),
    "Вища математика · прострочено 1 день"
  );

  assert.equal(
    mod.formatOverduePriorityPreview([
      {
        title: "Тест 1",
        subject: "Англійська мова",
        dueDateIso: "2026-11-15",
        deadline: { overdueDays: 1, formattedDate: "15 лист." },
      },
      {
        title: "Конспект",
        subject: "Основи правознавства",
        dueDateIso: "2026-11-12",
        deadline: { overdueDays: 4, formattedDate: "12 лист." },
      },
    ]),
    "Найдавніше: Основи правознавства · прострочено 4 дні"
  );
});

test("dismissal snoozes until tomorrow, resets on unseen overdue task or group change, and never nags when count drops", () => {
  const { mod, events } = setupOverdueModule();

  const tasks = [
    { url: "https://classroom.google.com/c/MTEx/a/MjIy/details", title: "Task 1", subject: "Math" },
    { url: "https://classroom.google.com/c/MTEx/a/MzMz/details", title: "Task 2", subject: "Physics" },
  ];
  const keys = mod.collectOverdueTaskKeys(tasks);
  assert.equal(keys.length, 2);

  // Never shown when unlinked or empty
  assert.equal(
    mod.shouldShowOverdueBanner({
      isLinked: false,
      overdueTaskKeys: keys,
      dismissal: null,
      todayKyivIso: "2026-11-16",
      scopeKey: "g:75",
    }),
    false
  );
  assert.equal(
    mod.shouldShowOverdueBanner({
      isLinked: true,
      overdueTaskKeys: [],
      dismissal: null,
      todayKyivIso: "2026-11-16",
      scopeKey: "g:75",
    }),
    false
  );

  // Visible before dismissal
  assert.equal(
    mod.shouldShowOverdueBanner({
      isLinked: true,
      overdueTaskKeys: keys,
      dismissal: null,
      todayKyivIso: "2026-11-16",
      scopeKey: "g:75",
    }),
    true
  );

  // User clicks close today
  const saved = mod.saveOverdueBannerDismissal({
    overdueTaskKeys: keys,
    todayKyivIso: "2026-11-16",
    scopeKey: "g:75",
  });
  assert.equal(events.includes(mod.OVERDUE_BANNER_SYNC_EVENT), true);
  assert.deepEqual(mod.readOverdueBannerDismissal(), saved);

  // Stays hidden same Kyiv day with same overdue tasks
  assert.equal(
    mod.shouldShowOverdueBanner({
      isLinked: true,
      overdueTaskKeys: keys,
      dismissal: saved,
      todayKyivIso: "2026-11-16",
      scopeKey: "g:75",
    }),
    false
  );

  // Stays hidden same day if user submitted one task and only subset remains
  assert.equal(
    mod.shouldShowOverdueBanner({
      isLinked: true,
      overdueTaskKeys: [keys[0]],
      dismissal: saved,
      todayKyivIso: "2026-11-16",
      scopeKey: "g:75",
    }),
    false
  );

  // Reappears immediately same day when a brand-new overdue task appears
  const withNewDebt = mod.collectOverdueTaskKeys([
    tasks[0],
    { url: "https://classroom.google.com/c/MTEx/a/NDQ0/details", title: "Task 3", subject: "CS" },
  ]);
  assert.equal(
    mod.shouldShowOverdueBanner({
      isLinked: true,
      overdueTaskKeys: withNewDebt,
      dismissal: saved,
      todayKyivIso: "2026-11-16",
      scopeKey: "g:75",
    }),
    true
  );

  // Reappears automatically next Kyiv calendar day even with same task list
  assert.equal(
    mod.shouldShowOverdueBanner({
      isLinked: true,
      overdueTaskKeys: keys,
      dismissal: saved,
      todayKyivIso: "2026-11-17",
      scopeKey: "g:75",
    }),
    true
  );

  // Reappears when user switches group scope
  assert.equal(
    mod.shouldShowOverdueBanner({
      isLinked: true,
      overdueTaskKeys: keys,
      dismissal: saved,
      todayKyivIso: "2026-11-16",
      scopeKey: "g:76",
    }),
    true
  );

  // Malformed storage safely degrades to null
  assert.equal(mod.parseOverdueBannerDismissal("{bad-json"), null);
  assert.equal(mod.parseOverdueBannerDismissal(JSON.stringify({ dismissedAtIso: "bad", taskIds: [] })), null);
});

test("performing Classroom unlink clears saved overdue banner dismissal", async () => {
  const localStorage = createMemoryStorage({
    "schedule:classroom_linked_email": "student@example.test",
    "schedule:classroom_linked_group_id": "75",
    "schedule:overdue_banner_dismissal": JSON.stringify({
      dismissedAtIso: "2026-11-16",
      taskIds: ["MTEx_MjIy"],
      scopeKey: "g:75",
    }),
  });
  const unlinkMod = loadTsModule(path.join(__dirname, "../lib/classroomUnlink.ts"), {
    window: {
      localStorage,
      dispatchEvent() {},
    },
    localStorage,
    navigator: { onLine: true },
    Event: function FakeEvent(type) {
      return { type };
    },
  });

  const res = await unlinkMod.performClassroomUnlink();
  assert.equal(res.ok, true);
  assert.equal(localStorage.getItem("schedule:overdue_banner_dismissal"), null);
});
