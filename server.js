// Local development only: load .env before the config is read. In production (Cloud Run) the
// platform supplies real environment variables, so dotenv is not even imported.
// App modules are imported afterwards so nothing can read process.env before .env is loaded.
if (process.env.NODE_ENV !== 'production') await import('dotenv/config');

const { createApp } = await import('./src/app.js');
const { loadEnv } = await import('./src/config/env.js');
const { systemClock } = await import('./src/lib/time.js');
const { createMemoryStore } = await import('./src/store/memory.js');
const { seedStore } = await import('./src/store/seed.js');

const SHUTDOWN_GRACE_MS = 8000;

const env = loadEnv();
const store = createMemoryStore();
await seedStore(store, { clock: systemClock });

const server = createApp({ store, env, clock: systemClock }).listen(env.port, '0.0.0.0', () => {
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
