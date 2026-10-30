import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import jwt from 'jsonwebtoken';
import { createAuditService, isIntact } from '../src/services/audit.js';
import { createDisputeService } from '../src/services/disputes.js';
import { createServices } from '../src/services/index.js';
import { fixedClock } from '../src/lib/time.js';
import { NOW, istMs, seededStore, startApp, testEnv } from './helpers.js';

const ORG = 'org-construction';
const HOUR = 60 * 60_000;
let seq = 0;

/** A worker with no shifts of their own, so every number in a test comes from that test. */
async function addWorker(app, orgId = ORG) {
  seq += 1;
  const worker = { id: `w-test-${seq}`, orgId, name: `Test Worker ${seq}`, role: 'mason', dailyWagePaise: 90_000, siteId: 'site-con-1', shiftId: 'day', isDemo: false, passportToken: null, joinedOn: '2020-01-01' };
  await app.store.workers.insert(worker);
  const token = jwt.sign({ role: 'worker', org: orgId }, app.env.sessionSecret, { algorithm: 'HS256', subject: worker.id, expiresIn: '1h' });
  return { worker, cookie: `fs_worker=${token}` };
}

async function addShift(app, worker, daysAgo, from = '08:00', to = '16:00') {
  seq += 1;
  const day = app.daysAgo(daysAgo);
  const shift = { id: `sh-test-${seq}`, orgId: worker.orgId, workerId: worker.id, siteId: worker.siteId, checkIn: istMs(day, from), checkOut: to === null ? null : istMs(day, to), method: 'qr', geoVerified: false };
  await app.store.shifts.insert(shift);
  return shift;
}

describe('attendance disputes', () => {
  let app;
  let admin;
  before(async () => {
    app = await startApp();
    admin = await app.login('admin-construction');
  });
  after(() => app.close());

  const submit = (cookie, body) => app.request('/api/disputes', { method: 'POST', cookie, body });
  const decide = (decision, id, note, cookie = admin.cookie) =>
    app.request(`/api/admin/disputes/${id}/decision`, { method: 'POST', cookie, body: { decision, note } });
  const claimOut = (shift, hhmm) => istMs(app.daysAgo(Math.round((NOW - shift.checkIn) / (24 * HOUR))), hhmm);

  describe('who can do what', () => {
    test('only the worker who owns a record can contest it, and only inside their own org', async () => {
      const owner = await addWorker(app);
      const other = await addWorker(app);
      const shift = await addShift(app, owner.worker, 3);
      const body = { shiftId: shift.id, category: 'wrong_time', checkOutAt: istMs(app.daysAgo(3), '17:00') };
      assert.equal((await submit(other.cookie, body)).status, 404, 'another worker');
      const college = await app.login('worker-college');
      assert.equal((await submit(college.cookie, body)).status, 404, 'a worker of another org');
      assert.equal((await submit(undefined, body)).status, 401);
      assert.equal((await submit(admin.cookie, body)).status, 403, 'an employer cannot file one');
      assert.equal((await submit(owner.cookie, body)).status, 201);
    });

    test('a worker sees only their own disputes and audit entries', async () => {
      const a = await addWorker(app);
      const b = await addWorker(app);
      const shift = await addShift(app, a.worker, 4);
      await submit(a.cookie, { shiftId: shift.id, category: 'wrong_time', checkOutAt: istMs(app.daysAgo(4), '17:00') });
      const mine = (await app.request('/api/disputes', { cookie: a.cookie })).json;
      assert.equal(mine.items.length, 1);
      assert.ok(mine.audit.every((e) => e.digest));
      const theirs = (await app.request('/api/disputes', { cookie: b.cookie })).json;
      assert.deepEqual([theirs.items, theirs.audit], [[], []]);
    });

    test('the employer queue and decisions are limited to their own org', async () => {
      const w = await addWorker(app);
      const shift = await addShift(app, w.worker, 3);
      const filed = await submit(w.cookie, { shiftId: shift.id, category: 'wrong_time', checkOutAt: istMs(app.daysAgo(3), '17:00') });
      const college = await app.login('admin-college');
      const queue = (await app.request('/api/admin/disputes', { cookie: college.cookie })).json.items;
      assert.ok(queue.every((d) => d.id !== filed.json.id));
      assert.equal((await decide('approve', filed.json.id, '', college.cookie)).status, 404);
      assert.equal((await app.request(`/api/admin/disputes/${filed.json.id}/review`, { method: 'POST', cookie: college.cookie })).status, 404);
      assert.equal((await app.store.shifts.get(ORG, shift.id)).checkOut, shift.checkOut, 'nothing changed');
      const workerAttempt = await decide('approve', filed.json.id, '', w.cookie);
      assert.equal(workerAttempt.status, 403);
    });
  });

  describe('rules for filing', () => {
    test('records from the last 14 days can be contested, older ones cannot (boundary)', async () => {
      const w = await addWorker(app);
      const edge = await addShift(app, w.worker, 14);
      const old = await addShift(app, w.worker, 15);
      const claim = (shift, daysAgo) => ({ shiftId: shift.id, category: 'wrong_time', checkOutAt: istMs(app.daysAgo(daysAgo), '17:00') });
      assert.equal((await submit(w.cookie, claim(edge, 14))).status, 201);
      const refused = await submit(w.cookie, claim(old, 15));
      assert.equal(refused.status, 422);
      assert.equal(refused.json.error.code, 'outside_dispute_window');
      const records = (await app.request('/api/attendance/records', { cookie: w.cookie })).json;
      assert.equal(records.windowDays, 14);
      assert.deepEqual(records.records.map((r) => r.id), [edge.id], 'the list only holds records inside the window');
    });

    test('one open dispute per record; after a rejection a new one is allowed', async () => {
      const w = await addWorker(app);
      const shift = await addShift(app, w.worker, 3);
      const body = { shiftId: shift.id, category: 'wrong_time', checkOutAt: istMs(app.daysAgo(3), '17:00') };
      const first = await submit(w.cookie, body);
      assert.equal(first.status, 201);
      const again = await submit(w.cookie, body);
      assert.equal(again.status, 409);
      assert.equal(again.json.error.code, 'dispute_already_open');
      await app.request(`/api/admin/disputes/${first.json.id}/review`, { method: 'POST', cookie: admin.cookie });
      assert.equal((await submit(w.cookie, body)).status, 409, 'still open while under review');
      assert.equal((await decide('reject', first.json.id, 'Gate log disagrees')).status, 200);
      assert.equal((await submit(w.cookie, body)).status, 201);
    });

    test('every category is validated: required fields, plausible times, real change', async () => {
      const w = await addWorker(app);
      const done = await addShift(app, w.worker, 3);
      const forgotten = await addShift(app, w.worker, 5, '08:00', null);
      const day = (n) => app.daysAgo(n);
      const reasonOf = async (body) => {
        const res = await submit(w.cookie, body);
        assert.equal(res.status, 422, JSON.stringify(body));
        return res.json.error.details?.reason ?? res.json.error.code;
      };
      assert.equal(await reasonOf({ shiftId: forgotten.id, category: 'forgot_checkout' }), 'check_out_required');
      assert.equal(await reasonOf({ shiftId: done.id, category: 'forgot_checkout', checkOutAt: istMs(day(3), '17:00') }), 'not_forgotten');
      assert.equal(await reasonOf({ shiftId: done.id, category: 'wrong_time' }), 'time_required');
      assert.equal(await reasonOf({ shiftId: done.id, category: 'wrong_site' }), 'site_required');
      assert.equal(await reasonOf({ shiftId: done.id, category: 'wrong_site', siteId: 'site-con-1' }), 'no_change');
      assert.equal(await reasonOf({ shiftId: done.id, category: 'wrong_site', siteId: 'site-col-1' }), 'unknown_site');
      assert.equal(await reasonOf({ shiftId: done.id, category: 'other' }), 'note_required');
      assert.equal(await reasonOf({ shiftId: done.id, category: 'wrong_time', checkOutAt: istMs(day(3), '07:00') }), 'check_out_before_check_in');
      assert.equal(await reasonOf({ shiftId: done.id, category: 'wrong_time', checkOutAt: istMs(day(3), '16:00') }), 'no_change');
      assert.equal(await reasonOf({ shiftId: done.id, category: 'wrong_time', checkInAt: istMs(day(3), '08:00') - 48 * HOUR, checkOutAt: istMs(day(3), '16:00') - 48 * HOUR }), 'wrong_day');
      assert.equal(await reasonOf({ shiftId: done.id, category: 'wrong_time', checkOutAt: NOW + HOUR }), 'in_the_future');
      assert.equal(await reasonOf({ shiftId: done.id, category: 'wrong_time', checkOutAt: istMs(day(3), '08:00') + 19 * HOUR }), 'too_long');
    });

    test('the request body is validated: types, enums, ids and lengths', async () => {
      const w = await addWorker(app);
      const shift = await addShift(app, w.worker, 3);
      const bad = [
        { shiftId: shift.id, category: 'hacking' },
        { shiftId: '../x', category: 'other', note: 'valid note' },
        { shiftId: shift.id, category: 'wrong_time', checkOutAt: 'noon' },
        { shiftId: shift.id, category: 'wrong_time', checkOutAt: 12.5 },
        { shiftId: shift.id, category: 'other', note: 'x'.repeat(501) },
        { category: 'other', note: 'missing shift id' },
      ];
      for (const body of bad) assert.equal((await submit(w.cookie, body)).status, 422, JSON.stringify(body));
    });

    test('filing is rate limited', async () => {
      const limited = await startApp({ limits: { global: 1000, login: 10, report: 3 } });
      try {
        const w = await addWorker(limited);
        const statuses = [];
        for (let i = 0; i < 5; i += 1) statuses.push((await limited.request('/api/disputes', { method: 'POST', cookie: w.cookie, body: { shiftId: 'x', category: 'other', note: 'rate' } })).status);
        assert.deepEqual(statuses, [404, 404, 404, 429, 429]);
      } finally {
        await limited.close();
      }
    });
  });

  describe('approving a dispute', () => {
    test('applies the correction and recalculates hours, overtime, rest warnings and pay', async () => {
      const w = await addWorker(app);
      const shift = await addShift(app, w.worker, 2, '08:00', '16:00');
      const payslip = async () => (await app.request(`/api/workers/${w.worker.id}/payslips/${app.today.slice(0, 7)}`, { cookie: w.cookie })).json;
      const before = await payslip();
      assert.equal(before.totals.overtimeMinutes, 0);
      const dashBefore = (await app.request('/api/admin/dashboard', { cookie: admin.cookie })).json.kpis.overtimeMinutesWeek;

      const filed = (await submit(w.cookie, { shiftId: shift.id, category: 'wrong_time', checkOutAt: istMs(app.daysAgo(2), '19:00'), note: 'Stayed late' })).json;
      assert.equal(filed.status, 'submitted');
      assert.equal((await app.request(`/api/admin/disputes/${filed.id}/review`, { method: 'POST', cookie: admin.cookie })).json.status, 'under_review');
      const approved = await decide('approve', filed.id, 'Checked the gate log');
      assert.equal(approved.status, 200);
      assert.equal(approved.json.dispute.status, 'approved');

      const { recalculation } = approved.json;
      assert.equal(recalculation.totalMinutes, 11 * 60);
      assert.equal(recalculation.overtimeMinutes, 3 * 60);
      assert.ok(recalculation.fatigue.rules.includes('long_day'), 'an 11 hour day raises a rest warning');
      assert.equal(recalculation.fatigue.level, 'amber');

      const stored = await app.store.shifts.get(ORG, shift.id);
      assert.equal(stored.checkOut, istMs(app.daysAgo(2), '19:00'));
      const after = await payslip();
      assert.equal(after.totals.overtimeMinutes, 180);
      assert.equal(recalculation.payslip.netBeforePaise, before.netPaise);
      assert.equal(recalculation.payslip.netAfterPaise, after.netPaise);
      assert.ok(after.netPaise > before.netPaise);
      assert.equal(after.lines.find((l) => l.key === 'overtime').amountPaise, 3 * 11_250 * 2, '3 h x Rs 112.50 x 2.0');

      const dashAfter = (await app.request('/api/admin/dashboard', { cookie: admin.cookie })).json.kpis.overtimeMinutesWeek;
      assert.equal(dashAfter - dashBefore, 180);
      const rest = (await app.request('/api/attendance/today', { cookie: w.cookie })).json.rest;
      assert.equal(rest.level, 'amber');
    });

    test('a site correction moves the record to the claimed site', async () => {
      const w = await addWorker(app);
      const shift = await addShift(app, w.worker, 3);
      const filed = (await submit(w.cookie, { shiftId: shift.id, category: 'wrong_site', siteId: 'site-con-2' })).json;
      await decide('approve', filed.id, '');
      assert.equal((await app.store.shifts.get(ORG, shift.id)).siteId, 'site-con-2');
    });

    test('a forgotten check-out is fixed by approving the claimed time', async () => {
      const w = await addWorker(app);
      const open = await addShift(app, w.worker, 3, '08:00', null);
      const filed = (await submit(w.cookie, { shiftId: open.id, category: 'forgot_checkout', checkOutAt: istMs(app.daysAgo(3), '16:30') })).json;
      const approved = await decide('approve', filed.id, 'Confirmed with the supervisor');
      assert.equal(approved.json.recalculation.totalMinutes, 510);
      assert.equal((await app.store.shifts.get(ORG, open.id)).checkOut, istMs(app.daysAgo(3), '16:30'));
    });

    test('an approval cannot be applied twice, even when two employers click at once', async () => {
      const w = await addWorker(app);
      const shift = await addShift(app, w.worker, 3);
      const filed = (await submit(w.cookie, { shiftId: shift.id, category: 'wrong_time', checkOutAt: istMs(app.daysAgo(3), '17:30') })).json;
      const [one, two] = await Promise.all([decide('approve', filed.id, 'one'), decide('approve', filed.id, 'two')]);
      assert.deepEqual([one.status, two.status].sort(), [200, 409]);
      const loser = one.status === 409 ? one : two;
      assert.equal(loser.json.error.code, 'dispute_already_decided');
      const entries = (await app.request('/api/disputes', { cookie: w.cookie })).json.audit;
      assert.equal(entries.filter((e) => e.action === 'dispute_approved').length, 1);
      assert.equal(entries.filter((e) => e.action === 'shift_corrected').length, 1);
      assert.equal((await decide('approve', filed.id, 'later')).status, 409);
      assert.equal((await decide('reject', filed.id, 'too late')).status, 409);
    });

    test('if the record changed after the dispute was filed, approval is refused and nothing changes', async () => {
      const w = await addWorker(app);
      const open = await addShift(app, w.worker, 3, '08:00', null);
      const filed = (await submit(w.cookie, { shiftId: open.id, category: 'forgot_checkout', checkOutAt: istMs(app.daysAgo(3), '16:30') })).json;
      await app.store.shifts.update(ORG, open.id, { checkOut: istMs(app.daysAgo(3), '15:00') });
      const res = await decide('approve', filed.id, '');
      assert.equal(res.status, 409);
      assert.equal(res.json.error.code, 'record_changed');
      assert.equal((await app.store.shifts.get(ORG, open.id)).checkOut, istMs(app.daysAgo(3), '15:00'));
      assert.equal((await app.store.disputes.get(ORG, filed.id)).status, 'submitted');
    });
  });

  describe('rejecting a dispute', () => {
    test('needs a note, leaves the hours alone, and the worker can read the reason', async () => {
      const w = await addWorker(app);
      const shift = await addShift(app, w.worker, 3);
      const filed = (await submit(w.cookie, { shiftId: shift.id, category: 'wrong_time', checkOutAt: istMs(app.daysAgo(3), '17:00') })).json;
      const noNote = await decide('reject', filed.id, '');
      assert.equal(noNote.status, 422);
      assert.equal(noNote.json.error.code, 'note_required');
      const rejected = await decide('reject', filed.id, 'The gate log shows 16:00');
      assert.equal(rejected.status, 200);
      assert.equal(rejected.json.recalculation, null);
      assert.equal((await app.store.shifts.get(ORG, shift.id)).checkOut, shift.checkOut);
      const mine = (await app.request('/api/disputes', { cookie: w.cookie })).json.items[0];
      assert.equal(mine.status, 'rejected');
      assert.equal(mine.decisionNote, 'The gate log shows 16:00');
      assert.deepEqual(mine.timeline.map((e) => e.action), ['dispute_submitted', 'dispute_rejected']);
    });
  });

  describe('the audit trail', () => {
    test('the worker sees a full timeline, and every entry is intact and carries before and after', async () => {
      const w = await addWorker(app);
      const shift = await addShift(app, w.worker, 3);
      const filed = (await submit(w.cookie, { shiftId: shift.id, category: 'wrong_time', checkOutAt: istMs(app.daysAgo(3), '17:00') })).json;
      await app.request(`/api/admin/disputes/${filed.id}/review`, { method: 'POST', cookie: admin.cookie });
      await decide('approve', filed.id, 'ok');
      const mine = (await app.request('/api/disputes', { cookie: w.cookie })).json;
      assert.deepEqual(mine.items[0].timeline.map((e) => e.action), ['dispute_submitted', 'dispute_review_started', 'shift_corrected', 'dispute_approved']);
      const correction = mine.items[0].timeline.find((e) => e.action === 'shift_corrected');
      assert.equal(correction.before.checkOut, shift.checkOut);
      assert.equal(correction.after.checkOut, istMs(app.daysAgo(3), '17:00'));
      assert.equal(correction.actorRole, 'admin');
      const stored = await app.store.audit.query(ORG, { where: { workerId: w.worker.id } });
      assert.equal(stored.length, 4);
      assert.ok(stored.every(isIntact));
      assert.equal(isIntact({ ...stored[0], note: 'edited later' }), false, 'tampering is detectable');
    });

    test('the correction is written to the audit trail before the record is changed', async () => {
      const w = await addWorker(app);
      const shift = await addShift(app, w.worker, 3);
      const filed = (await submit(w.cookie, { shiftId: shift.id, category: 'wrong_time', checkOutAt: istMs(app.daysAgo(3), '17:00') })).json;
      const original = app.store.shifts.update;
      const seen = [];
      app.store.shifts.update = async (...args) => {
        seen.push((await app.store.audit.query(ORG, { where: { workerId: w.worker.id } })).map((e) => e.action));
        return original(...args);
      };
      try {
        await decide('approve', filed.id, 'ok');
      } finally {
        app.store.shifts.update = original;
      }
      assert.equal(seen.length, 1);
      assert.ok(seen[0].includes('shift_corrected'), 'the audit entry already existed when the record was updated');
    });

    test('if the audit entry cannot be written, the hours do not change', async () => {
      const clock = fixedClock(NOW);
      const store = await seededStore(clock);
      const services = createServices({ store, clock, env: testEnv() });
      const failingAudit = { ...services.audit, record: async (fields) => (fields.action === 'shift_corrected' ? Promise.reject(new Error('audit down')) : services.audit.record(fields)) };
      const disputes = createDisputeService({ store, clock, audit: failingAudit, attendance: services.attendance, payroll: services.payroll });
      const worker = (await store.workers.query(ORG))[1];
      const shift = (await store.shifts.query(ORG, { where: { workerId: worker.id } })).find((s) => s.checkOut !== null && NOW - s.checkIn > 3 * 24 * HOUR && NOW - s.checkIn < 8 * 24 * HOUR);
      const filed = await disputes.submit(worker, { shiftId: shift.id, category: 'wrong_time', checkOutAt: shift.checkOut + HOUR });
      await assert.rejects(disputes.decide(ORG, 'adm-con', filed.id, { decision: 'approve', note: '' }), /audit down/);
      assert.equal((await store.shifts.get(ORG, shift.id)).checkOut, shift.checkOut);
      assert.equal((await store.disputes.get(ORG, filed.id)).status, 'submitted');
    });

    test('there is no endpoint that changes hours or audit entries directly', async () => {
      const w = await addWorker(app);
      const shift = await addShift(app, w.worker, 3);
      for (const [method, path] of [['PATCH', `/api/admin/shifts/${shift.id}`], ['PUT', `/api/admin/shifts/${shift.id}`], ['DELETE', `/api/admin/shifts/${shift.id}`], ['PATCH', '/api/admin/audit/x'], ['DELETE', '/api/admin/audit/x']]) {
        const res = await app.request(path, { method, cookie: admin.cookie, body: { checkOut: 1 } });
        assert.equal(res.status, 404, `${method} ${path}`);
      }
      assert.equal((await app.store.shifts.get(ORG, shift.id)).checkOut, shift.checkOut);
    });

    test('forgotten shifts that are closed automatically leave a system audit entry the worker can see', async () => {
      const clock = fixedClock(NOW);
      const store = await seededStore(clock);
      const services = createServices({ store, clock, env: testEnv() });
      const worker = { id: 'w-test-auto', orgId: ORG, name: 'Auto Close', role: 'mason', dailyWagePaise: 90_000, siteId: 'site-con-1', shiftId: 'day', passportToken: null, joinedOn: '2020-01-01' };
      await store.workers.insert(worker);
      const first = await services.attendance.checkIn(worker, { method: 'button' });
      clock.advance(20 * HOUR);
      await services.attendance.checkIn(worker, { method: 'button' });
      const entries = await createAuditService({ store, clock }).listForWorker(ORG, worker.id);
      const auto = entries.find((e) => e.action === 'shift_auto_closed');
      assert.equal(auto.actorRole, 'system');
      assert.equal(auto.shiftId, first.id);
      assert.equal(auto.before.checkOut, null);
      assert.equal(auto.after.checkOut - auto.after.checkIn, 8 * HOUR);
      assert.ok(isIntact(auto));
    });
  });

  test('the worker records screen lists records in the window with their open dispute', async () => {
    const w = await addWorker(app);
    const shift = await addShift(app, w.worker, 2);
    await addShift(app, w.worker, 6);
    const filed = (await submit(w.cookie, { shiftId: shift.id, category: 'wrong_time', checkInAt: istMs(app.daysAgo(2), '07:30') })).json;
    const { records, sites } = (await app.request('/api/attendance/records', { cookie: w.cookie })).json;
    assert.equal(records.length, 2);
    assert.equal(records[0].id, shift.id, 'newest first');
    assert.equal(records[0].openDisputeId, filed.id);
    assert.equal(records[1].openDisputeId, null);
    assert.ok(sites.length >= 2);
  });

  test('demo data includes disputes in every state for the employer queue', async () => {
    const queue = (await app.request('/api/admin/disputes', { cookie: admin.cookie })).json.items;
    const statuses = new Set(queue.map((d) => d.status));
    assert.ok(['submitted', 'under_review', 'rejected'].every((s) => statuses.has(s)));
    assert.ok(queue.every((d) => d.worker?.name && d.timeline.length > 0));
    const open = queue.filter((d) => ['submitted', 'under_review'].includes(d.status));
    assert.equal(queue.indexOf(open.at(-1)) < queue.findIndex((d) => d.status === 'rejected'), true, 'open ones come first');
  });
});
