const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadTsModule } = require('./helpers/load-ts-module.cjs');

function setup(fetch) {
  return loadTsModule(path.join(__dirname, '../lib/api.ts'), { fetch }).api;
}
const session = name => ({ access_token: name, token_type: 'bearer', user: { id: name === 'A' ? 1 : 2, username: name } });
const response = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
const tick = () => new Promise(resolve => setImmediate(resolve));

test('late login A cannot overwrite login B', async () => {
  const a = deferred();
  const api = setup(async (url, options) => {
    const name = JSON.parse(options.body).username;
    return name === 'A' ? a.promise : response(session('B'));
  });
  const old = api.auth.login('A', 'test').catch(e => e);
  await tick();
  const newer = api.auth.login('B', 'test');
  a.resolve(response(session('A')));
  assert.equal((await old).name, 'AuthSupersededError');
  assert.equal((await newer).user.username, 'B');
  assert.equal((await api.auth.bootstrap()).user.username, 'B');
});

test('clear rejects an in-flight login', async () => {
  const a = deferred(); const api = setup(() => a.promise);
  const pending = api.auth.login('A', 'test').catch(e => e);
  await tick(); api.auth.clear(); a.resolve(response(session('A')));
  assert.equal((await pending).name, 'AuthSupersededError');
});

test('late /me cannot restore a cleared session', async () => {
  const me = deferred();
  const api = setup(async url => url.endsWith('/login') ? response(session('A')) : url.endsWith('/me') ? me.promise : response(session('B')));
  await api.auth.login('A', 'test');
  const old = api.auth.ensureAuthenticated().catch(e => e);
  await tick(); api.auth.clear(); me.resolve(response(session('A').user));
  assert.equal((await old).name, 'AuthSupersededError');
  assert.equal((await api.auth.bootstrap()).user.username, 'B');
});

test('new refresh is not pinned to old rejected promise', async () => {
  const first = deferred(); let calls = 0;
  const api = setup(async () => ++calls === 1 ? first.promise : response(session('B')));
  const old = api.auth.refresh().catch(e => e);
  await tick(); api.auth.clear();
  const newer = api.auth.refresh(); first.resolve(response(session('A')));
  assert.equal((await old).name, 'AuthSupersededError');
  assert.equal((await newer).user.username, 'B'); assert.equal(calls, 2);
});

test('logout waits for earlier refresh and prevents overlapping login', async () => {
  const first = deferred(); const calls = [];
  const api = setup(async url => {
    calls.push(url);
    return url.endsWith('/refresh') ? first.promise : response({ status: 'ok' });
  });
  const old = api.auth.refresh().catch(e => e); await tick();
  const logout = api.auth.logout();
  await assert.rejects(api.auth.login('B', 'test'));
  assert.equal(calls.length, 1);
  first.resolve(response(session('A')));
  assert.equal((await old).name, 'AuthSupersededError');
  assert.equal(await logout, true);
  assert.ok(calls[1].endsWith('/logout'));
});

test('failed server logout is not reported as success', async () => {
  const api = setup(async url => url.endsWith('/login') ? response(session('A')) : response({ detail: 'Unavailable' }, 503));
  await api.auth.login('A', 'test');
  await assert.rejects(api.auth.logout());
  assert.equal((await api.auth.bootstrap()).user.username, 'A');
});

test('refresh is single-flight within one generation', async () => {
  const first = deferred(); let calls = 0;
  const api = setup(async () => { calls++; return first.promise; });
  const a = api.auth.refresh(); const b = api.auth.refresh(); await tick();
  first.resolve(response(session('A'))); await Promise.all([a, b]); assert.equal(calls, 1);
});

function createMemoryStorage(initial = {}) {
  const store = new Map(Object.entries(initial).map(([k, v]) => [String(k), String(v)]));
  return {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(String(k), String(v)); },
    removeItem: k => { store.delete(k); },
  };
}

test('auth transitions clear cached ETag responses and isolate scoped GET keys', async () => {
  const storage = createMemoryStorage();
  const seenHeaders = [];
  let payloadVersion = 0;

  const api = loadTsModule(path.join(__dirname, '../lib/api.ts'), {
    window: { localStorage: storage },
    localStorage: storage,
    fetch: async (url, init = {}) => {
      if (url.endsWith('/api/auth/login')) {
        return response(session('A'));
      }
      if (url.endsWith('/api/auth/logout')) {
        return response({ status: 'ok' });
      }
      const hdrs = new Headers(init.headers);
      const ifNoneMatch = hdrs.get('If-None-Match');
      const pin = hdrs.get('X-Teacher-Pin') || '';
      const email = hdrs.get('X-Classroom-Email') || '';
      seenHeaders.push({ url, ifNoneMatch, pin, email, hasAuth: hdrs.has('Authorization') });
      const etag = `W/"v${payloadVersion}-${pin}-${email}"`;
      if (ifNoneMatch && ifNoneMatch === etag) {
        return {
          ok: false,
          status: 304,
          headers: new Headers({ ETag: etag }),
          json: async () => ({}),
        };
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers({ ETag: etag }),
        json: async () => [{ id: ++payloadVersion, pin, email }],
      };
    },
  }).api;

  // 1. Guest fetch populates ETag cache, then PIN change must NOT send guest If-None-Match
  const guestRows = await api.events.list({ group_id: 1 });
  assert.equal(guestRows[0].pin, '');
  storage.setItem('college_schedule_teacher_pin', 'secret-pin');
  const pinRows = await api.events.list({ group_id: 1 });
  assert.equal(pinRows[0].pin, 'secret-pin');
  assert.equal(seenHeaders[1].ifNoneMatch, null);

  // 2. Classroom identity change must NOT hit PIN/previous-identity cache
  storage.setItem('schedule:classroom_linked_email', 's1@kre.dp.ua');
  await api.events.list({ group_id: 1 });
  assert.equal(seenHeaders[2].ifNoneMatch, null);

  // 3. Same credentials DO send If-None-Match and reuse cached payload on 304
  const repeated = await api.events.list({ group_id: 1 });
  assert.equal(repeated[0].email, 's1@kre.dp.ua');
  assert.ok(seenHeaders[3].ifNoneMatch);

  // 4. auth.login and auth.clear MUST invalidate etagResponseCache immediately
  await api.auth.login('A', 'test');
  await api.events.list({ group_id: 1 });
  assert.equal(seenHeaders[4].ifNoneMatch, null);
  assert.equal(seenHeaders[4].hasAuth, true);

  api.auth.clear();
  await api.events.list({ group_id: 1 });
  assert.equal(seenHeaders[5].ifNoneMatch, null);
  assert.equal(seenHeaders[5].hasAuth, false);
});

test("distinct teacher PINs and User A -> logout -> User B transitions never reuse ETag cache", async () => {
  const makeMemoryStorage = () => {
    const store = new Map();
    return {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
      clear: () => store.clear(),
    };
  };
  const makeSession = (username) => {
    const payload = Buffer.from(
      JSON.stringify({ sub: username, role: "admin", exp: Math.floor(Date.now() / 1000) + 86400 * 5 })
    ).toString("base64url");
    return {
      access_token: `hdr.${payload}.sig-${username}`,
      refresh_token: `rt-${username}`,
      user: { username, role: "admin" },
    };
  };

  const storage = makeMemoryStorage();
  const requests = [];
  let ver = 0;

  const { api } = loadTsModule(path.join(__dirname, "../lib/api.ts"), {
    window: { localStorage: storage },
    localStorage: storage,
    fetch: async (url, init = {}) => {
      if (url.endsWith("/api/auth/login")) {
        const { username } = JSON.parse(init.body);
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => makeSession(username),
        };
      }
      if (url.endsWith("/api/auth/logout")) {
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({ status: "ok" }),
        };
      }
      const hdrs = new Headers(init.headers);
      const ifNoneMatch = hdrs.get("If-None-Match");
      const pin = hdrs.get("X-Teacher-Pin") || "";
      const auth = hdrs.get("Authorization") || "";
      requests.push({ ifNoneMatch, pin, auth });
      const etag = `W/"v${ver}-${pin}-${auth}"`;
      if (ifNoneMatch && ifNoneMatch === etag) {
        return {
          ok: false,
          status: 304,
          headers: new Headers({ ETag: etag }),
          json: async () => ({}),
        };
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers({ ETag: etag }),
        json: async () => [{ seq: ++ver, pin, auth }],
      };
    },
  });

  // Distinct teacher PINs must get separate ETag entries
  storage.setItem("college_schedule_teacher_pin", "pin-1");
  const r1 = await api.events.list({ group_id: 1 });
  assert.equal(r1[0].pin, "pin-1");
  assert.equal(requests[0].ifNoneMatch, null);

  storage.setItem("college_schedule_teacher_pin", "pin-2");
  const r2 = await api.events.list({ group_id: 1 });
  assert.equal(r2[0].pin, "pin-2");
  assert.equal(requests[1].ifNoneMatch, null);

  // User A -> logout -> User B must not share ETag cache across different Bearer tokens
  await api.auth.login("userA", "pw");
  const aRows = await api.events.list({ group_id: 1 });
  assert.match(aRows[0].auth, /sig-userA/);
  assert.equal(requests[2].ifNoneMatch, null);

  const aCached = await api.events.list({ group_id: 1 });
  assert.match(aCached[0].auth, /sig-userA/);
  assert.ok(requests[3].ifNoneMatch);

  await api.auth.logout();
  await api.auth.login("userB", "pw");
  const bRows = await api.events.list({ group_id: 1 });
  assert.match(bRows[0].auth, /sig-userB/);
  assert.equal(requests[4].ifNoneMatch, null);
});

test("late GET response after invalidateEtagCache / auth.clear / auth.logout does not repopulate ETag cache", async () => {
  const makeMemoryStorage = () => {
    const store = new Map();
    return {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
      clear: () => store.clear(),
    };
  };
  const makeSession = (username) => {
    const payload = Buffer.from(
      JSON.stringify({ sub: username, role: "admin", exp: Math.floor(Date.now() / 1000) + 86400 * 5 })
    ).toString("base64url");
    return {
      access_token: `hdr.${payload}.sig-${username}`,
      refresh_token: `rt-${username}`,
      user: { username, role: "admin" },
    };
  };
  const deferred = () => {
    let resolve;
    const promise = new Promise((r) => {
      resolve = r;
    });
    return { promise, resolve };
  };

  const storage = makeMemoryStorage();
  const seen = [];
  const pendingGets = [];

  const mod = loadTsModule(path.join(__dirname, "../lib/api.ts"), {
    window: { localStorage: storage },
    localStorage: storage,
    fetch: async (url, init = {}) => {
      if (url.endsWith("/api/auth/login")) {
        const { username } = JSON.parse(init.body);
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => makeSession(username),
        };
      }
      if (url.endsWith("/api/auth/logout")) {
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({ status: "ok" }),
        };
      }
      const hdrs = new Headers(init.headers);
      const ifNoneMatch = hdrs.get("If-None-Match");
      seen.push({ ifNoneMatch, index: seen.length });
      if (pendingGets.length > 0 && pendingGets[0].hold) {
        const gate = pendingGets.shift();
        await gate.gate.promise;
        return {
          ok: true,
          status: 200,
          headers: new Headers({ ETag: gate.etag }),
          json: async () => [{ stale: true, tag: gate.etag }],
        };
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers({ ETag: 'W/"fresh"' }),
        json: async () => [{ fresh: true }],
      };
    },
  });

  // Case 1: invalidateEtagCache() while GET is in flight
  const g1 = deferred();
  pendingGets.push({ hold: true, gate: g1, etag: 'W/"stale-1"' });
  const inFlight1 = mod.api.events.list({ group_id: 2 });
  await Promise.resolve();
  mod.invalidateEtagCache();
  g1.resolve();
  await inFlight1;
  await mod.api.events.list({ group_id: 2 });
  assert.equal(seen[1].ifNoneMatch, null, "late GET after invalidateEtagCache must not repopulate ETag cache");

  // Case 2: auth.clear() while GET is in flight
  mod.invalidateEtagCache();
  await mod.api.auth.login("user1", "pw");
  const g2 = deferred();
  pendingGets.push({ hold: true, gate: g2, etag: 'W/"stale-2"' });
  const inFlight2 = mod.api.events.list({ group_id: 3 });
  await Promise.resolve();
  mod.api.auth.clear();
  g2.resolve();
  await inFlight2;
  await mod.api.events.list({ group_id: 3 });
  assert.equal(seen[3].ifNoneMatch, null, "late GET after auth.clear must not repopulate ETag cache");

  // Case 3: auth.logout() while GET is in flight
  await mod.api.auth.login("user2", "pw");
  const g3 = deferred();
  pendingGets.push({ hold: true, gate: g3, etag: 'W/"stale-3"' });
  const inFlight3 = mod.api.events.list({ group_id: 4 });
  await Promise.resolve();
  const logoutPromise = mod.api.auth.logout();
  g3.resolve();
  await Promise.all([inFlight3, logoutPromise]);
  await mod.api.events.list({ group_id: 4 });
  assert.equal(seen[5].ifNoneMatch, null, "late GET after auth.logout must not repopulate ETag cache");
});
