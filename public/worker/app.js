import { errorMessage, h, iconButton } from '../shared/dom.js';
import { icon } from '../shared/icons.js';
import { t } from '../shared/i18n.js';
import { bootApp, startRouter } from '../shared/shell.js';

// Each screen is imported when it is first opened, so a low-end phone only downloads what it shows.
const screen = (file, name) => () => import(file).then((module) => module[name]);

const TABS = [
  { id: 'home', icon: 'home', load: screen('./home.js', 'renderHome') },
  { id: 'pay', icon: 'wallet', load: screen('./pay.js', 'renderPay') },
  { id: 'report', icon: 'alert', load: screen('./report.js', 'renderReport') },
  { id: 'feedback', icon: 'smile', load: screen('./feedback.js', 'renderFeedback') },
  { id: 'passport', icon: 'badge', load: screen('./passport.js', 'renderPassport') },
];
// 'records' is reached from the Home tab, so it has no tab of its own.
const VIEWS = { ...Object.fromEntries(TABS.map((tab) => [tab.id, tab.load])), records: screen('./records.js', 'renderRecords') };

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
    paintTabs(name === 'records' ? 'home' : name);
    main.replaceChildren(h('p', { class: 'muted', role: 'status', text: t('common.loading') }));
    let node;
    try {
      const render = await VIEWS[name]();
      node = await render(session, () => show(name));
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
