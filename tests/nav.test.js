import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SCREENS, TABS, tabForScreen } from '../public/worker/nav.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');
const en = JSON.parse(read('public/i18n/en.json'));

test('the worker bottom bar has four tabs with short labels: Home, Pay, Reports, Me', () => {
  assert.deepEqual(TABS.map((tab) => tab.id), ['home', 'pay', 'report', 'me']);
  assert.deepEqual(TABS.map((tab) => en[tab.labelKey]), ['Home', 'Pay', 'Reports', 'Me']);
});

test('every screen belongs to exactly one tab, and screens reached from a tab keep it lit', () => {
  assert.equal(new Set(SCREENS).size, SCREENS.length);
  for (const screen of ['home', 'records', 'pay', 'report', 'me', 'passport', 'feedback']) assert.ok(tabForScreen(screen), screen);
  assert.equal(tabForScreen('records'), 'home');
  assert.equal(tabForScreen('passport'), 'me');
  assert.equal(tabForScreen('feedback'), 'me');
  assert.equal(tabForScreen('nonsense'), null);
});

test('the router opens exactly the screens that have a tab', () => {
  const app = read('public/worker/app.js');
  const routed = [...app.matchAll(/^\s{2}(\w+): screen\(/gm)].map((m) => m[1]);
  assert.deepEqual([...routed].sort(), [...SCREENS].sort());
});

test('the tab bar has big targets and the current page is not shown by colour alone', () => {
  const css = read('public/worker/worker.css');
  assert.match(css, /\.tabbar a\s*{[^}]*min-height: (?:[3-9](?:\.\d+)?)rem/, 'tab targets are at least 3rem (48px)');
  assert.match(css, /\.tabbar a\[aria-current="page"\]\s*{[^}]*font-weight/, 'the current tab is bolder');
  assert.match(css, /\.tabbar a\[aria-current="page"\] span\s*{[^}]*text-decoration: underline/, 'the current label is underlined');
  assert.match(css, /\.tabbar a\[aria-current="page"\] svg\.icon\s*{[^}]*stroke-width/, 'the current icon is drawn heavier');
});
