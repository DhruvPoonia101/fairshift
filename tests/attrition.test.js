import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addDays } from '../src/lib/time.js';
import { deriveSignals, scoreAttrition } from '../src/services/attrition.js';
import { istMs, shiftOf } from './helpers.js';

const TODAY = '2026-10-27';
const NOW = istMs(TODAY, '12:00');
const calm = {
  recentDays: 12,
  priorDays: 12,
  lateCount: 0,
  fatigueFlagCount: 0,
  openNamedGrievances: 0,
  payslipDisputes: 0,
  tenureDays: 400,
};
const keys = (r) => r.reasons.map((x) => x.key);

test('a settled worker scores zero with no reasons', () => {
  const r = scoreAttrition(calm);
  assert.deepEqual(r, { score: 0, band: 'low', atRisk: false, reasons: [] });
});

test('every reason carries its points and the numbers behind it', () => {
  const r = scoreAttrition({ ...calm, recentDays: 5, priorDays: 12, lateCount: 4 });
  assert.deepEqual(keys(r), ['absenteeism', 'late']);
  assert.deepEqual(r.reasons[0].params, { recent: 5, prior: 12 });
  assert.equal(r.score, 40);
  assert.equal(r.atRisk, true);
});

test('an absence drop of 2 days is not flagged, 3 days is', () => {
  assert.deepEqual(keys(scoreAttrition({ ...calm, recentDays: 10 })), []);
  assert.deepEqual(keys(scoreAttrition({ ...calm, recentDays: 9 })), ['absenteeism']);
});

test('late check-ins need 3 or more; tenure under 90 days counts', () => {
  assert.deepEqual(keys(scoreAttrition({ ...calm, lateCount: 2 })), []);
  assert.deepEqual(keys(scoreAttrition({ ...calm, lateCount: 3 })), ['late']);
  assert.deepEqual(keys(scoreAttrition({ ...calm, tenureDays: 89 })), ['new_joiner']);
  assert.deepEqual(keys(scoreAttrition({ ...calm, tenureDays: 90 })), []);
});

test('fatigue and grievance points are capped, and the total never exceeds 100', () => {
  const r = scoreAttrition({
    recentDays: 0,
    priorDays: 14,
    lateCount: 10,
    fatigueFlagCount: 9,
    openNamedGrievances: 9,
    payslipDisputes: 3,
    tenureDays: 5,
  });
  assert.equal(r.reasons.find((x) => x.key === 'fatigue').points, 20);
  assert.equal(r.reasons.find((x) => x.key === 'grievance').points, 30);
  assert.equal(r.score, 100);
  assert.equal(r.band, 'high');
});

const worker = { id: 'w-1', joinedOn: addDays(TODAY, -200) };

test('derived signals count only the worker\'s own named, unresolved grievances', () => {
  const grievances = [
    { workerId: 'w-1', anonymous: false, status: 'open', source: 'manual', createdAt: NOW },
    { workerId: 'w-1', anonymous: false, status: 'resolved', source: 'manual', createdAt: NOW },
    { workerId: 'w-2', anonymous: false, status: 'open', source: 'manual', createdAt: NOW },
    { workerId: 'w-1', anonymous: false, status: 'in_review', source: 'payslip', createdAt: NOW },
  ];
  const s = deriveSignals({ worker, shifts: [], fatigueFlagCount: 0, grievances, shiftStartMinute: 540, nowMs: NOW });
  assert.equal(s.openNamedGrievances, 1);
  assert.equal(s.payslipDisputes, 1);
  assert.equal(s.tenureDays, 200);
});

test('anonymous grievances never feed an individual score', () => {
  const sneaky = [{ workerId: 'w-1', anonymous: true, status: 'open', source: 'manual', createdAt: NOW }];
  const s = deriveSignals({ worker, shifts: [], fatigueFlagCount: 0, grievances: sneaky, shiftStartMinute: 540, nowMs: NOW });
  assert.equal(s.openNamedGrievances, 0);
  assert.equal(s.payslipDisputes, 0);
});

test('late check-ins are counted against the usual shift start with a 15 minute grace', () => {
  const at = (daysAgo, hhmm) => shiftOf(istMs(addDays(TODAY, -daysAgo), hhmm), 480);
  const shifts = [at(1, '09:15'), at(2, '09:16'), at(3, '09:40'), at(4, '08:50'), at(20, '10:30')];
  const s = deriveSignals({ worker, shifts, fatigueFlagCount: 0, grievances: [], shiftStartMinute: 540, nowMs: NOW });
  assert.equal(s.lateCount, 2); // 09:16 and 09:40; 20 days ago is outside the 14-day window
  assert.equal(s.recentDays, 4);
});
