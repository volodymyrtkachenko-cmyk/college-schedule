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
    Response,
    ReadableStream,
    TextEncoder,
    DOMException,
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

function createControlledTimers() {
  const entries = new Map();
  let nextId = 1;
  return {
    setTimeoutFn(fn, ms) {
      const id = nextId++;
      entries.set(id, { id, fn, ms, cleared: false });
      return id;
    },
    clearTimeoutFn(id) {
      if (id == null) return;
      entries.delete(id);
    },
    triggerLatest() {
      const ids = [...entries.keys()];
      if (ids.length === 0) throw new Error("No active timeout to trigger");
      const lastId = ids[ids.length - 1];
      const entry = entries.get(lastId);
      entries.delete(lastId);
      entry.fn();
    },
    get activeCount() {
      return entries.size;
    },
  };
}

function spyExternalSignal(controller) {
  const added = [];
  const removed = [];
  const origAdd = controller.signal.addEventListener.bind(controller.signal);
  const origRemove = controller.signal.removeEventListener.bind(controller.signal);
  controller.signal.addEventListener = (type, listener, opts) => {
    if (type === "abort") added.push(listener);
    return origAdd(type, listener, opts);
  };
  controller.signal.removeEventListener = (type, listener, opts) => {
    if (type === "abort") removed.push(listener);
    return origRemove(type, listener, opts);
  };
  return { added, removed };
}

function makeStreamingResponse(
  fetchSignal,
  {
    status = 200,
    headers = { "Content-Type": "application/json" },
    initialChunk = '{"ok":',
    cleanups,
  } = {}
) {
  let streamCtrl = null;
  let abortedViaFetchSignal = false;
  let headersDeliveredResolve;
  const headersDelivered = new Promise((r) => {
    headersDeliveredResolve = r;
  });

  const stream = new ReadableStream({
    start(ctrl) {
      streamCtrl = ctrl;
      if (initialChunk !== null) {
        ctrl.enqueue(new TextEncoder().encode(initialChunk));
      }
      if (fetchSignal && typeof fetchSignal.addEventListener === "function") {
        fetchSignal.addEventListener(
          "abort",
          () => {
            abortedViaFetchSignal = true;
            try {
              ctrl.error(new DOMException("Aborted", "AbortError"));
            } catch {}
          },
          { once: true }
        );
      }
      headersDeliveredResolve();
    },
  });

  const finish = (restText) => {
    if (restText != null) {
      streamCtrl.enqueue(new TextEncoder().encode(restText));
    }
    streamCtrl.close();
  };
  const cleanup = () => {
    try {
      streamCtrl?.close();
    } catch {}
  };
  if (cleanups) cleanups.push(cleanup);

  return {
    response: new Response(stream, { status, headers }),
    headersDelivered,
    finish,
    cleanup,
    wasAbortedViaFetchSignal: () => abortedViaFetchSignal,
  };
}

test("streamed 200 body hanging after headers is cancelled by internal timeout (with and without external signal)", async () => {
  for (const useExternalSignal of [true, false]) {
    const timers = createControlledTimers();
    const cleanups = [];
    let streamHandle = null;

    const { clientMod } = loadClientHarness({
      timers,
      fetchImpl: async (_url, init = {}) => {
        streamHandle = makeStreamingResponse(init.signal, { cleanups });
        return streamHandle.response;
      },
    });

    const external = new AbortController();
    const spy = useExternalSignal ? spyExternalSignal(external) : null;

    try {
      const reqPromise = clientMod.rawRequest("/api/stream-hang", {
        timeoutMs: 25,
        ...(useExternalSignal ? { signal: external.signal } : {}),
      });

      await streamHandle.headersDelivered;
      await Promise.resolve();

      // After headers arrive, body is still pending so timer + external listener MUST remain active
      assert.equal(timers.activeCount, 1);
      if (spy) {
        assert.equal(spy.added.length, 1);
        assert.equal(spy.removed.length, 0);
      }

      // Causal trigger of internal deadline
      timers.triggerLatest();

      await assert.rejects(
        () => reqPromise,
        (err) => err && err.constructor?.name === "ApiError" && err.status === 0
      );
      assert.equal(streamHandle.wasAbortedViaFetchSignal(), true);
      assert.equal(timers.activeCount, 0);
      if (spy) {
        assert.equal(spy.removed.length, 1);
        assert.equal(external.signal.aborted, false);
      }
    } finally {
      cleanups.forEach((fn) => fn());
    }
  }
});

test("external AbortController aborts hanging streamed body before deadline and reaches fetch signal", async () => {
  const timers = createControlledTimers();
  const cleanups = [];
  let streamHandle = null;

  const { clientMod } = loadClientHarness({
    timers,
    fetchImpl: async (_url, init = {}) => {
      streamHandle = makeStreamingResponse(init.signal, { cleanups });
      return streamHandle.response;
    },
  });

  const external = new AbortController();
  const spy = spyExternalSignal(external);

  try {
    const reqPromise = clientMod.rawRequest("/api/stream-ext-abort", {
      signal: external.signal,
      timeoutMs: 60_000,
    });

    await streamHandle.headersDelivered;
    await Promise.resolve();
    assert.equal(timers.activeCount, 1);
    assert.equal(spy.removed.length, 0);

    external.abort();

    await assert.rejects(
      () => reqPromise,
      (err) => err && err.constructor?.name === "ApiError" && err.status === 0
    );
    assert.equal(streamHandle.wasAbortedViaFetchSignal(), true);
    assert.equal(timers.activeCount, 0);
    assert.equal(spy.removed.length, 1);
  } finally {
    cleanups.forEach((fn) => fn());
  }
});

test("streamed body finishing before deadline parses JSON and cleans up timer and listener ONLY after body finishes", async () => {
  const timers = createControlledTimers();
  const cleanups = [];
  let streamHandle = null;

  const { clientMod } = loadClientHarness({
    timers,
    fetchImpl: async (_url, init = {}) => {
      streamHandle = makeStreamingResponse(init.signal, {
        initialChunk: '{"value":',
        cleanups,
      });
      return streamHandle.response;
    },
  });

  const external = new AbortController();
  const spy = spyExternalSignal(external);

  try {
    const reqPromise = clientMod.rawRequest("/api/stream-complete", {
      signal: external.signal,
      timeoutMs: 60_000,
    });

    await streamHandle.headersDelivered;
    await new Promise((r) => setTimeout(r, 10));

    // Must still be armed while headers arrived and body is mid-stream
    assert.equal(timers.activeCount, 1, "timeout must stay armed while reading body");
    assert.equal(spy.added.length, 1);
    assert.equal(spy.removed.length, 0, "external abort listener must remain attached until body finishes");

    streamHandle.finish("42}");
    const data = await reqPromise;

    assert.deepEqual(data, { value: 42 });
    assert.equal(timers.activeCount, 0, "timeout cleared once body finishes");
    assert.equal(spy.removed.length, 1, "listener removed once body finishes");
    assert.equal(spy.removed[0], spy.added[0]);
  } finally {
    cleanups.forEach((fn) => fn());
  }
});

test("hanging 4xx/5xx error body respects timeout/abort while fast HTTP errors keep exact status and message", async () => {
  const cleanups = [];
  try {
    // Part A: Hanging 500 error body is aborted by deadline without hanging indefinitely
    {
      const timers = createControlledTimers();
      let streamHandle = null;
      const { clientMod } = loadClientHarness({
        timers,
        fetchImpl: async (_url, init = {}) => {
          streamHandle = makeStreamingResponse(init.signal, {
            status: 500,
            initialChunk: '{"detail":',
            cleanups,
          });
          return streamHandle.response;
        },
      });

      const external = new AbortController();
      const spy = spyExternalSignal(external);
      const reqPromise = clientMod.rawRequest("/api/error-stream-hang", {
        signal: external.signal,
        timeoutMs: 25,
      });

      await streamHandle.headersDelivered;
      await Promise.resolve();
      assert.equal(timers.activeCount, 1);

      timers.triggerLatest();
      await assert.rejects(
        () => reqPromise,
        (err) => err && err.constructor?.name === "ApiError" && err.status === 0
      );
      assert.equal(streamHandle.wasAbortedViaFetchSignal(), true);
      assert.equal(timers.activeCount, 0);
      assert.equal(spy.removed.length, 1);
    }

    // Part B: Fast 401, 403, 404, 500 preserve status codes and Ukrainian error messages
    for (const [status, detail, expectedMessage] of [
      [401, "Invalid or expired token", "Термін дії сеансу завершився. Увійдіть знову."],
      [403, "Недостатньо прав", "Недостатньо прав"],
      [404, "Версію розкладу не знайдено.", "Версію розкладу не знайдено."],
      [500, "Internal trace leaked", "Сталася помилка на сервері. Спробуйте ще раз пізніше."],
    ]) {
      const timers = createControlledTimers();
      const { clientMod } = loadClientHarness({
        timers,
        fetchImpl: async () =>
          new Response(JSON.stringify({ detail }), {
            status,
            headers: { "Content-Type": "application/json" },
          }),
      });
      const external = new AbortController();
      const spy = spyExternalSignal(external);

      await assert.rejects(
        () => clientMod.rawRequest(`/api/err-${status}`, { signal: external.signal, timeoutMs: 5000 }),
        (err) =>
          err &&
          err.constructor?.name === "ApiError" &&
          err.status === status &&
          err.message === expectedMessage
      );
      assert.equal(timers.activeCount, 0);
      assert.equal(spy.removed.length, 1);
    }
  } finally {
    cleanups.forEach((fn) => fn());
  }
});

test("invalid JSON, 204 No Content, and 304 Not Modified always clean up timers and external signal listeners", async () => {
  // Invalid JSON on 200
  {
    const timers = createControlledTimers();
    const { clientMod } = loadClientHarness({
      timers,
      fetchImpl: async () =>
        new Response("{not-valid-json", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    });
    const external = new AbortController();
    const spy = spyExternalSignal(external);

    await assert.rejects(
      () => clientMod.rawRequest("/api/bad-json", { signal: external.signal, timeoutMs: 5000 }),
      (err) => err instanceof SyntaxError
    );
    assert.equal(timers.activeCount, 0);
    assert.equal(spy.removed.length, 1);
  }

  // 204 No Content
  {
    const timers = createControlledTimers();
    const { clientMod } = loadClientHarness({
      timers,
      fetchImpl: async () => new Response(null, { status: 204 }),
    });
    const external = new AbortController();
    const spy = spyExternalSignal(external);

    const res = await clientMod.rawRequest("/api/empty-204", {
      method: "DELETE",
      signal: external.signal,
      timeoutMs: 5000,
    });
    assert.equal(res, undefined);
    assert.equal(timers.activeCount, 0);
    assert.equal(spy.removed.length, 1);
  }

  // 304 Not Modified after cached ETag
  {
    const timers = createControlledTimers();
    let call = 0;
    const { clientMod } = loadClientHarness({
      timers,
      fetchImpl: async (_url, init = {}) => {
        call += 1;
        if (call === 1) {
          return new Response(JSON.stringify({ cached: "ok" }), {
            status: 200,
            headers: { "Content-Type": "application/json", ETag: 'W/"ok-1"' },
          });
        }
        const ifNoneMatch = new Headers(init.headers).get("If-None-Match");
        assert.equal(ifNoneMatch, 'W/"ok-1"');
        return new Response(null, {
          status: 304,
          headers: { ETag: 'W/"ok-1"' },
        });
      },
    });

    const ext1 = new AbortController();
    const spy1 = spyExternalSignal(ext1);
    const first = await clientMod.rawRequest("/api/etag-304", { signal: ext1.signal });
    assert.deepEqual(first, { cached: "ok" });
    assert.equal(timers.activeCount, 0);
    assert.equal(spy1.removed.length, 1);

    const ext2 = new AbortController();
    const spy2 = spyExternalSignal(ext2);
    const second = await clientMod.rawRequest("/api/etag-304", { signal: ext2.signal });
    assert.deepEqual(second, { cached: "ok" });
    assert.equal(timers.activeCount, 0);
    assert.equal(spy2.removed.length, 1);
  }
});

test("aborted streamed 200 response never pollutes ETag cache and subsequent request succeeds", async () => {
  const timers = createControlledTimers();
  const cleanups = [];
  const seenIfNoneMatch = [];
  let streamHandle = null;
  let attempt = 0;

  const { clientMod } = loadClientHarness({
    timers,
    fetchImpl: async (_url, init = {}) => {
      attempt += 1;
      seenIfNoneMatch.push(new Headers(init.headers).get("If-None-Match"));
      if (attempt === 1) {
        streamHandle = makeStreamingResponse(init.signal, {
          status: 200,
          headers: { "Content-Type": "application/json", ETag: 'W/"aborted-etag"' },
          initialChunk: '{"stale":',
          cleanups,
        });
        return streamHandle.response;
      }
      return new Response(JSON.stringify({ fresh: true }), {
        status: 200,
        headers: { "Content-Type": "application/json", ETag: 'W/"fresh-etag"' },
      });
    },
  });

  try {
    const ext1 = new AbortController();
    const p1 = clientMod.rawRequest("/api/stream-etag-test", { signal: ext1.signal, timeoutMs: 25 });
    await streamHandle.headersDelivered;
    await Promise.resolve();
    timers.triggerLatest();

    await assert.rejects(
      () => p1,
      (err) => err && err.constructor?.name === "ApiError" && err.status === 0
    );

    const ext2 = new AbortController();
    const okData = await clientMod.rawRequest("/api/stream-etag-test", { signal: ext2.signal, timeoutMs: 5000 });
    assert.deepEqual(okData, { fresh: true });
    assert.deepEqual(seenIfNoneMatch, [null, null], "aborted response must never store ETag in cache");
    assert.equal(timers.activeCount, 0);
  } finally {
    cleanups.forEach((fn) => fn());
  }
});
