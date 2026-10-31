/**
 * Display preferences, remembered per device: text size (3 sizes) and high contrast.
 * The logic is pure (it takes the storage and the root element as arguments), so it can be tested
 * without a browser. `prefs-boot.js` applies the saved values before the first paint.
 */

export const PREFS_KEY = 'fairshift.prefs';
export const TEXT_SIZES = Object.freeze(['normal', 'large', 'xlarge']);
export const CONTRASTS = Object.freeze(['normal', 'high']);
export const DEFAULT_PREFS = Object.freeze({ textSize: 'normal', contrast: 'normal' });

/** Anything unknown, missing or corrupt falls back to the default for that setting. */
export function normalisePrefs(value) {
  return {
    textSize: TEXT_SIZES.includes(value?.textSize) ? value.textSize : DEFAULT_PREFS.textSize,
    contrast: CONTRASTS.includes(value?.contrast) ? value.contrast : DEFAULT_PREFS.contrast,
  };
}

export function readPrefs(storage) {
  try {
    return normalisePrefs(JSON.parse(storage.getItem(PREFS_KEY)));
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

/** @returns {boolean} false when storage is blocked (the choice then lasts for this page only) */
export function writePrefs(storage, prefs) {
  try {
    storage.setItem(PREFS_KEY, JSON.stringify(normalisePrefs(prefs)));
    return true;
  } catch {
    return false;
  }
}

/** The CSS reads these two attributes (html[data-text-size], html[data-contrast]). */
export function applyPrefs(root, prefs) {
  root.dataset.textSize = prefs.textSize;
  root.dataset.contrast = prefs.contrast;
}

/**
 * Changes one setting: saved, applied at once, and the full result returned. What is on the page
 * is the starting point, so with blocked storage the other setting is not lost.
 */
export function setPref(storage, root, key, value) {
  const current = root.dataset.textSize || root.dataset.contrast ? normalisePrefs(root.dataset) : readPrefs(storage);
  const next = normalisePrefs({ ...current, [key]: value });
  writePrefs(storage, next);
  applyPrefs(root, next);
  return next;
}

/** The device's own storage, or null where the browser blocks it. */
export function deviceStorage() {
  try {
    return localStorage;
  } catch {
    return null;
  }
}
