import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const source = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'sw.js'), 'utf8');
const ORIGIN = 'http://fairshift.test';
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const copy = (value) => JSON.parse(JSON.stringify(value));

/** In a service worker a relative URL means "on my own origin"; Node's Request needs that spelled out. */
class WorkerRequest extends Request {
  constructor(input, init) {
    super(typeof input === 'string' && input.startsWith('/') ? `${ORIGIN}${input}` : input, init);
  }
}

/** A tiny IndexedDB: the three object stores sw.js reads and writes, with the calls it makes. */
function fakeIndexedDB({ exists = true } = {}) {
  const stores = { items: new Map(), meta: new Map(), snapshots: new Map() };
  const keyPath = { items: 'id', meta: 'key', snapshots: 'key' };
  const respond = (compute) => {
    const request = {};
    tick().then(() => {
      request.result = compute();
      request.onsuccess?.();
    });
    return request;
  };
  const db = {
    close() {},
    transaction(name) {
      const map = stores[name];
      return {
        objectStore: () => ({
          getAll: () => respond(() => [...map.values()].map(copy)),
          get: (key) => respond(() => copy(map.get(key) ?? null) ?? undefined),
          put: (value) => respond(() => map.set(value[keyPath[name]], copy(value))),
        }),
      };
    },
  };
  return {
    stores,
    open() {
      const request = {};
      tick().then(() => {
        if (!exists) {
          request.transaction = { abort: () => tick().then(() => request.onerror?.()) };
          request.onupgradeneeded?.();
          return;
        }
        request.result = db;
        request.onsuccess?.();
      });
      return request;
    },
  };
}

/** Runs sw.js the way a browser would, with fakes for everything it touches. */
function loadWorker({ fetchImpl = async () => new Response('', { status: 200 }), exists = true } = {}) {
  const listeners = {};
  const caches = new Map();
  const cacheApi = {
    keys: async () => [...caches.keys()],
    delete: async (name) => caches.delete(name),
    open: async (name) => {
      if (!caches.has(name)) caches.set(name, new Map());
      const store = caches.get(name);
      const keyOf = (request) => (typeof request === 'string' ? request : (request.url ? new URL(request.url).pathname : String(request)));
      return {
        add: async (request) => {
          const response = await fetchImpl(request);
          store.set(keyOf(request), response);
        },
        put: async (request, response) => void store.set(keyOf(request), response),
        match: async (request) => store.get(keyOf(request)),
      };
    },
  };
  const indexedDB = fakeIndexedDB({ exists });
  const messages = [];
  const sandbox = {
    indexedDB,
    caches: cacheApi,
    fetch: (...args) => fetchImpl(...args),
    Request: WorkerRequest,
    Response,
    URL,
    AbortSignal,
    navigator: {},
    clients: { matchAll: async () => [{ postMessage: (m) => messages.push(m) }], claim: async () => {} },
    skipWaiting: async () => {},
    addEventListener: (type, handler) => (listeners[type] ??= []).push(handler),
    location: { origin: ORIGIN },
  };
  sandbox.self = sandbox;
  vm.runInContext(source, vm.createContext(sandbox));
  const dispatch = async (type, event) => {
    let pending = Promise.resolve();
    await listeners[type][0]({ ...event, waitUntil: (p) => (pending = p), respondWith: (p) => (pending = p) });
    return pending;
  };
  return { dispatch, caches, cacheApi, indexedDB, messages, listeners };
}

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const queued = (n, extra = {}) => ({
  id: `k${n}`, key: `idem-key-${n}-0123456789abcdefghij`, seq: n, kind: 'report', anonymous: false, ownerId: 'w1', status: 'queued', attempts: 0, nextAttemptAt: 0,
  capturedAt: Date.now() - 60_000, deferred: true, request: { method: 'POST', path: '/grievances', body: { category: 'pay', text: `report ${n}` } }, lastError: null, ...extra,
});
const anonItem = (n, extra = {}) => queued(n, { anonymous: true, ownerId: null, request: { method: 'POST', path: '/anonymous/feedback', body: { subject: 'manager', rating: 4 } }, ...extra });
const seed = (worker, items, meta = {}) => {
  for (const item of items) worker.indexedDB.stores.items.set(item.id, copy(item));
  for (const [key, value] of Object.entries(meta)) worker.indexedDB.stores.meta.set(key, { key, value });
};
const statusOf = (worker, id) => worker.indexedDB.stores.items.get(id).status;
const tokenMeta = { token: 'anon.token.value', expiresAt: Date.now() + 7 * 24 * 3600_000 };

describe('service worker: the app shell', () => {
  test('installs by storing every file in /precache.json, under a cache named for the release', async () => {
    const fetched = [];
    const worker = loadWorker({
      fetchImpl: async (request) => {
        const url = typeof request === 'string' ? request : request.url;
        fetched.push(new URL(url, ORIGIN).pathname);
        return url.endsWith('/precache.json') ? json(200, { version: 'abc123', urls: ['/', '/worker/', '/shared/api.js'] }) : new Response('file', { status: 200 });
      },
    });
    await worker.dispatch('install', {});
    assert.deepEqual([...worker.caches.keys()], ['fairshift-static-abc123']);
    assert.deepEqual(fetched.slice(1), ['/', '/worker/', '/shared/api.js']);
  });

  test('a failed download fails the install, so a half-stored shell is never activated', async () => {
    const worker = loadWorker({
      fetchImpl: async (request) => {
        const url = typeof request === 'string' ? request : request.url;
        if (url.endsWith('/precache.json')) return json(200, { version: 'v', urls: ['/shared/missing.js'] });
        throw new TypeError('network');
      },
    });
    await assert.rejects(worker.dispatch('install', {}));
  });

  test('activating removes the caches of older releases only', async () => {
    const worker = loadWorker();
    await worker.cacheApi.open('fairshift-static-old');
    await worker.cacheApi.open('someone-elses-cache');
    await worker.dispatch('install', {}).catch(() => {});
    await worker.dispatch('activate', {});
    const names = [...worker.caches.keys()];
    assert.ok(!names.includes('fairshift-static-old'));
    assert.ok(names.includes('someone-elses-cache'));
  });

  test('offline, the worker app page and its scripts come from the stored copy', async () => {
    let online = true;
    const worker = loadWorker({ fetchImpl: async (request) => (online ? new Response(`copy of ${new URL(request.url ?? request, ORIGIN).pathname}`, { status: 200 }) : Promise.reject(new TypeError('offline'))) });
    await worker.cacheApi.open('fairshift-static-v1');
    const ask = (url, init = {}) => {
      const request = new Request(`${ORIGIN}${url}`, init);
      return worker.dispatch('fetch', { request }).then((r) => r.text?.() ?? r);
    };
    for (const url of ['/worker/', '/shared/outbox.js', '/i18n/hi.json']) assert.equal(await ask(url, url === '/worker/' ? { headers: {} } : {}), `copy of ${url}`);
    online = false;
    assert.equal(await ask('/shared/outbox.js'), 'copy of /shared/outbox.js');
    assert.equal(await ask('/i18n/hi.json'), 'copy of /i18n/hi.json');
  });

  test('it leaves the API, other origins and writes alone (never cached, never answered)', async () => {
    const worker = loadWorker();
    let answered = 0;
    const handler = (request) => worker.listeners.fetch[0]({ request, respondWith: () => (answered += 1) });
    handler(new Request(`${ORIGIN}/api/me`));
    handler(new Request(`${ORIGIN}/api/attendance/today`));
    handler(new Request('https://elsewhere.example/shared/api.js'));
    handler(new Request(`${ORIGIN}/shared/api.js`, { method: 'POST' }));
    assert.equal(answered, 0);
    handler(new Request(`${ORIGIN}/shared/api.js`));
    assert.equal(answered, 1);
  });
});

describe('service worker: Background Sync sends the outbox', () => {
  const run = (worker) => worker.dispatch('sync', { tag: 'fairshift-outbox' });

  test('ignores other sync tags', async () => {
    const worker = loadWorker({ fetchImpl: async () => assert.fail('must not send') });
    seed(worker, [queued(1)]);
    await worker.dispatch('sync', { tag: 'something-else' });
    assert.equal(statusOf(worker, 'k1'), 'queued');
  });

  test('sends waiting items oldest first, with the key, the owner and the capture time; marks them sent', async () => {
    const calls = [];
    const worker = loadWorker({ fetchImpl: async (url, init) => (calls.push({ url, init, body: JSON.parse(init.body) }), json(201, {})) });
    seed(worker, [queued(2), queued(1), queued(3, { status: 'synced' })]);
    await run(worker);
    assert.deepEqual(calls.map((c) => c.body.text), ['report 1', 'report 2'], 'in capture order; the sent one is left alone');
    const [first] = calls;
    assert.equal(first.url, '/api/grievances');
    assert.equal(first.init.headers['idempotency-key'], 'idem-key-1-0123456789abcdefghij');
    assert.equal(first.init.headers['x-fairshift-owner'], 'w1');
    assert.equal(first.init.credentials, 'same-origin');
    assert.equal(typeof first.body.capturedAt, 'number', 'a delayed item says when it was done');
    for (const id of ['k1', 'k2']) {
      const item = worker.indexedDB.stores.items.get(id);
      assert.deepEqual([item.status, item.request.body, item.lastError], ['synced', null, null]);
    }
    assert.deepEqual(copy(worker.messages), [{ type: 'outbox-changed' }], 'open pages are told to refresh');
  });

  test('anonymous items go with the organisation token and no cookie, owner or worker header', async () => {
    const calls = [];
    const worker = loadWorker({ fetchImpl: async (url, init) => (calls.push({ url, init }), json(201, {})) });
    seed(worker, [anonItem(1)], { anonToken: tokenMeta });
    await run(worker);
    const { url, init } = calls[0];
    assert.equal(url, '/api/anonymous/feedback');
    assert.equal(init.credentials, 'omit');
    assert.equal(init.headers.authorization, `Bearer ${tokenMeta.token}`);
    assert.deepEqual(Object.keys(init.headers).filter((h) => /owner|app|cookie/i.test(h)), []);
    assert.ok(!init.body.includes('w1'));
  });

  test('an expired anonymous token is renewed once with the worker\'s session, then the item is sent', async () => {
    const calls = [];
    const worker = loadWorker({
      fetchImpl: async (url, init) => {
        calls.push(url);
        if (url === '/api/anonymous/token') return json(200, { token: 'fresh.token.value', expiresAt: Date.now() + 7 * 24 * 3600_000 });
        return init.headers.authorization === 'Bearer fresh.token.value' ? json(201, {}) : json(401, { error: { code: 'unauthorized' } });
      },
    });
    seed(worker, [anonItem(1)], { anonToken: { token: 'stale.token.value', expiresAt: Date.now() + 60_000 } });
    await run(worker);
    assert.deepEqual(calls, ['/api/anonymous/token', '/api/anonymous/feedback'], 'a token about to lapse is renewed first');
    assert.equal(statusOf(worker, 'k1'), 'synced');
    assert.equal(worker.indexedDB.stores.meta.get('anonToken').value.token, 'fresh.token.value');
  });

  test('401: the item and the ones behind it stay queued, and "needs sign-in" is recorded for the page', async () => {
    const calls = [];
    const worker = loadWorker({ fetchImpl: async (url) => (calls.push(url), json(401, { error: { code: 'unauthorized' } })) });
    seed(worker, [queued(1), queued(2)]);
    await run(worker);
    assert.equal(calls.length, 1, 'does not try the rest with a lapsed session');
    assert.deepEqual([statusOf(worker, 'k1'), statusOf(worker, 'k2')], ['queued', 'queued']);
    assert.equal(worker.indexedDB.stores.items.get('k1').attempts, 0);
    assert.equal(worker.indexedDB.stores.meta.get('needsSignIn').value, true);
  });

  test('409 wrong_account is also "sign in as the right person", not a failure', async () => {
    const worker = loadWorker({ fetchImpl: async () => json(409, { error: { code: 'wrong_account' } }) });
    seed(worker, [queued(1)]);
    await run(worker);
    assert.equal(statusOf(worker, 'k1'), 'queued');
    assert.equal(worker.indexedDB.stores.meta.get('needsSignIn').value, true);
  });

  test('a firm "no" marks that item failed and carries on; a signal problem stops, counts a try, and asks the browser to retry', async () => {
    const worker = loadWorker({ fetchImpl: async (url, init) => (JSON.parse(init.body).text === 'report 1' ? json(422, { error: { code: 'invalid_code' } }) : Promise.reject(new TypeError('offline'))) });
    seed(worker, [queued(1), queued(2), queued(3)]);
    await assert.rejects(run(worker), /retry_later/, 'rejecting makes the browser fire the sync event again later');
    const first = worker.indexedDB.stores.items.get('k1');
    assert.deepEqual([first.status, first.lastError], ['failed', { status: 422, code: 'invalid_code' }]);
    const second = worker.indexedDB.stores.items.get('k2');
    assert.deepEqual([second.status, second.attempts, second.lastError.code, second.deferred], ['queued', 1, 'network', true]);
    assert.ok(second.nextAttemptAt > Date.now());
    assert.equal(statusOf(worker, 'k3'), 'queued', 'untouched: the pass stopped');
  });

  test('after six passes with no signal an item shows "failed, retry"', async () => {
    const worker = loadWorker({ fetchImpl: async () => json(503, { error: { code: 'store_unavailable' } }) });
    seed(worker, [queued(1, { attempts: 5 })]);
    await assert.rejects(run(worker));
    assert.deepEqual([statusOf(worker, 'k1'), worker.indexedDB.stores.items.get('k1').attempts], ['failed', 6]);
  });

  test('an item captured more than 48 hours ago is failed without being sent', async () => {
    const worker = loadWorker({ fetchImpl: async () => assert.fail('must not send') });
    seed(worker, [queued(1, { capturedAt: Date.now() - 49 * 3600_000 })]);
    await run(worker);
    assert.deepEqual(worker.indexedDB.stores.items.get('k1').lastError, { status: 422, code: 'captured_too_old' });
  });

  test('an item that was not delayed is sent as it was made, without a capture time', async () => {
    const bodies = [];
    const worker = loadWorker({ fetchImpl: async (url, init) => (bodies.push(JSON.parse(init.body)), json(201, {})) });
    seed(worker, [queued(1, { deferred: false })]);
    await run(worker);
    assert.equal('capturedAt' in bodies[0], false);
  });

  test('with no database yet there is nothing to send and nothing breaks', async () => {
    const worker = loadWorker({ exists: false, fetchImpl: async () => assert.fail('must not send') });
    await run(worker);
  });
});
