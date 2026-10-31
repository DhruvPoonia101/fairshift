import { createHash } from 'node:crypto';
import { statSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const COMPRESSIBLE = new Set(['.js', '.css', '.json', '.html', '.svg', '.webmanifest']);

/**
 * Sends the app's static text files gzipped when the browser accepts it, so a cheap phone downloads about a
 * third of the bytes (the worker app is ~78 KB of JavaScript as written and ~31 KB over the wire). No
 * dependency: each file is compressed once, on its first request, and kept until the file changes.
 * Anything else (images, other methods, files that do not exist) falls through to express.static.
 * @param {string} publicDir
 */
export function gzipStatic(publicDir) {
  const root = path.resolve(publicDir);
  const cache = new Map(); // file -> { stamp, body, etag }

  function compressed(file, info) {
    const stamp = `${info.size}:${Math.floor(info.mtimeMs)}`;
    const saved = cache.get(file);
    if (saved?.stamp === stamp) return saved;
    const raw = readFileSync(file);
    const entry = { stamp, body: gzipSync(raw, { level: 9 }), etag: `W/"${createHash('sha1').update(raw).digest('base64url').slice(0, 20)}-gz"` };
    cache.set(file, entry);
    return entry;
  }

  return (req, res, next) => {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || !/\bgzip\b/.test(req.get('accept-encoding') ?? '')) return next();
    let relative;
    try {
      relative = decodeURIComponent(req.path);
    } catch {
      return next();
    }
    if (relative.endsWith('/')) relative += 'index.html';
    const extension = path.extname(relative);
    if (!COMPRESSIBLE.has(extension)) return next();
    const file = path.resolve(root, `.${relative}`);
    if (!file.startsWith(`${root}${path.sep}`)) return next(); // never leave the public folder
    let info;
    try {
      info = statSync(file);
    } catch {
      return next();
    }
    if (!info.isFile()) return next();

    const { body, etag } = compressed(file, info);
    res.set({ 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding', ETag: etag, 'Cache-Control': 'no-cache' });
    res.type(extension);
    if (req.fresh) return res.status(304).end();
    return req.method === 'HEAD' ? res.set('Content-Length', String(body.length)).end() : res.send(body);
  };
}
