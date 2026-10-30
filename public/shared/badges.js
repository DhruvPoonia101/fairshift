import { chip } from './dom.js';
import { t } from './i18n.js';

const STATUS = { open: ['warn', 'alert'], in_review: ['info', 'clock'], resolved: ['ok', 'check'] };
const SEVERITY = { low: ['info', 'info'], medium: ['warn', 'alert'], high: ['danger', 'flame'] };
const EXPIRY = { valid: ['ok', 'check'], expiring: ['warn', 'clock'], expired: ['danger', 'alert'], none: ['info', 'check'] };

/** Every badge pairs an icon with a word, so colour is never the only signal. */
export const statusChip = (status) => chip(STATUS[status][0], STATUS[status][1], t(`status.${status}`));
export const severityChip = (severity) => chip(SEVERITY[severity][0], SEVERITY[severity][1], t(`severity.${severity}`));
export const expiryChip = (expiry) => chip(EXPIRY[expiry][0], EXPIRY[expiry][1], t(`expiry.${expiry}`));
const COMPLIANCE = { ok: ['ok', 'check'], underpaid: ['danger', 'alert'], review: ['info', 'clock'] };

/** Compact status for tables: icon + short word. */
export const complianceChip = (status) => chip(COMPLIANCE[status][0], COMPLIANCE[status][1], t(`complianceAdmin.status.${status}`));
const DISPUTE = { submitted: ['info', 'clock'], under_review: ['info', 'info'], approved: ['ok', 'check'], rejected: ['danger', 'alert'] };
export const disputeChip = (status) => chip(DISPUTE[status][0], DISPUTE[status][1], t(`dispute.status.${status}`));
export const verifiedChip = (verified) =>
  verified ? chip('ok', 'shield', t('passport.verified')) : chip('info', 'user', t('passport.selfDeclared'));
