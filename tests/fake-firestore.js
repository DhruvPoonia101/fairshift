/**
 * A tiny in-memory stand-in for the parts of the Firestore client the adapter uses, so the adapter
 * can be tested without credentials or the emulator:
 *   db.collection(name).doc(id).get() / set(data) / update(patch)
 *   db.collection(name).where(field, '==', value)...limit(n).get()
 * `failWith(error)` makes every call reject until `recover()`, to simulate an outage.
 */
export function createFakeFirestore() {
  const collections = new Map();
  let failure = null;

  const docsOf = (name) => {
    if (!collections.has(name)) collections.set(name, new Map());
    return collections.get(name);
  };
  const guard = () => {
    if (failure) throw failure;
  };
  const snapshot = (id, doc, name) => ({
    id,
    exists: doc !== undefined,
    data: () => (doc === undefined ? undefined : structuredClone(doc)),
    ref: {
      async delete() {
        guard();
        docsOf(name).delete(id);
      },
    },
  });

  function query(name, filters = [], max = Infinity) {
    return {
      where(field, op, value) {
        if (op !== '==') throw new Error(`fake firestore only supports ==, got ${op}`);
        return query(name, [...filters, { field, value }], max);
      },
      limit: (n) => query(name, filters, n),
      async get() {
        guard();
        const docs = [...docsOf(name)]
          .filter(([, doc]) => filters.every((f) => doc[f.field] === f.value))
          .slice(0, max)
          .map(([id, doc]) => snapshot(id, doc, name));
        return { docs, empty: docs.length === 0 };
      },
    };
  }

  return {
    collection(name) {
      return {
        ...query(name),
        doc: (id) => ({
          async get() {
            guard();
            return snapshot(id, docsOf(name).get(id), name);
          },
          async set(data) {
            guard();
            docsOf(name).set(id, structuredClone(data));
          },
          async update(patch) {
            guard();
            const doc = docsOf(name).get(id);
            if (!doc) throw Object.assign(new Error('NOT_FOUND'), { code: 5 });
            Object.assign(doc, structuredClone(patch));
          },
        }),
      };
    },
    failWith(error) {
      failure = error;
    },
    recover() {
      failure = null;
    },
    /** Raw documents of a collection, for assertions about how data is laid out. */
    dump: (name) => Object.fromEntries(docsOf(name)),
  };
}
