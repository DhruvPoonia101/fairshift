import { h, toast } from '../shared/dom.js';
import { icon } from '../shared/icons.js';
import { t } from '../shared/i18n.js';
import { TEXT_SIZES, deviceStorage, readPrefs, setPref } from '../shared/prefs.js';

/** Text size and contrast: applied at once, remembered on this device. */
function displaySettings() {
  const storage = deviceStorage();
  const root = document.documentElement;
  let prefs = readPrefs(storage);

  const sizeButtons = TEXT_SIZES.map((size) =>
    h(
      'button',
      { type: 'button', class: 'btn', 'data-size': size, 'aria-pressed': String(prefs.textSize === size), onclick: () => choose('textSize', size) },
      h('span', { class: `size-sample size-${size}`, 'aria-hidden': 'true', text: 'Aa' }),
      h('span', { text: t(`me.size.${size}`) }),
    ),
  );
  const contrast = h('input', { type: 'checkbox', id: 'me-contrast', checked: prefs.contrast === 'high' });
  contrast.checked = prefs.contrast === 'high';
  contrast.addEventListener('change', () => choose('contrast', contrast.checked ? 'high' : 'normal'));

  function choose(key, value) {
    prefs = setPref(storage, root, key, value);
    for (const button of sizeButtons) button.setAttribute('aria-pressed', String(button.dataset.size === prefs.textSize));
    toast(t('me.saved'));
  }

  return h(
    'section',
    { class: 'card stack', 'aria-labelledby': 'display-title' },
    h('h2', { id: 'display-title', class: 'row' }, icon('sun'), t('me.display')),
    h('div', { class: 'stack-sm', role: 'group', 'aria-labelledby': 'size-label' }, h('p', { id: 'size-label', class: 'field-label', text: t('me.textSize') }), h('div', { class: 'seg' }, ...sizeButtons), h('p', { class: 'hint', text: t('me.textSizeHint') })),
    h('label', { class: 'check', for: 'me-contrast' }, contrast, h('span', {}, h('strong', { text: t('me.contrast') }), h('span', { class: 'hint', text: ` ${t('me.contrastHelp')}` }))),
  );
}

/** "Me": who is signed in, display settings, and the screens that are not worth a tab of their own. */
export async function renderMe(session) {
  const { user, org } = session;
  const link = (hash, iconName, label) => h('a', { class: 'btn btn-block menu-link', href: `#${hash}` }, icon(iconName), h('span', { text: label }));
  return h(
    'div',
    { class: 'stack' },
    h('h1', { text: t('me.title') }),
    h(
      'section',
      { class: 'card stack-sm' },
      h('h2', { text: user.name }),
      h('p', { class: 'muted', text: [user.jobRole ? t(`role.${user.jobRole}`) : null, user.site, org.name].filter(Boolean).join(' · ') }),
    ),
    displaySettings(),
    h('section', { class: 'stack-sm', 'aria-labelledby': 'more-title' }, h('h2', { id: 'more-title', text: t('me.more') }), link('passport', 'badge', t('tab.passport')), link('feedback', 'smile', t('tab.feedback')), link('records', 'calendar', t('me.records'))),
  );
}
