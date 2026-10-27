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
const themes = { light: tokens(lightBlock), dark: { ...tokens(lightBlock), ...tokens(darkBlock) } };

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

for (const [name, theme] of Object.entries(themes)) {
  test(`${name} theme: text colours meet WCAG AA (4.5:1)`, () => {
    for (const [fg, bg] of TEXT_PAIRS) {
      const value = ratio(theme[fg], theme[bg]);
      assert.ok(value >= 4.5, `${name}: ${fg} on ${bg} is ${value.toFixed(2)}:1`);
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
