import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DEMO_ORG_IDS, resetDemoOrg, seedStore } from '../src/store/seed.js';
import { createFirestoreStore } from '../src/store/firestore.js';
import { createMemoryStore } from '../src/store/memory.js';
import { COLLECTION_NAMES } from '../src/store/repository.js';
import { addDays, dayKey, dayStartMs, fixedClock, previousMonth, monthKey } from '../src/lib/time.js';
import { createFakeFirestore } from './fake-firestore.js';
import { NOW, randomSecret, startApp } from './helpers.js';

const DAY = 24 * 60 * 60_000;
const OWN = 'org-construction';
const OTHER = 'org-college';

/** Every stored document of the given orgs, so "nothing else changed" can be compared exactly. */
async function snapshot(store, orgIds) {
  const out = {};
  for (const orgId of orgIds) {
    for (const name of COLLECTION_NAMES) {
      const docs = await store[name].query(orgId);
      out[`${orgId}/${name}`] = docs.sort((a, b) => a.id.localeCompare(b.id));
    }
  }
  return out;
}

async function counts(store, orgId) {
  const snap = await snapshot(store, [orgId]);
  return Object.fromEntries(Object.entries(snap).map(([k, docs]) => [k, docs.length]));
}

const stores = {
  memory: async (clock) => {
    const store = createMemoryStore();
    await seedStore(store, { clock });
    return store;
  },
  firestore: async (clock) => {
    const store = createFirestoreStore({ db: createFakeFirestore(), logError: () => {} });
    await seedStore(store, { clock });
    return store;
  },
};

for (const [kind, makeStore] of Object.entries(stores)) {
  describe(`reset demo data on the ${kind} store`, () => {
    async function setup(options = {}) {
      const store = await makeStore(fixedClock(NOW));
      const app = await startApp({ store, ...options });
      const admin = await app.login('admin-construction');
      return { app, store, admin };
    }
    const reset = (app, cookie, body = { confirm: true }, extra = {}) =>
      app.request('/api/admin/demo/reset', { method: 'POST', cookie, body, ...extra });

    test('deletes only that org\'s data, rebuilds it, and leaves every other org exactly as it was', async () => {
      const { app, store, admin } = await setup();
      try {
        const freshCounts = await counts(store, OWN);
        await store.grievances.insert({ id: 'live-1', orgId: OWN, text: 'added after seeding' });
        await store.workers.update(OWN, 'w-con-01', { name: 'Renamed Live' });
        await store.shifts.deleteByOrg('org-nothing');
        await store.workers.update(OTHER, 'w-col-01', { name: 'Keep Me' });
        await store.feedback.insert({ id: 'live-fb', orgId: OTHER, subject: 'manager', rating: 5, text: 'keep', day: '2026-10-01' });
        const othersBefore = await snapshot(store, [OTHER, 'org-hospital']);

        const res = await reset(app, admin.cookie);
        assert.equal(res.status, 200);
        assert.deepEqual(res.json, { ok: true, orgId: OWN });

        assert.equal(await store.grievances.get(OWN, 'live-1'), null, 'live data of the org is gone');
        assert.equal((await store.workers.get(OWN, 'w-con-01')).name, 'Ravi Kumar', 'demo data is back');
        assert.deepEqual(await counts(store, OWN), freshCounts);
        assert.deepEqual(await snapshot(store, [OTHER, 'org-hospital']), othersBefore, 'other orgs are untouched');
        assert.equal((await store.workers.get(OTHER, 'w-col-01')).name, 'Keep Me');
      } finally {
        await app.close();
      }
    });

    test('demo dates are anchored to today again: after time has passed the data moves with it', async () => {
      const { app, store, admin } = await setup();
      try {
        app.clock.advance(5 * DAY);
        const today = dayKey(app.clock.now());
        await reset(app, admin.cookie);
        const dash = (await app.request('/api/admin/dashboard', { cookie: admin.cookie })).json;
        assert.equal(dash.today, today);
        assert.equal(dash.trend.at(-1).date, today);
        const recent = await store.shifts.query(OWN, { gte: { field: 'checkIn', value: dayStartMs(addDays(today, -1)) } });
        assert.ok(recent.length > 0, 'there are shifts from yesterday, relative to the new today');
        const payments = await store.payments.query(OWN);
        assert.ok(payments.every((p) => p.month === previousMonth(monthKey(app.clock.now()))));
      } finally {
        await app.close();
      }
    });

    test('the employer stays signed in, the demo worker can still sign in, and a second reset works', async () => {
      const { app, admin } = await setup();
      try {
        assert.equal((await reset(app, admin.cookie)).status, 200);
        assert.equal((await app.request('/api/admin/dashboard', { cookie: admin.cookie })).status, 200);
        assert.equal((await app.login('worker-construction')).res.status, 200);
        assert.equal((await reset(app, admin.cookie)).status, 200);
      } finally {
        await app.close();
      }
    });

    test('it needs an explicit confirmation in the request', async () => {
      const { app, store, admin } = await setup();
      try {
        await store.grievances.insert({ id: 'keep-me', orgId: OWN, text: 'still here' });
        for (const body of [{}, { confirm: false }, { confirm: 'yes' }, { confirm: 1 }]) {
          assert.equal((await reset(app, admin.cookie, body)).status, 422, JSON.stringify(body));
        }
        assert.ok([400, 422].includes((await reset(app, admin.cookie, null)).status), 'no body at all');
        assert.ok(await store.grievances.get(OWN, 'keep-me'));
      } finally {
        await app.close();
      }
    });

    test('it cannot be aimed at another org, whatever the request says', async () => {
      const { app, store, admin } = await setup();
      try {
        const before = await snapshot(store, [OWN, OTHER, 'org-hospital']);
        const res = await reset(app, admin.cookie, { confirm: true, orgId: OTHER });
        assert.equal(res.status, 403);
        assert.deepEqual(await snapshot(store, [OWN, OTHER, 'org-hospital']), before, 'nothing was deleted anywhere');
        assert.equal((await reset(app, admin.cookie, { confirm: true, orgId: OWN })).status, 200);
      } finally {
        await app.close();
      }
    });

    test('workers, signed-out visitors and cross-site requests are refused and nothing changes', async () => {
      const { app, store, admin } = await setup();
      try {
        const worker = await app.login('worker-construction');
        const before = await snapshot(store, [OWN, OTHER]);
        assert.equal((await reset(app, worker.cookie)).status, 403);
        assert.equal((await reset(app, undefined)).status, 401);
        assert.equal((await reset(app, admin.cookie, { confirm: true }, { headers: { origin: 'https://evil.example' } })).status, 403);
        const form = await app.request('/api/admin/demo/reset', { method: 'POST', cookie: admin.cookie, body: 'confirm=true', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
        assert.equal(form.status, 415);
        assert.deepEqual(await snapshot(store, [OWN, OTHER]), before);
      } finally {
        await app.close();
      }
    });

    test('it is refused when demo mode is off, and nothing is deleted', async () => {
      const password = randomSecret();
      const { app, store } = await setup({ envOverrides: { DEMO_MODE: 'false', ADMIN_PASSWORD: password } });
      try {
        const login = await app.request('/api/login/admin', { method: 'POST', body: { org: OWN, password } });
        assert.equal(login.status, 200);
        const cookie = login.headers.getSetCookie()[0].split(';')[0];
        await store.grievances.insert({ id: 'real-1', orgId: OWN, text: 'real data' });
        const res = await reset(app, cookie);
        assert.equal(res.status, 403);
        assert.equal(res.json.error.code, 'demo_mode_required');
        assert.ok(await store.grievances.get(OWN, 'real-1'));
      } finally {
        await app.close();
      }
    });

    test('it is rate limited', async () => {
      const { app, admin } = await setup({ limits: { global: 1000, login: 10, report: 10, reset: 2 } });
      try {
        const statuses = [];
        for (let i = 0; i < 4; i += 1) statuses.push((await reset(app, admin.cookie)).status);
        assert.deepEqual(statuses, [200, 200, 429, 429]);
      } finally {
        await app.close();
      }
    });
  });
}

describe('reset demo data: failure handling', () => {
  const clock = fixedClock(NOW);

  test('a store outage gives a 503, no crash, and the reset works once the store is back', async () => {
    const db = createFakeFirestore();
    const store = createFirestoreStore({ db, logError: () => {} });
    await seedStore(store, { clock });
    const app = await startApp({ store });
    try {
      const admin = await app.login('admin-construction');
      db.failWith(Object.assign(new Error('unavailable'), { code: 14 }));
      const down = await app.request('/api/admin/demo/reset', { method: 'POST', cookie: admin.cookie, body: { confirm: true } });
      assert.equal(down.status, 503);
      assert.equal(down.json.error.code, 'store_unavailable');
      db.recover();
      assert.equal((await app.request('/api/admin/demo/reset', { method: 'POST', cookie: admin.cookie, body: { confirm: true } })).status, 200);
    } finally {
      await app.close();
    }
  });

  test('if rebuilding fails half way, the org looks unseeded and the next start repairs it completely', async () => {
    const clean = createMemoryStore();
    await seedStore(clean, { clock });
    const store = createMemoryStore();
    await seedStore(store, { clock });
    const failing = { ...store, shifts: { ...store.shifts, insert: async () => Promise.reject(new Error('write failed')) } };
    await assert.rejects(resetDemoOrg(failing, OWN, { clock }), /write failed/);
    assert.equal(await store.orgs.get(OWN, OWN), null, 'no org record: the org is not considered seeded');
    assert.deepEqual(await seedStore(store, { clock }), [OWN]);
    assert.deepEqual(await counts(store, OWN), await counts(clean, OWN));
  });

  test('only demo orgs can be reset: anything else deletes nothing', async () => {
    const store = createMemoryStore();
    await seedStore(store, { clock });
    await store.workers.insert({ id: 'w-real', orgId: 'org-real', name: 'Real Customer' });
    assert.equal(await resetDemoOrg(store, 'org-real', { clock }), false);
    assert.ok(await store.workers.get('org-real', 'w-real'));
    assert.deepEqual([...DEMO_ORG_IDS].sort(), ['org-college', 'org-construction', 'org-hospital']);
  });
});
