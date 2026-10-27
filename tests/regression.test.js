import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { startApp } from './helpers.js';

const SUBMISSIONS = 20;

/** Both roles signed in at once in one browser jar, like a judge with /worker and /admin in two tabs. */
describe('regression: sequences of submissions are never rejected', () => {
  let app;
  let worker;
  let admin;
  let jar;
  const as = (role, extra = {}) => ({ cookie: jar, headers: { 'x-fairshift-app': role }, ...extra });

  before(async () => {
    app = await startApp();
    worker = await app.login('worker-construction');
    admin = await app.login('admin-construction');
    jar = `${worker.cookie}; ${admin.cookie}`; // logging in as admin must not end the worker session
  });
  after(() => app.close());

  test('worker and employer sessions coexist: each role keeps working after the other signs in', async () => {
    assert.equal((await app.request('/api/attendance/today', as('worker'))).status, 200);
    assert.equal((await app.request('/api/admin/dashboard', as('admin'))).status, 200);
    assert.equal((await app.request('/api/me', as('worker'))).json.user.role, 'worker');
    assert.equal((await app.request('/api/me', as('admin'))).json.user.role, 'admin');
    // Without the header the role is guessed from the URL, so plain API clients still work.
    assert.equal((await app.request('/api/attendance/today', { cookie: jar })).status, 200);
    assert.equal((await app.request('/api/admin/dashboard', { cookie: jar })).status, 200);
  });

  test(`${SUBMISSIONS} mixed worker submissions in a row are all accepted`, async () => {
    const code = (await app.request('/api/admin/sites', as('admin'))).json.sites[0].code;
    const month = app.today.slice(0, 7);
    const steps = [
      () => ['/api/grievances', 'POST', { category: 'pay', text: 'Overtime was not paid this month' }],
      () => ['/api/feedback', 'POST', { subject: 'manager', rating: 4, text: 'Listens well' }],
      () => ['/api/attendance/check-in', 'POST', { method: 'code', code }],
      () => ['/api/grievances', 'POST', { category: 'scaffolding', text: 'Loose boards near the edge', anonymous: true }],
      () => ['/api/feedback', 'POST', { subject: 'conditions', rating: 2, text: '' }],
      () => ['/api/attendance/check-out', 'POST', undefined],
      () => ['/api/passport', 'POST', { type: 'training', title: 'First aid', issuer: 'Red Cross', issuedOn: app.daysAgo(3) }],
      () => ['/api/grievances', 'POST', { category: 'pay', text: 'Payslip looks wrong', source: 'payslip', month }],
      () => ['/api/passport/share', 'POST', undefined],
      () => ['/api/passport/share', 'DELETE', undefined],
    ];
    for (let i = 0; i < SUBMISSIONS; i += 1) {
      const [path, method, body] = steps[i % steps.length]();
      const res = await app.request(path, as('worker', { method, body }));
      assert.ok(res.status >= 200 && res.status < 300, `#${i + 1} ${method} ${path} gave ${res.status}: ${res.text}`);
      // The UI re-reads its data after every submission; that read must work too.
      const refresh = await app.request('/api/attendance/today', as('worker'));
      assert.equal(refresh.status, 200, `refresh after #${i + 1}`);
    }
  });

  test(`${SUBMISSIONS} mixed employer submissions in a row are all accepted`, async () => {
    const entries = [];
    const grievances = [];
    for (let i = 0; i < 7; i += 1) {
      const created = await app.request('/api/grievances', as('worker', { method: 'POST', body: { category: 'hours', text: `Long shift number ${i + 1}` } }));
      grievances.push(created.json.grievance.id);
    }
    const [first] = (await app.request('/api/admin/workers', as('admin'))).json.workers;
    let done = 0;
    const accept = (res, label) => {
      assert.ok(res.status >= 200 && res.status < 300, `${label} gave ${res.status}: ${res.text}`);
      done += 1;
    };
    for (const id of grievances.slice(0, 7)) {
      accept(await app.request(`/api/admin/grievances/${id}`, as('admin', { method: 'PATCH', body: { status: 'in_review' } })), 'in_review');
    }
    for (const id of grievances.slice(0, 7)) {
      accept(await app.request(`/api/admin/grievances/${id}`, as('admin', { method: 'PATCH', body: { status: 'resolved', note: 'Rota changed' } })), 'resolved');
    }
    for (let i = 0; i < 4; i += 1) {
      const added = await app.request(`/api/admin/workers/${first.id}/passport`, as('admin', { method: 'POST', body: { type: 'certification', title: `Certificate ${i}`, issuer: 'Safety Board', issuedOn: app.daysAgo(10) } }));
      accept(added, 'add entry');
      entries.push(added.json.id);
    }
    accept(await app.request('/api/admin/passport', as('admin')), 'list passport');
    accept(await app.request(`/api/admin/passport/${entries[0]}/verify`, as('admin', { method: 'POST' })), 'verify');
    accept(await app.request('/api/admin/dashboard', as('admin')), 'dashboard');
    assert.ok(done >= SUBMISSIONS, `only ${done} employer submissions ran`);
  });

  test('signing out as one role leaves the other signed in', async () => {
    const out = await app.request('/api/logout', as('admin', { method: 'POST' }));
    assert.equal(out.status, 204);
    const cleared = out.headers.getSetCookie().join(';');
    assert.match(cleared, /fs_admin=;/);
    assert.ok(!cleared.includes('fs_worker'));
  });

  test('normal use never trips the default rate limits', async () => {
    const fresh = await startApp();
    try {
      const { cookie } = await fresh.login('worker-college');
      for (let i = 0; i < 150; i += 1) {
        const res = await fresh.request('/api/attendance/today', { cookie });
        assert.equal(res.status, 200, `request ${i + 1}`);
      }
      for (let i = 0; i < 60; i += 1) assert.equal((await fresh.request('/')).status, 200);
    } finally {
      await fresh.close();
    }
  });
});
