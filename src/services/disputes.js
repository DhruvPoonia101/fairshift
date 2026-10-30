import { DISPUTE, MS_PER_MINUTE } from '../config/constants.js';
import { getSector } from '../config/sectors.js';
import { conflict, notFound, unprocessable } from '../lib/errors.js';
import { newId } from '../lib/random.js';
import { addDays, dayKey, dayStartMs, monthKey } from '../lib/time.js';
import { computeShiftMinutes } from './attendance.js';
import { compareEntries } from './audit.js';

const isOpen = (dispute) => DISPUTE.OPEN_STATUSES.includes(dispute.status);
const snapshot = (shift) => ({ checkIn: shift.checkIn, checkOut: shift.checkOut, siteId: shift.siteId });
const sameRecord = (a, b) => a.checkIn === b.checkIn && a.checkOut === b.checkOut && a.siteId === b.siteId;

const invalidClaim = (reason) => unprocessable('invalid_claim', 'Please check the times you entered.', { reason });

/**
 * Attendance disputes. A worker contests one record; an employer approves (the record is corrected)
 * or rejects with a note. Nobody can change hours without an audit entry: the correction is written
 * to the audit trail first, and only then applied to the record.
 * @param {object} deps
 * @param {object} deps.store
 * @param {{ now: () => number }} deps.clock
 * @param {ReturnType<import('./audit.js').createAuditService>} deps.audit
 * @param {ReturnType<import('./attendance.js').createAttendanceService>} deps.attendance
 * @param {ReturnType<import('./payroll.js').createPayrollService>} deps.payroll
 */
export function createDisputeService({ store, clock, audit, attendance, payroll }) {
  // Two decisions on the same dispute run one after the other, so the second sees the first's result.
  const tails = new Map();
  function serialise(key, task) {
    const run = (tails.get(key) ?? Promise.resolve()).then(task, task);
    const tail = run.catch(() => {});
    tails.set(key, tail);
    tail.then(() => tails.get(key) === tail && tails.delete(key));
    return run;
  }

  async function windowDaysFor(orgId) {
    const org = await store.orgs.get(orgId, orgId);
    return getSector(org.sector).disputeWindowDays;
  }

  async function present(dispute, entries) {
    const timeline = (entries ?? (await audit.listForWorker(dispute.orgId, dispute.workerId))).filter(
      (e) => e.disputeId === dispute.id,
    );
    const { orgId, ...rest } = dispute;
    return { ...rest, timeline: timeline.map(presentEntry) };
  }

  const presentEntry = ({ id, at, actorRole, action, before, after, note, details, disputeId, shiftId, digest }) => ({
    id, at, actorRole, action, before, after, note, details, disputeId, shiftId, digest,
  });

  function checkClaim({ category, shift, input, siteIds, now }) {
    const claimsSomething = input.checkInAt !== undefined || input.checkOutAt !== undefined || input.siteId !== undefined;
    if (category === 'forgot_checkout' && input.checkOutAt === undefined) throw invalidClaim('check_out_required');
    if (category === 'forgot_checkout' && shift.checkOut !== null && !shift.autoClosed) throw invalidClaim('not_forgotten');
    if (category === 'wrong_time' && input.checkInAt === undefined && input.checkOutAt === undefined) {
      throw invalidClaim('time_required');
    }
    if (category === 'wrong_time' && shift.checkOut === null) throw invalidClaim('shift_not_finished');
    if (category === 'wrong_site') {
      if (input.siteId === undefined) throw invalidClaim('site_required');
      if (input.siteId === shift.siteId) throw invalidClaim('no_change');
    }
    if (input.siteId !== undefined && !siteIds.includes(input.siteId)) throw invalidClaim('unknown_site');
    if (category === 'other' && !input.note) throw unprocessable('note_required', 'Please explain the problem.');
    if (!claimsSomething) return null;

    const claimed = {
      checkIn: input.checkInAt ?? shift.checkIn,
      checkOut: input.checkOutAt ?? shift.checkOut,
      siteId: input.siteId ?? shift.siteId,
    };
    if (claimed.checkOut === null || claimed.checkOut <= claimed.checkIn) throw invalidClaim('check_out_before_check_in');
    if (claimed.checkOut > now) throw invalidClaim('in_the_future');
    if ((claimed.checkOut - claimed.checkIn) / MS_PER_MINUTE > DISPUTE.MAX_SHIFT_MINUTES) throw invalidClaim('too_long');
    const dayDistance = Math.abs(dayStartMs(dayKey(claimed.checkIn)) - dayStartMs(dayKey(shift.checkIn))) / (24 * 60 * MS_PER_MINUTE);
    if (dayDistance > 1) throw invalidClaim('wrong_day');
    if (sameRecord(claimed, shift)) throw invalidClaim('no_change');
    return claimed;
  }

  /** What changed for the worker when a correction is applied: hours, rest warnings and pay. */
  async function recalculate(orgId, worker, shift, netBefore) {
    const month = monthKey(shift.checkIn);
    const [rest, payslip] = await Promise.all([attendance.restStatus(worker), payroll.getPayslip(orgId, worker.id, month)]);
    const split = computeShiftMinutes(shift.checkIn, shift.checkOut);
    return {
      day: dayKey(shift.checkIn),
      totalMinutes: split.totalMinutes,
      overtimeMinutes: split.overtimeMinutes,
      fatigue: { level: rest.level, rules: rest.flags.map((f) => f.rule) },
      payslip: { month, netBeforePaise: netBefore, netAfterPaise: payslip.netPaise, compliance: payslip.compliance.status },
    };
  }

  async function approve(orgId, adminId, dispute) {
    const shift = await store.shifts.get(orgId, dispute.shiftId);
    if (!shift) throw notFound('Record not found.');
    const worker = await store.workers.get(orgId, dispute.workerId);
    const month = monthKey(shift.checkIn);
    const netBefore = (await payroll.getPayslip(orgId, worker.id, month)).netPaise;

    if (dispute.claimed) {
      const applied = sameRecord(snapshot(shift), dispute.claimed); // a retry after a half-finished approval
      if (!applied && !sameRecord(snapshot(shift), dispute.original)) {
        throw conflict('record_changed', 'The record changed after the dispute was filed.');
      }
      if (!applied) {
        // Audit first: if this write fails the record stays as it was.
        await audit.record({
          id: `au-${dispute.id}-correction`,
          orgId,
          workerId: worker.id,
          actorRole: 'admin',
          actorId: adminId,
          action: 'shift_corrected',
          disputeId: dispute.id,
          shiftId: shift.id,
          before: snapshot(shift),
          after: dispute.claimed,
          note: dispute.note,
        });
        await store.shifts.update(orgId, shift.id, { ...dispute.claimed, autoClosed: false, correctedBy: dispute.id });
      }
    }
    const corrected = (await store.shifts.get(orgId, shift.id)) ?? shift;
    return recalculate(orgId, worker, corrected, netBefore);
  }

  return {
    /** The worker's own records inside the dispute window, with any dispute already open on them. */
    async recordsFor(worker) {
      const windowDays = await windowDaysFor(worker.orgId);
      const since = dayStartMs(addDays(dayKey(clock.now()), -windowDays));
      const [shifts, disputes, sites] = await Promise.all([
        store.shifts.query(worker.orgId, { where: { workerId: worker.id }, gte: { field: 'checkIn', value: since } }),
        store.disputes.query(worker.orgId, { where: { workerId: worker.id } }),
        store.sites.query(worker.orgId),
      ]);
      const siteNames = new Map(sites.map((s) => [s.id, s.name]));
      const records = shifts
        .sort((a, b) => b.checkIn - a.checkIn)
        .map((s) => ({
          id: s.id,
          date: dayKey(s.checkIn),
          checkIn: s.checkIn,
          checkOut: s.checkOut,
          siteId: s.siteId,
          site: siteNames.get(s.siteId) ?? '',
          autoClosed: Boolean(s.autoClosed),
          corrected: Boolean(s.correctedBy),
          openDisputeId: disputes.find((d) => d.shiftId === s.id && isOpen(d))?.id ?? null,
        }));
      return { windowDays, records, sites: sites.map(({ id, name }) => ({ id, name })) };
    },

    async submit(worker, input) {
      const { orgId } = worker;
      const now = clock.now();
      const shift = await store.shifts.get(orgId, input.shiftId);
      if (!shift || shift.workerId !== worker.id) throw notFound('Record not found.');
      const windowDays = await windowDaysFor(orgId);
      if (dayKey(shift.checkIn) < addDays(dayKey(now), -windowDays)) {
        throw unprocessable('outside_dispute_window', `Only the last ${windowDays} days can be disputed.`);
      }
      const existing = await store.disputes.query(orgId, { where: { shiftId: shift.id } });
      if (existing.some(isOpen)) throw conflict('dispute_already_open', 'This record already has an open dispute.');

      const sites = await store.sites.query(orgId);
      const claimed = checkClaim({ category: input.category, shift, input, siteIds: sites.map((s) => s.id), now });
      const dispute = {
        id: newId('dp'),
        orgId,
        workerId: worker.id,
        shiftId: shift.id,
        category: input.category,
        original: snapshot(shift),
        claimed,
        note: input.note ?? '',
        status: 'submitted',
        createdAt: now,
        updatedAt: now,
        decidedAt: null,
        decidedBy: null,
        decisionNote: '',
      };
      await store.disputes.insert(dispute);
      await audit.record({
        orgId,
        workerId: worker.id,
        actorRole: 'worker',
        actorId: worker.id,
        action: 'dispute_submitted',
        disputeId: dispute.id,
        shiftId: shift.id,
        before: dispute.original,
        after: claimed,
        note: dispute.note,
        details: { category: dispute.category },
      });
      return present(dispute);
    },

    /** The worker's disputes with their timelines, plus every audit entry about them. */
    async listForWorker(worker) {
      const [disputes, entries] = await Promise.all([
        store.disputes.query(worker.orgId, { where: { workerId: worker.id } }),
        audit.listForWorker(worker.orgId, worker.id),
      ]);
      const items = await Promise.all(disputes.sort((a, b) => b.createdAt - a.createdAt).map((d) => present(d, entries)));
      return { items, audit: entries.map(presentEntry).reverse() };
    },

    /** The employer's queue: open disputes first (oldest first), then decided ones (newest first). */
    async listForOrg(orgId) {
      const [disputes, workers, sites, entries] = await Promise.all([
        store.disputes.query(orgId),
        store.workers.query(orgId),
        store.sites.query(orgId),
        store.audit.query(orgId),
      ]);
      const names = new Map(workers.map((w) => [w.id, { name: w.name, role: w.role }]));
      const siteNames = new Map(sites.map((s) => [s.id, s.name]));
      const ordered = [
        ...disputes.filter(isOpen).sort((a, b) => a.createdAt - b.createdAt),
        ...disputes.filter((d) => !isOpen(d)).sort((a, b) => b.decidedAt - a.decidedAt),
      ];
      return Promise.all(
        ordered.map(async (d) => ({
          ...(await present(d, entries.filter((e) => e.workerId === d.workerId).sort(compareEntries))),
          worker: names.get(d.workerId) ?? null,
          sites: { original: siteNames.get(d.original.siteId) ?? '', claimed: siteNames.get(d.claimed?.siteId) ?? '' },
        })),
      );
    },

    async startReview(orgId, adminId, disputeId) {
      return serialise(disputeId, async () => {
        const dispute = await store.disputes.get(orgId, disputeId);
        if (!dispute) throw notFound('Dispute not found.');
        if (dispute.status !== 'submitted') throw conflict('dispute_already_decided', 'This dispute is not waiting for review.');
        const updated = await store.disputes.update(orgId, disputeId, { status: 'under_review', updatedAt: clock.now() });
        await audit.record({
          orgId,
          workerId: dispute.workerId,
          actorRole: 'admin',
          actorId: adminId,
          action: 'dispute_review_started',
          disputeId,
          shiftId: dispute.shiftId,
        });
        return present(updated);
      });
    },

    /**
     * Approves (applies the correction and recalculates hours, overtime, rest warnings and pay) or
     * rejects (a note is required). A dispute can be decided once; a second attempt gets a 409.
     */
    async decide(orgId, adminId, disputeId, { decision, note }) {
      return serialise(disputeId, async () => {
        const dispute = await store.disputes.get(orgId, disputeId);
        if (!dispute) throw notFound('Dispute not found.');
        if (!isOpen(dispute)) throw conflict('dispute_already_decided', 'This dispute has already been decided.');
        if (decision === 'reject' && note.length < DISPUTE.MIN_REJECT_NOTE_LENGTH) {
          throw unprocessable('note_required', 'Add a note explaining why it was rejected.');
        }

        const recalculation = decision === 'approve' ? await approve(orgId, adminId, dispute) : null;
        const now = clock.now();
        const status = decision === 'approve' ? 'approved' : 'rejected';
        const updated = await store.disputes.update(orgId, disputeId, {
          status,
          updatedAt: now,
          decidedAt: now,
          decidedBy: adminId,
          decisionNote: note,
        });
        await audit.record({
          id: `au-${disputeId}-decision`,
          orgId,
          workerId: dispute.workerId,
          actorRole: 'admin',
          actorId: adminId,
          action: decision === 'approve' ? 'dispute_approved' : 'dispute_rejected',
          disputeId,
          shiftId: dispute.shiftId,
          note,
          details: recalculation,
        });
        return { dispute: await present(updated), recalculation };
      });
    },
  };
}
