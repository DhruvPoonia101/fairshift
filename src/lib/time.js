import { IST_OFFSET_MINUTES, MS_PER_DAY, MS_PER_MINUTE } from '../config/constants.js';

/** All day-boundary logic lives here, in IST (UTC+05:30). Day keys are 'YYYY-MM-DD'. */

const IST_OFFSET_MS = IST_OFFSET_MINUTES * MS_PER_MINUTE;
const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_KEY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export const systemClock = Object.freeze({ now: () => Date.now() });

/** A clock that tests can move. */
export function fixedClock(startMs) {
  let current = startMs;
  return {
    now: () => current,
    set: (ms) => {
      current = ms;
    },
    advance: (ms) => {
      current += ms;
    },
  };
}

const pad = (n) => String(n).padStart(2, '0');

/** IST day key for an instant. */
export function dayKey(ms) {
  const d = new Date(ms + IST_OFFSET_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function monthKey(ms) {
  return dayKey(ms).slice(0, 7);
}

export function isDayKey(value) {
  return typeof value === 'string' && DAY_KEY_PATTERN.test(value) && !Number.isNaN(dayStartMs(value));
}

export function isMonthKey(value) {
  return typeof value === 'string' && MONTH_KEY_PATTERN.test(value);
}

/** Epoch ms of 00:00 IST on the given day. */
export function dayStartMs(key) {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d) - IST_OFFSET_MS;
}

export function addDays(key, delta) {
  return dayKey(dayStartMs(key) + delta * MS_PER_DAY + MS_PER_DAY / 2);
}

/** Minutes since 00:00 IST. */
export function minuteOfDay(ms) {
  const d = new Date(ms + IST_OFFSET_MS);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** 0 = Sunday ... 6 = Saturday. */
export function weekdayOf(key) {
  return new Date(dayStartMs(key) + IST_OFFSET_MS).getUTCDay();
}

/** Inclusive list of day keys from `from` to `to`. */
export function dayRange(from, to) {
  const keys = [];
  for (let k = from; k <= to; k = addDays(k, 1)) keys.push(k);
  return keys;
}

/** Whole days from `from` to `to` (to - from). */
export function daysBetween(from, to) {
  return Math.round((dayStartMs(to) - dayStartMs(from)) / MS_PER_DAY);
}

/** First and last day keys plus half-open ms bounds of a calendar month. */
export function monthBounds(month) {
  const first = `${month}-01`;
  const nextFirst = dayKey(dayStartMs(first) + 32 * MS_PER_DAY).slice(0, 7) + '-01';
  return {
    firstDay: first,
    lastDay: addDays(nextFirst, -1),
    startMs: dayStartMs(first),
    endMs: dayStartMs(nextFirst),
  };
}

export function previousMonth(month) {
  return monthKey(dayStartMs(`${month}-01`) - MS_PER_DAY);
}
