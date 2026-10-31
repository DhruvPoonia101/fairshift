/*
 * Service worker.
 *  1. App shell: everything the worker app needs is stored at install time (the list comes from
 *     /precache.json, built by the server from the files in public/), so the worker app opens with no signal.
 *     Static files are network-first, so a new release is never hidden behind old scripts; the stored copy is
 *     only the fallback. API calls and personal data are never cached here.
 *  2. Background Sync: when the connection returns (Chromium), the waiting actions in the outbox are sent even
 *     if the app is closed. The rules are the ones in public/shared/queue.js, written out again here because a
 *     classic service worker cannot import a module; tests/offline-sw.test.js keeps the numbers equal.
 */
const CACHE_PREFIX = 'fairshift-static-';
const STATIC_PATH = /^\/(shared|worker|admin|passport|i18n)\/|^\/(landing\.(js|css)|icon\.svg|manifest\.webmanifest)$/;
const SHELL_PAGES = ['/', '/worker/'];

const SYNC_TAG = 'fairshift-outbox';
const LOCK_NAME = 'fairshift-outbox';
const DB_NAME = 'fairshift-outbox';
const MAX_ATTEMPTS = 6;
const BASE_BACKOFF_MS = 5000;
const MAX_BACKOFF_MS = 300000;
const MAX_CAPTURE_AGE_MS = 172800000; // 48 hours
const TOKEN_MIN_LIFE_MS = 3600000;
const REQUEST_TIMEOUT_MS = 15000;

let cacheName = `${CACHE_PREFIX}unversioned`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    fetch('/precache.json', { cache: 'no-store' })
      .then((response) => response.json())
      .then(({ version, urls }) => {
        cacheName = `${CACHE_PREFIX}${version}`;
        return caches.open(cacheName).then((cache) => Promise.all(urls.map((url) => cache.add(new Request(url, { cache: 'reload' })))));
      })
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n.startsWith(CACHE_PREFIX) && n !== cacheName).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

/** The cache of the current release (found again by name after the worker was stopped and restarted). */
async function currentCache() {
  const names = (await caches.keys()).filter((n) => n.startsWith(CACHE_PREFIX));
  return caches.open(names.includes(cacheName) ? cacheName : (names.at(-1) ?? cacheName));
}

// Network first, the stored copy as the offline fallback.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  const path = url.pathname === '/worker' ? '/worker/' : url.pathname;
  const isShellPage = request.mode === 'navigate' && SHELL_PAGES.includes(path);
  if (!isShellPage && !STATIC_PATH.test(url.pathname)) return;
  // A page is stored under its plain path, so "/worker/?x=1" and "/worker" find the same copy.
  const key = isShellPage ? new Request(path) : request;
  event.respondWith(
    currentCache().then((cache) =>
      fetch(request)
        .then((response) => {
          if (response.ok) cache.put(key, response.clone());
          return response;
        })
        .catch(() => cache.match(key, { ignoreSearch: true }).then((saved) => saved ?? Promise.reject(new Error('offline')))),
    ),
  );
});

// ---------------------------------------------------------------- Background Sync ----------------------------------------------------------------

const tx = (store, mode, run) =>
  new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME);
    // The page creates the database; if it does not exist yet there is nothing waiting to send.
    open.onupgradeneeded = () => open.transaction.abort();
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const result = run(db.transaction(store, mode).objectStore(store));
      result.onsuccess = () => {
        db.close();
        resolve(result.result);
      };
      result.onerror = () => reject(result.error);
    };
  });
const readAll = (store) => tx(store, 'readonly', (s) => s.getAll());
const readOne = (store, key) => tx(store, 'readonly', (s) => s.get(key));
const write = (store, value) => tx(store, 'readwrite', (s) => s.put(value));

const backoff = (attempts) => Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1));

async function anonymousToken(force) {
  const saved = (await readOne('meta', 'anonToken'))?.value;
  if (!force && saved && saved.expiresAt - Date.now() > TOKEN_MIN_LIFE_MS) return saved.token;
  try {
    const response = await fetch('/api/anonymous/token', { headers: { 'x-fairshift-app': 'worker' }, credentials: 'same-origin' });
    if (!response.ok) return null;
    const fresh = await response.json();
    await write('meta', { key: 'anonToken', value: fresh });
    return fresh.token;
  } catch {
    return saved && saved.expiresAt > Date.now() ? saved.token : null;
  }
}

async function post(item, token) {
  const body = item.deferred ? { ...item.request.body, capturedAt: item.capturedAt } : item.request.body;
  const headers = { 'content-type': 'application/json', 'idempotency-key': item.key };
  const init = item.anonymous
    ? { credentials: 'omit', headers: { ...headers, authorization: `Bearer ${token}` } }
    : { credentials: 'same-origin', headers: { ...headers, 'x-fairshift-app': 'worker', 'x-fairshift-owner': item.ownerId } };
  try {
    const response = await fetch(`/api${item.request.path}`, {
      method: item.request.method,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      ...init,
    });
    const data = await response.json().catch(() => null);
    return { status: response.status, code: data?.error?.code };
  } catch {
    return { network: true };
  }
}

async function send(item) {
  if (!item.anonymous) return post(item);
  const token = await anonymousToken(false);
  if (!token) return { status: 401, code: 'unauthorized' };
  const result = await post(item, token);
  if (result.status !== 401) return result;
  const fresh = await anonymousToken(true);
  return fresh && fresh !== token ? post(item, fresh) : result;
}

/** Same steps as queue.js `sync`, one pass, oldest first. Throws when something should be tried again later. */
async function flushOutbox() {
  let all;
  try {
    all = await readAll('items');
  } catch {
    return; // no database yet: nothing was ever queued
  }
  const waiting = all.filter((i) => i.status === 'queued' || i.status === 'syncing').sort((a, b) => a.seq - b.seq);
  let tryAgain = false;
  let needsSignIn = false;
  for (const item of waiting) {
    if (item.deferred && Date.now() - item.capturedAt > MAX_CAPTURE_AGE_MS) {
      await write('items', { ...item, status: 'failed', lastError: { status: 422, code: 'captured_too_old' }, updatedAt: Date.now() });
      continue;
    }
    await write('items', { ...item, status: 'syncing', lastAttemptAt: Date.now(), updatedAt: Date.now() });
    const result = await send(item);
    const status = result.status ?? 0;
    if (status >= 200 && status < 300) {
      await write('items', { ...item, status: 'synced', syncedAt: Date.now(), lastError: null, request: { ...item.request, body: null }, updatedAt: Date.now() });
    } else if (status === 401 || (status === 409 && result.code === 'wrong_account')) {
      await write('items', { ...item, status: 'queued', lastError: { status, code: result.code ?? 'unauthorized' }, updatedAt: Date.now() });
      needsSignIn = true;
      break;
    } else if (result.network || status === 0 || status === 408 || status === 425 || status === 429 || status >= 500) {
      const attempts = item.attempts + 1;
      await write('items', {
        ...item,
        status: attempts >= MAX_ATTEMPTS ? 'failed' : 'queued',
        attempts,
        deferred: true,
        nextAttemptAt: Date.now() + backoff(attempts),
        lastError: { status, code: result.code ?? (result.network ? 'network' : 'server_error') },
        updatedAt: Date.now(),
      });
      tryAgain = true;
      break;
    } else {
      await write('items', { ...item, status: 'failed', lastError: { status, code: result.code ?? 'server_error' }, updatedAt: Date.now() });
    }
  }
  await write('meta', { key: 'needsSignIn', value: needsSignIn });
  const windows = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  for (const client of windows) client.postMessage({ type: 'outbox-changed' });
  if (tryAgain) throw new Error('retry_later'); // the browser fires the sync event again later
}

self.addEventListener('sync', (event) => {
  if (event.tag !== SYNC_TAG) return;
  event.waitUntil(navigator.locks ? navigator.locks.request(LOCK_NAME, flushOutbox) : flushOutbox());
});
