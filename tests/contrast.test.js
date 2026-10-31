import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const css = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'shared', 'base.css'),
  'utf8',
);

function tokens(block) {
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
}

const [lightBlock] = css.match(/:root\s*{[^}]*}/);
const [darkBlock] = css.match(/prefers-color-scheme: dark\)\s*{\s*:root\s*{[^}]*}/);
const [highLightBlock] = css.match(/html\[data-contrast="high"\]\s*{[^}]*}/);
const [highDarkBlock] = css.match(/prefers-color-scheme: dark\)\s*{\s*html\[data-contrast="high"\]\s*{[^}]*}/);
const darkTokens = { ...tokens(lightBlock), ...tokens(darkBlock) };
// High contrast sits on top of whichever colour scheme the device uses, and asks for WCAG AAA (7:1) text.
const themes = {
  light: { tokens: tokens(lightBlock), minimum: 4.5 },
  dark: { tokens: darkTokens, minimum: 4.5 },
  'high contrast light': { tokens: { ...tokens(lightBlock), ...tokens(highLightBlock) }, minimum: 7 },
  'high contrast dark': { tokens: { ...darkTokens, ...tokens(highDarkBlock) }, minimum: 7 },
};

function luminance(hex) {
  const channels = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// [foreground token, background token]: all body-size text, so WCAG AA needs 4.5:1.
const TEXT_PAIRS = [
  ['text', 'bg'], ['text', 'surface'], ['muted', 'bg'], ['muted', 'surface'], ['muted', 'primary-soft'],
  ['primary', 'bg'], ['primary', 'surface'], ['primary', 'primary-soft'], ['on-primary', 'primary'],
  ['danger', 'surface'], ['danger', 'danger-soft'], ['warn', 'surface'], ['warn', 'warn-soft'],
  ['ok', 'surface'], ['ok', 'ok-soft'], ['text', 'primary-soft'], ['text', 'warn-soft'], ['text', 'ok-soft'],
];
// Borders of inputs and buttons and the focus ring are UI components: 3:1.
const UI_PAIRS = [['border', 'surface'], ['border', 'bg'], ['focus', 'bg'], ['focus', 'surface']];

for (const [name, { tokens: theme, minimum }] of Object.entries(themes)) {
  test(`${name} theme: text colours reach ${minimum}:1`, () => {
    for (const [fg, bg] of TEXT_PAIRS) {
      const value = ratio(theme[fg], theme[bg]);
      assert.ok(value >= minimum, `${name}: ${fg} on ${bg} is ${value.toFixed(2)}:1`);
    }
  });

  test(`${name} theme: borders and focus ring meet 3:1`, () => {
    for (const [fg, bg] of UI_PAIRS) {
      const value = ratio(theme[fg], theme[bg]);
      assert.ok(value >= 3, `${name}: ${fg} on ${bg} is ${value.toFixed(2)}:1`);
    }
  });
}

test('base styles honour reduced motion, focus-visible and a 48px minimum target', () => {
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /\.btn\s*{[^}]*min-height: 3rem/);
  assert.match(css, /prefers-color-scheme: dark/);
});

test('text size and high contrast are wired up, and every page applies them before the first paint', () => {
  assert.match(css, /html\[data-text-size="large"\]\s*{\s*font-size: 125%/);
  assert.match(css, /html\[data-text-size="xlarge"\]\s*{\s*font-size: 150%/);
  const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
  for (const page of ['index.html', 'worker/index.html', 'admin/index.html', 'passport/index.html']) {
    const html = readFileSync(path.join(publicDir, page), 'utf8');
    assert.match(html, /<script src="\/shared\/prefs-boot\.js"><\/script>/, page);
    assert.ok(html.indexOf('prefs-boot.js') < html.indexOf('base.css'), `${page}: prefs-boot runs before the stylesheet`);
  }
});
