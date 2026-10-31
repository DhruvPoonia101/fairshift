// Dev tooling, not part of the app: copies the Latin variable woff2 files (and their licences) from the
// @fontsource-variable devDependencies into public/fonts, which is what the server actually serves.
// Run with `npm run fonts` after changing a font package. The app itself has no font dependency at runtime.
import { copyFileSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'public', 'fonts');
const FONTS = [
  { pkg: '@fontsource-variable/inter', file: 'inter-latin-wght-normal.woff2', licence: 'LICENSE-Inter.txt' },
  { pkg: '@fontsource-variable/fraunces', file: 'fraunces-latin-wght-normal.woff2', licence: 'LICENSE-Fraunces.txt' },
];

mkdirSync(out, { recursive: true });
let total = 0;
for (const { pkg, file, licence } of FONTS) {
  const from = path.join(root, 'node_modules', pkg);
  copyFileSync(path.join(from, 'files', file), path.join(out, file));
  copyFileSync(path.join(from, 'LICENSE'), path.join(out, licence));
  total += statSync(path.join(out, file)).size;
  console.log(`${file}  ${(statSync(path.join(out, file)).size / 1024).toFixed(1)} KB`);
}
console.log(`total ${(total / 1024).toFixed(1)} KB (budget: under 300 KB)`);
