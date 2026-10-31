import { MINUTES_PER_HOUR, PAYROLL, REGULAR_SHIFT_MINUTES } from '../config/constants.js';
import { getSector } from '../config/sectors.js';
import { notFound } from '../lib/errors.js';
import { dayKey, monthBounds, monthKey, previousMonth } from '../lib/time.js';
import { computeShiftMinutes } from './attendance.js';
import { COMPLIANCE_STATUS, checkCompliance } from './compliance.js';

const round2 = (n) => Math.round(n * 100) / 100;
const REGULAR_SHIFT_HOURS = REGULAR_SHIFT_MINUTES / MINUTES_PER_HOUR;

/** One row per worked day: first check-in, last check-out and the hours split. */
function buildDayRows(shifts) {
  const rows = new Map();
  for (const shift of [...shifts].sort((a, b) => a.checkIn - b.checkIn)) {
    const split = computeShiftMinutes(shift.checkIn, shift.checkOut);
    const key = dayKey(shift.checkIn);
    const row = rows.get(key) ?? {
      date: key,
      checkIn: shift.checkIn,
      checkOut: shift.checkOut,
      totalMinutes: 0,
      regularMinutes: 0,
      overtimeMinutes: 0,
    };
    row.checkOut = shift.checkOut;
    row.totalMinutes += split.totalMinutes;
    row.regularMinutes += split.regularMinutes;
    row.overtimeMinutes += split.overtimeMinutes;
    rows.set(key, row);
  }
  return [...rows.values()];
}

/**
 * Pure payslip arithmetic. Everything is integer paise; every line carries the numbers
 * the client needs to explain it in plain words (the client owns the wording, so it can be translated).
 *
 * - Regular pay: regular minutes / 480 x daily wage.
 * - Overtime: hours beyond 8 in a shift x hourly rate x multiplier (default 2.0; Factories Act 1948 s.59).
 * - PF 12% of regular pay only; ESI 0.75% of gross, only while gross <= Rs 21,000.
 * - Advances are recovered only up to what is left after PF and ESI; the rest carries forward.
 *
 * @param {object} input
 * @param {{ dailyWagePaise: number }} input.worker
 * @param {Array<{checkIn: number, checkOut: number | null}>} input.shifts shifts in the month
 * @param {Array<{amountPaise: number}>} input.advances advances given in the month
 * @param {number} [input.overtimeMultiplierPct]
 */
export function computePayslip({
  worker,
  shifts,
  advances = [],
  overtimeMultiplierPct = PAYROLL.DEFAULT_OVERTIME_MULTIPLIER_PCT,
}) {
  const days = buildDayRows(shifts.filter((s) => s.checkOut !== null));
  const regularMinutes = days.reduce((sum, d) => sum + d.regularMinutes, 0);
  const overtimeMinutes = days.reduce((sum, d) => sum + d.overtimeMinutes, 0);
  const dailyWagePaise = worker.dailyWagePaise;
  const hourlyRatePaise = Math.round(dailyWagePaise / REGULAR_SHIFT_HOURS);

  const regularPay = Math.round((dailyWagePaise * regularMinutes) / REGULAR_SHIFT_MINUTES);
  const overtimePay = Math.round(
    (hourlyRatePaise * overtimeMinutes * overtimeMultiplierPct) /
      (MINUTES_PER_HOUR * PAYROLL.PERCENT),
  );
  const gross = regularPay + overtimePay;
  const pf = Math.round((regularPay * PAYROLL.PF_RATE_BP) / PAYROLL.BASIS_POINTS);
  const esiApplies = gross <= PAYROLL.ESI_GROSS_CEILING_PAISE;
  const esi = esiApplies ? Math.round((gross * PAYROLL.ESI_RATE_BP) / PAYROLL.BASIS_POINTS) : 0;

  const advancesGiven = advances.reduce((sum, a) => sum + a.amountPaise, 0);
  const advancesRecovered = Math.min(advancesGiven, Math.max(0, gross - pf - esi));
  const net = gross - pf - esi - advancesRecovered;

  const lines = [
    {
      key: 'regular',
      kind: 'earning',
      amountPaise: regularPay,
      params: {
        days: days.length,
        paidDays: round2(regularMinutes / REGULAR_SHIFT_MINUTES),
        dailyWagePaise,
      },
    },
    {
      key: 'overtime',
      kind: 'earning',
      amountPaise: overtimePay,
      params: {
        hours: round2(overtimeMinutes / MINUTES_PER_HOUR),
        hourlyRatePaise,
        multiplier: overtimeMultiplierPct / PAYROLL.PERCENT,
      },
    },
    {
      key: 'pf',
      kind: 'deduction',
      amountPaise: pf,
      params: { ratePct: PAYROLL.PF_RATE_BP / PAYROLL.PERCENT, basePaise: regularPay },
    },
    {
      key: esiApplies ? 'esi' : 'esi_not_applicable',
      kind: 'deduction',
      amountPaise: esi,
      params: {
        ratePct: PAYROLL.ESI_RATE_BP / PAYROLL.PERCENT,
        grossPaise: gross,
        ceilingPaise: PAYROLL.ESI_GROSS_CEILING_PAISE,
      },
    },
  ];
  if (advancesGiven > 0) {
    lines.push({
      key: 'advance',
      kind: 'deduction',
      amountPaise: advancesRecovered,
      params: { givenPaise: advancesGiven, carriedPaise: advancesGiven - advancesRecovered },
    });
  }

  return {
    dailyWagePaise,
    hourlyRatePaise,
    overtimeMultiplierPct,
    totals: { daysWorked: days.length, regularMinutes, overtimeMinutes },
    lines,
    grossPaise: gross,
    deductionsPaise: pf + esi + advancesRecovered,
    netPaise: net,
    days,
  };
}

/** @param {{ store: object, clock: { now: () => number } }} deps */
export function createPayrollService({ store, clock }) {
  const isOpenMonth = (month) => month >= monthKey(clock.now());

  async function wageRulesFor(orgId) {
    const org = await store.orgs.get(orgId, orgId);
    return getSector(org.sector).wageRules;
  }

  return {
    /**
     * Payslip for one worker and calendar month (IST), with a compliance check against what was
     * actually paid. Only finished shifts are paid; a shift still open is listed as pending.
     */
    async getPayslip(orgId, workerId, month) {
      const worker = await store.workers.get(orgId, workerId);
      if (!worker) throw notFound('Worker not found.');
      const rules = await wageRulesFor(orgId);
      const { startMs, endMs } = monthBounds(month);
      const [shifts, advances, payments] = await Promise.all([
        store.shifts.query(orgId, {
          where: { workerId },
          gte: { field: 'checkIn', value: startMs },
          lt: { field: 'checkIn', value: endMs },
        }),
        store.advances.query(orgId, { where: { workerId, month } }),
        store.payments.query(orgId, { where: { workerId, month } }),
      ]);
      const slip = computePayslip({ worker, shifts, advances, overtimeMultiplierPct: rules.overtimeMultiplierPct });
      const pendingShift = shifts.some((s) => s.checkOut === null);
      return {
        month,
        worker: { id: worker.id, name: worker.name, role: worker.role },
        pendingShift,
        ...slip,
        compliance: checkCompliance({ slip, rules, payment: payments[0] ?? null, isOpenMonth: isOpenMonth(month), pendingShift }),
      };
    },

    /**
     * One row per worker for a month: the figures of their payslip (days, hours, gross, PF, ESI, net) and what was
     * paid with the shortfall and status. It is built with the same arithmetic as `getPayslip`, so the employer's
     * table and export always match what the worker sees. Sorted by name. Only this org's workers.
     */
    async monthlyRows(orgId, month = previousMonth(monthKey(clock.now()))) {
      const rules = await wageRulesFor(orgId);
      const { startMs, endMs } = monthBounds(month);
      const [workers, shifts, advances, payments] = await Promise.all([
        store.workers.query(orgId),
        store.shifts.query(orgId, { gte: { field: 'checkIn', value: startMs }, lt: { field: 'checkIn', value: endMs } }),
        store.advances.query(orgId, { where: { month } }),
        store.payments.query(orgId, { where: { month } }),
      ]);
      const rows = workers
        .map((worker) => {
          const own = shifts.filter((s) => s.workerId === worker.id);
          const slip = computePayslip({
            worker,
            shifts: own,
            advances: advances.filter((a) => a.workerId === worker.id),
            overtimeMultiplierPct: rules.overtimeMultiplierPct,
          });
          const compliance = checkCompliance({
            slip,
            rules,
            payment: payments.find((p) => p.workerId === worker.id) ?? null,
            isOpenMonth: isOpenMonth(month),
            pendingShift: own.some((s) => s.checkOut === null),
          });
          const line = (...keys) => slip.lines.find((l) => keys.includes(l.key))?.amountPaise ?? 0;
          return {
            workerId: worker.id,
            name: worker.name,
            role: worker.role,
            daysWorked: slip.totals.daysWorked,
            regularMinutes: slip.totals.regularMinutes,
            overtimeMinutes: slip.totals.overtimeMinutes,
            grossPaise: slip.grossPaise,
            pfPaise: line('pf'),
            esiPaise: line('esi', 'esi_not_applicable'),
            netPaise: slip.netPaise,
            paidPaise: compliance.paidPaise,
            shortfallPaise: compliance.shortfallPaise,
            status: compliance.status,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
      const summary = {
        workers: rows.length,
        underpaid: rows.filter((r) => r.status === COMPLIANCE_STATUS.UNDERPAID).length,
        shortfallPaise: rows.reduce((sum, r) => sum + r.shortfallPaise, 0),
      };
      return { month, rows, summary };
    },

    /**
     * Every worker's compliance result for a month (default: last month), flagged ones first (largest shortfall on top).
     * `items` holds only the flagged payslips (underpaid, or not checkable); `summary` counts all.
     */
    async listCompliance(orgId, month = previousMonth(monthKey(clock.now()))) {
      const rules = await wageRulesFor(orgId);
      const { startMs, endMs } = monthBounds(month);
      const [workers, shifts, payments] = await Promise.all([
        store.workers.query(orgId),
        store.shifts.query(orgId, { gte: { field: 'checkIn', value: startMs }, lt: { field: 'checkIn', value: endMs } }),
        store.payments.query(orgId, { where: { month } }),
      ]);
      const summary = { ok: 0, underpaid: 0, review: 0, shortfallPaise: 0 };
      const items = [];
      for (const worker of workers) {
        const own = shifts.filter((s) => s.workerId === worker.id);
        const slip = computePayslip({ worker, shifts: own, overtimeMultiplierPct: rules.overtimeMultiplierPct });
        const compliance = checkCompliance({
          slip,
          rules,
          payment: payments.find((p) => p.workerId === worker.id) ?? null,
          isOpenMonth: isOpenMonth(month),
          pendingShift: own.some((s) => s.checkOut === null),
        });
        summary[compliance.status] += 1;
        summary.shortfallPaise += compliance.shortfallPaise;
        if (compliance.status !== COMPLIANCE_STATUS.OK) {
          items.push({ workerId: worker.id, name: worker.name, role: worker.role, ...compliance });
        }
      }
      items.sort((a, b) => b.shortfallPaise - a.shortfallPaise || a.name.localeCompare(b.name));
      return { month, summary, items, note: rules.note };
    },
  };
}
