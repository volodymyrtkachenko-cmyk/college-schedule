const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../lib/api.ts'), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
}}).outputText;
function setup(fetch) {
  const context = { exports: {}, process: { env: {} }, Headers, console, fetch };
  vm.runInNewContext(code, context);
  return context.exports.api;
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
