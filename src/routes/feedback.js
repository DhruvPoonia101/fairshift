import { Router } from 'express';
import { FEEDBACK_SUBJECTS, RATING_MAX, RATING_MIN } from '../config/constants.js';
import { resolveCapture } from '../lib/capture.js';
import { requireAdmin, requireWorker } from '../middleware/auth.js';
import { respondIdempotent } from '../middleware/offline.js';
import { v, validateBody } from '../middleware/validate.js';

const MAX_COMMENT_LENGTH = 300;
const MAX_EPOCH_MS = 4_102_444_800_000;

const feedbackSchema = {
  subject: v.enum(FEEDBACK_SUBJECTS),
  rating: v.int({ min: RATING_MIN, max: RATING_MAX }),
  text: v.string({ min: 0, max: MAX_COMMENT_LENGTH, optional: true }),
  capturedAt: v.int({ min: 0, max: MAX_EPOCH_MS, optional: true }),
};

/** @param {{ services: object, anonTokens: object, clock: object, limiters: { report: Function } }} deps */
export function feedbackRoutes({ services, anonTokens, clock, limiters }) {
  const router = Router();

  // Feedback is anonymous by design, so its Idempotency-Key lives in the shared "anon" scope: no worker id
  // is ever stored next to it. Only the org id is read from the session.
  async function give(req, res, orgId) {
    const { subject, rating, text = '' } = req.body;
    await respondIdempotent(req, res, { idempotency: services.idempotency, kind: 'feedback', scope: 'anon', orgId, body: req.body }, async ({ idFor }) => {
      // The time is checked (not in the future, not older than 48 hours) but only its day is kept.
      const { capturedAt } = resolveCapture(req.body.capturedAt, clock.now());
      await services.feedback.submit(orgId, { subject, rating, text }, { id: idFor('fb'), capturedAt });
      return { status: 201, body: { ok: true } };
    });
  }

  router.post('/feedback', requireWorker, limiters.report, validateBody(feedbackSchema), (req, res) => give(req, res, req.user.orgId));

  // The same, with no sign-in on the request at all: only the organisation-level token (see createAnonTokens).
  router.post('/anonymous/feedback', limiters.report, anonTokens.require, validateBody(feedbackSchema), (req, res) => give(req, res, req.anon.orgId));

  router.get('/admin/feedback', requireAdmin, async (req, res) => {
    res.json(await services.insights.feedbackReport(req.user.orgId));
  });

  return router;
}
