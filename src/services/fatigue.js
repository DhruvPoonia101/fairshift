import { FATIGUE, MINUTES_PER_HOUR, MS_PER_MINUTE, STALE_SHIFT_MINUTES } from '../config/constants.js';
import { addDays, dayKey, dayRange, dayStartMs, minuteOfDay } from '../lib/time.js';

/** Callers should load at least this many days of shifts (7-day window plus a streak check). */
export const FATIGUE_LOOKBACK_DAYS = 10;

export const FATIGUE_RULES = Object.freeze({
  LONG_DAY: 'long_day',
  WEEK_HOURS: 'week_hours',
  SHORT_REST: 'short_rest',
  NO_REST_DAY: 'no_rest_day',
  NIGHT_STREAK: 'night_streak',
  SHORT_REST_AFTER_NIGHT: 'short_rest_after_night',
});

/**
 * Default thresholds. A sector can override any of them in `sector.fatigue`, and can switch on the
 * night-shift rules by giving a `night` block:
 *   night: { startMinute, endMinute, maxConsecutive, restAfterMinutes }
 * A shift that starts at or after `startMinute` or before `endMinute` (minutes after midnight IST)
 * is a night shift.
 */
export const DEFAULT_FATIGUE_RULES = Object.freeze({
  maxDayMinutes: FATIGUE.MAX_DAY_MINUTES,
  weekAmberMinutes: FATIGUE.WEEK_AMBER_MINUTES,
  weekRedMinutes: FATIGUE.WEEK_RED_MINUTES,
  minRestMinutes: FATIGUE.MIN_REST_MINUTES,
  maxConsecutiveDays: FATIGUE.MAX_CONSECUTIVE_DAYS,
  windowDays: FATIGUE.WINDOW_DAYS,
  recentDays: FATIGUE.RECENT_DAYS,
  night: null,
});

/** Defaults overlaid with a sector's overrides. */
export const resolveFatigueRules = (overrides = {}) => ({ ...DEFAULT_FATIGUE_RULES, ...overrides });

const toHours = (minutes) => minutes / MINUTES_PER_HOUR;
const minutesBetween = (start, end) => Math.max(0, Math.floor((end - start) / MS_PER_MINUTE));

function isNightStart(ms, night) {
  const minute = minuteOfDay(ms);
  return night.startMinute > night.endMinute
    ? minute >= night.startMinute || minute < night.endMinute
    : minute >= night.startMinute && minute < night.endMinute;
}

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

function longestRecentDay(perDay, today, rules) {
  const recent = dayRange(addDays(today, -(rules.recentDays - 1)), today);
  let worst = null;
  for (const date of recent) {
    const minutes = perDay.get(date) ?? 0;
    if (minutes > rules.maxDayMinutes && (!worst || minutes > worst.minutes)) {
      worst = { date, minutes };
    }
  }
  return worst;
}

function shortestRest(spans, windowStartMs, rules) {
  let shortest = null;
  for (let i = 1; i < spans.length; i += 1) {
    const rest = minutesBetween(spans[i - 1].end, spans[i].start);
    if (spans[i].start < windowStartMs) continue;
    if (rest < rules.minRestMinutes && (shortest === null || rest < shortest)) shortest = rest;
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

/** Length of the run of consecutive night shifts that ended most recently (within the recent days). */
function consecutiveNightShifts(spans, today, rules) {
  const nightDays = new Set(spans.filter((s) => isNightStart(s.start, rules.night)).map((s) => dayKey(s.start)));
  const recent = dayRange(addDays(today, -(rules.recentDays - 1)), today);
  let cursor = recent.findLast((day) => nightDays.has(day));
  let streak = 0;
  while (cursor && nightDays.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/** Shortest gap between a night shift and the next shift that is not a night shift. */
function shortestRestAfterNight(spans, windowStartMs, rules) {
  let shortest = null;
  for (let i = 1; i < spans.length; i += 1) {
    const [prev, next] = [spans[i - 1], spans[i]];
    if (next.start < windowStartMs || !isNightStart(prev.start, rules.night) || isNightStart(next.start, rules.night)) {
      continue;
    }
    const rest = minutesBetween(prev.end, next.start);
    if (rest < rules.night.restAfterMinutes && (shortest === null || rest < shortest)) shortest = rest;
  }
  return shortest;
}

/**
 * Explainable fatigue rules. Each flag names the rule that fired and the number behind it.
 * Defaults (all overridable per sector, see DEFAULT_FATIGUE_RULES):
 *  - long_day: more than 10 h on any of the last 3 days (amber)
 *  - week_hours: more than 48 h in the last 7 days (amber) or 60 h (red)
 *  - short_rest: under 11 h between two shifts this week (amber)
 *  - no_rest_day: 7 or more consecutive days worked (amber)
 * Only when the sector defines `night`:
 *  - night_streak: more than `maxConsecutive` night shifts in a row (amber)
 *  - short_rest_after_night: less than `restAfterMinutes` between a night shift and a non-night shift (amber)
 * @param {Array<{checkIn: number, checkOut: number | null}>} shifts
 * @param {number} nowMs
 * @param {typeof DEFAULT_FATIGUE_RULES} [rules]
 * @returns {Array<{rule: string, level: 'amber' | 'red', params: object}>}
 */
export function evaluateFatigue(shifts, nowMs, rules = DEFAULT_FATIGUE_RULES) {
  const spans = toSpans(shifts, nowMs);
  const perDay = minutesPerDay(spans);
  const today = dayKey(nowMs);
  const windowStart = addDays(today, -(rules.windowDays - 1));
  const windowStartMs = dayStartMs(windowStart);
  const flags = [];

  const longDay = longestRecentDay(perDay, today, rules);
  if (longDay) {
    flags.push({ rule: FATIGUE_RULES.LONG_DAY, level: 'amber', params: { ...longDay, limitHours: toHours(rules.maxDayMinutes) } });
  }

  const weekMinutes = dayRange(windowStart, today).reduce((sum, d) => sum + (perDay.get(d) ?? 0), 0);
  if (weekMinutes > rules.weekAmberMinutes) {
    flags.push({
      rule: FATIGUE_RULES.WEEK_HOURS,
      level: weekMinutes > rules.weekRedMinutes ? 'red' : 'amber',
      params: { minutes: weekMinutes, limitHours: toHours(rules.weekAmberMinutes) },
    });
  }

  const rest = shortestRest(spans, windowStartMs, rules);
  if (rest !== null) {
    flags.push({ rule: FATIGUE_RULES.SHORT_REST, level: 'amber', params: { minutes: rest, limitHours: toHours(rules.minRestMinutes) } });
  }

  const streak = consecutiveDaysWorked(perDay, today);
  if (streak >= rules.maxConsecutiveDays) {
    flags.push({ rule: FATIGUE_RULES.NO_REST_DAY, level: 'amber', params: { days: streak } });
  }

  if (rules.night) {
    const nights = consecutiveNightShifts(spans, today, rules);
    if (nights > rules.night.maxConsecutive) {
      flags.push({ rule: FATIGUE_RULES.NIGHT_STREAK, level: 'amber', params: { days: nights, limit: rules.night.maxConsecutive } });
    }
    const restAfterNight = shortestRestAfterNight(spans, windowStartMs, rules);
    if (restAfterNight !== null) {
      flags.push({ rule: FATIGUE_RULES.SHORT_REST_AFTER_NIGHT, level: 'amber', params: { minutes: restAfterNight, limitHours: toHours(rules.night.restAfterMinutes) } });
    }
  }
  return flags;
}

/** 'red' if any flag is red, 'amber' if any flag, otherwise 'none'. */
export function fatigueLevel(flags) {
  if (flags.some((f) => f.level === 'red')) return 'red';
  return flags.length > 0 ? 'amber' : 'none';
}
