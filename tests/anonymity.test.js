import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dayStartMs, fixedClock } from '../src/lib/time.js';
import { createFeedbackService, summariseBucket } from '../src/services/feedback.js';
import { createGrievanceService, suggestSeverity } from '../src/services/grievance.js';
import { createMemoryStore } from '../src/store/memory.js';
import { istMs, randomSecret } from './helpers.js';

const ORG = { id: 'org-construction', sector: 'construction' };
const WORKER = { id: 'w-secret-42', orgId: ORG.id, role: 'worker' };

function setup() {
  const clock = fixedClock(istMs('2026-10-27', '15:42'));
  const store = createMemoryStore();
  return {
    clock,
    store,
    feedback: createFeedbackService({ store, clock }),
    grievance: createGrievanceService({ store, clock, secret: randomSecret() }),
  };
}

test('feedback stores no worker id, no ip and only the day', async () => {
  const { feedback, store } = setup();
  await feedback.submit(ORG.id, { subject: 'manager', rating: 4, text: 'fine' });
  const [record] = await store.feedback.query(ORG.id);
  assert.deepEqual(Object.keys(record).sort(), ['day', 'id', 'orgId', 'rating', 'subject', 'text']);
  assert.equal(record.day, '2026-10-27');
  assert.ok(!JSON.stringify(record).includes(WORKER.id));
});

test('feedback buckets under 3 responses are hidden completely', async () => {
  const { feedback } = setup();
  for (const rating of [5, 1]) await feedback.submit(ORG.id, { subject: 'policies', rating, text: 'secret words' });
  const policies = (await feedback.aggregate(ORG.id)).find((b) => b.subject === 'policies');
  assert.deepEqual(policies, {
    subject: 'policies',
    suppressed: true,
    count: null,
  });
});

test('at 3 responses the bucket opens with an average, distribution and sorted comments', () => {
  const bucket = summariseBucket('manager', [
    { rating: 5, text: 'zebra' },
    { rating: 3, text: 'apple' },
    { rating: 4, text: '' },
  ]);
  assert.equal(bucket.suppressed, false);
  assert.equal(bucket.average, 4);
  assert.deepEqual(bucket.distribution, [0, 0, 1, 1, 1]);
  assert.deepEqual(bucket.comments, ['apple', 'zebra']);
  assert.equal(summariseBucket('manager', [{ rating: 5, text: '' }, { rating: 4, text: '' }]).suppressed, true);
});

test('an anonymous grievance stores no worker id, rounds time to the day and gives a tracking code', async () => {
  const { grievance, store } = setup();
  const { grievance: shown, trackingCode } = await grievance.create(WORKER, ORG, {
    category: 'scaffolding',
    text: 'Loose boards, someone could fall',
    anonymous: true,
  });
  const [record] = await store.grievances.query(ORG.id);
  assert.ok(!('workerId' in record));
  assert.ok(!JSON.stringify(record).includes(WORKER.id));
  assert.ok(!JSON.stringify(shown).includes(WORKER.id));
  assert.equal(record.createdAt, dayStartMs('2026-10-27'));
  assert.match(trackingCode, /^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
  assert.ok(!JSON.stringify(record).includes(trackingCode.replace('-', '')), 'the code itself is never stored');
  assert.equal(shown.severity, 'high');
});

test('the tracking code finds the report and reveals only its status', async () => {
  const { grievance, store } = setup();
  const { trackingCode, grievance: created } = await grievance.create(WORKER, ORG, {
    category: 'ppe',
    text: 'No helmets at the gate',
    anonymous: true,
  });
  await grievance.updateStatus(ORG.id, created.id, { status: 'in_review', note: '' });
  const view = await grievance.track(trackingCode.toLowerCase());
  assert.equal(view.status, 'in_review');
  assert.deepEqual(Object.keys(view).sort(), ['category', 'createdAt', 'resolutionNote', 'status', 'updatedAt']);
  await assert.rejects(grievance.track('AAAAA-AAAAA'), { status: 404 });
  const all = await store.grievances.query(ORG.id);
  assert.equal((await grievance.listForOrg(ORG.id))[0].worker, null);
  assert.equal(all.length, 1);
});

test('a named grievance keeps the worker id and the exact time', async () => {
  const { grievance, store } = setup();
  await grievance.create(WORKER, ORG, { category: 'pay', text: 'Salary is short this month', anonymous: false });
  const [record] = await store.grievances.query(ORG.id);
  assert.equal(record.workerId, WORKER.id);
  assert.equal(record.createdAt, istMs('2026-10-27', '15:42'));
});

test('status moves forward only, and resolving needs a note', async () => {
  const { grievance } = setup();
  const { grievance: g } = await grievance.create(WORKER, ORG, { category: 'pay', text: 'Overtime was not paid', anonymous: false });
  await assert.rejects(grievance.updateStatus(ORG.id, g.id, { status: 'resolved', note: '' }), { code: 'note_required' });
  await grievance.updateStatus(ORG.id, g.id, { status: 'in_review', note: '' });
  await assert.rejects(grievance.updateStatus(ORG.id, g.id, { status: 'open', note: '' }), { code: 'invalid_transition' });
  const done = await grievance.updateStatus(ORG.id, g.id, { status: 'resolved', note: 'Paid on Friday' });
  assert.equal(done.resolutionNote, 'Paid on Friday');
  await assert.rejects(grievance.updateStatus(ORG.id, g.id, { status: 'resolved', note: 'again' }), { code: 'already_resolved' });
});

test('severity rules: danger words beat pay words, hazards default to medium', () => {
  assert.equal(suggestSeverity('Worker fell from the ladder', { kind: 'hazard' }), 'high');
  assert.equal(suggestSeverity('My salary is delayed', { kind: 'grievance' }), 'medium');
  assert.equal(suggestSeverity('The mat is torn', { kind: 'hazard' }), 'medium');
  assert.equal(suggestSeverity('Please change my break time', { kind: 'grievance' }), 'low');
  assert.equal(suggestSeverity('मुझे चोट लगी', { kind: 'grievance' }), 'high');
});
