const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadTsModule } = require("./helpers/load-ts-module.cjs");

function createMemoryStorage() {
  const store = new Map();
  return {
    getItem(k) {
      return store.has(k) ? store.get(k) : null;
    },
    setItem(k, v) {
      store.set(k, String(v));
    },
    removeItem(k) {
      store.delete(k);
    },
    clear() {
      store.clear();
    },
  };
}

function createTimerTracker() {
  const active = new Map();
  let nextId = 1;
  let totalScheduled = 0;
  let totalCleared = 0;

  return {
    setTimeoutFn(fn, ms) {
      const token = nextId++;
      totalScheduled += 1;
      const realId = global.setTimeout(() => {
        active.delete(token);
        fn();
      }, ms);
      active.set(token, realId);
      return token;
    },
    clearTimeoutFn(token) {
      if (token == null) return;
      if (active.has(token)) {
        totalCleared += 1;
        global.clearTimeout(active.get(token));
        active.delete(token);
      }
    },
    get activeCount() {
      return active.size;
    },
    get totalScheduled() {
      return totalScheduled;
    },
    get totalCleared() {
      return totalCleared;
    },
  };
}

function loadClientHarness({ fetchImpl, timers }) {
  const storage = createMemoryStorage();
  const windowObj = { localStorage: storage, location: { origin: "http://localhost:3000" } };
  const globals = {
    window: windowObj,
    localStorage: storage,
    fetch: fetchImpl,
    ...(timers
      ? {
          setTimeout: timers.setTimeoutFn,
          clearTimeout: timers.clearTimeoutFn,
        }
      : {}),
  };

  const clientMod = loadTsModule(path.join(__dirname, "../lib/api/client.ts"), globals);
  const apiIndexMod = loadTsModule(path.join(__dirname, "../lib/api.ts"), globals);
  return { clientMod, apiIndexMod, storage };
}

test("rawRequest enforces timeoutMs even when an external AbortSignal is provided", async () => {
  const timers = createTimerTracker();
  let seenFetchSignal = null;
  let sawSignalAbort = false;

  const { clientMod } = loadClientHarness({
    timers,
    fetchImpl: (_url, init = {}) =>
      new Promise((_resolve, reject) => {
        seenFetchSignal = init.signal;
        init.signal?.addEventListener(
          "abort",
          () => {
            sawSignalAbort = true;
            const err = new Error("Aborted");
            err.name = "AbortError";
            reject(err);
          },
          { once: true }
        );
      }),
  });

  const external = new AbortController();
  const startedAt = Date.now();
  await assert.rejects(
    () =>
      clientMod.rawRequest("/api/schedule/week?group_id=1", {
        signal: external.signal,
        timeoutMs: 25,
      }),
    (err) => err && err.constructor?.name === "ApiError" && err.status === 0
  );
  const elapsed = Date.now() - startedAt;

  assert.ok(seenFetchSignal, "fetch should receive combined internal signal");
  assert.equal(seenFetchSignal.aborted, true);
  assert.equal(sawSignalAbort, true);
  assert.equal(external.signal.aborted, false, "external signal must not be mutated");
  assert.ok(elapsed < 1000, `expected timeout within ~25ms, took ${elapsed}ms`);
  assert.equal(timers.activeCount, 0, "timeout timer must be cleared after completion");
});

test("rawRequest aborts early when external AbortController fires before timeoutMs", async () => {
  const timers = createTimerTracker();
  let sawSignalAbort = false;

  const { clientMod } = loadClientHarness({
    timers,
    fetchImpl: (_url, init = {}) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener(
          "abort",
          () => {
            sawSignalAbort = true;
            const err = new Error("Aborted");
            err.name = "AbortError";
            reject(err);
          },
          { once: true }
        );
      }),
  });

  const external = new AbortController();
  const startedAt = Date.now();
  global.setTimeout(() => external.abort(), 10);

  await assert.rejects(
    () =>
      clientMod.rawRequest("/api/schedule/week?group_id=1", {
        signal: external.signal,
        timeoutMs: 5000,
      }),
    (err) => err && err.constructor?.name === "ApiError" && err.status === 0
  );
  const elapsed = Date.now() - startedAt;

  assert.equal(sawSignalAbort, true);
  assert.ok(elapsed < 500, `expected early abort well before 5000ms timeout, took ${elapsed}ms`);
  assert.equal(timers.totalScheduled, 1);
  assert.equal(timers.activeCount, 0, "5000ms timer must be cleared on external abort");
});

test("rawRequest rejects immediately on pre-aborted external signal without leaking timers", async () => {
  const timers = createTimerTracker();
  let fetchCalls = 0;

  const { clientMod } = loadClientHarness({
    timers,
    fetchImpl: async () => {
      fetchCalls += 1;
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => [],
      };
    },
  });

  const external = new AbortController();
  external.abort();

  const startedAt = Date.now();
  await assert.rejects(
    () =>
      clientMod.rawRequest("/api/schedule/week?group_id=1", {
        signal: external.signal,
        timeoutMs: 5000,
      }),
    (err) => err && err.constructor?.name === "ApiError" && err.status === 0
  );
  const elapsed = Date.now() - startedAt;

  assert.equal(fetchCalls, 0, "pre-aborted request must short-circuit before calling fetch");
  assert.ok(elapsed < 50, `pre-aborted request took unexpected ${elapsed}ms`);
  assert.equal(timers.activeCount, 0, "no timer may leak on pre-aborted signal");
});

test("rawRequest removes abort listener from external signal after normal 200 response", async () => {
  const timers = createTimerTracker();
  const { clientMod } = loadClientHarness({
    timers,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ ok: true }),
    }),
  });

  const external = new AbortController();
  const added = [];
  const removed = [];
  const origAdd = external.signal.addEventListener.bind(external.signal);
  const origRemove = external.signal.removeEventListener.bind(external.signal);
  external.signal.addEventListener = (type, listener, opts) => {
    if (type === "abort") added.push(listener);
    return origAdd(type, listener, opts);
  };
  external.signal.removeEventListener = (type, listener, opts) => {
    if (type === "abort") removed.push(listener);
    return origRemove(type, listener, opts);
  };

  const payload = await clientMod.rawRequest("/api/health", {
    signal: external.signal,
    timeoutMs: 2000,
  });

  assert.equal(payload.ok, true);
  assert.equal(added.length, 1);
  assert.equal(removed.length, 1);
  assert.equal(removed[0], added[0], "exact abort listener must be removed in finally");
  assert.equal(timers.activeCount, 0);
});

test("api.week honors external abort on superseded navigation and succeeds cleanly on subsequent retry", async () => {
  const timers = createTimerTracker();
  let callIndex = 0;

  const { apiIndexMod } = loadClientHarness({
    timers,
    fetchImpl: (_url, init = {}) => {
      const current = ++callIndex;
      if (current === 1) {
        // First slow request aborted by newer navigation controller
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener(
            "abort",
            () => {
              const err = new Error("Aborted");
              err.name = "AbortError";
              reject(err);
            },
            { once: true }
          );
        });
      }
      if (current === 2) {
        // Simulated transient server failure before retry
        return Promise.resolve({
          ok: false,
          status: 503,
          headers: new Headers(),
          json: async () => ({ detail: "Temporarily unavailable" }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => [{ date: "2026-11-16", week_type: "numerator", lessons: [] }],
      });
    },
  });

  const weekAnchor = new Date("2026-11-16T10:00:00Z");

  const c1 = new AbortController();
  const p1 = apiIndexMod.api.week(1, undefined, weekAnchor, false, c1.signal);
  c1.abort();
  await assert.rejects(
    () => p1,
    (err) => err instanceof apiIndexMod.ApiError && err.status === 0
  );

  const c2 = new AbortController();
  await assert.rejects(
    () => apiIndexMod.api.week(1, undefined, weekAnchor, false, c2.signal),
    (err) => err instanceof apiIndexMod.ApiError && err.status === 503
  );

  const c3 = new AbortController();
  const retryData = await apiIndexMod.api.week(1, undefined, weekAnchor, false, c3.signal);
  assert.equal(Array.isArray(retryData), true);
  assert.equal(retryData.length, 1);
  assert.equal(retryData[0].date, "2026-11-16");
  assert.equal(timers.activeCount, 0);
});
