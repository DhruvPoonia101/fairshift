import { DECENT_WORK } from '../config/constants.js';

/**
 * Decent Work Score: a pure, deterministic 0-100 score for an employer, built from five
 * components. No clock, no store, no randomness: the same inputs always give the same score.
 *
 * A component with no data is left out and the remaining weights are scaled up so they still
 * add to 100%. Worker sentiment only counts when its feedback groups passed the k-anonymity
 * rule (3 or more answers); otherwise it reads "not enough responses".
 */

export const COMPONENT_IDS = Object.freeze(['pay', 'rest', 'grievances', 'sentiment', 'attendance']);
export const DEFAULT_WEIGHTS = DECENT_WORK.WEIGHTS;

const round1 = (n) => Math.round(n * 10) / 10;
const clamp = (n) => Math.max(0, Math.min(100, n));
const missing = (key = 'not_enough_data') => ({ score: null, detail: { key, params: {} } });

/** Pay accuracy: the share of checked payslips that were paid correctly. */
function scorePay(input) {
  if (!input || input.checked === 0) return missing();
  const { checked, underpaid, shortfallPaise } = input;
  return { score: clamp((100 * (checked - underpaid)) / checked), detail: { key: 'pay', params: { underpaid, checked, shortfallPaise } } };
}

/** Rest and overtime: each worker counts 100 with no rest warning, 50 with an amber one, 0 with a red one. */
function scoreRest(input) {
  if (!input || input.workers === 0) return missing();
  const { workers, amber, red } = input;
  const healthy = workers - amber - red;
  const points = healthy * DECENT_WORK.REST_POINTS.none + amber * DECENT_WORK.REST_POINTS.amber + red * DECENT_WORK.REST_POINTS.red;
  return { score: clamp(points / workers), detail: { key: 'rest', params: { red, amber, workers } } };
}

/** Grievance handling: the share of recent reports that did not breach their response time. */
function scoreGrievances(input) {
  if (!input || input.considered === 0) return missing();
  const { considered, breaches, overdueOpen } = input;
  return {
    score: clamp((100 * (considered - breaches)) / considered),
    detail: { key: 'grievances', params: { breaches, considered, overdue: overdueOpen } },
  };
}

/** Worker sentiment: the answer-weighted average rating of the feedback groups that may be shown, 1-5 mapped to 0-100. */
function scoreSentiment(input) {
  const groups = input?.buckets ?? [];
  const responses = groups.reduce((sum, b) => sum + b.count, 0);
  if (responses === 0) return missing('not_enough_responses');
  const average = groups.reduce((sum, b) => sum + b.average * b.count, 0) / responses;
  return { score: clamp(((average - 1) / 4) * 100), detail: { key: 'sentiment', params: { average: round1(average), responses } } };
}

/**
 * Attendance accuracy: half from how rarely records are disputed (10% disputed scores 0), half from
 * how many disputes were handled in time.
 */
function scoreAttendance(input) {
  if (!input || input.records === 0) return missing();
  const { records, disputes, overdue } = input;
  const rate = clamp(100 * (1 - Math.min(1, disputes / records / DECENT_WORK.DISPUTE_RATE_ZERO_AT)));
  const handling = disputes === 0 ? 100 : clamp((100 * (disputes - overdue)) / disputes);
  return { score: (rate + handling) / 2, detail: { key: 'attendance', params: { disputes, records, overdue } } };
}

const SCORERS = { pay: scorePay, rest: scoreRest, grievances: scoreGrievances, sentiment: scoreSentiment, attendance: scoreAttendance };

/** One English sentence per driver, for API consumers; the app shows its own translated text. */
const DRIVER_TEXT = {
  pay: (p) => `${p.underpaid} of ${p.checked} payslips were underpaid.`,
  rest: (p) => `Rest warnings: ${p.red} red and ${p.amber} amber, out of ${p.workers} workers.`,
  grievances: (p) => `${p.breaches} of ${p.considered} worker reports were not handled in time; ${p.overdue} are overdue and still open.`,
  sentiment: (p) => `Workers rate their workplace ${p.average} out of 5 (${p.responses} answers).`,
  attendance: (p) => `${p.disputes} attendance disputes on ${p.records} records; ${p.overdue} were not handled in time.`,
};

export function bandFor(score) {
  if (score === null) return 'unknown';
  if (score >= DECENT_WORK.BANDS.HEALTHY_MIN) return 'healthy';
  return score >= DECENT_WORK.BANDS.NEEDS_ATTENTION_MIN ? 'needs_attention' : 'at_risk';
}

/**
 * @param {{
 *   pay: { checked: number, underpaid: number, shortfallPaise: number } | null,
 *   rest: { workers: number, amber: number, red: number } | null,
 *   grievances: { considered: number, breaches: number, overdueOpen: number } | null,
 *   sentiment: { buckets: Array<{ count: number, average: number }> } | null,
 *   attendance: { records: number, disputes: number, overdue: number } | null,
 * }} inputs
 * @param {{ weights?: Record<string, number> }} [options] configurable weights (any positive numbers)
 */
export function computeDecentWorkScore(inputs, { weights = DEFAULT_WEIGHTS } = {}) {
  const parts = COMPONENT_IDS.map((id) => ({ id, weight: weights[id] ?? 0, ...SCORERS[id](inputs?.[id]) }));
  const totalWeight = parts.reduce((sum, p) => sum + p.weight, 0);
  const availableWeight = parts.filter((p) => p.score !== null).reduce((sum, p) => sum + p.weight, 0);

  const components = parts.map((p) => {
    const effectiveWeight = p.score !== null && availableWeight > 0 ? p.weight / availableWeight : 0;
    return {
      id: p.id,
      weight: p.weight,
      available: p.score !== null,
      score: p.score === null ? null : Math.round(p.score),
      effectiveWeight: Math.round(effectiveWeight * 1000) / 1000,
      detail: p.detail,
      deficit: p.score === null ? 0 : (100 - p.score) * effectiveWeight,
    };
  });

  if (availableWeight === 0) {
    return { score: null, band: 'unknown', coverage: 0, components: components.map(stripDeficit), drivers: [] };
  }

  const score = Math.round(parts.reduce((sum, p) => sum + (p.score === null ? 0 : (p.score * p.weight) / availableWeight), 0));
  const drivers = components
    .filter((c) => c.deficit > 0)
    .sort((a, b) => b.deficit - a.deficit || a.id.localeCompare(b.id))
    .slice(0, DECENT_WORK.TOP_DRIVERS)
    .map((c) => ({ id: c.id, pointsLost: round1(c.deficit), detail: c.detail, text: DRIVER_TEXT[c.id](c.detail.params) }));

  return {
    score,
    band: bandFor(score),
    coverage: Math.round((availableWeight / totalWeight) * 100) / 100,
    components: components.map(stripDeficit),
    drivers,
  };
}

function stripDeficit({ deficit, ...component }) {
  return component;
}
