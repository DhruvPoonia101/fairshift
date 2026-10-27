import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addDays } from '../src/lib/time.js';
import { evaluateFatigue, fatigueLevel } from '../src/services/fatigue.js';
import { istMs, shiftOf } from './helpers.js';

const TODAY = '2026-10-27';
const NOW = istMs(TODAY, '12:00');
const day = (n) => addDays(TODAY, -n);
const rules = (flags) => flags.map((f) => f.rule);
const flagFor = (flags, rule) => flags.find((f) => f.rule === rule);

/** One 08:00 shift on each of the given days-ago. */
const shiftsOn = (daysAgo, minutes) => daysAgo.map((n) => shiftOf(istMs(day(n), '08:00'), minutes));

test('a 10 hour day is fine, 10 hours 1 minute raises long_day', () => {
  assert.deepEqual(rules(evaluateFatigue(shiftsOn([1], 600), NOW)), []);
  const flags = evaluateFatigue(shiftsOn([1], 601), NOW);
  assert.deepEqual(rules(flags), ['long_day']);
  assert.equal(flags[0].level, 'amber');
});

test('long_day only looks at the last 3 days', () => {
  assert.deepEqual(rules(evaluateFatigue(shiftsOn([3], 700), NOW)), []);
  assert.deepEqual(rules(evaluateFatigue(shiftsOn([2], 700), NOW)), ['long_day']);
});

test('48 hours in a week is fine, one minute more is amber', () => {
  assert.deepEqual(rules(evaluateFatigue(shiftsOn([1, 2, 3, 4, 5, 6], 480), NOW)), []);
  const flags = evaluateFatigue([...shiftsOn([1, 2, 3, 4, 5], 480), ...shiftsOn([6], 481)], NOW);
  assert.equal(flagFor(flags, 'week_hours').level, 'amber');
});

test('60 hours is amber, 60 hours 1 minute is red', () => {
  const sixDays = [1, 2, 3, 4, 5, 6];
  const atSixty = evaluateFatigue(shiftsOn(sixDays, 600), NOW);
  assert.equal(flagFor(atSixty, 'week_hours').level, 'amber');
  const overSixty = evaluateFatigue([...shiftsOn([1, 2, 3, 4, 5], 600), ...shiftsOn([6], 601)], NOW);
  assert.equal(flagFor(overSixty, 'week_hours').level, 'red');
  assert.equal(fatigueLevel(overSixty), 'red');
});

test('11 hours of rest between shifts is enough, 10 hours 59 minutes is not', () => {
  const first = shiftOf(istMs(day(2), '08:00'), 12 * 60); // ends 20:00
  const enough = shiftOf(istMs(day(1), '07:00'), 480); // 11 h later
  const tooSoon = shiftOf(istMs(day(1), '06:59'), 480); // 10 h 59 min later
  assert.deepEqual(rules(evaluateFatigue([first, enough], NOW)), ['long_day']);
  const flags = evaluateFatigue([first, tooSoon], NOW);
  assert.ok(rules(flags).includes('short_rest'));
  assert.equal(flagFor(flags, 'short_rest').params.minutes, 659);
});

test('6 days in a row is fine, 7 raises no_rest_day', () => {
  assert.ok(!rules(evaluateFatigue(shiftsOn([1, 2, 3, 4, 5, 6], 400), NOW)).includes('no_rest_day'));
  const flags = evaluateFatigue(shiftsOn([1, 2, 3, 4, 5, 6, 7], 400), NOW);
  assert.equal(flagFor(flags, 'no_rest_day').params.days, 7);
});

test('working today extends the streak; a gap resets it', () => {
  const sixThenToday = [...shiftsOn([1, 2, 3, 4, 5, 6], 400), shiftOf(istMs(TODAY, '08:00'), 120)];
  assert.ok(rules(evaluateFatigue(sixThenToday, NOW)).includes('no_rest_day'));
  const withGap = shiftsOn([1, 2, 4, 5, 6, 7, 8], 400);
  assert.ok(!rules(evaluateFatigue(withGap, NOW)).includes('no_rest_day'));
});

test('a shift still in progress counts up to now, but a forgotten one does not', () => {
  const longOpen = { checkIn: istMs(TODAY, '00:30'), checkOut: null };
  assert.ok(rules(evaluateFatigue([longOpen], istMs(TODAY, '12:00'))).includes('long_day'));
  const forgotten = { checkIn: istMs(day(2), '08:00'), checkOut: null };
  assert.deepEqual(evaluateFatigue([forgotten], NOW), []);
});

test('a rested worker has no flags and level none', () => {
  const flags = evaluateFatigue(shiftsOn([1, 2, 3], 480), NOW);
  assert.deepEqual(flags, []);
  assert.equal(fatigueLevel(flags), 'none');
});
