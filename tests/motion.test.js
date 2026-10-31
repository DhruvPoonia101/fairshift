import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CACHE_REVISION, buildPrecacheList } from '../src/lib/precache.js';
import { COUNT_MS, countFrame, dashFrame, easeOutCubic, planCount, runTimeline } from '../public/shared/motion.js';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const read = (file) => readFileSync(path.join(publicDir, file), 'utf8');
const css = read('shared/motion.css').replace(/\/\*[\s\S]*?\*\//g, '');

/** Top-level blocks of a stylesheet: { prelude, body }. Good enough for a file with plain at-rules and no strings with braces. */
function blocks(source) {
  const found = [];
  let depth = 0;
  let start = 0;
  let open = 0;
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] === '{') {
      if (depth === 0) open = i;
      depth += 1;
    } else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        found.push({ prelude: source.slice(start, open).trim(), body: source.slice(open + 1, i) });
        start = i + 1;
      }
    }
  }
  return found;
}
const top = blocks(css);
const MOTION_DECLARATION = /(?:^|[;{\s])(animation(?:-[a-z-]+)?|transition(?:-[a-z-]+)?)\s*:/;
const inNoPreference = (block) => /prefers-reduced-motion:\s*no-preference/.test(block.prelude);
const inReduce = (block) => /prefers-reduced-motion:\s*reduce/.test(block.prelude);

describe('motion.css', () => {
  test('has a reduced-motion block that switches every animation and transition off', () => {
    const reduce = top.find(inReduce);
    assert.ok(reduce, 'a @media (prefers-reduced-motion: reduce) block exists');
    assert.match(reduce.body, /animation:\s*none\s*!important/);
    assert.match(reduce.body, /transition:\s*none\s*!important/);
    assert.match(reduce.body, /\*,\s*\*::before,\s*\*::after/, 'it covers every element and pseudo-element');
  });

  test('no animation or transition exists outside the no-preference block (so reduce can never miss one)', () => {
    for (const block of top) {
      if (inNoPreference(block) || inReduce(block) || block.prelude.startsWith('@keyframes')) continue;
      assert.ok(!MOTION_DECLARATION.test(block.body), `${block.prelude}: ${block.body.slice(0, 80)}`);
    }
  });

  test('only transform and opacity are animated or transitioned (the one exception: the success check is drawn)', () => {
    const allowedFor = (name) => (name === 'm-draw' ? ['stroke-dashoffset'] : ['transform', 'opacity']);
    const keyframes = top.filter((b) => b.prelude.startsWith('@keyframes'));
    assert.ok(keyframes.length >= 10);
    for (const { prelude, body } of keyframes) {
      const name = prelude.replace('@keyframes', '').trim();
      const properties = [...body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
      for (const property of properties) assert.ok(allowedFor(name).includes(property), `${name} animates ${property}`);
    }
    const motionBlocks = top.filter((b) => !inReduce(b) && !b.prelude.startsWith('@keyframes')); // the reduce block's "none" is the switch itself
    for (const block of motionBlocks) {
      for (const match of block.body.matchAll(/(?:^|[;{\s])transition\s*:([^;}]+)/g)) {
        for (const part of match[1].split(',')) assert.match(part.trim(), /^(transform|opacity)\b/, `transition: ${part.trim()}`);
      }
    }
  });

  test('animations never use fill-mode forwards or both, so a hover lift still works after a card has faded in', () => {
    for (const match of css.matchAll(/animation\s*:([^;}]+)/g)) assert.ok(!/\b(forwards|both)\b/.test(match[1]), match[1]);
  });

  test('the motion tokens: 150, 250 and 450 ms and one ease-out curve', () => {
    assert.match(css, /--m-fast:\s*150ms/);
    assert.match(css, /--m-base:\s*250ms/);
    assert.match(css, /--m-slow:\s*450ms/);
    assert.equal([...css.matchAll(/cubic-bezier\(([^)]+)\)/g)].length, 1, 'one curve, defined once');
    assert.match(css, /--m-ease:\s*cubic-bezier\(0\.16,\s*1,\s*0\.3,\s*1\)/);
  });

  test('hover effects only exist under (hover: hover)', () => {
    for (const block of top) {
      if (/:hover/.test(block.prelude + block.body)) assert.match(block.prelude, /\(hover:\s*hover\)/, block.prelude);
    }
  });

  test('every rule that hides something at the start of an animation is inside no-preference (reduce users see the end state)', () => {
    for (const block of top) {
      if (inNoPreference(block)) continue;
      assert.ok(!/stroke-dashoffset|translateX\(-120%\)/.test(block.body) || block.prelude.startsWith('@keyframes'), block.prelude);
    }
  });

  test('respects the existing settings: no glow or shine in high contrast', () => {
    assert.match(css, /html\[data-contrast="high"\]\s*\{\s*--m-glow:\s*none/);
    assert.match(css, /html\[data-contrast="high"\] \.btn::after\s*\{\s*display:\s*none/);
    const landing = read('landing.css');
    assert.match(landing, /html\[data-contrast="high"\] \.scene\s*\{\s*display:\s*none/, 'the scene is hidden in high contrast');
    assert.match(landing, /html:not\(\[data-text-size="xlarge"\]\) \.hero \{/, 'the two columns step back to one at the largest text size');
  });

  test('uses no blue, and no new colour values beyond the gold glow and the white shine', () => {
    assert.ok(!/#[0-9a-f]{3,8}\b/i.test(css), 'no hex colours: it uses the design tokens');
    const colours = [...css.matchAll(/rgb\(([^)]+)\)/g)].map((m) => m[1].replace(/\s+/g, ' '));
    assert.deepEqual([...new Set(colours)].sort(), ['245 166 35 / 24%', '255 255 255 / 30%']);
  });

  test('is loaded by the landing, worker and employer pages, after their own stylesheet', () => {
    for (const [page, own] of [['index.html', 'landing.css'], ['worker/index.html', 'worker.css'], ['admin/index.html', 'admin.css']]) {
      const html = read(page);
      assert.ok(html.includes('<link rel="stylesheet" href="/shared/motion.css">'), page);
      assert.ok(html.indexOf(own) < html.indexOf('motion.css'), `${page}: motion.css comes after ${own}`);
    }
  });
});

describe('the 3D scene', () => {
  const html = read('index.html');
  const scene = html.slice(html.indexOf('<div class="scene"'), html.indexOf('<!-- /scene -->'));
  const landing = read('landing.css');

  test('is small inline markup (under 8 KB), hidden from screen readers, with no blur, filters, images or scripts', () => {
    assert.ok(scene.length > 1500, 'the scene exists');
    assert.ok(Buffer.byteLength(scene) < 8192, `${Buffer.byteLength(scene)} bytes`);
    assert.match(scene, /^<div class="scene" id="scene" aria-hidden="true">/);
    assert.match(scene, /focusable="false"/);
    assert.ok(!/<filter|feGaussianBlur|filter=|<image|<img|<script|<style|\bstyle=|href=|<foreignObject|\bon\w+=/i.test(scene));
    assert.ok(!/blur\(|filter:/.test(landing), 'no blur on large areas in the scene CSS');
  });

  test('has a payslip stack, a rupee coin, a crane, a hospital with a cross, a campus building and three drifting layers', () => {
    assert.match(scene, /class="slips"/);
    assert.equal((scene.match(/class="slip /g) ?? []).length, 3, 'a stack of three payslips');
    assert.match(scene, /class="coin"/);
    assert.equal((scene.match(/class="face/g) ?? []).length, 2, 'a front and a back face');
    assert.match(scene, /class="crane-arm"/);
    assert.match(scene, /class="cross s-cross"/);
    assert.match(scene, /points="44,150 125,118 206,150"/, 'the campus pediment');
    for (const layer of ['drift-a', 'drift-b', 'drift-c']) assert.match(scene, new RegExp(`class="drift ${layer}"`));
    assert.match(scene, /<radialGradient id="scene-glow">/);
    assert.equal((scene.match(/class="orb /g) ?? []).length, 3, 'soft shapes behind');
  });

  test('is real CSS 3D: perspective, preserve-3d, a coin with thickness and a payslip stack in depth', () => {
    assert.match(landing, /\.scene \{[^}]*perspective: 900px/);
    assert.match(landing, /\.stage \{[^}]*transform-style: preserve-3d/);
    assert.match(landing, /\.coin \{[^}]*transform-style: preserve-3d/);
    assert.match(landing, /\.slip-1 \{ transform: translateZ\(36px\)/);
    assert.match(landing, /backface-visibility: hidden/);
  });

  test('every animation in the scene is in the no-preference block, and it is all paused while the scene is off screen or the tab is hidden', () => {
    const noPreference = top.filter(inNoPreference).map((b) => b.body).join('\n');
    for (const name of ['.scene .drift', '.scene .glow', '.scene .cross', '.scene .crane-arm', '.scene .float', '.scene .coin', '.scene .orb']) assert.ok(noPreference.includes(name), name);
    assert.match(noPreference, /\.scene\[data-paused\], \.scene\[data-paused\] \* \{ animation-play-state: paused; \}/);
    assert.match(read('shared/fx.js'), /IntersectionObserver/);
    assert.match(read('shared/fx.js'), /visibilitychange/);
    assert.ok(!/animation\s*:/.test(landing), 'landing.css itself animates nothing: it is all in motion.css');
  });

  test('the spinning coin and the floating slips animate only transform', () => {
    for (const name of ['m-coin', 'm-float', 'm-bob']) {
      const frame = top.find((b) => b.prelude === `@keyframes ${name}`);
      assert.ok(frame, name);
      assert.deepEqual([...new Set([...frame.body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]))], ['transform'], name);
    }
  });
});

describe('count-up', () => {
  test('finds the first number in a piece of text and leaves the rest alone', () => {
    assert.deepEqual(planCount('₹20,169.45'), { text: '₹20,169.45', prefix: '₹', suffix: '', value: 20169.45, decimals: 2, grouped: true });
    assert.deepEqual(planCount('82 out of 100'), { text: '82 out of 100', prefix: '', suffix: ' out of 100', value: 82, decimals: 0, grouped: false });
    assert.equal(planCount('No score yet'), null);
    assert.equal(planCount('0'), null, 'nothing to count up to');
    assert.equal(planCount('₹0.00'), null);
  });

  test('the first frame is zero, the last frame is EXACTLY the original text', () => {
    for (const text of ['₹20,169.45', '₹1,20,169.45', '82 out of 100', '12', '₹5.00', '3 / 12', '₹99,99,999.99 left', '7']) {
      const plan = planCount(text);
      assert.ok(plan, text);
      assert.equal(countFrame(plan, 1), text);
      assert.equal(countFrame(plan, 1.5), text, 'past the end is still the original');
      assert.match(countFrame(plan, 0), /^\D*0(?:\.0+)?\D*/, `starts at zero: ${countFrame(plan, 0)}`);
    }
  });

  test('keeps the currency, the decimals and the grouping on the way up', () => {
    const plan = planCount('₹20,169.45');
    for (const progress of [0.1, 0.25, 0.5, 0.75, 0.99]) {
      assert.match(countFrame(plan, progress), /^₹[\d,]+\.\d{2}$/, String(progress));
    }
    const values = [0.1, 0.5, 0.9].map((p) => Number(countFrame(plan, p).replace(/[^\d.]/g, '')));
    assert.ok(values[0] < values[1] && values[1] < values[2] && values[2] < 20169.45, 'it only goes up');
  });

  test('easing runs 0 to 1, fast then slow', () => {
    assert.equal(easeOutCubic(0), 0);
    assert.equal(easeOutCubic(1), 1);
    assert.equal(easeOutCubic(-1), 0);
    assert.equal(easeOutCubic(2), 1);
    assert.ok(easeOutCubic(0.5) > 0.5, 'ahead of linear halfway');
  });

  test('the gauge dash grows from nothing to the original attribute', () => {
    assert.equal(dashFrame('94.2 188.5', 1), '94.2 188.5');
    assert.equal(dashFrame('94.2 188.5', 0), '0.000 188.5');
    const [filled, gap] = dashFrame('94.2 188.5', 0.5).split(' ').map(Number);
    assert.ok(filled > 0 && filled < 94.2 && gap === 188.5);
    assert.equal(dashFrame('not numbers', 0.5), 'not numbers');
  });

  test('runs once for about 700 ms and ends with a frame at exactly 1, then reports done', () => {
    assert.equal(COUNT_MS, 700);
    let clock = 0;
    const queued = [];
    const frames = [];
    let done = 0;
    runTimeline({ now: () => clock, requestFrame: (fn) => queued.push(fn), onFrame: (p) => frames.push(p), onDone: () => { done += 1; } });
    while (queued.length > 0) {
      clock += 16;
      queued.shift()();
    }
    assert.equal(frames[0], 0);
    assert.equal(frames.at(-1), 1, 'the last frame is exactly the end state');
    assert.equal(done, 1, 'finishes once');
    assert.ok(frames.every((p, i) => i === 0 || p >= frames[i - 1]), 'never goes backwards');
    assert.ok(frames.length >= 40 && frames.length <= 46, `${frames.length} frames at 16 ms`);
  });

  test('screen readers get the final value at once: the final text is in the DOM and aria-live is off while it counts', () => {
    const code = read('shared/motion.js');
    assert.match(code, /setAttribute\('aria-live', 'off'\)/);
    assert.match(code, /final\.className = 'visually-hidden'/);
    assert.match(code, /final\.textContent = plan\.text/);
    assert.match(code, /moving\.setAttribute\('aria-hidden', 'true'\)/);
    assert.match(code, /el\.textContent = plan\.text;/, 'ends as one plain text node with the exact original');
    assert.match(code, /if \(!root \|\| prefersReducedMotion\(\)\) return null/, 'nothing runs under reduced motion');
    assert.match(code, /dataset\.counted/, 'once per element');
  });

  test('the money, the score gauge and the KPI tiles are marked to count up', () => {
    assert.match(read('shared/payslip.js'), /class: 'big', 'data-count': '', text: money\(slip\.netPaise\)/);
    const overview = read('admin/overview.js');
    assert.match(overview, /class: 'big', 'data-count': '', text: result\.score === null/);
    assert.match(overview, /class: 'big', 'data-count': '', text: value/);
    assert.match(overview, /class: 'gauge-score', 'data-count': ''/);
  });

  test('screens load it after the first paint and mark #main when the tab or section changes', () => {
    const shell = read('shared/shell.js');
    assert.match(shell, /import\('\.\/motion\.js'\)/);
    assert.match(shell, /classList\.add\('route-in'\)/);
    assert.match(read('shared/motion.css'), /#main\.route-in > :not\(\.skeleton\)/);
  });

  test('a toast with the check icon draws the check', () => {
    assert.match(read('shared/dom.js'), /iconName === 'check' \? 'toast toast-ok' : 'toast'/);
  });
});

describe('offline cache', () => {
  test('the precache list has the new files and the revision is bumped', () => {
    const { urls, version } = buildPrecacheList(publicDir);
    assert.ok(urls.includes('/shared/motion.css'));
    assert.ok(urls.includes('/shared/motion.js'));
    assert.ok(urls.includes('/shared/fx.js'), 'the new pointer effects');
    assert.ok(urls.includes('/landing.css') && urls.includes('/landing.js'));
    assert.equal(CACHE_REVISION, 'light-home-1');
    assert.match(version, /^[0-9a-f]{12}$/);
  });

  test('the revision is part of the version, so it changes the cache name', () => {
    assert.match(readFileSync(path.join(publicDir, '..', 'src', 'lib', 'precache.js'), 'utf8'), /createHash\('sha256'\)\.update\(CACHE_REVISION\)/);
  });
});
