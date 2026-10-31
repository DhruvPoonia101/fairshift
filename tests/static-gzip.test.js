import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { startApp } from './helpers.js';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

/** A raw GET that does not decompress (fetch would), so the bytes on the wire can be checked. */
function get(base, urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    http
      .get(base + urlPath, { headers }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      })
      .on('error', reject);
  });
}

describe('gzipped static files', () => {
  let app;
  before(async () => {
    app = await startApp();
  });
  after(() => app.close());
  const gz = { 'accept-encoding': 'gzip' };

  test('a script is sent compressed, and unzips to exactly the file on disk', async () => {
    const res = await get(app.base, '/shared/queue.js', gz);
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-encoding'], 'gzip');
    assert.equal(res.headers.vary, 'Accept-Encoding');
    assert.match(res.headers['content-type'], /javascript/);
    assert.equal(res.headers['cache-control'], 'no-cache');
    assert.equal(gunzipSync(res.body).toString(), readFileSync(path.join(publicDir, 'shared', 'queue.js'), 'utf8'));
    assert.ok(res.body.length < readFileSync(path.join(publicDir, 'shared', 'queue.js')).length / 2, 'much smaller on the wire');
  });

  test('CSS, JSON, HTML and the manifest are compressed with the right types', async () => {
    for (const [url, type] of [['/shared/base.css', /css/], ['/i18n/hi.json', /json/], ['/worker/', /html/], ['/manifest.webmanifest', /manifest|json/], ['/icon.svg', /svg/]]) {
      const res = await get(app.base, url, gz);
      assert.equal(res.status, 200, url);
      assert.equal(res.headers['content-encoding'], 'gzip', url);
      assert.match(res.headers['content-type'], type, url);
      assert.ok(gunzipSync(res.body).length > 0);
    }
  });

  test('without Accept-Encoding: gzip the plain file is sent', async () => {
    const res = await get(app.base, '/shared/queue.js', { 'accept-encoding': 'identity' });
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-encoding'], undefined);
    assert.equal(res.body.toString(), readFileSync(path.join(publicDir, 'shared', 'queue.js'), 'utf8'));
  });

  test('a repeat request with the ETag gets a 304 with no body', async () => {
    const first = await get(app.base, '/shared/api.js', gz);
    const again = await get(app.base, '/shared/api.js', { ...gz, 'if-none-match': first.headers.etag });
    assert.equal(again.status, 304);
    assert.equal(again.body.length, 0);
  });

  test('it cannot be used to read outside the public folder, and missing files stay 404', async () => {
    for (const url of ['/..%2f..%2fpackage.json', '/%2e%2e/%2e%2e/.env', '/..%2fsrc%2fapp.js', '/shared/..%2f..%2fserver.js']) {
      const res = await get(app.base, url, gz);
      assert.notEqual(res.headers['content-encoding'], 'gzip', url);
      assert.ok(!res.body.toString().includes('createApp') && !res.body.toString().includes('SESSION_SECRET'), url);
    }
    assert.equal((await get(app.base, '/shared/nope.js', gz)).status, 404);
    assert.equal((await get(app.base, '/shared/%E0%A4%A.js', gz)).status, 404, 'a malformed path is a plain 404, not a crash');
  });

  test('POST and images are left to the normal static handler', async () => {
    const post = await app.request('/shared/queue.js', { method: 'POST', body: {} });
    assert.notEqual(post.headers.get('content-encoding'), 'gzip');
  });
});
