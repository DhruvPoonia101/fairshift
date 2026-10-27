import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { AppError } from '../lib/errors.js';

const MINUTE_MS = 60_000;
const WINDOW_MS = 15 * MINUTE_MS;

/**
 * Default per-IP limits for each 15-minute window. Many judges or workers can share one IP behind a
 * NAT, so normal clicking around must never trip them; they exist to stop floods and password guessing.
 * Tests may override them.
 */
export const DEFAULT_LIMITS = Object.freeze({ global: 3000, login: 40, report: 300 });

export function securityHeaders() {
  return helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        mediaSrc: ["'self'"],
        manifestSrc: ["'self'"],
        workerSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'no-referrer' },
  });
}

/** Camera (QR scan), microphone (voice input) and location (geofence) only for our own origin. */
export function permissionsPolicy(req, res, next) {
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=(self)');
  next();
}

export function createLimiter(max, { countFailuresOnly = false } = {}) {
  return rateLimit({
    skipSuccessfulRequests: countFailuresOnly,
    windowMs: WINDOW_MS,
    limit: max,
    standardHeaders: 'draft-6',
    legacyHeaders: false,
    handler: (req, res, next) => next(new AppError(429, 'rate_limited', 'Too many requests. Please wait a moment.')),
  });
}

/**
 * Rejects cross-site writes: browsers send Origin on POST/PATCH/DELETE, and it must match our host.
 * SameSite=Strict cookies already block most of this; the check is defence in depth.
 */
export function sameOriginWrites(req, res, next) {
  const origin = req.get('origin');
  if (origin && req.method !== 'GET' && req.method !== 'HEAD') {
    let host = null;
    try {
      host = new URL(origin).host;
    } catch {
      host = null;
    }
    if (host !== req.get('host')) return next(new AppError(403, 'forbidden', 'Cross-site request blocked.'));
  }
  return next();
}

/** Writes must be JSON, which a plain cross-site HTML form cannot send. */
export function requireJsonBody(req, res, next) {
  const hasBody = Number(req.get('content-length') ?? 0) > 0;
  if (hasBody && !req.is('application/json')) {
    return next(new AppError(415, 'unsupported_media', 'Send JSON.'));
  }
  return next();
}
