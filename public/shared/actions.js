import { generateTrackingCode } from './tracking-code.js';

/**
 * Turns "the worker did X" into an outbox item (see queue.js `enqueue`). Pure, so the rules about what an
 * item may carry can be tested:
 *
 * - A named action carries `ownerId` (the worker) so it is never filed under someone else on a shared phone.
 * - An anonymous action (an anonymous report, and all feedback) carries NO identity of any kind: no
 *   `ownerId`, no name, and it is sent to /anonymous/* with no cookie (see outbox.js).
 *   Its tracking code is made here, on the phone, from crypto.getRandomValues, so it can be shown at once.
 * - The request body carries what the server needs; `capturedAt` is added when the item is sent later.
 *
 * @param {'checkin' | 'checkout' | 'report' | 'dispute' | 'feedback'} kind
 * @param {object} payload what the form collected
 * @param {{ ownerId: string | null, random?: (a: Uint8Array) => Uint8Array }} context
 */
export function specFor(kind, payload, { ownerId, random } = {}) {
  switch (kind) {
    case 'checkin': {
      const { method, token, code, lat, lng } = payload;
      return { kind, anonymous: false, ownerId, request: { path: '/attendance/check-in', body: clean({ method, token, code, lat, lng }) }, display: { labelKey: 'outbox.kind.checkin', method } };
    }
    case 'checkout':
      return { kind, anonymous: false, ownerId, request: { path: '/attendance/check-out', body: {} }, display: { labelKey: 'outbox.kind.checkout' } };
    case 'dispute': {
      const { shiftId, category, checkInAt, checkOutAt, siteId, note } = payload;
      return { kind, anonymous: false, ownerId, request: { path: '/disputes', body: clean({ shiftId, category, checkInAt, checkOutAt, siteId, note }) }, display: { labelKey: 'outbox.kind.dispute', categoryKey: `dispute.cat.${category}` } };
    }
    case 'report': {
      // `photo` is the small JPEG made on the phone (shared/photo.js), as base64. It rides in the same request body, so a
      // report that waits offline keeps its picture in the outbox (IndexedDB) and sends it with the same Idempotency-Key.
      const { category, text, anonymous, source, month, photo } = payload;
      if (anonymous) {
        const trackingCode = generateTrackingCode(random);
        return { kind, anonymous: true, ownerId: null, trackingCode, request: { path: '/anonymous/grievances', body: clean({ category, text, trackingCode, photo }) }, display: { labelKey: 'outbox.kind.reportAnon', categoryKey: `cat.${category}` } };
      }
      return { kind, anonymous: false, ownerId, request: { path: '/grievances', body: clean({ category, text, anonymous: false, source, month, photo }) }, display: { labelKey: 'outbox.kind.report', categoryKey: `cat.${category}` } };
    }
    case 'feedback': {
      const { subject, rating, text } = payload;
      return { kind, anonymous: true, ownerId: null, request: { path: '/anonymous/feedback', body: clean({ subject, rating, text }) }, display: { labelKey: 'outbox.kind.feedback', subjectKey: `feedback.subject.${subject}` } };
    }
    default:
      throw new Error(`unknown_kind:${kind}`);
  }
}

/** Drops fields that were not given, so the body (and its fingerprint on the server) stays small and stable. */
function clean(fields) {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined && value !== null && value !== ''));
}

const WAITING = new Set(['queued', 'syncing']);

/**
 * Today's status as the worker should see it: a check-in or check-out still waiting in the outbox counts, so
 * the home screen is not "wrong" while offline. `pending` says part of it is not at the server yet.
 * @param {{ status: string, since: number | null }} today the last answer from the server (or the saved copy)
 * @param {object[]} items the outbox items, oldest first
 */
export function overlayToday(today, items) {
  let result = today;
  for (const item of items.filter((i) => WAITING.has(i.status))) {
    if (item.kind === 'checkin' && result.status !== 'working') result = { ...result, status: 'working', since: item.capturedAt, pending: true };
    else if (item.kind === 'checkout' && result.status === 'working') result = { ...result, status: 'done', pending: true };
  }
  return result;
}

/** Ids of the records that already have a dispute waiting in the outbox, so they are not contested twice. */
export function recordsWithWaitingDispute(items) {
  return new Set(items.filter((i) => i.kind === 'dispute' && WAITING.has(i.status)).map((i) => i.request.body?.shiftId).filter(Boolean));
}
