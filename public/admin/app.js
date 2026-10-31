import { h } from '../shared/dom.js';
import { icon } from '../shared/icons.js';
import { t } from '../shared/i18n.js';
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
const VIEWS = Object.fromEntries(SECTIONS.map((s) => [s.id, s.load]));
// Placeholder shapes that roughly match each section, so the page does not jump when it arrives.
const SKELETONS = { overview: 'cards', grievances: 'table', skills: 'table', compliance: 'table', disputes: 'table' };

const session = await bootApp('admin');

if (session) {
  const main = document.getElementById('main');
  const nav = document.getElementById('nav');
  let renderToken = 0;

  const show = async (name) => {
    renderToken += 1;
    const token = renderToken;
    nav.replaceChildren(
      ...SECTIONS.map((s) =>
        h('li', {}, h('a', { href: `#${s.id}`, 'aria-current': s.id === name ? 'page' : null }, icon(s.icon), h('span', { text: t(`nav.${s.id}`) }))),
      ),
    );
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
