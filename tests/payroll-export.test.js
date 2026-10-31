import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { csvCell, hoursFromMinutes, rupees, toCsv } from '../src/lib/csv.js';
import { EXPORT_COLUMNS } from '../src/routes/payslips.js';
import { monthsBack } from '../public/shared/format.js';
import { startApp } from './helpers.js';

const MONTH = '2026-09'; // the previous month for the tests' fixed "now" (27 Oct 2026)

/** Minimal CSV reader for the tests: handles quotes, doubled quotes and line breaks inside quotes. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const body = text.replace(/^﻿/, '');
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i];
    if (quoted) {
      if (c === '"' && body[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\r' && body[i + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i += 1;
    } else cell += c;
  }
  return rows;
}

describe('CSV writing', () => {
  test('cells that a spreadsheet could run as a formula get a leading apostrophe', () => {
    for (const bad of ['=1+1', '+1', '-2', '@SUM(A1)', '\tcmd', '\rcmd', '=HYPERLINK("http://evil","x")']) {
      assert.ok(csvCell(bad).replace(/^"/, '').startsWith("'"), JSON.stringify(bad));
    }
    assert.equal(csvCell("=1+1"), "'=1+1");
    assert.equal(csvCell('Asha =not a formula'), 'Asha =not a formula', 'only the first character matters');
  });

  test('cells with a comma, quote or line break are quoted, and quotes are doubled', () => {
    assert.equal(csvCell('Kumar, Ravi'), '"Kumar, Ravi"');
    assert.equal(csvCell('say "hi"'), '"say ""hi"""');
    assert.equal(csvCell('two\nlines'), '"two\nlines"');
    assert.equal(csvCell('=A,B'), '"\'=A,B"', 'neutralised and quoted');
  });

  test('numbers and nothing are written plainly', () => {
    assert.equal(csvCell(12), '12');
    assert.equal(csvCell(0), '0');
    assert.equal(csvCell(null), '');
    assert.equal(csvCell(undefined), '');
  });

  test('integer paise become rupees with two decimals, never a float', () => {
    assert.equal(rupees(0), '0.00');
    assert.equal(rupees(5), '0.05');
    assert.equal(rupees(100), '1.00');
    assert.equal(rupees(123456), '1234.56');
    assert.equal(rupees(2_016_945), '20169.45');
    assert.equal(rupees(1_000_000_007), '10000000.07');
    assert.equal(hoursFromMinutes(510), '8.50');
    assert.equal(hoursFromMinutes(0), '0.00');
    assert.equal(hoursFromMinutes(20), '0.33');
  });

  test('the file starts with a byte-order mark (for Excel) and uses CRLF lines', () => {
    const text = toCsv(['a', 'b'], [['1', '2']]);
    assert.equal(text, '﻿a,b\r\n1,2\r\n');
  });
});

describe('the last months', () => {
  test('newest first, across a year end', () => {
    assert.deepEqual(monthsBack('2026-10', 3), ['2026-10', '2026-09', '2026-08']);
    assert.deepEqual(monthsBack('2026-01', 3), ['2026-01', '2025-12', '2025-11']);
    assert.deepEqual(monthsBack('2026-02', 1), ['2026-02']);
  });
});

describe('GET /api/admin/payroll/export', () => {
  let app;
  let admin;
  before(async () => {
    app = await startApp();
    admin = await app.login('admin-construction');
  });
  after(() => app.close());

  const exportOf = (cookie, month = MONTH) => app.request(`/api/admin/payroll/export${month === null ? '' : `?month=${month}`}`, { cookie });

  test('needs an employer sign-in: nothing without one, 403 for a worker', async () => {
    assert.equal((await exportOf(undefined)).status, 401);
    const worker = await app.login('worker-construction');
    assert.equal((await exportOf(worker.cookie)).status, 403);
  });

  test('sends a CSV attachment named for the org and the month', async () => {
    const res = await exportOf(admin.cookie);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^text\/csv; charset=utf-8/);
    assert.equal(res.headers.get('content-disposition'), `attachment; filename="fairshift-payroll-org-construction-${MONTH}.csv"`);
    assert.equal(res.headers.get('cache-control'), 'no-store');
  });

  test('has the agreed columns and one row per worker of the org, with figures that match the payslip', async () => {
    const res = await exportOf(admin.cookie);
    const [header, ...rows] = parseCsv(res.text).filter((r) => r.length > 1);
    assert.deepEqual(header, [...EXPORT_COLUMNS]);
    assert.deepEqual(header, ['worker name', 'worker code', 'days', 'regular hours', 'overtime hours', 'gross', 'PF', 'ESI', 'net', 'paid', 'shortfall', 'compliance status']);
    const workers = await app.store.workers.query('org-construction');
    assert.equal(rows.length, workers.length);
    assert.deepEqual(new Set(rows.map((r) => r[1])), new Set(workers.map((w) => w.id)));

    const demo = rows.find((r) => r[1] === 'w-con-01');
    const slip = (await app.request(`/api/workers/w-con-01/payslips/${MONTH}`, { cookie: admin.cookie })).json;
    assert.equal(demo[0], slip.worker.name);
    assert.equal(demo[2], String(slip.totals.daysWorked));
    assert.equal(demo[3], hoursFromMinutes(slip.totals.regularMinutes));
    assert.equal(demo[4], hoursFromMinutes(slip.totals.overtimeMinutes));
    assert.equal(demo[5], rupees(slip.grossPaise));
    assert.equal(demo[8], rupees(slip.netPaise));
    assert.equal(demo[9], rupees(slip.compliance.paidPaise));
    assert.equal(demo[10], rupees(slip.compliance.shortfallPaise));
    assert.equal(demo[11], slip.compliance.status);
    assert.equal(demo[11], 'underpaid');
    assert.match(demo[10], /^\d+\.\d{2}$/, 'rupees with two decimals');
  });

  test('every money cell is rupees with two decimals and every hours cell has two decimals', async () => {
    const rows = parseCsv((await exportOf(admin.cookie)).text).filter((r) => r.length > 1).slice(1);
    for (const r of rows) {
      for (const i of [3, 4]) assert.match(r[i], /^\d+\.\d{2}$/);
      for (const i of [5, 6, 7, 8, 10]) assert.match(r[i], /^\d+\.\d{2}$/);
      assert.ok(r[9] === '' || /^\d+\.\d{2}$/.test(r[9]), 'paid is blank when there is no payment record');
    }
  });

  test("only this org's workers are in it, and the other org's employer gets theirs", async () => {
    const text = (await exportOf(admin.cookie)).text;
    const college = await app.store.workers.query('org-college');
    for (const w of college) assert.ok(!text.includes(w.id) && !text.includes(w.name), w.id);

    const other = await app.login('admin-college');
    const otherText = (await exportOf(other.cookie)).text;
    assert.match(otherText, /w-col-/);
    assert.ok(!otherText.includes('w-con-'));
    assert.match((await exportOf(other.cookie)).headers.get('content-disposition'), /org-college/);
  });

  test('a worker whose name would run as a formula comes out as text', async () => {
    const evil = [
      ['w-evil-1', '=HYPERLINK("http://evil.example","click")'],
      ['w-evil-2', '+1+1'],
      ['w-evil-3', '-2+3'],
      ['w-evil-4', '@SUM(A1:A9)'],
      ['w-evil-5', '\tTabbed'],
      ['w-evil-6', '\rReturned'],
      ['w-evil-7', 'Kumar, "Ravi"'],
    ];
    for (const [id, name] of evil) {
      await app.store.workers.insert({ id, orgId: 'org-construction', name, role: 'mason', dailyWagePaise: 90_000, siteId: 'site-con-1', shiftId: 'day', isDemo: false, passportToken: null, joinedOn: '2020-01-01' });
    }
    const res = await exportOf(admin.cookie);
    const rows = parseCsv(res.text).filter((r) => r.length > 1);
    for (const [id, name] of evil) {
      const row = rows.find((r) => r[1] === id);
      assert.ok(row, id);
      if (/^[=+\-@\t\r]/.test(name)) assert.equal(row[0], `'${name}`, `${id} starts with an apostrophe`);
      else assert.equal(row[0], name, 'a comma and quotes survive intact');
      assert.ok(!/^[=+\-@\t\r]/.test(row[0]), 'no cell starts with a formula character');
    }
    // No cell anywhere begins with a formula character.
    for (const row of rows.slice(1)) for (const cell of row) assert.ok(!/^[=+\-@\t\r]/.test(cell), cell);
  });

  test('a month that is not YYYY-MM is refused without echoing it back', async () => {
    for (const bad of ['2026-13', '2026-00', 'abc', '2026-9', '2026-09-01', '%3Cscript%3Ealert(1)%3C/script%3E', "' OR 1=1 --", '../../etc/passwd']) {
      const res = await exportOf(admin.cookie, bad);
      assert.equal(res.status, 422, bad);
      assert.equal(res.json.error.code, 'invalid_input');
      assert.deepEqual(res.json.error.details.fields, { month: 'format' });
      for (const fragment of ['script', 'OR 1=1', 'passwd', '2026-13', 'alert']) assert.ok(!res.text.includes(fragment), `${bad} is not echoed (${fragment})`);
    }
  });

  test('without a month it exports last month; the current month is allowed (it shows "cannot be checked yet")', async () => {
    const none = await exportOf(admin.cookie, null);
    assert.equal(none.status, 200);
    assert.match(none.headers.get('content-disposition'), new RegExp(MONTH));
    const current = await exportOf(admin.cookie, '2026-10');
    assert.equal(current.status, 200);
    const rows = parseCsv(current.text).filter((r) => r.length > 1).slice(1);
    assert.ok(rows.every((r) => r[11] === 'review'));
  });
});

describe('GET /api/admin/payroll (the table on the Payroll page)', () => {
  let app;
  before(async () => {
    app = await startApp();
  });
  after(() => app.close());

  test('admin only; rows and a summary of the possible shortfall that match the compliance report', async () => {
    assert.equal((await app.request(`/api/admin/payroll?month=${MONTH}`)).status, 401);
    const worker = await app.login('worker-construction');
    assert.equal((await app.request(`/api/admin/payroll?month=${MONTH}`, { cookie: worker.cookie })).status, 403);

    const admin = await app.login('admin-construction');
    const table = (await app.request(`/api/admin/payroll?month=${MONTH}`, { cookie: admin.cookie })).json;
    const compliance = (await app.request(`/api/admin/compliance?month=${MONTH}`, { cookie: admin.cookie })).json;
    assert.equal(table.summary.underpaid, compliance.summary.underpaid);
    assert.equal(table.summary.shortfallPaise, compliance.summary.shortfallPaise);
    assert.ok(table.summary.underpaid >= 1);
    assert.equal(table.rows.length, table.summary.workers);
    assert.deepEqual(table.rows.map((r) => r.name), [...table.rows.map((r) => r.name)].sort((a, b) => a.localeCompare(b)));

    const bad = await app.request('/api/admin/payroll?month=nope', { cookie: admin.cookie });
    assert.equal(bad.status, 422);
    assert.ok(!bad.text.includes('nope'));
  });
});
