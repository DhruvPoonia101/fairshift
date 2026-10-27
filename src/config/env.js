import { randomBytes } from 'node:crypto';

const DEFAULT_PORT = 8080;
const GENERATED_SECRET_BYTES = 32;

function parseBool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

/**
 * Reads configuration from the environment. Secrets are never defaulted to a literal:
 * a missing SESSION_SECRET is replaced by a random per-process value.
 * @param {Record<string, string | undefined>} source
 * @param {(message: string) => void} [warn]
 */
export function loadEnv(source = process.env, warn = console.warn) {
  const nodeEnv = source.NODE_ENV || 'development';
  let sessionSecret = source.SESSION_SECRET;
  if (!sessionSecret) {
    sessionSecret = randomBytes(GENERATED_SECRET_BYTES).toString('hex');
    warn('SESSION_SECRET is not set: generated a random one. Sessions reset on restart.');
  }
  const demoMode = parseBool(source.DEMO_MODE, false);
  if (demoMode && nodeEnv === 'production') {
    warn('DEMO_MODE is on in production: anyone can log in. Set DEMO_MODE=false for real use.');
  }
  return Object.freeze({
    port: Number.parseInt(source.PORT, 10) || DEFAULT_PORT,
    nodeEnv,
    isProduction: nodeEnv === 'production',
    demoMode,
    adminPassword: source.ADMIN_PASSWORD || null,
    sessionSecret,
    geminiApiKey: source.GEMINI_API_KEY || null,
    geminiModel: source.GEMINI_MODEL || null,
  });
}
