// Local development only: load .env before the config is read. In production (Cloud Run) the
// platform supplies real environment variables, so dotenv is not even imported.
// App modules are imported afterwards so nothing can read process.env before .env is loaded.
if (process.env.NODE_ENV !== 'production') await import('dotenv/config');

const { createApp } = await import('./src/app.js');
const { loadEnv } = await import('./src/config/env.js');
const { systemClock } = await import('./src/lib/time.js');
const { createStore } = await import('./src/store/index.js');
const { seedStore } = await import('./src/store/seed.js');

const SHUTDOWN_GRACE_MS = 8000;
const SEED_RETRY_MS = 15_000;
const SEED_MAX_ATTEMPTS = 5;

const env = loadEnv();
const store = await createStore(env, { logError: console.error });
console.log(`Data store: ${store.kind}`);

/**
 * Seeds the demo orgs that are missing. If the database is unreachable the server still starts
 * (requests answer 503 until it recovers) and seeding is retried a few times in the background.
 */
async function seedDemoData(attempt = 1) {
  try {
    const seeded = await seedStore(store, { clock: systemClock });
    if (seeded.length > 0) console.log(`Seeded demo orgs: ${seeded.join(', ')}`);
  } catch {
    console.error(`Demo data seeding failed (attempt ${attempt} of ${SEED_MAX_ATTEMPTS}).`);
    if (attempt < SEED_MAX_ATTEMPTS) setTimeout(() => seedDemoData(attempt + 1), SEED_RETRY_MS).unref();
  }
}
await seedDemoData();

const server = createApp({ store, env, clock: systemClock, logError: console.error }).listen(env.port, '0.0.0.0', () => {
  console.log(`FairShift listening on port ${env.port}`);
});

// Cloud Run sends SIGTERM before stopping an instance: finish in-flight requests, then exit.
function shutdown() {
  console.log('SIGTERM received, shutting down');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), SHUTDOWN_GRACE_MS).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
