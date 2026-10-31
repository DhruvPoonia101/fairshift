import { h, toast } from '../shared/dom.js';
import { icon } from '../shared/icons.js';
import { mountLanguageSwitcher, t } from '../shared/i18n.js';
import { TEXT_SIZES, THEMES, deviceStorage, readPrefs, setPref } from '../shared/prefs.js';

/** One row of buttons where exactly one is pressed (aria-pressed), applied and remembered at once. */
function choice({ id, label, hint, values, current, text, onChoose }) {
  const buttons = values.map((value) =>
    h(
      'button',
      { type: 'button', class: 'btn', 'data-value': value, 'aria-pressed': String(current === value), onclick: () => choose(value) },
      h('span', { text: text(value) }),
    ),
  );
  function choose(value) {
    onChoose(value);
    for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.value === value));
    toast(t('me.saved'));
  }
  return h(
    'div',
    { class: 'stack-sm', role: 'group', 'aria-labelledby': `${id}-label` },
    h('p', { id: `${id}-label`, class: 'field-label', text: label }),
    h('div', { class: 'seg' }, ...buttons),
    hint ? h('p', { class: 'hint', text: hint }) : null,
  );
}

/** Theme, text size and contrast: applied at once, remembered on this device. */
function appearance() {
  const storage = deviceStorage();
  const root = document.documentElement;
  const prefs = readPrefs(storage);
  const set = (key) => (value) => setPref(storage, root, key, value);

  const contrast = h('input', { type: 'checkbox', id: 'settings-contrast', checked: prefs.contrast === 'high' });
  contrast.checked = prefs.contrast === 'high';
  contrast.addEventListener('change', () => {
    set('contrast')(contrast.checked ? 'high' : 'normal');
    toast(t('me.saved'));
  });

  return h(
    'section',
    { class: 'card stack', 'aria-labelledby': 'appearance-title' },
    h('h2', { id: 'appearance-title', class: 'row' }, icon('sun'), t('me.display')),
    choice({ id: 'theme', label: t('theme.label'), hint: t('theme.hint'), values: THEMES, current: prefs.theme, text: (v) => t(`theme.${v}`), onChoose: set('theme') }),
    choice({ id: 'size', label: t('me.textSize'), hint: t('me.textSizeHint'), values: TEXT_SIZES, current: prefs.textSize, text: (v) => t(`me.size.${v}`), onChoose: set('textSize') }),
    h('label', { class: 'check', for: 'settings-contrast' }, contrast, h('span', {}, h('strong', { text: t('me.contrast') }), h('span', { class: 'hint', text: ` ${t('me.contrastHelp')}` }))),
  );
}

/** Settings: who is signed in, language, how the app looks, and sign out. */
export async function renderSettings(session) {
  const { user, org } = session;
  const language = h('div', { class: 'lang lang-full' });
  mountLanguageSwitcher(language, 'lang-select-settings');
  return h(
    'div',
    { class: 'stack' },
    h('h1', { text: t('settings.title') }),
    h(
      'section',
      { class: 'card stack-sm', 'aria-labelledby': 'account-title' },
      h('h2', { id: 'account-title', text: user.name }),
      h('p', { class: 'muted', text: [user.jobRole ? t(`role.${user.jobRole}`) : null, user.site, org.name].filter(Boolean).join(' · ') }),
    ),
    h('section', { class: 'card stack', 'aria-labelledby': 'language-title' }, h('h2', { id: 'language-title', class: 'row' }, icon('globe'), t('common.language')), language),
    appearance(),
    h('button', { type: 'button', class: 'btn btn-block', onclick: () => document.getElementById('logout').click() }, icon('logout'), h('span', { text: t('common.logout') })),
  );
}
