import { storeUnavailable } from '../lib/errors.js';
import { COLLECTION_NAMES, assertRepository } from './repository.js';

/**
 * Firestore implementation of the repository contract (see repository.js).
 *
 * Layout: one top-level collection per repository collection, prefixed so FairShift can share a
 * database with other apps. A document's id is `<orgId>:<id>` and it also stores `orgId` and `id`
 * as fields, so every read is scoped by tenant and ids can repeat across orgs.
 *
 * Queries use only equality filters on the server (no composite indexes to deploy); range
 * bounds (`gte` / `lt`) are applied to the result in memory. At scale, add composite indexes on
 * (orgId, <field>) and push the range down.
 *
 * Any Firestore failure is logged (code only, never document data) and surfaced as a 503
 * `store_unavailable` error, so a database outage never crashes the process.
 */

export const COLLECTION_PREFIX = 'fairshift_';
const NOT_FOUND_CODE = 5;
const DELETE_CONCURRENCY = 100;
const HEALTH_COLLECTION = `${COLLECTION_PREFIX}health`;

const docId = (orgId, id) => `${orgId}:${id}`;

function inRange(doc, { gte, lt }) {
  if (gte && !(doc[gte.field] >= gte.value)) return false;
  if (lt && !(doc[lt.field] < lt.value)) return false;
  return true;
}

/**
 * @param {{ db: object, logError?: (message: string) => void }} options `db` is a Firestore instance
 *   (or anything with the same `collection().doc().get/set/update` and `where().get()` surface)
 */
export function createFirestoreStore({ db, logError = console.error }) {
  /** Runs a Firestore call; on failure logs a short reason and throws a safe 503. */
  async function guard(operation, call) {
    try {
      return await call();
    } catch (error) {
      logError(`Firestore ${operation} failed: ${error?.code ?? error?.name ?? 'unknown'}`);
      throw storeUnavailable();
    }
  }

  function createCollection(name) {
    const col = () => db.collection(`${COLLECTION_PREFIX}${name}`);
    return {
      async insert(doc) {
        await guard(`${name}.insert`, () => col().doc(docId(doc.orgId, doc.id)).set(doc));
        return structuredClone(doc);
      },

      async get(orgId, id) {
        const snap = await guard(`${name}.get`, () => col().doc(docId(orgId, id)).get());
        return snap.exists ? snap.data() : null;
      },

      async update(orgId, id, patch) {
        const ref = col().doc(docId(orgId, id));
        return guard(`${name}.update`, async () => {
          try {
            await ref.update(patch);
          } catch (error) {
            if (error?.code === NOT_FOUND_CODE) return null;
            throw error;
          }
          return (await ref.get()).data();
        });
      },

      async query(orgId, query = {}) {
        const snap = await guard(`${name}.query`, () => {
          let q = col().where('orgId', '==', orgId);
          for (const [field, value] of Object.entries(query.where ?? {})) q = q.where(field, '==', value);
          return q.get();
        });
        return snap.docs.map((d) => d.data()).filter((doc) => inRange(doc, query));
      },

      async deleteByOrg(orgId) {
        const snap = await guard(`${name}.deleteByOrg`, () => col().where('orgId', '==', orgId).get());
        const refs = snap.docs.map((d) => d.ref);
        for (let i = 0; i < refs.length; i += DELETE_CONCURRENCY) {
          await guard(`${name}.deleteByOrg`, () => Promise.all(refs.slice(i, i + DELETE_CONCURRENCY).map((ref) => ref.delete())));
        }
        return refs.length;
      },

      async findBy(field, value) {
        if (!value) return null;
        const snap = await guard(`${name}.findBy`, () => col().where(field, '==', value).limit(1).get());
        return snap.empty ? null : snap.docs[0].data();
      },
    };
  }

  const store = Object.fromEntries(COLLECTION_NAMES.map((name) => [name, createCollection(name)]));
  return assertRepository({
    ...store,
    kind: 'firestore',
    /** Cheap round trip used by GET /health. Throws a 503 when Firestore cannot be reached. */
    ping: () => guard('ping', () => db.collection(HEALTH_COLLECTION).doc('ping').get()),
  });
}

/**
 * Connects with Application Default Credentials: on Cloud Run this is the service account, locally
 * it is `gcloud auth application-default login` or the emulator (FIRESTORE_EMULATOR_HOST).
 * The client library is imported lazily so memory mode never loads it.
 * @param {{ projectId?: string | null, logError?: (message: string) => void }} [options]
 */
export async function connectFirestore({ projectId = null, logError } = {}) {
  const { Firestore } = await import('@google-cloud/firestore');
  const db = new Firestore({ ...(projectId ? { projectId } : {}), ignoreUndefinedProperties: true });
  return createFirestoreStore({ db, logError });
}
