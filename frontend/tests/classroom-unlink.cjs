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
    _dump() {
      return Object.fromEntries(store.entries());
    },
  };
}

function createFakeEvent(type) {
  return { type };
}

function setupUnlinkModule({ fetch, initialStorage = {}, onLine = true } = {}) {
  const events = [];
  const localStorage = createMemoryStorage(initialStorage);
  const windowObj = {
    localStorage,
    dispatchEvent(evt) {
      events.push(evt?.type || String(evt));
    },
  };
  const navigatorObj = { onLine };
  const mod = loadTsModule(path.join(__dirname, "../lib/classroomUnlink.ts"), {
    window: windowObj,
    localStorage,
    navigator: navigatorObj,
    fetch,
    Event: createFakeEvent,
  });
  return { mod, localStorage, events, navigatorObj };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise((r) => setImmediate(r));

test("503 failure keeps local identity and private cache intact and exposes retryable error", async () => {
  const calls = [];
  const { mod, localStorage, events } = setupUnlinkModule({
    initialStorage: {
      "schedule:classroom_linked_email": "student@example.test",
      "schedule:classroom_google_user_id": "fake-uid-123",
      "schedule:classroom_linked_group_id": "85",
      "schedule:classroom_submitted_tasks": JSON.stringify({ t1: { state: "TURNED_IN" } }),
      schedule_selected_subgroup: "1",
    },
    fetch: async (url, init) => {
      calls.push({ url, init });
      return {
        ok: false,
        status: 503,
        json: async () => ({ detail: "Service temporarily unavailable" }),
      };
    },
  });

  let cachesCleared = false;
  const states = [];
  mod.subscribeClassroomUnlinkState(() => {
    states.push({ ...mod.getClassroomUnlinkState() });
  });

  const res = await mod.performClassroomUnlink({
    onClearCaches: () => {
      cachesCleared = true;
    },
  });

  assert.equal(res.ok, false);
  assert.equal(res.serverConfirmed, false);
  assert.ok(res.error && res.error.length > 0);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.endsWith("/api/classroom/disconnect"));
  assert.equal(cachesCleared, false);
  assert.equal(localStorage.getItem("schedule:classroom_linked_email"), "student@example.test");
  assert.equal(localStorage.getItem("schedule:classroom_google_user_id"), "fake-uid-123");
  assert.equal(events.length, 0);
  assert.equal(states[0].status, "pending");
  assert.equal(states[0].isUnlinking, true);
  assert.equal(states[states.length - 1].status, "error");
  assert.equal(states[states.length - 1].isUnlinking, false);
  assert.equal(mod.getClassroomUnlinkState().error, res.error);
});

test("offline network error preserves state and reports offline error message", async () => {
  const { mod, localStorage } = setupUnlinkModule({
    onLine: false,
    initialStorage: {
      "schedule:classroom_linked_email": "student@example.test",
      "schedule:classroom_google_user_id": "fake-uid-123",
    },
    fetch: async () => {
      throw new TypeError("Failed to fetch");
    },
  });

  const res = await mod.performClassroomUnlink();
  assert.equal(res.ok, false);
  assert.match(res.error, /Немає підключення до мережі/);
  assert.equal(localStorage.getItem("schedule:classroom_linked_email"), "student@example.test");
});

test("concurrent double-click shares one in-flight disconnect request and clears only on success", async () => {
  const d = deferred();
  let calls = 0;
  let cachesCleared = 0;
  const { mod, localStorage, events } = setupUnlinkModule({
    initialStorage: {
      "schedule:classroom_linked_email": "student@example.test",
      "schedule:classroom_google_user_id": "fake-uid-123",
      "schedule:classroom_linked_group_id": "85",
      "schedule:classroom_access_token": "tok-1",
    },
    fetch: async () => {
      calls += 1;
      return d.promise;
    },
  });

  const p1 = mod.performClassroomUnlink({ onClearCaches: () => { cachesCleared += 1; } });
  const p2 = mod.performClassroomUnlink({ onClearCaches: () => { cachesCleared += 1; } });
  await tick();

  assert.equal(calls, 1);
  assert.equal(mod.getClassroomUnlinkState().isUnlinking, true);

  d.resolve({
    ok: true,
    status: 200,
    json: async () => ({ status: "disconnected", deleted_credentials: 1, revoked: true }),
  });

  const [r1, r2] = await Promise.all([p1, p2]);
  assert.equal(r1.ok, true);
  assert.equal(r1.serverConfirmed, true);
  assert.equal(r2.ok, true);
  assert.equal(calls, 1);
  assert.equal(cachesCleared, 1);
  assert.equal(localStorage.getItem("schedule:classroom_linked_email"), null);
  assert.equal(localStorage.getItem("schedule:classroom_google_user_id"), null);
  assert.equal(localStorage.getItem("schedule:classroom_access_token"), null);
  assert.deepEqual(events, ["classroom-linked-change", "classroom-access-changed"]);
  assert.equal(mod.getClassroomUnlinkState().status, "success");
  assert.equal(mod.getClassroomUnlinkState().error, null);
});

test("retry succeeds after an initial 503 failure", async () => {
  let attempt = 0;
  const { mod, localStorage } = setupUnlinkModule({
    initialStorage: {
      "schedule:classroom_linked_email": "student@example.test",
      "schedule:classroom_google_user_id": "fake-uid-123",
      "schedule:classroom_linked_group_id": "85",
    },
    fetch: async () => {
      attempt += 1;
      if (attempt === 1) {
        return {
          ok: false,
          status: 503,
          json: async () => ({ detail: "Service Unavailable" }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: "disconnected", deleted_credentials: 1, revoked: false }),
      };
    },
  });

  const first = await mod.performClassroomUnlink();
  assert.equal(first.ok, false);
  assert.ok(mod.getClassroomUnlinkState().error);
  assert.equal(localStorage.getItem("schedule:classroom_google_user_id"), "fake-uid-123");

  const second = await mod.performClassroomUnlink();
  assert.equal(second.ok, true);
  assert.equal(second.serverConfirmed, true);
  assert.equal(attempt, 2);
  assert.equal(mod.getClassroomUnlinkState().error, null);
  assert.equal(localStorage.getItem("schedule:classroom_linked_email"), null);
});
