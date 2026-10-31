import { h } from './dom.js';
import { icon } from './icons.js';
import { t } from './i18n.js';
import { deviceStorage, nextTheme, setPref, systemPrefersDark } from './prefs.js';

/**
 * Pieces shared by the top bar and the navigation of every page: the light/dark toggle, and the painters that
 * turn a list of destinations into the left sidebar, the bottom bar and the top-bar buttons.
 * A destination is { id, icon, labelKey }; its page is the hash `#id`.
 */

/**
 * The top-bar button that switches between light and dark. It shows the theme you would switch TO (a sun while
 * dark, a moon while light), says so in words for screen readers, and the choice is remembered on the device.
 * It also follows the device while the choice is still "system".
 * @param {HTMLElement} button
 */
export function mountThemeToggle(button) {
  const root = document.documentElement;
  const paint = () => {
    const dark = root.dataset.theme === 'dark';
    const label = t(dark ? 'theme.toLight' : 'theme.toDark');
    button.replaceChildren(icon(dark ? 'sun' : 'moon'), h('span', { class: 'icon-btn-label', text: t(dark ? 'theme.light' : 'theme.dark') }));
    button.setAttribute('aria-label', label);
    button.title = label;
  };
  button.addEventListener('click', () => {
    setPref(deviceStorage(), root, 'theme', nextTheme(root.dataset.themePref ?? 'system', systemPrefersDark()));
    paint();
  });
  new MutationObserver(paint).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  document.addEventListener('langchange', paint);
  paint();
}

const link = (item, current, className = null) =>
  h('a', { href: `#${item.id}`, class: className, 'aria-current': item.id === current ? 'page' : null }, icon(item.icon), h('span', { text: t(item.labelKey) }));

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
        { href: `#${item.id}`, class: 'icon-btn', title: t(item.labelKey), 'aria-label': t(item.labelKey), 'aria-current': item.id === current ? 'page' : null },
        icon(item.icon),
        h('span', { class: 'icon-btn-label', text: t(item.labelKey) }),
      ),
    ),
  );
}
