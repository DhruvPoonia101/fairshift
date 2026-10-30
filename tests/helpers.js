import { randomBytes } from 'node:crypto';
import { createApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import { addDays, dayKey, dayStartMs, fixedClock } from '../src/lib/time.js';
import { createMemoryStore } from '../src/store/memory.js';
import { seedStore } from '../src/store/seed.js';

const MINUTE = 60_000;

/** Epoch ms for an IST wall-clock time, e.g. istMs('2026-10-27', '09:30'). */
export function istMs(day, hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return dayStartMs(day) + (h * 60 + m) * MINUTE;
}

/** A finished shift from `startMs` lasting `minutes`. */
export function shiftOf(startMs, minutes, extra = {}) {
  return { checkIn: startMs, checkOut: startMs + minutes * MINUTE, ...extra };
}

/** Fixed "now" used by API tests: afternoon IST, so seeded shifts for today exist. */
export const NOW = istMs('2026-10-27', '15:00');

export const randomSecret = () => randomBytes(16).toString('hex');

export function testEnv(overrides = {}) {
  return loadEnv(
    { NODE_ENV: 'test', DEMO_MODE: 'true', SESSION_SECRET: randomSecret(), ...overrides },
    () => {},
  );
}

export async function seededStore(clock) {
  const store = createMemoryStore();
  await seedStore(store, { clock });
  return store;
}

/**
 * Starts the real app on an ephemeral port with a seeded store and a fixed clock.
 * Pass `store` to run against another repository (it must already be seeded).
 * @returns helpers: `request(path, options)`, `login(role)`, `close()`
 */
export async function startApp({ envOverrides, limits, nowMs = NOW, fetchImpl, store: customStore, logError = () => {} } = {}) {
  const clock = fixedClock(nowMs);
  const store = customStore ?? (await seededStore(clock));
  const env = testEnv(envOverrides);
  const app = createApp({ store, env, clock, limits, fetchImpl, logError });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  async function request(path, { method = 'GET', body, cookie, headers = {} } = {}) {
    const res = await fetch(base + path, {
      method,
      redirect: 'manual',
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(cookie ? { cookie } : {}),
        ...headers,
      },
      body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: res.status, headers: res.headers, json, text };
  }

  async function login(role) {
    const res = await request(`/api/demo-login/${role}`, { method: 'POST' });
    const cookie = res.headers.getSetCookie()[0]?.split(';')[0];
    return { cookie, session: res.json, res };
  }

  return {
    base,
    clock,
    store,
    env,
    request,
    login,
    today: dayKey(nowMs),
    daysAgo: (n) => addDays(dayKey(nowMs), -n),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
