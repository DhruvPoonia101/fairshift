/**
 * The offline outbox: what the worker did without a signal, waiting to be sent.
 *
 * This file is pure logic (no DOM, no fetch, no IndexedDB): storage and the network call are passed in,
 * so ordering, retries, de-duplication and failure handling can all be tested with node:test.
 * `outbox.js` joins it to IndexedDB and fetch; `sw.js` runs the same steps for Background Sync.
 *
 * An item moves queued -> syncing -> synced, or -> failed (the server said no, or it ran out of tries).
 * Every item has an idempotency key made when it was queued, so sending it twice never does the work twice.
 */

export const KINDS = Object.freeze(['checkin', 'checkout', 'report', 'dispute', 'feedback']);
export const STATUS = Object.freeze({ QUEUED: 'queued', SYNCING: 'syncing', SYNCED: 'synced', FAILED: 'failed' });

/** After this many tries that failed for a reason that may pass (no signal, server busy), an item shows "failed, retry". */
export const MAX_ATTEMPTS = 6;
export const BASE_BACKOFF_MS = 5_000;
export const MAX_BACKOFF_MS = 5 * 60_000;
/** The server refuses anything captured longer ago than this (src/config/constants.js OFFLINE.MAX_CAPTURE_AGE_MS). */
export const MAX_CAPTURE_AGE_MS = 48 * 60 * 60_000;
/** How long a sent item stays in the list before it is tidied away. */
export const SYNCED_KEEP_MS = 24 * 60 * 60_000;
/** Fields that would say who made an item. An anonymous item must never carry any of them. */
const IDENTITY_FIELDS = Object.freeze(['ownerId', 'workerId', 'userId', 'name', 'identity']);

/**
 * What an answer from the server means for an item.
 * - success: done.
 * - auth: not signed in (401), or someone else is signed in on this phone. Keep the item, ask for sign-in.
 * - transient: may pass by itself (no signal, timeout, 429, 5xx). Try again later.
 * - permanent: the server understood and said no (a stale QR, a bad time, a duplicate). Retrying will not help.
 * @param {{ status?: number, code?: string, network?: boolean }} result
 */
export function classify({ status = 0, code, network = false } = {}) {
  if (network) return 'transient';
  if (status >= 200 && status < 300) return 'success';
  if (status === 401 || (status === 409 && code === 'wrong_account')) return 'auth';
  if (status === 0 || status === 408 || status === 425 || status === 429 || status >= 500) return 'transient';
  return 'permanent';
}

/** 5 s, 10 s, 20 s ... never more than 5 minutes. */
export const backoffMs = (attempts) => Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1));

/** Everything in memory: used by the tests, and by the app where IndexedDB is not available. */
export function createMemoryStorage() {
  const items = new Map();
  let seq = 0;
  return {
    async all() {
      return [...items.values()].map((i) => structuredClone(i));
    },
    async put(item) {
      items.set(item.id, structuredClone(item));
    },
    async remove(id) {
      items.delete(id);
    },
    async nextSeq() {
      seq += 1;
      return seq;
    },
  };
}

const bySeq = (a, b) => a.seq - b.seq;
const isOpen = (item) => item.status === STATUS.QUEUED || item.status === STATUS.SYNCING;

/**
 * @param {object} options
 * @param {{ all: () => Promise<object[]>, put: (item: object) => Promise<void>, remove: (id: string) => Promise<void>, nextSeq: () => Promise<number> }} options.storage
 * @param {() => number} [options.now]
 * @param {() => string} options.newKey makes a unique idempotency key
 */
export function createQueue({ storage, now = Date.now, newKey }) {
  let running = null;

  const list = async () => (await storage.all()).sort(bySeq);

  async function save(item, patch) {
    Object.assign(item, patch, { updatedAt: now() });
    await storage.put(item);
    return item;
  }

  /** Same meaning (what, for whom) ignoring the capture time and the tracking code (a double tap makes a new code). */
  function basisOf(spec) {
    const { capturedAt, trackingCode, ...rest } = spec.request.body ?? {};
    return JSON.stringify([spec.kind, spec.anonymous, spec.ownerId ?? null, spec.request.path, Object.entries(rest).sort(([a], [b]) => a.localeCompare(b))]);
  }

  return {
    list,

    /**
     * Saves an action so it survives a closed app. The same action tapped twice is kept once.
     * @param {{ kind: string, anonymous?: boolean, ownerId?: string | null, request: { path: string, method?: string, body: object }, display?: object, trackingCode?: string, capturedAt?: number, deferred?: boolean }} spec
     * @returns {Promise<{ item: object, deduped: boolean }>}
     */
    async enqueue(spec) {
      if (!KINDS.includes(spec.kind)) throw new Error(`unknown_kind:${spec.kind}`);
      const anonymous = Boolean(spec.anonymous);
      if (anonymous && IDENTITY_FIELDS.some((field) => spec[field] != null || spec.display?.[field] != null || spec.request.body?.[field] != null)) {
        throw new Error('anonymous_item_has_identity');
      }
      const clean = { ...spec, anonymous, ownerId: anonymous ? null : (spec.ownerId ?? null) };
      const basis = basisOf(clean);
      const existing = (await list()).find((i) => isOpen(i) && i.basis === basis);
      if (existing) return { item: existing, deduped: true };

      const key = newKey();
      const open = (await list()).some(isOpen);
      const t = now();
      const item = {
        id: key,
        key,
        seq: await storage.nextSeq(),
        kind: clean.kind,
        anonymous,
        ownerId: clean.ownerId,
        basis,
        capturedAt: clean.capturedAt ?? t,
        request: { method: 'POST', ...clean.request },
        display: clean.display ?? {},
        ...(clean.trackingCode ? { trackingCode: clean.trackingCode } : {}),
        // "deferred" = it will not be sent the moment it is made (offline, or behind older items), so the
        // request carries the time it was captured and the server records it as recorded offline.
        deferred: Boolean(clean.deferred) || open,
        status: STATUS.QUEUED,
        attempts: 0,
        nextAttemptAt: 0,
        lastError: null,
        createdAt: t,
        updatedAt: t,
        syncedAt: null,
      };
      await storage.put(item);
      return { item, deduped: false };
    },

    /**
     * One pass over the queue, oldest first. One pass at a time: a second call waits for the first.
     * - Stops at the first item that failed for a passing reason (the rest would fail too) or that is still waiting out a back-off.
     * - A "no" from the server marks that item failed and carries on with the next.
     * - Not signed in: the item and the rest stay queued, and `needsSignIn` is set. Nothing is lost.
     * @param {{ send: (item: object) => Promise<{ status?: number, code?: string, network?: boolean }>, ownerId?: string | null, force?: boolean }} options
     *   `ownerId` is who is signed in now; items made by someone else are left for them. `force` ignores back-off ("Sync now").
     */
    sync({ send, ownerId = null, force = false }) {
      if (running) return running.then(() => this.sync({ send, ownerId, force }));
      running = (async () => {
        const summary = { synced: 0, failed: 0, remaining: 0, needsSignIn: false, stoppedBy: null };
        // Anything still "syncing" here was cut off by a closed tab: safe to send again, the key makes it idempotent.
        for (const stuck of (await list()).filter((i) => i.status === STATUS.SYNCING)) await save(stuck, { status: STATUS.QUEUED });

        for (const item of (await list()).filter((i) => i.status === STATUS.QUEUED)) {
          if (item.ownerId && ownerId && item.ownerId !== ownerId) {
            await save(item, { lastError: { status: 409, code: 'wrong_account' } });
            summary.needsSignIn = true;
            continue;
          }
          if (!force && item.nextAttemptAt > now()) {
            summary.stoppedBy = 'backoff';
            break;
          }
          if (item.deferred && now() - item.capturedAt > MAX_CAPTURE_AGE_MS) {
            await save(item, { status: STATUS.FAILED, lastError: { status: 422, code: 'captured_too_old' } });
            summary.failed += 1;
            continue;
          }

          await save(item, { status: STATUS.SYNCING, lastAttemptAt: now() });
          let result;
          try {
            result = await send(item);
          } catch {
            result = { network: true };
          }
          const outcome = classify(result);

          if (outcome === 'success') {
            // Keep only what the list needs: the text of a report is no longer kept on the phone.
            await save(item, { status: STATUS.SYNCED, syncedAt: now(), lastError: null, request: { ...item.request, body: null } });
            summary.synced += 1;
          } else if (outcome === 'permanent') {
            await save(item, { status: STATUS.FAILED, lastError: { status: result.status, code: result.code ?? 'server_error' } });
            summary.failed += 1;
          } else if (outcome === 'auth') {
            await save(item, { status: STATUS.QUEUED, lastError: { status: result.status, code: result.code ?? 'unauthorized' } });
            summary.needsSignIn = true;
            summary.stoppedBy = 'auth';
            break;
          } else {
            const attempts = item.attempts + 1;
            const exhausted = attempts >= MAX_ATTEMPTS;
            await save(item, {
              status: exhausted ? STATUS.FAILED : STATUS.QUEUED,
              attempts,
              deferred: true,
              nextAttemptAt: now() + backoffMs(attempts),
              lastError: { status: result.status ?? 0, code: result.code ?? (result.network ? 'network' : 'server_error') },
            });
            if (exhausted) summary.failed += 1;
            summary.stoppedBy = 'transient';
            break;
          }
        }
        summary.remaining = (await list()).filter(isOpen).length;
        return summary;
      })();
      const finish = () => {
        running = null;
      };
      running.then(finish, finish);
      return running;
    },

    /** "Try again" on a failed item: back in line, with a fresh set of attempts. */
    async retry(id) {
      const item = (await list()).find((i) => i.id === id);
      if (!item || item.status !== STATUS.FAILED) return null;
      return save(item, { status: STATUS.QUEUED, attempts: 0, nextAttemptAt: 0, lastError: null, deferred: true });
    },

    async retryAll() {
      const failed = (await list()).filter((i) => i.status === STATUS.FAILED);
      for (const item of failed) await this.retry(item.id);
      return failed.length;
    },

    /** Removes a failed or sent item. Waiting items are never removed this way: that would lose the worker's work. */
    async discard(id) {
      const item = (await list()).find((i) => i.id === id);
      if (!item || isOpen(item)) return false;
      await storage.remove(id);
      return true;
    },

    /** Tidies sent items away after a day. */
    async prune() {
      const old = (await list()).filter((i) => i.status === STATUS.SYNCED && now() - i.syncedAt > SYNCED_KEEP_MS);
      for (const item of old) await storage.remove(item.id);
      return old.length;
    },
  };
}

/**
 * What the banner says. `state` decides the look; `messageKey` and `params` are for t().
 * Priority: sign-in needed > offline > sending > failed > waiting.
 * @param {object[]} items
 * @param {{ online: boolean, needsSignIn?: boolean }} context
 */
export function describeQueue(items, { online, needsSignIn = false }) {
  const waiting = items.filter((i) => i.status === STATUS.QUEUED).length;
  const sending = items.filter((i) => i.status === STATUS.SYNCING).length;
  const failed = items.filter((i) => i.status === STATUS.FAILED).length;
  const pending = waiting + sending;
  const plural = (n) => (n === 1 ? 'one' : 'other');
  const base = { pending, failed, waiting, sending, show: true };
  if (needsSignIn && pending > 0) return { ...base, state: 'signin', messageKey: `outbox.signin.${plural(pending)}`, params: { count: pending } };
  if (!online) {
    return pending > 0
      ? { ...base, state: 'offline', messageKey: `outbox.offline.${plural(pending)}`, params: { count: pending } }
      : { ...base, state: 'offline', messageKey: 'outbox.offline.none', params: {} };
  }
  if (sending > 0) return { ...base, state: 'syncing', messageKey: `outbox.syncing.${plural(pending)}`, params: { count: pending } };
  if (failed > 0) return { ...base, state: 'failed', messageKey: `outbox.failed.${plural(failed)}`, params: { count: failed } };
  if (pending > 0) return { ...base, state: 'pending', messageKey: `outbox.waiting.${plural(pending)}`, params: { count: pending } };
  return { ...base, state: 'idle', show: false, messageKey: null, params: {} };
}
