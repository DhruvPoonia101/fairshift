import { FATIGUE, MS_PER_MINUTE, STALE_SHIFT_MINUTES } from '../config/constants.js';
import { addDays, dayKey, dayRange, dayStartMs } from '../lib/time.js';

/** Callers should load at least this many days of shifts (7-day window plus a streak check). */
export const FATIGUE_LOOKBACK_DAYS = 10;

export const FATIGUE_RULES = Object.freeze({
  LONG_DAY: 'long_day',
  WEEK_HOURS: 'week_hours',
  SHORT_REST: 'short_rest',
  NO_REST_DAY: 'no_rest_day',
});

const minutesBetween = (start, end) => Math.max(0, Math.floor((end - start) / MS_PER_MINUTE));

/** Finished shifts, plus a shift still in progress (unless it looks forgotten), as time spans. */
function toSpans(shifts, nowMs) {
  return shifts
    .filter((s) => s.checkOut !== null || nowMs - s.checkIn < STALE_SHIFT_MINUTES * MS_PER_MINUTE)
    .map((s) => ({ start: s.checkIn, end: s.checkOut ?? nowMs }))
    .sort((a, b) => a.start - b.start);
}

function minutesPerDay(spans) {
  const perDay = new Map();
  for (const span of spans) {
    const key = dayKey(span.start);
    perDay.set(key, (perDay.get(key) ?? 0) + minutesBetween(span.start, span.end));
  }
  return perDay;
}

function longestRecentDay(perDay, today) {
  const recent = dayRange(addDays(today, -(FATIGUE.RECENT_DAYS - 1)), today);
  let worst = null;
  for (const date of recent) {
    const minutes = perDay.get(date) ?? 0;
    if (minutes > FATIGUE.MAX_DAY_MINUTES && (!worst || minutes > worst.minutes)) {
      worst = { date, minutes };
    }
  }
  return worst;
}

function shortestRest(spans, windowStartMs) {
  let shortest = null;
  for (let i = 1; i < spans.length; i += 1) {
    const rest = minutesBetween(spans[i - 1].end, spans[i].start);
    if (spans[i].start < windowStartMs) continue;
    if (rest < FATIGUE.MIN_REST_MINUTES && (shortest === null || rest < shortest)) shortest = rest;
  }
  return shortest;
}

function consecutiveDaysWorked(perDay, today) {
  let cursor = (perDay.get(today) ?? 0) > 0 ? today : addDays(today, -1);
  let streak = 0;
  while ((perDay.get(cursor) ?? 0) > 0) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/**
 * Explainable fatigue rules. Each flag names the rule that fired and the number behind it.
 *  - long_day: more than 10 h on any of the last 3 days (amber)
 *  - week_hours: more than 48 h in the last 7 days (amber) or 60 h (red)
 *  - short_rest: under 11 h between two shifts this week (amber)
 *  - no_rest_day: 7 or more consecutive days worked (amber)
 * @param {Array<{checkIn: number, checkOut: number | null}>} shifts
 * @param {number} nowMs
 * @returns {Array<{rule: string, level: 'amber' | 'red', params: object}>}
 */
export function evaluateFatigue(shifts, nowMs) {
  const spans = toSpans(shifts, nowMs);
  const perDay = minutesPerDay(spans);
  const today = dayKey(nowMs);
  const windowStart = addDays(today, -(FATIGUE.WINDOW_DAYS - 1));
  const flags = [];

  const longDay = longestRecentDay(perDay, today);
  if (longDay) flags.push({ rule: FATIGUE_RULES.LONG_DAY, level: 'amber', params: longDay });

  const weekMinutes = dayRange(windowStart, today).reduce((sum, d) => sum + (perDay.get(d) ?? 0), 0);
  if (weekMinutes > FATIGUE.WEEK_AMBER_MINUTES) {
    flags.push({
      rule: FATIGUE_RULES.WEEK_HOURS,
      level: weekMinutes > FATIGUE.WEEK_RED_MINUTES ? 'red' : 'amber',
      params: { minutes: weekMinutes },
    });
  }

  const rest = shortestRest(spans, dayStartMs(windowStart));
  if (rest !== null) flags.push({ rule: FATIGUE_RULES.SHORT_REST, level: 'amber', params: { minutes: rest } });

  const streak = consecutiveDaysWorked(perDay, today);
  if (streak >= FATIGUE.MAX_CONSECUTIVE_DAYS) {
    flags.push({ rule: FATIGUE_RULES.NO_REST_DAY, level: 'amber', params: { days: streak } });
  }
  return flags;
}

/** 'red' if any flag is red, 'amber' if any flag, otherwise 'none'. */
export function fatigueLevel(flags) {
  if (flags.some((f) => f.level === 'red')) return 'red';
  return flags.length > 0 ? 'amber' : 'none';
}
