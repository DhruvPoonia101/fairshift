import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { randomSecret, startApp } from './helpers.js';

describe('platform and security basics', () => {
  let app;
  before(async () => {
    app = await startApp();
  });
  after(() => app.close());

  test('GET /healthz is open and cheap', async () => {
    const res = await app.request('/healthz');
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { status: 'ok' });
  });

  test('responses carry a strict CSP and other security headers', async () => {
    const res = await app.request('/api/me');
    const csp = res.headers.get('content-security-policy');
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /script-src 'self'/);
    assert.match(csp, /object-src 'none'/);
    assert.ok(!/unsafe-inline|unsafe-eval/.test(csp));
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-powered-by'), null);
    assert.match(res.headers.get('permissions-policy'), /camera=\(self\)/);
  });

  test('rate limit headers are present on API responses', async () => {
    const res = await app.request('/api/me');
    assert.ok(res.headers.get('ratelimit-limit'));
    assert.ok(res.headers.get('ratelimit-remaining'));
  });

  test('unauthenticated requests get 401, unknown endpoints get a JSON 404', async () => {
    assert.equal((await app.request('/api/me')).status, 401);
    assert.equal((await app.request('/api/admin/dashboard')).status, 401);
    const missing = await app.request('/api/nope');
    assert.equal(missing.status, 404);
    assert.equal(missing.json.error.code, 'not_found');
  });

  test('errors never leak stack traces or file paths', async () => {
    const bad = await app.request('/api/feedback', { method: 'POST', body: '{broken', headers: { 'content-type': 'application/json' } });
    assert.equal(bad.status, 400);
    assert.ok(!/node_modules|\.js:\d+|at \w+/.test(bad.text));
  });

  test('bodies over 10 KB are rejected', async () => {
    const { cookie } = await app.login('worker-construction');
    const res = await app.request('/api/grievances', {
      method: 'POST',
      cookie,
      body: { category: 'pay', text: 'x'.repeat(20_000) },
    });
    assert.equal(res.status, 413);
  });

  test('writes must be JSON and same-origin', async () => {
    const { cookie } = await app.login('worker-construction');
    const form = await app.request('/api/grievances', {
      method: 'POST',
      cookie,
      body: 'category=pay',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    assert.equal(form.status, 415);
    const cross = await app.request('/api/attendance/check-out', {
      method: 'POST',
      cookie,
      headers: { origin: 'https://evil.example' },
    });
    assert.equal(cross.status, 403);
  });

  test('the session cookie is httpOnly and SameSite=Strict', async () => {
    const { res } = await app.login('worker-construction');
    const header = res.headers.getSetCookie()[0];
    assert.match(header, /HttpOnly/i);
    assert.match(header, /SameSite=Strict/i);
  });

  test('static pages are served and /p/:token serves the passport page', async () => {
    const home = await app.request('/');
    assert.equal(home.status, 200);
    assert.equal(home.headers.get('cache-control'), 'no-cache', 'static files revalidate, so releases show up at once');
    assert.equal((await app.request('/p/abcdefghijklmnopqrstuvwx')).status, 200);
  });
});

describe('rate limiting and login', () => {
  test('repeated wrong admin passwords get 429, but successful demo logins never count', async () => {
    const app = await startApp({
      envOverrides: { ADMIN_PASSWORD: randomSecret() },
      limits: { global: 1000, login: 3, report: 10 },
    });
    try {
      const wrong = () => app.request('/api/login/admin', { method: 'POST', body: { org: 'org-college', password: randomSecret() } });
      const statuses = [];
      for (let i = 0; i < 5; i += 1) statuses.push((await wrong()).status);
      assert.deepEqual(statuses, [401, 401, 401, 429, 429]);
      for (let i = 0; i < 6; i += 1) {
        assert.equal((await app.request('/api/demo-login/worker-college', { method: 'POST' })).status, 200);
      }
    } finally {
      await app.close();
    }
  });

  test('demo login is off unless DEMO_MODE is on', async () => {
    const app = await startApp({ envOverrides: { DEMO_MODE: 'false' } });
    try {
      assert.equal((await app.request('/api/demo-login/admin-college', { method: 'POST' })).status, 404);
    } finally {
      await app.close();
    }
  });

  test('admin password login works only when ADMIN_PASSWORD is set and matches', async () => {
    const password = randomSecret();
    const app = await startApp({ envOverrides: { DEMO_MODE: 'false', ADMIN_PASSWORD: password } });
    try {
      const body = { org: 'org-college' };
      const wrong = await app.request('/api/login/admin', { method: 'POST', body: { ...body, password: randomSecret() } });
      assert.equal(wrong.status, 401);
      const ok = await app.request('/api/login/admin', { method: 'POST', body: { ...body, password } });
      assert.equal(ok.status, 200);
      assert.equal(ok.json.user.role, 'admin');
      assert.equal(ok.json.org.id, 'org-college');
    } finally {
      await app.close();
    }
  });

  test('with no ADMIN_PASSWORD and DEMO_MODE off, admin login is disabled', async () => {
    const app = await startApp({ envOverrides: { DEMO_MODE: 'false' } });
    try {
      const res = await app.request('/api/login/admin', { method: 'POST', body: { org: 'org-college', password: randomSecret() } });
      assert.equal(res.status, 404);
    } finally {
      await app.close();
    }
  });
});

for (const [sector, workerRole, adminRole] of [
  ['construction', 'worker-construction', 'admin-construction'],
  ['college', 'worker-college', 'admin-college'],
]) {
  describe(`end to end: ${sector}`, () => {
    let app;
    let worker;
    let admin;
    before(async () => {
      app = await startApp();
      worker = await app.login(workerRole);
      admin = await app.login(adminRole);
    });
    after(() => app.close());

    test('login returns the session, org and sector settings', () => {
      assert.equal(worker.session.org.sector, sector);
      assert.equal(worker.session.user.role, 'worker');
      assert.ok(worker.session.sector.categories.some((c) => c.kind === 'hazard'));
      assert.equal(admin.session.user.role, 'admin');
    });

    test('a worker checks in with the typed code, sees today, and checks out', async () => {
      const sites = await app.request('/api/admin/sites', { cookie: admin.cookie });
      assert.equal(sites.status, 200);
      const { code } = sites.json.sites[0];
      assert.match(code, /^\d{6}$/);

      const wrong = await app.request('/api/attendance/check-in', { method: 'POST', cookie: worker.cookie, body: { method: 'code', code: '000000' } });
      assert.equal(wrong.status, 422);

      const inRes = await app.request('/api/attendance/check-in', { method: 'POST', cookie: worker.cookie, body: { method: 'code', code } });
      assert.equal(inRes.status, 201);
      const today = await app.request('/api/attendance/today', { cookie: worker.cookie });
      assert.equal(today.json.status, 'working');
      assert.equal(today.json.recent.length, 7);
      assert.ok(['amber', 'red', 'none'].includes(today.json.rest.level));

      app.clock.advance(8.5 * 60 * 60_000); // 23:30 IST, still the same day
      const out = await app.request('/api/attendance/check-out', { method: 'POST', cookie: worker.cookie });
      assert.equal(out.status, 200);
      const after = await app.request('/api/attendance/today', { cookie: worker.cookie });
      assert.equal(after.json.status, 'done');
      assert.equal(after.json.overtimeMinutes, 30);
    });

    test('the QR image is an SVG and only admins can fetch it', async () => {
      const sites = (await app.request('/api/admin/sites', { cookie: admin.cookie })).json.sites;
      const qr = await app.request(`/api/admin/sites/${sites[0].id}/qr.svg`, { cookie: admin.cookie });
      assert.equal(qr.status, 200);
      assert.match(qr.headers.get('content-type'), /image\/svg\+xml/);
      assert.equal((await app.request(`/api/admin/sites/${sites[0].id}/qr.svg`, { cookie: worker.cookie })).status, 403);
    });

    test('the payslip explains every line in integer paise', async () => {
      const month = app.today.slice(0, 7);
      const slip = await app.request(`/api/workers/${worker.session.user.id}/payslips/${month}`, { cookie: worker.cookie });
      assert.equal(slip.status, 200);
      const keys = slip.json.lines.map((l) => l.key);
      assert.ok(keys.includes('regular') && keys.includes('overtime') && keys.includes('pf'));
      assert.ok(slip.json.lines.every((l) => Number.isInteger(l.amountPaise)));
      assert.equal(slip.json.netPaise, slip.json.grossPaise - slip.json.deductionsPaise);
      assert.ok(slip.json.days.length > 0);
    });

    test('a worker files a grievance, the admin moves it to resolved, and the worker sees the note', async () => {
      const created = await app.request('/api/grievances', {
        method: 'POST',
        cookie: worker.cookie,
        body: { category: 'pay', text: 'Payslip looks wrong, overtime missing', source: 'payslip', month: app.today.slice(0, 7) },
      });
      assert.equal(created.status, 201);
      const id = created.json.grievance.id;
      assert.equal(created.json.grievance.severity, 'medium');

      const list = await app.request('/api/admin/grievances', { cookie: admin.cookie });
      assert.ok(list.json.items.some((g) => g.id === id && g.worker?.name === worker.session.user.name));

      const tooEarly = await app.request(`/api/admin/grievances/${id}`, { method: 'PATCH', cookie: admin.cookie, body: { status: 'resolved' } });
      assert.equal(tooEarly.status, 422);
      assert.equal((await app.request(`/api/admin/grievances/${id}`, { method: 'PATCH', cookie: admin.cookie, body: { status: 'in_review' } })).status, 200);
      const done = await app.request(`/api/admin/grievances/${id}`, { method: 'PATCH', cookie: admin.cookie, body: { status: 'resolved', note: 'Overtime added to payslip' } });
      assert.equal(done.status, 200);

      const mine = await app.request('/api/grievances', { cookie: worker.cookie });
      const seen = mine.json.items.find((g) => g.id === id);
      assert.equal(seen.status, 'resolved');
      assert.equal(seen.resolutionNote, 'Overtime added to payslip');
    });

    test('an anonymous report returns a tracking code and exposes no worker to the admin', async () => {
      const created = await app.request('/api/grievances', {
        method: 'POST',
        cookie: worker.cookie,
        body: { category: sector === 'construction' ? 'scaffolding' : 'fire_exit', text: 'The exit is blocked, please check', anonymous: true },
      });
      assert.equal(created.status, 201);
      const { trackingCode, grievance } = created.json;
      assert.ok(trackingCode);

      const adminView = await app.request('/api/admin/grievances', { cookie: admin.cookie });
      const item = adminView.json.items.find((g) => g.id === grievance.id);
      assert.equal(item.worker, null);
      assert.ok(!JSON.stringify(item).includes(worker.session.user.id));

      const tracked = await app.request('/api/grievances/track', { method: 'POST', body: { code: trackingCode } });
      assert.equal(tracked.status, 200);
      assert.equal(tracked.json.status, 'open');
      assert.equal((await app.request('/api/grievances/track', { method: 'POST', body: { code: 'ZZZZZ-ZZZZZ' } })).status, 404);
    });

    test('feedback is accepted and the admin only sees buckets with 3 or more answers', async () => {
      const post = (subject, rating) => app.request('/api/feedback', { method: 'POST', cookie: worker.cookie, body: { subject, rating, text: 'ok' } });
      assert.equal((await post('manager', 5)).status, 201);
      const report = await app.request('/api/admin/feedback', { cookie: admin.cookie });
      assert.equal(report.status, 200);
      assert.equal(report.json.buckets.length, 3);
      for (const bucket of report.json.buckets) {
        if (bucket.suppressed) assert.equal(bucket.comments, undefined);
        else assert.ok(bucket.count >= 3);
      }
      assert.equal(report.json.themes.source, 'rules');
    });

    test('dashboard has KPIs, a 14-day trend, fatigue and at-risk lists with reasons', async () => {
      const d = await app.request('/api/admin/dashboard', { cookie: admin.cookie });
      assert.equal(d.status, 200);
      assert.equal(d.json.trend.length, 14);
      assert.ok(d.json.fatigue.length >= 2);
      assert.ok(d.json.attrition.every((a) => a.reasons.length > 0));
      assert.equal(d.json.kpis.totalWorkers, 12);
    });

    test('skill passport: add, share publicly with minimal data, stop sharing', async () => {
      const add = await app.request('/api/passport', {
        method: 'POST',
        cookie: worker.cookie,
        body: { type: 'training', title: 'First aid', issuer: 'Red Cross', issuedOn: app.daysAgo(5) },
      });
      assert.equal(add.status, 201);
      assert.equal(add.json.verified, false);

      const verify = await app.request(`/api/admin/passport/${add.json.id}/verify`, { method: 'POST', cookie: admin.cookie });
      assert.equal(verify.json.verified, true);

      const { shareToken } = (await app.request('/api/passport/share', { method: 'POST', cookie: worker.cookie })).json;
      const pub = await app.request(`/api/public/passport/${shareToken}`);
      assert.equal(pub.status, 200);
      assert.deepEqual(Object.keys(pub.json).sort(), ['employer', 'entries', 'generatedOn', 'name', 'role', 'sector']);
      assert.ok(!pub.text.includes(worker.session.user.id));
      assert.ok(pub.json.entries.some((e) => e.title === 'First aid' && e.verified));

      await app.request('/api/passport/share', { method: 'DELETE', cookie: worker.cookie });
      assert.equal((await app.request(`/api/public/passport/${shareToken}`)).status, 404);
    });
  });
}

describe('authorization and validation', () => {
  let app;
  before(async () => {
    app = await startApp();
  });
  after(() => app.close());

  test("a worker cannot read another worker's payslip", async () => {
    const worker = await app.login('worker-construction');
    const others = await app.store.workers.query('org-construction');
    const other = others.find((w) => w.id !== worker.session.user.id);
    const res = await app.request(`/api/workers/${other.id}/payslips/${app.today.slice(0, 7)}`, { cookie: worker.cookie });
    assert.equal(res.status, 403);
  });

  test("an admin can read a worker's payslip in their own org but not in another org", async () => {
    const admin = await app.login('admin-construction');
    const own = (await app.store.workers.query('org-construction'))[0];
    const foreign = (await app.store.workers.query('org-college'))[0];
    const month = app.today.slice(0, 7);
    assert.equal((await app.request(`/api/workers/${own.id}/payslips/${month}`, { cookie: admin.cookie })).status, 200);
    assert.equal((await app.request(`/api/workers/${foreign.id}/payslips/${month}`, { cookie: admin.cookie })).status, 404);
  });

  test('admin lists never include another org\'s data', async () => {
    const admin = await app.login('admin-college');
    const roster = await app.request('/api/admin/workers', { cookie: admin.cookie });
    const collegeIds = new Set((await app.store.workers.query('org-college')).map((w) => w.id));
    assert.ok(roster.json.workers.every((w) => collegeIds.has(w.id)));
    const grievances = await app.request('/api/admin/grievances', { cookie: admin.cookie });
    assert.ok(grievances.json.items.length > 0);
    const construction = new Set((await app.store.grievances.query('org-construction')).map((g) => g.id));
    assert.ok(grievances.json.items.every((g) => !construction.has(g.id)));
  });

  test('a worker cannot call admin endpoints, and an admin cannot call worker endpoints', async () => {
    const worker = await app.login('worker-college');
    const admin = await app.login('admin-college');
    assert.equal((await app.request('/api/admin/grievances', { cookie: worker.cookie })).status, 403);
    assert.equal((await app.request('/api/admin/dashboard', { cookie: worker.cookie })).status, 403);
    assert.equal((await app.request('/api/attendance/today', { cookie: admin.cookie })).status, 403);
  });

  test('a forged or tampered session cookie is treated as signed out', async () => {
    const { cookie } = await app.login('admin-college');
    const tampered = cookie.slice(0, -3) + 'abc';
    assert.equal((await app.request('/api/admin/dashboard', { cookie: tampered })).status, 401);
  });

  test('invalid input is rejected with field names but no values', async () => {
    const { cookie } = await app.login('worker-construction');
    const cases = [
      ['/api/grievances', { category: 'pay', text: 'hi' }],
      ['/api/grievances', { category: '../etc', text: 'long enough text' }],
      ['/api/grievances', { category: 'pay', text: 12345 }],
      ['/api/grievances', { category: 'not_a_category', text: 'valid length text' }],
      ['/api/feedback', { subject: 'boss', rating: 3 }],
      ['/api/feedback', { subject: 'manager', rating: 6 }],
      ['/api/feedback', { subject: 'manager', rating: 2.5 }],
      ['/api/attendance/check-in', { method: 'carrier-pigeon' }],
      ['/api/attendance/check-in', { method: 'code' }],
      ['/api/attendance/check-in', { method: 'button', lat: 12.9 }],
      ['/api/attendance/check-in', { method: 'button', lat: 912, lng: 80 }],
      ['/api/passport', { type: 'training', title: 'A', issuer: 'B', issuedOn: 'yesterday' }],
    ];
    for (const [path, body] of cases) {
      const res = await app.request(path, { method: 'POST', cookie, body });
      assert.ok([422].includes(res.status), `${path} ${JSON.stringify(body)} gave ${res.status}`);
      assert.ok(res.json.error.code);
    }
    const bad = await app.request('/api/grievances', { method: 'POST', cookie, body: { category: 'pay', text: 'hi' } });
    assert.equal(bad.json.error.details.fields.text, 'too_short');
    assert.ok(!bad.text.includes('"hi"'));
  });

  test('bad path parameters are rejected', async () => {
    const { cookie } = await app.login('worker-construction');
    const me = (await app.request('/api/me', { cookie })).json.user.id;
    assert.equal((await app.request(`/api/workers/${me}/payslips/2026-13`, { cookie })).status, 422);
    assert.equal((await app.request(`/api/workers/${me}/payslips/not-a-month`, { cookie })).status, 422);
  });
});

describe('optional Gemini summary', () => {
  test('uses Gemini when configured, sending only anonymous comment text, and never exposes the key', async () => {
    const apiKey = randomSecret();
    const calls = [];
    const fetchImpl = async (url, options) => {
      calls.push({ url, options });
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '- Water is far away' }] } }] }) };
    };
    const app = await startApp({
      envOverrides: { GEMINI_API_KEY: apiKey, GEMINI_MODEL: 'test-model' },
      fetchImpl,
    });
    try {
      const admin = await app.login('admin-construction');
      const report = await app.request('/api/admin/feedback', { cookie: admin.cookie });
      assert.equal(report.json.themes.source, 'gemini');
      assert.equal(report.json.themes.summary, '- Water is far away');
      assert.ok(!report.text.includes(apiKey));
      assert.equal(calls.length, 1);
      assert.ok(!calls[0].url.includes(apiKey), 'the key travels in a header, not the URL');
      assert.ok(!calls[0].options.body.includes('w-con'), 'no worker ids are sent');
    } finally {
      await app.close();
    }
  });

  test('falls back to the rule-based counter when Gemini fails', async () => {
    const app = await startApp({
      envOverrides: { GEMINI_API_KEY: randomSecret(), GEMINI_MODEL: 'test-model' },
      fetchImpl: async () => {
        throw new Error('network down');
      },
    });
    try {
      const admin = await app.login('admin-construction');
      const report = await app.request('/api/admin/feedback', { cookie: admin.cookie });
      assert.equal(report.json.themes.source, 'rules');
      assert.ok(report.json.themes.themes.length > 0);
    } finally {
      await app.close();
    }
  });
});
