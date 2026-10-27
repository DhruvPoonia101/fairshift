import { api } from './shared/api.js';
import './shared/pwa.js';
import { busy, field, h, iconButton, showError } from './shared/dom.js';
import { icon } from './shared/icons.js';
import { applyTranslations, initI18n, mountLanguageSwitcher, t } from './shared/i18n.js';

const FEATURES = [
  ['wallet', 'pay'],
  ['alert', 'safe'],
  ['eyeOff', 'voice'],
  ['moon', 'rest'],
  ['badge', 'skills'],
  ['globe', 'lang'],
];
const INDUSTRIES = [
  ['building', 'construction'],
  ['users', 'college'],
];
const DEMO_ROLES = {
  worker: ['worker-construction', 'worker-college'],
  admin: ['admin-construction', 'admin-college'],
};
const ADMIN_ORGS = { construction: 'org-construction', college: 'org-college' };
const DESTINATION = { worker: '/worker/', admin: '/admin/' };

await initI18n();
mountLanguageSwitcher(document.getElementById('lang'));

const config = await api('/config').catch(() => ({ demoMode: false, adminLogin: false }));
const panels = { worker: document.getElementById('panel-worker'), admin: document.getElementById('panel-admin') };
const buttons = { worker: document.getElementById('pick-worker'), admin: document.getElementById('pick-admin') };

async function demoLogin(role, button) {
  await busy(button, async () => {
    try {
      await api(`/demo-login/${role}`, { method: 'POST' });
      location.assign(DESTINATION[role.split('-')[0]]);
    } catch (error) {
      showError(error);
    }
  });
}

function demoButtons(kind) {
  return h(
    'div',
    { class: 'stack-sm' },
    ...DEMO_ROLES[kind].map((role) => {
      const sector = role.split('-')[1];
      const button = iconButton(kind === 'worker' ? 'user' : 'building', t(`landing.demo.${role}`), { class: 'btn btn-block' });
      button.addEventListener('click', () => demoLogin(role, button));
      return h('div', { class: 'stack-sm' }, button, h('p', { class: 'hint demo-note', text: t(`landing.demoHint.${sector}`) }));
    }),
  );
}

function adminPasswordForm() {
  const org = h('select', { id: 'admin-org' }, ...Object.entries(ADMIN_ORGS).map(([sector, id]) => h('option', { value: id, text: t(`sector.${sector}`) })));
  const password = h('input', { id: 'admin-pass', type: 'password', autocomplete: 'current-password', required: true, maxlength: 200 });
  const submit = iconButton('lock', t('landing.signIn'), { class: 'btn btn-primary', type: 'submit' });
  const form = h('form', { class: 'stack-sm' }, field(t('landing.org'), org), field(t('landing.password'), password), submit);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    busy(submit, async () => {
      try {
        await api('/login/admin', { method: 'POST', body: { org: org.value, password: password.value } });
        location.assign(DESTINATION.admin);
      } catch (error) {
        showError(error);
      }
    });
  });
  return form;
}

function paintPanels() {
  panels.worker.replaceChildren(
    h('h2', { text: t('landing.workerTitle') }),
    config.demoMode ? demoButtons('worker') : h('p', { class: 'muted', text: t('landing.workerOtp') }),
  );
  panels.admin.replaceChildren(
    h('h2', { text: t('landing.employerTitle') }),
    config.demoMode ? demoButtons('admin') : null,
    config.adminLogin ? adminPasswordForm() : null,
    !config.demoMode && !config.adminLogin ? h('p', { class: 'muted', text: t('landing.adminOff') }) : null,
  );
}

function toggle(kind) {
  for (const [name, button] of Object.entries(buttons)) {
    const open = name === kind && panels[name].hidden;
    panels[name].hidden = !open;
    button.setAttribute('aria-expanded', String(open));
  }
  if (!panels[kind].hidden) panels[kind].querySelector('button, input, select')?.focus();
}

function paintContent() {
  paintPanels();
  document.getElementById('features').replaceChildren(
    ...FEATURES.map(([iconName, key]) =>
      h('li', { class: 'card feature' }, icon(iconName), h('h3', { text: t(`landing.feature.${key}.title`) }), h('p', { class: 'muted', text: t(`landing.feature.${key}.text`) })),
    ),
  );
  document.getElementById('industries').replaceChildren(
    ...INDUSTRIES.map(([iconName, sector]) =>
      h(
        'article',
        { class: 'card industry' },
        h('h3', { class: 'row' }, icon(iconName), t(`sector.${sector}`)),
        h('p', { class: 'muted', text: t(`landing.industry.${sector}.who`) }),
        h('ul', {}, ...[1, 2, 3].map((n) => h('li', { text: t(`landing.industry.${sector}.${n}`) }))),
      ),
    ),
  );
  const need = new URLSearchParams(location.search).get('need');
  const note = document.getElementById('need');
  note.hidden = !(need in buttons);
  if (!note.hidden) note.textContent = t('landing.needLogin');
  applyTranslations();
}

for (const [kind, button] of Object.entries(buttons)) button.addEventListener('click', () => toggle(kind));
document.addEventListener('langchange', paintContent);
paintContent();
const need = new URLSearchParams(location.search).get('need');
if (need in buttons) toggle(need);
