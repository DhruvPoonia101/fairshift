import { errorMessage, h, iconButton } from '../shared/dom.js';
import { icon } from '../shared/icons.js';
import { t } from '../shared/i18n.js';
import { bootApp, startRouter } from '../shared/shell.js';
import { renderAttendance } from './attendance.js';
import { renderFeedback } from './feedback.js';
import { renderGrievances } from './grievances.js';
import { renderOverview } from './overview.js';
import { renderPayroll } from './payroll.js';
import { renderPeople } from './people.js';
import { renderSkills } from './skills.js';

const SECTIONS = [
  { id: 'overview', icon: 'chart', render: renderOverview },
  { id: 'attendance', icon: 'qr', render: renderAttendance },
  { id: 'grievances', icon: 'alert', render: renderGrievances },
  { id: 'people', icon: 'users', render: renderPeople },
  { id: 'feedback', icon: 'smile', render: renderFeedback },
  { id: 'skills', icon: 'badge', render: renderSkills },
  { id: 'payroll', icon: 'wallet', render: renderPayroll },
];
const VIEWS = Object.fromEntries(SECTIONS.map((s) => [s.id, s.render]));

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
    if (token !== renderToken) return;
    main.replaceChildren(node);
    const heading = main.querySelector('h1');
    heading?.setAttribute('tabindex', '-1');
    heading?.focus({ preventScroll: true });
  };

  startRouter(VIEWS, 'overview', show);
}
