import { api } from '../shared/api.js';
import '../shared/pwa.js';
import { expiryChip, verifiedChip } from '../shared/badges.js';
import { h, iconButton } from '../shared/dom.js';
import { dayLabel } from '../shared/format.js';
import { icon } from '../shared/icons.js';
import { initI18n, mountLanguageSwitcher, setSector, t } from '../shared/i18n.js';

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
  try {
    const pass = await api(`/public/passport/${TOKEN}`);
    setSector(pass.sector);
    main.replaceChildren(
      h(
        'div',
        { class: 'sheet' },
        h('h1', { text: pass.name }),
        h('p', { class: 'row muted' }, icon('building'), `${t(`role.${pass.role}`)} · ${pass.employer}`),
        h('p', { class: 'hint', text: t('passportPage.asOf', { date: dayLabel(pass.generatedOn, false) }) }),
        h('ul', { class: 'stack' }, ...pass.entries.map(entry)),
        iconButton('print', t('common.print'), { class: 'btn no-print', onclick: () => window.print() }),
        h('p', { class: 'hint', text: t('passportPage.privacy') }),
      ),
    );
  } catch {
    main.replaceChildren(h('div', { class: 'banner', role: 'alert' }, icon('alert'), h('p', { text: t('passportPage.notFound') })));
  }
}

await initI18n();
mountLanguageSwitcher(document.getElementById('lang'));
const main = document.getElementById('main');
document.addEventListener('langchange', () => paint(main));
await paint(main);
