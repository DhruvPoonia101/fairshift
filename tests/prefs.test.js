import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { CONTRASTS, DEFAULT_PREFS, PREFS_KEY, TEXT_SIZES, THEMES, applyPrefs, nextTheme, normalisePrefs, readPrefs, resolveTheme, setPref, writePrefs } from '../public/shared/prefs.js';

const memoryStorage = (initial = {}) => {
  const data = { ...initial };
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); } };
};
const blockedStorage = () => ({
  getItem: () => { throw new Error('blocked'); },
  setItem: () => { throw new Error('blocked'); },
});
const fakeRoot = () => ({ dataset: {} });
const LIGHT = { theme: 'system', textSize: 'normal', contrast: 'normal' };

test('there are three themes, three text sizes and two contrast modes, defaulting to system / normal / normal', () => {
  assert.deepEqual([...THEMES], ['system', 'light', 'dark']);
  assert.deepEqual([...TEXT_SIZES], ['normal', 'large', 'xlarge']);
  assert.deepEqual([...CONTRASTS], ['normal', 'high']);
  assert.deepEqual({ ...DEFAULT_PREFS }, LIGHT);
  assert.deepEqual(readPrefs(memoryStorage()), DEFAULT_PREFS);
});

test('a saved choice is read back on the next visit', () => {
  const storage = memoryStorage();
  assert.equal(writePrefs(storage, { theme: 'dark', textSize: 'xlarge', contrast: 'high' }), true);
  assert.deepEqual(readPrefs(storage), { theme: 'dark', textSize: 'xlarge', contrast: 'high' });
  assert.ok(PREFS_KEY in storage.data);
});

test('unknown, missing or corrupt values fall back to the defaults, setting by setting', () => {
  assert.deepEqual(normalisePrefs({ textSize: 'huge', contrast: 'high', theme: 'neon' }), { theme: 'system', textSize: 'normal', contrast: 'high' });
  assert.deepEqual(normalisePrefs({ textSize: 'large' }), { ...LIGHT, textSize: 'large' });
  assert.deepEqual(normalisePrefs(null), DEFAULT_PREFS);
  assert.deepEqual(normalisePrefs('large'), DEFAULT_PREFS);
  assert.deepEqual(readPrefs(memoryStorage({ [PREFS_KEY]: '{not json' })), DEFAULT_PREFS);
  assert.deepEqual(readPrefs(memoryStorage({ [PREFS_KEY]: '[1,2]' })), DEFAULT_PREFS);
  assert.deepEqual(readPrefs(memoryStorage({ [PREFS_KEY]: JSON.stringify({ textSize: 'large' }) })), { ...LIGHT, textSize: 'large' }, 'prefs saved before themes existed still load');
});

test('writing never stores values outside the allowed lists', () => {
  const storage = memoryStorage();
  writePrefs(storage, { theme: '<img onerror>', textSize: '<script>', contrast: 'high' });
  assert.deepEqual(JSON.parse(storage.data[PREFS_KEY]), { theme: 'system', textSize: 'normal', contrast: 'high' });
});

test('blocked storage does not throw: reads give defaults and writes report false', () => {
  assert.deepEqual(readPrefs(blockedStorage()), DEFAULT_PREFS);
  assert.deepEqual(readPrefs(null), DEFAULT_PREFS);
  assert.equal(writePrefs(blockedStorage(), DEFAULT_PREFS), false);
  assert.equal(writePrefs(null, DEFAULT_PREFS), false);
});

describe('the theme', () => {
  test('"system" follows the device; light and dark are a choice that ignores it', () => {
    assert.equal(resolveTheme('system', true), 'dark');
    assert.equal(resolveTheme('system', false), 'light');
    assert.equal(resolveTheme('light', true), 'light');
    assert.equal(resolveTheme('dark', false), 'dark');
    assert.equal(resolveTheme('nonsense', true), 'dark', 'an unknown value is treated as "system"');
  });

  test('the top-bar button switches to the opposite of what is showing, and that becomes a choice', () => {
    assert.equal(nextTheme('system', true), 'light', 'device is dark, so the button goes to light');
    assert.equal(nextTheme('system', false), 'dark');
    assert.equal(nextTheme('dark', false), 'light');
    assert.equal(nextTheme('light', true), 'dark');
    assert.ok(['light', 'dark'].includes(nextTheme('system', true)), 'always an explicit choice, never "system"');
  });

  test('applyPrefs puts the resolved theme and the choice on the root element for the CSS', () => {
    const root = fakeRoot();
    applyPrefs(root, { theme: 'system', textSize: 'large', contrast: 'high' }, true);
    assert.deepEqual(root.dataset, { theme: 'dark', themePref: 'system', textSize: 'large', contrast: 'high' });
    applyPrefs(root, { theme: 'light', textSize: 'normal', contrast: 'normal' }, true);
    assert.deepEqual(root.dataset, { theme: 'light', themePref: 'light', textSize: 'normal', contrast: 'normal' });
  });
});

test('setPref changes one setting, keeps the others, saves and applies at once', () => {
  const storage = memoryStorage();
  const root = fakeRoot();
  assert.deepEqual(setPref(storage, root, 'textSize', 'large', false), { ...LIGHT, textSize: 'large' });
  assert.deepEqual(setPref(storage, root, 'contrast', 'high', false), { ...LIGHT, textSize: 'large', contrast: 'high' });
  assert.deepEqual(setPref(storage, root, 'theme', 'dark', false), { theme: 'dark', textSize: 'large', contrast: 'high' });
  assert.deepEqual(readPrefs(storage), { theme: 'dark', textSize: 'large', contrast: 'high' });
  assert.deepEqual(root.dataset, { theme: 'dark', themePref: 'dark', textSize: 'large', contrast: 'high' });
  assert.deepEqual(setPref(storage, root, 'textSize', 'banana', false), { theme: 'dark', textSize: 'normal', contrast: 'high' });
});

test('with blocked storage a choice still applies to the page and does not undo the others', () => {
  const root = fakeRoot();
  setPref(blockedStorage(), root, 'theme', 'dark', false);
  setPref(blockedStorage(), root, 'textSize', 'xlarge', false);
  const result = setPref(blockedStorage(), root, 'contrast', 'high', false);
  assert.deepEqual(result, { theme: 'dark', textSize: 'xlarge', contrast: 'high' });
  assert.deepEqual(root.dataset, { theme: 'dark', themePref: 'dark', textSize: 'xlarge', contrast: 'high' });
});

describe('prefs-boot.js (runs before the first paint) agrees with prefs.js', () => {
  const bootSource = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'shared', 'prefs-boot.js'), 'utf8');

  /** Runs the real boot script against a fake page; returns the attributes it set and the listener it registered. */
  function boot({ saved, dark, throwsOnStorage = false, noMatchMedia = false }) {
    const dataset = {};
    const listeners = [];
    const sandbox = {
      document: { documentElement: { dataset } },
      localStorage: { getItem: () => { if (throwsOnStorage) throw new Error('blocked'); return saved === undefined ? null : saved; } },
      window: {},
    };
    const query = { matches: dark, addEventListener: (type, fn) => listeners.push(fn) };
    sandbox.window.matchMedia = noMatchMedia ? undefined : () => query;
    vm.runInContext(bootSource, vm.createContext(sandbox));
    return { dataset: { ...dataset }, listeners, live: dataset, query };
  }

  const cases = [
    { saved: undefined, dark: false }, { saved: undefined, dark: true },
    { saved: JSON.stringify({ theme: 'dark' }), dark: false },
    { saved: JSON.stringify({ theme: 'light', textSize: 'xlarge', contrast: 'high' }), dark: true },
    { saved: JSON.stringify({ theme: 'system', textSize: 'large' }), dark: true },
    { saved: '{broken', dark: true }, { saved: JSON.stringify({ theme: 'neon', textSize: 'huge', contrast: 'loud' }), dark: false },
    { saved: undefined, dark: true, throwsOnStorage: true },
  ];

  test('every saved state gives the same attributes as prefs.js would', () => {
    for (const testCase of cases) {
      const { dataset } = boot(testCase);
      const root = fakeRoot();
      applyPrefs(root, testCase.throwsOnStorage ? DEFAULT_PREFS : readPrefs(memoryStorage(testCase.saved === undefined ? {} : { [PREFS_KEY]: testCase.saved })), testCase.dark);
      // The boot script only sets a size and a contrast when they are not the defaults (the CSS treats a missing attribute as normal).
      const expected = { ...root.dataset };
      if (expected.textSize === 'normal') delete expected.textSize;
      if (expected.contrast === 'normal') delete expected.contrast;
      assert.deepEqual(dataset, expected, JSON.stringify(testCase));
    }
  });

  test('with no saved choice the theme follows the device, and keeps following it if it changes', () => {
    const { dataset, listeners, live, query } = boot({ saved: undefined, dark: false });
    assert.deepEqual(dataset, { themePref: 'system', theme: 'light' });
    assert.equal(listeners.length, 1);
    query.matches = true; // the device switches to dark
    listeners[0]();
    assert.equal(live.theme, 'dark');
    query.matches = false;
    listeners[0]();
    assert.equal(live.theme, 'light');
  });

  test('an explicit choice is not changed by the device', () => {
    const { listeners, live, query } = boot({ saved: JSON.stringify({ theme: 'dark' }), dark: false });
    query.matches = false;
    listeners[0]();
    assert.equal(live.theme, 'dark');
    live.themePref = 'system'; // what choosing "system" later in the page does
    query.matches = true;
    listeners[0]();
    assert.equal(live.theme, 'dark', 'now it follows the device again');
    query.matches = false;
    listeners[0]();
    assert.equal(live.theme, 'light');
  });

  test('without matchMedia or storage it still sets a valid theme (light)', () => {
    assert.deepEqual(boot({ saved: undefined, dark: true, noMatchMedia: true, throwsOnStorage: true }).dataset, { themePref: 'system', theme: 'light' });
  });

  test('the allowed values in the boot script match prefs.js', () => {
    for (const value of ['large', 'xlarge']) assert.ok(TEXT_SIZES.includes(value) && bootSource.includes(`'${value}'`));
    for (const value of ['light', 'dark']) assert.ok(THEMES.includes(value) && bootSource.includes(`'${value}'`));
    assert.ok(CONTRASTS.includes('high') && bootSource.includes("'high'"));
    assert.ok(bootSource.includes(PREFS_KEY));
  });
});
