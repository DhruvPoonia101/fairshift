import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { fixedClock } from '../src/lib/time.js';
import { COLLECTION_PREFIX, createFirestoreStore } from '../src/store/firestore.js';
import { createMemoryStore } from '../src/store/memory.js';
import { COLLECTION_NAMES } from '../src/store/repository.js';
import { seedStore } from '../src/store/seed.js';
import { createFakeFirestore } from './fake-firestore.js';
import { NOW, startApp } from './helpers.js';

const ORG_IDS = ['org-construction', 'org-college', 'org-hospital'];
const clock = fixedClock(NOW);

async function counts(store, orgIds = ORG_IDS) {
  const out = {};
  for (const name of COLLECTION_NAMES) {
    out[name] = 0;
    for (const orgId of orgIds) out[name] += (await store[name].query(orgId)).length;
  }
  return out;
}

describe('idempotent demo seeding', () => {
  test('seeds all three demo orgs once and a second run changes nothing', async () => {
    const store = createMemoryStore();
    assert.deepEqual(await seedStore(store, { clock }), ORG_IDS);
    const first = await counts(store);
    assert.deepEqual(await seedStore(store, { clock }), []);
    assert.deepEqual(await counts(store), first);
  });

  test('a restart never overwrites live data', async () => {
    const store = createMemoryStore();
    await seedStore(store, { clock });
    await store.workers.update('org-hospital', 'w-hos-01', { name: 'Renamed Live' });
    await store.grievances.insert({ id: 'live-1', orgId: 'org-hospital', text: 'added after seeding' });
    await seedStore(store, { clock });
    assert.equal((await store.workers.get('org-hospital', 'w-hos-01')).name, 'Renamed Live');
    assert.ok(await store.grievances.get('org-hospital', 'live-1'));
  });

  test('only orgs that are missing are seeded (an older database gains the new hospital)', async () => {
    const store = createMemoryStore();
    await seedStore(store, { clock });
    const older = createMemoryStore();
    for (const name of COLLECTION_NAMES) {
      for (const orgId of ['org-construction', 'org-college']) {
        for (const doc of await store[name].query(orgId)) await older[name].insert(doc);
      }
    }
    assert.deepEqual(await seedStore(older, { clock }), ['org-hospital']);
    assert.deepEqual(await counts(older), await counts(store));
  });

  test('a crash before the org record is written is repaired by the next start, with no duplicates', async () => {
    const clean = createMemoryStore();
    await seedStore(clean, { clock });

    const store = createMemoryStore();
    const crashing = { ...store, orgs: { ...store.orgs, insert: async () => Promise.reject(new Error('crash')) } };
    await assert.rejects(seedStore(crashing, { clock }), /crash/);
    assert.equal(await store.orgs.get('org-construction', 'org-construction'), null);

    assert.deepEqual(await seedStore(store, { clock }), ORG_IDS);
    assert.deepEqual(await counts(store), await counts(clean));
  });

  test('two instances seeding at the same moment produce one copy of the data', async () => {
    const store = createMemoryStore();
    await Promise.all([seedStore(store, { clock }), seedStore(store, { clock })]);
    const clean = createMemoryStore();
    await seedStore(clean, { clock });
    assert.deepEqual(await counts(store), await counts(clean));
  });

  test('seeding through the Firestore adapter works and is idempotent too', async () => {
    const db = createFakeFirestore();
    const store = createFirestoreStore({ db, logError: () => {} });
    assert.deepEqual(await seedStore(store, { clock }), ORG_IDS);
    assert.deepEqual(await seedStore(store, { clock }), []);
    const memory = createMemoryStore();
    await seedStore(memory, { clock });
    assert.deepEqual(await counts(store), await counts(memory));
    assert.equal(Object.keys(db.dump(`${COLLECTION_PREFIX}orgs`)).length, 3);
  });
});

describe('API on top of the Firestore adapter', () => {
  async function firestoreApp() {
    const db = createFakeFirestore();
    const logs = [];
    const store = createFirestoreStore({ db, logError: (m) => logs.push(m) });
    await seedStore(store, { clock });
    const app = await startApp({ store, logError: (m) => logs.push(m) });
    return { app, db, logs };
  }

  test('the whole app works unchanged on the Firestore adapter', async () => {
    const { app } = await firestoreApp();
    try {
      const worker = await app.login('worker-hospital');
      const admin = await app.login('admin-hospital');
      assert.equal((await app.request('/api/attendance/today', { cookie: worker.cookie })).status, 200);
      const made = await app.request('/api/grievances', {
        method: 'POST',
        cookie: worker.cookie,
        body: { category: 'needle_stick', text: 'Sharps bin is full', anonymous: true },
      });
      assert.equal(made.status, 201);
      assert.equal((await app.request('/api/admin/dashboard', { cookie: admin.cookie })).status, 200);
      const health = await app.request('/health');
      assert.deepEqual(health.json, { status: 'ok', dataStore: 'firestore' });
    } finally {
      await app.close();
    }
  });

  test('an outage gives a clear 503 JSON, is logged, never crashes, and recovers by itself', async () => {
    const { app, db, logs } = await firestoreApp();
    try {
      const worker = await app.login('worker-college');
      db.failWith(Object.assign(new Error('UNAVAILABLE: connection refused'), { code: 14 }));

      const me = await app.request('/api/me', { cookie: worker.cookie });
      assert.equal(me.status, 503);
      assert.equal(me.json.error.code, 'store_unavailable');
      assert.ok(!/node_modules|\.js:\d+|connection refused/.test(me.text), 'no internals leak');

      const post = await app.request('/api/feedback', { method: 'POST', cookie: worker.cookie, body: { subject: 'manager', rating: 4 } });
      assert.equal(post.status, 503);
      assert.equal((await app.request('/api/config')).status, 200, 'routes that need no data still answer');

      assert.equal((await app.request('/healthz')).status, 200, 'liveness never depends on the database');
      const health = await app.request('/health');
      assert.equal(health.status, 503);
      assert.deepEqual(health.json, { status: 'degraded', dataStore: 'firestore' });
      assert.ok(logs.some((line) => /Firestore .* failed: 14/.test(line)));

      db.recover();
      assert.equal((await app.request('/api/me', { cookie: worker.cookie })).status, 200);
      assert.equal((await app.request('/health')).status, 200);
    } finally {
      await app.close();
    }
  });

  test('GET /health on the memory store reports it', async () => {
    const app = await startApp();
    try {
      assert.deepEqual((await app.request('/health')).json, { status: 'ok', dataStore: 'memory' });
    } finally {
      await app.close();
    }
  });
});
