import { COMPLIANCE, MINUTES_PER_HOUR, PAYROLL, REGULAR_SHIFT_MINUTES } from '../config/constants.js';

/**
 * Wage and overtime compliance: compares what was actually paid for a month with what the rules
 * say should have been paid. Everything is integer paise. The rules are per-sector config
 * (`wageRules` in src/config/sectors.js): configurable defaults, to be verified against the
 * current state notifications; they are not a legal opinion.
 */

export const COMPLIANCE_STATUS = Object.freeze({ OK: 'ok', UNDERPAID: 'underpaid', REVIEW: 'review' });

const REGULAR_SHIFT_HOURS = REGULAR_SHIFT_MINUTES / MINUTES_PER_HOUR;
const round2 = (n) => Math.round(n * 100) / 100;

/** "Rs 1,200" style text for the English reason sentences (the client formats its own in the user's language). */
export function formatRupees(paise) {
  const whole = paise % 100 === 0;
  const text = (paise / 100).toLocaleString('en-IN', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  });
  return `₹${text}`;
}

/**
 * What the worker should have been paid for the month under the rules: at least the minimum
 * daily wage for regular time, and at least the overtime multiplier for every hour beyond 8 in a shift.
 * @param {{ dailyWagePaise: number, totals: { regularMinutes: number, overtimeMinutes: number } }} slip
 * @param {{ minDailyWagePaise?: number | null, minHourlyWagePaise?: number | null, overtimeMultiplierPct: number }} rules
 */
export function expectedPay(slip, rules) {
  const minimumDaily = Math.max(
    rules.minDailyWagePaise ?? 0,
    (rules.minHourlyWagePaise ?? 0) * REGULAR_SHIFT_HOURS,
  );
  const dailyWagePaise = Math.max(slip.dailyWagePaise, minimumDaily);
  const hourlyRatePaise = Math.round(dailyWagePaise / REGULAR_SHIFT_HOURS);
  const regularPaise = Math.round((dailyWagePaise * slip.totals.regularMinutes) / REGULAR_SHIFT_MINUTES);
  const overtimePaise = Math.round(
    (hourlyRatePaise * slip.totals.overtimeMinutes * rules.overtimeMultiplierPct) /
      (MINUTES_PER_HOUR * PAYROLL.PERCENT),
  );
  return { dailyWagePaise, minimumDaily, hourlyRatePaise, regularPaise, overtimePaise };
}

const REASON_TEXT = {
  below_minimum_wage: (p) =>
    `The daily wage of ${formatRupees(p.dailyWagePaise)} is below the minimum of ${formatRupees(p.minDailyWagePaise)}.`,
  overtime_unpaid: (p) => `${p.hours} overtime ${p.hours === 1 ? 'hour was' : 'hours were'} not paid.`,
  overtime_normal_rate: (p) =>
    `${p.hours} overtime ${p.hours === 1 ? 'hour was' : 'hours were'} paid at the normal rate.`,
  overtime_low_rate: (p) =>
    `${p.hours} overtime ${p.hours === 1 ? 'hour was' : 'hours were'} paid at ${p.paidRatePct}% of the normal rate instead of ${p.requiredRatePct}%.`,
  regular_short: (p) => `Regular pay is ${formatRupees(p.shortPaise)} short for the days worked.`,
  month_in_progress: () => 'This month is not finished yet, so the pay cannot be checked.',
  open_shift: () => 'A shift is still open, so the pay cannot be checked yet.',
  no_payment_record: () => 'No payment has been recorded for this month, so it cannot be checked.',
};

export const COMPLIANCE_REASON_KEYS = Object.freeze(Object.keys(REASON_TEXT));

const reason = (key, params = {}) => ({ key, params, text: REASON_TEXT[key](params) });

function overtimeReason({ slip, expected, paidOvertime, rules }) {
  const hours = round2(slip.totals.overtimeMinutes / MINUTES_PER_HOUR);
  if (paidOvertime <= COMPLIANCE.ROUNDING_TOLERANCE_PAISE) return reason('overtime_unpaid', { hours });
  const normalRatePaise = Math.round((expected.hourlyRatePaise * slip.totals.overtimeMinutes) / MINUTES_PER_HOUR);
  if (Math.abs(paidOvertime - normalRatePaise) <= COMPLIANCE.ROUNDING_TOLERANCE_PAISE) {
    return reason('overtime_normal_rate', { hours });
  }
  return reason('overtime_low_rate', {
    hours,
    paidRatePct: Math.round((paidOvertime * PAYROLL.PERCENT) / normalRatePaise),
    requiredRatePct: rules.overtimeMultiplierPct,
  });
}

/**
 * @param {object} input
 * @param {object} input.slip result of computePayslip for the month
 * @param {object} input.rules the sector's wageRules
 * @param {{ paidRegularPaise: number, paidOvertimePaise: number } | null} input.payment what was actually paid
 * @param {boolean} input.isOpenMonth the month is still running
 * @param {boolean} input.pendingShift a shift in the month is still open
 * @returns {{
 *   status: 'ok' | 'underpaid' | 'review', expectedPaise: number, paidPaise: number | null,
 *   shortfallPaise: number, reasons: Array<{key: string, params: object, text: string}>, note: string
 * }}
 */
export function checkCompliance({ slip, rules, payment, isOpenMonth, pendingShift }) {
  const expected = expectedPay(slip, rules);
  const expectedPaise = expected.regularPaise + expected.overtimePaise;
  const base = { expectedPaise, paidPaise: null, shortfallPaise: 0, note: rules.note };

  const cannotCheck = (key) => ({ ...base, status: COMPLIANCE_STATUS.REVIEW, reasons: [reason(key)] });
  if (isOpenMonth) return cannotCheck('month_in_progress');
  if (pendingShift) return cannotCheck('open_shift');
  if (!payment) return cannotCheck('no_payment_record');

  const paidPaise = payment.paidRegularPaise + payment.paidOvertimePaise;
  const regularShort = Math.max(0, expected.regularPaise - payment.paidRegularPaise);
  const overtimeShort = Math.max(0, expected.overtimePaise - payment.paidOvertimePaise);
  const shortfallPaise = regularShort + overtimeShort;
  if (shortfallPaise <= COMPLIANCE.ROUNDING_TOLERANCE_PAISE) {
    return { ...base, status: COMPLIANCE_STATUS.OK, paidPaise, shortfallPaise: 0, reasons: [] };
  }

  const reasons = [];
  if (slip.dailyWagePaise < expected.dailyWagePaise) {
    reasons.push(reason('below_minimum_wage', { dailyWagePaise: slip.dailyWagePaise, minDailyWagePaise: expected.dailyWagePaise }));
  }
  if (overtimeShort > 0) {
    reasons.push(overtimeReason({ slip, expected, paidOvertime: payment.paidOvertimePaise, rules }));
  }
  if (regularShort > COMPLIANCE.ROUNDING_TOLERANCE_PAISE) {
    reasons.push(reason('regular_short', { shortPaise: regularShort }));
  }
  return { ...base, status: COMPLIANCE_STATUS.UNDERPAID, paidPaise, shortfallPaise, reasons };
}
