import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  BASE_BACKOFF_MS,
  MAX_ATTEMPTS,
  MAX_BACKOFF_MS,
  MAX_CAPTURE_AGE_MS,
  SYNCED_KEEP_MS,
  backoffMs,
  classify,
  createMemoryStorage,
  createQueue,
  describeQueue,
} from '../public/shared/queue.js';

const MIN = 60_000;

/** A queue on in-memory storage with a clock the test moves and predictable keys. */
function setup(storage = createMemoryStorage()) {
  const clock = { t: 1_000_000_000_000 };
  let n = 0;
  const queue = createQueue({ storage, now: () => clock.t, newKey: () => `key-${String(++n).padStart(4, '0')}-0123456789abcdefgh` });
  return { queue, storage, clock };
}

const spec = (text, extra = {}) => ({ kind: 'report', ownerId: 'w1', request: { path: '/grievances', body: { category: 'pay', text } }, display: { labelKey: 'outbox.kind.report' }, ...extra });
const anonSpec = (text, code = 'ABCDEFGHJKLMNPQR') => ({ kind: 'report', anonymous: true, trackingCode: code, request: { path: '/anonymous/grievances', body: { category: 'pay', text, trackingCode: code } }, display: { labelKey: 'outbox.kind.reportAnon' } });

/** A `send` that answers from a script and remembers what it was asked. */
function scripted(...answers) {
  const calls = [];
  const send = async (item) => {
    calls.push({ key: item.key, text: item.request.body?.text, deferred: item.deferred, body: item.request.body });
    const next = answers.length > 1 ? answers.shift() : answers[0];
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next(item) : next;
  };
  return { send, calls };
}
const ok = { status: 201 };

describe('classifying an answer', () => {
  test('success, sign-in needed, passing trouble, and a firm "no"', () => {
    assert.equal(classify({ status: 201 }), 'success');
    assert.equal(classify({ status: 200 }), 'success');
    assert.equal(classify({ status: 401 }), 'auth');
    assert.equal(classify({ status: 409, code: 'wrong_account' }), 'auth');
    for (const status of [0, 408, 425, 429, 500, 502, 503]) assert.equal(classify({ status }), 'transient', String(status));
    assert.equal(classify({ network: true }), 'transient');
    for (const [status, code] of [[400, 'x'], [403, 'forbidden'], [404, 'not_found'], [409, 'already_checked_in'], [409, 'idempotency_key_reused'], [422, 'invalid_code'], [422, 'captured_too_old']]) {
      assert.equal(classify({ status, code }), 'permanent', `${status} ${code}`);
    }
  });

  test('back-off grows 5 s, 10 s, 20 s ... and stops at 5 minutes', () => {
    assert.deepEqual([1, 2, 3, 4].map(backoffMs), [BASE_BACKOFF_MS, 2 * BASE_BACKOFF_MS, 4 * BASE_BACKOFF_MS, 8 * BASE_BACKOFF_MS]);
    assert.equal(backoffMs(30), MAX_BACKOFF_MS);
  });
});

describe('queuing', () => {
  test('actions are kept in the order they were made, each with its own idempotency key', async () => {
    const { queue, clock } = setup();
    await queue.enqueue(spec('first'));
    clock.t += 1000;
    await queue.enqueue(spec('second'));
    await queue.enqueue(spec('third'));
    const items = await queue.list();
    assert.deepEqual(items.map((i) => i.request.body.text), ['first', 'second', 'third']);
    assert.deepEqual(items.map((i) => i.seq), [1, 2, 3]);
    assert.equal(new Set(items.map((i) => i.key)).size, 3);
    assert.ok(items.every((i) => /^[A-Za-z0-9_-]{22,64}$/.test(i.key)), 'keys fit what the server accepts');
    assert.ok(items.every((i) => i.status === 'queued' && i.attempts === 0));
    assert.equal(items[0].capturedAt, 1_000_000_000_000, 'the capture time is when it was made, not when it is sent');
  });

  test('the same action tapped twice is kept once', async () => {
    const { queue } = setup();
    const a = await queue.enqueue(spec('same words'));
    const b = await queue.enqueue(spec('same words'));
    assert.equal(b.deduped, true);
    assert.equal(b.item.key, a.item.key);
    assert.equal((await queue.list()).length, 1);
    await queue.enqueue(spec('other words'));
    assert.equal((await queue.list()).length, 2);
  });

  test('an anonymous report tapped twice is kept once even though each tap makes a new tracking code', async () => {
    const { queue } = setup();
    const a = await queue.enqueue(anonSpec('Water leaks at the site', 'AAAAAAAABBBBBBBB'));
    const b = await queue.enqueue(anonSpec('Water leaks at the site', 'CCCCCCCCDDDDDDDD'));
    assert.equal(b.deduped, true);
    assert.equal(b.item.trackingCode, a.item.trackingCode, 'the worker keeps seeing the code they were already shown');
  });

  test('an action that was already sent can be made again (dedupe only covers what is still waiting)', async () => {
    const { queue } = setup();
    await queue.enqueue(spec('again'));
    await queue.sync({ send: scripted(ok).send });
    const second = await queue.enqueue(spec('again'));
    assert.equal(second.deduped, false);
  });

  test('items survive a reload: a new queue on the same storage sees them in the same order', async () => {
    const { queue, storage } = setup();
    await queue.enqueue(spec('one'));
    await queue.enqueue(spec('two'));
    const reopened = createQueue({ storage, newKey: () => 'unused-key-0123456789abcd' });
    assert.deepEqual((await reopened.list()).map((i) => i.request.body.text), ['one', 'two']);
  });

  test('a new item made while others wait is "deferred": it will carry its capture time', async () => {
    const { queue } = setup();
    const first = await queue.enqueue(spec('first'));
    const second = await queue.enqueue(spec('second'));
    assert.equal(first.item.deferred, false, 'nothing ahead of it: it can go at once, like an online request');
    assert.equal(second.item.deferred, true);
    const offline = await setup().queue.enqueue(spec('x', { deferred: true }));
    assert.equal(offline.item.deferred, true);
  });

  test('an unknown kind is refused', async () => {
    const { queue } = setup();
    await assert.rejects(queue.enqueue({ ...spec('x'), kind: 'launch_rocket' }), /unknown_kind/);
  });

  test('an anonymous item can never carry an identity: it is refused, not quietly cleaned', async () => {
    const { queue } = setup();
    await assert.rejects(queue.enqueue({ ...anonSpec('x'), ownerId: 'w1' }), /anonymous_item_has_identity/);
    await assert.rejects(queue.enqueue({ ...anonSpec('x'), display: { name: 'Ravi' } }), /anonymous_item_has_identity/);
    const body = { category: 'pay', text: 'x', workerId: 'w1' };
    await assert.rejects(queue.enqueue({ ...anonSpec('x'), request: { path: '/anonymous/grievances', body } }), /anonymous_item_has_identity/);
    const clean = await queue.enqueue(anonSpec('fine'));
    assert.equal(clean.item.ownerId, null);
    assert.ok(!JSON.stringify(clean.item).includes('w1'));
  });
});

describe('syncing', () => {
  test('sends oldest first, marks each sent, and keeps only what the list needs', async () => {
    const { queue, clock } = setup();
    await queue.enqueue(spec('a secret report text'));
    await queue.enqueue(anonSpec('another report', 'ZZZZZZZZYYYYYYYY'));
    const { send, calls } = scripted(ok);
    clock.t += 5000;
    const summary = await queue.sync({ send, ownerId: 'w1' });
    assert.deepEqual(calls.map((c) => c.text), ['a secret report text', 'another report'], 'capture order');
    assert.deepEqual([summary.synced, summary.failed, summary.remaining, summary.needsSignIn], [2, 0, 0, false]);
    const items = await queue.list();
    assert.ok(items.every((i) => i.status === 'synced' && i.syncedAt === clock.t && i.lastError === null));
    assert.ok(items.every((i) => i.request.body === null), 'the report text is no longer kept on the phone');
    assert.equal(items[1].trackingCode, 'ZZZZZZZZYYYYYYYY', 'the worker can still see their code');
  });

  test('a retry uses the same idempotency key every time', async () => {
    const { queue, clock } = setup();
    await queue.enqueue(spec('retry me'));
    const { send, calls } = scripted({ network: true }, { status: 503 }, ok);
    await queue.sync({ send });
    clock.t += BASE_BACKOFF_MS + 1;
    await queue.sync({ send });
    clock.t += 2 * BASE_BACKOFF_MS + 1;
    await queue.sync({ send });
    assert.equal(calls.length, 3);
    assert.equal(new Set(calls.map((c) => c.key)).size, 1, 'one key for every attempt, so the server can drop duplicates');
    assert.equal((await queue.list())[0].status, 'synced');
  });

  test('no signal: stops at the first item, keeps everything, and waits before trying again', async () => {
    const { queue, clock } = setup();
    for (const text of ['one', 'two', 'three']) await queue.enqueue(spec(text));
    const { send, calls } = scripted({ network: true });
    const first = await queue.sync({ send });
    assert.deepEqual([first.synced, first.remaining, first.stoppedBy], [0, 3, 'transient']);
    assert.equal(calls.length, 1, 'does not hammer a dead connection with every item');
    const [one, two] = await queue.list();
    assert.deepEqual([one.status, one.attempts, one.nextAttemptAt, one.lastError.code, one.deferred], ['queued', 1, clock.t + BASE_BACKOFF_MS, 'network', true]);
    assert.equal(two.attempts, 0);

    const early = await queue.sync({ send });
    assert.equal(early.stoppedBy, 'backoff');
    assert.equal(calls.length, 1, 'too soon: nothing is sent');
    const forced = await queue.sync({ send, force: true });
    assert.equal(calls.length, 2, '"Sync now" ignores the wait');
    assert.equal(forced.stoppedBy, 'transient');
  });

  test('after the signal returns, the waiting items go out in order', async () => {
    const { queue, clock } = setup();
    for (const text of ['one', 'two', 'three']) await queue.enqueue(spec(text));
    await queue.sync({ send: scripted({ network: true }).send });
    clock.t += 10 * MIN;
    const { send, calls } = scripted(ok);
    const summary = await queue.sync({ send });
    assert.deepEqual(calls.map((c) => c.text), ['one', 'two', 'three']);
    assert.equal(summary.synced, 3);
    assert.ok(calls.every((c) => c.deferred), 'they were delayed, so they carry their capture time');
  });

  test('too many failed tries: the item shows "failed, retry" and the rest are not blocked forever', async () => {
    const { queue, clock } = setup();
    await queue.enqueue(spec('stuck'));
    await queue.enqueue(spec('next'));
    const { send } = scripted({ status: 503, code: 'store_unavailable' });
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      clock.t += MAX_BACKOFF_MS + 1;
      await queue.sync({ send });
    }
    const [stuck, next] = await queue.list();
    assert.equal(stuck.status, 'failed');
    assert.equal(stuck.attempts, MAX_ATTEMPTS);
    assert.equal(stuck.lastError.code, 'store_unavailable');
    assert.equal(next.status, 'queued');
    const { send: later, calls } = scripted(ok);
    await queue.sync({ send: later });
    assert.deepEqual(calls.map((c) => c.text), ['next'], 'a failed item is not resent by itself');
  });

  test('a firm "no" marks that item failed and carries on with the next one', async () => {
    const { queue } = setup();
    for (const text of ['bad qr', 'good']) await queue.enqueue(spec(text));
    const { send, calls } = scripted({ status: 422, code: 'invalid_code' }, ok);
    const summary = await queue.sync({ send });
    assert.deepEqual([summary.failed, summary.synced, summary.remaining], [1, 1, 0]);
    const [bad, good] = await queue.list();
    assert.deepEqual([bad.status, bad.lastError, bad.attempts], ['failed', { status: 422, code: 'invalid_code' }, 0]);
    assert.equal(good.status, 'synced');
    assert.equal(calls.length, 2);
  });

  test('"Try again" puts a failed item back in line with fresh attempts; it is sent again with the same key', async () => {
    const { queue, clock } = setup();
    const { item } = await queue.enqueue(spec('retry after failure'));
    await queue.sync({ send: scripted({ status: 422, code: 'invalid_code' }).send });
    assert.equal((await queue.retry(item.id)).status, 'queued');
    const { send, calls } = scripted(ok);
    clock.t += 1000;
    await queue.sync({ send });
    assert.equal(calls[0].key, item.key);
    assert.equal((await queue.list())[0].status, 'synced');
    assert.equal(await queue.retry(item.id), null, 'only failed items can be retried');
  });

  test('retryAll re-queues every failed item and counts them', async () => {
    const { queue } = setup();
    await queue.enqueue(spec('a'));
    await queue.enqueue(spec('b'));
    await queue.sync({ send: scripted({ status: 400, code: 'invalid_input' }).send });
    assert.equal(await queue.retryAll(), 2);
    assert.deepEqual((await queue.list()).map((i) => i.status), ['queued', 'queued']);
  });

  test('401: everything stays queued, nothing is lost, and the worker is asked to sign in', async () => {
    const { queue } = setup();
    for (const text of ['one', 'two']) await queue.enqueue(spec(text));
    const { send, calls } = scripted({ status: 401, code: 'unauthorized' });
    const summary = await queue.sync({ send, ownerId: 'w1' });
    assert.deepEqual([summary.needsSignIn, summary.stoppedBy, summary.synced, summary.remaining], [true, 'auth', 0, 2]);
    assert.equal(calls.length, 1, 'does not try the rest with an expired session');
    const items = await queue.list();
    assert.ok(items.every((i) => i.status === 'queued'));
    assert.equal(items[0].attempts, 0, 'being signed out does not use up the attempts');
    assert.equal(items[0].lastError.code, 'unauthorized');

    const afterSignIn = scripted(ok);
    const done = await queue.sync({ send: afterSignIn.send, ownerId: 'w1', force: true });
    assert.deepEqual([done.synced, done.needsSignIn], [2, false]);
  });

  test('a queued action made by someone else is left for them, and the rest are still sent', async () => {
    const { queue } = setup();
    await queue.enqueue(spec('mine', { ownerId: 'w1' }));
    await queue.enqueue(spec('theirs', { ownerId: 'w2' }));
    await queue.enqueue(anonSpec('anonymous one'));
    const { send, calls } = scripted(ok);
    const summary = await queue.sync({ send, ownerId: 'w1' });
    assert.deepEqual(calls.map((c) => c.text), ['mine', 'anonymous one']);
    assert.equal(summary.needsSignIn, true);
    const theirs = (await queue.list()).find((i) => i.request.body?.text === 'theirs');
    assert.deepEqual([theirs.status, theirs.lastError.code], ['queued', 'wrong_account']);
  });

  test('the server saying "wrong_account" is also "sign in as the right person", not a failure', async () => {
    const { queue } = setup();
    await queue.enqueue(spec('x'));
    const summary = await queue.sync({ send: scripted({ status: 409, code: 'wrong_account' }).send });
    assert.deepEqual([summary.needsSignIn, (await queue.list())[0].status], [true, 'queued']);
  });

  test('a send that throws counts as no signal', async () => {
    const { queue } = setup();
    await queue.enqueue(spec('x'));
    const summary = await queue.sync({ send: scripted(new TypeError('Failed to fetch')).send });
    assert.equal(summary.stoppedBy, 'transient');
    assert.equal((await queue.list())[0].lastError.code, 'network');
  });

  test('an item cut off by a closed tab ("syncing") is sent again, with the same key', async () => {
    const { queue, storage } = setup();
    const { item } = await queue.enqueue(spec('interrupted'));
    await storage.put({ ...item, status: 'syncing' });
    const { send, calls } = scripted(ok);
    await queue.sync({ send });
    assert.deepEqual(calls.map((c) => c.key), [item.key]);
    assert.equal((await queue.list())[0].status, 'synced');
  });

  test('two syncs at once send each item once', async () => {
    const { queue } = setup();
    for (const text of ['one', 'two']) await queue.enqueue(spec(text));
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const calls = [];
    const send = async (item) => {
      calls.push(item.request.body.text);
      await gate;
      return ok;
    };
    const first = queue.sync({ send });
    const second = queue.sync({ send });
    release();
    await Promise.all([first, second]);
    assert.deepEqual(calls, ['one', 'two']);
  });

  test('something captured more than 48 hours ago is failed on the phone (the server would refuse it) and never sent', async () => {
    const { queue, clock } = setup();
    await queue.enqueue(spec('old', { deferred: true }));
    clock.t += MAX_CAPTURE_AGE_MS + MIN;
    const { send, calls } = scripted(ok);
    const summary = await queue.sync({ send });
    assert.equal(calls.length, 0);
    assert.equal(summary.failed, 1);
    assert.deepEqual((await queue.list())[0].lastError, { status: 422, code: 'captured_too_old' });
  });

  test('a normal (not delayed) item is not judged by age on the phone', async () => {
    const { queue, clock } = setup();
    await queue.enqueue(spec('fresh'));
    clock.t += MAX_CAPTURE_AGE_MS + MIN;
    const { send, calls } = scripted(ok);
    await queue.sync({ send });
    assert.equal(calls.length, 1);
  });
});

describe('tidying', () => {
  test('only failed or sent items can be removed; waiting ones never are', async () => {
    const { queue } = setup();
    const failed = await queue.enqueue(spec('failed'));
    const waiting = await queue.enqueue(spec('waiting'));
    await queue.sync({ send: scripted((item) => (item.request.body.text === 'failed' ? { status: 422, code: 'invalid_code' } : { network: true })).send });
    assert.equal(await queue.discard(waiting.item.id), false);
    assert.equal(await queue.discard(failed.item.id), true);
    assert.equal(await queue.discard('nope'), false);
    assert.deepEqual((await queue.list()).map((i) => i.request.body.text), ['waiting']);
  });

  test('sent items are tidied away after a day', async () => {
    const { queue, clock } = setup();
    await queue.enqueue(spec('done'));
    await queue.sync({ send: scripted(ok).send });
    clock.t += SYNCED_KEEP_MS - MIN;
    assert.equal(await queue.prune(), 0);
    clock.t += 2 * MIN;
    assert.equal(await queue.prune(), 1);
    assert.equal((await queue.list()).length, 0);
  });
});

describe('what the banner says', () => {
  const item = (status) => ({ status });
  const online = { online: true };

  test('nothing waiting and online: no banner', () => {
    assert.equal(describeQueue([], online).show, false);
    assert.equal(describeQueue([item('synced')], online).show, false);
  });

  test("offline with 2 waiting: \"You're offline, 2 actions waiting\"", () => {
    const state = describeQueue([item('queued'), item('queued')], { online: false });
    assert.deepEqual([state.state, state.messageKey, state.params], ['offline', 'outbox.offline.other', { count: 2 }]);
    assert.equal(describeQueue([item('queued')], { online: false }).messageKey, 'outbox.offline.one');
    assert.equal(describeQueue([], { online: false }).messageKey, 'outbox.offline.none');
  });

  test('online with waiting, sending, failed and sign-in states', () => {
    assert.equal(describeQueue([item('queued')], online).messageKey, 'outbox.waiting.one');
    assert.equal(describeQueue([item('queued'), item('syncing')], online).messageKey, 'outbox.syncing.other');
    assert.deepEqual(describeQueue([item('failed'), item('failed')], online).params, { count: 2 });
    assert.equal(describeQueue([item('failed')], online).state, 'failed');
    assert.equal(describeQueue([item('queued'), item('failed')], online).state, 'failed', 'something that needs the worker is said before something that will go by itself');
    const signIn = describeQueue([item('queued')], { online: true, needsSignIn: true });
    assert.deepEqual([signIn.state, signIn.messageKey], ['signin', 'outbox.signin.one']);
    assert.equal(describeQueue([], { online: true, needsSignIn: true }).show, false, 'nothing to send, nothing to say');
  });
});
