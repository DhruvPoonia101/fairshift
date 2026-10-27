import { Router } from 'express';
import { ADMIN_ROLE, WORKER_ROLE } from '../config/constants.js';
import { forbidden } from '../lib/errors.js';
import { requireRole } from '../middleware/auth.js';
import { v, validateParams } from '../middleware/validate.js';

/** @param {{ services: object }} deps */
export function payslipRoutes({ services }) {
  const router = Router();

  // A worker may only read their own payslip; an admin may read any worker in their own org.
  router.get(
    '/workers/:workerId/payslips/:month',
    requireRole(WORKER_ROLE, ADMIN_ROLE),
    validateParams({ workerId: v.id(), month: v.month() }),
    async (req, res) => {
      const { workerId, month } = req.params;
      if (req.user.role === WORKER_ROLE && req.user.id !== workerId) throw forbidden();
      res.json(await services.payroll.getPayslip(req.user.orgId, workerId, month));
    },
  );

  return router;
}
