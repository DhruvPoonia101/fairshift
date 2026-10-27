/**
 * Repository interface. Every collection exposes the same async methods and every record
 * carries an `orgId`, so multi-tenancy is enforced by the data layer, not by convention.
 * Production swaps `memory.js` for a Firestore or Cloud SQL implementation of this contract
 * (Firestore: one top-level collection per name, `orgId` as an indexed field).
 *
 * @typedef {object} Query
 * @property {Record<string, string | number | boolean | null>} [where] equality filters
 * @property {{ field: string, value: number }} [gte] inclusive lower bound on a numeric field
 * @property {{ field: string, value: number }} [lt] exclusive upper bound on a numeric field
 *
 * @typedef {object} Collection
 * @property {(doc: {id: string, orgId: string}) => Promise<object>} insert
 * @property {(orgId: string, id: string) => Promise<object | null>} get
 * @property {(orgId: string, id: string, patch: object) => Promise<object | null>} update
 * @property {(orgId: string, query?: Query) => Promise<object[]>} query
 * @property {(field: string, value: string) => Promise<object | null>} findBy
 *   Global lookup on a unique field (share tokens, tracking hashes). The only cross-org read.
 */

export const COLLECTION_NAMES = Object.freeze([
  'orgs',
  'sites',
  'admins',
  'workers',
  'shifts',
  'advances',
  'grievances',
  'feedback',
  'passportEntries',
]);

export const COLLECTION_METHODS = Object.freeze(['insert', 'get', 'update', 'query', 'findBy']);

/** Fails fast at startup if a store implementation does not satisfy the contract. */
export function assertRepository(store) {
  for (const name of COLLECTION_NAMES) {
    for (const method of COLLECTION_METHODS) {
      if (typeof store?.[name]?.[method] !== 'function') {
        throw new Error(`Store is missing ${name}.${method}()`);
      }
    }
  }
  return store;
}
