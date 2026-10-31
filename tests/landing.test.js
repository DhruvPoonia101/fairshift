import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CARD_TILT_DEG, MAGNET_PX, SCENE_TILT_DEG, magnetFor, revealDelay, tiltFor, unit } from '../public/shared/fx.js';
import { toneOf } from '../public/shared/icons.js';
import { SECTORS } from '../src/config/sectors.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');
const html = read('public/index.html');
const landingCss = read('public/landing.css');
const landingJs = read('public/landing.js');
const fxJs = read('public/shared/fx.js');
const TONES = ['pay', 'report', 'speak', 'skills', 'checkin', 'rest', 'lang', 'payroll'];

describe('the homepage layout', () => {
  test('DOM order: headline first, then the sign-in card, then the scene (phones read it top to bottom, keyboards tab to sign-in before anything decorative)', () => {
    const at = (needle) => html.indexOf(needle);
    assert.ok(at('id="hero-title"') > 0);
    assert.ok(at('id="hero-title"') < at('id="signin"'), 'the headline comes before the sign-in card');
    assert.ok(at('id="signin"') < at('id="scene"'), 'the sign-in card comes before the scene');
    assert.ok(at('id="signin"') < at('id="how-title"') && at('id="scene"') < at('id="how-title"'));
    const sceneBlock = html.slice(at('<div class="scene"'), at('<!-- /scene -->'));
    assert.ok(!/\b(a|button|input|select|textarea)\b[^>]*>/.test(sceneBlock.replace(/<\/?(?:svg|path|g|rect|circle|polygon|ellipse|defs|stop|radialGradient)\b[^>]*>/g, '')), 'nothing focusable inside the scene');
  });

  test('two columns from 60 rem (sign-in left, the promise and scene right), one column on a phone', () => {
    assert.match(landingCss, /\.hero \{[^}]*display: grid[^}]*grid-template-columns: minmax\(0, 1fr\)/);
    assert.match(landingCss, /@media \(min-width: 60rem\)/);
    assert.match(landingCss, /grid-template-areas: "signin copy" "signin scene"/);
  });

  test('the sign-in card has Worker / Employer tabs, the demo accounts and the Judge tour slot', () => {
    assert.match(html, /<section class="signin card card-raised" id="signin" aria-labelledby="signin-title">/);
    assert.match(html, /id="signin-tabs" role="group"/);
    assert.match(html, /<div id="tour-slot" class="row"><\/div>/);
    assert.match(landingJs, /'aria-pressed': String\(kind === name\)/, 'the tabs say which one is chosen');
    assert.match(landingJs, /landing\.tabWorker/);
    assert.match(landingJs, /landing\.tabEmployer/);
    assert.match(landingJs, /config\.sectors\.map\(\(\{ id, icon: sectorIcon \}\) =>[\s\S]*demo-row/, 'one demo row per sector from the server config');
    assert.match(landingJs, /`worker-\$\{id\}`/);
    assert.match(landingJs, /`admin-\$\{id\}`/);
    assert.match(landingJs, /tour-ui\.js/);
  });

  test('sign-in uses exactly the routes it always did: demo-login, the employer password login and the config', () => {
    const calls = [...landingJs.matchAll(/\bapi\(\s*([`'][^,)]+)/g)].map((m) => m[1]);
    assert.deepEqual([...new Set(calls)].sort(), ["'/config'", "'/login/admin'", '`/demo-login/${role}`'].sort());
    assert.match(landingJs, /DESTINATION = \{ worker: '\/worker\/', admin: '\/admin\/' \}/);
    assert.match(landingJs, /body: \{ org: org\.value, password: password\.value \}/);
  });

  test('the new sections: how it works (3 steps), the three industries, the SDG 8 strip with targets 8.5 and 8.8, trust chips and the footer', () => {
    assert.equal((html.match(/<li class="card" data-tilt data-shine data-reveal>/g) ?? []).length, 3, 'three steps');
    for (const key of ['landing.how.1.title', 'landing.how.2.title', 'landing.how.3.title', 'landing.how.1.text', 'landing.how.2.text', 'landing.how.3.text']) assert.ok(html.includes(`data-i18n="${key}"`), key);
    assert.match(landingCss, /counter-increment: step/, 'numbered');
    assert.ok(html.includes('id="industries"') && html.includes('data-i18n="landing.industriesTitle"'));
    assert.ok(html.includes('data-i18n="landing.sdg.t85"') && html.includes('data-i18n="landing.sdg.t88"'));
    const en = JSON.parse(read('public/i18n/en.json'));
    assert.match(en['landing.sdg.t85'], /8\.5.*equal pay for work of equal value/);
    assert.match(en['landing.sdg.t88'], /8\.8.*safe and secure working environments/);
    assert.equal((html.match(/class="trust"/g) ?? []).length, 3);
    for (const key of ['landing.trust.offline', 'landing.trust.langs', 'landing.trust.anon']) assert.ok(html.includes(`data-i18n="${key}"`), key);
    assert.match(html, /<footer class="container muted foot">/);
    assert.equal(en['landing.headline'], 'Know your pay. Speak up safely. Work fair hours.');
  });

  test('each of the three industries has its own accent colour and a small animated icon', () => {
    assert.match(landingJs, /SECTOR_TONE = \{ construction: 'pay', college: 'skills', hospital: 'speak' \}/);
    assert.deepEqual(Object.keys(SECTORS).sort(), ['college', 'construction', 'hospital']);
    assert.match(landingJs, /class: 'card industry', 'data-tone': SECTOR_TONE\[id\] \?\? 'checkin'/);
    assert.match(landingJs, /tile-icon tile-icon-lg bob/);
    assert.match(landingCss, /\.industry \{[^}]*border-top: 4px solid var\(--tone\)/);
    assert.match(read('public/shared/motion.css'), /\.bob svg \{ animation: m-bob/);
  });

  test('every coloured tile on the page uses one of the eight tones', () => {
    const used = new Set([...html.matchAll(/data-tone="(\w+)"/g)].map((m) => m[1]));
    assert.ok(used.size >= 5, [...used].join());
    for (const tone of used) assert.ok(TONES.includes(tone), tone);
  });
});

describe('it is light, original and cheap', () => {
  test('no inline script or style, no external origin, one module script', () => {
    assert.ok(!/<style|\sstyle=|<script(?![^>]*\ssrc=)/i.test(html), 'no inline script or style');
    assert.ok(!/https?:\/\//.test(html.replace(/xmlns="[^"]*"/g, '')), 'no external origin');
    assert.equal((html.match(/<script type="module" src="\/landing\.js"><\/script>/g) ?? []).length, 1);
    assert.ok(!/@import|url\(["']?https?:/.test(landingCss + read('public/shared/motion.css')));
  });

  test('budgets: the page CSS under 15 KB, new JS under 10 KB, no image over 30 KB', () => {
    assert.ok(Buffer.byteLength(landingCss) < 15 * 1024, `landing.css ${Buffer.byteLength(landingCss)}`);
    assert.ok(Buffer.byteLength(fxJs) < 10 * 1024, `fx.js ${Buffer.byteLength(fxJs)}`);
    assert.ok(Buffer.byteLength(landingJs) < 10 * 1024, `landing.js ${Buffer.byteLength(landingJs)}`);
    const images = [...html.matchAll(/<img[^>]*src="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual([...new Set(images)], ['/logo.svg'], 'the only image is the logo; the scene is inline SVG and CSS');
    for (const rel of ['logo.svg', 'icon.svg']) assert.ok(statSync(path.join(root, 'public', rel)).size < 30 * 1024, rel);
    const publicImages = [];
    const walk = (dir) => readdirSync(dir).forEach((name) => {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(png|jpe?g|webp|gif)$/i.test(name)) publicImages.push([name, statSync(full).size]);
    });
    walk(path.join(root, 'public'));
    for (const [name, size] of publicImages) assert.ok(size < 30 * 1024, `${name} is ${size} bytes`);
  });

  test('no layout shift: the sign-in card, the scene and the industries have their space before anything loads', () => {
    assert.match(landingCss, /\.signin \{[^}]*min-height: 22rem/);
    assert.match(landingCss, /\.scene \{[^}]*aspect-ratio: 16 \/ 11/);
    assert.match(html, /id="industries"><div class="skel skel-card"/);
    assert.match(html, /<img src="\/logo\.svg" alt="" width="32" height="32">/);
  });

  test('no WebGL, canvas, three.js, GSAP or other library', () => {
    for (const source of [landingJs, fxJs, landingCss, html]) assert.ok(!/webgl|three\.js|gsap|<canvas|getContext\(/i.test(source));
  });
});

describe('pointer effects (shared/fx.js)', () => {
  test('the scene tilts at most 8 degrees, cards a little less, buttons move at most 6 px', () => {
    assert.equal(SCENE_TILT_DEG, 8);
    assert.ok(CARD_TILT_DEG <= SCENE_TILT_DEG);
    assert.equal(MAGNET_PX, 6);
    const box = { left: 100, top: 100, width: 400, height: 200 };
    assert.deepEqual(tiltFor({ x: 300, y: 200, ...box }, 8), { rx: 0, ry: 0 }, 'the middle: flat');
    assert.deepEqual(tiltFor({ x: 500, y: 100, ...box }, 8), { rx: 8, ry: 8 }, 'a corner: the maximum');
    assert.deepEqual(tiltFor({ x: 100, y: 300, ...box }, 8), { rx: -8, ry: -8 }, 'bottom-left corner');
    for (const [x, y] of [[-5000, -5000], [9000, 9000], [0, 9000], [9000, 0]]) {
      const { rx, ry } = tiltFor({ x, y, ...box }, SCENE_TILT_DEG);
      assert.ok(Math.abs(rx) <= 8 && Math.abs(ry) <= 8, `${x},${y} is clamped`);
    }
    assert.equal(unit(50, 0, 0), 0, 'a zero-size box does not divide by zero');
  });

  test('a magnetic button follows the pointer by at most 6 px and lets go when the pointer is far away', () => {
    const button = { left: 200, top: 200, width: 120, height: 48 };
    assert.deepEqual(magnetFor({ x: 260, y: 224, ...button }), { tx: 0, ty: 0 }, 'dead centre: no pull');
    const pulled = magnetFor({ x: 320, y: 248, ...button });
    assert.ok(pulled.tx > 0 && pulled.tx <= 6 && pulled.ty > 0 && pulled.ty <= 6, JSON.stringify(pulled));
    const near = magnetFor({ x: 350, y: 224, ...button });
    assert.ok(Math.abs(near.tx) <= 6, 'just outside: still capped');
    assert.deepEqual(magnetFor({ x: 900, y: 900, ...button }), { tx: 0, ty: 0 }, 'far away: nothing');
    assert.deepEqual(magnetFor({ x: 0, y: 224, ...button }), { tx: 0, ty: 0 });
  });

  test('reveals come one after another, capped so nothing waits long', () => {
    assert.deepEqual([0, 1, 2, 5, 9].map(revealDelay), [0, 80, 160, 400, 400]);
  });

  test('tilt, highlight and magnetic buttons run only with a fine pointer that can hover, and never under reduced motion', () => {
    assert.match(fxJs, /FINE_HOVER = '\(hover: hover\) and \(pointer: fine\)'/);
    assert.equal((fxJs.match(/if \(!matches\(FINE_HOVER\)\) return;/g) ?? []).length, 3, 'scene tilt, card tilt and magnetic buttons all check it');
    assert.match(fxJs, /if \(matches\('\(prefers-reduced-motion: reduce\)'\)\) return;/, 'nothing at all under reduced motion');
    assert.match(landingCss, /@media \(hover: hover\) and \(pointer: fine\) and \(prefers-reduced-motion: no-preference\) \{\s*\.landing \[data-tilt\]/);
    assert.match(landingCss, /\.magnetic \{ translate: var\(--tx, 0\) var\(--ty, 0\)/);
    const outside = landingCss.replace(/@media \(hover: hover\)[\s\S]*?\n\}\n/, '');
    assert.ok(!/:hover/.test(outside.replace(/\[data-shine\]:hover::before/, '')), 'no hover rule outside the guarded block');
  });

  test('only transform and opacity are driven: the effects set custom properties that feed transform, translate and opacity', () => {
    const effects = landingCss.match(/@media \(hover: hover\)[\s\S]*?\n\}\n/)[0] + landingCss.match(/\[data-shine\]::before[^\n]*/)[0];
    assert.ok(!/(?:^|[;{\s])(?:left|top|width|height|margin|background-position|box-shadow)\s*:[^;]*var\(--(?:tx|ty|trx|try|mx|my)/.test(effects.replace(/left: 0; top: 0; width: 16rem; height: 16rem; margin: -8rem 0 0 -8rem;/, '')), 'no layout property reads a pointer variable');
    assert.match(landingCss, /transform: translate\(var\(--mx, 50%\), var\(--my, 50%\)\)/, 'the highlight moves by transform');
    assert.match(landingCss, /\.fx-in \{ transition: opacity 450ms[^}]*transform 450ms/);
  });

  test('scroll reveal only hides blocks that start below the fold, and any part in view brings them back', () => {
    assert.match(fxJs, /getBoundingClientRect\(\)\.top > window\.innerHeight/);
    assert.match(fxJs, /\{ threshold: 0 \}/);
    assert.match(fxJs, /classList\.add\('fx-wait'\)/);
    assert.match(fxJs, /classList\.remove\('fx-wait'\)/);
    assert.match(landingCss, /@media \(prefers-reduced-motion: reduce\) \{ \.fx-wait \{ opacity: 1; transform: none; \} \}/);
  });

  test('primary buttons on the landing page are magnetic, and the page starts the effects once', () => {
    assert.match(landingJs, /btn btn-primary magnetic/);
    assert.match(landingJs, /import \{ startFx \} from '\.\/shared\/fx\.js'/);
    assert.equal((landingJs.match(/startFx\(document\)/g) ?? []).length, 1);
  });
});

describe('the rupee icon and the coloured icons', () => {
  const icons = read('public/shared/icons.js');
  const RUPEE = "['M7 4.5h10', 'M7 8.5h10', 'M7 4.5h3.5a4 4 0 0 1 0 8H7', 'M7 12.5l8 7']";

  test('a clean inline-SVG rupee glyph exists and the wallet icon is gone everywhere', () => {
    assert.ok(icons.includes(`rupee: ${RUPEE}`));
    assert.ok(!/\bwallet\b/.test(icons));
    const walk = (dir) => readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      return statSync(full).isDirectory() ? walk(full) : [full];
    });
    const offenders = [...walk(path.join(root, 'public')), ...walk(path.join(root, 'src'))]
      .filter((f) => /\.(js|css|html|json)$/.test(f) && !f.includes(`${path.sep}fonts${path.sep}`))
      .filter((f) => /['"`]wallet['"`]/.test(readFileSync(f, 'utf8')));
    assert.deepEqual(offenders.map((f) => path.relative(root, f)), []);
  });

  test('the rupee is used for the Pay nav item, the Home "My pay" tile, the landing pay step and point, payslip headings and the employer Payroll nav item', () => {
    assert.match(read('public/worker/nav.js'), /\{ id: 'pay', icon: 'rupee'/);
    assert.match(read('public/worker/home.js'), /tile\('rupee', t\('tab\.pay'\)/);
    assert.match(read('public/shared/payslip.js'), /icon\('rupee'\), t\('payslip\.netTitle'\)/);
    assert.match(read('public/admin/app.js'), /\{ id: 'payroll', icon: 'rupee', tone: 'payroll'/);
    assert.match(read('src/config/sectors.js'), /\{ id: 'pay', icon: 'rupee'/);
    const glyph = 'M7 4.5h10M7 8.5h10M7 4.5h3.5a4 4 0 0 1 0 8H7M7 12.5l8 7';
    assert.ok((html.match(new RegExp(glyph.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length >= 4, 'the landing "pay" point, the pay step and both coin faces');
  });

  test('every feature has its own tone, and each icon has the tone of its feature', () => {
    assert.deepEqual(
      Object.fromEntries(['rupee', 'alert', 'eyeOff', 'badge', 'qr', 'moon', 'globe', 'download'].map((name) => [name, toneOf(name)])),
      { rupee: 'pay', alert: 'report', eyeOff: 'speak', badge: 'skills', qr: 'checkin', moon: 'rest', globe: 'lang', download: 'payroll' },
    );
    assert.equal(toneOf('gear'), null, 'an icon with no feature keeps the plain accent');
  });

  test('the tints are applied on the landing cards, the worker Home tiles and nav, and the employer sidebar and KPI tiles', () => {
    const chrome = read('public/shared/chrome.js');
    assert.match(chrome, /'data-tone': toneFor\(item\)/, 'sidebar, bottom bar and top links');
    assert.match(chrome, /svg\.classList\.add\('tinted'\)/);
    assert.match(read('public/worker/home.js'), /class: 'quick-icon', 'data-tone': toneOf\(iconName\)/);
    assert.match(read('public/admin/overview.js'), /class: 'row', 'data-tone': toneOf\(iconName\)/);
    assert.match(read('public/worker/worker.css'), /\.quick-icon \{[^}]*background: var\(--tone-soft/);
    assert.match(read('public/shared/base.css'), /\[data-tone\] > svg\.icon\.tinted \{[^}]*background: var\(--tone-soft\)/);
    const app = read('public/admin/app.js');
    for (const id of ['overview', 'attendance', 'grievances', 'people', 'feedback', 'skills', 'payroll', 'compliance', 'disputes']) assert.match(app, new RegExp(`\\{ id: '${id}', icon: '\\w+', tone: '\\w+'`), `${id} has a tone`);
  });
});
