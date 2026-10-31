import { Router } from 'express';
import { ADMIN_ROLE, WORKER_ROLE } from '../config/constants.js';
import { forbidden } from '../lib/errors.js';
import { hoursFromMinutes, rupees, toCsv } from '../lib/csv.js';
import { requireAdmin, requireRole } from '../middleware/auth.js';
import { v, validateParams, validateQuery } from '../middleware/validate.js';

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

  // Employer view: payslips where what was paid does not match the rules, with the shortfall.
  router.get('/admin/compliance', requireAdmin, validateQuery({ month: v.month({ optional: true }) }), async (req, res) => {
    res.json(await services.payroll.listCompliance(req.user.orgId, req.valid.month));
  });

  // Employer: the month's payroll, one row per worker (for the table on the Payroll page).
  router.get('/admin/payroll', requireAdmin, validateQuery({ month: v.month({ optional: true }) }), async (req, res) => {
    res.json(await services.payroll.monthlyRows(req.user.orgId, req.valid.month));
  });

  // Employer: the same rows as a CSV download. Cells that a spreadsheet could run as a formula are neutralised (lib/csv.js).
  router.get('/admin/payroll/export', requireAdmin, validateQuery({ month: v.month({ optional: true }) }), async (req, res) => {
    const { orgId } = req.user;
    const { month, rows } = await services.payroll.monthlyRows(orgId, req.valid.month);
    const body = toCsv(
      EXPORT_COLUMNS,
      rows.map((r) => [
        r.name,
        r.workerId,
        r.daysWorked,
        hoursFromMinutes(r.regularMinutes),
        hoursFromMinutes(r.overtimeMinutes),
        rupees(r.grossPaise),
        rupees(r.pfPaise),
        rupees(r.esiPaise),
        rupees(r.netPaise),
        r.paidPaise === null ? '' : rupees(r.paidPaise),
        rupees(r.shortfallPaise),
        r.status,
      ]),
    );
    const org = orgId.replace(/[^A-Za-z0-9-]/g, '');
    res
      .type('text/csv; charset=utf-8')
      .set('Content-Disposition', `attachment; filename="fairshift-payroll-${org}-${month}.csv"`)
      .send(body);
  });

  return router;
}

export const EXPORT_COLUMNS = Object.freeze([
  'worker name',
  'worker code',
  'days',
  'regular hours',
  'overtime hours',
  'gross',
  'PF',
  'ESI',
  'net',
  'paid',
  'shortfall',
  'compliance status',
]);
