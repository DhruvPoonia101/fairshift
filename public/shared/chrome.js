import { h } from './dom.js';
import { icon, toneOf } from './icons.js';
import { t } from './i18n.js';

/**
 * Pieces shared by the top bar and the navigation of every page: the painters that
 * turn a list of destinations into the left sidebar, the bottom bar and the top-bar buttons.
 * A destination is { id, icon, labelKey, tone? }; its page is the hash `#id`. The icon sits in a tint of its feature's colour
 * (the tone is the destination's own, or the icon's default).
 */

const toneFor = (item) => item.tone ?? toneOf(item.icon);

function tinted(item) {
  const svg = icon(item.icon);
  if (toneFor(item)) svg.classList.add('tinted');
  return svg;
}

const link = (item, current, className = null) =>
  h('a', { href: `#${item.id}`, class: className, 'data-tone': toneFor(item), 'aria-current': item.id === current ? 'page' : null }, tinted(item), h('span', { text: t(item.labelKey) }));

/** The left sidebar (900px and up): groups of destinations with a divider between them. */
export function paintSidenav(list, groups, current) {
  const nodes = [];
  groups.forEach((group, index) => {
    if (index > 0) nodes.push(h('li', { class: 'sidenav-sep', role: 'presentation' }));
    for (const item of group) nodes.push(h('li', {}, link(item, current)));
  });
  list.replaceChildren(...nodes);
}

/** The bottom bar (phones): every item has an icon and a label, and the current one is marked by more than colour. */
export function paintTabbar(list, items, current) {
  list.style.setProperty('--tabs', String(items.length));
  list.replaceChildren(...items.map((item) => h('li', {}, link(item, current))));
}

/** Labelled icon buttons in the top bar (the label is spoken always, and shown from 600px). */
export function paintTopLinks(container, items, current) {
  container.replaceChildren(
    ...items.map((item) =>
      h(
        'a',
        { href: `#${item.id}`, class: 'icon-btn', 'data-tone': toneFor(item), title: t(item.labelKey), 'aria-label': t(item.labelKey), 'aria-current': item.id === current ? 'page' : null },
        tinted(item),
        h('span', { class: 'icon-btn-label', text: t(item.labelKey) }),
      ),
    ),
  );
}
