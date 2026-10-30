import { createHash } from 'node:crypto';
import { newId } from '../lib/random.js';

/**
 * Append-only audit trail. Entries are only ever created: this module (and the whole app) has no
 * update or delete path for them. Each entry also carries a digest of its own content, so a
 * change made behind the app's back is detectable with `isIntact`.
 */

/** In the order things happen, which is also the tie-break when two entries share a millisecond. */
export const AUDIT_ACTIONS = Object.freeze([
  'dispute_submitted',
  'dispute_review_started',
  'shift_corrected',
  'dispute_approved',
  'dispute_rejected',
  'shift_auto_closed',
]);

/** Oldest first; entries with the same time keep the order of AUDIT_ACTIONS, then their id. */
export const compareEntries = (a, b) =>
  a.at - b.at || AUDIT_ACTIONS.indexOf(a.action) - AUDIT_ACTIONS.indexOf(b.action) || a.id.localeCompare(b.id);

const CONTENT_FIELDS = ['id', 'orgId', 'workerId', 'at', 'actorRole', 'actorId', 'action', 'disputeId', 'shiftId', 'before', 'after', 'note', 'details'];

/** JSON with sorted keys, so the same content always gives the same text. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

export function digestOf(entry) {
  const content = Object.fromEntries(CONTENT_FIELDS.map((f) => [f, entry[f] ?? null]));
  return createHash('sha256').update(canonical(content)).digest('hex');
}

/**
 * @param {object} fields
 * @param {string} fields.orgId
 * @param {string} fields.workerId the worker the entry is about (and who can read it)
 * @param {number} fields.at epoch ms
 * @param {'worker' | 'admin' | 'system'} fields.actorRole
 * @param {string} fields.actorId
 * @param {typeof AUDIT_ACTIONS[number]} fields.action
 */
export function buildAuditEntry({ id = newId('au'), disputeId = null, shiftId = null, before = null, after = null, note = '', details = null, ...rest }) {
  const entry = { id, disputeId, shiftId, before, after, note, details, ...rest };
  return { ...entry, digest: digestOf(entry) };
}

export const isIntact = (entry) => entry.digest === digestOf(entry);

/** @param {{ store: object, clock: { now: () => number } }} deps */
export function createAuditService({ store, clock }) {
  return {
    /** Writes one entry; an entry with the same id is not written twice (retries are harmless). */
    async record(fields) {
      const entry = buildAuditEntry({ at: clock.now(), ...fields });
      if (fields.id && (await store.audit.get(entry.orgId, entry.id))) return store.audit.get(entry.orgId, entry.id);
      await store.audit.insert(entry);
      return entry;
    },

    /** Everything recorded about one worker, oldest first. */
    async listForWorker(orgId, workerId) {
      const entries = await store.audit.query(orgId, { where: { workerId } });
      return entries.sort(compareEntries);
    },
  };
}
