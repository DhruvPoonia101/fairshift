import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addDays } from '../src/lib/time.js';
import { computePayslip } from '../src/services/payroll.js';
import { istMs, shiftOf } from './helpers.js';

const line = (slip, key) => slip.lines.find((l) => l.key === key);

/** One 09:00 shift per listed day of September 2026. */
function monthOfShifts(days, minutes = 480) {
  return days.map((d) => shiftOf(istMs(`2026-09-${String(d).padStart(2, '0')}`, '09:00'), minutes));
}
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

test('regular pay, overtime, PF and ESI are exact integer paise', () => {
  // Rs 800/day: 20 normal days plus two 10-hour days (4 overtime hours in total).
  const shifts = [...monthOfShifts(range(1, 20)), ...monthOfShifts([21, 22], 600)];
  const slip = computePayslip({ worker: { dailyWagePaise: 80_000 }, shifts });
  assert.equal(slip.hourlyRatePaise, 10_000);
  assert.equal(line(slip, 'regular').amountPaise, 1_760_000);
  assert.equal(line(slip, 'overtime').amountPaise, 80_000); // 4 h x Rs 100 x 2.0
  assert.equal(slip.grossPaise, 1_840_000);
  assert.equal(line(slip, 'pf').amountPaise, 211_200); // 12% of regular pay only
  assert.equal(line(slip, 'esi').amountPaise, 13_800); // 0.75% of gross
  assert.equal(slip.netPaise, 1_615_000);
  for (const l of slip.lines) assert.ok(Number.isInteger(l.amountPaise));
});

test('the overtime multiplier is configurable', () => {
  const shifts = monthOfShifts([1], 600);
  const slip = computePayslip({ worker: { dailyWagePaise: 80_000 }, shifts, overtimeMultiplierPct: 150 });
  assert.equal(line(slip, 'overtime').amountPaise, 30_000); // 2 h x Rs 100 x 1.5
  assert.equal(line(slip, 'overtime').params.multiplier, 1.5);
});

test('ESI applies at exactly Rs 21,000 gross and stops above it', () => {
  const thirtyDays = monthOfShifts(range(1, 30));
  const atCeiling = computePayslip({ worker: { dailyWagePaise: 70_000 }, shifts: thirtyDays });
  assert.equal(atCeiling.grossPaise, 2_100_000);
  assert.equal(line(atCeiling, 'esi').amountPaise, 15_750);

  const above = computePayslip({ worker: { dailyWagePaise: 70_001 }, shifts: thirtyDays });
  assert.ok(above.grossPaise > 2_100_000);
  assert.equal(line(above, 'esi'), undefined);
  assert.equal(line(above, 'esi_not_applicable').amountPaise, 0);
});

test('advances are recovered only up to what is left after PF and ESI', () => {
  const slip = computePayslip({
    worker: { dailyWagePaise: 80_000 },
    shifts: monthOfShifts([1, 2]),
    advances: [{ amountPaise: 5_000_000 }],
  });
  assert.equal(slip.netPaise, 0);
  const advance = line(slip, 'advance');
  assert.equal(advance.amountPaise, slip.grossPaise - line(slip, 'pf').amountPaise - line(slip, 'esi').amountPaise);
  assert.equal(advance.params.carriedPaise, 5_000_000 - advance.amountPaise);
});

test('an open shift is not paid and no days means zero pay', () => {
  const open = { checkIn: istMs('2026-09-03', '09:00'), checkOut: null };
  const slip = computePayslip({ worker: { dailyWagePaise: 80_000 }, shifts: [open] });
  assert.equal(slip.netPaise, 0);
  assert.equal(slip.totals.daysWorked, 0);
});

test('a night shift is paid on the day it started, with its overtime', () => {
  const night = shiftOf(istMs('2026-09-10', '22:00'), 600);
  const slip = computePayslip({ worker: { dailyWagePaise: 80_000 }, shifts: [night] });
  assert.equal(slip.days[0].date, '2026-09-10');
  assert.equal(slip.totals.overtimeMinutes, 120);
});

test('the per-day table lists every worked day with its hours', () => {
  const slip = computePayslip({ worker: { dailyWagePaise: 80_000 }, shifts: monthOfShifts([1, 2, 3], 540) });
  assert.equal(slip.days.length, 3);
  assert.deepEqual(
    slip.days.map((d) => d.overtimeMinutes),
    [60, 60, 60],
  );
  assert.equal(addDays(slip.days[0].date, 1), slip.days[1].date);
});
