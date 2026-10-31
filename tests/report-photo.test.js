import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { MAX_PHOTO_BYTES, decodeJpegBase64, isJpeg } from '../src/lib/image.js';
import { createFirestoreStore } from '../src/store/firestore.js';
import { createMemoryStore } from '../src/store/memory.js';
import { seedStore } from '../src/store/seed.js';
import { dayKey, dayStartMs, fixedClock } from '../src/lib/time.js';
import { PHOTO, bytesToBase64, fitWithin, isJpegBytes, shrinkToTarget } from '../public/shared/photo.js';
import { specFor } from '../public/shared/actions.js';
import { createMemoryStorage, createQueue } from '../public/shared/queue.js';
import { createFakeFirestore } from './fake-firestore.js';
import { NOW, startApp } from './helpers.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');

/** Bytes that are a JPEG as far as its markers go (start FF D8 FF E0, end FF D9). `seed` makes different pictures. */
function jpegBytes(size = 4096, seed = 1) {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) bytes[i] = (i * 31 + seed * 17) % 251;
  bytes.set([0xff, 0xd8, 0xff, 0xe0], 0);
  bytes.set([0xff, 0xd9], size - 2);
  return bytes;
}
const jpeg64 = (size, seed) => Buffer.from(jpegBytes(size, seed)).toString('base64');

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(400, 7)]).toString('base64');
const GIF = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(400, 7)]).toString('base64');
const TEXT = Buffer.from('<html>' + 'x'.repeat(400)).toString('base64');
const NO_END_MARKER = Buffer.from(jpegBytes(500).map((b, i, all) => (i >= all.length - 2 ? 0 : b))).toString('base64');

const ORG = 'org-construction';
let seq = 0;
const key = () => `photo-key-${String(++seq).padStart(6, '0')}-abcdefghijklmnop`;
const post = (app, route, { cookie, body, idem, headers = {} }) =>
  app.request(`/api${route}`, { method: 'POST', cookie, body, headers: { ...(idem ? { 'idempotency-key': idem } : {}), ...headers } });

describe('what counts as a JPEG (src/lib/image.js)', () => {
  test('judged by its bytes, not by a name or a claimed type', () => {
    assert.ok(isJpeg(jpegBytes()));
    assert.ok(!isJpeg(Buffer.from(PNG, 'base64')));
    assert.ok(!isJpeg(Buffer.from(GIF, 'base64')));
    assert.ok(!isJpeg(Buffer.from(TEXT, 'base64')));
    assert.ok(!isJpeg(Buffer.from(NO_END_MARKER, 'base64')), 'a JPEG that never ends is not accepted');
    assert.ok(!isJpeg(jpegBytes(40)), 'too small to be a picture');
    assert.ok(!isJpeg(null));
  });

  test('the cap is 200 KB once decoded: the limit itself is fine, one byte more is not', () => {
    assert.equal(MAX_PHOTO_BYTES, 200 * 1024);
    assert.equal(decodeJpegBase64(jpeg64(MAX_PHOTO_BYTES)).length, MAX_PHOTO_BYTES);
    assert.throws(() => decodeJpegBase64(jpeg64(MAX_PHOTO_BYTES + 1)), { message: 'too_large' });
    assert.throws(() => decodeJpegBase64('A'.repeat(MAX_PHOTO_BYTES * 2)), { message: 'too_large' }, 'refused before it is even decoded');
  });

  test('the reasons are short words and never contain the picture', () => {
    const reasons = [[PNG, 'not_jpeg'], [GIF, 'not_jpeg'], [TEXT, 'not_jpeg'], ['not base64 !!', 'format'], [`data:image/jpeg;base64,${jpeg64(500)}`, 'format'], [jpeg64(500).slice(1), 'format'], [123, 'type'], [{ a: 1 }, 'type']];
    for (const [input, reason] of reasons) assert.throws(() => decodeJpegBase64(input), (error) => error.message === reason, String(reason));
  });
});

describe('the phone side (public/shared/photo.js)', () => {
  test('the long side is at most 1024 px, the shape is kept, a small picture is never enlarged', () => {
    assert.deepEqual(fitWithin(4000, 3000), { width: 1024, height: 768 });
    assert.deepEqual(fitWithin(3000, 4000), { width: 768, height: 1024 });
    assert.deepEqual(fitWithin(4000, 4000), { width: 1024, height: 1024 });
    assert.deepEqual(fitWithin(800, 600), { width: 800, height: 600 });
    assert.deepEqual(fitWithin(1024, 1), { width: 1024, height: 1 });
    assert.deepEqual(fitWithin(10_000, 1), { width: 1024, height: 1 }, 'never zero');
    for (const bad of [[0, 5], [5, 0], [-1, 5], [Number.NaN, 5]]) assert.throws(() => fitWithin(...bad), { message: 'photo_unreadable' });
  });

  test('the numbers agree with the server and the brief: 1024 px, q0.6 then one retry, 150 KB target, 200 KB hard cap', () => {
    assert.equal(PHOTO.MAX_SIDE, 1024);
    assert.equal(PHOTO.QUALITY, 0.6);
    assert.ok(PHOTO.RETRY_QUALITY < PHOTO.QUALITY);
    assert.equal(PHOTO.TARGET_BYTES, 150 * 1024);
    assert.equal(PHOTO.HARD_BYTES, MAX_PHOTO_BYTES, 'the phone and the server agree on the hard cap');
    assert.ok(PHOTO.TARGET_BYTES < PHOTO.HARD_BYTES);
  });

  test('quality 0.6 first; one lower quality if it is over 150 KB; then it refuses (never more than two tries)', async () => {
    const calls = [];
    const encoder = (sizes) => async (quality) => {
      calls.push(quality);
      return new Uint8Array(sizes[calls.length - 1]);
    };
    let result = await shrinkToTarget(encoder([100_000]));
    assert.deepEqual([result.attempts, result.quality, result.bytes.length], [1, 0.6, 100_000]);

    calls.length = 0;
    assert.equal((await shrinkToTarget(encoder([PHOTO.TARGET_BYTES]))).attempts, 1, 'exactly 150 KB is fine');

    calls.length = 0;
    result = await shrinkToTarget(encoder([200_000, 120_000]));
    assert.deepEqual([result.attempts, result.quality, calls], [2, PHOTO.RETRY_QUALITY, [0.6, PHOTO.RETRY_QUALITY]]);

    calls.length = 0;
    await assert.rejects(shrinkToTarget(encoder([300_000, 160_000])), { message: 'photo_too_big' });
    assert.equal(calls.length, 2, 'lowered once, then gave up');
  });

  test('base64 of a big picture round trips (no argument-list overflow) and the JPEG check matches the server', () => {
    const big = jpegBytes(180_000, 3);
    assert.equal(bytesToBase64(big), Buffer.from(big).toString('base64'));
    for (const sample of [jpegBytes(500), Buffer.from(PNG, 'base64'), Buffer.from(GIF, 'base64'), Buffer.from(NO_END_MARKER, 'base64'), jpegBytes(40)]) {
      assert.equal(isJpegBytes(sample), isJpeg(sample));
    }
  });

  test('a photo that passes the phone fits the server body limit (base64 of 200 KB is under 320 KB, with room for the words)', () => {
    const base64 = Math.ceil(MAX_PHOTO_BYTES / 3) * 4;
    assert.ok(base64 + 4 * 1000 + 500 < 320 * 1024);
  });

  test('the picker asks for an image from the back camera, has a Remove button and the privacy note in all three languages', () => {
    const picker = read('public/worker/photo-picker.js');
    assert.match(picker, /accept: 'image\/\*'/);
    assert.match(picker, /capture: 'environment'/);
    assert.match(picker, /t\('photo\.add'\)/);
    assert.match(picker, /t\('photo\.remove'\)/);
    assert.match(picker, /t\('photo\.privacy'\)/);
    assert.match(picker, /alt: t\('photo\.previewAlt'\)/, 'the preview has alt text');
    assert.match(picker, /role: 'status'/, 'progress and problems are announced');
    assert.match(read('public/worker/report.js'), /photo: picker\.value\(\)/);
    const en = JSON.parse(read('public/i18n/en.json'));
    assert.equal(en['photo.privacy'], 'Photos can show faces or places. Do not include people if you want to stay anonymous.');
    for (const lang of ['hi', 'ta']) assert.ok(JSON.parse(read(`public/i18n/${lang}.json`))['photo.privacy'].length > 20, lang);
  });

  test('the picture is drawn on a canvas (which writes a fresh file, so GPS and other EXIF data are not carried over)', () => {
    const code = read('public/shared/photo.js');
    assert.match(code, /toBlob\(resolve, 'image\/jpeg', quality\)/);
    assert.match(code, /drawImage\(source, 0, 0, width, height\)/);
    assert.ok(!/exif|piexif/i.test(code.replace(/EXIF data|EXIF/g, '')), 'no EXIF library is needed');
  });
});

describe('POST /grievances and /anonymous/grievances with a photo', () => {
  let app;
  let worker;
  let admin;
  let otherAdmin;
  before(async () => {
    app = await startApp();
    worker = await app.login('worker-construction');
    admin = await app.login('admin-construction');
    otherAdmin = await app.login('admin-college');
  });
  after(() => app.close());

  const named = (body, extra = {}) => post(app, '/grievances', { cookie: worker.cookie, body: { category: 'pay', text: 'The overtime was not paid.', ...body }, ...extra });
  const adminList = async (cookie = admin.cookie) => (await app.request('/api/admin/grievances', { cookie })).json.items;

  test('a report with a photo is saved; the answer says only that it has one, never the picture', async () => {
    const photo = jpeg64(5000, 2);
    const res = await named({ photo });
    assert.equal(res.status, 201);
    assert.equal(res.json.grievance.hasPhoto, true);
    assert.ok(!('photo' in res.json.grievance));
    assert.ok(!res.text.includes(photo.slice(0, 60)), 'the picture is not echoed');
    const stored = await app.store.grievances.get(ORG, res.json.grievance.id);
    assert.equal(stored.photo.mime, 'image/jpeg');
    assert.equal(stored.photo.bytes, 5000);
    assert.equal(stored.photo.data, photo);
  });

  test('a report without a photo works as before', async () => {
    const res = await named({});
    assert.equal(res.status, 201);
    assert.equal(res.json.grievance.hasPhoto, false);
    assert.ok(!('photo' in (await app.store.grievances.get(ORG, res.json.grievance.id))));
  });

  test('200 KB is accepted; over 200 KB is refused with a reason and nothing about the picture', async () => {
    assert.equal((await named({ photo: jpeg64(MAX_PHOTO_BYTES, 3) })).status, 201);
    const big = jpeg64(MAX_PHOTO_BYTES + 1, 4);
    const res = await named({ photo: big });
    assert.equal(res.status, 422);
    assert.equal(res.json.error.code, 'invalid_input');
    assert.deepEqual(res.json.error.details.fields, { photo: 'too_large' });
    assert.ok(!res.text.includes(big.slice(0, 40)));
  });

  test('a request body far over the photo limit is refused outright (413)', async () => {
    const res = await named({ photo: 'A'.repeat(400 * 1024) });
    assert.equal(res.status, 413);
    assert.equal(res.json.error.code, 'too_large');
  });

  test('only the picture may be big: 20 KB of words is refused (413) even when a photo comes with it', async () => {
    const words = 'x'.repeat(20_000);
    assert.equal((await named({ text: words })).status, 413);
    const withPhoto = await named({ text: words, photo: jpeg64(5000, 30) });
    assert.equal(withPhoto.status, 413);
    assert.equal(withPhoto.json.error.code, 'too_large');
    assert.equal((await named({ text: 'x'.repeat(1000), photo: jpeg64(MAX_PHOTO_BYTES, 31) })).status, 201, '1000 characters and a full-size photo fit');
  });

  test('anything that is not a JPEG is refused, however it is dressed up', async () => {
    const attempts = [[PNG, 'not_jpeg'], [GIF, 'not_jpeg'], [TEXT, 'not_jpeg'], [NO_END_MARKER, 'not_jpeg'], [`data:image/jpeg;base64,${jpeg64(500)}`, 'format'], ['@@@@', 'format'], [12345, 'type'], [['a'], 'type']];
    for (const [photo, reason] of attempts) {
      const res = await named({ photo });
      assert.equal(res.status, 422, String(reason));
      assert.deepEqual(res.json.error.details.fields, { photo: reason });
    }
    assert.equal((await post(app, '/anonymous/grievances', { body: { category: 'pay', text: 'Wages are late.', trackingCode: 'ABCDEFGHJKMNPQRS', photo: PNG } })).status, 401, 'no token, nothing');
  });

  test('other routes keep the small 10 KB limit', async () => {
    const res = await post(app, '/disputes', { cookie: worker.cookie, body: { note: 'x'.repeat(20_000) } });
    assert.equal(res.status, 413);
    const csp = (await app.request('/')).headers.get('content-security-policy');
    assert.match(csp, /img-src 'self' data:/);
    assert.ok(!/blob:|unsafe-inline|unsafe-eval|https?:/.test(csp), 'the CSP is as strict as before');
  });

  test('an anonymous report with a photo keeps zero identity: the picture is the only addition', async () => {
    const plain = await post(app, '/grievances', { cookie: worker.cookie, body: { category: 'pay', text: 'Anonymous without a photo.', anonymous: true } });
    const withPhoto = await post(app, '/grievances', { cookie: worker.cookie, body: { category: 'pay', text: 'Anonymous with a photo.', anonymous: true, photo: jpeg64(3000, 5) } });
    assert.equal(withPhoto.status, 201);
    const a = await app.store.grievances.get(ORG, plain.json.grievance.id);
    const b = await app.store.grievances.get(ORG, withPhoto.json.grievance.id);
    assert.deepEqual(Object.keys(b).sort(), [...Object.keys(a), 'photo'].sort(), 'only the photo is new');
    for (const record of [a, b]) {
      assert.ok(!('workerId' in record) && !('ownerId' in record) && !('userId' in record));
      assert.ok(!JSON.stringify({ ...record, photo: null }).includes(worker.session.user?.id ?? 'w-con-01'), 'no worker id anywhere');
    }
    assert.equal(b.createdAt, dayStartMs(dayKey(b.createdAt)), 'only the day of the report is kept, not the time');
    const listed = (await adminList()).find((g) => g.id === b.id);
    assert.equal(listed.worker, null);
    assert.equal(listed.hasPhoto, true);
    assert.ok(!('workerId' in listed));
  });

  test('the no-sign-in anonymous route takes a photo too, and stores no identity', async () => {
    const token = (await app.request('/api/anonymous/token', { cookie: worker.cookie })).json.token;
    const photo = jpeg64(2500, 6);
    const res = await post(app, '/anonymous/grievances', { body: { category: 'pay', text: 'No sign-in, with a photo.', trackingCode: 'QRSTUVWXYZ234567'.slice(0, 16), photo }, headers: { authorization: `Bearer ${token}` } });
    assert.equal(res.status, 201, res.text);
    const stored = await app.store.grievances.get(ORG, res.json.grievance.id);
    assert.equal(stored.photo.data, photo);
    assert.ok(!('workerId' in stored));
  });

  test('lists never carry the picture itself; only the admin photo route does', async () => {
    const photo = jpeg64(6000, 7);
    const made = await named({ photo, text: 'A list check with a photo.' });
    const mine = await app.request('/api/grievances', { cookie: worker.cookie });
    const all = await app.request('/api/admin/grievances', { cookie: admin.cookie });
    for (const res of [mine, all]) {
      assert.equal(res.status, 200);
      assert.ok(!res.text.includes(photo.slice(0, 80)), 'no picture in a list');
      assert.ok(res.json.items.find((g) => g.id === made.json.grievance.id).hasPhoto);
    }
    const tracked = await app.request('/api/grievances/track', { method: 'POST', body: { code: 'NOPE-NOPE' } });
    assert.ok(!tracked.text.includes('photo'));
  });

  test('the employer can fetch the picture: an image, never cached, never sniffed', async () => {
    const photo = jpeg64(7000, 8);
    const made = await named({ photo, text: 'Fetch my photo as the employer.' });
    const res = await fetch(`${app.base}/api/admin/grievances/${made.json.grievance.id}/photo`, { headers: { cookie: admin.cookie } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/jpeg');
    assert.match(res.headers.get('cache-control'), /no-store/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), Buffer.from(photo, 'base64'));
  });

  test('only an employer of that organisation can see it; a report with no photo is not found', async () => {
    const made = await named({ photo: jpeg64(3500, 9), text: 'Org isolation check.' });
    const url = `/api/admin/grievances/${made.json.grievance.id}/photo`;
    assert.equal((await app.request(url)).status, 401);
    assert.equal((await app.request(url, { cookie: worker.cookie })).status, 403, 'a worker cannot');
    assert.equal((await app.request(url, { cookie: otherAdmin.cookie })).status, 404, "another organisation's employer cannot");
    assert.ok(!(await adminList(otherAdmin.cookie)).some((g) => g.id === made.json.grievance.id), 'not even in the list');
    const without = await named({ text: 'Nothing attached here.' });
    assert.equal((await app.request(`/api/admin/grievances/${without.json.grievance.id}/photo`, { cookie: admin.cookie })).status, 404);
    assert.equal((await app.request('/api/admin/grievances/not%20an%20id/photo', { cookie: admin.cookie })).status, 422);
  });

  test('the same Idempotency-Key makes one report with one picture; the same key with another picture is refused', async () => {
    const before = (await app.store.grievances.query(ORG)).length;
    const idem = key();
    const first = await named({ photo: jpeg64(4000, 10), text: 'Sent twice, one report.' }, { idem });
    const second = await named({ photo: jpeg64(4000, 10), text: 'Sent twice, one report.' }, { idem });
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    assert.equal(second.json.grievance.id, first.json.grievance.id);
    assert.equal((await app.store.grievances.query(ORG)).length, before + 1);
    const other = await named({ photo: jpeg64(4000, 11), text: 'Sent twice, one report.' }, { idem });
    assert.equal(other.status, 409, 'a different picture under the same key is a client bug');
  });

  test('the seeded demo data has no photos', async () => {
    const fresh = createMemoryStore();
    await seedStore(fresh, { clock: fixedClock(NOW) });
    for (const orgId of ['org-construction', 'org-college', 'org-hospital']) {
      assert.ok((await fresh.grievances.query(orgId)).every((g) => !('photo' in g)), `${orgId} seeds with no photo`);
    }
  });
});

describe('Reset demo data removes the photos too', () => {
  const stores = {
    memory: async (clock) => {
      const store = createMemoryStore();
      await seedStore(store, { clock });
      return store;
    },
    firestore: async (clock) => {
      const store = createFirestoreStore({ db: createFakeFirestore(), logError: () => {} });
      await seedStore(store, { clock });
      return store;
    },
  };
  for (const [kind, makeStore] of Object.entries(stores)) {
    test(`on the ${kind} store, only that organisation's pictures go`, async () => {
      const store = await makeStore(fixedClock(NOW));
      const app = await startApp({ store });
      try {
        const worker = await app.login('worker-construction');
        const admin = await app.login('admin-construction');
        const college = await app.login('worker-college');
        const mine = await post(app, '/grievances', { cookie: worker.cookie, body: { category: 'pay', text: 'A photo that will be reset.', photo: jpeg64(3000, 12) } });
        const theirs = await post(app, '/grievances', { cookie: college.cookie, body: { category: 'pay', text: 'A photo of another org.', photo: jpeg64(3000, 13) } });
        assert.equal(mine.status, 201);
        assert.equal(theirs.status, 201);
        assert.ok((await store.grievances.get(ORG, mine.json.grievance.id)).photo);

        const reset = await app.request('/api/admin/demo/reset', { method: 'POST', cookie: admin.cookie, body: { confirm: true } });
        assert.equal(reset.status, 200);
        assert.equal(await store.grievances.get(ORG, mine.json.grievance.id), null, 'the report and its picture are gone');
        assert.ok((await store.grievances.query(ORG)).every((g) => !('photo' in g)), 'and the rebuilt data has none');
        assert.ok((await store.grievances.get('org-college', theirs.json.grievance.id)).photo, "another organisation's picture is untouched");
        assert.equal((await app.request(`/api/admin/grievances/${mine.json.grievance.id}/photo`, { cookie: admin.cookie })).status, 404);
      } finally {
        await app.close();
      }
    });
  }
});

describe('the offline outbox carries the photo', () => {
  const ctx = { ownerId: 'w-con-01' };

  test('the request body of a report holds the photo, named or anonymous, and nothing else is added', () => {
    const photo = jpeg64(3000, 14);
    const named = specFor('report', { category: 'pay', text: 'hello there', anonymous: false, photo }, ctx);
    assert.equal(named.request.body.photo, photo);
    const anon = specFor('report', { category: 'pay', text: 'hello there', anonymous: true, photo }, ctx);
    assert.equal(anon.request.body.photo, photo);
    assert.equal(anon.request.path, '/anonymous/grievances');
    assert.equal(anon.ownerId, null);
    for (const spec of [named, anon]) assert.ok(!JSON.stringify(spec.display).includes(photo.slice(0, 40)), 'the picture is not in what the list shows');
    for (const body of [specFor('report', { category: 'pay', text: 'hello there', anonymous: false }, ctx).request.body, specFor('report', { category: 'pay', text: 'hello there', anonymous: true }, ctx).request.body]) {
      assert.ok(!('photo' in body), 'no photo, no field');
    }
  });

  test('queued with no signal, stored as IndexedDB would store it, sent later with the SAME Idempotency-Key: one report, picture intact', async () => {
    const app = await startApp();
    try {
      const worker = await app.login('worker-construction');
      const storage = createMemoryStorage(); // structuredClone on every read and write, like IndexedDB
      let clock = NOW - 3 * 60 * 60_000;
      const queue = createQueue({ storage, now: () => clock, newKey: key });
      const photo = jpeg64(120_000, 15);
      const { item } = await queue.enqueue({ ...specFor('report', { category: 'pay', text: 'Reported with no signal, with a photo.', anonymous: false, photo }, ctx), deferred: true });

      const stored = (await storage.all())[0];
      assert.equal(stored.request.body.photo, photo, 'the picture survives being stored');
      assert.ok(stored.basis.length < 600, 'the de-duplication key does not copy the picture');
      assert.equal(stored.key, item.key);

      const seen = [];
      let accepted = 0;
      const send = async (queued) => {
        const body = queued.deferred ? { ...queued.request.body, capturedAt: queued.capturedAt } : queued.request.body;
        const res = await post(app, queued.request.path, { cookie: worker.cookie, body, idem: queued.key });
        seen.push({ key: queued.key, status: res.status });
        accepted += res.status === 201 ? 1 : 0;
        if (seen.length === 1) throw new Error('connection dropped after the server answered'); // the answer never reached the phone
        return { status: res.status };
      };
      clock = NOW;
      const first = await queue.sync({ send });
      assert.equal(first.stoppedBy, 'transient', 'the phone thinks it failed');
      clock = NOW + 10 * 60_000;
      const second = await queue.sync({ send, force: true });
      assert.equal(second.synced, 1);

      assert.equal(seen.length, 2, 'it was sent twice');
      assert.equal(new Set(seen.map((s) => s.key)).size, 1, 'under one and the same key');
      assert.equal(accepted, 2);
      const reports = (await app.store.grievances.query(ORG)).filter((g) => g.text === 'Reported with no signal, with a photo.');
      assert.equal(reports.length, 1, 'exactly one report');
      assert.equal(reports[0].photo.data, photo, 'with the picture, unchanged');
      assert.equal(reports[0].recordedOffline, true);
      assert.equal((await storage.all())[0].request.body, null, 'once sent, the picture is no longer kept on the phone');
    } finally {
      await app.close();
    }
  });

  test('an anonymous report with a photo queued offline is sent with no sign-in at all and keeps no identity', async () => {
    const app = await startApp();
    try {
      const worker = await app.login('worker-construction');
      const token = (await app.request('/api/anonymous/token', { cookie: worker.cookie })).json.token;
      const queue = createQueue({ storage: createMemoryStorage(), now: () => NOW - 60 * 60_000, newKey: key });
      const photo = jpeg64(9000, 16);
      const spec = specFor('report', { category: 'pay', text: 'Anonymous offline with a photo.', anonymous: true, photo }, ctx);
      await queue.enqueue({ ...spec, deferred: true });
      const summary = await queue.sync({
        send: async (queued) => {
          const body = { ...queued.request.body, capturedAt: queued.capturedAt };
          const res = await post(app, queued.request.path, { body, idem: queued.key, headers: { authorization: `Bearer ${token}` } });
          return { status: res.status, code: res.json?.error?.code };
        },
      });
      assert.equal(summary.synced, 1, JSON.stringify(summary));
      const stored = (await app.store.grievances.query(ORG)).find((g) => g.text === 'Anonymous offline with a photo.');
      assert.equal(stored.photo.data, photo);
      assert.ok(!('workerId' in stored));
    } finally {
      await app.close();
    }
  });

  test('the same photo tapped twice is one waiting item; a different photo is another', async () => {
    const queue = createQueue({ storage: createMemoryStorage(), newKey: key });
    const base = { category: 'pay', text: 'Tapped twice by mistake.', anonymous: false };
    const a = await queue.enqueue(specFor('report', { ...base, photo: jpeg64(3000, 20) }, ctx));
    const again = await queue.enqueue(specFor('report', { ...base, photo: jpeg64(3000, 20) }, ctx));
    const other = await queue.enqueue(specFor('report', { ...base, photo: jpeg64(3000, 21) }, ctx));
    const none = await queue.enqueue(specFor('report', base, ctx));
    assert.equal(again.deduped, true);
    assert.equal(again.item.key, a.item.key);
    assert.equal(other.deduped, false);
    assert.equal(none.deduped, false);
  });
});

describe('the employer screen', () => {
  const code = read('public/admin/grievances.js');

  test('a small thumbnail with alt text; selecting it opens an accessible dialog with the larger picture', () => {
    assert.match(code, /item\.hasPhoto \? photoThumb\(item\)/);
    assert.match(code, /type: 'button',\s*class: 'photo-thumb'/, 'a real button: keyboard and screen reader friendly');
    assert.match(code, /alt: t\('photo\.thumbAlt'\)/);
    assert.match(code, /alt: t\('photo\.alt'\)/);
    assert.match(code, /openDialog\(\{\s*title: t\('photo\.dialogTitle'\)/, 'the native dialog traps focus, closes on Esc and returns focus');
    assert.match(code, /\/api\/admin\/grievances\/\$\{item\.id\}\/photo/);
    assert.match(read('public/shared/base.css'), /\.photo-thumb-img \{ width: 4rem; height: 4rem/, 'a big enough target');
  });
});
