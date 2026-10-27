import { ATTRITION, MS_PER_DAY } from '../config/constants.js';
import { addDays, dayKey, daysBetween, minuteOfDay } from '../lib/time.js';

const { POINTS } = ATTRITION;

/**
 * Explainable attrition-risk score (0-100). Every point comes from a named reason that the
 * employer can read; it is meant to prompt a supportive check-in, never a penalty.
 * Anonymous grievances and feedback are never inputs.
 * @param {object} s signals
 * @param {number} s.recentDays days attended in the last 14 complete days
 * @param {number} s.priorDays days attended in the 14 days before that
 * @param {number} s.lateCount late check-ins in the last 14 complete days
 * @param {number} s.fatigueFlagCount
 * @param {number} s.openNamedGrievances unresolved grievances the worker filed under their name
 * @param {number} s.payslipDisputes "something looks wrong" reports on a payslip, last 60 days
 * @param {number} s.tenureDays
 */
export function scoreAttrition(s) {
  const reasons = [];
  const add = (key, points, params) => reasons.push({ key, points, params });

  if (s.priorDays - s.recentDays >= ATTRITION.ABSENCE_DROP_DAYS) {
    add('absenteeism', POINTS.absenteeism, { recent: s.recentDays, prior: s.priorDays });
  }
  if (s.fatigueFlagCount > 0) {
    add('fatigue', Math.min(POINTS.fatigueCap, s.fatigueFlagCount * POINTS.fatiguePerFlag), {
      count: s.fatigueFlagCount,
    });
  }
  if (s.lateCount >= ATTRITION.LATE_MIN_COUNT) add('late', POINTS.late, { count: s.lateCount });
  if (s.openNamedGrievances > 0) {
    add('grievance', Math.min(POINTS.grievanceCap, s.openNamedGrievances * POINTS.grievancePerItem), {
      count: s.openNamedGrievances,
    });
  }
  if (s.payslipDisputes > 0) add('dispute', POINTS.payslipDispute, { count: s.payslipDisputes });
  if (s.tenureDays < ATTRITION.NEW_JOINER_DAYS) add('new_joiner', POINTS.newJoiner, { days: s.tenureDays });

  const score = Math.min(ATTRITION.MAX_SCORE, reasons.reduce((sum, r) => sum + r.points, 0));
  let band = 'low';
  if (score >= ATTRITION.HIGH_MIN_SCORE) band = 'high';
  else if (score >= ATTRITION.AT_RISK_MIN_SCORE) band = 'medium';
  return { score, band, atRisk: score >= ATTRITION.AT_RISK_MIN_SCORE, reasons };
}

function countDaysIn(attendedDays, from, to) {
  let count = 0;
  for (const day of attendedDays) if (day >= from && day <= to) count += 1;
  return count;
}

/**
 * Turns raw records into the signals `scoreAttrition` needs.
 * @param {object} input
 * @param {{id: string, joinedOn: string}} input.worker
 * @param {Array<{checkIn: number}>} input.shifts the worker's last 28+ days of shifts
 * @param {number} input.fatigueFlagCount
 * @param {Array<object>} input.grievances all org grievances (anonymous ones are ignored)
 * @param {number | undefined} input.shiftStartMinute the worker's usual start, minutes after midnight IST
 * @param {number} input.nowMs
 */
export function deriveSignals({ worker, shifts, fatigueFlagCount, grievances, shiftStartMinute, nowMs }) {
  const today = dayKey(nowMs);
  const recentEnd = addDays(today, -1);
  const recentStart = addDays(recentEnd, -(ATTRITION.RECENT_WINDOW_DAYS - 1));
  const priorEnd = addDays(recentStart, -1);
  const priorStart = addDays(priorEnd, -(ATTRITION.RECENT_WINDOW_DAYS - 1));

  const attended = new Set(shifts.map((s) => dayKey(s.checkIn)));
  const lateCount =
    shiftStartMinute === undefined
      ? 0
      : shifts.filter((s) => {
          const day = dayKey(s.checkIn);
          return (
            day >= recentStart &&
            day <= recentEnd &&
            minuteOfDay(s.checkIn) > shiftStartMinute + ATTRITION.LATE_GRACE_MINUTES
          );
        }).length;

  const own = grievances.filter((g) => !g.anonymous && g.workerId === worker.id);
  const disputeSince = nowMs - ATTRITION.DISPUTE_LOOKBACK_DAYS * MS_PER_DAY;
  return {
    recentDays: countDaysIn(attended, recentStart, recentEnd),
    priorDays: countDaysIn(attended, priorStart, priorEnd),
    lateCount,
    fatigueFlagCount,
    openNamedGrievances: own.filter((g) => g.source !== 'payslip' && g.status !== 'resolved').length,
    payslipDisputes: own.filter((g) => g.source === 'payslip' && g.createdAt >= disputeSince).length,
    tenureDays: daysBetween(worker.joinedOn, today),
  };
}
