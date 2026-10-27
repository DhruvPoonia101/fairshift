import { Router } from 'express';
import { GRIEVANCE_STATUSES } from '../config/constants.js';
import { requireAdmin, requireWorker } from '../middleware/auth.js';
import { v, validateBody, validateParams } from '../middleware/validate.js';

const MAX_REPORT_LENGTH = 1000;
const MAX_NOTE_LENGTH = 500;
const TRACKING_CODE_MAX = 20;

const createSchema = {
  category: v.id(),
  text: v.string({ min: 5, max: MAX_REPORT_LENGTH }),
  anonymous: v.boolean({ optional: true }),
  source: v.enum(['manual', 'payslip'], { optional: true }),
  month: v.month({ optional: true }),
};

/** @param {{ store: object, services: object, limiters: { report: Function } }} deps */
export function grievanceRoutes({ store, services, limiters }) {
  const { grievance } = services;
  const router = Router();

  router.post('/grievances', requireWorker, limiters.report, validateBody(createSchema), async (req, res) => {
    const org = await store.orgs.get(req.user.orgId, req.user.orgId);
    const { anonymous = false, ...rest } = req.body;
    res.status(201).json(await grievance.create(req.user, org, { anonymous, ...rest }));
  });

  router.get('/grievances', requireWorker, async (req, res) => {
    res.json({ items: await grievance.listForWorker(req.user) });
  });

  // POST (not GET) so the tracking code never appears in a URL or an access log.
  router.post(
    '/grievances/track',
    limiters.report,
    validateBody({ code: v.string({ min: 6, max: TRACKING_CODE_MAX }) }),
    async (req, res) => {
      res.json(await grievance.track(req.body.code));
    },
  );

  router.get('/admin/grievances', requireAdmin, async (req, res) => {
    res.json({ items: await grievance.listForOrg(req.user.orgId) });
  });

  router.patch(
    '/admin/grievances/:id',
    requireAdmin,
    validateParams({ id: v.id() }),
    validateBody({
      status: v.enum(GRIEVANCE_STATUSES),
      note: v.string({ min: 0, max: MAX_NOTE_LENGTH, optional: true }),
    }),
    async (req, res) => {
      const { status, note = '' } = req.body;
      res.json(await grievance.updateStatus(req.user.orgId, req.params.id, { status, note }));
    },
  );

  return router;
}
