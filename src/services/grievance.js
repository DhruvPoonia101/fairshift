import { createHmac } from 'node:crypto';
import {
  ANON_CODE_ALPHABET,
  ANON_CODE_LENGTH,
  ANON_CODE_MIN_DISTINCT,
  TRACKING_CODE_ALPHABET,
  TRACKING_CODE_LENGTH,
} from '../config/constants.js';
import { findCategory } from '../config/sectors.js';
import { conflict, notFound, unprocessable } from '../lib/errors.js';
import { newId, randomCode } from '../lib/random.js';
import { dayKey, dayStartMs } from '../lib/time.js';

const HIGH_WORDS = [
  'injur', 'accident', 'fell', 'fall', 'fire', 'shock', 'bleed', 'collapse', 'faint', 'burn',
  'harass', 'threat', 'beat',
  'चोट', 'आग', 'करंट', 'गिर', 'खून', 'धमकी',
  'காயம்', 'தீ', 'மின்சார', 'விழ', 'மிரட்ட',
];
const MEDIUM_WORDS = [
  'unsafe', 'danger', 'risk', 'unpaid', 'not paid', 'salary', 'wage', 'delay', 'overtime',
  'slippery', 'leak', 'broken', 'no helmet', 'no water', 'wrong',
  'खतरा', 'वेतन', 'पैसे', 'देरी', 'गलत',
  'ஆபத்து', 'சம்பளம்', 'தாமதம்', 'தவறு',
];

const NEXT_STATUSES = Object.freeze({
  open: ['in_review', 'resolved'],
  in_review: ['resolved'],
  resolved: [],
});
const SEVERITY_RANK = Object.freeze({ low: 0, medium: 1, high: 2 });
const MIN_RESOLUTION_NOTE_LENGTH = 3;
const TRACKING_CODE_GROUP = TRACKING_CODE_LENGTH / 2;

/**
 * Rule-based severity suggestion (no AI): danger words win, then pay/safety words, but never below
 * the category's own floor (hazards default to medium; the sector config can raise it).
 * @param {string} text
 * @param {{kind: string} | null} category
 */
export function suggestSeverity(text, category) {
  const lower = text.toLowerCase();
  let found = 'low';
  if (HIGH_WORDS.some((w) => lower.includes(w))) found = 'high';
  else if (MEDIUM_WORDS.some((w) => lower.includes(w))) found = 'medium';
  const floor = category?.kind === 'hazard' ? (category.minSeverity ?? 'medium') : 'low';
  return SEVERITY_RANK[found] >= SEVERITY_RANK[floor] ? found : floor;
}

const normaliseCode = (code) => String(code).toUpperCase().replace(/[^A-Z0-9]/g, '');

const CLIENT_CODE_PATTERN = new RegExp(`^[${ANON_CODE_ALPHABET}]{${ANON_CODE_LENGTH}}$`);

/** A code made on the phone must be the right shape and not obviously typed (the server cannot see how it was made). */
export function isValidClientCode(code) {
  return typeof code === 'string' && CLIENT_CODE_PATTERN.test(code) && new Set(code).size >= ANON_CODE_MIN_DISTINCT;
}

/** Fields a worker or employer may see; never includes tracking data. */
function present(g) {
  return {
    id: g.id,
    category: g.category,
    text: g.text,
    severity: g.severity,
    status: g.status,
    source: g.source,
    month: g.month ?? null,
    anonymous: g.anonymous,
    recordedOffline: Boolean(g.recordedOffline),
    createdAt: g.createdAt,
    updatedAt: g.updatedAt,
    resolutionNote: g.resolutionNote,
  };
}

/**
 * @param {object} deps
 * @param {object} deps.store
 * @param {{ now: () => number }} deps.clock
 * @param {string} deps.secret used to hash anonymous tracking codes
 */
export function createGrievanceService({ store, clock, secret }) {
  const hashCode = (code) =>
    createHmac('sha256', secret).update(`track|${normaliseCode(code)}`).digest('hex');

  return {
    /**
     * Files a grievance or hazard report. An anonymous report stores NO worker id at all;
     * its time is rounded to the day and the worker gets a random tracking code instead.
     *
     * An anonymous report may bring its own tracking code, made on the phone (so it can be shown before
     * the report is sent). The server checks the shape and that nobody has it already; it never learns who made it.
     * `capture` (lib/capture.js) is set when the report was made without a signal. `id` is stable per retry.
     * `user` is null for an anonymous submission that carries no sign-in at all.
     * @returns {Promise<{grievance: object, trackingCode?: string}>}
     */
    async create(user, org, { category, text, anonymous, source = 'manual', month, trackingCode: clientCode }, capture, id) {
      const categoryDef = findCategory(org.sector, category);
      if (!categoryDef) throw unprocessable('invalid_category', 'Unknown category.');
      const now = clock.now();
      const seen = capture ?? { capturedAt: now, receivedAt: now, recordedOffline: false };
      const base = {
        id: id ?? newId('gr'),
        orgId: org.id,
        category,
        text,
        severity: suggestSeverity(text, categoryDef),
        status: 'open',
        source,
        month: month ?? null,
        anonymous,
        resolutionNote: '',
        updatedAt: now,
      };
      if (anonymous) {
        if (clientCode !== undefined && !isValidClientCode(clientCode)) {
          throw unprocessable('invalid_tracking_code', 'That tracking code is not valid.');
        }
        const trackingCode = clientCode ?? randomCode(TRACKING_CODE_ALPHABET, TRACKING_CODE_LENGTH);
        const trackingHash = hashCode(trackingCode);
        if (clientCode !== undefined) {
          const taken = await store.grievances.findBy('trackingHash', trackingHash);
          if (taken && taken.id !== base.id) throw conflict('tracking_code_taken', 'That tracking code is already in use.');
        }
        // Nothing here points at a person: no worker id, and only the day (not the time) of the report.
        const record = {
          ...base,
          source: 'manual',
          month: null,
          createdAt: dayStartMs(dayKey(seen.capturedAt)),
          trackingHash,
          ...(seen.recordedOffline ? { recordedOffline: true } : {}),
        };
        await store.grievances.insert(record);
        if (clientCode !== undefined) return { grievance: present(record) };
        const shown = `${trackingCode.slice(0, TRACKING_CODE_GROUP)}-${trackingCode.slice(TRACKING_CODE_GROUP)}`;
        return { grievance: present(record), trackingCode: shown };
      }
      const record = {
        ...base,
        workerId: user.id,
        createdAt: seen.capturedAt,
        ...(seen.recordedOffline ? { recordedOffline: true, capturedAt: seen.capturedAt, receivedAt: seen.receivedAt } : {}),
      };
      await store.grievances.insert(record);
      return { grievance: present(record) };
    },

    async listForWorker(user) {
      const mine = await store.grievances.query(user.orgId, { where: { workerId: user.id } });
      return mine.sort((a, b) => b.createdAt - a.createdAt).map(present);
    },

    /** Status lookup by tracking code. Reveals nothing about who filed it. */
    async track(code) {
      const record = await store.grievances.findBy('trackingHash', hashCode(code));
      if (!record) throw notFound('No report found for that code.');
      const { category, status, resolutionNote, createdAt, updatedAt } = present(record);
      return { category, status, resolutionNote, createdAt, updatedAt };
    },

    /** Employer list, newest first. Named reports carry the worker's name; anonymous ones never do. */
    async listForOrg(orgId) {
      const [items, workers] = await Promise.all([
        store.grievances.query(orgId),
        store.workers.query(orgId),
      ]);
      const names = new Map(workers.map((w) => [w.id, { name: w.name, role: w.role }]));
      return items
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((g) => ({ ...present(g), worker: g.anonymous ? null : (names.get(g.workerId) ?? null) }));
    },

    /** Moves a grievance forward (open -> in review -> resolved); resolving needs a note. */
    async updateStatus(orgId, id, { status, note }) {
      const current = await store.grievances.get(orgId, id);
      if (!current) throw notFound('Report not found.');
      if (status !== current.status && !NEXT_STATUSES[current.status].includes(status)) {
        throw conflict('invalid_transition', 'That status change is not allowed.');
      }
      if (current.status === 'resolved') {
        throw conflict('already_resolved', 'This report is already resolved.');
      }
      if (status === 'resolved' && note.length < MIN_RESOLUTION_NOTE_LENGTH) {
        throw unprocessable('note_required', 'Add a short note explaining the resolution.');
      }
      const updated = await store.grievances.update(orgId, id, {
        status,
        resolutionNote: note || current.resolutionNote,
        updatedAt: clock.now(),
      });
      return present(updated);
    },
  };
}
