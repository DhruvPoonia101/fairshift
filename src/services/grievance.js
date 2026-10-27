import { createHmac } from 'node:crypto';
import {
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
const MIN_RESOLUTION_NOTE_LENGTH = 3;
const TRACKING_CODE_GROUP = TRACKING_CODE_LENGTH / 2;

/**
 * Rule-based severity suggestion (no AI): danger words win, then pay/safety words;
 * otherwise hazards default to medium and ordinary complaints to low.
 * @param {string} text
 * @param {{kind: string} | null} category
 */
export function suggestSeverity(text, category) {
  const lower = text.toLowerCase();
  if (HIGH_WORDS.some((w) => lower.includes(w))) return 'high';
  if (MEDIUM_WORDS.some((w) => lower.includes(w))) return 'medium';
  return category?.kind === 'hazard' ? 'medium' : 'low';
}

const normaliseCode = (code) => String(code).toUpperCase().replace(/[^A-Z0-9]/g, '');

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
     * @returns {Promise<{grievance: object, trackingCode?: string}>}
     */
    async create(user, org, { category, text, anonymous, source = 'manual', month }) {
      const categoryDef = findCategory(org.sector, category);
      if (!categoryDef) throw unprocessable('invalid_category', 'Unknown category.');
      const now = clock.now();
      const base = {
        id: newId('gr'),
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
        const trackingCode = randomCode(TRACKING_CODE_ALPHABET, TRACKING_CODE_LENGTH);
        const record = {
          ...base,
          source: 'manual',
          month: null,
          createdAt: dayStartMs(dayKey(now)),
          trackingHash: hashCode(trackingCode),
        };
        await store.grievances.insert(record);
        const shown = `${trackingCode.slice(0, TRACKING_CODE_GROUP)}-${trackingCode.slice(TRACKING_CODE_GROUP)}`;
        return { grievance: present(record), trackingCode: shown };
      }
      const record = { ...base, workerId: user.id, createdAt: now };
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
