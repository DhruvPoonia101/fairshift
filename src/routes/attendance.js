import { Router } from 'express';
import { CHECK_IN_CODE_DIGITS, CHECK_IN_METHODS } from '../config/constants.js';
import { resolveCapture } from '../lib/capture.js';
import { notFound, unprocessable } from '../lib/errors.js';
import { requireAdmin, requireWorker } from '../middleware/auth.js';
import { assertOwner, respondIdempotent } from '../middleware/offline.js';
import { v, validateBody, validateParams } from '../middleware/validate.js';

const RECENT_DAYS = 7;
const MAX_EPOCH_MS = 4_102_444_800_000; // 2100-01-01: a sanity bound on a time sent by the phone
const MAX_TOKEN_LENGTH = 200;
const CODE_PATTERN = new RegExp(`^\\d{${CHECK_IN_CODE_DIGITS}}$`);

const checkInSchema = {
  method: v.enum(CHECK_IN_METHODS),
  token: v.string({ max: MAX_TOKEN_LENGTH, optional: true }),
  code: v.string({ min: CHECK_IN_CODE_DIGITS, max: CHECK_IN_CODE_DIGITS, pattern: CODE_PATTERN, optional: true }),
  lat: v.number({ min: -90, max: 90, optional: true }),
  lng: v.number({ min: -180, max: 180, optional: true }),
  // Set only when the check-in was made without a signal: when the worker did it, as the phone saw it.
  capturedAt: v.int({ min: 0, max: MAX_EPOCH_MS, optional: true }),
};
const checkOutSchema = { capturedAt: checkInSchema.capturedAt };

const shiftView = ({ id, checkIn, checkOut, method, recordedOffline }) => ({
  id,
  checkIn,
  checkOut,
  method,
  ...(recordedOffline ? { recordedOffline: true } : {}),
});

/** @param {{ store: object, services: object }} deps */
export function attendanceRoutes({ store, services, clock }) {
  const { attendance, idempotency } = services;
  const router = Router();

  const loadWorker = (user) => store.workers.get(user.orgId, user.id);

  router.post('/attendance/check-in', requireWorker, assertOwner, validateBody(checkInSchema), async (req, res) => {
    const { method, token, code, lat, lng } = req.body;
    if ((method === 'qr' && !token) || (method === 'code' && !code)) {
      throw unprocessable('invalid_input', 'Missing check-in proof.', { fields: { [method === 'qr' ? 'token' : 'code']: 'required' } });
    }
    if ((lat === undefined) !== (lng === undefined)) {
      throw unprocessable('invalid_input', 'Send both lat and lng.', { fields: { lat: 'required', lng: 'required' } });
    }
    const worker = await loadWorker(req.user);
    // Sent again with the same Idempotency-Key (a retry from the offline queue), this answers with the first
    // result instead of checking in twice. The QR or code is checked now, against the day it was scanned.
    await respondIdempotent(req, res, { idempotency, kind: 'checkin', scope: `w:${worker.id}`, orgId: worker.orgId, body: req.body }, async ({ idFor }) => {
      const capture = resolveCapture(req.body.capturedAt, clock.now());
      const shift = await attendance.checkIn(worker, req.body, capture, idFor('sh'));
      return { status: 201, body: shiftView(shift) };
    });
  });

  router.post('/attendance/check-out', requireWorker, assertOwner, validateBody(checkOutSchema), async (req, res) => {
    const worker = await loadWorker(req.user);
    await respondIdempotent(req, res, { idempotency, kind: 'checkout', scope: `w:${worker.id}`, orgId: worker.orgId, body: req.body }, async () => {
      const capture = resolveCapture(req.body.capturedAt, clock.now());
      return { status: 200, body: shiftView(await attendance.checkOut(worker, capture)) };
    });
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
