import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { loadEnv } from '../src/config/env.js';
import { COLLECTION_PREFIX, connectFirestore, createFirestoreStore } from '../src/store/firestore.js';
import { createStore } from '../src/store/index.js';
import { createMemoryStore } from '../src/store/memory.js';
import { assertRepository } from '../src/store/repository.js';
import { createFakeFirestore } from './fake-firestore.js';
import { repositoryContract } from './store-contract.js';

// The same contract runs against every implementation, so routes and services cannot tell them apart.
repositoryContract('memory', async () => createMemoryStore());
repositoryContract('firestore adapter (fake client)', async () =>
  createFirestoreStore({ db: createFakeFirestore(), logError: () => {} }),
);
repositoryContract(
  'firestore emulator',
  async () => connectFirestore({ projectId: 'demo-fairshift', logError: () => {} }),
  { skip: process.env.FIRESTORE_EMULATOR_HOST ? false : 'set FIRESTORE_EMULATOR_HOST to run against the emulator' },
);

describe('firestore adapter', () => {
  const setup = () => {
    const db = createFakeFirestore();
    const logs = [];
    const store = createFirestoreStore({ db, logError: (m) => logs.push(m) });
    return { db, logs, store };
  };

  test('documents live in prefixed collections, keyed and stamped by orgId', async () => {
    const { db, store } = setup();
    await store.workers.insert({ id: 'w1', orgId: 'org-x', name: 'Asha' });
    const stored = db.dump(`${COLLECTION_PREFIX}workers`);
    assert.deepEqual(Object.keys(stored), ['org-x:w1']);
    assert.equal(stored['org-x:w1'].orgId, 'org-x');
  });

  test('satisfies the repository interface and reports its kind', () => {
    const { store } = setup();
    assert.doesNotThrow(() => assertRepository(store));
    assert.equal(store.kind, 'firestore');
  });

  test('a Firestore failure becomes a 503 store_unavailable, logged by code only, without document data', async () => {
    const { db, store, logs } = setup();
    await store.workers.insert({ id: 'w1', orgId: 'org-x', name: 'Secret Name' });
    db.failWith(Object.assign(new Error('deadline exceeded for Secret Name'), { code: 4 }));
    await assert.rejects(store.workers.get('org-x', 'w1'), { status: 503, code: 'store_unavailable' });
    await assert.rejects(store.workers.query('org-x'), { status: 503 });
    await assert.rejects(store.workers.update('org-x', 'w1', { name: 'x' }), { status: 503 });
    await assert.rejects(store.workers.findBy('passportToken', 'abc'), { status: 503 });
    await assert.rejects(store.ping(), { status: 503 });
    assert.ok(logs.length >= 5);
    assert.ok(logs.every((line) => line.startsWith('Firestore ') && !line.includes('Secret Name')));
    assert.match(logs[0], /workers\.get failed: 4/);
    db.recover();
    assert.equal((await store.workers.get('org-x', 'w1')).name, 'Secret Name');
    await store.ping();
  });
});

describe('store selection', () => {
  test('DATA_STORE=memory (the default) builds the memory store with no credentials', async () => {
    const env = loadEnv({ SESSION_SECRET: 'x'.repeat(16) }, () => {});
    assert.equal(env.dataStore, 'memory');
    const store = await createStore(env);
    assert.equal(store.kind, 'memory');
    assert.equal(await store.ping(), true);
  });

  test('DATA_STORE and GOOGLE_CLOUD_PROJECT are read from the environment', () => {
    const quiet = () => {};
    const env = loadEnv({ DATA_STORE: 'Firestore', GOOGLE_CLOUD_PROJECT: 'my-project', SESSION_SECRET: 'x'.repeat(16) }, quiet);
    assert.equal(env.dataStore, 'firestore');
    assert.equal(env.googleCloudProject, 'my-project');
    assert.equal(loadEnv({ SESSION_SECRET: 'x'.repeat(16) }, quiet).googleCloudProject, null);
  });

  test('an unknown DATA_STORE fails fast instead of silently using memory', () => {
    assert.throws(() => loadEnv({ DATA_STORE: 'mongo', SESSION_SECRET: 'x'.repeat(16) }, () => {}), /DATA_STORE/);
  });
});
