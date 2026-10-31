import { paintSidenav, paintTabbar, paintTopLinks } from '../shared/chrome.js';
import { bootApp, startRouter } from '../shared/shell.js';
import { errorState, skeleton } from '../shared/states.js';
import { EXTRAS, SIDEBAR_GROUPS, TABS, tabForScreen } from './nav.js';

// Each screen is imported when it is first opened, so a low-end phone only downloads what it shows.
const screen = (file, name) => () => import(file).then((module) => module[name]);

const VIEWS = {
  home: screen('./home.js', 'renderHome'),
  records: screen('./records.js', 'renderRecords'),
  pay: screen('./pay.js', 'renderPay'),
  report: screen('./report.js', 'renderReport'),
  passport: screen('./passport.js', 'renderPassport'),
  feedback: screen('./feedback.js', 'renderFeedback'),
  settings: screen('./settings.js', 'renderSettings'),
};

const session = await bootApp('worker');

if (session) {
  // The outbox opens first, so every screen can hand it work and the banner is there from the start.
  const [{ startOutbox }, { mountOutboxBanner }] = await Promise.all([import('../shared/outbox.js'), import('../shared/outbox-ui.js')]);
  await startOutbox(session);
  mountOutboxBanner();

  const main = document.getElementById('main');
  let renderToken = 0;

  // The same destinations three ways: left sidebar (900px and up), bottom bar and top-bar buttons (phones).
  const paintTabs = (current) => {
    paintSidenav(document.querySelector('#sidenav ul'), SIDEBAR_GROUPS, current);
    paintTabbar(document.querySelector('#tabbar ul'), TABS, current);
    paintTopLinks(document.getElementById('toplinks'), EXTRAS, current);
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
