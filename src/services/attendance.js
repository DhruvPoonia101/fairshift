import {
  MS_PER_MINUTE,
  REGULAR_SHIFT_MINUTES,
  STALE_SHIFT_MINUTES,
} from '../config/constants.js';
import { getSector } from '../config/sectors.js';
import { conflict, unprocessable } from '../lib/errors.js';
import { distanceMeters } from '../lib/geo.js';
import { newId } from '../lib/random.js';
import { addDays, dayKey, dayRange, dayStartMs } from '../lib/time.js';
import { FATIGUE_LOOKBACK_DAYS, evaluateFatigue, fatigueLevel, resolveFatigueRules } from './fatigue.js';

/**
 * Splits one shift into regular (first 8 hours) and overtime minutes.
 * Works across midnight because it only uses the elapsed time.
 * @param {number} checkInMs
 * @param {number} checkOutMs
 */
export function computeShiftMinutes(checkInMs, checkOutMs, regularLimit = REGULAR_SHIFT_MINUTES) {
  const totalMinutes = Math.max(0, Math.floor((checkOutMs - checkInMs) / MS_PER_MINUTE));
  const regularMinutes = Math.min(totalMinutes, regularLimit);
  return { totalMinutes, regularMinutes, overtimeMinutes: totalMinutes - regularMinutes };
}

/**
 * Totals per IST day. A shift belongs to the day it started; an open shift counts up to `nowMs`.
 * @returns {Map<string, {totalMinutes: number, regularMinutes: number, overtimeMinutes: number, open: boolean}>}
 */
export function summariseByDay(shifts, nowMs) {
  const days = new Map();
  for (const shift of shifts) {
    const split = computeShiftMinutes(shift.checkIn, shift.checkOut ?? nowMs);
    const key = dayKey(shift.checkIn);
    const day = days.get(key) ?? { totalMinutes: 0, regularMinutes: 0, overtimeMinutes: 0, open: false };
    day.totalMinutes += split.totalMinutes;
    day.regularMinutes += split.regularMinutes;
    day.overtimeMinutes += split.overtimeMinutes;
    day.open ||= shift.checkOut === null;
    days.set(key, day);
  }
  return days;
}

const isStale = (shift, nowMs) => nowMs - shift.checkIn >= STALE_SHIFT_MINUTES * MS_PER_MINUTE;

/**
 * @param {object} deps
 * @param {object} deps.store
 * @param {{ now: () => number }} deps.clock
 * @param {ReturnType<import('./qr.js').createSiteCredentials>} deps.credentials
 * @param {ReturnType<import('./audit.js').createAuditService>} [deps.audit] records automatic changes to a record
 * @param {boolean} [deps.skipButtonGeofence] demo mode: the "I'm at work" button ignores the distance check
 */
export function createAttendanceService({ store, clock, credentials, audit, skipButtonGeofence = false }) {
  async function findOpenShift(worker) {
    const open = await store.shifts.query(worker.orgId, {
      where: { workerId: worker.id, checkOut: null },
    });
    return open[0] ?? null;
  }

  async function resolveSite(worker, { method, token, code }) {
    const sites = await store.sites.query(worker.orgId);
    let site = null;
    if (method === 'qr') site = credentials.verifyToken(token, sites);
    else if (method === 'code') site = credentials.findSiteByCode(sites, code);
    else site = sites.find((s) => s.id === worker.siteId) ?? null;
    if (!site) throw unprocessable('invalid_code', 'That code is not valid today.');
    return site;
  }

  async function checkGeofence(worker, site, { method, lat, lng }) {
    if (lat === undefined || lng === undefined) return false;
    if (method === 'button' && skipButtonGeofence) return false;
    const org = await store.orgs.get(worker.orgId, worker.orgId);
    const radius = getSector(org.sector).geofenceRadiusMeters;
    if (distanceMeters({ lat, lng }, site) > radius) {
      throw unprocessable('outside_geofence', 'You seem to be away from the workplace.');
    }
    return true;
  }

  async function shiftsSince(worker, fromMs) {
    return store.shifts.query(worker.orgId, {
      where: { workerId: worker.id },
      gte: { field: 'checkIn', value: fromMs },
    });
  }

  return {
    /**
     * Starts a shift. `method` says how presence was proved: scanned QR, typed daily code, or button.
     * A forgotten open shift older than 18 h is closed automatically so it cannot inflate hours.
     */
    async checkIn(worker, input) {
      const now = clock.now();
      const site = await resolveSite(worker, input);
      const geoVerified = await checkGeofence(worker, site, input);
      const open = await findOpenShift(worker);
      if (open && !isStale(open, now)) {
        throw conflict('already_checked_in', 'You are already checked in.');
      }
      if (open) {
        const checkOut = open.checkIn + REGULAR_SHIFT_MINUTES * MS_PER_MINUTE;
        await store.shifts.update(worker.orgId, open.id, { checkOut, autoClosed: true });
        await audit?.record({
          orgId: worker.orgId,
          workerId: worker.id,
          actorRole: 'system',
          actorId: 'system',
          action: 'shift_auto_closed',
          shiftId: open.id,
          before: { checkIn: open.checkIn, checkOut: null, siteId: open.siteId },
          after: { checkIn: open.checkIn, checkOut, siteId: open.siteId },
        });
      }
      return store.shifts.insert({
        id: newId('sh'),
        orgId: worker.orgId,
        workerId: worker.id,
        siteId: site.id,
        checkIn: now,
        checkOut: null,
        method: input.method,
        geoVerified,
      });
    },

    async checkOut(worker) {
      const open = await findOpenShift(worker);
      if (!open) throw conflict('not_checked_in', 'You have not checked in.');
      return store.shifts.update(worker.orgId, open.id, { checkOut: clock.now() });
    },

    /** Today's status for the worker home screen. */
    async today(worker) {
      const now = clock.now();
      const todayKey = dayKey(now);
      const recent = await shiftsSince(worker, dayStartMs(addDays(todayKey, -1)));
      const open = recent.find((s) => s.checkOut === null && !isStale(s, now)) ?? null;
      const todays = recent.filter((s) => dayKey(s.checkIn) === todayKey || s === open);
      let status = 'not_started';
      if (open) status = 'working';
      else if (todays.length > 0) status = 'done';
      let totalMinutes = 0;
      let overtimeMinutes = 0;
      for (const day of summariseByDay(todays, now).values()) {
        totalMinutes += day.totalMinutes;
        overtimeMinutes += day.overtimeMinutes;
      }
      return { status, since: open?.checkIn ?? null, totalMinutes, overtimeMinutes };
    },

    /** The worker's own gentle rest notice: fatigue level plus the rules behind it. */
    async restStatus(worker) {
      const now = clock.now();
      const shifts = await shiftsSince(worker, dayStartMs(addDays(dayKey(now), -FATIGUE_LOOKBACK_DAYS)));
      const org = await store.orgs.get(worker.orgId, worker.orgId);
      const flags = evaluateFatigue(shifts, now, resolveFatigueRules(getSector(org.sector).fatigue));
      return { level: fatigueLevel(flags), flags };
    },

    /** Last `count` days, newest first, including today. */
    async recentDays(worker, count) {
      const now = clock.now();
      const todayKey = dayKey(now);
      const first = addDays(todayKey, -(count - 1));
      const shifts = await shiftsSince(worker, dayStartMs(first));
      const byDay = summariseByDay(shifts, now);
      return dayRange(first, todayKey)
        .reverse()
        .map((date) => ({
          date,
          totalMinutes: byDay.get(date)?.totalMinutes ?? 0,
          overtimeMinutes: byDay.get(date)?.overtimeMinutes ?? 0,
        }));
    },

    /** Today's credentials for every site of the org (admin screen). */
    async siteCredentials(orgId) {
      const sites = await store.sites.query(orgId);
      return sites.map((site) => ({
        id: site.id,
        name: site.name,
        code: credentials.dailyCode(site),
        validDay: dayKey(clock.now()),
      }));
    },

    async renderSiteQr(orgId, siteId) {
      const site = await store.sites.get(orgId, siteId);
      if (!site) return null;
      return credentials.renderSvg(credentials.issueToken(site));
    },
  };
}
