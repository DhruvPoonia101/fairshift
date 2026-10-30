import { errorMessage, h, iconButton } from '../shared/dom.js';
import { icon } from '../shared/icons.js';
import { t } from '../shared/i18n.js';
import { bootApp, startRouter } from '../shared/shell.js';

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
    if (token !== renderToken) return;
    main.replaceChildren(node);
    const heading = main.querySelector('h1');
    heading?.setAttribute('tabindex', '-1');
    heading?.focus({ preventScroll: true });
  };

  startRouter(VIEWS, 'overview', show);
}
