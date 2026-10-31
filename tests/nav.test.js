import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DESTINATIONS, EXTRAS, SCREENS, SIDEBAR_GROUPS, TABS, tabForScreen } from '../public/worker/nav.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');
const en = JSON.parse(read('public/i18n/en.json'));
const base = read('public/shared/base.css');

describe('worker navigation', () => {
  test('the phone bottom bar has five tabs: Home, Pay, Reports, Disputes, Passport', () => {
    assert.deepEqual(TABS.map((tab) => tab.id), ['home', 'pay', 'report', 'records', 'passport']);
    assert.deepEqual(TABS.map((tab) => en[tab.labelKey]), ['Home', 'Pay', 'Reports', 'Disputes', 'Passport']);
  });

  test('Feedback and Settings are the labelled icon buttons in the top bar', () => {
    assert.deepEqual(EXTRAS.map((d) => [d.id, en[d.labelKey]]), [['feedback', 'Feedback'], ['settings', 'Settings']]);
  });

  test('the sidebar (900px and up) shows all seven destinations without a menu, the extras after a divider', () => {
    assert.deepEqual(SIDEBAR_GROUPS.map((group) => group.map((d) => d.id)), [['home', 'pay', 'report', 'records', 'passport'], ['feedback', 'settings']]);
    assert.equal(DESTINATIONS.length, 7);
    assert.ok(DESTINATIONS.every((d) => d.icon && en[d.labelKey]), 'every destination has an icon and a translated label');
  });

  test('the old "Me" tab is gone', () => {
    assert.ok(!SCREENS.includes('me'));
    assert.ok(!existsSync(path.join(root, 'public/worker/me.js')));
    assert.ok(!DESTINATIONS.some((d) => d.labelKey === 'tab.me'));
  });

  test('every destination is a screen of its own and is lit when it is open', () => {
    assert.equal(new Set(SCREENS).size, SCREENS.length);
    for (const id of SCREENS) assert.equal(tabForScreen(id), id);
    assert.equal(tabForScreen('nonsense'), null);
    assert.equal(tabForScreen('me'), null);
  });

  test('the router opens exactly the screens that are destinations (the tour still reaches the disputes screen at #records)', () => {
    const app = read('public/worker/app.js');
    const routed = [...app.matchAll(/^\s{2}(\w+): screen\(/gm)].map((m) => m[1]);
    assert.deepEqual([...routed].sort(), [...SCREENS].sort());
    assert.ok(routed.includes('records'));
  });
});

describe('the app chrome (styles shared by both apps)', () => {
  test('the top bar is sticky, and the sidebar and bottom bar are fixed so neither scrolls away', () => {
    assert.match(base, /\.topbar\s*{[^}]*position: sticky; top: 0/);
    assert.match(base, /\.sidenav\s*{[^}]*position: fixed/);
    assert.match(base, /\.tabbar\s*{[^}]*position: fixed/);
  });

  test('the sidebar appears at 900px and the bottom bar goes away there', () => {
    const wide = base.slice(base.search(/@media \(min-width: 56\.25rem\) {\s*\.sidenav/));
    assert.match(wide, /\.sidenav { display: block; }/);
    assert.match(wide, /\.tabbar { display: none; }/);
    assert.match(base, /\.sidenav\s*{\s*display: none;/, 'hidden on phones');
    assert.equal(56.25 * 16, 900);
  });

  test('every target is 48px or larger: tabs, sidebar links, icon buttons and the language switcher', () => {
    assert.match(base, /\.tabbar a\s*{[^}]*min-height: 4\.25rem/);
    assert.match(base, /\.sidenav a\s*{[^}]*min-height: 3rem/);
    assert.match(base, /\.icon-btn\s*{[^}]*min-width: 3rem; min-height: 3rem/);
    assert.match(base, /\.lang-face\s*{[^}]*min-width: 3rem; min-height: 3rem/);
  });

  test('the current page is shown by more than colour: weight, an underline, a heavier icon and an indicator', () => {
    for (const bar of ['tabbar', 'sidenav']) {
      assert.match(base, new RegExp(`\\.${bar} a\\[aria-current="page"\\]\\s*{[^}]*font-weight: (?:7|8)00`), `${bar} is bolder`);
      assert.match(base, new RegExp(`\\.${bar} a\\[aria-current="page"\\] span\\s*{[^}]*text-decoration: underline`), `${bar} label is underlined`);
      assert.match(base, new RegExp(`\\.${bar} a\\[aria-current="page"\\] svg\\.icon\\s*{[^}]*stroke-width`), `${bar} icon is heavier`);
    }
    assert.match(base, /\.tabbar a\[aria-current="page"\]\s*{[^}]*border-top-color/);
    assert.match(base, /\.sidenav a\[aria-current="page"\]::before\s*{[^}]*width: 4px/);
  });

  test('the admin bottom bar scrolls sideways instead of squeezing nine items', () => {
    assert.match(base, /\.tabbar-scroll ul\s*{[^}]*overflow-x: auto/);
    assert.match(read('public/admin/index.html'), /class="tabbar tabbar-scroll"/);
  });
});

describe('page shells', () => {
  const pages = {
    worker: read('public/worker/index.html'),
    admin: read('public/admin/index.html'),
    landing: read('public/index.html'),
    passport: read('public/passport/index.html'),
  };

  test('every page has the fixed top bar with the logo and wordmark, the theme toggle and the language selector', () => {
    for (const [name, html] of Object.entries(pages)) {
      assert.match(html, /<header class="topbar/, name);
      assert.match(html, /<img src="\/logo\.svg" alt="" width="32" height="32"><span class="brand-name">FairShift<\/span>/, name);
      assert.match(html, /id="theme-toggle"/, name);
      assert.match(html, /id="lang"/, name);
      assert.match(html, /<link rel="icon" href="\/icon\.svg" type="image\/svg\+xml">/, name);
    }
  });

  test('the worker page has the sidebar, the bottom bar, the top-bar quick links and a sign-out control', () => {
    for (const id of ['sidenav', 'tabbar', 'toplinks', 'logout', 'outbox-banner', 'main']) assert.match(pages.worker, new RegExp(`id="${id}"`), id);
    assert.match(pages.worker, /<body class="has-tabbar">/);
  });

  test('the admin page has the same top bar, a sidebar and a bottom bar, and keeps sign-out visible on phones', () => {
    for (const id of ['sidenav', 'tabbar', 'logout', 'org-name', 'main']) assert.match(pages.admin, new RegExp(`id="${id}"`), id);
    assert.doesNotMatch(pages.admin.match(/<button id="logout"[^>]*>/)[0], /no-phone/);
  });

  test('the theme-colour tags follow the theme and the manifest uses the ink colour', () => {
    for (const html of [pages.worker, pages.admin, pages.landing, pages.passport]) {
      assert.match(html, /<meta name="theme-color" content="#FAF7F2" media="\(prefers-color-scheme: light\)">/);
      assert.match(html, /<meta name="theme-color" content="#0B0E12" media="\(prefers-color-scheme: dark\)">/);
    }
    assert.equal(JSON.parse(read('public/manifest.webmanifest')).theme_color, '#0B0E12');
  });

  test('the admin sections are the nine it always had', () => {
    const app = read('public/admin/app.js');
    const ids = [...app.matchAll(/\{ id: '(\w+)', icon: '(\w+)'/g)].map((m) => m[1]);
    assert.deepEqual(ids, ['overview', 'attendance', 'grievances', 'people', 'feedback', 'skills', 'payroll', 'compliance', 'disputes']);
    for (const id of ids) assert.ok(en[`nav.${id}`], id);
  });
});
