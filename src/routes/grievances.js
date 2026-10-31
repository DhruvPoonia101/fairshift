import { Router } from 'express';
import { GRIEVANCE_STATUSES } from '../config/constants.js';
import { resolveCapture } from '../lib/capture.js';
import { requireAdmin, requireWorker } from '../middleware/auth.js';
import { assertOwner, respondIdempotent } from '../middleware/offline.js';
import { v, validateBody, validateParams } from '../middleware/validate.js';

const MAX_REPORT_LENGTH = 1000;
const MAX_NOTE_LENGTH = 500;
const TRACKING_CODE_MAX = 20;
const MAX_EPOCH_MS = 4_102_444_800_000;

const createSchema = {
  category: v.id(),
  text: v.string({ min: 5, max: MAX_REPORT_LENGTH }),
  anonymous: v.boolean({ optional: true }),
  source: v.enum(['manual', 'payslip'], { optional: true }),
  month: v.month({ optional: true }),
  capturedAt: v.int({ min: 0, max: MAX_EPOCH_MS, optional: true }),
  // Only for anonymous reports: a code made on the phone (see services/grievance.js isValidClientCode).
  trackingCode: v.string({ min: 1, max: 32, optional: true }),
};

const anonymousSchema = {
  category: createSchema.category,
  text: createSchema.text,
  capturedAt: createSchema.capturedAt,
  trackingCode: v.string({ min: 1, max: 32 }),
};

/** @param {{ store: object, services: object, limiters: { report: Function } }} deps */
export function grievanceRoutes({ store, services, anonTokens, clock, limiters }) {
  const { grievance, idempotency } = services;
  const router = Router();

  /** Files a report once per Idempotency-Key; `user` is null when the request carried no sign-in. */
  async function file(req, res, { user, orgId, anonymous, fields }) {
    const org = await store.orgs.get(orgId, orgId);
    // An anonymous report's key is kept in the shared "anon" scope, so no worker id sits next to it.
    const scope = anonymous ? 'anon' : `w:${user.id}`;
    await respondIdempotent(req, res, { idempotency, kind: 'grievance', scope, orgId, body: { ...fields, anonymous } }, async ({ idFor }) => {
      const capture = resolveCapture(fields.capturedAt, clock.now());
      const { capturedAt, ...input } = fields;
      return { status: 201, body: await grievance.create(user, org, { ...input, anonymous }, capture, idFor('gr')) };
    });
  }

  router.post('/grievances', requireWorker, assertOwner, limiters.report, validateBody(createSchema), async (req, res) => {
    const { anonymous = false, ...fields } = req.body;
    await file(req, res, { user: req.user, orgId: req.user.orgId, anonymous, fields });
  });

  // An anonymous report sent with no sign-in on the request at all (the offline queue uses this one).
  router.post('/anonymous/grievances', limiters.report, anonTokens.require, validateBody(anonymousSchema), async (req, res) => {
    await file(req, res, { user: null, orgId: req.anon.orgId, anonymous: true, fields: req.body });
  });

  // Gives a worker the organisation-level token that anonymous submissions use instead of a session.
  router.get('/anonymous/token', requireWorker, (req, res) => {
    res.json(anonTokens.issue(req.user.orgId));
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
