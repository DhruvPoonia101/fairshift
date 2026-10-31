import { api } from './shared/api.js';
import './shared/pwa.js';
import { busy, field, fill, h, iconButton, showError } from './shared/dom.js';
import { startFx } from './shared/fx.js';
import { icon } from './shared/icons.js';
import { errorState } from './shared/states.js';
import { applyTranslations, initI18n, mountLanguageSwitcher, t } from './shared/i18n.js';

const DESTINATION = { worker: '/worker/', admin: '/admin/' };
// Each sector card gets its own accent: saffron, indigo, teal (any other sector a new sector adds falls back to emerald).
const SECTOR_TONE = { construction: 'pay', college: 'skills', hospital: 'speak' };

await initI18n();
mountLanguageSwitcher(document.getElementById('lang'));

// The sectors come from the server's sector config, so a new sector appears here with no code change.
let configError = null;
const config = await api('/config').catch((error) => {
  configError = error;
  return { demoMode: false, adminLogin: false, sectors: [] };
});
const params = new URLSearchParams(location.search);
let kind = params.get('need') === 'admin' ? 'admin' : 'worker';

// The same demo-login and password-login calls as always: nothing about signing in changed, only where it sits.
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

function adminPasswordForm() {
  const org = h('select', { id: 'admin-org' }, ...config.sectors.map(({ id, orgId }) => h('option', { value: orgId, text: t(`sector.${id}`) })));
  const password = h('input', { id: 'admin-pass', type: 'password', autocomplete: 'current-password', required: true, maxlength: 200 });
  const submit = iconButton('lock', t('landing.signIn'), { class: 'btn btn-primary magnetic', type: 'submit' });
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

function paintTabs() {
  const tab = (name, labelKey) => {
    const button = h('button', { type: 'button', class: 'btn', 'aria-pressed': String(kind === name), text: t(labelKey) });
    button.addEventListener('click', () => {
      kind = name;
      paintSignin();
    });
    return button;
  };
  fill(document.getElementById('signin-tabs'), tab('worker', 'landing.tabWorker'), tab('admin', 'landing.tabEmployer'));
}

/** The login part for the chosen tab: the employer password form when it is on, otherwise a short pointer to the demo. */
function paintPanel() {
  const panel = document.getElementById('signin-panel');
  if (configError) {
    fill(panel, errorState(configError, () => location.reload()));
    return;
  }
  if (kind === 'worker') {
    fill(panel, h('p', { class: 'muted', text: t(config.demoMode ? 'landing.useDemo' : 'landing.workerOtp') }));
    return;
  }
  fill(
    panel,
    config.adminLogin ? adminPasswordForm() : null,
    !config.adminLogin && config.demoMode ? h('p', { class: 'muted', text: t('landing.useDemo') }) : null,
    !config.adminLogin && !config.demoMode ? h('p', { class: 'muted', text: t('landing.adminOff') }) : null,
  );
}

/** One row per sector with a one-tap worker and a one-tap employer account (demo mode only). The chosen tab's button is the primary one. */
function paintDemo() {
  const demo = document.getElementById('demo');
  if (configError || !config.demoMode) {
    fill(demo);
    return;
  }
  const button = (role, sector, iconName, labelKey, primary) => {
    const go = iconButton(iconName, t(labelKey), { class: primary ? 'btn btn-primary magnetic' : 'btn', 'aria-label': t(role.startsWith('worker') ? 'landing.demoWorker' : 'landing.demoAdmin', { sector: t(`sector.${sector}`) }) });
    go.addEventListener('click', () => demoLogin(role, go));
    return go;
  };
  fill(
    demo,
    h('h3', { text: t('landing.tryDemo') }),
    h('p', { class: 'hint', text: t('landing.tryDemoHelp') }),
    h(
      'ul',
      { class: 'demo-list' },
      ...config.sectors.map(({ id, icon: sectorIcon }) =>
        h(
          'li',
          { class: 'demo-row' },
          h('span', { class: 'tile-icon', 'data-tone': SECTOR_TONE[id] ?? 'checkin' }, icon(sectorIcon)),
          h('strong', { text: t(`sector.${id}`) }),
          h('p', { class: 'muted', text: t(`landing.demoHint.${id}`) }),
          h('div', { class: 'demo-go' }, button(`worker-${id}`, id, 'user', 'landing.tabWorker', kind === 'worker'), button(`admin-${id}`, id, sectorIcon, 'landing.tabEmployer', kind === 'admin')),
        ),
      ),
    ),
  );
}

function paintSignin() {
  paintTabs();
  paintPanel();
  paintDemo();
}

/** The judge tour needs the demo accounts, so its button only appears in demo mode. */
function paintTourButton() {
  // Nothing at all when it is not demo mode, and also when /api/config could not be loaded (config is then the empty default).
  fill(
    document.getElementById('tour-slot'),
    config.demoMode
      ? iconButton('compass', t('tour.button'), { class: 'btn', onclick: () => import('./shared/tour-ui.js').then((tourUi) => tourUi.openTourIntro()) })
      : null,
  );
}

function paintIndustries() {
  document.getElementById('industries').replaceChildren(
    ...(configError ? [errorState(configError, () => location.reload())] : []),
    ...config.sectors.map(({ id, icon: sectorIcon }) =>
      h(
        'article',
        { class: 'card industry', 'data-tone': SECTOR_TONE[id] ?? 'checkin', 'data-tilt': '', 'data-shine': '' },
        h('span', { class: 'tile-icon tile-icon-lg bob' }, icon(sectorIcon)),
        h('h3', { text: t(`sector.${id}`) }),
        h('p', { class: 'muted', text: t(`landing.industry.${id}.who`) }),
        h('ul', {}, ...[1, 2, 3].map((n) => h('li', { text: t(`landing.industry.${id}.${n}`) }))),
      ),
    ),
  );
}

function paintContent() {
  paintSignin();
  paintTourButton();
  paintIndustries();
  const note = document.getElementById('need');
  note.hidden = !params.has('need');
  if (!note.hidden) note.textContent = t('landing.needLogin');
  applyTranslations();
}

document.addEventListener('langchange', paintContent);
paintContent();
startFx(document);
