/**
 * IndexedDB for the offline outbox. One small database, shared with the service worker (sw.js reads the same
 * stores to send waiting items when Background Sync fires, so the names here must match sw.js):
 *   items      the queue (key: id, index: seq)
 *   meta       small values: the seq counter, the anonymous-submission token, "needs sign-in"
 *   snapshots  the last good copy of a few screens, so they still open without a signal
 */
export const DB_NAME = 'fairshift-outbox';
export const DB_VERSION = 1;

export function openOutboxDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const items = db.createObjectStore('items', { keyPath: 'id' });
      items.createIndex('seq', 'seq');
      db.createObjectStore('meta', { keyPath: 'key' });
      db.createObjectStore('snapshots', { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('idb_blocked'));
  });
}

const done = (request) =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

/** Promise wrappers for the handful of operations the app needs. */
export function idb(db) {
  const store = (name, mode = 'readonly') => db.transaction(name, mode).objectStore(name);
  return {
    getAll: (name) => done(store(name).getAll()),
    get: (name, key) => done(store(name).get(key)),
    put: (name, value) => done(store(name, 'readwrite').put(value)),
    delete: (name, key) => done(store(name, 'readwrite').delete(key)),
    clear: (name) => done(store(name, 'readwrite').clear()),
    /** Next number in the capture order. Read and written in one transaction, so two tabs never get the same one. */
    nextSeq: () =>
      new Promise((resolve, reject) => {
        const tx = db.transaction('meta', 'readwrite');
        const meta = tx.objectStore('meta');
        const read = meta.get('seq');
        read.onsuccess = () => {
          const next = (read.result?.value ?? 0) + 1;
          meta.put({ key: 'seq', value: next });
          tx.oncomplete = () => resolve(next);
        };
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  };
}

/** The queue's storage (see queue.js) on top of IndexedDB. */
export function createIdbStorage(api) {
  return {
    all: () => api.getAll('items'),
    put: (item) => api.put('items', item),
    remove: (id) => api.delete('items', id),
    nextSeq: () => api.nextSeq(),
  };
}
