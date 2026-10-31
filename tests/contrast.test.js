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

// FairShift has one light theme (plus a high-contrast variant that sits on top of it). The colours are written once each.
const lightBlock = block(/:root\s*{[^}]*}/);
const toneBlock = block(/:root\s*{[^}]*--ic-pay:[^}]*}/);
const highBlock = block(/html\[data-contrast="high"\]\s*{[^}]*}/);

const light = tokens(lightBlock);
const tones = tokens(toneBlock);
const high = { ...light, ...tokens(highBlock) };
// High contrast asks for WCAG AAA (7:1) text.
const themes = {
  light: { tokens: light, minimum: 4.5 },
  'high contrast': { tokens: high, minimum: 7 },
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
  test('warm ivory background, deep ink-navy text, saffron-gold primary, white surfaces', () => {
    assert.deepEqual([light.bg, light.surface, light.text, light.accent], ['#FAF6EC', '#FFFFFF', '#121B33', '#8F5300']);
    assert.equal(light.primary, '#F5A623', 'saffron-gold fills with ink text');
    assert.equal(light['on-primary'], '#121B33');
  });

  test('the primary is saffron-gold, never green (and neither is the accent)', () => {
    const hue = (hex) => {
      const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
      const max = Math.max(r, g, b);
      const d = max - Math.min(r, g, b);
      const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return (h * 60 + 360) % 360;
    };
    for (const name of ['primary', 'accent']) assert.ok(hue(light[name]) >= 25 && hue(light[name]) <= 48, `${name} hue ${hue(light[name]).toFixed(0)} is saffron / gold`);
  });

  test('the colour tokens are written once: there is no dark block, no dark fallback and no dark high-contrast block', () => {
    assert.ok(!/prefers-color-scheme/.test(css));
    assert.ok(!/data-theme/.test(css));
    assert.ok(!/color-scheme:\s*dark/.test(css));
    assert.match(css, /color-scheme: light/);
  });

  test('high contrast defines every colour token, so nothing falls back by accident', () => {
    const names = Object.keys(light);
    assert.ok(names.length >= 18);
    assert.deepEqual(names.filter((n) => !(n in tokens(highBlock))), []);
  });

  test('status colours stay distinct from each other (they are never the only cue, but they should still differ)', () => {
    const status = [light.ok, light.warn, light.danger, light.info];
    assert.equal(new Set(status).size, 4);
    const softs = [light['ok-soft'], light['warn-soft'], light['danger-soft'], light['info-soft']];
    assert.equal(new Set(softs).size, 4);
  });
});

describe('the icon tones', () => {
  const NAMES = ['pay', 'report', 'speak', 'skills', 'checkin', 'rest', 'lang', 'payroll'];
  const tint = (hex, amount) => '#' + [1, 3, 5].map((i) => Math.round(Number.parseInt(hex.slice(i, i + 2), 16) * amount + 255 * (1 - amount)).toString(16).padStart(2, '0')).join('').toUpperCase();
  const close = (a, b) => [1, 3, 5].every((i) => Math.abs(Number.parseInt(a.slice(i, i + 2), 16) - Number.parseInt(b.slice(i, i + 2), 16)) <= 2);

  test('there are eight tones, each a strong colour and a soft tile colour', () => {
    for (const name of NAMES) assert.ok(tones[`ic-${name}`] && tones[`ic-${name}-soft`], name);
    assert.equal(new Set(NAMES.map((n) => tones[`ic-${n}`])).size, 8, 'all different');
    assert.deepEqual(Object.keys(tones).filter((k) => !NAMES.some((n) => k === `ic-${n}` || k === `ic-${n}-soft`)), []);
  });

  test('each soft tile is a 12% tint of its strong colour', () => {
    for (const name of NAMES) assert.ok(close(tones[`ic-${name}-soft`], tint(tones[`ic-${name}`], 0.12)), `${name}: ${tones[`ic-${name}-soft`]} vs ${tint(tones[`ic-${name}`], 0.12)}`);
  });

  test('every icon / text colour reaches 4.5:1 on its own tile and on the white and ivory surfaces it sits on', () => {
    for (const name of NAMES) {
      const strong = tones[`ic-${name}`];
      for (const [label, background] of [['its tile', tones[`ic-${name}-soft`]], ['surface', light.surface], ['bg', light.bg], ['surface-2', light['surface-2']]]) {
        const value = ratio(strong, background);
        assert.ok(value >= 4.5, `${name} on ${label} is ${value.toFixed(2)}:1`);
      }
    }
  });

  test('high contrast turns every tone into plain black on white (7:1 or better), so nothing relies on colour', () => {
    const hc = tokens(highBlock);
    for (const name of NAMES) assert.ok(ratio(hc[`ic-${name}`], hc[`ic-${name}-soft`]) >= 7, name);
  });

  test('the tones are wired up: a data-tone attribute sets the colour and the tile, and the CSS has a rule for each', () => {
    for (const name of NAMES) assert.match(css, new RegExp(`\\[data-tone="${name}"\\] \\{ --tone: var\\(--ic-${name}\\); --tone-soft: var\\(--ic-${name}-soft\\); \\}`), name);
    assert.match(css, /\.tile-icon \{[^}]*background: var\(--tone-soft/);
  });
});

describe('colours in files', () => {
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

  // The ink-navy text and the slate greys are blue-ish but not blue colours: only a saturated, light-enough blue counts.
  const isVividBlue = ({ h, s, l }) => h >= 190 && h <= 255 && s > 0.35 && l >= 0.22;
  const ALLOWED_BLUES = new Set(['ic-lang', 'ic-lang-soft', 'ic-skills', 'ic-skills-soft'].map((k) => tones[k]));

  test('the only vivid blues (hue 190 to 255) are the sky-blue (language) and indigo (skills) icon tones; violet is a purple', () => {
    assert.equal(ALLOWED_BLUES.size, 4);
    const blues = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/#([0-9a-fA-F]{6})\b/g)) {
        const hex = `#${match[1].toUpperCase()}`;
        if (isVividBlue(hue(hex)) && !ALLOWED_BLUES.has(hex)) blues.push(`${path.relative(publicDir, file)}: ${hex}`);
      }
      for (const match of text.matchAll(/#([0-9a-fA-F]{3})\b(?![0-9a-fA-F])/g)) {
        const [r, g, b] = [...match[1]].map((c) => c + c);
        if (isVividBlue(hue(`#${r}${g}${b}`))) blues.push(`${path.relative(publicDir, file)}: #${match[1]}`);
      }
      if (/\b(blue|royalblue|dodgerblue|cornflowerblue|steelblue|skyblue|azure)\b/i.test(text.replace(/\/\*[\s\S]*?\*\//g, '')) && /\.(css|html|svg)$/.test(file)) blues.push(`${path.relative(publicDir, file)}: a blue colour name`);
    }
    assert.deepEqual(blues, []);
  });

  test('the detector itself works: it flags clear blues and lets the ink, slate, gold and green tones through', () => {
    for (const blue of ['#0B5CAD', '#7BBCF5', '#3366FF', '#0033A0', '#8EC5FF']) assert.ok(isVividBlue(hue(blue)), blue);
    for (const fine of ['#121B33', '#4F5669', '#FAF6EC', '#F5A623', '#8F5300', '#857D6C', '#1D6A3A', '#0F7749']) assert.ok(!isVividBlue(hue(fine)), fine);
    assert.ok(!isVividBlue(hue('#7A3FC4')), 'the violet tone is purple, not blue');
  });

  test('the old blue accent and the old dark ink colours are gone from the pages, the manifest and the theme-colour tags', () => {
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      assert.ok(!/0b5cad|0033a0|8ec5ff|7bbcf5/i.test(text), file);
      if (/\.(css|html|webmanifest)$/.test(file)) assert.ok(!/#0B0E12|#12161C|#181D24/i.test(text), `${file}: a dark-theme ink colour`);
    }
  });
});

test('base styles honour reduced motion, focus-visible and a 48px minimum target', () => {
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /\.btn\s*{[^}]*min-height: 3rem/);
  assert.doesNotMatch(css, /prefers-color-scheme/);
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
