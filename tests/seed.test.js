import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServices } from '../src/services/index.js';
import { assertRepository } from '../src/store/repository.js';
import { createMemoryStore } from '../src/store/memory.js';
import { NOW, seededStore, testEnv } from './helpers.js';
import { fixedClock } from '../src/lib/time.js';

const ORGS = ['org-construction', 'org-college'];

async function dashboards() {
  const clock = fixedClock(NOW);
  const store = await seededStore(clock);
  const services = createServices({ store, clock, env: testEnv() });
  return { store, services, clock };
}

test('seeding is deterministic for the same day', async () => {
  const a = await seededStore(fixedClock(NOW));
  const b = await seededStore(fixedClock(NOW));
  for (const orgId of ORGS) {
    const strip = (rows) => rows.map(({ trackingHash, ...rest }) => rest);
    assert.deepEqual(strip(await a.shifts.query(orgId)), strip(await b.shifts.query(orgId)));
    assert.deepEqual(strip(await a.workers.query(orgId)), strip(await b.workers.query(orgId)));
  }
});

test('each org is seeded with the demo story the brief asks for', async () => {
  const { services, store } = await dashboards();
  for (const orgId of ORGS) {
    const d = await services.insights.dashboard(orgId);
    assert.equal(d.kpis.totalWorkers, 12);
    assert.equal(d.kpis.fatigueFlagged, 2);
    assert.equal(d.kpis.atRisk, 2);
    assert.equal(d.kpis.openGrievances, 3);
    assert.equal(d.kpis.certificatesNeedingAttention, 1);
    assert.ok(d.kpis.presentToday > 0);
    assert.equal(d.trend.length, 14);
    const feedback = await store.feedback.query(orgId);
    assert.ok(feedback.length >= 8);
    const grievances = await store.grievances.query(orgId);
    assert.ok(grievances.some((g) => g.anonymous && !('workerId' in g)));
  }
});

test('the demo worker has a fatigue notice but has not checked in yet', async () => {
  const { services, store } = await dashboards();
  const [demo] = (await store.workers.query('org-construction', { where: { isDemo: true } }));
  const today = await services.attendance.today(demo);
  assert.equal(today.status, 'not_started');
  assert.equal((await services.attendance.restStatus(demo)).level, 'amber');
});

test('every org record carries its orgId (multi-tenant by construction)', async () => {
  const { store } = await dashboards();
  for (const orgId of ORGS) {
    for (const name of ['sites', 'workers', 'shifts', 'grievances', 'feedback', 'passportEntries', 'advances']) {
      const rows = await store[name].query(orgId);
      assert.ok(rows.length > 0, `${name} has rows`);
      assert.ok(rows.every((r) => r.orgId === orgId));
    }
  }
});

test('the repository contract rejects an incomplete store', () => {
  assert.throws(() => assertRepository({ orgs: {} }), /missing/);
  assert.doesNotThrow(() => assertRepository(createMemoryStore()));
});

test('the memory store returns copies, so callers cannot mutate stored data', async () => {
  const store = createMemoryStore();
  await store.orgs.insert({ id: 'o1', orgId: 'o1', name: 'A' });
  const copy = await store.orgs.get('o1', 'o1');
  copy.name = 'changed';
  assert.equal((await store.orgs.get('o1', 'o1')).name, 'A');
  assert.equal(await store.orgs.get('other-org', 'o1'), null);
});
