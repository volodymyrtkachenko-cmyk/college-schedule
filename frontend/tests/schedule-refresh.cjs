const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");
const { loadTsModule } = require("./helpers/load-ts-module.cjs");

function createMemoryStorage(seed = {}) {
  const store = new Map(Object.entries(seed).map(([k, v]) => [k, String(v)]));
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

function createWindowEventBus(localStorage) {
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
    location: { origin: "http://localhost:3000" },
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
      return null;
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
    while (dirty && guard < 20) {
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

function loadHookWithMockedReact(globals, reactMock) {
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
    return loadFreshTsModule(
      path.join(__dirname, "../components/schedule/useScheduleDataFetch.ts"),
      globals
    );
  } finally {
    Module._load = origLoad;
    if (prevHelperCache) require.cache[helperPath] = prevHelperCache;
    else delete require.cache[helperPath];
  }
}

async function flushMicrotasksAndRender(renderFn, rounds = 6) {
  let latest;
  for (let i = 0; i < rounds; i++) {
    await new Promise((r) => setTimeout(r, 0));
    latest = renderFn();
  }
  return latest;
}

test("schedule:refresh preserves loaded classroomTasks and classroomLastSyncedAt (even when network status fails)", async () => {
  const localStorage = createMemoryStorage({
    "schedule:classroom_linked_email": "student@kre.dp.ua",
    "schedule:classroom_google_user_id": "uid-1",
    "schedule:classroom_linked_group_id": "1",
    "schedule:classroom_access_token": "tok-1",
    "schedule:classroom_access_token_exp": String(Date.now() + 300_000),
  });
  const sessionStorage = createMemoryStorage();
  const { win, EventShim, CustomEventShim } = createWindowEventBus(localStorage);
  win.sessionStorage = sessionStorage;
  let statusCalls = 0;
  const seenUrls = [];
  let shouldFailStatus = false;

  const sampleTasks = [
    {
      id: "456",
      course_id: "123",
      course_name: "Математика",
      title: "Лабораторна 1",
      state: "NEW",
      alternate_link: "https://classroom.google.com/c/123/a/456/details",
    },
  ];

  const globals = {
    window: win,
    document: {
      visibilityState: "visible",
      addEventListener: () => {},
      removeEventListener: () => {},
    },
    localStorage,
    sessionStorage,
    navigator: {},
    Event: EventShim,
    CustomEvent: CustomEventShim,
    fetch: async (url) => {
      const u = String(url);
      seenUrls.push(u);
      if (u.includes("/api/classroom/groups/") && u.includes("/status")) {
        statusCalls += 1;
        if (shouldFailStatus) {
          return {
            ok: false,
            status: 503,
            headers: new Headers(),
            json: async () => ({ detail: "Offline / Unavailable" }),
          };
        }
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            connected: true,
            has_group_tasks: true,
            last_synced_at: "2026-11-17T08:00:00Z",
            tasks: sampleTasks,
          }),
        };
      }
      if (u.includes("/api/classroom/user-submissions")) {
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            connected: true,
            user_email: "student@kre.dp.ua",
            group_id: 1,
            tasks: sampleTasks,
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({}),
      };
    },
  };

  const harness = createReactHookHarness();
  const mod = loadHookWithMockedReact(globals, harness.reactMock);

  const sampleWeek = [
    {
      date: "2026-11-16",
      week_type: "numerator",
      lessons: [
        {
          id: 10,
          lesson_number: 1,
          day_of_week: 1,
          week_type: "both",
          subject_name: "Математика",
          teacher_name: "Іванов І.І.",
          note: "[TASK: Лабораторна 1 (до 10.11): https://classroom.google.com/c/123/a/456/details]",
        },
      ],
    },
  ];

  const weekAnchorDate = new Date("2026-11-16T10:00:00Z");

  const renderHook = () =>
    harness.renderAndFlush(() =>
      mod.useScheduleDataFetch({
        groupId: 1,
        setGroupId: () => {},
        mode: "student",
        week: sampleWeek,
        weekAnchorDate,
        currentWeekNumber: 12,
        returnTarget: null,
        setToast: () => {},
        setOverdueCount: () => {},
        onOpenTeacherPinModal: () => {},
        enableSidebarTaskGroups: true,
      })
    );

  let state = renderHook();
  state = await flushMicrotasksAndRender(renderHook);

  assert.equal(statusCalls, 1, `expected statusCalls=1, seenUrls=${JSON.stringify(seenUrls)}`);
  assert.equal(state.classroomLastSyncedAt, "2026-11-17T08:00:00Z");
  assert.equal(state.allTasks.length, 1);
  assert.equal(state.allTasks[0].id, "456");

  // Dispatch schedule:refresh while subsequent status request fails (offline / note retry)
  shouldFailStatus = true;
  win.dispatchEvent(new EventShim("schedule:refresh"));
  state = renderHook();

  // Immediately after dispatch (before any re-fetch settles), loaded tasks & timestamp MUST remain intact
  assert.equal(state.classroomLastSyncedAt, "2026-11-17T08:00:00Z");
  assert.equal(state.allTasks.length, 1);
  assert.equal(state.allTasks[0].id, "456");

  state = await flushMicrotasksAndRender(renderHook);
  assert.equal(state.classroomLastSyncedAt, "2026-11-17T08:00:00Z");
  assert.equal(state.allTasks.length, 1);

  harness.unmount();
});

test("classroom-access-changed clears classroomTasks and accessGenerationRef rejects stale in-flight groupStatus", async () => {
  const localStorage = createMemoryStorage();
  const sessionStorage = createMemoryStorage();
  const { win, EventShim, CustomEventShim } = createWindowEventBus(localStorage);
  win.sessionStorage = sessionStorage;

  let resolveStatus;
  const statusGate = new Promise((r) => {
    resolveStatus = r;
  });

  const globals = {
    window: win,
    document: {
      visibilityState: "visible",
      addEventListener: () => {},
      removeEventListener: () => {},
    },
    localStorage,
    sessionStorage,
    navigator: {},
    Event: EventShim,
    CustomEvent: CustomEventShim,
    fetch: async (url) => {
      if (String(url).includes("/status")) {
        await statusGate;
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            connected: true,
            has_group_tasks: true,
            last_synced_at: "2026-11-17T09:00:00Z",
            tasks: [
              {
                id: "stale-t1",
                course_id: "999",
                course_name: "Фізика",
                title: "Stale Lab",
                state: "NEW",
                alternate_link: "https://classroom.google.com/c/999/a/1/details",
              },
            ],
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({}),
      };
    },
  };

  const harness = createReactHookHarness();
  const mod = loadHookWithMockedReact(globals, harness.reactMock);

  const sampleWeek = [
    {
      date: "2026-11-16",
      week_type: "numerator",
      lessons: [
        {
          id: 20,
          lesson_number: 2,
          day_of_week: 1,
          week_type: "both",
          subject_name: "Фізика",
          teacher_name: "Петров П.П.",
          note: "[TASK: Stale Lab: https://classroom.google.com/c/999/a/1/details]",
        },
      ],
    },
  ];

  const weekAnchorDate = new Date("2026-11-16T10:00:00Z");

  const renderHook = () =>
    harness.renderAndFlush(() =>
      mod.useScheduleDataFetch({
        groupId: 2,
        setGroupId: () => {},
        mode: "student",
        week: sampleWeek,
        weekAnchorDate,
        currentWeekNumber: 12,
        returnTarget: null,
        setToast: () => {},
        setOverdueCount: () => {},
        onOpenTeacherPinModal: () => {},
        enableSidebarTaskGroups: true,
      })
    );

  // Mount starts groupStatus(2) in flight
  renderHook();
  await new Promise((r) => setTimeout(r, 0));

  // Unlink / classroom access change fires BEFORE groupStatus(2) resolves
  win.dispatchEvent(new EventShim("classroom-access-changed"));
  let state = renderHook();
  assert.equal(state.classroomLastSyncedAt, null);

  // Now resolve the stale in-flight groupStatus(2) response
  resolveStatus();
  state = await flushMicrotasksAndRender(renderHook);

  assert.equal(state.classroomLastSyncedAt, null, "stale response must not restore classroomLastSyncedAt");
  assert.equal(state.allTasks[0]?.state === "NEW" && state.allTasks[0]?.id === "stale-t1", false);
  assert.equal(state.hasGroupTaskAccess, false, "stale response must not flip hasGroupTaskAccess");

  harness.unmount();
});
