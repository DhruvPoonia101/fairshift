import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CONTRASTS, DEFAULT_PREFS, PREFS_KEY, TEXT_SIZES, applyPrefs, normalisePrefs, readPrefs, setPref, writePrefs } from '../public/shared/prefs.js';

const memoryStorage = (initial = {}) => {
  const data = { ...initial };
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); } };
};
const blockedStorage = () => ({
  getItem: () => { throw new Error('blocked'); },
  setItem: () => { throw new Error('blocked'); },
});
const fakeRoot = () => ({ dataset: {} });

test('there are three text sizes and two contrast modes, defaulting to normal', () => {
  assert.deepEqual([...TEXT_SIZES], ['normal', 'large', 'xlarge']);
  assert.deepEqual([...CONTRASTS], ['normal', 'high']);
  assert.deepEqual({ ...DEFAULT_PREFS }, { textSize: 'normal', contrast: 'normal' });
  assert.deepEqual(readPrefs(memoryStorage()), DEFAULT_PREFS);
});

test('a saved choice is read back on the next visit', () => {
  const storage = memoryStorage();
  assert.equal(writePrefs(storage, { textSize: 'xlarge', contrast: 'high' }), true);
  assert.deepEqual(readPrefs(storage), { textSize: 'xlarge', contrast: 'high' });
  assert.ok(PREFS_KEY in storage.data);
});

test('unknown, missing or corrupt values fall back to the defaults, setting by setting', () => {
  assert.deepEqual(normalisePrefs({ textSize: 'huge', contrast: 'high' }), { textSize: 'normal', contrast: 'high' });
  assert.deepEqual(normalisePrefs({ textSize: 'large' }), { textSize: 'large', contrast: 'normal' });
  assert.deepEqual(normalisePrefs(null), DEFAULT_PREFS);
  assert.deepEqual(normalisePrefs('large'), DEFAULT_PREFS);
  assert.deepEqual(readPrefs(memoryStorage({ [PREFS_KEY]: '{not json' })), DEFAULT_PREFS);
  assert.deepEqual(readPrefs(memoryStorage({ [PREFS_KEY]: '[1,2]' })), DEFAULT_PREFS);
});

test('writing never stores values outside the allowed lists', () => {
  const storage = memoryStorage();
  writePrefs(storage, { textSize: '<script>', contrast: 'high' });
  assert.deepEqual(JSON.parse(storage.data[PREFS_KEY]), { textSize: 'normal', contrast: 'high' });
});

test('blocked storage does not throw: reads give defaults and writes report false', () => {
  assert.deepEqual(readPrefs(blockedStorage()), DEFAULT_PREFS);
  assert.deepEqual(readPrefs(null), DEFAULT_PREFS);
  assert.equal(writePrefs(blockedStorage(), DEFAULT_PREFS), false);
  assert.equal(writePrefs(null, DEFAULT_PREFS), false);
});

test('applyPrefs puts both settings on the root element for the CSS', () => {
  const root = fakeRoot();
  applyPrefs(root, { textSize: 'large', contrast: 'high' });
  assert.deepEqual(root.dataset, { textSize: 'large', contrast: 'high' });
});

test('setPref changes one setting, keeps the other, saves and applies at once', () => {
  const storage = memoryStorage();
  const root = fakeRoot();
  assert.deepEqual(setPref(storage, root, 'textSize', 'large'), { textSize: 'large', contrast: 'normal' });
  assert.deepEqual(setPref(storage, root, 'contrast', 'high'), { textSize: 'large', contrast: 'high' });
  assert.deepEqual(readPrefs(storage), { textSize: 'large', contrast: 'high' });
  assert.deepEqual(root.dataset, { textSize: 'large', contrast: 'high' });
  assert.deepEqual(setPref(storage, root, 'textSize', 'banana'), { textSize: 'normal', contrast: 'high' });
});

test('with blocked storage a choice still applies to the page and does not undo the other one', () => {
  const root = fakeRoot();
  setPref(blockedStorage(), root, 'textSize', 'xlarge');
  const result = setPref(blockedStorage(), root, 'contrast', 'high');
  assert.deepEqual(result, { textSize: 'xlarge', contrast: 'high' });
  assert.deepEqual(root.dataset, { textSize: 'xlarge', contrast: 'high' });
});
