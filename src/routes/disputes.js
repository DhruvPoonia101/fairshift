import { Router } from 'express';
import { DISPUTE } from '../config/constants.js';
import { notFound } from '../lib/errors.js';
import { requireAdmin, requireWorker } from '../middleware/auth.js';
import { v, validateBody, validateParams } from '../middleware/validate.js';

const MS_PER_YEAR_LIMIT = 4_102_444_800_000; // 2100-01-01: a sanity bound on claimed times

const disputeSchema = {
  shiftId: v.id(),
  category: v.enum(DISPUTE.CATEGORIES),
  checkInAt: v.int({ min: 0, max: MS_PER_YEAR_LIMIT, optional: true }),
  checkOutAt: v.int({ min: 0, max: MS_PER_YEAR_LIMIT, optional: true }),
  siteId: v.id({ optional: true }),
  note: v.string({ min: 0, max: DISPUTE.MAX_NOTE_LENGTH, optional: true }),
};

/** @param {{ store: object, services: object, limiters: { report: Function } }} deps */
export function disputeRoutes({ store, services, limiters }) {
  const { disputes } = services;
  const router = Router();

  const loadWorker = async (user) => {
    const worker = await store.workers.get(user.orgId, user.id);
    if (!worker) throw notFound('Worker not found.');
    return worker;
  };

  // Worker: their own records inside the window, their disputes (with timelines) and their audit trail.
  router.get('/attendance/records', requireWorker, async (req, res) => {
    res.json(await disputes.recordsFor(await loadWorker(req.user)));
  });

  router.post('/disputes', requireWorker, limiters.report, validateBody(disputeSchema), async (req, res) => {
    res.status(201).json(await disputes.submit(await loadWorker(req.user), req.body));
  });

  router.get('/disputes', requireWorker, async (req, res) => {
    res.json(await disputes.listForWorker(await loadWorker(req.user)));
  });

  // Employer: the queue, and the only way hours can ever be changed (a decision, with an audit entry).
  router.get('/admin/disputes', requireAdmin, async (req, res) => {
    res.json({ items: await disputes.listForOrg(req.user.orgId) });
  });

  router.post('/admin/disputes/:id/review', requireAdmin, validateParams({ id: v.id() }), async (req, res) => {
    res.json(await disputes.startReview(req.user.orgId, req.user.id, req.params.id));
  });

  router.post(
    '/admin/disputes/:id/decision',
    requireAdmin,
    validateParams({ id: v.id() }),
    validateBody({
      decision: v.enum(['approve', 'reject']),
      note: v.string({ min: 0, max: DISPUTE.MAX_NOTE_LENGTH, optional: true }),
    }),
    async (req, res) => {
      const { decision, note = '' } = req.body;
      res.json(await disputes.decide(req.user.orgId, req.user.id, req.params.id, { decision, note }));
    },
  );

  return router;
}
