import { createAttendanceService } from './attendance.js';
import { createFeedbackService } from './feedback.js';
import { createGrievanceService } from './grievance.js';
import { createInsightsService } from './insights.js';
import { createPassportService } from './passport.js';
import { createPayrollService } from './payroll.js';
import { createSiteCredentials } from './qr.js';

/**
 * Wires every service to the store and clock. Services never touch Express or the environment directly.
 * @param {{ store: object, clock: { now: () => number }, env: object, fetchImpl?: typeof fetch }} deps
 */
export function createServices({ store, clock, env, fetchImpl }) {
  const credentials = createSiteCredentials({ secret: env.sessionSecret, clock });
  const passport = createPassportService({ store, clock });
  const feedback = createFeedbackService({ store, clock });
  return {
    credentials,
    passport,
    feedback,
    attendance: createAttendanceService({ store, clock, credentials, skipButtonGeofence: env.demoMode }),
    payroll: createPayrollService({ store }),
    grievance: createGrievanceService({ store, clock, secret: env.sessionSecret }),
    insights: createInsightsService({ store, clock, passport, feedback, env, fetchImpl }),
  };
}
