import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ANON_CODE_ALPHABET, OFFLINE } from '../src/config/constants.js';
import { overlayToday, recordsWithWaitingDispute, specFor } from '../public/shared/actions.js';
import { BASE_BACKOFF_MS, MAX_ATTEMPTS, MAX_BACKOFF_MS, MAX_CAPTURE_AGE_MS, createMemoryStorage, createQueue } from '../public/shared/queue.js';
import { CODE_BITS, CODE_LENGTH, formatTrackingCode, generateTrackingCode, newIdempotencyKey, normaliseTrackingCode } from '../public/shared/tracking-code.js';
import { buildPrecacheList } from '../src/lib/precache.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public');
const read = (file) => readFileSync(path.join(publicDir, file), 'utf8');

/** A fake crypto.getRandomValues that hands out a fixed byte sequence. */
const fixedRandom = (bytes) => (array) => {
  array.forEach((_, i) => {
    array[i] = bytes[i % bytes.length];
  });
  return array;
};

describe('tracking codes and keys made on the phone', () => {
  test('a code is 16 symbols from the 32-symbol alphabet: 80 bits', () => {
    const code = generateTrackingCode();
    assert.equal(code.length, CODE_LENGTH);
    assert.ok([...code].every((c) => ANON_CODE_ALPHABET.includes(c)));
    assert.ok(CODE_BITS >= 80);
    assert.equal(Math.log2(ANON_CODE_ALPHABET.length) * 16, CODE_BITS);
  });

  test('it uses the random source it is given (crypto.getRandomValues in the app), one byte per symbol', () => {
    let asked = 0;
    const code = generateTrackingCode((array) => {
      asked += array.length;
      return fixedRandom([0, 1, 2, 3, 4, 5, 6, 7])(array);
    });
    assert.equal(asked, 16);
    assert.equal(code, [...'ABCDEFGH'.repeat(2)].join(''));
    assert.equal(generateTrackingCode(fixedRandom([32, 33, 34, 35, 36, 37, 38, 39])), 'ABCDEFGH'.repeat(2), 'the top three bits of each byte are ignored: no modulo bias');
  });

  test('a stuck random source cannot produce a guessable code: it keeps asking until the code is varied', () => {
    let round = 0;
    const code = generateTrackingCode((array) => {
      round += 1;
      return round === 1 ? array.fill(7) : fixedRandom([1, 9, 17, 25, 3, 11, 19, 27])(array);
    });
    assert.ok(round >= 2);
    assert.ok(new Set(code).size >= 6);
  });

  test('the source is crypto.getRandomValues, not Math.random', () => {
    const source = read('shared/tracking-code.js');
    assert.match(source, /crypto\.getRandomValues/);
    assert.doesNotMatch(source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''), /Math\.random/);
  });

  test('1,000 codes: all different, all well-formed', () => {
    const codes = new Set(Array.from({ length: 1000 }, () => generateTrackingCode()));
    assert.equal(codes.size, 1000);
  });

  test('formatting for reading out, and back again', () => {
    assert.equal(formatTrackingCode('ABCDEFGHJKLMNPQR'), 'ABCD-EFGH-JKLM-NPQR');
    assert.equal(normaliseTrackingCode('abcd-efgh jklm-npqr'), 'ABCDEFGHJKLMNPQR');
  });

  test('an idempotency key is 24 URL-safe characters (144 bits) and fits the server pattern', () => {
    const key = newIdempotencyKey();
    assert.match(key, OFFLINE.IDEMPOTENCY_KEY_PATTERN);
    assert.equal(key.length, 24);
    assert.equal(new Set(Array.from({ length: 500 }, () => newIdempotencyKey())).size, 500);
    assert.match(newIdempotencyKey(fixedRandom([251, 255, 254])), /^[A-Za-z0-9_-]+$/, 'base64url: no + / =');
  });
});

describe('what an action becomes in the outbox', () => {
  const ctx = { ownerId: 'w-ravi', random: fixedRandom([3, 9, 14, 20, 1, 7, 11, 25]) };

  test('a named action carries the worker as its owner, and no capture time yet', () => {
    const checkin = specFor('checkin', { method: 'button', lat: 12.9, lng: 80.2, ignored: 'x' }, ctx);
    assert.deepEqual([checkin.kind, checkin.anonymous, checkin.ownerId, checkin.request.path], ['checkin', false, 'w-ravi', '/attendance/check-in']);
    assert.deepEqual(checkin.request.body, { method: 'button', lat: 12.9, lng: 80.2 }, 'position taken when the worker tapped, kept with the item');
    assert.equal('capturedAt' in checkin.request.body, false, 'added only when it is sent late');
    assert.equal(specFor('checkout', {}, ctx).request.path, '/attendance/check-out');
    const dispute = specFor('dispute', { shiftId: 'sh1', category: 'wrong_time', checkOutAt: 5, note: '' }, ctx);
    assert.deepEqual(dispute.request.body, { shiftId: 'sh1', category: 'wrong_time', checkOutAt: 5 }, 'empty fields are dropped');
    const named = specFor('report', { category: 'pay', text: 'Late pay', anonymous: false }, ctx);
    assert.deepEqual([named.request.path, named.ownerId, named.anonymous], ['/grievances', 'w-ravi', false]);
  });

  test('an anonymous report has a code made on the phone, no owner, and goes to the no-sign-in endpoint', () => {
    const spec = specFor('report', { category: 'pay', text: 'Nobody paid us', anonymous: true }, ctx);
    assert.deepEqual([spec.anonymous, spec.ownerId, spec.request.path], [true, null, '/anonymous/grievances']);
    assert.equal(spec.trackingCode.length, 16);
    assert.equal(spec.request.body.trackingCode, spec.trackingCode);
    assert.deepEqual(Object.keys(spec.request.body).sort(), ['category', 'text', 'trackingCode']);
  });

  test('feedback is always anonymous', () => {
    const spec = specFor('feedback', { subject: 'manager', rating: 4, text: '' }, ctx);
    assert.deepEqual([spec.anonymous, spec.ownerId, spec.request.path], [true, null, '/anonymous/feedback']);
    assert.deepEqual(spec.request.body, { subject: 'manager', rating: 4 });
  });

  test('nothing in an anonymous item, queued or after it is sent, mentions the worker', async () => {
    const storage = createMemoryStorage();
    let n = 0;
    const queue = createQueue({ storage, newKey: () => `anon-key-${++n}-0123456789abcdefghij` });
    await queue.enqueue(specFor('report', { category: 'pay', text: 'Anonymous words', anonymous: true }, ctx));
    await queue.enqueue(specFor('feedback', { subject: 'policies', rating: 2, text: 'meh' }, ctx));
    const sentRequests = [];
    const send = async (item) => {
      sentRequests.push(JSON.stringify(item.request));
      return { status: 201 };
    };
    const everything = async () => JSON.stringify(await storage.all());
    for (const text of [await everything()]) {
      assert.ok(!text.includes('w-ravi') && !text.includes('Ravi'), 'queued: no worker id or name');
      assert.ok(!/"ownerId":"/.test(text) && !/workerId|userId/.test(text));
    }
    await queue.sync({ send, ownerId: 'w-ravi' });
    assert.ok(sentRequests.every((r) => !r.includes('w-ravi') && !/workerId|ownerId|userId|name/.test(r)), 'sent: no identity in the request');
    assert.ok(!(await everything()).includes('w-ravi'), 'synced: still none');
  });

  test('the outbox sends anonymous items with no cookie and only the organisation token (reading outbox.js)', () => {
    const source = read('shared/outbox.js');
    assert.match(source, /credentials: 'omit'/);
    assert.match(source, /authorization: `Bearer \$\{token\}`/);
    const anonymousBranch = source.slice(source.indexOf('item.anonymous\n'), source.indexOf(': { credentials: \'same-origin\''));
    assert.doesNotMatch(anonymousBranch, /x-fairshift-owner|x-fairshift-app/, 'no worker header on an anonymous request');
  });

  test('an unknown action is refused', () => {
    assert.throws(() => specFor('teleport', {}, ctx), /unknown_kind/);
  });
});

describe('what the screens show while something is still waiting', () => {
  const today = { status: 'not_started', since: null, totalMinutes: 0 };
  const item = (kind, status, extra = {}) => ({ kind, status, capturedAt: 1000, request: { body: {} }, ...extra });

  test('a waiting check-in already counts as "working"; a waiting check-out as "done"', () => {
    assert.deepEqual(overlayToday(today, [item('checkin', 'queued')]), { ...today, status: 'working', since: 1000, pending: true });
    assert.equal(overlayToday({ ...today, status: 'working' }, [item('checkout', 'syncing')]).status, 'done');
    assert.equal(overlayToday(today, [item('checkin', 'queued'), item('checkout', 'queued', { capturedAt: 2000 })]).status, 'done');
  });

  test('sent and failed items change nothing (the server copy already has the sent ones)', () => {
    assert.equal(overlayToday(today, [item('checkin', 'synced'), item('checkin', 'failed')]), today);
  });

  test('a record with a dispute waiting cannot be contested a second time', () => {
    const ids = recordsWithWaitingDispute([
      item('dispute', 'queued', { request: { body: { shiftId: 'sh1' } } }),
      item('dispute', 'synced', { request: { body: null } }),
      item('dispute', 'failed', { request: { body: { shiftId: 'sh3' } } }),
      item('checkin', 'queued'),
    ]);
    assert.deepEqual([...ids], ['sh1']);
  });
});

describe('the service worker', () => {
  const worker = read('sw.js');
  const constant = (name) => Number(new RegExp(`const ${name} = ([\\d_]+)`).exec(worker)?.[1].replace(/_/g, ''));

  test('uses the same retry rules as the queue (the two copies cannot drift apart)', () => {
    assert.equal(constant('MAX_ATTEMPTS'), MAX_ATTEMPTS);
    assert.equal(constant('BASE_BACKOFF_MS'), BASE_BACKOFF_MS);
    assert.equal(constant('MAX_BACKOFF_MS'), MAX_BACKOFF_MS);
    assert.equal(constant('MAX_CAPTURE_AGE_MS'), MAX_CAPTURE_AGE_MS);
    assert.equal(MAX_CAPTURE_AGE_MS, OFFLINE.MAX_CAPTURE_AGE_MS, 'and the server limit');
  });

  test('syncs on the Background Sync event with the same tag, database and header rules as the page', () => {
    const page = read('shared/outbox.js');
    const db = read('shared/offline-db.js');
    for (const [name, pattern] of [['SYNC_TAG', /const SYNC_TAG = '([^']+)'/], ['LOCK_NAME', /const LOCK_NAME = '([^']+)'/]]) {
      assert.equal(pattern.exec(worker)[1], pattern.exec(page)[1], name);
    }
    assert.equal(/const DB_NAME = '([^']+)'/.exec(worker)[1], /export const DB_NAME = '([^']+)'/.exec(db)[1]);
    assert.match(worker, /addEventListener\('sync'/);
    for (const header of ['idempotency-key', 'x-fairshift-owner', "credentials: 'omit'"]) {
      assert.ok(worker.includes(header) && page.includes(header), header);
    }
  });

  test('never caches the API or anything personal: only static paths and the two shell pages', () => {
    assert.doesNotMatch(worker, /STATIC_PATH = [^\n]*\bapi\b/);
    assert.match(worker, /request\.method !== 'GET'/);
    assert.ok(!/cache\.put\([^)]*\/api/.test(worker));
  });

  test('the precache list covers every module the worker app can load, so it opens with no signal', () => {
    const { urls } = buildPrecacheList(publicDir);
    const have = new Set(urls);
    const missing = [];
    const seen = new Set();
    const visit = (url) => {
      if (seen.has(url)) return;
      seen.add(url);
      if (!have.has(url)) missing.push(url);
      if (!url.endsWith('.js')) return;
      const dir = path.posix.dirname(url);
      const code = read(url.slice(1));
      for (const match of code.matchAll(/(?:from\s+|import\()\s*'(\.{1,2}\/[^']+)'|screen\('(\.\/[^']+)'/g)) {
        visit(path.posix.normalize(path.posix.join(dir, match[1] ?? match[2])));
      }
    };
    visit('/worker/app.js');
    visit('/landing.js');
    assert.deepEqual(missing, []);
    for (const url of ['/', '/worker/', '/shared/base.css', '/worker/worker.css', '/i18n/en.json', '/i18n/hi.json', '/i18n/ta.json', '/manifest.webmanifest', '/icon.svg', '/shared/prefs-boot.js']) {
      assert.ok(have.has(url), url);
    }
    for (const url of urls) {
      const file = url === '/' ? 'index.html' : url.endsWith('/') ? `${url.slice(1)}index.html` : url.slice(1);
      assert.ok(statSync(path.join(publicDir, file)).isFile(), `${url} exists`);
    }
  });

  test('the precache list changes when a file changes (a new release gets a new cache)', () => {
    assert.match(buildPrecacheList(publicDir).version, /^[0-9a-f]{12}$/);
    assert.equal(buildPrecacheList(publicDir).version, buildPrecacheList(publicDir).version);
  });

  test('every file the worker pages load by <script> or <link> is in the list', () => {
    const { urls } = buildPrecacheList(publicDir);
    const html = read('worker/index.html');
    for (const match of html.matchAll(/(?:src|href)="(\/[^"]+)"/g)) {
      if (match[1] === '/') continue;
      assert.ok(urls.includes(match[1]) || match[1] === '/manifest.webmanifest', match[1]);
    }
  });

  test('every i18n file and shared module exists in the list (nothing is missed because a folder grew)', () => {
    const { urls } = buildPrecacheList(publicDir);
    const files = (dir) => readdirSync(path.join(publicDir, dir)).map((name) => `/${dir}/${name}`);
    for (const url of [...files('shared'), ...files('i18n'), ...files('worker').filter((u) => !u.endsWith('index.html'))]) assert.ok(urls.includes(url), url);
  });
});
