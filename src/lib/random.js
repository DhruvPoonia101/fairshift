import { randomBytes, randomInt } from 'node:crypto';

/** Deterministic PRNG (mulberry32) used only for seed data. */
export function createPrng(seed) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    /** Integer in [min, max] inclusive. */
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (p) => next() < p,
    pick: (items) => items[Math.floor(next() * items.length)],
  };
}

/** Stable 32-bit hash of a string, for deriving per-org seeds. */
export function hashString(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const ID_BYTES = 9;

/** Unguessable record id. */
export function newId(prefix) {
  return `${prefix}_${randomBytes(ID_BYTES).toString('base64url')}`;
}

export function randomToken(bytes = 24) {
  return randomBytes(bytes).toString('base64url');
}

/** Random code from an alphabet, using a CSPRNG. */
export function randomCode(alphabet, length) {
  let out = '';
  for (let i = 0; i < length; i += 1) out += alphabet[randomInt(alphabet.length)];
  return out;
}
