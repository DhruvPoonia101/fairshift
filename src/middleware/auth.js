import { createHash, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { ADMIN_ROLE, OFFLINE, WORKER_ROLE } from '../config/constants.js';
import { forbidden, unauthorized } from '../lib/errors.js';

export const SESSION_COOKIES = Object.freeze({ [WORKER_ROLE]: 'fs_worker', [ADMIN_ROLE]: 'fs_admin' });
const APP_HEADER = 'x-fairshift-app';
const SESSION_HOURS = 8;
const ALGORITHM = 'HS256';

/** Constant-time string comparison (hashing first makes the lengths equal). */
export function safeCompare(a, b) {
  const digest = (s) => createHash('sha256').update(String(s)).digest();
  return timingSafeEqual(digest(a), digest(b));
}

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

/**
 * Session handling with signed JWTs in httpOnly, SameSite=Strict cookies (Secure in production).
 * A worker and an employer can be signed in at the same time in one browser (for example two tabs),
 * so each role has its own cookie. The browser names the role it is acting as in the
 * X-FairShift-App header; without it the role is guessed from the URL, then the other cookie is tried.
 * The token holds only { sub, role, org }.
 * @param {{ secret: string, isProduction: boolean }} options
 */
export function createSessions({ secret, isProduction }) {
  const cookieOptions = {
    httpOnly: true,
    sameSite: 'strict',
    secure: isProduction,
    path: '/',
    maxAge: SESSION_HOURS * 60 * 60 * 1000,
  };
  const ROLES = [WORKER_ROLE, ADMIN_ROLE];

  /** Roles to try, best guess first. An explicit header means "only this role". */
  function rolesToTry(req) {
    const explicit = req.get(APP_HEADER);
    if (ROLES.includes(explicit)) return [explicit];
    const guess = req.path.startsWith('/admin/') ? ADMIN_ROLE : WORKER_ROLE;
    return [guess, ...ROLES.filter((r) => r !== guess)];
  }

  function verify(token, role) {
    try {
      const claims = jwt.verify(token, secret, { algorithms: [ALGORITHM] });
      return claims.role === role ? { id: claims.sub, role, orgId: claims.org } : undefined;
    } catch {
      return undefined;
    }
  }

  return {
    start(res, { id, role, orgId }) {
      const token = jwt.sign({ role, org: orgId }, secret, {
        algorithm: ALGORITHM,
        subject: id,
        expiresIn: `${SESSION_HOURS}h`,
      });
      res.cookie(SESSION_COOKIES[role], token, cookieOptions);
    },

    /** Ends only the session of the role the request acts as; the other role stays signed in. */
    end(req, res) {
      const [role] = rolesToTry(req);
      res.clearCookie(SESSION_COOKIES[role], { ...cookieOptions, maxAge: undefined });
    },

    /** Sets req.user when a valid session cookie is present; never rejects by itself. */
    authenticate(req, res, next) {
      for (const role of rolesToTry(req)) {
        const token = readCookie(req, SESSION_COOKIES[role]);
        const user = token ? verify(token, role) : undefined;
        if (user) {
          req.user = user;
          break;
        }
      }
      next();
    },
  };
}

/** Requires a signed-in user with one of the given roles. */
export const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return next(unauthorized());
  if (!roles.includes(req.user.role)) return next(forbidden());
  return next();
};

export const requireWorker = requireRole(WORKER_ROLE);
export const requireAdmin = requireRole(ADMIN_ROLE);

const ANON_PURPOSE = 'anon_submit';

/**
 * Anonymous submissions (reports and feedback sent without a name) carry no sign-in at all, so the
 * request itself cannot point at a person. They carry this token instead: it says only "a worker of this
 * organisation" (claims: purpose, org). It has no subject, and it is issued with a time rounded down to the
 * hour, so every worker of an organisation gets the same token within the same hour. Whoever holds it can
 * file anonymous items for that one organisation, which is exactly what any of its workers could already do.
 * @param {{ secret: string, clock: { now: () => number } }} options
 */
export function createAnonTokens({ secret, clock }) {
  const nowSeconds = () => Math.floor(clock.now() / 1000);
  return {
    issue(orgId) {
      const iat = nowSeconds() - (nowSeconds() % OFFLINE.ANON_TOKEN_BUCKET_SECONDS);
      const exp = iat + OFFLINE.ANON_TOKEN_TTL_SECONDS;
      return { token: jwt.sign({ purpose: ANON_PURPOSE, org: orgId, iat, exp }, secret, { algorithm: ALGORITHM }), expiresAt: exp * 1000 };
    },

    /** Sets req.anon = { orgId } from `Authorization: Bearer <token>`, or answers 401. Cookies are ignored. */
    require(req, res, next) {
      const match = /^Bearer ([\w-]+\.[\w-]+\.[\w-]+)$/.exec(req.get('authorization') ?? '');
      if (!match) return next(unauthorized());
      try {
        const claims = jwt.verify(match[1], secret, { algorithms: [ALGORITHM], clockTimestamp: nowSeconds() });
        if (claims.purpose !== ANON_PURPOSE || typeof claims.org !== 'string') return next(unauthorized());
        req.anon = { orgId: claims.org };
        return next();
      } catch {
        return next(unauthorized());
      }
    },
  };
}
