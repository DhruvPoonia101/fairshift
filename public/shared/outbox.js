import { ApiError, api } from './api.js';
import { specFor } from './actions.js';
import { createIdbStorage, idb, openOutboxDb } from './offline-db.js';
import { createMemoryStorage, createQueue, describeQueue } from './queue.js';
import { newIdempotencyKey } from './tracking-code.js';

/**
 * The offline outbox as the worker app uses it: queue.js (the rules) + IndexedDB (so waiting actions survive a
 * closed app) + fetch. Sending happens
 *   - right away when the worker acts and there is a signal,
 *   - when the browser says it is back online,
 *   - when the app is opened or comes to the front,
 *   - every 30 s while something waits,
 *   - from the service worker through Background Sync (Chromium), even with the app closed,
 *   - and on the "Sync now" button.
 * Every send carries the item's Idempotency-Key, so doing it twice is harmless.
 */

const SYNC_TAG = 'fairshift-outbox';
const LOCK_NAME = 'fairshift-outbox';
const REQUEST_TIMEOUT_MS = 15_000;
const RETRY_INTERVAL_MS = 30_000;
const TOKEN_MIN_LIFE_MS = 60 * 60_000;
const STALE_STATUS = 500;
/** A screen waits this long for the server before showing the saved copy (a weak signal can hang for a long time). */
const SAVED_COPY_AFTER_MS = 6_000;

const listeners = new Set();
let queue = null;
let store = null; // IndexedDB helpers, or null when the browser does not allow it (the queue then lives in memory)
let session = null;
let items = [];
let needsSignIn = false;

const emit = () => [...listeners].forEach((listener) => listener());
const isOnline = () => navigator.onLine !== false;

async function refresh() {
  items = await queue.list();
  emit();
}

const readMeta = async (key) => (store ? (await store.get('meta', key))?.value : undefined);
const writeMeta = (key, value) => store?.put('meta', { key, value }).catch(() => {});

/**
 * The token for anonymous submissions: "a worker of this organisation", not a person (see src/middleware/auth.js).
 * Fetched with the worker's session while there is a signal, then kept on the phone for the queue to use.
 */
async function anonymousToken({ force = false } = {}) {
  const saved = await readMeta('anonToken');
  if (!force && saved && saved.expiresAt - Date.now() > TOKEN_MIN_LIFE_MS) return saved.token;
  if (!isOnline()) return saved && saved.expiresAt > Date.now() ? saved.token : null;
  try {
    // A plain fetch, not api(): when the sign-in has lapsed, the outbox must keep its items and say so in the
    // banner, not send the worker away to the sign-in page in the middle of a sync.
    const response = await fetch('/api/anonymous/token', { credentials: 'same-origin', headers: { 'x-fairshift-app': 'worker' } });
    if (!response.ok) return saved && saved.expiresAt > Date.now() ? saved.token : null;
    const fresh = await response.json();
    await writeMeta('anonToken', fresh);
    return fresh.token;
  } catch {
    return saved && saved.expiresAt > Date.now() ? saved.token : null;
  }
}

async function post(item, token) {
  // Sent later than it was done? Then say when it was done; the server checks that time and marks it "recorded offline".
  const body = item.deferred ? { ...item.request.body, capturedAt: item.capturedAt } : item.request.body;
  const headers = { 'content-type': 'application/json', 'idempotency-key': item.key };
  const init = item.anonymous
    ? // No cookie, no worker id: the request says only "a worker of this organisation".
      { credentials: 'omit', headers: { ...headers, authorization: `Bearer ${token}` } }
    : { credentials: 'same-origin', headers: { ...headers, 'x-fairshift-app': 'worker', 'x-fairshift-owner': item.ownerId } };
  try {
    const response = await fetch(`/api${item.request.path}`, {
      method: item.request.method,
      body: JSON.stringify(body),
      signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(REQUEST_TIMEOUT_MS) : undefined,
      ...init,
    });
    const data = await response.json().catch(() => null);
    return { status: response.status, code: data?.error?.code };
  } catch {
    return { network: true };
  }
}

/** One send, as queue.sync expects it: { status, code } or { network: true }. */
async function send(item) {
  if (!item.anonymous) return post(item);
  const token = await anonymousToken();
  if (!token) return { status: 401, code: 'unauthorized' };
  const result = await post(item, token);
  if (result.status !== 401) return result;
  // The saved token may have lapsed: ask for a fresh one once.
  const fresh = await anonymousToken({ force: true });
  return fresh && fresh !== token ? post(item, fresh) : result;
}

async function runSync({ force = false } = {}) {
  if (!queue || (!isOnline() && !force)) return null;
  const pass = () => queue.sync({ send, ownerId: session.user.id, force });
  const summary = navigator.locks ? await navigator.locks.request(LOCK_NAME, pass) : await pass();
  needsSignIn = summary.needsSignIn;
  await writeMeta('needsSignIn', needsSignIn);
  await refresh();
  return summary;
}

/** Asks the browser to wake the service worker when the connection returns (Background Sync, Chromium only). */
function requestBackgroundSync() {
  navigator.serviceWorker?.ready.then((registration) => registration.sync?.register(SYNC_TAG)).catch(() => {});
}

/**
 * Opens the outbox for the signed-in worker. Call once, before the screens are drawn.
 * @param {{ user: { id: string } }} workerSession
 */
export async function startOutbox(workerSession) {
  session = workerSession;
  let storage;
  try {
    store = idb(await openOutboxDb());
    storage = createIdbStorage(store);
  } catch {
    store = null;
    storage = createMemoryStorage(); // e.g. a private window: it works, but waiting items do not survive a reload
  }
  queue = createQueue({ storage, newKey: newIdempotencyKey });
  needsSignIn = Boolean(await readMeta('needsSignIn'));
  await dropOtherPeoplesCopies();
  await queue.prune();
  await refresh();

  window.addEventListener('online', () => runSync());
  window.addEventListener('offline', emit);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && refresh().then(() => runSync()));
  navigator.serviceWorker?.addEventListener('message', (event) => event.data?.type === 'outbox-changed' && refresh());
  setInterval(() => items.some((i) => i.status === 'queued') && runSync(), RETRY_INTERVAL_MS);

  anonymousToken().catch(() => {});
  runSync();
  return outbox;
}

/** Saved copies of screens belong to one worker; on a shared phone the next worker never sees them. */
async function dropOtherPeoplesCopies() {
  if (!store) return;
  const mine = `${session.user.id}|`;
  for (const snapshot of await store.getAll('snapshots')) if (!snapshot.key.startsWith(mine)) await store.delete('snapshots', snapshot.key);
}

export const outbox = {
  isOnline,
  items: () => items,
  describe: () => describeQueue(items, { online: isOnline(), needsSignIn }),
  onChange(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /**
   * Does something that must reach the server: sends it now if there is a signal, otherwise keeps it.
   * Resolves with { status: 'sent' | 'queued', item }. Rejects with an ApiError only when the server says no
   * to something the worker is looking at right now (for example "that QR is not valid today").
   * @param {'checkin' | 'checkout' | 'report' | 'dispute' | 'feedback'} kind
   */
  async submit(kind, payload) {
    const startedAt = Date.now();
    const spec = specFor(kind, payload, { ownerId: session.user.id });
    const { item, deduped } = await queue.enqueue({ ...spec, deferred: !isOnline() });
    await refresh();
    if (!isOnline()) {
      requestBackgroundSync();
      return { status: 'queued', item, deduped };
    }
    await runSync();
    const after = items.find((i) => i.id === item.id) ?? item;
    if (after.status === 'synced') return { status: 'sent', item: after, deduped };
    if (after.status === 'failed' && (after.lastAttemptAt ?? 0) >= startedAt && after.lastError.status >= 400 && after.lastError.status < STALE_STATUS) {
      await queue.discard(after.id); // the worker is looking at the error now, so it does not stay in the list
      await refresh();
      throw new ApiError(after.lastError.status, after.lastError.code);
    }
    requestBackgroundSync();
    return { status: 'queued', item: after, deduped };
  },

  /** "Sync now": sends what is waiting, ignoring the back-off. Items that failed stay failed until "Try again". */
  syncNow: () => runSync({ force: true }),
  /** "Try again" for every failed item at once. */
  async retryFailed() {
    await queue.retryAll();
    await refresh();
    return runSync({ force: true });
  },
  retry: async (id) => {
    await queue.retry(id);
    await refresh();
    return runSync({ force: true });
  },
  discard: async (id) => {
    await queue.discard(id);
    await refresh();
  },

  /**
   * The last good copy of a screen's data, for when there is no signal. Never for anything the worker could
   * be tricked into acting on twice: it is only shown, with a "saved copy" notice.
   * @returns {Promise<{ data: any, stale: boolean, savedAt: number | null }>}
   */
  async cachedApi(path) {
    const key = `${session.user.id}|${path}`;
    const fromSaved = async (error) => {
      const saved = await store?.get('snapshots', key).catch(() => null);
      if (!saved) throw error;
      return { data: saved.data, stale: true, savedAt: saved.savedAt };
    };
    if (!isOnline()) return fromSaved(new TypeError('offline')); // no point waiting for a connection we know is not there
    try {
      const data = await Promise.race([api(path), new Promise((_, reject) => setTimeout(() => reject(new TypeError('timeout')), SAVED_COPY_AFTER_MS))]);
      await store?.put('snapshots', { key, data, savedAt: Date.now() }).catch(() => {});
      return { data, stale: false, savedAt: null };
    } catch (error) {
      if (error instanceof ApiError && error.status < STALE_STATUS) throw error;
      return fromSaved(error);
    }
  },
};
