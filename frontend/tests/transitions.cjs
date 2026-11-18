const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadTsModule } = require("./helpers/load-ts-module.cjs");

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("startTypedViewTransition sets data-vt-kind pre-snapshot and cleans up cleanly", async () => {
  const readyDef = createDeferred();
  const finishDef = createDeferred();
  const capturedKinds = [];
  let onReadyCalled = 0;
  let onFinishCalled = 0;

  const documentMock = {
    documentElement: { dataset: {} },
    startViewTransition(arg) {
      capturedKinds.push(documentMock.documentElement.dataset.vtKind);
      arg.update();
      return {
        ready: readyDef.promise,
        finished: finishDef.promise,
        updateCallbackDone: Promise.resolve(),
      };
    },
  };

  const windowMock = {
    matchMedia: () => ({ matches: false }),
  };

  const vtMod = loadTsModule(path.resolve(__dirname, "../lib/viewTransition.ts"), {
    window: windowMock,
    document: documentMock,
  });

  vtMod.startTypedViewTransition(["theme-change"], () => {}, {
    kind: "theme",
    onReady: () => {
      onReadyCalled++;
    },
    onFinish: () => {
      onFinishCalled++;
    },
  });

  assert.deepEqual(capturedKinds, ["theme"]);
  assert.equal(documentMock.documentElement.dataset.vtKind, "theme");

  readyDef.resolve();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(onReadyCalled, 1);
  assert.equal(documentMock.documentElement.dataset.vtKind, "theme");

  finishDef.resolve();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(onFinishCalled, 1);
  assert.equal(documentMock.documentElement.dataset.vtKind, undefined);
});

test("startTypedViewTransition does not clobber overlapping vtKind on stale finish", async () => {
  const firstFinish = createDeferred();
  const secondFinish = createDeferred();
  let callIndex = 0;

  const documentMock = {
    documentElement: { dataset: {} },
    startViewTransition() {
      callIndex++;
      return {
        ready: Promise.resolve(),
        finished: callIndex === 1 ? firstFinish.promise : secondFinish.promise,
        updateCallbackDone: Promise.resolve(),
      };
    },
  };

  const vtMod = loadTsModule(path.resolve(__dirname, "../lib/viewTransition.ts"), {
    window: { matchMedia: () => ({ matches: false }) },
    document: documentMock,
  });

  vtMod.startTypedViewTransition(["theme-change"], () => {}, { kind: "theme" });
  vtMod.startTypedViewTransition(["route-forward"], () => {}, { kind: "route" });
  assert.equal(documentMock.documentElement.dataset.vtKind, "route");

  firstFinish.resolve();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(documentMock.documentElement.dataset.vtKind, "route");

  secondFinish.resolve();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(documentMock.documentElement.dataset.vtKind, undefined);
});

test("startTypedViewTransition does not clobber overlapping transitions with the same vtKind on stale finish", async () => {
  const firstFinish = createDeferred();
  const secondFinish = createDeferred();
  let callIndex = 0;

  const documentMock = {
    documentElement: { dataset: {} },
    startViewTransition() {
      callIndex++;
      return {
        ready: Promise.resolve(),
        finished: callIndex === 1 ? firstFinish.promise : secondFinish.promise,
        updateCallbackDone: Promise.resolve(),
      };
    },
  };

  const vtMod = loadTsModule(path.resolve(__dirname, "../lib/viewTransition.ts"), {
    window: { matchMedia: () => ({ matches: false }) },
    document: documentMock,
  });

  vtMod.startTypedViewTransition(["day-next"], () => {}, { kind: "day-slide" });
  vtMod.startTypedViewTransition(["day-next"], () => {}, { kind: "day-slide" });
  assert.equal(documentMock.documentElement.dataset.vtKind, "day-slide");

  firstFinish.resolve();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(documentMock.documentElement.dataset.vtKind, "day-slide");

  secondFinish.resolve();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(documentMock.documentElement.dataset.vtKind, undefined);
});

test("startTypedViewTransition honors reduced motion without setting vtKind", () => {
  let updated = false;
  let finished = false;
  const documentMock = {
    documentElement: { dataset: {} },
    startViewTransition() {
      throw new Error("Should not call startViewTransition under reduced motion");
    },
  };

  const vtMod = loadTsModule(path.resolve(__dirname, "../lib/viewTransition.ts"), {
    window: { matchMedia: () => ({ matches: true }) },
    document: documentMock,
  });

  const handle = vtMod.startTypedViewTransition(
    ["theme-change"],
    () => {
      updated = true;
    },
    {
      kind: "theme",
      onFinish: () => {
        finished = true;
      },
    }
  );

  assert.equal(handle, null);
  assert.equal(updated, true);
  assert.equal(finished, true);
  assert.equal(documentMock.documentElement.dataset.vtKind, undefined);
});

test("startTypedViewTransition aborts superseded transitions cleanly and ignores stale onReady/onFinish", async () => {
  const ready1 = createDeferred();
  const finish1 = createDeferred();
  const ready2 = createDeferred();
  const finish2 = createDeferred();
  const events = [];
  let skipped1 = 0;

  const documentMock = {
    documentElement: { dataset: {} },
    startViewTransition(arg) {
      const idx = events.filter((e) => e.startsWith("start:")).length + 1;
      events.push(`start:${idx}:${documentMock.documentElement.dataset.vtKind || ""}`);
      arg.update();
      return {
        ready: idx === 1 ? ready1.promise : ready2.promise,
        finished: idx === 1 ? finish1.promise : finish2.promise,
        updateCallbackDone: Promise.resolve(),
        skipTransition() {
          if (idx === 1) skipped1++;
        },
      };
    },
  };

  const vtMod = loadTsModule(path.resolve(__dirname, "../lib/viewTransition.ts"), {
    window: { matchMedia: () => ({ matches: false }) },
    document: documentMock,
  });

  documentMock.documentElement.dataset.vtThemeStyle = "diamond";
  vtMod.startTypedViewTransition(["theme-change"], () => events.push("update:1"), {
    kind: "theme",
    onReady: () => events.push("ready:1"),
    onFinish: () => {
      delete documentMock.documentElement.dataset.vtThemeStyle;
      events.push("finish:1");
    },
    onAbort: () => {
      delete documentMock.documentElement.dataset.vtThemeStyle;
      events.push("abort:1");
    },
  });

  // Start second transition synchronously after updating theme style attribute
  vtMod.abortActiveViewTransition();
  documentMock.documentElement.dataset.vtThemeStyle = "curtain";
  vtMod.startTypedViewTransition(["theme-change"], () => events.push("update:2"), {
    kind: "theme",
    onReady: () => events.push("ready:2"),
    onFinish: () => {
      delete documentMock.documentElement.dataset.vtThemeStyle;
      events.push("finish:2");
    },
    onAbort: () => events.push("abort:2"),
  });

  assert.equal(skipped1, 1);
  assert.equal(documentMock.documentElement.dataset.vtKind, "theme");
  assert.equal(documentMock.documentElement.dataset.vtThemeStyle, "curtain");

  // Stale promises from transition 1 settle late and MUST NOT fire onReady/onFinish or clear attrs
  ready1.resolve();
  finish1.reject(new Error("AbortError"));
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(documentMock.documentElement.dataset.vtKind, "theme");
  assert.equal(documentMock.documentElement.dataset.vtThemeStyle, "curtain");
  assert.ok(!events.includes("ready:1"));
  assert.ok(!events.includes("finish:1"));

  ready2.resolve();
  finish2.resolve();
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(documentMock.documentElement.dataset.vtKind, undefined);
  assert.equal(documentMock.documentElement.dataset.vtThemeStyle, undefined);
  assert.ok(events.includes("abort:1"));
  assert.ok(events.includes("ready:2"));
  assert.ok(events.includes("finish:2"));
});

function createDialogTopLayerSandbox({ supportsOverlay, supportsAllowDiscrete, displayTransitions }) {
  const probeEl = {
    style: { cssText: "", display: "" },
    removed: false,
    remove() {
      this.removed = true;
    },
  };

  const documentMock = {
    body: {
      appendChild() {},
    },
    createElement() {
      probeEl.style.display = "block";
      return probeEl;
    },
  };

  const windowMock = {
    CSS: {
      supports(prop, val) {
        if (prop === "overlay" && val === "auto") return supportsOverlay;
        if (prop === "transition-behavior" && val === "allow-discrete") return supportsAllowDiscrete;
        return false;
      },
    },
    getComputedStyle(el) {
      return {
        display: displayTransitions ? "block" : el.style.display,
      };
    },
  };

  return loadTsModule(path.resolve(__dirname, "../lib/dialogTopLayer.ts"), {
    window: windowMock,
    document: documentMock,
  });
}

test("canTransitionTopLayer rejects Firefox bug 1882408 and Safari without overlay", () => {
  const firefoxMod = createDialogTopLayerSandbox({
    supportsOverlay: true,
    supportsAllowDiscrete: true,
    displayTransitions: false,
  });
  assert.equal(firefoxMod.canTransitionDisplay(), false);
  assert.equal(firefoxMod.canTransitionTopLayer(), false);

  const safariMod = createDialogTopLayerSandbox({
    supportsOverlay: false,
    supportsAllowDiscrete: true,
    displayTransitions: true,
  });
  assert.equal(safariMod.canTransitionDisplay(), true);
  assert.equal(safariMod.canTransitionTopLayer(), false);
});

test("canTransitionTopLayer returns true only when overlay and discrete display transitions work", () => {
  const chromiumMod = createDialogTopLayerSandbox({
    supportsOverlay: true,
    supportsAllowDiscrete: true,
    displayTransitions: true,
  });
  assert.equal(chromiumMod.canTransitionDisplay(), true);
  assert.equal(chromiumMod.canTransitionTopLayer(), true);
});

test("closeTopLayer holds dialog.open with data-closing during exit animations, supports mid-flight reversal, and closes synchronously under reduced motion", async () => {
  let reducedMotion = false;
  let scrollX = 12;
  let scrollY = 340;
  const scrollCalls = [];

  const documentMock = {
    body: { appendChild() {} },
    createElement() {
      return { style: { cssText: "", display: "block" }, remove() {} };
    },
  };

  const windowMock = {
    CSS: { supports: () => true },
    get scrollX() {
      return scrollX;
    },
    get scrollY() {
      return scrollY;
    },
    scrollTo(x, y) {
      scrollX = x;
      scrollY = y;
      scrollCalls.push([x, y]);
    },
    matchMedia(query) {
      return {
        matches: query.includes("prefers-reduced-motion") ? reducedMotion : false,
      };
    },
    getComputedStyle() {
      return { display: "block", opacity: "0" };
    },
    setTimeout,
    clearTimeout,
  };

  const mod = loadTsModule(path.resolve(__dirname, "../lib/dialogTopLayer.ts"), {
    window: windowMock,
    document: documentMock,
  });

  // 1. Exit animation keeps dialog.open true until settled and restores scroll position on close
  let resolveAnim1;
  const anim1 = {
    finished: new Promise((resolve) => {
      resolveAnim1 = resolve;
    }),
  };
  let afterCount1 = 0;
  const dialog1 = {
    open: true,
    isConnected: true,
    dataset: {},
    close() {
      this.open = false;
      // Simulate browser scroll jump on close()
      scrollY = 0;
    },
    showModal() {
      this.open = true;
    },
    getAnimations() {
      return [anim1];
    },
  };

  mod.closeTopLayer(dialog1, () => {
    afterCount1++;
  });
  assert.equal(dialog1.dataset.closing, "true");
  assert.equal(dialog1.open, true);
  assert.equal(afterCount1, 0);

  resolveAnim1();
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(dialog1.open, false);
  assert.equal(dialog1.dataset.closing, undefined);
  assert.equal(afterCount1, 1);
  assert.deepEqual(scrollCalls[scrollCalls.length - 1], [12, 340]);

  // 2. Mid-flight reopen cancels pending close cleanly without calling onAfterClose
  let resolveAnim2;
  const anim2 = {
    finished: new Promise((resolve) => {
      resolveAnim2 = resolve;
    }),
  };
  let afterCount2 = 0;
  const dialog2 = {
    open: true,
    isConnected: true,
    dataset: {},
    close() {
      this.open = false;
    },
    showModal() {
      this.open = true;
    },
    getAnimations() {
      return [anim2];
    },
  };

  mod.closeTopLayer(dialog2, () => {
    afterCount2++;
  });
  assert.equal(dialog2.dataset.closing, "true");
  assert.equal(dialog2.open, true);

  mod.openTopLayer(dialog2);
  resolveAnim2();
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(dialog2.dataset.closing, undefined);
  assert.equal(dialog2.open, true);
  assert.equal(afterCount2, 0);

  // 3. Reduced motion closes synchronously without setting data-closing
  reducedMotion = true;
  let afterCount3 = 0;
  const dialog3 = {
    open: true,
    isConnected: true,
    dataset: {},
    close() {
      this.open = false;
    },
    showModal() {
      this.open = true;
    },
    getAnimations() {
      return [];
    },
  };

  mod.closeTopLayer(dialog3, () => {
    afterCount3++;
  });
  assert.equal(dialog3.open, false);
  assert.equal(dialog3.dataset.closing, undefined);
  assert.equal(afterCount3, 1);
});

test("startTypedViewTransition failsafeMs atomically aborts stalled transition and cleans kind with onAbort", async () => {
  const ready = createDeferred();
  const neverFinished = new Promise(() => {});
  let skipped = false;
  let aborted = 0;

  const documentMock = {
    documentElement: { dataset: { vtThemeStyle: "diamond" } },
    startViewTransition() {
      return {
        ready: ready.promise,
        finished: neverFinished,
        updateCallbackDone: Promise.resolve(),
        skipTransition() {
          skipped = true;
        },
      };
    },
  };

  const vtMod = loadTsModule(path.resolve(__dirname, "../lib/viewTransition.ts"), {
    window: { matchMedia: () => ({ matches: false }) },
    document: documentMock,
  });

  vtMod.startTypedViewTransition(["theme-change"], () => {}, {
    kind: "theme",
    failsafeMs: 35,
    onFinish: () => {
      delete documentMock.documentElement.dataset.vtThemeStyle;
    },
    onAbort: () => {
      aborted += 1;
      delete documentMock.documentElement.dataset.vtThemeStyle;
    },
  });

  ready.resolve();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(documentMock.documentElement.dataset.vtKind, "theme");
  assert.equal(documentMock.documentElement.dataset.vtThemeStyle, "diamond");

  await new Promise((r) => setTimeout(r, 60));
  assert.equal(skipped, true);
  assert.equal(aborted, 1);
  assert.equal(documentMock.documentElement.dataset.vtKind, undefined);
  assert.equal(documentMock.documentElement.dataset.vtThemeStyle, undefined);
});

test("startTypedViewTransition pointerdown aborts active transition and forwards root click once", async () => {
  const ready = createDeferred();
  const finish = createDeferred();
  const listeners = new Map();
  let skipped = 0;
  let aborted = 0;
  let buttonClicks = 0;
  let linkClicks = 0;
  let hoveredTarget = null;

  const buttonEl = {
    tagName: "BUTTON",
    closest(selector) {
      return selector.includes("button") ? this : null;
    },
    getAttribute() {
      return null;
    },
    click() {
      buttonClicks += 1;
    },
  };

  const linkEl = {
    tagName: "A",
    closest(selector) {
      return selector.includes("a[href]") ? this : null;
    },
    getAttribute() {
      return null;
    },
    click() {
      linkClicks += 1;
    },
  };

  const documentMock = {
    documentElement: { dataset: {} },
    body: {
      contains(node) {
        return node === buttonEl || node === linkEl;
      },
    },
    elementFromPoint() {
      return hoveredTarget;
    },
    startViewTransition() {
      return {
        ready: ready.promise,
        finished: finish.promise,
        updateCallbackDone: Promise.resolve(),
        skipTransition() {
          skipped += 1;
        },
      };
    },
  };

  const windowMock = {
    matchMedia: () => ({ matches: false }),
    addEventListener(type, fn) {
      listeners.set(type, fn);
    },
    removeEventListener(type) {
      listeners.delete(type);
    },
  };

  const vtMod = loadTsModule(path.resolve(__dirname, "../lib/viewTransition.ts"), {
    window: windowMock,
    document: documentMock,
  });

  // Case 1: browser delivers click to documentElement (overlay intercepted mousedown) -> replayed cleanly once
  documentMock.documentElement.dataset.vtThemeStyle = "split";
  vtMod.startTypedViewTransition(["theme-change"], () => {}, {
    kind: "theme",
    onAbort: () => {
      aborted += 1;
      delete documentMock.documentElement.dataset.vtThemeStyle;
    },
  });

  hoveredTarget = buttonEl;
  listeners.get("pointerdown")({ isTrusted: true, pointerType: "mouse", button: 0, clientX: 290, clientY: 372 });
  assert.equal(skipped, 1);
  assert.equal(aborted, 1);
  assert.equal(documentMock.documentElement.dataset.vtKind, undefined);
  assert.equal(documentMock.documentElement.dataset.vtThemeStyle, undefined);

  let defaultPrevented = false;
  let stopped = false;
  listeners.get("pointerup")({ isTrusted: true, pointerType: "mouse", clientX: 290, clientY: 372 });
  listeners.get("click")({
    isTrusted: true,
    target: documentMock.documentElement,
    clientX: 290,
    clientY: 372,
    preventDefault() {
      defaultPrevented = true;
    },
    stopImmediatePropagation() {
      stopped = true;
    },
  });
  await Promise.resolve();
  assert.equal(defaultPrevented, true);
  assert.equal(stopped, true);
  assert.equal(buttonClicks, 1);
  const originCoords = vtMod.consumeInterruptedPointerOrigin();
  assert.equal(originCoords?.x, 290);
  assert.equal(originCoords?.y, 372);

  // Case 2: pointerup without click (Blink suppressed click after overlay teardown) -> microtask clicks once
  vtMod.startTypedViewTransition(["theme-change"], () => {}, { kind: "theme" });
  hoveredTarget = linkEl;
  listeners.get("pointerdown")({ isTrusted: true, pointerType: "mouse", button: 0, clientX: 120, clientY: 40 });
  listeners.get("pointerup")({ isTrusted: true, pointerType: "mouse", clientX: 120, clientY: 40 });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(linkClicks, 1);

  // Case 3: native click lands directly on button inside body -> no duplicate replay
  vtMod.startTypedViewTransition(["theme-change"], () => {}, { kind: "theme" });
  hoveredTarget = buttonEl;
  listeners.get("pointerdown")({ isTrusted: true, pointerType: "mouse", button: 0, clientX: 290, clientY: 372 });
  listeners.get("pointerup")({ isTrusted: true, pointerType: "mouse", clientX: 290, clientY: 372 });
  listeners.get("click")({
    isTrusted: true,
    target: buttonEl,
    clientX: 290,
    clientY: 372,
    preventDefault() {},
    stopImmediatePropagation() {},
  });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(buttonClicks, 1);
});
