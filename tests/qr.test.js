import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixedClock } from '../src/lib/time.js';
import { createSiteCredentials } from '../src/services/qr.js';
import { istMs, randomSecret } from './helpers.js';

const site = { id: 'site-a', orgId: 'org-1' };
const otherSite = { id: 'site-b', orgId: 'org-1' };

function make(secret = randomSecret(), at = istMs('2026-10-27', '08:00')) {
  const clock = fixedClock(at);
  return { clock, credentials: createSiteCredentials({ secret, clock }) };
}

test('a signed token verifies for its own site', () => {
  const { credentials } = make();
  assert.equal(credentials.verifyToken(credentials.issueToken(site), [site, otherSite])?.id, 'site-a');
});

test('a tampered or re-targeted token is rejected', () => {
  const { credentials } = make();
  const [id, day, sig] = credentials.issueToken(site).split('.');
  assert.equal(credentials.verifyToken(`site-b.${day}.${sig}`, [site, otherSite]), null);
  assert.equal(credentials.verifyToken(`${id}.${day}.${sig.slice(0, -1)}x`, [site]), null);
  assert.equal(credentials.verifyToken('garbage', [site]), null);
  assert.equal(credentials.verifyToken(`${id}.${day}.${sig}.extra`, [site]), null);
});

test('a token signed with another secret is rejected', () => {
  const forged = make().credentials.issueToken(site);
  assert.equal(make().credentials.verifyToken(forged, [site]), null);
});

test('tokens and codes rotate at midnight IST', () => {
  const { credentials, clock } = make();
  const token = credentials.issueToken(site);
  const code = credentials.dailyCode(site);
  clock.set(istMs('2026-10-27', '23:59'));
  assert.equal(credentials.verifyToken(token, [site])?.id, 'site-a');
  clock.set(istMs('2026-10-28', '00:00'));
  assert.equal(credentials.verifyToken(token, [site]), null);
  assert.notEqual(credentials.dailyCode(site), code);
});

test('the daily code is six digits, stable within a day, and differs per site', () => {
  const { credentials } = make();
  assert.match(credentials.dailyCode(site), /^\d{6}$/);
  assert.equal(credentials.dailyCode(site), credentials.dailyCode(site));
  assert.equal(credentials.findSiteByCode([site, otherSite], credentials.dailyCode(otherSite))?.id, 'site-b');
});

test('renders the QR as an SVG string', async () => {
  const { credentials } = make();
  const svg = await credentials.renderSvg(credentials.issueToken(site));
  assert.match(svg, /^<svg /);
});
