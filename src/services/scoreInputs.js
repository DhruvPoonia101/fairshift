import { DECENT_WORK, MS_PER_DAY } from '../config/constants.js';
import { addDays, dayKey, dayStartMs, monthKey, previousMonth } from '../lib/time.js';
import { evaluateFatigue, fatigueLevel } from './fatigue.js';
import { summariseBucket } from './feedback.js';

/**
 * Turns raw records into the inputs of `computeDecentWorkScore` as they stood at a moment in time
 * ("as of"), so the same data gives a score for today and for each earlier day of the trend.
 * Status changes are replayed from their timestamps: a grievance or dispute counts as decided only
 * if it was decided by then.
 */

const days = (ms) => ms / MS_PER_DAY;

/** The end of an IST day (or `nowMs` for today). */
export const endOfDay = (day, nowMs) => Math.min(nowMs, dayStartMs(addDays(day, 1)) - 1);

/** Shifts as they looked at `asOfMs`: later ones are ignored and a shift not yet finished counts as open. */
function shiftsAsOf(shifts, asOfMs) {
  return shifts
    .filter((s) => s.checkIn <= asOfMs)
    .map((s) => (s.checkOut !== null && s.checkOut > asOfMs ? { ...s, checkOut: null } : s));
}

function restInput({ workers, shifts, fatigueRules }, asOfMs) {
  const visible = shiftsAsOf(shifts, asOfMs);
  let amber = 0;
  let red = 0;
  for (const worker of workers) {
    const level = fatigueLevel(evaluateFatigue(visible.filter((s) => s.workerId === worker.id), asOfMs, fatigueRules));
    if (level === 'red') red += 1;
    else if (level === 'amber') amber += 1;
  }
  return { workers: workers.length, amber, red };
}

/** Reports from the last 90 days: a breach is a report answered too late, or still open past its time limit. */
function grievanceInput({ grievances }, asOfMs) {
  const since = asOfMs - DECENT_WORK.GRIEVANCE_WINDOW_DAYS * MS_PER_DAY;
  let considered = 0;
  let breaches = 0;
  let overdueOpen = 0;
  for (const g of grievances) {
    if (g.createdAt > asOfMs || g.createdAt < since) continue;
    considered += 1;
    const limitDays = DECENT_WORK.GRIEVANCE_SLA_DAYS[g.severity];
    const resolved = g.status === 'resolved' && g.updatedAt <= asOfMs;
    if (resolved && days(g.updatedAt - g.createdAt) > limitDays) breaches += 1;
    if (!resolved && days(asOfMs - g.createdAt) > limitDays) {
      breaches += 1;
      overdueOpen += 1;
    }
  }
  return { considered, breaches, overdueOpen };
}

/** Feedback groups that may be shown (3 or more answers, last 90 days). Smaller groups never count. */
function sentimentInput({ feedback, subjects }, asOfMs) {
  const last = dayKey(asOfMs);
  const first = addDays(last, -(DECENT_WORK.SENTIMENT_WINDOW_DAYS - 1));
  const inWindow = feedback.filter((f) => f.day >= first && f.day <= last);
  const groups = subjects.map((subject) => summariseBucket(subject, inWindow.filter((f) => f.subject === subject)));
  return { buckets: groups.filter((g) => !g.suppressed).map((g) => ({ count: g.count, average: g.average })) };
}

function attendanceInput({ shifts, disputes }, asOfMs) {
  const since = asOfMs - DECENT_WORK.ATTENDANCE_WINDOW_DAYS * MS_PER_DAY;
  const records = shifts.filter((s) => s.checkIn >= since && s.checkIn <= asOfMs).length;
  let count = 0;
  let overdue = 0;
  for (const d of disputes) {
    if (d.createdAt > asOfMs || d.createdAt < since) continue;
    count += 1;
    const decided = d.decidedAt !== null && d.decidedAt <= asOfMs;
    const waited = days((decided ? d.decidedAt : asOfMs) - d.createdAt);
    if (waited > DECENT_WORK.DISPUTE_SLA_DAYS) overdue += 1;
  }
  return { records, disputes: count, overdue };
}

/** Pay accuracy uses the last finished month relative to `asOfMs`; `complianceByMonth` maps month -> summary. */
function payInput({ complianceByMonth }, asOfMs) {
  const summary = complianceByMonth.get(previousMonth(monthKey(asOfMs)));
  if (!summary) return null;
  return { checked: summary.ok + summary.underpaid, underpaid: summary.underpaid, shortfallPaise: summary.shortfallPaise };
}

/**
 * @param {{
 *   workers: object[], shifts: object[], grievances: object[], feedback: object[], disputes: object[],
 *   subjects: string[], fatigueRules: object, complianceByMonth: Map<string, object>
 * }} data
 * @param {number} asOfMs
 */
export function buildScoreInputs(data, asOfMs) {
  return {
    pay: payInput(data, asOfMs),
    rest: restInput(data, asOfMs),
    grievances: grievanceInput(data, asOfMs),
    sentiment: sentimentInput(data, asOfMs),
    attendance: attendanceInput(data, asOfMs),
  };
}

/** The months whose "previous month" the trend days need, so compliance is computed once per month. */
export function monthsNeeded(dayKeys, nowMs) {
  return [...new Set(dayKeys.map((d) => previousMonth(monthKey(endOfDay(d, nowMs)))))];
}
