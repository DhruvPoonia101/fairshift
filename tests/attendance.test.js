import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixedClock } from '../src/lib/time.js';
import { computeShiftMinutes, createAttendanceService, summariseByDay } from '../src/services/attendance.js';
import { createSiteCredentials } from '../src/services/qr.js';
import { createMemoryStore } from '../src/store/memory.js';
import { istMs, randomSecret } from './helpers.js';

const HOUR = 60 * 60_000;

test('first 8 hours are regular and the rest is overtime', () => {
  const start = istMs('2026-10-26', '09:00');
  assert.deepEqual(computeShiftMinutes(start, start + 480 * 60_000), {
    totalMinutes: 480,
    regularMinutes: 480,
    overtimeMinutes: 0,
  });
  assert.deepEqual(computeShiftMinutes(start, start + 570 * 60_000), {
    totalMinutes: 570,
    regularMinutes: 480,
    overtimeMinutes: 90,
  });
});

test('a night shift that crosses midnight is one shift with correct hours', () => {
  const split = computeShiftMinutes(istMs('2026-10-26', '22:00'), istMs('2026-10-27', '06:30'));
  assert.deepEqual(split, { totalMinutes: 510, regularMinutes: 480, overtimeMinutes: 30 });
});

test('a shift belongs to the IST day it started, and an open shift counts up to now', () => {
  const night = { checkIn: istMs('2026-10-26', '22:00'), checkOut: istMs('2026-10-27', '06:00') };
  const open = { checkIn: istMs('2026-10-27', '09:00'), checkOut: null };
  const days = summariseByDay([night, open], istMs('2026-10-27', '11:30'));
  assert.equal(days.get('2026-10-26').totalMinutes, 480);
  assert.equal(days.get('2026-10-27').totalMinutes, 150);
  assert.equal(days.get('2026-10-27').open, true);
});

test('a negative or zero-length shift never produces negative minutes', () => {
  const t = istMs('2026-10-27', '09:00');
  assert.equal(computeShiftMinutes(t, t - 1000).totalMinutes, 0);
});

async function setup({ skipButtonGeofence = false } = {}) {
  const clock = fixedClock(istMs('2026-10-27', '09:00'));
  const store = createMemoryStore();
  const orgId = 'org-construction';
  await store.orgs.insert({ id: orgId, orgId, name: 'Test Org', sector: 'construction' });
  const site = { id: 'site-a', orgId, name: 'A', lat: 12.9716, lng: 80.2209 };
  await store.sites.insert(site);
  const worker = { id: 'w-1', orgId, name: 'W', role: 'mason', siteId: site.id };
  await store.workers.insert(worker);
  const credentials = createSiteCredentials({ secret: randomSecret(), clock });
  return { clock, store, site, worker, credentials, service: createAttendanceService({ store, clock, credentials, skipButtonGeofence }) };
}

test('check-in by QR, then check-out, records one finished shift', async () => {
  const { service, worker, site, credentials, clock } = await setup();
  await service.checkIn(worker, { method: 'qr', token: credentials.issueToken(site) });
  clock.advance(9 * HOUR);
  const closed = await service.checkOut(worker);
  assert.equal(closed.checkOut - closed.checkIn, 9 * HOUR);
  assert.equal((await service.today(worker)).overtimeMinutes, 60);
});

test('check-in by typed code works and a wrong code is rejected', async () => {
  const { service, worker, site, credentials } = await setup();
  await assert.rejects(service.checkIn(worker, { method: 'code', code: '000000' }), { code: 'invalid_code' });
  await service.checkIn(worker, { method: 'code', code: credentials.dailyCode(site) });
});

test('a QR token from yesterday is rejected today', async () => {
  const { service, worker, site, credentials, clock } = await setup();
  const token = credentials.issueToken(site);
  clock.advance(24 * HOUR);
  await assert.rejects(service.checkIn(worker, { method: 'qr', token }), { code: 'invalid_code' });
});

test('checking in twice, or out without checking in, is a conflict', async () => {
  const { service, worker } = await setup();
  await assert.rejects(service.checkOut(worker), { code: 'not_checked_in' });
  await service.checkIn(worker, { method: 'button' });
  await assert.rejects(service.checkIn(worker, { method: 'button' }), { code: 'already_checked_in' });
});

test('geofence rejects a check-in from far away and accepts one on site', async () => {
  const { service, worker, site } = await setup();
  await assert.rejects(service.checkIn(worker, { method: 'button', lat: site.lat + 0.1, lng: site.lng }), {
    code: 'outside_geofence',
  });
  const shift = await service.checkIn(worker, { method: 'button', lat: site.lat, lng: site.lng });
  assert.equal(shift.geoVerified, true);
});

test('a forgotten shift older than 18 hours is closed automatically on the next check-in', async () => {
  const { service, worker, store, clock } = await setup();
  const first = await service.checkIn(worker, { method: 'button' });
  clock.advance(20 * HOUR);
  await service.checkIn(worker, { method: 'button' });
  const old = await store.shifts.get(worker.orgId, first.id);
  assert.equal(old.autoClosed, true);
  assert.equal(old.checkOut - old.checkIn, 480 * 60_000);
});

test('demo mode skips the geofence for the button, but not for a scanned or typed code', async () => {
  const { service, worker, site, credentials } = await setup({ skipButtonGeofence: true });
  const far = { lat: site.lat + 0.1, lng: site.lng };
  const shift = await service.checkIn(worker, { method: 'button', ...far });
  assert.equal(shift.geoVerified, false);
  await service.checkOut(worker);
  await assert.rejects(service.checkIn(worker, { method: 'code', code: credentials.dailyCode(site), ...far }), {
    code: 'outside_geofence',
  });
});

test('with demo mode off the button geofence is enforced, and no location is still allowed', async () => {
  const { service, worker, site } = await setup({ skipButtonGeofence: false });
  await assert.rejects(service.checkIn(worker, { method: 'button', lat: site.lat + 0.1, lng: site.lng }), {
    code: 'outside_geofence',
  });
  const shift = await service.checkIn(worker, { method: 'button' });
  assert.equal(shift.geoVerified, false);
});
