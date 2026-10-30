/** Named constants shared by services. Money is always integer paise; time is epoch ms. */

export const MS_PER_MINUTE = 60_000;
export const MINUTES_PER_HOUR = 60;
export const MINUTES_PER_DAY = 1440;
export const MS_PER_DAY = MINUTES_PER_DAY * MS_PER_MINUTE;

/** India Standard Time is UTC+05:30 with no daylight saving. */
export const IST_OFFSET_MINUTES = 330;

export const REGULAR_SHIFT_MINUTES = 8 * MINUTES_PER_HOUR;
/** An open shift older than this is assumed forgotten and is closed automatically. */
export const STALE_SHIFT_MINUTES = 18 * MINUTES_PER_HOUR;

export const WORKER_ROLE = 'worker';
export const ADMIN_ROLE = 'admin';

export const PAYROLL = Object.freeze({
  /** Overtime multiplier in percent. Factories Act 1948 s.59 prescribes double the ordinary rate. */
  DEFAULT_OVERTIME_MULTIPLIER_PCT: 200,
  /** Employee PF share: 12% of ordinary (non-overtime) wages, in basis points. */
  PF_RATE_BP: 1200,
  /** Employee ESI share: 0.75% of gross wages, in basis points. */
  ESI_RATE_BP: 75,
  /** ESI applies only while monthly gross is at or below Rs 21,000. */
  ESI_GROSS_CEILING_PAISE: 2_100_000,
  BASIS_POINTS: 10_000,
  PERCENT: 100,
});

export const FATIGUE = Object.freeze({
  MAX_DAY_MINUTES: 10 * MINUTES_PER_HOUR,
  WEEK_AMBER_MINUTES: 48 * MINUTES_PER_HOUR,
  WEEK_RED_MINUTES: 60 * MINUTES_PER_HOUR,
  MIN_REST_MINUTES: 11 * MINUTES_PER_HOUR,
  MAX_CONSECUTIVE_DAYS: 7,
  WINDOW_DAYS: 7,
  RECENT_DAYS: 3,
});

export const ATTRITION = Object.freeze({
  RECENT_WINDOW_DAYS: 14,
  ABSENCE_DROP_DAYS: 3,
  LATE_GRACE_MINUTES: 15,
  LATE_MIN_COUNT: 3,
  NEW_JOINER_DAYS: 90,
  DISPUTE_LOOKBACK_DAYS: 60,
  AT_RISK_MIN_SCORE: 40,
  HIGH_MIN_SCORE: 60,
  MAX_SCORE: 100,
  POINTS: Object.freeze({
    absenteeism: 25,
    fatiguePerFlag: 10,
    fatigueCap: 20,
    late: 15,
    grievancePerItem: 15,
    grievanceCap: 30,
    payslipDispute: 15,
    newJoiner: 10,
  }),
});

/** Feedback buckets with fewer responses than this are never shown (k-anonymity). */
export const K_ANONYMITY_MIN = 3;
export const FEEDBACK_WINDOW_DAYS = 90;
export const FEEDBACK_SUBJECTS = Object.freeze(['manager', 'policies', 'conditions']);
export const RATING_MIN = 1;
export const RATING_MAX = 5;

export const GRIEVANCE_STATUSES = Object.freeze(['open', 'in_review', 'resolved']);
export const SEVERITIES = Object.freeze(['low', 'medium', 'high']);
export const TRACKING_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const TRACKING_CODE_LENGTH = 10;

export const PASSPORT_TYPES = Object.freeze(['training', 'certification', 'experience']);
export const PASSPORT_EXPIRY_WARNING_DAYS = 30;

export const CHECK_IN_METHODS = Object.freeze(['qr', 'code', 'button']);
export const CHECK_IN_CODE_DIGITS = 6;
