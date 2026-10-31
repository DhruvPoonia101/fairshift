import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import jwt from 'jsonwebtoken';
import { ANON_CODE_ALPHABET, ANON_CODE_LENGTH, OFFLINE } from '../src/config/constants.js';
import { resolveCapture } from '../src/lib/capture.js';
import { addDays, dayKey } from '../src/lib/time.js';
import { createSiteCredentials } from '../src/services/qr.js';
import { CODE_ALPHABET, CODE_LENGTH } from '../public/shared/tracking-code.js';
import { NOW, startApp } from './helpers.js';

const ORG = 'org-construction';
const HOUR = 60 * 60_000;
let seq = 0;

const keyOf = (label) => `${label}-${String(++seq).padStart(6, '0')}-abcdefghijklmnop`; // 22+ URL-safe characters
const post = (app, path, { cookie, body = {}, key, headers = {} } = {}) =>
  app.request(`/api${path}`, { method: 'POST', cookie, body, headers: { ...(key ? { 'idempotency-key': key } : {}), ...headers } });

/** A worker with no shifts of their own, so each test controls exactly what exists. */
async function addWorker(app, extra = {}) {
  seq += 1;
  const worker = { id: `w-off-${seq}`, orgId: ORG, name: `Offline Worker ${seq}`, role: 'mason', dailyWagePaise: 90_000, siteId: 'site-con-1', shiftId: 'day', isDemo: false, passportToken: null, joinedOn: '2020-01-01', ...extra };
  await app.store.workers.insert(worker);
  const token = jwt.sign({ role: 'worker', org: ORG }, app.env.sessionSecret, { algorithm: 'HS256', subject: worker.id, expiresIn: '1h' });
  return { worker, cookie: `fs_worker=${token}` };
}

/** A random-looking 16-symbol code, like the phone makes. */
const makeCode = (offset = 0) => Array.from({ length: ANON_CODE_LENGTH }, (_, i) => ANON_CODE_ALPHABET[(i * 7 + offset * 3 + 5) % ANON_CODE_ALPHABET.length]).join('');

describe('what to believe about a time the phone claims (resolveCapture)', () => {
  const now = NOW;

  test('no capture time: an ordinary online request, not marked offline', () => {
    assert.deepEqual(resolveCapture(undefined, now), { capturedAt: now, receivedAt: now, recordedOffline: false });
  });

  test('a time in the past is kept, and the record is marked "recorded offline"', () => {
    assert.deepEqual(resolveCapture(now - 3 * HOUR, now), { capturedAt: now - 3 * HOUR, receivedAt: now, recordedOffline: true });
  });

  test('a time in the future is refused, but a little clock skew is read as "now"', () => {
    assert.throws(() => resolveCapture(now + OFFLINE.CLOCK_SKEW_TOLERANCE_MS + 1, now), { code: 'captured_in_future', status: 422 });
    assert.throws(() => resolveCapture(now + HOUR, now), { code: 'captured_in_future' });
    assert.equal(resolveCapture(now + 30_000, now).capturedAt, now, 'clamped to now, never later than we received it');
  });

  test('older than 48 hours is refused; exactly 48 hours is still accepted', () => {
    assert.throws(() => resolveCapture(now - OFFLINE.MAX_CAPTURE_AGE_MS - 1, now), { code: 'captured_too_old', status: 422 });
    assert.equal(resolveCapture(now - OFFLINE.MAX_CAPTURE_AGE_MS, now).recordedOffline, true);
  });

  test('the phone-side alphabet and length equal the server-side ones', () => {
    assert.equal(CODE_ALPHABET, ANON_CODE_ALPHABET);
    assert.equal(CODE_LENGTH, ANON_CODE_LENGTH);
    assert.ok(Math.log2(ANON_CODE_ALPHABET.length) * ANON_CODE_LENGTH >= 80, 'at least 80 bits');
  });
});

describe('offline check-in: idempotency, capture time, QR verified on sync', () => {
  let app;
  let credentials;
  before(async () => {
    app = await startApp();
    credentials = createSiteCredentials({ secret: app.env.sessionSecret, clock: app.clock });
  });
  after(() => app.close());

  const site = { id: 'site-con-1', orgId: ORG };
  const qrFor = (atMs) => credentials.issueToken(site, atMs);

  test('the same Idempotency-Key twice creates one shift and gets the first answer back', async () => {
    const { cookie } = await addWorker(app);
    const key = keyOf('ci');
    const first = await post(app, '/attendance/check-in', { cookie, key, body: { method: 'button' } });
    const second = await post(app, '/attendance/check-in', { cookie, key, body: { method: 'button' } });
    assert.equal(first.status, 201);
    assert.equal(second.status, 201, 'the retry is answered with the original result, not a 409');
    assert.equal(second.headers.get('idempotent-replayed'), 'true');
    assert.equal(first.headers.get('idempotent-replayed'), null);
    assert.deepEqual(second.json, first.json);
  });

  test('without a key the same request is a real second attempt (409 already checked in)', async () => {
    const { cookie } = await addWorker(app);
    assert.equal((await post(app, '/attendance/check-in', { cookie, body: { method: 'button' } })).status, 201);
    const again = await post(app, '/attendance/check-in', { cookie, body: { method: 'button' } });
    assert.equal(again.status, 409);
    assert.equal(again.json.error.code, 'already_checked_in');
  });

  test('a retry that adds capturedAt (the first answer was lost) still gets the stored result', async () => {
    const { cookie, worker } = await addWorker(app);
    const key = keyOf('lost');
    const first = await post(app, '/attendance/check-in', { cookie, key, body: { method: 'button' } });
    const retry = await post(app, '/attendance/check-in', { cookie, key, body: { method: 'button', capturedAt: app.clock.now() - 60_000 } });
    assert.equal(retry.status, 201);
    assert.equal(retry.headers.get('idempotent-replayed'), 'true');
    assert.equal(retry.json.id, first.json.id);
    assert.equal((await app.store.shifts.query(ORG, { where: { workerId: worker.id } })).length, 1);
  });

  test('the same key with a different meaning is refused (409 idempotency_key_reused)', async () => {
    const { cookie } = await addWorker(app);
    const key = keyOf('mix');
    await post(app, '/attendance/check-in', { cookie, key, body: { method: 'button' } });
    const other = await post(app, '/attendance/check-in', { cookie, key, body: { method: 'code', code: '123456' } });
    assert.equal(other.status, 409);
    assert.equal(other.json.error.code, 'idempotency_key_reused');
  });

  test('five parallel retries of one key still make exactly one shift', async () => {
    const { cookie, worker } = await addWorker(app);
    const key = keyOf('race');
    const results = await Promise.all(Array.from({ length: 5 }, () => post(app, '/attendance/check-in', { cookie, key, body: { method: 'button' } })));
    assert.ok(results.every((r) => r.status === 201));
    assert.equal(new Set(results.map((r) => r.json.id)).size, 1);
    assert.equal((await app.store.shifts.query(ORG, { where: { workerId: worker.id } })).length, 1);
  });

  test('the key is per worker: another worker can use the same key value', async () => {
    const a = await addWorker(app);
    const b = await addWorker(app);
    const key = keyOf('shared');
    assert.equal((await post(app, '/attendance/check-in', { cookie: a.cookie, key, body: { method: 'button' } })).status, 201);
    const other = await post(app, '/attendance/check-in', { cookie: b.cookie, key, body: { method: 'button' } });
    assert.equal(other.status, 201);
    assert.notEqual(other.headers.get('idempotent-replayed'), 'true');
  });

  test('a key of the wrong shape is a 400', async () => {
    const { cookie } = await addWorker(app);
    const res = await post(app, '/attendance/check-in', { cookie, key: 'short', body: { method: 'button' } });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, 'invalid_idempotency_key');
  });

  test('an offline check-in starts the shift when the worker checked in, and records both times', async () => {
    const { cookie, worker } = await addWorker(app);
    const capturedAt = app.clock.now() - 2 * HOUR;
    const res = await post(app, '/attendance/check-in', { cookie, key: keyOf('off'), body: { method: 'button', capturedAt } });
    assert.equal(res.status, 201);
    assert.equal(res.json.checkIn, capturedAt);
    assert.equal(res.json.recordedOffline, true);
    const [shift] = await app.store.shifts.query(ORG, { where: { workerId: worker.id } });
    assert.equal(shift.checkIn, capturedAt);
    assert.equal(shift.capturedAt, capturedAt);
    assert.equal(shift.receivedAt, app.clock.now());
    assert.equal(shift.recordedOffline, true);
  });

  test('an ordinary online check-in is not marked offline', async () => {
    const { cookie } = await addWorker(app);
    const res = await post(app, '/attendance/check-in', { cookie, body: { method: 'button' } });
    assert.equal(res.json.recordedOffline, undefined);
  });

  test('a capture time in the future, or older than 48 hours, is refused', async () => {
    const { cookie } = await addWorker(app);
    const future = await post(app, '/attendance/check-in', { cookie, body: { method: 'button', capturedAt: app.clock.now() + HOUR } });
    assert.deepEqual([future.status, future.json.error.code], [422, 'captured_in_future']);
    const old = await post(app, '/attendance/check-in', { cookie, body: { method: 'button', capturedAt: app.clock.now() - 49 * HOUR } });
    assert.deepEqual([old.status, old.json.error.code], [422, 'captured_too_old']);
  });

  test('a QR scanned today is accepted when sent later the same day', async () => {
    const { cookie } = await addWorker(app);
    const res = await post(app, '/attendance/check-in', { cookie, key: keyOf('qr'), body: { method: 'qr', token: qrFor(app.clock.now()), capturedAt: app.clock.now() - HOUR } });
    assert.equal(res.status, 201);
  });

  test('a QR from another day is refused on sync with a clear reason (invalid_code)', async () => {
    const { cookie, worker } = await addWorker(app);
    const yesterday = app.clock.now() - 24 * HOUR;
    // Scanned yesterday but claimed as captured today: the QR is stale for the capture day.
    const stale = await post(app, '/attendance/check-in', { cookie, body: { method: 'qr', token: qrFor(yesterday), capturedAt: app.clock.now() - HOUR } });
    assert.deepEqual([stale.status, stale.json.error.code], [422, 'invalid_code']);
    const forged = await post(app, '/attendance/check-in', { cookie, body: { method: 'qr', token: `${site.id}.${dayKey(app.clock.now())}.AAAAAAAAAAAAAAAAAAAAAA`, capturedAt: app.clock.now() - HOUR } });
    assert.deepEqual([forged.status, forged.json.error.code], [422, 'invalid_code']);
    assert.equal((await app.store.shifts.query(ORG, { where: { workerId: worker.id } })).length, 0, 'nothing was recorded');
  });

  test('a QR scanned last night is still good when it is sent the next morning (checked against the day it was scanned)', async () => {
    const { cookie } = await addWorker(app);
    const lastNight = app.clock.now() - 20 * HOUR; // yesterday evening
    assert.notEqual(dayKey(lastNight), dayKey(app.clock.now()));
    const res = await post(app, '/attendance/check-in', { cookie, body: { method: 'qr', token: qrFor(lastNight), capturedAt: lastNight } });
    assert.equal(res.status, 201);
    assert.equal(res.json.recordedOffline, true);
  });

  test('a late check-in cannot land inside a shift that was recorded in the meantime', async () => {
    const { cookie } = await addWorker(app);
    const first = await post(app, '/attendance/check-in', { cookie, body: { method: 'button', capturedAt: app.clock.now() - 5 * HOUR } });
    assert.equal(first.status, 201);
    const clash = await post(app, '/attendance/check-in', { cookie, body: { method: 'button', capturedAt: app.clock.now() - 3 * HOUR } });
    assert.equal(clash.status, 409);
  });

  test('an offline check-out ends the shift when the worker left; before the check-in is refused', async () => {
    const { cookie } = await addWorker(app);
    const inAt = app.clock.now() - 6 * HOUR;
    await post(app, '/attendance/check-in', { cookie, body: { method: 'button', capturedAt: inAt } });
    const early = await post(app, '/attendance/check-out', { cookie, body: { capturedAt: inAt - HOUR } });
    assert.deepEqual([early.status, early.json.error.code], [422, 'check_out_before_check_in']);
    const outAt = app.clock.now() - HOUR;
    const key = keyOf('out');
    const out = await post(app, '/attendance/check-out', { cookie, key, body: { capturedAt: outAt } });
    assert.equal(out.status, 200);
    assert.equal(out.json.checkOut, outAt);
    const again = await post(app, '/attendance/check-out', { cookie, key, body: { capturedAt: outAt } });
    assert.equal(again.status, 200, 'a retry of the same check-out is answered, not a 409');
    assert.equal(again.headers.get('idempotent-replayed'), 'true');
  });

  test('a queued action made by someone else on this phone is not filed under the signed-in worker (409 wrong_account)', async () => {
    const { cookie } = await addWorker(app);
    const res = await post(app, '/attendance/check-in', { cookie, body: { method: 'button' }, headers: { 'x-fairshift-owner': 'w-someone-else' } });
    assert.deepEqual([res.status, res.json.error.code], [409, 'wrong_account']);
  });
});

describe('offline attendance disputes and named reports', () => {
  let app;
  let admin;
  before(async () => {
    app = await startApp();
    admin = await app.login('admin-construction');
  });
  after(() => app.close());

  async function workerWithShift(daysAgo = 1) {
    const w = await addWorker(app);
    const day = addDays(dayKey(app.clock.now()), -daysAgo);
    const checkIn = Date.parse(`${day}T08:00:00+05:30`);
    const shift = { id: `sh-off-${++seq}`, orgId: ORG, workerId: w.worker.id, siteId: 'site-con-1', checkIn, checkOut: checkIn + 8 * HOUR, method: 'qr', geoVerified: false };
    await app.store.shifts.insert(shift);
    return { ...w, shift };
  }

  test('a dispute sent twice with one key is one dispute; the employer sees "recorded offline"', async () => {
    const { cookie, shift } = await workerWithShift();
    const key = keyOf('dp');
    const body = { shiftId: shift.id, category: 'wrong_time', checkOutAt: shift.checkOut + HOUR, note: 'I left later', capturedAt: app.clock.now() - 2 * HOUR };
    const first = await post(app, '/disputes', { cookie, key, body });
    const second = await post(app, '/disputes', { cookie, key, body });
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    assert.equal(second.headers.get('idempotent-replayed'), 'true');
    assert.equal(second.json.id, first.json.id);
    assert.equal((await app.store.disputes.query(ORG, { where: { shiftId: shift.id } })).length, 1);
    assert.equal(first.json.recordedOffline, true);
    assert.equal(first.json.capturedAt, body.capturedAt);
    assert.equal(first.json.receivedAt, app.clock.now());

    const list = await app.request('/api/admin/disputes', { cookie: admin.cookie });
    assert.equal(list.json.items.find((d) => d.id === first.json.id).recordedOffline, true);
  });

  test('a dispute with no capture time is not marked offline', async () => {
    const { cookie, shift } = await workerWithShift();
    const res = await post(app, '/disputes', { cookie, body: { shiftId: shift.id, category: 'other', note: 'please check' } });
    assert.equal(res.status, 201);
    assert.equal(res.json.recordedOffline, undefined);
  });

  test('a dispute capture time in the future or older than 48 hours is refused', async () => {
    const { cookie, shift } = await workerWithShift();
    const base = { shiftId: shift.id, category: 'other', note: 'x1' };
    const future = await post(app, '/disputes', { cookie, body: { ...base, capturedAt: app.clock.now() + HOUR } });
    assert.deepEqual([future.status, future.json.error.code], [422, 'captured_in_future']);
    const old = await post(app, '/disputes', { cookie, body: { ...base, capturedAt: app.clock.now() - 72 * HOUR } });
    assert.deepEqual([old.status, old.json.error.code], [422, 'captured_too_old']);
  });

  test('the dispute window is judged on the day the worker filed it, not the day it was sent', async () => {
    // The record is exactly at the edge of the 14-day window on the day it was filed (13 days before "now" minus 1 day).
    const { cookie, shift } = await workerWithShift(14);
    const late = await post(app, '/disputes', { cookie, body: { shiftId: shift.id, category: 'other', note: 'late' } });
    assert.equal(late.status, 201, 'on the edge of the window today');
    const w2 = await workerWithShift(15);
    const outside = await post(app, '/disputes', { cookie: w2.cookie, body: { shiftId: w2.shift.id, category: 'other', note: 'out' } });
    assert.equal(outside.json.error.code, 'outside_dispute_window');
    const filedYesterday = await post(app, '/disputes', { cookie: w2.cookie, body: { shiftId: w2.shift.id, category: 'other', note: 'out', capturedAt: app.clock.now() - 20 * HOUR } });
    assert.equal(filedYesterday.status, 201, 'filed one day earlier, inside the window that day');
  });

  test('a named report sent twice with one key is one report, marked offline for the employer', async () => {
    const { cookie, worker } = await addWorker(app);
    const key = keyOf('gr');
    const body = { category: 'pay', text: 'My overtime was not paid', capturedAt: app.clock.now() - 3 * HOUR };
    const first = await post(app, '/grievances', { cookie, key, body });
    const second = await post(app, '/grievances', { cookie, key, body });
    assert.equal(first.status, 201);
    assert.equal(second.headers.get('idempotent-replayed'), 'true');
    assert.equal(second.json.grievance.id, first.json.grievance.id);
    const mine = await app.store.grievances.query(ORG, { where: { workerId: worker.id } });
    assert.equal(mine.length, 1);
    assert.equal(mine[0].createdAt, body.capturedAt);
    assert.equal(mine[0].receivedAt, app.clock.now());
    const list = await app.request('/api/admin/grievances', { cookie: admin.cookie });
    assert.equal(list.json.items.find((g) => g.id === first.json.grievance.id).recordedOffline, true);
  });

  test('without a key, two identical reports are two reports (idempotency only applies when asked for)', async () => {
    const { cookie, worker } = await addWorker(app);
    const body = { category: 'pay', text: 'Same words twice' };
    await post(app, '/grievances', { cookie, body });
    await post(app, '/grievances', { cookie, body });
    assert.equal((await app.store.grievances.query(ORG, { where: { workerId: worker.id } })).length, 2);
  });
});

describe('anonymous items carry and store no identity', () => {
  let app;
  let admin;
  before(async () => {
    app = await startApp();
    admin = await app.login('admin-construction');
  });
  after(() => app.close());

  const tokenFor = async (cookie) => (await app.request('/api/anonymous/token', { cookie })).json;
  const anon = (path, { token, body, key, cookie } = {}) =>
    post(app, path, { cookie, key, body, headers: token ? { authorization: `Bearer ${token}` } : {} });

  test('the token needs a signed-in worker, says only "a worker of this org" and is the same for every worker', async () => {
    const a = await addWorker(app);
    const b = await addWorker(app);
    assert.equal((await app.request('/api/anonymous/token')).status, 401);
    const first = await tokenFor(a.cookie);
    const second = await tokenFor(b.cookie);
    assert.equal(first.token, second.token, 'two workers get the same token, so a token cannot be traced to one of them');
    const claims = jwt.decode(first.token);
    assert.equal(claims.sub, undefined, 'no subject');
    assert.deepEqual(Object.keys(claims).sort(), ['exp', 'iat', 'org', 'purpose']);
    assert.equal(claims.org, ORG);
    assert.equal(claims.iat % OFFLINE.ANON_TOKEN_BUCKET_SECONDS, 0, 'issued time is rounded to the hour');
    assert.equal(first.expiresAt, claims.exp * 1000);
  });

  test('anonymous endpoints refuse a session cookie, a missing token, a forged token and a session token', async () => {
    const { cookie } = await addWorker(app);
    const body = { category: 'pay', text: 'No name here', trackingCode: makeCode(1) };
    assert.equal((await anon('/anonymous/grievances', { cookie, body })).status, 401, 'a cookie alone is not enough');
    assert.equal((await anon('/anonymous/grievances', { body })).status, 401);
    assert.equal((await anon('/anonymous/grievances', { token: 'a.b.c', body })).status, 401);
    const sessionJwt = cookie.split('=')[1];
    assert.equal((await anon('/anonymous/grievances', { token: sessionJwt, body })).status, 401, 'a session token is not an anonymous token');
    const wrongSecret = jwt.sign({ purpose: 'anon_submit', org: ORG }, 'not-the-secret', { algorithm: 'HS256' });
    assert.equal((await anon('/anonymous/feedback', { token: wrongSecret, body: { subject: 'manager', rating: 4 } })).status, 401);
  });

  test('an expired token is a 401 (the worker is asked to sign in again; the item is kept)', async () => {
    const { cookie } = await addWorker(app);
    const { token } = await tokenFor(cookie);
    app.clock.advance((OFFLINE.ANON_TOKEN_TTL_SECONDS + 10) * 1000);
    try {
      const res = await anon('/anonymous/feedback', { token, body: { subject: 'manager', rating: 4 } });
      assert.equal(res.status, 401);
    } finally {
      app.clock.advance(-(OFFLINE.ANON_TOKEN_TTL_SECONDS + 10) * 1000);
    }
  });

  test('an anonymous report stores no worker id, only the day, and its idempotency record holds no worker id either', async () => {
    const { cookie, worker } = await addWorker(app);
    const { token } = await tokenFor(cookie);
    const code = makeCode(2);
    const key = keyOf('anon');
    const body = { category: 'pay', text: 'Anonymous pay problem', trackingCode: code, capturedAt: app.clock.now() - 5 * HOUR };
    const res = await anon('/anonymous/grievances', { token, key, body });
    assert.equal(res.status, 201);
    assert.equal(res.json.trackingCode, undefined, 'the phone made the code; the server never sends one back');
    assert.equal(res.json.grievance.recordedOffline, true);

    const [record] = (await app.store.grievances.query(ORG)).filter((g) => g.id === res.json.grievance.id);
    assert.equal(record.workerId, undefined);
    assert.equal(record.capturedAt, undefined);
    assert.equal(record.receivedAt, undefined);
    assert.equal(dayKey(record.createdAt), dayKey(body.capturedAt), 'only the day it was made');
    assert.equal(record.createdAt, Date.parse(`${dayKey(body.capturedAt)}T00:00:00+05:30`), 'rounded down to the start of the day');
    const everything = JSON.stringify([record, await app.store.idempotency.query(ORG)]);
    assert.ok(!everything.includes(worker.id), 'no worker id anywhere in the stored record or idempotency data');
    assert.ok(!everything.includes(worker.name));

    const listed = (await app.request('/api/admin/grievances', { cookie: admin.cookie })).json.items.find((g) => g.id === record.id);
    assert.equal(listed.worker, null);
    assert.equal(listed.recordedOffline, true);
  });

  test('the code made on the phone works with the usual tracking lookup', async () => {
    const { cookie } = await addWorker(app);
    const { token } = await tokenFor(cookie);
    const code = makeCode(3);
    await anon('/anonymous/grievances', { token, key: keyOf('trk'), body: { category: 'pay', text: 'Track me please', trackingCode: code } });
    const grouped = `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8, 12)}-${code.slice(12)}`;
    const found = await post(app, '/grievances/track', { body: { code: grouped } });
    assert.equal(found.status, 200);
    assert.equal(found.json.status, 'open');
  });

  test('the server validates the code: wrong shape, wrong symbols and low-variety codes are refused', async () => {
    const { cookie } = await addWorker(app);
    const { token } = await tokenFor(cookie);
    const send = (trackingCode) => anon('/anonymous/grievances', { token, body: { category: 'pay', text: 'Check the code', trackingCode } });
    for (const bad of ['SHORT', `${makeCode(4)}A`, makeCode(4).toLowerCase(), `${makeCode(4).slice(0, 15)}0`, `${makeCode(4).slice(0, 15)}I`, 'A'.repeat(16), 'AB'.repeat(8)]) {
      const res = await send(bad);
      assert.ok([422].includes(res.status), `${bad}: ${res.status}`);
      assert.ok(['invalid_tracking_code', 'invalid_input'].includes(res.json.error.code), bad);
    }
  });

  test('a code that is already used is refused (409), but the same key retried gets the first answer', async () => {
    const { cookie } = await addWorker(app);
    const { token } = await tokenFor(cookie);
    const code = makeCode(5);
    const body = { category: 'pay', text: 'First report with this code', trackingCode: code };
    const key = keyOf('dup');
    const first = await anon('/anonymous/grievances', { token, key, body });
    const retry = await anon('/anonymous/grievances', { token, key, body });
    assert.equal(first.status, 201);
    assert.equal(retry.status, 201);
    assert.equal(retry.headers.get('idempotent-replayed'), 'true');
    const clash = await anon('/anonymous/grievances', { token, key: keyOf('dup2'), body: { ...body, text: 'A different report, same code' } });
    assert.deepEqual([clash.status, clash.json.error.code], [409, 'tracking_code_taken']);
    assert.equal((await app.store.grievances.query(ORG)).filter((g) => g.text === 'First report with this code').length, 1);
  });

  test('anonymous feedback: one entry per key, time checked, and not marked offline (that would shrink the crowd it hides in)', async () => {
    const { cookie } = await addWorker(app);
    const { token } = await tokenFor(cookie);
    const before = (await app.store.feedback.query(ORG)).length;
    const key = keyOf('fb');
    const body = { subject: 'manager', rating: 4, text: 'Fine', capturedAt: app.clock.now() - 4 * HOUR };
    const first = await anon('/anonymous/feedback', { token, key, body });
    const second = await anon('/anonymous/feedback', { token, key, body });
    assert.equal(first.status, 201);
    assert.equal(second.headers.get('idempotent-replayed'), 'true');
    const all = await app.store.feedback.query(ORG);
    assert.equal(all.length, before + 1);
    const entry = all.at(-1);
    assert.deepEqual(Object.keys(entry).sort(), ['day', 'id', 'orgId', 'rating', 'subject', 'text']);
    assert.equal(entry.day, dayKey(body.capturedAt));

    const future = await anon('/anonymous/feedback', { token, body: { subject: 'manager', rating: 4, capturedAt: app.clock.now() + HOUR } });
    assert.deepEqual([future.status, future.json.error.code], [422, 'captured_in_future']);
    const old = await anon('/anonymous/feedback', { token, body: { subject: 'manager', rating: 4, capturedAt: app.clock.now() - 49 * HOUR } });
    assert.deepEqual([old.status, old.json.error.code], [422, 'captured_too_old']);
  });

  test('the signed-in /feedback route is idempotent too, and keeps no worker id', async () => {
    const { cookie, worker } = await addWorker(app);
    const key = keyOf('fb2');
    const body = { subject: 'policies', rating: 3 };
    const first = await post(app, '/feedback', { cookie, key, body });
    const second = await post(app, '/feedback', { cookie, key, body });
    assert.equal(first.status, 201);
    assert.equal(second.headers.get('idempotent-replayed'), 'true');
    assert.ok(!JSON.stringify(await app.store.idempotency.query(ORG)).includes(worker.id));
  });

  test('anonymous items cannot be sent to another organisation: the token decides the org', async () => {
    const { cookie } = await addWorker(app);
    const { token } = await tokenFor(cookie);
    const res = await anon('/anonymous/grievances', { token, body: { category: 'pay', text: 'For my own org only', trackingCode: makeCode(6) } });
    assert.equal(res.status, 201);
    assert.equal((await app.store.grievances.query('org-college')).filter((g) => g.id === res.json.grievance.id).length, 0);
    assert.equal((await app.store.grievances.query(ORG)).filter((g) => g.id === res.json.grievance.id).length, 1);
  });
});

test('the app serves the precache list the service worker installs from', async () => {
  const app = await startApp({ nowMs: NOW });
  try {
    const res = await app.request('/precache.json');
    assert.equal(res.status, 200);
    assert.match(res.json.version, /^[0-9a-f]{12}$/);
    assert.ok(res.json.urls.includes('/worker/') && res.json.urls.includes('/shared/outbox.js') && res.json.urls.includes('/i18n/hi.json'));
    assert.equal(res.headers.get('cache-control'), 'no-store');
  } finally {
    await app.close();
  }
});
