import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

// dom.js imports the icon and translation modules, which only touch the page when called, so it loads in node.
const { fill } = await import('../public/shared/dom.js');

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

/** An element that replaces its children the way a browser does: anything that is not a node becomes TEXT ("null", "false"...). */
class FakeNode {
  constructor(name) {
    this.name = name;
  }
}
const fakeParent = () => ({
  children: [],
  replaceChildren(...args) {
    this.children = args.map((arg) => (arg instanceof FakeNode ? arg.name : `text:${String(arg)}`));
  },
});

describe('the "null" on the landing page', () => {
  test('the browser behaviour that caused it: replaceChildren(null) writes the text "null"', () => {
    const parent = fakeParent();
    parent.replaceChildren(null);
    assert.deepEqual(parent.children, ['text:null']);
    parent.replaceChildren(undefined, false);
    assert.deepEqual(parent.children, ['text:undefined', 'text:false']);
  });

  test('fill() with a condition that is false shows nothing (the tour slot when /api/config fails)', () => {
    const config = { demoMode: false, adminLogin: false, sectors: [] }; // what landing.js uses when /api/config fails
    const parent = fakeParent();
    fill(parent, config.demoMode ? new FakeNode('tour-button') : null);
    assert.deepEqual(parent.children, []);
  });

  test('fill() with a condition that is true shows the node', () => {
    const parent = fakeParent();
    fill(parent, true ? new FakeNode('tour-button') : null);
    assert.deepEqual(parent.children, ['tour-button']);
  });

  test('fill() drops null, undefined and false anywhere, flattens arrays, and keeps nodes and real text in order', () => {
    const parent = fakeParent();
    fill(parent, null, new FakeNode('a'), undefined, [new FakeNode('b'), false, null], 'hello', 0, '', false);
    assert.deepEqual(parent.children, ['a', 'b', 'text:hello', 'text:0', 'text:']);
  });

  test('fill() with no children empties the element', () => {
    const parent = fakeParent();
    parent.children = ['old'];
    fill(parent);
    assert.deepEqual(parent.children, []);
  });

  test('the landing page uses it for the tour slot, and the empty slot takes no space', () => {
    const landing = readFileSync(path.join(publicDir, 'landing.js'), 'utf8');
    assert.match(landing, /fill\(\s*document\.getElementById\('tour-slot'\)/);
    assert.match(readFileSync(path.join(publicDir, 'landing.css'), 'utf8'), /#tour-slot:empty\s*{\s*display:\s*none/);
    assert.match(readFileSync(path.join(publicDir, 'index.html'), 'utf8'), /<div id="tour-slot" class="row"><\/div>/, 'no text in the slot before the script runs');
  });
});

/**
 * Finds `replaceChildren(...)` calls that pass a value which can be null, undefined or false as a direct
 * argument (`cond ? node : null`, `a && node`). Those become the text "null" or "false" on the page; use fill()
 * (or h(), which skips them) instead. Arguments nested inside another call, such as h('p', {}, cond ? x : null), are fine.
 * @returns {string[]} the offending arguments
 */
export function risky(source) {
  // Blank out comments and string contents, keeping the code's shape.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/.*$/gm, '')
    .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\[\s\S])*`/g, (m) => `${m[0]}${' '.repeat(m.length - 2)}${m[0]}`);
  const found = [];
  for (const match of code.matchAll(/\.replaceChildren\(/g)) {
    let depth = 1;
    let arg = '';
    const args = [];
    for (let i = match.index + match[0].length; i < code.length && depth > 0; i += 1) {
      const ch = code[i];
      if ('([{'.includes(ch)) depth += 1;
      else if (')]}'.includes(ch)) depth -= 1;
      if (depth === 0) break;
      if (ch === ',' && depth === 1) {
        args.push(arg);
        arg = '';
      } else if (depth === 1 || (depth === 2 && '([{'.includes(ch) && false)) arg += ch; // only the top level of the argument list
    }
    args.push(arg);
    for (const text of args) if (/[?:]\s*(null|undefined|false)\b|&&/.test(text)) found.push(text.trim());
  }
  return found;
}

describe('no frontend file passes a possibly-null value straight to replaceChildren', () => {
  const files = (dir) =>
    readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      return statSync(full).isDirectory() ? files(full) : full.endsWith('.js') ? [full] : [];
    });

  test('the scan catches the original bug', () => {
    const original = `slot.replaceChildren(
      config.demoMode
        ? iconButton('compass', t('tour.button'), { class: 'btn', onclick: () => go() })
        : null,
    );`;
    assert.equal(risky(original).length, 1);
    assert.equal(risky(`box.replaceChildren(ok && node)`).length, 1);
  });

  test('the scan leaves safe code alone', () => {
    assert.deepEqual(risky(`el.replaceChildren(h('p', {}, a ? b : null), ...items.map((i) => (i ? x : null)))`), []);
    assert.deepEqual(risky(`el.replaceChildren()`), []);
    assert.deepEqual(risky(`el.replaceChildren(skeleton('list'))`), []);
    assert.deepEqual(risky(`fill(el, cond ? node : null)`), []);
    assert.deepEqual(risky("el.replaceChildren(t('a: null && b'))"), [], 'text inside a string is not code');
  });

  test('every file under public/ is clean', () => {
    const problems = files(publicDir).flatMap((file) => risky(readFileSync(file, 'utf8')).map((arg) => `${path.relative(publicDir, file)}: ${arg}`));
    assert.deepEqual(problems, []);
  });
});
