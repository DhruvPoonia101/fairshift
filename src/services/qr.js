import { createHmac, timingSafeEqual } from 'node:crypto';
import QRCode from 'qrcode';
import { CHECK_IN_CODE_DIGITS } from '../config/constants.js';
import { dayKey } from '../lib/time.js';

const TOKEN_SIGNATURE_BYTES = 16;
const CODE_MODULUS = 10 ** CHECK_IN_CODE_DIGITS;
const QR_MARGIN_MODULES = 2;

function safeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/**
 * Daily rotating proof-of-presence for a site: a signed QR token and a short typed code.
 * Both are HMACs of (site, IST day), so they expire at midnight IST with no storage.
 * @param {{ secret: string, clock: { now: () => number } }} deps
 */
export function createSiteCredentials({ secret, clock }) {
  const mac = (label, site, day) =>
    createHmac('sha256', secret).update(`${label}|${site.orgId}|${site.id}|${day}`).digest();

  return {
    /** Token format: `<siteId>.<day>.<signature>`. */
    issueToken(site, atMs = clock.now()) {
      const day = dayKey(atMs);
      const sig = mac('qr', site, day).subarray(0, TOKEN_SIGNATURE_BYTES).toString('base64url');
      return `${site.id}.${day}.${sig}`;
    },

    /**
     * Returns the matching site from `sites`, or null if forged, expired or foreign. `atMs` is the moment
     * the QR was scanned: a check-in made without a signal is checked when it is sent, but against the day it was scanned.
     */
    verifyToken(token, sites, atMs = clock.now()) {
      if (typeof token !== 'string') return null;
      const [siteId, day, sig, ...extra] = token.split('.');
      if (!sig || extra.length > 0 || day !== dayKey(atMs)) return null;
      const site = sites.find((s) => s.id === siteId);
      if (!site) return null;
      const expected = mac('qr', site, day).subarray(0, TOKEN_SIGNATURE_BYTES).toString('base64url');
      return safeEqual(sig, expected) ? site : null;
    },

    /** Six-digit code for today, easy to read out or type on a basic phone. */
    dailyCode(site, atMs = clock.now()) {
      const n = mac('code', site, dayKey(atMs)).readUInt32BE(0) % CODE_MODULUS;
      return String(n).padStart(CHECK_IN_CODE_DIGITS, '0');
    },

    findSiteByCode(sites, code, atMs = clock.now()) {
      return sites.find((site) => safeEqual(String(code), this.dailyCode(site, atMs))) ?? null;
    },

    /** QR code as an SVG string (no external service involved). */
    renderSvg(token) {
      return QRCode.toString(token, {
        type: 'svg',
        errorCorrectionLevel: 'M',
        margin: QR_MARGIN_MODULES,
      });
    },
  };
}
