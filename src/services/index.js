import { createAttendanceService } from './attendance.js';
import { createAuditService } from './audit.js';
import { createDisputeService } from './disputes.js';
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
  const audit = createAuditService({ store, clock });
  const attendance = createAttendanceService({ store, clock, credentials, audit, skipButtonGeofence: env.demoMode });
  const payroll = createPayrollService({ store, clock });
  return {
    credentials,
    passport,
    feedback,
    audit,
    attendance,
    payroll,
    disputes: createDisputeService({ store, clock, audit, attendance, payroll }),
    grievance: createGrievanceService({ store, clock, secret: env.sessionSecret }),
    insights: createInsightsService({ store, clock, passport, feedback, payroll, env, fetchImpl }),
  };
}
