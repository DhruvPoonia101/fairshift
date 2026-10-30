import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { SECTORS } from '../src/config/sectors.js';
import { checkCompliance, expectedPay, formatRupees } from '../src/services/compliance.js';
import { computePayslip } from '../src/services/payroll.js';
import { istMs, shiftOf, startApp } from './helpers.js';

const RULES = { minDailyWagePaise: 60_000, minHourlyWagePaise: null, overtimeMultiplierPct: 200, note: 'verify' };
const day = (d) => `2026-09-${String(d).padStart(2, '0')}`;

/** One shift per listed day of September 2026, each `minutes` long from 09:00. */
const shifts = (days, minutes = 480) => days.map((d) => shiftOf(istMs(day(d), '09:00'), minutes));
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const slipOf = (dailyWagePaise, shiftList) => computePayslip({ worker: { dailyWagePaise }, shifts: shiftList });
const check = (slip, payment, extra = {}) =>
  checkCompliance({ slip, rules: RULES, payment, isOpenMonth: false, pendingShift: false, ...extra });

describe('expected pay', () => {
  test('uses the contract wage when it is above the minimum', () => {
    const e = expectedPay(slipOf(80_000, shifts(range(1, 10))), RULES);
    assert.equal(e.dailyWagePaise, 80_000);
    assert.equal(e.regularPaise, 800_000);
  });

  test('lifts a wage below the minimum up to the minimum', () => {
    const e = expectedPay(slipOf(50_000, shifts(range(1, 10))), RULES);
    assert.equal(e.dailyWagePaise, 60_000);
    assert.equal(e.regularPaise, 600_000);
  });

  test('a minimum hourly wage is turned into a daily wage over an 8 hour day', () => {
    const e = expectedPay(slipOf(50_000, shifts([1])), { ...RULES, minDailyWagePaise: null, minHourlyWagePaise: 8_000 });
    assert.equal(e.dailyWagePaise, 64_000);
  });

  test('overtime is expected at the configured multiplier, in whole paise', () => {
    const slip = slipOf(80_000, shifts([1, 2], 600)); // 4 overtime hours
    assert.equal(expectedPay(slip, RULES).overtimePaise, 80_000); // 4 h x Rs 100 x 2
    assert.equal(expectedPay(slip, { ...RULES, overtimeMultiplierPct: 150 }).overtimePaise, 60_000);
  });
});

describe('compliance result', () => {
  const full = (slip) => {
    const e = expectedPay(slip, RULES);
    return { paidRegularPaise: e.regularPaise, paidOvertimePaise: e.overtimePaise };
  };

  test('paid exactly the minimum is ok, with no reasons and nothing short', () => {
    const slip = slipOf(60_000, shifts(range(1, 22)));
    const r = check(slip, full(slip));
    assert.equal(r.status, 'ok');
    assert.equal(r.expectedPaise, 22 * 60_000);
    assert.equal(r.paidPaise, r.expectedPaise);
    assert.deepEqual([r.shortfallPaise, r.reasons], [0, []]);
  });

  test('a wage below the minimum that was paid as contracted is underpaid, with the reason and the shortfall', () => {
    const slip = slipOf(50_000, shifts(range(1, 20)));
    const r = check(slip, { paidRegularPaise: 20 * 50_000, paidOvertimePaise: 0 });
    assert.equal(r.status, 'underpaid');
    assert.equal(r.shortfallPaise, 20 * 10_000);
    assert.equal(r.reasons[0].key, 'below_minimum_wage');
    assert.match(r.reasons[0].text, /₹500 is below the minimum of ₹600/);
  });

  test('rounding: up to Rs 1 short is treated as rounding, one paisa more is underpaid', () => {
    const slip = slipOf(70_001, shifts(range(1, 21))); // 70001 does not divide into 8 hours
    const e = expectedPay(slip, RULES);
    assert.ok(Number.isInteger(e.regularPaise) && Number.isInteger(e.overtimePaise));
    const paid = (short) => ({ paidRegularPaise: e.regularPaise - short, paidOvertimePaise: e.overtimePaise });
    assert.equal(check(slip, paid(100)).status, 'ok');
    assert.equal(check(slip, paid(100)).shortfallPaise, 0);
    const over = check(slip, paid(101));
    assert.equal(over.status, 'underpaid');
    assert.equal(over.shortfallPaise, 101);
  });

  test('no overtime worked: no overtime reasons, and paying extra is never a problem', () => {
    const slip = slipOf(80_000, shifts(range(1, 10)));
    assert.equal(check(slip, { paidRegularPaise: 800_000, paidOvertimePaise: 0 }).status, 'ok');
    assert.equal(check(slip, { paidRegularPaise: 900_000, paidOvertimePaise: 5_000 }).status, 'ok');
    const short = check(slip, { paidRegularPaise: 500_000, paidOvertimePaise: 0 });
    assert.deepEqual(short.reasons.map((r) => r.key), ['regular_short']);
  });

  test('partial days are paid in proportion: half a day expected, half a day paid is ok', () => {
    const slip = slipOf(80_000, shifts([1, 2, 3], 240)); // three 4-hour days
    const e = expectedPay(slip, RULES);
    assert.equal(e.regularPaise, 120_000);
    assert.equal(check(slip, { paidRegularPaise: 120_000, paidOvertimePaise: 0 }).status, 'ok');
    const full = check(slip, { paidRegularPaise: 80_000, paidOvertimePaise: 0 });
    assert.equal(full.status, 'underpaid');
    assert.equal(full.shortfallPaise, 40_000);
  });

  test('overtime paid at the normal rate says so in plain words (10 hours)', () => {
    const slip = slipOf(80_000, shifts(range(1, 5), 600)); // 5 shifts x 2 overtime hours
    const e = expectedPay(slip, RULES);
    assert.equal(e.overtimePaise, 200_000);
    const r = check(slip, { paidRegularPaise: e.regularPaise, paidOvertimePaise: 100_000 });
    assert.equal(r.status, 'underpaid');
    assert.equal(r.shortfallPaise, 100_000);
    assert.equal(r.reasons[0].key, 'overtime_normal_rate');
    assert.equal(r.reasons[0].text, '10 overtime hours were paid at the normal rate.');
  });

  test('overtime paid at a lower rate, or not at all, gets its own reason', () => {
    const slip = slipOf(80_000, shifts(range(1, 5), 600));
    const e = expectedPay(slip, RULES);
    const low = check(slip, { paidRegularPaise: e.regularPaise, paidOvertimePaise: 150_000 });
    assert.equal(low.reasons[0].key, 'overtime_low_rate');
    assert.deepEqual([low.reasons[0].params.paidRatePct, low.reasons[0].params.requiredRatePct], [150, 200]);
    const none = check(slip, { paidRegularPaise: e.regularPaise, paidOvertimePaise: 0 });
    assert.equal(none.reasons[0].key, 'overtime_unpaid');
    assert.equal(none.reasons[0].text, '10 overtime hours were not paid.');
  });

  test('one overtime hour reads correctly in the singular', () => {
    const slip = slipOf(80_000, shifts([1], 540));
    const r = check(slip, { paidRegularPaise: 80_000, paidOvertimePaise: 0 });
    assert.equal(r.reasons[0].text, '1 overtime hour was not paid.');
  });

  test('both a short regular amount and bad overtime are reported together, summing the shortfall', () => {
    const slip = slipOf(80_000, shifts(range(1, 5), 600));
    const e = expectedPay(slip, RULES);
    const r = check(slip, { paidRegularPaise: e.regularPaise - 80_000, paidOvertimePaise: 100_000 });
    assert.deepEqual(r.reasons.map((x) => x.key), ['overtime_normal_rate', 'regular_short']);
    assert.equal(r.shortfallPaise, 80_000 + 100_000);
  });

  test('cannot-check cases are "review": month still running, shift still open, no payment recorded', () => {
    const slip = slipOf(80_000, shifts([1, 2]));
    const pay = { paidRegularPaise: 160_000, paidOvertimePaise: 0 };
    assert.equal(check(slip, pay, { isOpenMonth: true }).reasons[0].key, 'month_in_progress');
    assert.equal(check(slip, pay, { pendingShift: true }).reasons[0].key, 'open_shift');
    const none = check(slip, null);
    assert.deepEqual([none.status, none.paidPaise, none.reasons[0].key], ['review', null, 'no_payment_record']);
    assert.equal(none.expectedPaise, 160_000);
  });

  test('the sector wage note travels with the result, and rupee text is formatted in the Indian style', () => {
    assert.equal(check(slipOf(80_000, shifts([1])), null).note, 'verify');
    assert.equal(formatRupees(123_456_700), '₹12,34,567');
    assert.equal(formatRupees(150), '₹1.50');
  });

  test('every sector defines wage rules with a note, a minimum and a 2x overtime default', () => {
    for (const sector of Object.values(SECTORS)) {
      assert.ok(sector.wageRules.note.includes('Verify against current state notifications'));
      assert.ok(Number.isInteger(sector.wageRules.minDailyWagePaise));
      assert.equal(sector.wageRules.overtimeMultiplierPct, 200);
      for (const role of sector.roles) {
        assert.ok(role.dailyWagePaise >= sector.wageRules.minDailyWagePaise, `${sector.id}/${role.id} is at or above the minimum`);
      }
    }
  });
});

describe('compliance through the API', () => {
  let app;
  let worker;
  let admin;
  before(async () => {
    app = await startApp();
    worker = await app.login('worker-construction');
    admin = await app.login('admin-construction');
  });
  after(() => app.close());

  test('the demo worker\'s last month is flagged, with a reason, the shortfall and the expected amount', async () => {
    const res = await app.request(`/api/workers/${worker.session.user.id}/payslips/2026-09`, { cookie: worker.cookie });
    const { compliance } = res.json;
    assert.equal(compliance.status, 'underpaid');
    assert.equal(compliance.expectedPaise - compliance.paidPaise, compliance.shortfallPaise);
    assert.ok(Number.isInteger(compliance.shortfallPaise) && compliance.shortfallPaise > 100);
    assert.match(compliance.reasons[0].text, /overtime hours were paid at the normal rate/);
    assert.match(compliance.note, /Verify against current state notifications/);
  });

  test('this month is "review" because it is not finished, and a worker with correct pay sees ok', async () => {
    const current = await app.request(`/api/workers/${worker.session.user.id}/payslips/2026-10`, { cookie: worker.cookie });
    assert.equal(current.json.compliance.status, 'review');
    assert.equal(current.json.compliance.reasons[0].key, 'month_in_progress');
    const other = (await app.store.workers.query('org-construction')).find((w) => w.id === 'w-con-05');
    const login = await app.login('worker-construction');
    const ok = await app.request(`/api/workers/${other.id}/payslips/2026-09`, { cookie: admin.cookie });
    assert.equal(ok.json.compliance.status, 'ok');
    assert.ok(login.cookie);
  });

  test('the admin list holds the flagged payslips, biggest shortfall first, with a summary', async () => {
    const res = await app.request('/api/admin/compliance', { cookie: admin.cookie });
    assert.equal(res.status, 200);
    assert.equal(res.json.month, '2026-09');
    assert.ok(res.json.items.length >= 2, 'at least two flagged payslips are seeded');
    const shortfalls = res.json.items.map((i) => i.shortfallPaise);
    assert.deepEqual(shortfalls, [...shortfalls].sort((a, b) => b - a));
    assert.equal(res.json.summary.underpaid, res.json.items.filter((i) => i.status === 'underpaid').length);
    assert.equal(res.json.summary.shortfallPaise, shortfalls.reduce((a, b) => a + b, 0));
    assert.ok(res.json.items.every((i) => i.name && i.reasons.length > 0));
  });

  test('the admin list is for admins of the same org only, and the month is validated', async () => {
    assert.equal((await app.request('/api/admin/compliance', { cookie: worker.cookie })).status, 403);
    assert.equal((await app.request('/api/admin/compliance')).status, 401);
    assert.equal((await app.request('/api/admin/compliance?month=2026-13', { cookie: admin.cookie })).status, 422);
    const college = await app.login('admin-college');
    const names = new Set((await app.store.workers.query('org-construction')).map((w) => w.name));
    const list = (await app.request('/api/admin/compliance', { cookie: college.cookie })).json.items;
    assert.ok(list.length >= 2);
    assert.ok(list.every((i) => !names.has(i.name)), 'only the college\'s own workers appear');
  });
});
