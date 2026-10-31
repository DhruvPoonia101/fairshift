import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const css = readFileSync(path.join(publicDir, 'shared', 'base.css'), 'utf8');

function tokens(block) {
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2].toUpperCase()]));
}
const block = (pattern) => {
  const found = css.match(pattern);
  assert.ok(found, `base.css has ${pattern}`);
  return found[0];
};

// Each theme's colours are written in one block (and the dark ones twice: see the identity test below).
const lightBlock = block(/:root\s*{[^}]*}/);
const darkBlock = block(/html\[data-theme="dark"\]\s*{[^}]*}/);
const darkFallbackBlock = block(/prefers-color-scheme: dark\)\s*{\s*:root:not\(\[data-theme\]\)\s*{[^}]*}/);
const highLightBlock = block(/html\[data-contrast="high"\]\s*{[^}]*}/);
const highDarkBlock = block(/html\[data-contrast="high"\]\[data-theme="dark"\]\s*{[^}]*}/);

const light = tokens(lightBlock);
const dark = { ...light, ...tokens(darkBlock) };
// High contrast sits on top of whichever theme is showing, and asks for WCAG AAA (7:1) text.
const themes = {
  light: { tokens: light, minimum: 4.5 },
  dark: { tokens: dark, minimum: 4.5 },
  'high contrast light': { tokens: { ...light, ...tokens(highLightBlock) }, minimum: 7 },
  'high contrast dark': { tokens: { ...dark, ...tokens(highLightBlock), ...tokens(highDarkBlock) }, minimum: 7 },
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

// [foreground token, background token]: all body-size text, so WCAG AA needs 4.5:1 (7:1 in high contrast).
const TEXT_PAIRS = [
  ['text', 'bg'], ['text', 'surface'], ['text', 'surface-2'],
  ['muted', 'bg'], ['muted', 'surface'], ['muted', 'surface-2'], ['muted', 'accent-soft'],
  ['accent', 'bg'], ['accent', 'surface'], ['accent', 'surface-2'], ['accent', 'accent-soft'],
  ['on-primary', 'primary'],
  ['danger', 'surface'], ['danger', 'danger-soft'], ['warn', 'surface'], ['warn', 'warn-soft'],
  ['ok', 'surface'], ['ok', 'ok-soft'], ['info', 'surface'], ['info', 'info-soft'],
  ['text', 'accent-soft'], ['text', 'warn-soft'], ['text', 'ok-soft'], ['text', 'danger-soft'], ['text', 'info-soft'],
];
// Borders of inputs and the focus ring are UI components: 3:1.
const UI_PAIRS = [['border', 'surface'], ['border', 'bg'], ['border', 'surface-2'], ['focus', 'bg'], ['focus', 'surface'], ['focus', 'surface-2']];

for (const [name, { tokens: theme, minimum }] of Object.entries(themes)) {
  test(`${name} theme: text colours reach ${minimum}:1`, () => {
    for (const [fg, bg] of TEXT_PAIRS) {
      assert.ok(theme[fg] && theme[bg], `${name}: token ${fg} or ${bg} is missing`);
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

describe('the palette', () => {
  test('the brand colours are the ones in the design brief', () => {
    assert.deepEqual([dark.bg, dark.surface, dark['surface-2'], dark.text, dark.muted, dark.accent], ['#0B0E12', '#12161C', '#181D24', '#F3EEE4', '#A8A398', '#D6B26A']);
    assert.deepEqual([light.bg, light.surface, light.text, light.accent], ['#FAF7F2', '#FFFFFF', '#14110D', '#8A6A1F']);
    assert.equal(light.primary, '#D6B26A', 'gold fills with ink text');
    assert.equal(light['on-primary'], '#14110D');
  });

  test('the dark theme is defined once for the device preference and once for the explicit choice, and they are identical', () => {
    assert.deepEqual(tokens(darkFallbackBlock), tokens(darkBlock));
    assert.deepEqual(darkFallbackBlock.replace(/\s+/g, ' ').match(/--[\w-]+:[^;]+;/g), darkBlock.replace(/\s+/g, ' ').match(/--[\w-]+:[^;]+;/g), 'including shadows');
  });

  test('every theme defines every colour token, so nothing falls back to another theme by accident', () => {
    const names = Object.keys(light);
    assert.ok(names.length >= 18);
    for (const [label, theme] of [['dark', tokens(darkBlock)], ['high contrast light', tokens(highLightBlock)], ['high contrast dark', tokens(highDarkBlock)]]) {
      assert.deepEqual(names.filter((n) => !(n in theme) && n !== 'primary' && !(label === 'dark' && n === 'primary')), [], label);
    }
  });

  test('status colours stay distinct from each other (they are never the only cue, but they should still differ)', () => {
    for (const theme of [light, dark]) {
      const status = [theme.ok, theme.warn, theme.danger, theme.info];
      assert.equal(new Set(status).size, 4);
      const softs = [theme['ok-soft'], theme['warn-soft'], theme['danger-soft'], theme['info-soft']];
      assert.equal(new Set(softs).size, 4);
    }
  });
});

describe('no blue anywhere', () => {
  const walk = (dir) =>
    readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      return statSync(full).isDirectory() ? walk(full) : [full];
    });
  const files = walk(publicDir).filter((f) => /\.(css|html|js|svg|webmanifest)$/.test(f));

  function hue(hex) {
    const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    const l = (max + min) / 2;
    if (d === 0) return { h: 0, s: 0, l };
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
    return { h, s: d / (1 - Math.abs(2 * l - 1)), l };
  }

  // The brief's ink tones (#0B0E12 and friends) are near-blacks with a faint cool tint: below 22% lightness they read
  // as black, not as a colour, so only lighter colours count as blue.
  const isBlue = ({ h, s, l }) => h >= 190 && h <= 270 && s > 0.12 && l >= 0.22;

  test('no colour in any style, page, icon or script is blue (hue 190 to 270 degrees, saturated, and light enough to read as a colour)', () => {
    const blues = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/#([0-9a-fA-F]{6})\b/g)) {
        if (isBlue(hue(`#${match[1]}`))) blues.push(`${path.relative(publicDir, file)}: #${match[1]}`);
      }
      for (const match of text.matchAll(/#([0-9a-fA-F]{3})\b(?![0-9a-fA-F])/g)) {
        const [r, g, b] = [...match[1]].map((c) => c + c);
        if (isBlue(hue(`#${r}${g}${b}`))) blues.push(`${path.relative(publicDir, file)}: #${match[1]}`);
      }
      if (/\b(blue|navy|royalblue|dodgerblue|cornflowerblue|steelblue|skyblue|azure|indigo)\b/i.test(text.replace(/\/\*[\s\S]*?\*\//g, '')) && /\.(css|html|svg)$/.test(file)) blues.push(`${path.relative(publicDir, file)}: a blue colour name`);
    }
    assert.deepEqual(blues, []);
  });

  test('the detector itself works: it flags the old blue and clear blues, and lets the ink tones and golds through', () => {
    for (const blue of ['#0B5CAD', '#7BBCF5', '#3366FF', '#0033A0', '#8EC5FF']) assert.ok(isBlue(hue(blue)), blue);
    for (const fine of ['#0B0E12', '#12161C', '#181D24', '#262C35', '#D6B26A', '#8A6A1F', '#F3EEE4', '#7C8088', '#1D6A3A']) assert.ok(!isBlue(hue(fine)), fine);
  });

  test('the old blue accent is gone from the pages, the manifest and the theme-colour tags', () => {
    for (const file of files) assert.ok(!/0b5cad|0033a0|8ec5ff|7bbcf5/i.test(readFileSync(file, 'utf8')), file);
  });
});

test('base styles honour reduced motion, focus-visible and a 48px minimum target', () => {
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /\.btn\s*{[^}]*min-height: 3rem/);
  assert.match(css, /prefers-color-scheme: dark/);
  assert.match(css, /\.icon-btn\s*{[^}]*min-width: 3rem; min-height: 3rem/);
  assert.match(css, /\.sidenav a\s*{[^}]*min-height: 3rem/);
  assert.match(css, /\.tabbar a\s*{[^}]*min-height: (?:[3-9](?:\.\d+)?)rem/);
});

test('body text is 16px or larger with a comfortable line height', () => {
  assert.match(css, /body\s*{[^}]*font: 400 1rem\/1\.6 var\(--font-body\)/);
});

test('text size and high contrast are wired up, and every page applies them before the first paint', () => {
  assert.match(css, /html\[data-text-size="large"\]\s*{\s*font-size: 125%/);
  assert.match(css, /html\[data-text-size="xlarge"\]\s*{\s*font-size: 150%/);
  for (const page of ['index.html', 'worker/index.html', 'admin/index.html', 'passport/index.html']) {
    const html = readFileSync(path.join(publicDir, page), 'utf8');
    assert.match(html, /<script src="\/shared\/prefs-boot\.js"><\/script>/, page);
    assert.ok(html.indexOf('prefs-boot.js') < html.indexOf('base.css'), `${page}: prefs-boot runs before the stylesheet`);
  }
});
