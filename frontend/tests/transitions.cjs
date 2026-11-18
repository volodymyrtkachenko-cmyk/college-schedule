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
