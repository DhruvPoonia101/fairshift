import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

const { labelCells } = await import('../public/shared/dom.js');

/** Just enough of a DOM for labelCells: tables with a header row and body rows of cells. */
function fakeTable({ heads, rows }) {
  const cell = (text) => ({ textContent: text, dataset: {} });
  const table = {
    classList: { classes: new Set(), add(c) { this.classes.add(c); } },
    heads: heads.map(cell),
    rows: rows.map((cells) => ({ children: cells.map(cell) })),
    querySelectorAll(selector) {
      if (selector === 'thead th') return this.heads;
      if (selector === 'tbody tr') return this.rows;
      return [];
    },
  };
  return table;
}
const root = (...tables) => ({ querySelectorAll: (selector) => (selector === 'table' ? tables : []) });

describe('labelCells: tables that read well on a phone', () => {
  test('every cell gets the text of its column header, and the table is marked responsive', () => {
    const table = fakeTable({ heads: [' Worker ', 'Day', 'Status'], rows: [['Asha', 'Mon', 'Open'], ['Ravi', 'Tue', 'Done']] });
    labelCells(root(table));
    assert.deepEqual(table.rows.map((r) => r.children.map((c) => c.dataset.label)), [['Worker', 'Day', 'Status'], ['Worker', 'Day', 'Status']]);
    assert.ok(table.classList.classes.has('responsive'));
  });

  test('a table with no header is left alone', () => {
    const table = fakeTable({ heads: [], rows: [['a', 'b']] });
    labelCells(root(table));
    assert.deepEqual(table.rows[0].children.map((c) => c.dataset.label), [undefined, undefined]);
    assert.ok(!table.classList.classes.has('responsive'));
  });

  test('cells beyond the last header are not given a wrong label', () => {
    const table = fakeTable({ heads: ['A', 'B'], rows: [['1', '2', '3']] });
    labelCells(root(table));
    assert.deepEqual(table.rows[0].children.map((c) => c.dataset.label), ['A', 'B', undefined]);
  });

  test('it is safe to run again after a table is redrawn, and handles a page with no tables or several', () => {
    const first = fakeTable({ heads: ['A'], rows: [['1']] });
    const second = fakeTable({ heads: ['X', 'Y'], rows: [['1', '2']] });
    labelCells(root());
    labelCells(root(first, second));
    labelCells(root(first, second));
    assert.equal(first.rows[0].children[0].dataset.label, 'A');
    assert.deepEqual(second.rows[0].children.map((c) => c.dataset.label), ['X', 'Y']);
  });

  test('the stylesheet turns a responsive table into labelled cards below 768px, with no horizontal scroll needed', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync(new URL('../public/shared/base.css', import.meta.url), 'utf8');
    assert.match(css, /@media \(max-width: 47\.99rem\)/);
    assert.match(css, /table\.responsive thead\s*{[^}]*clip/);
    assert.match(css, /table\.responsive td::before[^{]*{\s*content: attr\(data-label\)/);
    assert.match(css, /table\.responsive tr\s*{[^}]*display|table\.responsive, table\.responsive tbody, table\.responsive tr[^{]*{\s*display: block/);
  });
});
