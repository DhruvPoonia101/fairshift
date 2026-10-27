import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { loadEnv } from './config/env.js';
import { systemClock } from './lib/time.js';
import { createSessions } from './middleware/auth.js';
import { apiNotFound, errorHandler } from './middleware/errors.js';
import {
  DEFAULT_LIMITS,
  createLimiter,
  permissionsPolicy,
  requireJsonBody,
  sameOriginWrites,
  securityHeaders,
} from './middleware/security.js';
import { authRoutes } from './routes/auth.js';
import { attendanceRoutes } from './routes/attendance.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { feedbackRoutes } from './routes/feedback.js';
import { grievanceRoutes } from './routes/grievances.js';
import { passportRoutes } from './routes/passport.js';
import { payslipRoutes } from './routes/payslips.js';
import { createServices } from './services/index.js';
import { assertRepository } from './store/repository.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const JSON_BODY_LIMIT = '10kb';
const STATIC_MAX_AGE = '1h';

/**
 * Express app factory. Everything stateful (store, clock) is injected, so tests can run the real
 * app on an ephemeral port with a fixed clock, and Cloud Run instances stay stateless.
 * @param {object} options
 * @param {object} options.store a repository (see src/store/repository.js)
 * @param {ReturnType<typeof loadEnv>} [options.env]
 * @param {{ now: () => number }} [options.clock]
 * @param {{ global: number, login: number, report: number }} [options.limits]
 * @param {typeof fetch} [options.fetchImpl] for the optional Gemini call
 * @param {(message: string) => void} [options.logError]
 */
export function createApp({
  store,
  env = loadEnv(),
  clock = systemClock,
  limits = DEFAULT_LIMITS,
  fetchImpl,
  logError,
}) {
  assertRepository(store);
  const services = createServices({ store, clock, env, fetchImpl });
  const sessions = createSessions({ secret: env.sessionSecret, isProduction: env.isProduction });
  const limiters = {
    global: createLimiter(limits.global),
    login: createLimiter(limits.login, { countFailuresOnly: true }),
    report: createLimiter(limits.report),
  };

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // Cloud Run puts one proxy hop in front of the container.

  // Health check first: no rate limit, no cookies, nothing that can fail.
  app.get('/healthz', (req, res) => res.json({ status: 'ok' }));

  app.use(securityHeaders(), permissionsPolicy);

  // Only API calls are rate limited: a page load fetches ~20 static modules and must not use up the budget.
  const api = express.Router();
  api.use(limiters.global);
  api.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  api.use(sameOriginWrites, requireJsonBody, express.json({ limit: JSON_BODY_LIMIT }), sessions.authenticate);
  const deps = { store, services, sessions, env, limiters };
  api.use(authRoutes(deps));
  api.use(attendanceRoutes(deps));
  api.use(payslipRoutes(deps));
  api.use(grievanceRoutes(deps));
  api.use(feedbackRoutes(deps));
  api.use(passportRoutes(deps));
  api.use(dashboardRoutes(deps));
  api.use(apiNotFound);
  app.use('/api', api);

  app.get('/p/:token', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'passport', 'index.html')));
  app.use(express.static(PUBLIC_DIR, { maxAge: STATIC_MAX_AGE }));
  app.use((req, res) => res.status(404).type('text/plain').send('Not found'));
  app.use(errorHandler(logError));
  return app;
}
