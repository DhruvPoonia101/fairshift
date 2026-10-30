import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { DEMO_ROLES, SECTORS, categoriesFor, orgIdFor, sectorChoices } from '../src/config/sectors.js';
import { addDays } from '../src/lib/time.js';
import { DEFAULT_FATIGUE_RULES, evaluateFatigue, resolveFatigueRules } from '../src/services/fatigue.js';
import { suggestSeverity } from '../src/services/grievance.js';
import { istMs, randomSecret, shiftOf, startApp } from './helpers.js';

const SECTOR_IDS = Object.keys(SECTORS);
const HOSPITAL = SECTORS.hospital;

test('three sectors are configured and every demo role and sign-in choice is derived from them', () => {
  assert.deepEqual(SECTOR_IDS, ['construction', 'college', 'hospital']);
  assert.deepEqual(
    DEMO_ROLES,
    SECTOR_IDS.flatMap((id) => [`worker-${id}`, `admin-${id}`]),
  );
  assert.deepEqual(sectorChoices(), [
    { id: 'construction', orgId: 'org-construction', icon: 'building' },
    { id: 'college', orgId: 'org-college', icon: 'users' },
    { id: 'hospital', orgId: 'org-hospital', icon: 'heart' },
  ]);
});

describe('sector configuration is complete and consistent', () => {
  for (const id of SECTOR_IDS) {
    test(`${id}: roles, wages, shifts, sites and categories are well formed`, () => {
      const sector = SECTORS[id];
      assert.ok(sector.orgName && sector.icon);
      assert.ok(sector.roles.length >= 2);
      for (const role of sector.roles) {
        assert.ok(Number.isInteger(role.dailyWagePaise) && role.dailyWagePaise > 0, `${role.id} wage is integer paise`);
        assert.equal(role.dailyWagePaise % 8, 0, `${role.id} divides into whole paise per hour`);
      }
      assert.ok(sector.sites.length >= 2);
      assert.equal(new Set(sector.sites.map((s) => s.id)).size, sector.sites.length);
      for (const shift of sector.shifts) assert.ok(shift.startMinute >= 0 && shift.startMinute < 1440);
      const ids = categoriesFor(id).map((c) => c.id);
      assert.equal(new Set(ids).size, ids.length, 'category ids are unique');
      assert.ok(sector.hazardCategories.length >= 4);
      assert.ok(sector.geofenceRadiusMeters > 0);
    });
  }

  test('hospital has the departments, roles, shifts and safety categories that were asked for', () => {
    assert.deepEqual(HOSPITAL.sites.map((s) => s.name), ['ICU', 'Emergency', 'General Ward']);
    assert.deepEqual(HOSPITAL.roles.map((r) => r.id), ['nurse', 'ward_staff']);
    assert.ok(HOSPITAL.shifts.some((s) => s.id === 'night'));
    assert.deepEqual(
      HOSPITAL.hazardCategories.map((c) => c.id),
      ['needle_stick', 'patient_aggression', 'equipment_fault', 'infection_exposure'],
    );
  });
});

describe('hospital fatigue rules are config, and stricter than the defaults', () => {
  const rules = resolveFatigueRules(HOSPITAL.fatigue);
  const TODAY = '2026-10-27';
  const NOW = istMs(TODAY, '12:00');
  const day = (n) => addDays(TODAY, -n);
  const flagNames = (flags) => flags.map((f) => f.rule);

  test('resolving a sector with no overrides gives the defaults, with night rules off', () => {
    assert.deepEqual(resolveFatigueRules(SECTORS.construction.fatigue), DEFAULT_FATIGUE_RULES);
    assert.equal(DEFAULT_FATIGUE_RULES.night, null);
  });

  test('45 hours in a week flags in the hospital but not under the default 48 hour rule', () => {
    const fiveNines = [1, 2, 3, 4, 5].map((n) => shiftOf(istMs(day(n), '08:00'), 540));
    assert.deepEqual(flagNames(evaluateFatigue(fiveNines, NOW)), []);
    assert.deepEqual(flagNames(evaluateFatigue(fiveNines, NOW, rules)), ['week_hours']);
  });

  test('each flag carries the limit that applied, so the wording follows the sector config', () => {
    const tenHours = [1, 2, 3, 4, 5, 6].map((n) => shiftOf(istMs(day(n), '08:00'), 560));
    const limit = (r) => evaluateFatigue(tenHours, NOW, r).find((f) => f.rule === 'week_hours').params.limitHours;
    assert.equal(limit(DEFAULT_FATIGUE_RULES), 48);
    assert.equal(limit(rules), 44);
    const rest = evaluateFatigue(
      [shiftOf(istMs(day(2), '08:00'), 480), shiftOf(istMs(day(1), '03:00'), 480)],
      NOW,
      rules,
    ).find((f) => f.rule === 'short_rest');
    assert.equal(rest.params.limitHours, 12);
  });

  test('rest between shifts must be 12 hours in the hospital (11 by default)', () => {
    const first = shiftOf(istMs(day(2), '08:00'), 480); // ends 16:00
    const next = shiftOf(istMs(day(1), '03:00'), 480); // exactly 11 hours later
    assert.deepEqual(flagNames(evaluateFatigue([first, next], NOW)), []);
    assert.ok(flagNames(evaluateFatigue([first, next], NOW, rules)).includes('short_rest'));
  });

  const nights = (daysAgo) => daysAgo.map((n) => shiftOf(istMs(day(n), '21:00'), 480));

  test('three night shifts in a row are allowed, a fourth raises night_streak', () => {
    assert.ok(!flagNames(evaluateFatigue(nights([3, 2, 1]), NOW, rules)).includes('night_streak'));
    const flags = evaluateFatigue(nights([4, 3, 2, 1]), NOW, rules);
    assert.equal(flags.find((f) => f.rule === 'night_streak').params.days, 4);
  });

  test('a gap in the nights resets the streak', () => {
    assert.ok(!flagNames(evaluateFatigue(nights([5, 4, 2, 1]), NOW, rules)).includes('night_streak'));
  });

  test('rest after a night shift must be 24 hours before a day shift: 23h59 flags, 24h does not', () => {
    const dayShift = shiftOf(istMs(day(1), '06:00'), 480);
    const nightEndingAtSix = shiftOf(istMs(day(3), '22:00'), 480); // ends 06:00 two days ago: exactly 24 h of rest
    const nightEndingAtOne = shiftOf(istMs(day(3), '22:00'), 481); // ends 06:01: 23 h 59 min of rest
    assert.ok(!flagNames(evaluateFatigue([nightEndingAtSix, dayShift], NOW, rules)).includes('short_rest_after_night'));
    const flags = evaluateFatigue([nightEndingAtOne, dayShift], NOW, rules);
    assert.equal(flags.find((f) => f.rule === 'short_rest_after_night').params.minutes, 24 * 60 - 1);
  });

  test('going from one night shift straight into another is not a "rest after night" case', () => {
    assert.ok(!flagNames(evaluateFatigue(nights([2, 1]), NOW, rules)).includes('short_rest_after_night'));
  });

  test('sectors without a night block never raise night rules, whatever the roster', () => {
    const names = flagNames(evaluateFatigue(nights([6, 5, 4, 3, 2, 1]), NOW, resolveFatigueRules(SECTORS.college.fatigue)));
    assert.ok(!names.includes('night_streak') && !names.includes('short_rest_after_night'));
  });
});

describe('severity floors come from the category config', () => {
  test('hospital hazards that are serious by nature are always high', () => {
    const find = (id) => categoriesFor('hospital').find((c) => c.id === id);
    assert.equal(suggestSeverity('The bin is a bit full', find('needle_stick')), 'high');
    assert.equal(suggestSeverity('Visitors shouted at us', find('patient_aggression')), 'high');
    assert.equal(suggestSeverity('Monitor screen flickers', find('equipment_fault')), 'medium');
    assert.equal(suggestSeverity('Please change my break', find('hours')), 'low');
  });
});

describe('every sector runs the core flows through the real API', () => {
  let app;
  before(async () => {
    app = await startApp();
  });
  after(() => app.close());

  test('the sign-in screen config lists all three sectors', async () => {
    const { json } = await app.request('/api/config');
    assert.deepEqual(json.sectors.map((s) => s.id), SECTOR_IDS);
    assert.equal((await app.request('/api/demo-login/worker-factory', { method: 'POST' })).status, 404);
  });

  for (const id of SECTOR_IDS) {
    test(`${id}: login, check-in, payslip, anonymous hazard report, dashboard, feedback, passport`, async () => {
      const sector = SECTORS[id];
      const worker = await app.login(`worker-${id}`);
      const admin = await app.login(`admin-${id}`);
      assert.equal(worker.session.org.id, orgIdFor(id));
      assert.equal(worker.session.org.name, sector.orgName);
      assert.deepEqual(
        worker.session.sector.categories.map((c) => c.id),
        categoriesFor(id).map((c) => c.id),
      );

      // check-in with the site code from the employer screen
      const sites = (await app.request('/api/admin/sites', { cookie: admin.cookie })).json.sites;
      assert.equal(sites.length, sector.sites.length);
      const checkIn = await app.request('/api/attendance/check-in', { method: 'POST', cookie: worker.cookie, body: { method: 'code', code: sites[0].code } });
      assert.equal(checkIn.status, 201);
      assert.equal((await app.request('/api/attendance/today', { cookie: worker.cookie })).json.status, 'working');
      const qr = await app.request(`/api/admin/sites/${sites[0].id}/qr.svg`, { cookie: admin.cookie });
      assert.match(qr.text, /^<svg/);

      // payslip: integer paise and the standard lines
      const month = app.today.slice(0, 7);
      const slip = (await app.request(`/api/workers/${worker.session.user.id}/payslips/${month}`, { cookie: worker.cookie })).json;
      assert.ok(slip.lines.every((l) => Number.isInteger(l.amountPaise)));
      assert.equal(slip.netPaise, slip.grossPaise - slip.deductionsPaise);
      assert.equal(slip.overtimeMultiplierPct, sector.overtimeMultiplierPct);

      // anonymous hazard report in this sector's own category, stored without identity
      const hazard = sector.hazardCategories[0];
      const report = await app.request('/api/grievances', { method: 'POST', cookie: worker.cookie, body: { category: hazard.id, text: 'Please look at this soon', anonymous: true } });
      assert.equal(report.status, 201);
      assert.ok(['medium', 'high'].includes(report.json.grievance.severity));
      const adminList = (await app.request('/api/admin/grievances', { cookie: admin.cookie })).json.items;
      const mine = adminList.find((g) => g.id === report.json.grievance.id);
      assert.equal(mine.worker, null);
      const stored = await app.store.grievances.get(orgIdFor(id), mine.id);
      assert.ok(!('workerId' in stored));

      // a category from another sector is rejected
      const foreign = SECTOR_IDS.map((s) => SECTORS[s]).find((s) => s.id !== id).hazardCategories.find((c) => !categoriesFor(id).some((x) => x.id === c.id));
      const bad = await app.request('/api/grievances', { method: 'POST', cookie: worker.cookie, body: { category: foreign.id, text: 'Wrong sector category' } });
      assert.equal(bad.status, 422);

      // employer dashboard
      const dash = (await app.request('/api/admin/dashboard', { cookie: admin.cookie })).json;
      assert.equal(dash.sector, id);
      assert.equal(dash.trend.length, 14);
      assert.ok(dash.kpis.totalWorkers >= 10);
      assert.ok(dash.fatigue.length >= 2);
      assert.ok(dash.attrition.length >= 1 && dash.attrition.every((a) => a.reasons.length > 0));
      assert.equal(dash.kpis.certificatesNeedingAttention, 1);

      // feedback k-anonymity and passport
      assert.equal((await app.request('/api/feedback', { method: 'POST', cookie: worker.cookie, body: { subject: 'conditions', rating: 3, text: '' } })).status, 201);
      const feedback = (await app.request('/api/admin/feedback', { cookie: admin.cookie })).json;
      assert.ok(feedback.buckets.every((b) => b.suppressed || b.count >= 3));
      const passport = (await app.request('/api/passport', { cookie: worker.cookie })).json;
      assert.ok(passport.entries.length >= 2);
    });
  }

  test('hospital: the demo nurse has a rest notice and the employer sees the night-shift rules fire', async () => {
    const nurse = await app.login('worker-hospital');
    assert.equal(nurse.session.user.jobRole, 'nurse');
    assert.equal((await app.request('/api/attendance/today', { cookie: nurse.cookie })).json.rest.level, 'amber');

    const admin = await app.login('admin-hospital');
    const dash = (await app.request('/api/admin/dashboard', { cookie: admin.cookie })).json;
    assert.equal(dash.kpis.totalWorkers, 10);
    const rules = dash.fatigue.flatMap((f) => f.flags.map((x) => x.rule));
    assert.ok(rules.includes('night_streak') && rules.includes('short_rest_after_night'));
    assert.ok(dash.fatigue.some((f) => f.level === 'red'));
    assert.ok(dash.kpis.overtimeMinutesWeek > 0);
    assert.deepEqual((await app.request('/api/admin/sites', { cookie: admin.cookie })).json.sites.map((s) => s.name), ['ICU', 'Emergency', 'General Ward']);
  });

  test('hospital data is isolated: an admin of another org cannot see it', async () => {
    const other = await app.login('admin-college');
    const hospitalWorker = (await app.store.workers.query('org-hospital'))[0];
    const res = await app.request(`/api/workers/${hospitalWorker.id}/payslips/${app.today.slice(0, 7)}`, { cookie: other.cookie });
    assert.equal(res.status, 404);
  });

  test('admin password login accepts every sector org', async () => {
    const PASSWORD = randomSecret();
    const withPassword = await startApp({ envOverrides: { DEMO_MODE: 'false', ADMIN_PASSWORD: PASSWORD } });
    try {
      for (const id of SECTOR_IDS) {
        const res = await withPassword.request('/api/login/admin', { method: 'POST', body: { org: orgIdFor(id), password: PASSWORD } });
        assert.equal(res.status, 200, id);
        assert.equal(res.json.org.sector, id);
      }
    } finally {
      await withPassword.close();
    }
  });
});
