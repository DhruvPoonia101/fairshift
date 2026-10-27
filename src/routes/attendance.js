import { Router } from 'express';
import { CHECK_IN_CODE_DIGITS, CHECK_IN_METHODS } from '../config/constants.js';
import { notFound, unprocessable } from '../lib/errors.js';
import { requireAdmin, requireWorker } from '../middleware/auth.js';
import { v, validateBody, validateParams } from '../middleware/validate.js';

const RECENT_DAYS = 7;
const MAX_TOKEN_LENGTH = 200;
const CODE_PATTERN = new RegExp(`^\\d{${CHECK_IN_CODE_DIGITS}}$`);

const checkInSchema = {
  method: v.enum(CHECK_IN_METHODS),
  token: v.string({ max: MAX_TOKEN_LENGTH, optional: true }),
  code: v.string({ min: CHECK_IN_CODE_DIGITS, max: CHECK_IN_CODE_DIGITS, pattern: CODE_PATTERN, optional: true }),
  lat: v.number({ min: -90, max: 90, optional: true }),
  lng: v.number({ min: -180, max: 180, optional: true }),
};

const shiftView = ({ id, checkIn, checkOut, method }) => ({ id, checkIn, checkOut, method });

/** @param {{ store: object, services: object }} deps */
export function attendanceRoutes({ store, services }) {
  const { attendance } = services;
  const router = Router();

  const loadWorker = (user) => store.workers.get(user.orgId, user.id);

  router.post('/attendance/check-in', requireWorker, validateBody(checkInSchema), async (req, res) => {
    const { method, token, code, lat, lng } = req.body;
    if ((method === 'qr' && !token) || (method === 'code' && !code)) {
      throw unprocessable('invalid_input', 'Missing check-in proof.', { fields: { [method === 'qr' ? 'token' : 'code']: 'required' } });
    }
    if ((lat === undefined) !== (lng === undefined)) {
      throw unprocessable('invalid_input', 'Send both lat and lng.', { fields: { lat: 'required', lng: 'required' } });
    }
    const shift = await attendance.checkIn(await loadWorker(req.user), req.body);
    res.status(201).json(shiftView(shift));
  });

  router.post('/attendance/check-out', requireWorker, async (req, res) => {
    res.json(shiftView(await attendance.checkOut(await loadWorker(req.user))));
  });

  router.get('/attendance/today', requireWorker, async (req, res) => {
    const worker = await loadWorker(req.user);
    const [today, rest, recent] = await Promise.all([
      attendance.today(worker),
      attendance.restStatus(worker),
      attendance.recentDays(worker, RECENT_DAYS),
    ]);
    res.json({ ...today, rest, recent });
  });

  router.get('/admin/sites', requireAdmin, async (req, res) => {
    res.json({ sites: await attendance.siteCredentials(req.user.orgId) });
  });

  router.get(
    '/admin/sites/:siteId/qr.svg',
    requireAdmin,
    validateParams({ siteId: v.id() }),
    async (req, res) => {
      const svg = await attendance.renderSiteQr(req.user.orgId, req.params.siteId);
      if (!svg) throw notFound('Site not found.');
      res.type('image/svg+xml').send(svg);
    },
  );

  return router;
}
