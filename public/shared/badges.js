import { chip } from './dom.js';
import { t } from './i18n.js';

const STATUS = { open: ['warn', 'alert'], in_review: ['info', 'clock'], resolved: ['ok', 'check'] };
const SEVERITY = { low: ['info', 'info'], medium: ['warn', 'alert'], high: ['danger', 'flame'] };
const EXPIRY = { valid: ['ok', 'check'], expiring: ['warn', 'clock'], expired: ['danger', 'alert'], none: ['info', 'check'] };

/** Every badge pairs an icon with a word, so colour is never the only signal. */
export const statusChip = (status) => chip(STATUS[status][0], STATUS[status][1], t(`status.${status}`));
export const severityChip = (severity) => chip(SEVERITY[severity][0], SEVERITY[severity][1], t(`severity.${severity}`));
export const expiryChip = (expiry) => chip(EXPIRY[expiry][0], EXPIRY[expiry][1], t(`expiry.${expiry}`));
export const verifiedChip = (verified) =>
  verified ? chip('ok', 'shield', t('passport.verified')) : chip('info', 'user', t('passport.selfDeclared'));
