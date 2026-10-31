import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import * as prefs from '../public/shared/prefs.js';

const { CONTRASTS, DEFAULT_PREFS, PREFS_KEY, TEXT_SIZES, applyPrefs, normalisePrefs, readPrefs, setPref, writePrefs } = prefs;
const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

const memoryStorage = (initial = {}) => {
  const data = { ...initial };
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); } };
};
const blockedStorage = () => ({
  getItem: () => { throw new Error('blocked'); },
  setItem: () => { throw new Error('blocked'); },
});
const fakeRoot = () => ({ dataset: {} });
const NORMAL = { textSize: 'normal', contrast: 'normal' };

test('there are three text sizes and two contrast modes, defaulting to normal / normal, and no theme setting', () => {
  assert.deepEqual([...TEXT_SIZES], ['normal', 'large', 'xlarge']);
  assert.deepEqual([...CONTRASTS], ['normal', 'high']);
  assert.deepEqual({ ...DEFAULT_PREFS }, NORMAL);
  assert.deepEqual(readPrefs(memoryStorage()), DEFAULT_PREFS);
  for (const gone of ['THEMES', 'nextTheme', 'resolveTheme', 'systemPrefersDark']) assert.ok(!(gone in prefs), `${gone} is gone`);
});

test('a saved choice is read back on the next visit', () => {
  const storage = memoryStorage();
  assert.equal(writePrefs(storage, { textSize: 'xlarge', contrast: 'high' }), true);
  assert.deepEqual(readPrefs(storage), { textSize: 'xlarge', contrast: 'high' });
  assert.ok(PREFS_KEY in storage.data);
});

test('unknown, missing or corrupt values fall back to the defaults, setting by setting', () => {
  assert.deepEqual(normalisePrefs({ textSize: 'huge', contrast: 'high' }), { textSize: 'normal', contrast: 'high' });
  assert.deepEqual(normalisePrefs({ textSize: 'large' }), { ...NORMAL, textSize: 'large' });
  assert.deepEqual(normalisePrefs(null), DEFAULT_PREFS);
  assert.deepEqual(normalisePrefs('large'), DEFAULT_PREFS);
  assert.deepEqual(readPrefs(memoryStorage({ [PREFS_KEY]: '{not json' })), DEFAULT_PREFS);
  assert.deepEqual(readPrefs(memoryStorage({ [PREFS_KEY]: '[1,2]' })), DEFAULT_PREFS);
});

test('a stored "dark" (or any) theme from an earlier version is ignored: the page stays light, and the key is dropped on the next save', () => {
  const old = memoryStorage({ [PREFS_KEY]: JSON.stringify({ theme: 'dark', textSize: 'large', contrast: 'high' }) });
  assert.deepEqual(readPrefs(old), { textSize: 'large', contrast: 'high' });
  assert.ok(!('theme' in readPrefs(old)));
  const root = fakeRoot();
  applyPrefs(root, readPrefs(old));
  assert.deepEqual(root.dataset, { textSize: 'large', contrast: 'high' }, 'nothing about a theme reaches the page');
  setPref(old, root, 'textSize', 'normal');
  assert.deepEqual(JSON.parse(old.data[PREFS_KEY]), { textSize: 'normal', contrast: 'high' });
});

test('writing never stores values outside the allowed lists', () => {
  const storage = memoryStorage();
  writePrefs(storage, { theme: 'dark', textSize: '<script>', contrast: 'high' });
  assert.deepEqual(JSON.parse(storage.data[PREFS_KEY]), { textSize: 'normal', contrast: 'high' });
});

test('blocked storage does not throw: reads give defaults and writes report false', () => {
  assert.deepEqual(readPrefs(blockedStorage()), DEFAULT_PREFS);
  assert.deepEqual(readPrefs(null), DEFAULT_PREFS);
  assert.equal(writePrefs(blockedStorage(), DEFAULT_PREFS), false);
  assert.equal(writePrefs(null, DEFAULT_PREFS), false);
});

test('applyPrefs puts the text size and contrast on the root element for the CSS', () => {
  const root = fakeRoot();
  applyPrefs(root, { textSize: 'large', contrast: 'high' });
  assert.deepEqual(root.dataset, { textSize: 'large', contrast: 'high' });
});

test('setPref changes one setting, keeps the other, saves and applies at once', () => {
  const storage = memoryStorage();
  const root = fakeRoot();
  assert.deepEqual(setPref(storage, root, 'textSize', 'large'), { ...NORMAL, textSize: 'large' });
  assert.deepEqual(setPref(storage, root, 'contrast', 'high'), { textSize: 'large', contrast: 'high' });
  assert.deepEqual(readPrefs(storage), { textSize: 'large', contrast: 'high' });
  assert.deepEqual(root.dataset, { textSize: 'large', contrast: 'high' });
  assert.deepEqual(setPref(storage, root, 'textSize', 'banana'), { textSize: 'normal', contrast: 'high' });
  assert.deepEqual(setPref(storage, root, 'theme', 'dark'), { textSize: 'normal', contrast: 'high' }, 'asking for a theme does nothing');
});

test('with blocked storage a choice still applies to the page and does not undo the other', () => {
  const root = fakeRoot();
  setPref(blockedStorage(), root, 'textSize', 'xlarge');
  const result = setPref(blockedStorage(), root, 'contrast', 'high');
  assert.deepEqual(result, { textSize: 'xlarge', contrast: 'high' });
  assert.deepEqual(root.dataset, { textSize: 'xlarge', contrast: 'high' });
});

describe('prefs-boot.js (runs before the first paint) agrees with prefs.js', () => {
  const bootSource = readFileSync(path.join(publicDir, 'shared', 'prefs-boot.js'), 'utf8');

  /** Runs the real boot script against a fake page; returns the attributes it set. */
  function boot({ saved, throwsOnStorage = false }) {
    const dataset = {};
    const sandbox = {
      document: { documentElement: { dataset } },
      localStorage: { getItem: () => { if (throwsOnStorage) throw new Error('blocked'); return saved === undefined ? null : saved; } },
      window: {},
    };
    vm.runInContext(bootSource, vm.createContext(sandbox));
    return { ...dataset };
  }

  const cases = [
    { saved: undefined },
    { saved: JSON.stringify({ theme: 'dark' }) },
    { saved: JSON.stringify({ theme: 'dark', textSize: 'xlarge', contrast: 'high' }) },
    { saved: JSON.stringify({ textSize: 'large' }) },
    { saved: '{broken' },
    { saved: JSON.stringify({ theme: 'neon', textSize: 'huge', contrast: 'loud' }) },
    { saved: undefined, throwsOnStorage: true },
  ];

  test('every saved state gives the same attributes as prefs.js would', () => {
    for (const testCase of cases) {
      const dataset = boot(testCase);
      const root = fakeRoot();
      applyPrefs(root, testCase.throwsOnStorage ? DEFAULT_PREFS : readPrefs(memoryStorage(testCase.saved === undefined ? {} : { [PREFS_KEY]: testCase.saved })));
      // The boot script only sets a size and a contrast when they are not the defaults (the CSS treats a missing attribute as normal).
      const expected = { ...root.dataset };
      if (expected.textSize === 'normal') delete expected.textSize;
      if (expected.contrast === 'normal') delete expected.contrast;
      assert.deepEqual(dataset, expected, JSON.stringify(testCase));
    }
  });

  test('it never sets a theme, whatever was saved, and never listens for the device colour scheme', () => {
    for (const testCase of cases) {
      const dataset = boot(testCase);
      assert.ok(!('theme' in dataset) && !('themePref' in dataset), JSON.stringify(testCase));
    }
    assert.ok(!/matchMedia|prefers-color-scheme|dark/.test(bootSource.replace(/\/\*[\s\S]*?\*\//g, '')), 'no dark logic in the code');
  });

  test('the allowed values in the boot script match prefs.js', () => {
    for (const value of ['large', 'xlarge']) assert.ok(TEXT_SIZES.includes(value) && bootSource.includes(`'${value}'`));
    assert.ok(CONTRASTS.includes('high') && bootSource.includes("'high'"));
    assert.ok(bootSource.includes(PREFS_KEY));
  });
});

describe('no dark mode is left anywhere in the app', () => {
  const walk = (dir) => readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
  const files = walk(publicDir).filter((f) => /\.(css|html|js|json|webmanifest)$/.test(f) && !f.includes(`${path.sep}fonts${path.sep}`));
  const strip = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '');

  test('no theme toggle button, no dark tokens, no prefers-color-scheme rule, no data-theme', () => {
    const found = [];
    for (const file of files) {
      const text = strip(readFileSync(file, 'utf8'));
      const rel = path.relative(publicDir, file);
      if (/theme-toggle|mountThemeToggle/.test(text)) found.push(`${rel}: theme toggle`);
      if (/prefers-color-scheme/.test(text)) found.push(`${rel}: prefers-color-scheme`);
      if (/data-theme|dataset\.theme|themePref/.test(text)) found.push(`${rel}: data-theme`);
      if (/color-scheme:\s*dark/.test(text)) found.push(`${rel}: color-scheme dark`);
    }
    assert.deepEqual(found, []);
  });

  test('the theme words (switch to dark, dark, system, colour theme) are gone from all three languages', () => {
    for (const lang of ['en', 'hi', 'ta']) {
      const dictionary = JSON.parse(readFileSync(path.join(publicDir, 'i18n', `${lang}.json`), 'utf8'));
      for (const key of ['theme.toLight', 'theme.toDark', 'theme.light', 'theme.dark', 'theme.system', 'theme.label', 'theme.hint']) assert.ok(!(key in dictionary), `${lang}: ${key}`);
    }
  });

  test('every page and the manifest use the light background for the browser colour', () => {
    for (const page of ['index.html', 'worker/index.html', 'admin/index.html', 'passport/index.html']) {
      const html = readFileSync(path.join(publicDir, page), 'utf8');
      assert.equal(html.match(/<meta name="theme-color"[^>]*>/g)?.length, 1, `${page}: one tag`);
      assert.match(html, /<meta name="theme-color" content="#FAF6EC">/, page);
    }
    const manifest = JSON.parse(readFileSync(path.join(publicDir, 'manifest.webmanifest'), 'utf8'));
    assert.equal(manifest.theme_color, '#FAF6EC');
    assert.equal(manifest.background_color, '#FAF6EC');
  });
});
