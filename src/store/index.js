import { connectFirestore } from './firestore.js';
import { createMemoryStore } from './memory.js';

/**
 * Builds the repository selected by DATA_STORE. Memory is the default so a fresh clone runs with
 * no credentials; Firestore is opt-in and uses Application Default Credentials.
 * @param {{ dataStore: 'memory' | 'firestore', googleCloudProject: string | null }} env
 * @param {{ logError?: (message: string) => void }} [options]
 */
export async function createStore(env, { logError } = {}) {
  if (env.dataStore === 'firestore') {
    return connectFirestore({ projectId: env.googleCloudProject, logError });
  }
  return createMemoryStore();
}
