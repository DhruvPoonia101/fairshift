import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';

/** @param {{ store: object, services: object }} deps */
export function dashboardRoutes({ store, services }) {
  const router = Router();

  router.get('/admin/dashboard', requireAdmin, async (req, res) => {
    res.json(await services.insights.dashboard(req.user.orgId));
  });

  // Minimal roster for pickers (no wages, no tokens).
  router.get('/admin/workers', requireAdmin, async (req, res) => {
    const workers = await store.workers.query(req.user.orgId);
    res.json({
      workers: workers
        .map(({ id, name, role }) => ({ id, name, role }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    });
  });

  return router;
}
