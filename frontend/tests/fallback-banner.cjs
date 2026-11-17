const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");
const { loadTsModule } = require("./helpers/load-ts-module.cjs");

function createMemoryStorage(seed = {}) {
  const store = new Map(Object.entries(seed).map(([k, v]) => [k, String(v)]));
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

function createWindowEventBus(localStorage, pathname = "/") {
  const listeners = new Map();
  class EventShim {
    constructor(type) {
      this.type = type;
    }
  }
  class CustomEventShim extends EventShim {
    constructor(type, init) {
      super(type);
      this.detail = init ? init.detail : undefined;
    }
  }
  const win = {
    localStorage,
    location: { origin: "http://localhost:3000", pathname },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    dispatchEvent(event) {
      const set = listeners.get(event.type);
      if (set) {
        for (const fn of [...set]) fn(event);
      }
      return true;
    },
  };
  return { win, EventShim, CustomEventShim };
}

function createReactHookHarness() {
  let cursor = 0;
  const slots = [];
  const pendingEffects = [];
  let dirty = false;

  const depsChanged = (prev, next) => {
    if (!prev || !next) return true;
    if (prev.length !== next.length) return true;
    for (let i = 0; i < prev.length; i++) {
      if (!Object.is(prev[i], next[i])) return true;
    }
    return false;
  };

  const reactMock = {
    useState(initial) {
      const idx = cursor++;
      if (!(idx in slots)) {
        slots[idx] = {
          kind: "state",
          value: typeof initial === "function" ? initial() : initial,
        };
      }
      const setter = (nextVal) => {
        const computed =
          typeof nextVal === "function" ? nextVal(slots[idx].value) : nextVal;
        if (!Object.is(slots[idx].value, computed)) {
          slots[idx].value = computed;
          dirty = true;
        }
      };
      return [slots[idx].value, setter];
    },
    useRef(initial) {
      const idx = cursor++;
      if (!(idx in slots)) {
        slots[idx] = { kind: "ref", box: { current: initial } };
      }
      return slots[idx].box;
    },
    useMemo(factory, deps) {
      const idx = cursor++;
      const slot = slots[idx];
      if (!slot || depsChanged(slot.deps, deps)) {
        slots[idx] = { kind: "memo", deps, value: factory() };
      }
      return slots[idx].value;
    },
    useCallback(fn, deps) {
      const idx = cursor++;
      const slot = slots[idx];
      if (!slot || depsChanged(slot.deps, deps)) {
        slots[idx] = { kind: "cb", deps, value: fn };
      }
      return slots[idx].value;
    },
    useEffect(fn, deps) {
      const idx = cursor++;
      const prev = slots[idx];
      if (!prev || depsChanged(prev.deps, deps)) {
        pendingEffects.push({ idx, fn, deps });
      }
    },
    useLayoutEffect(fn, deps) {
      return reactMock.useEffect(fn, deps);
    },
    createContext() {
      return {};
    },
    useContext() {
      return { user: null, loading: false, login: async () => null, logout: async () => {} };
    },
    useSyncExternalStore(_sub, getSnap) {
      return getSnap();
    },
  };

  function runSingleRender(hookFn) {
    cursor = 0;
    dirty = false;
    const out = hookFn();
    const toRun = pendingEffects.splice(0, pendingEffects.length);
    for (const eff of toRun) {
      const prevSlot = slots[eff.idx];
      if (prevSlot && typeof prevSlot.cleanup === "function") {
        prevSlot.cleanup();
      }
      const cleanup = eff.fn();
      slots[eff.idx] = {
        kind: "effect",
        deps: eff.deps,
        cleanup: typeof cleanup === "function" ? cleanup : undefined,
      };
    }
    return out;
  }

  function renderAndFlush(hookFn) {
    let result = runSingleRender(hookFn);
    let guard = 0;
    while (dirty && guard < 25) {
      guard += 1;
      result = runSingleRender(hookFn);
    }
    return result;
  }

  function unmount() {
    for (const s of slots) {
      if (s && s.kind === "effect" && typeof s.cleanup === "function") {
        s.cleanup();
      }
    }
  }

  return { reactMock, renderAndFlush, unmount };
}

function loadHooksWithMockedReact(globals, reactMock) {
  const ts = require("typescript");
  const helperPath = require.resolve("./helpers/load-ts-module.cjs");
  const prevHelperCache = require.cache[helperPath];
  const origLoad = Module._load;
  const origTranspile = ts.transpileModule;
  const wrappedTranspile = function (source, opts) {
    const isTsx = opts?.fileName?.endsWith(".tsx") || /<\/[A-Za-z.]/.test(source);
    return origTranspile.call(ts, source, {
      ...opts,
      ...(isTsx ? { fileName: opts?.fileName || "module.tsx" } : {}),
      compilerOptions: {
        ...(opts?.compilerOptions || {}),
        ...(isTsx ? { jsx: ts.JsxEmit.React } : {}),
      },
    });
  };
  const tsProxy = new Proxy(ts, {
    get(target, prop) {
      if (prop === "transpileModule") return wrappedTranspile;
      return Reflect.get(target, prop);
    },
  });
  Module._load = function (request, parent, isMain) {
    if (request === "react") return reactMock;
    if (request === "typescript") return tsProxy;
    return origLoad.call(this, request, parent, isMain);
  };
  delete require.cache[helperPath];
  const { loadTsModule: loadFreshTsModule } = require("./helpers/load-ts-module.cjs");
  try {
    return loadFreshTsModule(path.join(__dirname, "../lib/hooks.ts"), globals);
  } finally {
    Module._load = origLoad;
    if (prevHelperCache) require.cache[helperPath] = prevHelperCache;
    else delete require.cache[helperPath];
  }
}

async function flushAsyncAndRender(renderFn, rounds = 6) {
  let latest;
  for (let i = 0; i < rounds; i++) {
    await new Promise((r) => setTimeout(r, 0));
    latest = renderFn();
  }
  return latest;
}

function makeWeekPayload(mondayIso, subjectName, weekType = "numerator") {
  return [
    {
      date: mondayIso,
      week_type: weekType,
      lessons: [
        {
          id: 101,
          lesson_number: 1,
          day_of_week: 1,
          week_type: "both",
          subject_name: subjectName,
          teacher_name: "Іванов І.І.",
          room: "101",
        },
      ],
    },
  ];
}

test("cross-week fallback during normal fetch never flashes isUsingFallbackCache banner", async () => {
  const nov16Week = makeWeekPayload("2026-11-16", "Математика", "denominator");
  const localStorage = createMemoryStorage({
    "schedule:setupComplete": "1",
    "schedule:mode": "student",
    "schedule:groupId": "15",
    "schedule:groups": JSON.stringify([{ id: 15, name: "85" }]),
    "schedule:teachers": JSON.stringify([{ id: 1, name: "Іванов І.І." }]),
    "schedule:semesterStart": "2026-08-31",
    "schedule:today:groupId:15:guest": JSON.stringify(nov16Week[0]),
    "schedule:week:groupId:15:2026-11-16:guest": JSON.stringify(nov16Week),
  });
  const { win, EventShim, CustomEventShim } = createWindowEventBus(localStorage, "/group/85");

  let resolveWeek;
  const weekGate = new Promise((r) => {
    resolveWeek = r;
  });

  const harness = createReactHookHarness();
  const mod = loadHooksWithMockedReact(
    {
      window: win,
      document: { visibilityState: "visible", addEventListener: () => {}, removeEventListener: () => {} },
      localStorage,
      navigator: {},
      Event: EventShim,
      CustomEvent: CustomEventShim,
      fetch: async (url) => {
        const u = String(url);
        if (u.includes("/api/schedule/week")) {
          await weekGate;
          return {
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () => makeWeekPayload("2026-11-09", "Фізика", "numerator"),
          };
        }
        return { ok: true, status: 200, headers: new Headers(), json: async () => [] };
      },
    },
    harness.reactMock
  );

  const anchor = new Date("2026-11-09T10:00:00Z");
  const render = () =>
    harness.renderAndFlush(() =>
      mod.useSchedule(anchor, false, [{ id: 15, name: "85" }], [{ id: 1, name: "Іванов І.І." }], 15)
    );

  // While fetch for uncached 2026-11-09 is in-flight, fallback renders optimistically WITHOUT banner
  let state = await flushAsyncAndRender(render, 2);
  assert.equal(state.week.length, 1);
  assert.equal(state.week[0].date, "2026-11-09");
  assert.equal(state.isUsingFallbackCache, false, "must NOT show server-unavailable banner while fetch is still pending");

  // Once 200 arrives, fresh data replaces fallback and banner remains off
  resolveWeek();
  state = await flushAsyncAndRender(render, 6);
  assert.equal(state.week[0].lessons[0].subject_name, "Фізика");
  assert.equal(state.isUsingFallbackCache, false);

  harness.unmount();
});

test("isUsingFallbackCache turns on ONLY if fetch fails on cross-week fallback and clears cleanly on retry", async () => {
  const nov16Week = makeWeekPayload("2026-11-16", "Математика", "denominator");
  const localStorage = createMemoryStorage({
    "schedule:setupComplete": "1",
    "schedule:mode": "student",
    "schedule:groupId": "15",
    "schedule:groups": JSON.stringify([{ id: 15, name: "85" }]),
    "schedule:teachers": JSON.stringify([{ id: 1, name: "Іванов І.І." }]),
    "schedule:semesterStart": "2026-08-31",
    "schedule:today:groupId:15:guest": JSON.stringify(nov16Week[0]),
    "schedule:week:groupId:15:2026-11-16:guest": JSON.stringify(nov16Week),
  });
  const { win, EventShim, CustomEventShim } = createWindowEventBus(localStorage, "/group/85");

  let shouldFail = true;
  let retryGateResolve = null;
  let retryGate = null;

  const harness = createReactHookHarness();
  const mod = loadHooksWithMockedReact(
    {
      window: win,
      document: { visibilityState: "visible", addEventListener: () => {}, removeEventListener: () => {} },
      localStorage,
      navigator: {},
      Event: EventShim,
      CustomEvent: CustomEventShim,
      fetch: async (url) => {
        const u = String(url);
        if (u.includes("/api/schedule/week")) {
          if (shouldFail) {
            return {
              ok: false,
              status: 503,
              headers: new Headers(),
              json: async () => ({ detail: "Service Unavailable" }),
            };
          }
          if (retryGate) await retryGate;
          return {
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () => makeWeekPayload("2026-11-09", "Фізика", "numerator"),
          };
        }
        return { ok: true, status: 200, headers: new Headers(), json: async () => [] };
      },
    },
    harness.reactMock
  );

  const anchor = new Date("2026-11-09T10:00:00Z");
  const render = () =>
    harness.renderAndFlush(() =>
      mod.useSchedule(anchor, false, [{ id: 15, name: "85" }], [{ id: 1, name: "Іванов І.І." }], 15)
    );

  let state = await flushAsyncAndRender(render, 6);
  assert.equal(state.isUsingFallbackCache, true, "genuine 503 failure on cross-week fallback sets banner");
  assert.equal(state.error, null);

  // Simulate user clicking "Оновити" (invalidateScheduleCache -> schedule:refresh)
  shouldFail = false;
  retryGate = new Promise((r) => {
    retryGateResolve = r;
  });
  mod.invalidateScheduleCache();
  state = await flushAsyncAndRender(render, 2);
  assert.equal(state.isUsingFallbackCache, false, "banner clears immediately while retry is in-flight");

  retryGateResolve();
  state = await flushAsyncAndRender(render, 6);
  assert.equal(state.isUsingFallbackCache, false);
  assert.equal(state.week[0].lessons[0].subject_name, "Фізика");

  harness.unmount();
});

test("aborted week request when switching weeks rapidly never leaves isUsingFallbackCache stuck true", async () => {
  const nov16Week = makeWeekPayload("2026-11-16", "Математика", "denominator");
  const localStorage = createMemoryStorage({
    "schedule:setupComplete": "1",
    "schedule:mode": "student",
    "schedule:groupId": "15",
    "schedule:groups": JSON.stringify([{ id: 15, name: "85" }]),
    "schedule:teachers": JSON.stringify([{ id: 1, name: "Іванов І.І." }]),
    "schedule:semesterStart": "2026-08-31",
    "schedule:today:groupId:15:guest": JSON.stringify(nov16Week[0]),
    "schedule:week:groupId:15:2026-11-16:guest": JSON.stringify(nov16Week),
  });
  const { win, EventShim, CustomEventShim } = createWindowEventBus(localStorage, "/group/85");

  const harness = createReactHookHarness();
  const mod = loadHooksWithMockedReact(
    {
      window: win,
      document: { visibilityState: "visible", addEventListener: () => {}, removeEventListener: () => {} },
      localStorage,
      navigator: {},
      Event: EventShim,
      CustomEvent: CustomEventShim,
      fetch: async (url, init = {}) => {
        const u = String(url);
        if (u.includes("2026-11-09")) {
          // Hang until aborted by rapid switch to 2026-11-02
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
        if (u.includes("2026-11-02")) {
          return {
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () => makeWeekPayload("2026-11-02", "Інформатика", "denominator"),
          };
        }
        return { ok: true, status: 200, headers: new Headers(), json: async () => [] };
      },
    },
    harness.reactMock
  );

  let currentAnchor = new Date("2026-11-09T10:00:00Z");
  const render = () =>
    harness.renderAndFlush(() =>
      mod.useSchedule(currentAnchor, false, [{ id: 15, name: "85" }], [{ id: 1, name: "Іванов І.І." }], 15)
    );

  let state = await flushAsyncAndRender(render, 2);
  assert.equal(state.isUsingFallbackCache, false);

  // Switch rapidly to 2026-11-02 before 2026-11-09 finishes
  currentAnchor = new Date("2026-11-02T10:00:00Z");
  state = await flushAsyncAndRender(render, 6);
  assert.equal(state.week[0].lessons[0].subject_name, "Інформатика");
  assert.equal(state.isUsingFallbackCache, false);

  harness.unmount();
});
