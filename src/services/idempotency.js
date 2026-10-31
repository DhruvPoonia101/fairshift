import { createHash } from 'node:crypto';
import { conflict } from '../lib/errors.js';

/** JSON with sorted keys, so the same content always gives the same text. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/** What the request means, ignoring when the phone says it happened (a retry may add that). */
export const fingerprintOf = (kind, body) => {
  const { capturedAt, ...rest } = body;
  return sha256(`${kind}|${canonical(rest)}`);
};

/**
 * Makes retries safe. A request that carries an Idempotency-Key is run once: the first outcome is
 * stored, and the same key again (same meaning) gets that outcome back instead of doing the work twice.
 * The same key with a different meaning is a bug on the client and is refused.
 *
 * Everything created for a key also gets an id derived from the key (`idFor`), so even two server
 * instances racing on one retry write the same document rather than two.
 *
 * `scope` says whose key it is: `w:<workerId>` for named actions, `anon` for anonymous ones. An
 * anonymous key therefore never sits next to a person's id.
 * @param {{ store: object, clock: { now: () => number } }} deps
 */
export function createIdempotencyService({ store, clock }) {
  const tails = new Map();
  // Two requests with one key run one after the other, so the second sees the first's result.
  function serialise(id, task) {
    const run = (tails.get(id) ?? Promise.resolve()).then(task, task);
    const tail = run.catch(() => {});
    tails.set(id, tail);
    tail.then(() => tails.get(id) === tail && tails.delete(id));
    return run;
  }

  const recordId = (orgId, scope, kind, key) => `idem-${sha256(`${orgId}|${scope}|${kind}|${key}`).slice(0, 40)}`;

  return {
    /** An id for something created under this key: the same key always gives the same id. */
    idFor(prefix, { orgId, scope, kind, key }) {
      return `${prefix}-${recordId(orgId, scope, kind, key).slice(5, 29)}`;
    },

    /**
     * @param {{ orgId: string, scope: string, kind: string, key?: string, fingerprint: string }} request
     * @param {() => Promise<{ status: number, body: object }>} task the work; only a successful outcome is stored
     * @returns {Promise<{ status: number, body: object, replayed: boolean }>}
     */
    async run({ orgId, scope, kind, key, fingerprint }, task) {
      if (!key) return { ...(await task()), replayed: false };
      const id = recordId(orgId, scope, kind, key);
      return serialise(id, async () => {
        const seen = await store.idempotency.get(orgId, id);
        if (seen) {
          if (seen.fingerprint !== fingerprint) {
            throw conflict('idempotency_key_reused', 'This key was already used for something different.');
          }
          return { status: seen.status, body: seen.body, replayed: true };
        }
        const outcome = await task();
        await store.idempotency.insert({ id, orgId, scope, kind, fingerprint, status: outcome.status, body: outcome.body, createdAt: clock.now() });
        return { ...outcome, replayed: false };
      });
    },
  };
}
