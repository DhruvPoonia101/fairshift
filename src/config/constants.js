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

export const COMPLIANCE = Object.freeze({
  /** A shortfall up to Rs 1 is treated as rounding, not underpayment. */
  ROUNDING_TOLERANCE_PAISE: 100,
});

/** Shown next to every wage rule: the numbers are defaults to be checked, not legal advice. */
export const WAGE_RULES_NOTE = 'Configurable defaults. Verify against current state notifications.';

export const DISPUTE = Object.freeze({
  /** Only records from the last N days can be contested (a sector may override this). */
  WINDOW_DAYS: 14,
  CATEGORIES: Object.freeze(['forgot_checkout', 'wrong_time', 'wrong_site', 'other']),
  OPEN_STATUSES: Object.freeze(['submitted', 'under_review']),
  /** A corrected shift can be at most as long as a shift that is treated as forgotten. */
  MAX_SHIFT_MINUTES: STALE_SHIFT_MINUTES,
  MAX_NOTE_LENGTH: 500,
  MIN_REJECT_NOTE_LENGTH: 3,
});

/** Decent Work Score settings. The weights can be overridden per sector (`decentWorkWeights`). */
export const DECENT_WORK = Object.freeze({
  WEIGHTS: Object.freeze({ pay: 30, rest: 25, grievances: 20, sentiment: 15, attendance: 10 }),
  BANDS: Object.freeze({ HEALTHY_MIN: 80, NEEDS_ATTENTION_MIN: 60 }),
  TREND_DAYS: 14,
  TOP_DRIVERS: 3,
  /** Rest component: points per worker by rest-warning level. */
  REST_POINTS: Object.freeze({ none: 100, amber: 50, red: 0 }),
  GRIEVANCE_WINDOW_DAYS: 90,
  /** Days within which a report of each severity should be answered. */
  GRIEVANCE_SLA_DAYS: Object.freeze({ high: 3, medium: 7, low: 14 }),
  SENTIMENT_WINDOW_DAYS: FEEDBACK_WINDOW_DAYS,
  ATTENDANCE_WINDOW_DAYS: 30,
  /** When this share of records is disputed, the dispute-rate part of attendance accuracy is 0. */
  DISPUTE_RATE_ZERO_AT: 0.1,
  DISPUTE_SLA_DAYS: 3,
});
