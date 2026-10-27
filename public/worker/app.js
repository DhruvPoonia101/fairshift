import { errorMessage, h, iconButton } from '../shared/dom.js';
import { icon } from '../shared/icons.js';
import { t } from '../shared/i18n.js';
import { bootApp, startRouter } from '../shared/shell.js';
import { renderFeedback } from './feedback.js';
import { renderHome } from './home.js';
import { renderPassport } from './passport.js';
import { renderPay } from './pay.js';
import { renderReport } from './report.js';

const TABS = [
  { id: 'home', icon: 'home', render: renderHome },
  { id: 'pay', icon: 'wallet', render: renderPay },
  { id: 'report', icon: 'alert', render: renderReport },
  { id: 'feedback', icon: 'smile', render: renderFeedback },
  { id: 'passport', icon: 'badge', render: renderPassport },
];
const VIEWS = Object.fromEntries(TABS.map((tab) => [tab.id, tab.render]));

const session = await bootApp('worker');

if (session) {
  const main = document.getElementById('main');
  const tabList = document.querySelector('#tabbar ul');
  let renderToken = 0;

  const paintTabs = (active) => {
    tabList.replaceChildren(
      ...TABS.map((tab) =>
        h(
          'li',
          {},
          h('a', { href: `#${tab.id}`, 'aria-current': tab.id === active ? 'page' : null }, icon(tab.icon), h('span', { text: t(`tab.${tab.id}`) })),
        ),
      ),
    );
  };

  const show = async (name) => {
    renderToken += 1;
    const token = renderToken;
    paintTabs(name);
    main.replaceChildren(h('p', { class: 'muted', role: 'status', text: t('common.loading') }));
    let node;
    try {
      node = await VIEWS[name](session, () => show(name));
    } catch (error) {
      // Show what went wrong and let the user retry in place, with no full reload.
      node = h(
        'div',
        { class: 'stack' },
        h('div', { class: 'banner', role: 'alert' }, icon('alert'), h('p', { text: errorMessage(error) })),
        iconButton('trend', t('common.retry'), { class: 'btn btn-primary', onclick: () => show(name) }),
      );
    }
    if (token !== renderToken) return; // the user already moved on
    main.replaceChildren(node);
    main.querySelector('h1')?.setAttribute('tabindex', '-1');
    main.querySelector('h1')?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  };

  startRouter(VIEWS, 'home', show);
}
