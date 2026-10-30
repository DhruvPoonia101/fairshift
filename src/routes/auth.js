import { Router } from 'express';
import { ADMIN_ROLE, WORKER_ROLE } from '../config/constants.js';
import { DEMO_ROLES, SECTORS, orgIdFor, publicSectorView, sectorChoices } from '../config/sectors.js';
import { notFound, unauthorized } from '../lib/errors.js';
import { requireRole, safeCompare } from '../middleware/auth.js';
import { v, validateBody } from '../middleware/validate.js';

const ORG_IDS = Object.keys(SECTORS).map(orgIdFor);

/** Who is signed in, plus the sector settings the UI needs (categories, roles, shifts). */
async function describeSession(store, user) {
  const org = await store.orgs.get(user.orgId, user.orgId);
  const record =
    user.role === WORKER_ROLE
      ? await store.workers.get(user.orgId, user.id)
      : await store.admins.get(user.orgId, user.id);
  if (!org || !record) throw unauthorized();
  const site = user.role === WORKER_ROLE ? await store.sites.get(user.orgId, record.siteId) : null;
  return {
    user: {
      id: user.id,
      role: user.role,
      name: record.name,
      jobRole: record.role ?? null,
      site: site?.name ?? null,
      shiftId: record.shiftId ?? null,
    },
    org: { id: org.id, name: org.name, sector: org.sector },
    sector: publicSectorView(org.sector),
  };
}

/**
 * @param {{ store: object, sessions: object, env: object, limiters: { login: Function } }} deps
 */
export function authRoutes({ store, sessions, env, limiters }) {
  const router = Router();

  router.post('/demo-login/:role', async (req, res) => {
    const { role } = req.params;
    if (!env.demoMode || !DEMO_ROLES.includes(role)) throw notFound();
    const [kind, sector] = role.split('-');
    const orgId = orgIdFor(sector);
    const session =
      kind === ADMIN_ROLE
        ? { ...(await store.admins.query(orgId))[0], role: ADMIN_ROLE }
        : { ...(await store.workers.query(orgId, { where: { isDemo: true } }))[0], role: WORKER_ROLE };
    sessions.start(res, { id: session.id, role: session.role, orgId });
    res.json(await describeSession(store, { id: session.id, role: session.role, orgId }));
  });

  router.post(
    '/login/admin',
    limiters.login,
    validateBody({ password: v.string({ max: 200 }), org: v.enum(ORG_IDS) }),
    async (req, res) => {
      if (!env.adminPassword) throw notFound();
      if (!safeCompare(req.body.password, env.adminPassword)) {
        throw unauthorized('Wrong password.');
      }
      const [admin] = await store.admins.query(req.body.org);
      sessions.start(res, { id: admin.id, role: ADMIN_ROLE, orgId: req.body.org });
      res.json(await describeSession(store, { id: admin.id, role: ADMIN_ROLE, orgId: req.body.org }));
    },
  );

  // Lets the sign-in screen show only the options that are switched on.
  router.get('/config', (req, res) => {
    res.json({ demoMode: env.demoMode, adminLogin: Boolean(env.adminPassword), sectors: sectorChoices() });
  });

  router.post('/logout', (req, res) => {
    sessions.end(req, res);
    res.status(204).end();
  });

  router.get('/me', requireRole(WORKER_ROLE, ADMIN_ROLE), async (req, res) => {
    res.json({ ...(await describeSession(store, req.user)), demoMode: env.demoMode });
  });

  return router;
}
