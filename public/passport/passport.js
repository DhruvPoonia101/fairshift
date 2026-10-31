import { api } from '../shared/api.js';
import '../shared/pwa.js';
import { expiryChip, verifiedChip } from '../shared/badges.js';
import { h, iconButton } from '../shared/dom.js';
import { dayLabel } from '../shared/format.js';
import { icon } from '../shared/icons.js';
import { initI18n, mountLanguageSwitcher, setSector, t } from '../shared/i18n.js';
import { emptyState, errorState, skeleton } from '../shared/states.js';

const TOKEN = location.pathname.split('/').filter(Boolean).at(-1);

function entry(e) {
  return h(
    'li',
    { class: 'card card-tight stack-sm' },
    h('h3', { text: e.title }),
    h('p', { class: 'muted', text: `${t(`passport.type.${e.type}`)} · ${e.issuer} · ${dayLabel(e.issuedOn, false)}` }),
    e.expiresOn ? h('p', { text: t('passport.expires', { date: dayLabel(e.expiresOn, false) }) }) : null,
    h('div', { class: 'row' }, verifiedChip(e.verified), e.expiry !== 'none' ? expiryChip(e.expiry) : null),
  );
}

async function paint(main) {
  main.replaceChildren(skeleton('list'));
  try {
    const pass = await api(`/public/passport/${TOKEN}`);
    setSector(pass.sector);
    main.replaceChildren(
      h(
        'div',
        { class: 'sheet' },
        h('div', { class: 'print-brand' }, h('img', { src: '/logo.svg', alt: '', width: 32, height: 32 }), h('span', { text: 'FairShift' })),
        h('h1', { text: pass.name }),
        h('p', { class: 'row muted' }, icon('building'), `${t(`role.${pass.role}`)} · ${pass.employer}`),
        h('p', { class: 'hint', text: t('passportPage.asOf', { date: dayLabel(pass.generatedOn, false) }) }),
        pass.entries.length === 0
          ? emptyState({ iconName: 'badge', title: t('empty.passport.title') })
          : h('ul', { class: 'stack' }, ...pass.entries.map(entry)),
        iconButton('print', t('common.print'), { class: 'btn no-print', onclick: () => window.print() }),
        h('p', { class: 'hint', text: t('passportPage.privacy') }),
      ),
    );
  } catch (error) {
    main.replaceChildren(
      error.status === 404
        ? emptyState({ iconName: 'alert', title: t('passportPage.notFound') })
        : errorState(error, () => paint(main)),
    );
  }
}

await initI18n();
mountLanguageSwitcher(document.getElementById('lang'));
const main = document.getElementById('main');
document.addEventListener('langchange', () => paint(main));
await paint(main);
