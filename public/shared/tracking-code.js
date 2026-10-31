/**
 * Codes made on the phone: the anonymous tracking code and the idempotency key of every queued action.
 * Pure (the random source is an argument), so it can be tested. Both use crypto.getRandomValues, never Math.random.
 */

/** Same alphabet and length as the server (src/config/constants.js); tests/offline-capture.test.js keeps them equal. */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 16;
export const BITS_PER_SYMBOL = Math.log2(CODE_ALPHABET.length); // 5: the alphabet has 32 symbols
export const CODE_BITS = BITS_PER_SYMBOL * CODE_LENGTH; // 80
const MIN_DISTINCT = 6;
const KEY_BYTES = 18; // 144 bits -> 24 URL-safe characters

const browserRandom = (array) => crypto.getRandomValues(array);

/** 16 symbols x 5 bits = 80 bits. 256 is a multiple of 32, so `byte & 31` has no modulo bias. */
export function generateTrackingCode(random = browserRandom) {
  for (;;) {
    const bytes = random(new Uint8Array(CODE_LENGTH));
    const code = Array.from(bytes, (b) => CODE_ALPHABET[b & (CODE_ALPHABET.length - 1)]).join('');
    // A source stuck on one value would make codes guessable; the server refuses such codes, so never produce one.
    if (new Set(code).size >= MIN_DISTINCT) return code;
  }
}

/** "ABCD-EFGH-JKLM-NPQR": groups of four are easier to read out and copy. */
export const formatTrackingCode = (code) => code.match(/.{1,4}/g).join('-');

/** What a worker typed or pasted, back to the 16 symbols the server knows. */
export const normaliseTrackingCode = (text) => String(text).toUpperCase().replace(/[^A-Z0-9]/g, '');

/** A random key for the Idempotency-Key header: unique per queued action, the same on every retry of it. */
export function newIdempotencyKey(random = browserRandom) {
  const bytes = random(new Uint8Array(KEY_BYTES));
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
