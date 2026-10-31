import { paintSidenav, paintTabbar } from '../shared/chrome.js';
import { labelCells } from '../shared/dom.js';
import { bootApp, startRouter } from '../shared/shell.js';
import { errorState, skeleton } from '../shared/states.js';

// Each section is imported when it is first opened, so the page only downloads what it shows.
const section = (file, name) => () => import(file).then((module) => module[name]);

const SECTIONS = [
  { id: 'overview', icon: 'chart', load: section('./overview.js', 'renderOverview') },
  { id: 'attendance', icon: 'qr', load: section('./attendance.js', 'renderAttendance') },
  { id: 'grievances', icon: 'alert', load: section('./grievances.js', 'renderGrievances') },
  { id: 'people', icon: 'users', load: section('./people.js', 'renderPeople') },
  { id: 'feedback', icon: 'smile', load: section('./feedback.js', 'renderFeedback') },
  { id: 'skills', icon: 'badge', load: section('./skills.js', 'renderSkills') },
  { id: 'payroll', icon: 'wallet', load: section('./payroll.js', 'renderPayroll') },
  { id: 'compliance', icon: 'scale', load: section('./compliance.js', 'renderCompliance') },
  { id: 'disputes', icon: 'calendar', load: section('./disputes.js', 'renderDisputes') },
];
// The same list is the sidebar (900px and up) and a scrollable bottom bar (phones).
const NAV = SECTIONS.map(({ id, icon }) => ({ id, icon, labelKey: `nav.${id}` }));
const VIEWS = Object.fromEntries(SECTIONS.map((s) => [s.id, s.load]));
// Placeholder shapes that roughly match each section, so the page does not jump when it arrives.
const SKELETONS = { overview: 'cards', grievances: 'table', skills: 'table', compliance: 'table', disputes: 'table' };

const session = await bootApp('admin');

if (session) {
  const main = document.getElementById('main');
  let renderToken = 0;
  // Tables become stacked "label: value" cards on phones: label the cells whenever a screen draws or redraws one.
  new MutationObserver(() => labelCells(main)).observe(main, { childList: true, subtree: true });

  const show = async (name) => {
    renderToken += 1;
    const token = renderToken;
    paintSidenav(document.querySelector('#sidenav ul'), [NAV], name);
    paintTabbar(document.querySelector('#tabbar ul'), NAV, name);
    document.querySelector('#tabbar [aria-current="page"]')?.scrollIntoView({ inline: 'center', block: 'nearest' });
    main.replaceChildren(skeleton(SKELETONS[name]));
    let node;
    try {
      const render = await VIEWS[name]();
      node = await render(session, () => show(name));
    } catch (error) {
      node = errorState(error, () => show(name)); // what went wrong, and a button to retry in place
    }
    if (token !== renderToken) return;
    main.replaceChildren(node);
    const heading = main.querySelector('h1');
    heading?.setAttribute('tabindex', '-1');
    heading?.focus({ preventScroll: true });
  };

  startRouter(VIEWS, 'overview', show);
}
