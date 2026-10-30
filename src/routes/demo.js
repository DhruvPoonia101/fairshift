import { Router } from 'express';
import { AppError, forbidden } from '../lib/errors.js';
import { requireAdmin } from '../middleware/auth.js';
import { v, validateBody } from '../middleware/validate.js';
import { resetDemoOrg } from '../store/seed.js';

/** @param {{ store: object, env: object, clock: { now: () => number }, limiters: { reset: Function } }} deps */
export function demoRoutes({ store, env, clock, limiters }) {
  const router = Router();

  const requireDemoMode = (req, res, next) =>
    env.demoMode ? next() : next(new AppError(403, 'demo_mode_required', 'Demo reset is only available in demo mode.'));

  // Admin only, demo mode only. Deletes and rebuilds the signed-in admin's own org; there is no way to name another org.
  router.post(
    '/admin/demo/reset',
    requireAdmin,
    requireDemoMode,
    limiters.reset,
    validateBody({ confirm: v.enum([true]), orgId: v.id({ optional: true }) }),
    async (req, res) => {
      if (req.body.orgId !== undefined && req.body.orgId !== req.user.orgId) throw forbidden();
      await resetDemoOrg(store, req.user.orgId, { clock });
      res.json({ ok: true, orgId: req.user.orgId });
    },
  );

  return router;
}
