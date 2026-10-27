import { Router } from 'express';
import { FEEDBACK_SUBJECTS, RATING_MAX, RATING_MIN } from '../config/constants.js';
import { requireAdmin, requireWorker } from '../middleware/auth.js';
import { v, validateBody } from '../middleware/validate.js';

const MAX_COMMENT_LENGTH = 300;

const feedbackSchema = {
  subject: v.enum(FEEDBACK_SUBJECTS),
  rating: v.int({ min: RATING_MIN, max: RATING_MAX }),
  text: v.string({ min: 0, max: MAX_COMMENT_LENGTH, optional: true }),
};

/** @param {{ services: object, limiters: { report: Function } }} deps */
export function feedbackRoutes({ services, limiters }) {
  const router = Router();

  // Only the org id is read from the session: the worker's id is deliberately never passed on.
  router.post('/feedback', requireWorker, limiters.report, validateBody(feedbackSchema), async (req, res) => {
    const { subject, rating, text = '' } = req.body;
    await services.feedback.submit(req.user.orgId, { subject, rating, text });
    res.status(201).json({ ok: true });
  });

  router.get('/admin/feedback', requireAdmin, async (req, res) => {
    res.json(await services.insights.feedbackReport(req.user.orgId));
  });

  return router;
}
