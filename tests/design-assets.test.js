import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { buildPrecacheList } from '../src/lib/precache.js';
import { startApp } from './helpers.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public');
const read = (file) => readFileSync(path.join(publicDir, file), 'utf8');
const size = (file) => statSync(path.join(publicDir, file)).size;

const FONT_FILES = ['fonts/inter-latin-wght-normal.woff2', 'fonts/fraunces-latin-wght-normal.woff2'];

describe('self-hosted fonts', () => {
  const css = read('shared/base.css');

  test('Inter (interface) and Fraunces (display headings) are real variable woff2 files, together under 300 KB', () => {
    for (const file of FONT_FILES) {
      const bytes = readFileSync(path.join(publicDir, file));
      assert.equal(bytes.subarray(0, 4).toString('latin1'), 'wOF2', `${file} is woff2`);
      assert.ok(bytes.length > 10_000, `${file} is not an empty stub`);
    }
    const total = FONT_FILES.reduce((sum, file) => sum + size(file), 0);
    assert.ok(total < 300 * 1024, `fonts are ${(total / 1024).toFixed(0)} KB`);
    assert.deepEqual(readdirSync(path.join(publicDir, 'fonts')).filter((n) => n.endsWith('.woff2')).sort(), FONT_FILES.map((f) => path.basename(f)).sort(), 'only the two Latin files, nothing else');
  });

  test('each face is declared once, variable, with font-display: swap, from our own origin', () => {
    const faces = [...css.matchAll(/@font-face\s*{[^}]*}/g)].map((m) => m[0]);
    assert.equal(faces.length, 2);
    for (const face of faces) {
      assert.match(face, /font-display: swap/);
      assert.match(face, /font-weight: 100 900/, 'a variable font covers every weight');
      assert.match(face, /url\("\/fonts\/[\w-]+\.woff2"\)/);
      assert.doesNotMatch(face, /https?:/);
    }
    assert.match(faces.join(), /"Inter Variable"/);
    assert.match(faces.join(), /"Fraunces Variable"/);
  });

  test('body and interface use Inter; display headings use Fraunces; Hindi and Tamil use the system font stack', () => {
    assert.match(css, /--font-body: "Inter Variable"/);
    assert.match(css, /--font-display: "Fraunces Variable"/);
    assert.match(css, /h1, h2 { font-family: var\(--font-display\)/);
    const indic = css.match(/html:lang\(hi\), html:lang\(ta\)\s*{[^}]*}/)[0];
    assert.match(indic, /"Noto Sans Devanagari", "Noto Sans Tamil", "Nirmala UI"/);
    assert.doesNotMatch(indic, /Inter|Fraunces/);
    assert.match(indic, /--font-display: var\(--font-body\)/);
  });

  test('nothing is loaded from another site: no external URL in any style, page, script or icon', () => {
    const walk = (dir) => readdirSync(dir).flatMap((n) => (statSync(path.join(dir, n)).isDirectory() ? walk(path.join(dir, n)) : [path.join(dir, n)]));
    const external = [];
    for (const file of walk(publicDir).filter((f) => /\.(css|html|js|svg|webmanifest)$/.test(f))) {
      const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/xmlns="http:\/\/www\.w3\.org\/\d+\/svg"/g, '').replace(/'http:\/\/www\.w3\.org\/2000\/svg'/g, '');
      for (const match of text.matchAll(/https?:\/\/[^\s"')]+/g)) {
        if (!/^https?:\/\/(localhost|127\.0\.0\.1|www\.w3\.org\/1999\/xhtml)/.test(match[0])) external.push(`${path.relative(publicDir, file)}: ${match[0]}`);
      }
    }
    assert.deepEqual(external, []);
  });

  test('the fonts are build tooling only: devDependencies, never runtime dependencies, and the image ignores them', () => {
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    for (const name of ['@fontsource-variable/inter', '@fontsource-variable/fraunces']) {
      assert.ok(pkg.devDependencies[name], `${name} is a devDependency`);
      assert.ok(!(name in pkg.dependencies), `${name} is not a runtime dependency`);
    }
    assert.equal(pkg.scripts.fonts, 'node scripts/copy-fonts.mjs');
    assert.match(readFileSync(path.join(root, 'Dockerfile'), 'utf8'), /npm ci --omit=dev/);
    assert.match(readFileSync(path.join(root, 'scripts', 'copy-fonts.mjs'), 'utf8'), /latin-wght-normal\.woff2/);
  });
});

describe('the FairShift mark', () => {
  const logo = read('logo.svg');

  test('is one small original SVG with no external references, scripts or embedded images', () => {
    assert.match(logo, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 64 64"/);
    assert.doesNotMatch(logo, /<(script|image|use|foreignObject)|href=|url\(/i);
    assert.ok(size('logo.svg') < 2000);
    assert.deepEqual([...new Set(logo.match(/#[0-9A-Fa-f]{6}/g).map((c) => c.toUpperCase()))].sort(), ['#14110D', '#D6B26A'], 'gold and ink only');
    assert.match(logo, /aria-label="FairShift"/);
  });

  test('the favicon is the same mark, and every page uses the logo, the favicon and the manifest', () => {
    assert.equal(read('icon.svg'), logo);
    for (const page of ['index.html', 'worker/index.html', 'admin/index.html']) assert.match(read(page), /<link rel="manifest" href="\/manifest\.webmanifest">/, page);
    for (const page of ['index.html', 'worker/index.html', 'admin/index.html', 'passport/index.html']) {
      assert.ok(read(page).includes('src="/logo.svg"') && read(page).includes('href="/icon.svg"'), page);
    }
    assert.match(read('passport/passport.js'), /print-brand/, 'the public passport also carries it when printed');
  });

  test('the manifest lists icons that exist, with the sizes it claims', () => {
    const manifest = JSON.parse(read('manifest.webmanifest'));
    assert.equal(manifest.start_url, '/worker/');
    const purposes = manifest.icons.map((i) => `${i.type}:${i.sizes}:${i.purpose}`);
    assert.ok(purposes.includes('image/svg+xml:any:any'));
    assert.ok(purposes.includes('image/png:192x192:any') && purposes.includes('image/png:512x512:any') && purposes.includes('image/png:512x512:maskable'));
    for (const icon of manifest.icons) {
      const bytes = readFileSync(path.join(publicDir, icon.src));
      if (icon.type === 'image/png') {
        assert.equal(bytes.subarray(1, 4).toString('latin1'), 'PNG', icon.src);
        const [w, h] = [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
        assert.equal(`${w}x${h}`, icon.sizes, icon.src);
      }
    }
  });
});

describe('served and kept for offline use', () => {
  let app;
  before(async () => {
    app = await startApp();
  });
  after(() => app.close());

  const get = (urlPath) =>
    new Promise((resolve, reject) => {
      http.get(app.base + urlPath, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      }).on('error', reject);
    });

  test('the content security policy is unchanged: everything, fonts included, from our own origin only', async () => {
    const res = await get('/shared/base.css');
    assert.equal(
      res.headers['content-security-policy'],
      "default-src 'self';script-src 'self';style-src 'self';img-src 'self' data:;connect-src 'self';media-src 'self';manifest-src 'self';worker-src 'self';object-src 'none';base-uri 'self';form-action 'self';frame-ancestors 'none'",
    );
  });

  test('fonts are served as woff2 and kept for a week; scripts and styles still revalidate', async () => {
    const font = await get('/fonts/inter-latin-wght-normal.woff2');
    assert.equal(font.status, 200);
    assert.match(font.headers['content-type'], /woff2|font/);
    assert.equal(font.headers['cache-control'], 'public, max-age=604800');
    assert.equal(font.headers['content-encoding'], undefined, 'already compressed: not gzipped again');
    assert.equal((await get('/shared/base.css')).headers['cache-control'], 'no-cache');
    assert.equal((await get('/logo.svg')).status, 200);
  });

  test('the offline precache holds the fonts, the logo and the icons, but not the licence text files', () => {
    const { urls } = buildPrecacheList(publicDir);
    for (const url of ['/fonts/inter-latin-wght-normal.woff2', '/fonts/fraunces-latin-wght-normal.woff2', '/logo.svg', '/icon.svg', '/icon-192.png', '/icon-512.png', '/shared/chrome.js', '/shared/base.css']) {
      assert.ok(urls.includes(url), url);
    }
    assert.ok(!urls.some((u) => u.endsWith('.txt')));
    assert.ok(!urls.includes('/worker/me.js'), 'the removed screen is gone from the list');
    assert.ok(urls.includes('/worker/settings.js'));
  });

  test('the service worker serves the new static paths from its stored copy (fonts, logo, icons)', () => {
    const sw = read('sw.js');
    const pattern = new RegExp(sw.match(/const STATIC_PATH = \/(.*)\/;/)[1]);
    for (const url of ['/fonts/inter-latin-wght-normal.woff2', '/logo.svg', '/icon.svg', '/icon-192.png', '/icon-512.png', '/icon-maskable.svg', '/manifest.webmanifest', '/shared/base.css']) {
      assert.match(url, pattern, url);
    }
    assert.doesNotMatch('/api/me', pattern);
  });
});
