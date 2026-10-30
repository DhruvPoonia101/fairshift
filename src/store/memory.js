import { COLLECTION_NAMES, assertRepository } from './repository.js';

function matches(doc, { where = {}, gte, lt }) {
  for (const [field, value] of Object.entries(where)) {
    if (doc[field] !== value) return false;
  }
  if (gte && !(doc[gte.field] >= gte.value)) return false;
  if (lt && !(doc[lt.field] < lt.value)) return false;
  return true;
}

/** In-memory collection that copies on the way in and out, like a real database would. */
function createCollection() {
  /** @type {Map<string, Map<string, object>>} orgId -> id -> doc */
  const byOrg = new Map();
  const orgDocs = (orgId) => {
    if (!byOrg.has(orgId)) byOrg.set(orgId, new Map());
    return byOrg.get(orgId);
  };
  return {
    async insert(doc) {
      orgDocs(doc.orgId).set(doc.id, structuredClone(doc));
      return structuredClone(doc);
    },
    async get(orgId, id) {
      const doc = byOrg.get(orgId)?.get(id);
      return doc ? structuredClone(doc) : null;
    },
    async update(orgId, id, patch) {
      const doc = byOrg.get(orgId)?.get(id);
      if (!doc) return null;
      Object.assign(doc, structuredClone(patch));
      return structuredClone(doc);
    },
    async query(orgId, query = {}) {
      const docs = byOrg.get(orgId)?.values() ?? [];
      return [...docs].filter((d) => matches(d, query)).map((d) => structuredClone(d));
    },
    async findBy(field, value) {
      if (!value) return null;
      for (const docs of byOrg.values()) {
        for (const doc of docs.values()) {
          if (doc[field] === value) return structuredClone(doc);
        }
      }
      return null;
    },
  };
}

export function createMemoryStore() {
  const store = Object.fromEntries(COLLECTION_NAMES.map((name) => [name, createCollection()]));
  return assertRepository({ ...store, kind: 'memory', ping: async () => true });
}
