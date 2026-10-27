import { PASSPORT_EXPIRY_WARNING_DAYS } from '../config/constants.js';
import { notFound, unprocessable } from '../lib/errors.js';
import { newId, randomToken } from '../lib/random.js';
import { dayKey, daysBetween } from '../lib/time.js';

/**
 * 'none' (never expires), 'valid', 'expiring' (within 30 days) or 'expired'.
 * @param {{expiresOn: string | null}} entry
 * @param {string} todayKey
 */
export function expiryStatus(entry, todayKey) {
  if (!entry.expiresOn) return 'none';
  if (entry.expiresOn < todayKey) return 'expired';
  return daysBetween(todayKey, entry.expiresOn) <= PASSPORT_EXPIRY_WARNING_DAYS ? 'expiring' : 'valid';
}

const present = (entry, todayKey) => ({
  id: entry.id,
  workerId: entry.workerId,
  type: entry.type,
  title: entry.title,
  issuer: entry.issuer,
  issuedOn: entry.issuedOn,
  expiresOn: entry.expiresOn,
  verified: entry.verified,
  expiry: expiryStatus(entry, todayKey),
});

/** @param {{ store: object, clock: { now: () => number } }} deps */
export function createPassportService({ store, clock }) {
  const today = () => dayKey(clock.now());

  return {
    async list(orgId, workerId) {
      const entries = await store.passportEntries.query(orgId, { where: { workerId } });
      return entries.sort((a, b) => b.issuedOn.localeCompare(a.issuedOn)).map((e) => present(e, today()));
    },

    /** Adds an entry. Worker-added entries start unverified; employer-added ones are verified. */
    async add(orgId, workerId, input, { verifiedBy = null } = {}) {
      if (input.expiresOn && input.expiresOn < input.issuedOn) {
        throw unprocessable('invalid_dates', 'Expiry must be after the issue date.');
      }
      if (input.issuedOn > today()) throw unprocessable('invalid_dates', 'Issue date is in the future.');
      const entry = {
        id: newId('pp'),
        orgId,
        workerId,
        ...input,
        expiresOn: input.expiresOn ?? null,
        verified: verifiedBy !== null,
        verifiedBy,
      };
      await store.passportEntries.insert(entry);
      return present(entry, today());
    },

    async verify(orgId, entryId, adminId) {
      const updated = await store.passportEntries.update(orgId, entryId, {
        verified: true,
        verifiedBy: adminId,
      });
      if (!updated) throw notFound('Entry not found.');
      return present(updated, today());
    },

    /** Entries expired or expiring soon, with the worker's name, for the employer. */
    async attention(orgId) {
      const [entries, workers] = await Promise.all([
        store.passportEntries.query(orgId),
        store.workers.query(orgId),
      ]);
      const names = new Map(workers.map((w) => [w.id, w.name]));
      return entries
        .map((e) => ({ ...present(e, today()), workerName: names.get(e.workerId) ?? '' }))
        .filter((e) => e.expiry === 'expiring' || e.expiry === 'expired')
        .sort((a, b) => a.expiresOn.localeCompare(b.expiresOn));
    },

    /** Every entry in the org with worker names, for the employer's verify screen. */
    async listForOrg(orgId) {
      const [entries, workers] = await Promise.all([
        store.passportEntries.query(orgId),
        store.workers.query(orgId),
      ]);
      const names = new Map(workers.map((w) => [w.id, w.name]));
      return entries
        .map((e) => ({ ...present(e, today()), workerName: names.get(e.workerId) ?? '' }))
        .sort((a, b) => Number(a.verified) - Number(b.verified) || a.workerName.localeCompare(b.workerName));
    },

    /** Creates (or returns) the worker's public share token. */
    async enableSharing(orgId, workerId) {
      const worker = await store.workers.get(orgId, workerId);
      if (worker.passportToken) return worker.passportToken;
      const token = randomToken();
      await store.workers.update(orgId, workerId, { passportToken: token });
      return token;
    },

    async disableSharing(orgId, workerId) {
      await store.workers.update(orgId, workerId, { passportToken: null });
    },

    /** Read-only public view: name, role, employer, skills and verified status. Nothing else. */
    async publicView(token) {
      const worker = await store.workers.findBy('passportToken', token);
      if (!worker) throw notFound('This link is not active.');
      const [org, entries] = await Promise.all([
        store.orgs.get(worker.orgId, worker.orgId),
        store.passportEntries.query(worker.orgId, { where: { workerId: worker.id } }),
      ]);
      return {
        name: worker.name,
        role: worker.role,
        sector: org.sector,
        employer: org.name,
        entries: entries
          .sort((a, b) => b.issuedOn.localeCompare(a.issuedOn))
          .map((e) => present(e, today()))
          .map(({ workerId, id, ...publicFields }) => publicFields),
        generatedOn: today(),
      };
    },
  };
}
