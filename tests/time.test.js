import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addDays, dayKey, dayRange, minuteOfDay, monthBounds, previousMonth, weekdayOf } from '../src/lib/time.js';
import { istMs } from './helpers.js';

test('dayKey switches at midnight IST, not midnight UTC', () => {
  assert.equal(dayKey(Date.parse('2026-10-27T18:29:59Z')), '2026-10-27');
  assert.equal(dayKey(Date.parse('2026-10-27T18:30:00Z')), '2026-10-28');
});

test('IST wall-clock helpers round-trip', () => {
  const ms = istMs('2026-03-01', '23:45');
  assert.equal(dayKey(ms), '2026-03-01');
  assert.equal(minuteOfDay(ms), 23 * 60 + 45);
});

test('addDays and dayRange cross month and year boundaries', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.deepEqual(dayRange('2026-02-27', '2026-03-01'), ['2026-02-27', '2026-02-28', '2026-03-01']);
});

test('monthBounds handles 28, 30 and 31 day months', () => {
  assert.equal(monthBounds('2026-02').lastDay, '2026-02-28');
  assert.equal(monthBounds('2026-09').lastDay, '2026-09-30');
  assert.equal(monthBounds('2026-12').lastDay, '2026-12-31');
  assert.equal(previousMonth('2026-01'), '2025-12');
});

test('weekdayOf uses the IST calendar day', () => {
  assert.equal(weekdayOf('2026-10-27'), 2); // Tuesday
});
