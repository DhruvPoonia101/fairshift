import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { DECENT_WORK } from '../src/config/constants.js';
import { SECTORS } from '../src/config/sectors.js';
import { COMPONENT_IDS, DEFAULT_WEIGHTS, bandFor, computeDecentWorkScore } from '../src/services/decentWork.js';
import { DEFAULT_FATIGUE_RULES } from '../src/services/fatigue.js';
import { buildScoreInputs, monthsNeeded } from '../src/services/scoreInputs.js';
import { istMs, startApp } from './helpers.js';

const DAY = 24 * 60 * 60_000;
const perfect = () => ({
  pay: { checked: 10, underpaid: 0, shortfallPaise: 0 },
  rest: { workers: 10, amber: 0, red: 0 },
  grievances: { considered: 5, breaches: 0, overdueOpen: 0 },
  sentiment: { buckets: [{ count: 6, average: 5 }] },
  attendance: { records: 200, disputes: 0, overdue: 0 },
});
const score = (inputs, options) => computeDecentWorkScore(inputs, options);
const component = (result, id) => result.components.find((c) => c.id === id);

describe('each component, with fixed inputs', () => {
  test('pay accuracy is the share of checked payslips paid correctly', () => {
    const r = score({ ...perfect(), pay: { checked: 10, underpaid: 2, shortfallPaise: 90_000 } });
    assert.equal(component(r, 'pay').score, 80);
    assert.deepEqual(component(r, 'pay').detail, { key: 'pay', params: { underpaid: 2, checked: 10, shortfallPaise: 90_000 } });
  });

  test('rest and overtime: no warning 100, amber 50, red 0, averaged over the workers', () => {
    const r = score({ ...perfect(), rest: { workers: 10, amber: 2, red: 1 } });
    assert.equal(component(r, 'rest').score, 80); // (7 x 100 + 2 x 50 + 1 x 0) / 10
  });

  test('grievance handling is the share of recent reports that did not breach their response time', () => {
    const r = score({ ...perfect(), grievances: { considered: 8, breaches: 2, overdueOpen: 1 } });
    assert.equal(component(r, 'grievances').score, 75);
    assert.equal(component(r, 'grievances').detail.params.overdue, 1);
  });

  test('sentiment maps the answer-weighted average rating 1-5 onto 0-100', () => {
    const mixed = score({ ...perfect(), sentiment: { buckets: [{ count: 4, average: 4 }, { count: 4, average: 2 }] } });
    assert.equal(component(mixed, 'sentiment').score, 50); // average 3.0
    assert.equal(score({ ...perfect(), sentiment: { buckets: [{ count: 3, average: 1 }] } }).components[3].score, 0);
    assert.equal(component(score(perfect()), 'sentiment').score, 100);
    const weighted = score({ ...perfect(), sentiment: { buckets: [{ count: 9, average: 5 }, { count: 3, average: 1 }] } });
    assert.equal(component(weighted, 'sentiment').detail.params.average, 4);
  });

  test('attendance accuracy: half from the dispute rate, half from handling disputes in time', () => {
    const r = score({ ...perfect(), attendance: { records: 100, disputes: 5, overdue: 1 } });
    assert.equal(component(r, 'attendance').score, 65); // rate 50 (5% of a 10% limit), handling 80
    assert.equal(component(score({ ...perfect(), attendance: { records: 100, disputes: 10, overdue: 0 } }), 'attendance').score, 50);
    assert.equal(component(score({ ...perfect(), attendance: { records: 100, disputes: 20, overdue: 20 } }), 'attendance').score, 0);
  });

  test('a component with no data is "not available" and says why', () => {
    const r = score({ pay: null, rest: { workers: 0, amber: 0, red: 0 }, grievances: { considered: 0, breaches: 0, overdueOpen: 0 }, sentiment: { buckets: [] }, attendance: { records: 0, disputes: 0, overdue: 0 } });
    for (const c of r.components) assert.deepEqual([c.available, c.score], [false, null], c.id);
    assert.equal(component(r, 'sentiment').detail.key, 'not_enough_responses');
    assert.equal(component(r, 'pay').detail.key, 'not_enough_data');
  });
});

describe('the combined score', () => {
  test('perfect inputs give 100 and a healthy band with no drivers', () => {
    const r = score(perfect());
    assert.deepEqual([r.score, r.band, r.coverage, r.drivers], [100, 'healthy', 1, []]);
  });

  test('a mixed fixture: weighted sum, band and the top 3 drivers in order', () => {
    const r = score({
      pay: { checked: 10, underpaid: 2, shortfallPaise: 100 },
      rest: { workers: 10, amber: 2, red: 1 },
      grievances: { considered: 8, breaches: 2, overdueOpen: 1 },
      sentiment: { buckets: [{ count: 4, average: 4 }, { count: 4, average: 2 }] },
      attendance: { records: 100, disputes: 5, overdue: 1 },
    });
    // 80 x .30 + 80 x .25 + 75 x .20 + 50 x .15 + 65 x .10 = 24 + 20 + 15 + 7.5 + 6.5
    assert.equal(r.score, 73);
    assert.equal(r.band, 'needs_attention');
    assert.deepEqual(r.drivers.map((d) => [d.id, d.pointsLost]), [['sentiment', 7.5], ['pay', 6], ['grievances', 5]]);
    assert.ok(r.drivers.every((d) => d.text.length > 0 && d.detail.key === d.id));
    assert.equal(r.drivers.length, 3);
  });

  test('missing components are left out and the other weights are scaled to still sum to 100%', () => {
    const inputs = { ...perfect(), pay: null, sentiment: { buckets: [] }, rest: { workers: 10, amber: 0, red: 5 } }; // rest 50
    const r = score(inputs);
    // available weights: rest 25, grievances 20, attendance 10 = 55
    assert.equal(r.score, Math.round((50 * 25 + 100 * 20 + 100 * 10) / 55)); // 86
    assert.equal(r.coverage, 0.55);
    assert.equal(component(r, 'rest').effectiveWeight, 0.455);
    assert.equal(component(r, 'pay').effectiveWeight, 0);
    const total = r.components.reduce((sum, c) => sum + c.effectiveWeight, 0);
    assert.ok(Math.abs(total - 1) < 0.01);
    assert.deepEqual(r.drivers.map((d) => d.id), ['rest'], 'missing components are never blamed');
  });

  test('with no data at all there is no score, an "unknown" band and no drivers', () => {
    const r = score({ pay: null, rest: null, grievances: null, sentiment: null, attendance: null });
    assert.deepEqual([r.score, r.band, r.coverage, r.drivers], [null, 'unknown', 0, []]);
    assert.equal(r.components.length, 5);
    assert.deepEqual(score({}).score, null);
  });

  test('the weights are configurable: one weight of 100 makes that component the whole score', () => {
    const inputs = { ...perfect(), pay: { checked: 4, underpaid: 1, shortfallPaise: 1 } };
    assert.equal(score(inputs, { weights: { pay: 100 } }).score, 75);
    assert.equal(score(inputs, { weights: { pay: 1, rest: 1, grievances: 1, sentiment: 1, attendance: 1 } }).score, 95);
    assert.equal(score(inputs, { weights: { rest: 0, grievances: 0, sentiment: 0, attendance: 0, pay: 0 } }).score, null);
  });

  test('band boundaries: 80 healthy, 60 needs attention, below 60 at risk', () => {
    assert.deepEqual([100, 80, 79, 60, 59, 0].map(bandFor), ['healthy', 'healthy', 'needs_attention', 'needs_attention', 'at_risk', 'at_risk']);
    assert.equal(bandFor(null), 'unknown');
    assert.equal(DECENT_WORK.BANDS.HEALTHY_MIN, 80);
  });

  test('the default weights are the documented ones and add up to 100', () => {
    assert.deepEqual(DEFAULT_WEIGHTS, { pay: 30, rest: 25, grievances: 20, sentiment: 15, attendance: 10 });
    assert.equal(Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0), 100);
    assert.deepEqual([...COMPONENT_IDS].sort(), Object.keys(DEFAULT_WEIGHTS).sort());
  });

  test('it is deterministic and never changes its input', () => {
    const inputs = Object.freeze({ ...perfect(), rest: Object.freeze({ workers: 7, amber: 3, red: 2 }) });
    assert.deepEqual(score(inputs), score(inputs));
    assert.equal(JSON.stringify(score(inputs)), JSON.stringify(score(structuredClone(inputs))));
  });

  test('ties between drivers are broken by name, so the order never changes between runs', () => {
    const tied = score({
      pay: { checked: 10, underpaid: 5, shortfallPaise: 1 },
      rest: { workers: 10, amber: 0, red: 0 },
      grievances: { considered: 10, breaches: 5, overdueOpen: 0 },
      sentiment: { buckets: [] },
      attendance: null,
    }, { weights: { pay: 1, rest: 1, grievances: 1, sentiment: 1, attendance: 1 } });
    assert.deepEqual(tied.drivers.map((d) => d.id), ['grievances', 'pay']);
  });
});

describe('inputs as of a moment in time', () => {
  const NOW = istMs('2026-10-27', '12:00');
  const empty = { workers: [], shifts: [], grievances: [], feedback: [], disputes: [], subjects: ['manager', 'policies', 'conditions'], fatigueRules: DEFAULT_FATIGUE_RULES, complianceByMonth: new Map() };
  const inputs = (data, asOf = NOW) => buildScoreInputs({ ...empty, ...data }, asOf);
  const grievance = (over) => ({ severity: 'medium', status: 'open', createdAt: NOW - DAY, updatedAt: NOW - DAY, ...over });

  test('grievances: late answers and open reports past their time limit are breaches; old and future ones are ignored', () => {
    const r = inputs({
      grievances: [
        grievance({ severity: 'high', createdAt: NOW - 4 * DAY }), // open, limit 3 days: overdue
        grievance({ severity: 'medium', createdAt: NOW - 10 * DAY, status: 'resolved', updatedAt: NOW - 5 * DAY }), // answered in 5 days
        grievance({ severity: 'low', createdAt: NOW - 40 * DAY, status: 'resolved', updatedAt: NOW - 19 * DAY }), // 21 days: late
        grievance({ severity: 'medium', createdAt: NOW - 3 * DAY }), // open, within 7 days
        grievance({ createdAt: NOW - 91 * DAY, status: 'resolved', updatedAt: NOW - 90 * DAY }), // older than 90 days
        grievance({ createdAt: NOW + DAY }), // not filed yet
      ],
    });
    assert.deepEqual(r.grievances, { considered: 4, breaches: 2, overdueOpen: 1 });
  });

  test('grievances: something resolved after the moment counts as still open at that moment', () => {
    const g = grievance({ severity: 'high', createdAt: NOW - 6 * DAY, status: 'resolved', updatedAt: NOW - DAY });
    assert.deepEqual(inputs({ grievances: [g] }).grievances, { considered: 1, breaches: 1, overdueOpen: 0 }, 'answered in 5 days: late');
    assert.deepEqual(inputs({ grievances: [g] }, NOW - 4 * DAY).grievances, { considered: 1, breaches: 0, overdueOpen: 0 }, 'only 2 days old then');
    assert.deepEqual(inputs({ grievances: [g] }, NOW - 2 * DAY).grievances, { considered: 1, breaches: 1, overdueOpen: 1 }, 'open and overdue then');
  });

  test('sentiment: only groups with 3 or more answers count, and only the last 90 days', () => {
    const fb = (subject, rating, day) => ({ subject, rating, text: '', day });
    const r = inputs({
      feedback: [
        fb('manager', 5, '2026-10-20'), fb('manager', 5, '2026-10-21'), // 2 answers: hidden
        fb('conditions', 4, '2026-10-10'), fb('conditions', 2, '2026-10-11'), fb('conditions', 3, '2026-10-12'),
        fb('policies', 1, '2026-06-01'), fb('policies', 1, '2026-06-02'), fb('policies', 1, '2026-06-03'), // too old
      ],
    });
    assert.deepEqual(r.sentiment.buckets, [{ count: 3, average: 3 }]);
    assert.deepEqual(inputs({ feedback: [fb('manager', 5, '2026-10-20')] }).sentiment.buckets, []);
  });

  test('attendance: records and disputes in the last 30 days; slow handling is overdue', () => {
    const shift = (daysAgo) => ({ workerId: 'w1', checkIn: NOW - daysAgo * DAY, checkOut: NOW - daysAgo * DAY + 8 * 60 * 60_000 });
    const dispute = (over) => ({ createdAt: NOW - 10 * DAY, decidedAt: null, ...over });
    const r = inputs({
      shifts: [shift(1), shift(2), shift(10), shift(29), shift(31)],
      disputes: [
        dispute({ createdAt: NOW - 5 * DAY }), // still open after 5 days: overdue
        dispute({ decidedAt: NOW - 9 * DAY }), // decided in 1 day
        dispute({ decidedAt: NOW - 4 * DAY }), // decided in 6 days: overdue
        dispute({ createdAt: NOW - 40 * DAY, decidedAt: NOW - 39 * DAY }), // outside the window
      ],
    });
    assert.deepEqual(r.attendance, { records: 4, disputes: 3, overdue: 2 });
  });

  test('rest: warnings are evaluated as they stood at that moment', () => {
    const run = Array.from({ length: 6 }, (_, i) => ({ workerId: 'w1', checkIn: NOW - (i + 1) * DAY, checkOut: NOW - (i + 1) * DAY + 11 * 60 * 60_000 }));
    const data = { workers: [{ id: 'w1' }, { id: 'w2' }], shifts: run };
    assert.deepEqual(inputs(data).rest, { workers: 2, amber: 0, red: 1 }); // 66 hours in 7 days is red
    assert.deepEqual(inputs(data, NOW - 10 * DAY).rest, { workers: 2, amber: 0, red: 0 }, 'nothing had happened yet');
  });

  test('pay: uses the last finished month before that moment', () => {
    const complianceByMonth = new Map([['2026-09', { ok: 9, underpaid: 2, review: 1, shortfallPaise: 5_000 }]]);
    assert.deepEqual(inputs({ complianceByMonth }).pay, { checked: 11, underpaid: 2, shortfallPaise: 5_000 });
    assert.equal(inputs({ complianceByMonth }, istMs('2026-12-05', '12:00')).pay, null, 'no data for November');
  });

  test('the trend needs the compliance of one or two months only', () => {
    const keys = ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02'];
    assert.deepEqual(monthsNeeded(keys, istMs('2026-11-02', '12:00')), ['2026-09', '2026-10']);
  });
});

describe('the Decent Work Score through the API', () => {
  let app;
  before(async () => {
    app = await startApp();
  });
  after(() => app.close());

  for (const id of Object.keys(SECTORS)) {
    test(`${id}: score, band, five components, at most 3 drivers and a 14 day trend that ends on today's score`, async () => {
      const admin = await app.login(`admin-${id}`);
      const res = await app.request('/api/admin/decent-work', { cookie: admin.cookie });
      assert.equal(res.status, 200);
      const r = res.json;
      assert.ok(Number.isInteger(r.score) && r.score >= 0 && r.score <= 100);
      assert.equal(r.band, bandFor(r.score));
      assert.deepEqual(r.components.map((c) => c.id), COMPONENT_IDS);
      assert.equal(r.components.reduce((sum, c) => sum + c.weight, 0), 100);
      assert.ok(r.drivers.length <= 3 && r.drivers.every((d) => d.text && d.detail.key));
      assert.equal(r.trend.length, 14);
      assert.equal(r.trend.at(-1).score, r.score);
      assert.equal(r.trend.at(-1).date, app.today);
      assert.deepEqual(r.bands, { healthyMin: 80, needsAttentionMin: 60 });
    });
  }

  test('sentiment only counts feedback groups that meet the 3 answer rule', async () => {
    const admin = await app.login('admin-construction');
    const sentiment = (await app.request('/api/admin/decent-work', { cookie: admin.cookie })).json.components.find((c) => c.id === 'sentiment');
    assert.equal(sentiment.detail.params.responses, 8, 'the 2 answers about policies are left out');
  });

  test('it only reads the signed-in employer\'s own org, and only employers can ask', async () => {
    const worker = await app.login('worker-construction');
    assert.equal((await app.request('/api/admin/decent-work', { cookie: worker.cookie })).status, 403);
    assert.equal((await app.request('/api/admin/decent-work')).status, 401);
    const a = (await app.request('/api/admin/decent-work', { cookie: (await app.login('admin-construction')).cookie })).json;
    const b = (await app.request('/api/admin/decent-work', { cookie: (await app.login('admin-hospital')).cookie })).json;
    assert.notDeepEqual(a.components, b.components);
  });

  test('the same data always gives the same answer, and real events move the score', async () => {
    const admin = await app.login('admin-college');
    const ask = async () => (await app.request('/api/admin/decent-work', { cookie: admin.cookie })).json;
    const first = await ask();
    assert.deepEqual(await ask(), first);
    await app.store.grievances.insert({ id: 'gr-late-1', orgId: 'org-college', category: 'pay', text: 'Overdue', severity: 'high', status: 'open', source: 'manual', month: null, anonymous: false, workerId: 'w-col-01', resolutionNote: '', createdAt: istMs(app.daysAgo(6), '10:00'), updatedAt: istMs(app.daysAgo(6), '10:00') });
    const after = await ask();
    const g = (r) => r.components.find((c) => c.id === 'grievances');
    assert.ok(g(after).score < g(first).score);
    assert.ok(after.score <= first.score);
    assert.equal(g(after).detail.params.overdue, g(first).detail.params.overdue + 1);
  });
});
