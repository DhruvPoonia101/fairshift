/**
 * Display preferences, remembered per device: colour theme (system, light, dark), text size (3 sizes) and
 * high contrast. The logic is pure (it takes the storage, the root element and the system setting as arguments),
 * so it can be tested without a browser. `prefs-boot.js` applies the saved values before the first paint.
 *
 * On <html> the CSS reads: data-theme ("light" | "dark", always the resolved one), data-theme-pref (what the
 * person chose, "system" by default), data-text-size and data-contrast.
 */

export const PREFS_KEY = 'fairshift.prefs';
export const THEMES = Object.freeze(['system', 'light', 'dark']);
export const TEXT_SIZES = Object.freeze(['normal', 'large', 'xlarge']);
export const CONTRASTS = Object.freeze(['normal', 'high']);
export const DEFAULT_PREFS = Object.freeze({ theme: 'system', textSize: 'normal', contrast: 'normal' });

/** Anything unknown, missing or corrupt falls back to the default for that setting. */
export function normalisePrefs(value) {
  return {
    theme: THEMES.includes(value?.theme) ? value.theme : DEFAULT_PREFS.theme,
    textSize: TEXT_SIZES.includes(value?.textSize) ? value.textSize : DEFAULT_PREFS.textSize,
    contrast: CONTRASTS.includes(value?.contrast) ? value.contrast : DEFAULT_PREFS.contrast,
  };
}

/** "system" follows the device; light and dark are a choice. */
export const resolveTheme = (theme, systemDark) => (theme === 'system' || !THEMES.includes(theme) ? (systemDark ? 'dark' : 'light') : theme);

/** The theme the top-bar button switches to: the opposite of what is showing now (it then stays chosen). */
export const nextTheme = (theme, systemDark) => (resolveTheme(theme, systemDark) === 'dark' ? 'light' : 'dark');

/** Whether the device prefers a dark scheme (false where it cannot be asked). */
export function systemPrefersDark() {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
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

/** The CSS reads these attributes (html[data-theme], html[data-text-size], html[data-contrast]). */
export function applyPrefs(root, prefs, systemDark = systemPrefersDark()) {
  root.dataset.theme = resolveTheme(prefs.theme, systemDark);
  root.dataset.themePref = prefs.theme;
  root.dataset.textSize = prefs.textSize;
  root.dataset.contrast = prefs.contrast;
}

/** What is applied on the page right now (the starting point for a change, even if storage is blocked). */
const shown = (root) => normalisePrefs({ theme: root.dataset.themePref, textSize: root.dataset.textSize, contrast: root.dataset.contrast });

/**
 * Changes one setting: saved, applied at once, and the full result returned. What is on the page is the
 * starting point, so with blocked storage the other settings are not lost.
 */
export function setPref(storage, root, key, value, systemDark = systemPrefersDark()) {
  const onPage = root.dataset.themePref || root.dataset.textSize || root.dataset.contrast;
  const current = onPage ? shown(root) : readPrefs(storage);
  const next = normalisePrefs({ ...current, [key]: value });
  writePrefs(storage, next);
  applyPrefs(root, next, systemDark);
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
