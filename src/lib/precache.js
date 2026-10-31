import { createHash } from 'node:crypto';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/** Folders whose files the worker app needs to open with no signal. */
const FOLDERS = ['shared', 'worker', 'i18n'];
const ROOT_FILES = ['landing.js', 'landing.css', 'icon.svg', 'manifest.webmanifest'];
const SHELL_PAGES = ['/', '/worker/'];

/**
 * The list of files the service worker stores at install time, so the worker app opens with no signal.
 * `version` changes whenever a file changes (name, size or date), which gives every release its own cache.
 * @param {string} publicDir
 * @returns {{ version: string, urls: string[] }}
 */
export function buildPrecacheList(publicDir) {
  const urls = [...SHELL_PAGES];
  const fingerprint = createHash('sha256');
  const add = (url, file) => {
    const info = statSync(file);
    urls.push(url);
    fingerprint.update(`${url}|${info.size}|${Math.floor(info.mtimeMs)}`);
  };
  for (const folder of FOLDERS) {
    for (const name of readdirSync(path.join(publicDir, folder)).sort()) {
      if (folder === 'worker' && name === 'index.html') continue; // stored as "/worker/"
      add(`/${folder}/${name}`, path.join(publicDir, folder, name));
    }
  }
  for (const name of ROOT_FILES) add(`/${name}`, path.join(publicDir, name));
  for (const page of [['index.html'], ['worker', 'index.html']]) fingerprint.update(`${page.join('/')}|${statSync(path.join(publicDir, ...page)).mtimeMs}`);
  return { version: fingerprint.digest('hex').slice(0, 12), urls };
}
