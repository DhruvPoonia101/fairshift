import { h } from '../shared/dom.js';
import { icon } from '../shared/icons.js';
import { t } from '../shared/i18n.js';
import { bootApp, startRouter } from '../shared/shell.js';
import { errorState, skeleton } from '../shared/states.js';
import { TABS, tabForScreen } from './nav.js';

// Each screen is imported when it is first opened, so a low-end phone only downloads what it shows.
const screen = (file, name) => () => import(file).then((module) => module[name]);

const VIEWS = {
  home: screen('./home.js', 'renderHome'),
  records: screen('./records.js', 'renderRecords'),
  pay: screen('./pay.js', 'renderPay'),
  report: screen('./report.js', 'renderReport'),
  me: screen('./me.js', 'renderMe'),
  passport: screen('./passport.js', 'renderPassport'),
  feedback: screen('./feedback.js', 'renderFeedback'),
};

const session = await bootApp('worker');

if (session) {
  // The outbox opens first, so every screen can hand it work and the banner is there from the start.
  const [{ startOutbox }, { mountOutboxBanner }] = await Promise.all([import('../shared/outbox.js'), import('../shared/outbox-ui.js')]);
  await startOutbox(session);
  mountOutboxBanner();

  const main = document.getElementById('main');
  const tabList = document.querySelector('#tabbar ul');
  let renderToken = 0;

  const paintTabs = (activeTab) => {
    tabList.replaceChildren(
      ...TABS.map((tab) =>
        h(
          'li',
          {},
          h('a', { href: `#${tab.id}`, 'aria-current': tab.id === activeTab ? 'page' : null }, icon(tab.icon), h('span', { text: t(tab.labelKey) })),
        ),
      ),
    );
  };

  const show = async (name) => {
    renderToken += 1;
    const token = renderToken;
    paintTabs(tabForScreen(name));
    main.replaceChildren(skeleton('list'));
    let node;
    try {
      const render = await VIEWS[name]();
      node = await render(session, () => show(name));
    } catch (error) {
      node = errorState(error, () => show(name)); // what went wrong, and a button to retry in place
    }
    if (token !== renderToken) return; // the user already moved on
    main.replaceChildren(node);
    main.querySelector('h1')?.setAttribute('tabindex', '-1');
    main.querySelector('h1')?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  };

  startRouter(VIEWS, 'home', show);
}
