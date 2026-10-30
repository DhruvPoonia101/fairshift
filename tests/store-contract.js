import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { beforeEach, describe, test } from 'node:test';
import { COLLECTION_NAMES } from '../src/store/repository.js';

const uid = () => randomBytes(4).toString('hex');

/**
 * The behaviour every repository implementation must have (see src/store/repository.js).
 * Each test uses its own random org ids, so the suite also works against a shared emulator.
 * @param {string} label
 * @param {() => Promise<object>} makeStore
 * @param {{ skip?: string | boolean }} [options]
 */
export function repositoryContract(label, makeStore, { skip = false } = {}) {
  describe(`repository contract: ${label}`, { skip }, () => {
    let store;
    let orgA;
    let orgB;
    beforeEach(async () => {
      store = await makeStore();
      orgA = `org-a-${uid()}`;
      orgB = `org-b-${uid()}`;
    });

    test('insert then get returns an equal copy, not the stored object', async () => {
      const doc = { id: 'w1', orgId: orgA, name: 'Asha', tags: ['x'] };
      const inserted = await store.workers.insert(doc);
      assert.deepEqual(inserted, doc);
      const fetched = await store.workers.get(orgA, 'w1');
      assert.deepEqual(fetched, doc);
      fetched.name = 'changed';
      assert.equal((await store.workers.get(orgA, 'w1')).name, 'Asha');
    });

    test('get is scoped by org: the same id can exist in two orgs', async () => {
      await store.workers.insert({ id: 'w1', orgId: orgA, name: 'A' });
      await store.workers.insert({ id: 'w1', orgId: orgB, name: 'B' });
      assert.equal((await store.workers.get(orgA, 'w1')).name, 'A');
      assert.equal((await store.workers.get(orgB, 'w1')).name, 'B');
      assert.equal(await store.workers.get(orgA, 'missing'), null);
      assert.equal(await store.workers.get(`org-none-${uid()}`, 'w1'), null);
    });

    test('inserting the same id again replaces the document (seeding is idempotent)', async () => {
      await store.sites.insert({ id: 's1', orgId: orgA, name: 'one' });
      await store.sites.insert({ id: 's1', orgId: orgA, name: 'two' });
      assert.equal((await store.sites.query(orgA)).length, 1);
      assert.equal((await store.sites.get(orgA, 's1')).name, 'two');
    });

    test('update merges fields and returns the whole document; null values are stored', async () => {
      await store.shifts.insert({ id: 'sh1', orgId: orgA, workerId: 'w1', checkIn: 10, checkOut: null });
      const updated = await store.shifts.update(orgA, 'sh1', { checkOut: 99, autoClosed: true });
      assert.deepEqual(updated, { id: 'sh1', orgId: orgA, workerId: 'w1', checkIn: 10, checkOut: 99, autoClosed: true });
      const cleared = await store.shifts.update(orgA, 'sh1', { checkOut: null });
      assert.equal(cleared.checkOut, null);
      assert.equal(cleared.workerId, 'w1');
    });

    test('update returns null for a missing document and never reaches another org', async () => {
      assert.equal(await store.workers.update(orgA, 'ghost', { name: 'x' }), null);
      await store.workers.insert({ id: 'w1', orgId: orgB, name: 'B' });
      assert.equal(await store.workers.update(orgA, 'w1', { name: 'hacked' }), null);
      assert.equal((await store.workers.get(orgB, 'w1')).name, 'B');
    });

    test('query returns only the org, filters by equality (including null) and by numeric range', async () => {
      const rows = [
        { id: 'a', orgId: orgA, workerId: 'w1', checkIn: 100, checkOut: 200 },
        { id: 'b', orgId: orgA, workerId: 'w1', checkIn: 200, checkOut: null },
        { id: 'c', orgId: orgA, workerId: 'w2', checkIn: 300, checkOut: 400 },
        { id: 'd', orgId: orgB, workerId: 'w1', checkIn: 250, checkOut: null },
      ];
      for (const row of rows) await store.shifts.insert(row);
      const ids = async (query) => (await store.shifts.query(orgA, query)).map((r) => r.id).sort();

      assert.deepEqual(await ids(), ['a', 'b', 'c']);
      assert.deepEqual(await ids({ where: { workerId: 'w1' } }), ['a', 'b']);
      assert.deepEqual(await ids({ where: { checkOut: null } }), ['b']);
      assert.deepEqual(await ids({ gte: { field: 'checkIn', value: 200 } }), ['b', 'c']);
      assert.deepEqual(await ids({ lt: { field: 'checkIn', value: 300 } }), ['a', 'b']);
      assert.deepEqual(
        await ids({ where: { workerId: 'w1' }, gte: { field: 'checkIn', value: 150 }, lt: { field: 'checkIn', value: 300 } }),
        ['b'],
      );
      assert.deepEqual(await store.shifts.query(`org-empty-${uid()}`), []);
    });

    test('findBy looks a unique value up across orgs and returns null when absent', async () => {
      const token = `tok-${uid()}`;
      await store.workers.insert({ id: 'w1', orgId: orgA, passportToken: token });
      await store.workers.insert({ id: 'w2', orgId: orgB, passportToken: null });
      assert.equal((await store.workers.findBy('passportToken', token)).id, 'w1');
      assert.equal(await store.workers.findBy('passportToken', `nope-${uid()}`), null);
      assert.equal(await store.workers.findBy('passportToken', ''), null);
      assert.equal(await store.workers.findBy('passportToken', null), null);
    });

    test('deleteByOrg removes only that org, reports how many, and the org can be filled again', async () => {
      for (const id of ['a', 'b', 'c']) await store.shifts.insert({ id, orgId: orgA, workerId: 'w1', checkIn: 1 });
      await store.shifts.insert({ id: 'a', orgId: orgB, workerId: 'w1', checkIn: 1 });
      await store.workers.insert({ id: 'w1', orgId: orgA, passportToken: `tok-${uid()}` });
      assert.equal(await store.shifts.deleteByOrg(orgA), 3);
      assert.deepEqual(await store.shifts.query(orgA), []);
      assert.equal((await store.shifts.query(orgB)).length, 1);
      assert.ok(await store.workers.get(orgA, 'w1'), 'other collections of the same org are untouched');
      assert.equal(await store.shifts.deleteByOrg(orgA), 0);
      assert.equal(await store.shifts.deleteByOrg(`org-empty-${uid()}`), 0);
      await store.shifts.insert({ id: 'a', orgId: orgA, workerId: 'w1', checkIn: 2 });
      assert.equal((await store.shifts.get(orgA, 'a')).checkIn, 2);
    });

    test('every collection name accepts the same operations', async () => {
      for (const name of COLLECTION_NAMES) {
        await store[name].insert({ id: 'x1', orgId: orgA, label: name });
        assert.equal((await store[name].get(orgA, 'x1')).label, name);
        assert.equal((await store[name].query(orgA)).length, 1);
      }
    });
  });
}
