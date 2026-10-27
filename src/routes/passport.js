import { Router } from 'express';
import { PASSPORT_TYPES } from '../config/constants.js';
import { notFound } from '../lib/errors.js';
import { requireAdmin, requireWorker } from '../middleware/auth.js';
import { v, validateBody, validateParams } from '../middleware/validate.js';

const MAX_TITLE_LENGTH = 80;
const MIN_TOKEN_LENGTH = 16;
const MAX_TOKEN_LENGTH = 64;

const entrySchema = {
  type: v.enum(PASSPORT_TYPES),
  title: v.string({ min: 2, max: MAX_TITLE_LENGTH }),
  issuer: v.string({ min: 2, max: MAX_TITLE_LENGTH }),
  issuedOn: v.dayKey(),
  expiresOn: v.dayKey({ optional: true }),
};

/** @param {{ store: object, services: object }} deps */
export function passportRoutes({ store, services }) {
  const { passport } = services;
  const router = Router();

  router.get('/passport', requireWorker, async (req, res) => {
    const worker = await store.workers.get(req.user.orgId, req.user.id);
    res.json({
      entries: await passport.list(req.user.orgId, req.user.id),
      shareToken: worker.passportToken ?? null,
    });
  });

  // Worker-added entries start unverified until an employer verifies them.
  router.post('/passport', requireWorker, validateBody(entrySchema), async (req, res) => {
    res.status(201).json(await passport.add(req.user.orgId, req.user.id, req.body));
  });

  router.post('/passport/share', requireWorker, async (req, res) => {
    res.json({ shareToken: await passport.enableSharing(req.user.orgId, req.user.id) });
  });

  router.delete('/passport/share', requireWorker, async (req, res) => {
    await passport.disableSharing(req.user.orgId, req.user.id);
    res.status(204).end();
  });

  router.get(
    '/public/passport/:token',
    validateParams({ token: v.string({ min: MIN_TOKEN_LENGTH, max: MAX_TOKEN_LENGTH, pattern: /^[A-Za-z0-9_-]+$/ }) }),
    async (req, res) => {
      res.json(await passport.publicView(req.params.token));
    },
  );

  router.get('/admin/passport', requireAdmin, async (req, res) => {
    res.json({ entries: await passport.listForOrg(req.user.orgId) });
  });

  router.post(
    '/admin/workers/:workerId/passport',
    requireAdmin,
    validateParams({ workerId: v.id() }),
    validateBody(entrySchema),
    async (req, res) => {
      const { orgId, id: adminId } = req.user;
      if (!(await store.workers.get(orgId, req.params.workerId))) throw notFound('Worker not found.');
      res.status(201).json(await passport.add(orgId, req.params.workerId, req.body, { verifiedBy: adminId }));
    },
  );

  router.post(
    '/admin/passport/:entryId/verify',
    requireAdmin,
    validateParams({ entryId: v.id() }),
    async (req, res) => {
      res.json(await passport.verify(req.user.orgId, req.params.entryId, req.user.id));
    },
  );

  return router;
}
