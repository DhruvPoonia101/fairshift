import { api } from '../shared/api.js';
import { complianceChip } from '../shared/badges.js';
import { field, h } from '../shared/dom.js';
import { money, monthLabel, recentMonths } from '../shared/format.js';
import { icon } from '../shared/icons.js';
import { t } from '../shared/i18n.js';
import { renderPayslip } from '../shared/payslip.js';
import { emptyState, errorState, skeleton } from '../shared/states.js';

const MONTHS_SHOWN = 3;
let selectedWorker = null;
let selectedMonth = null;

/** "3 workers have a possible shortfall this month: Rs 2,118.12 in total." (or none). */
function summaryLine({ underpaid, shortfallPaise }) {
  if (underpaid === 0) return t('payroll.summary.none');
  return t(`payroll.summary.${underpaid === 1 ? 'one' : 'other'}`, { count: underpaid, totalPaise: shortfallPaise });
}

function rosterTable(rows) {
  const heads = ['worker', 'days', 'gross', 'net', 'paid', 'short', 'status'].map((k) => h('th', { scope: 'col', text: t(`payroll.col.${k}`) }));
  const row = (r) =>
    h(
      'tr',
      {},
      h('th', { scope: 'row', text: r.name }),
      h('td', { text: String(r.daysWorked) }),
      h('td', { text: money(r.grossPaise) }),
      h('td', { text: money(r.netPaise) }),
      h('td', { text: r.paidPaise === null ? '–' : money(r.paidPaise) }),
      h('td', { class: 'shortfall', text: r.shortfallPaise > 0 ? money(r.shortfallPaise) : '–' }),
      h('td', {}, complianceChip(r.status)),
    );
  return h('div', { class: 'card table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ...heads)), h('tbody', {}, ...rows.map(row))));
}

/** Payroll: the month's pay for everyone (with a CSV export), then the plain-words payslip of one worker for settling disputes on facts. */
export async function renderPayroll(session, rerender) {
  const { workers } = await api('/admin/workers');
  if (workers.length === 0) {
    return h('div', { class: 'stack' }, h('h1', { text: t('payroll.title') }), emptyState({ iconName: 'users', title: t('empty.workers.title'), text: t('empty.workers.text') }));
  }
  const months = recentMonths(MONTHS_SHOWN);
  selectedMonth = months.includes(selectedMonth) ? selectedMonth : months[0];
  selectedWorker ??= workers[0]?.id;

  const roster = await api(`/admin/payroll?month=${selectedMonth}`);

  const tabs = h(
    'div',
    { class: 'seg', role: 'group', 'aria-label': t('payroll.months') },
    ...months.map((m) =>
      h('button', {
        type: 'button',
        class: 'btn',
        'aria-pressed': String(m === selectedMonth),
        text: monthLabel(m),
        onclick: () => {
          selectedMonth = m;
          rerender();
        },
      }),
    ),
  );
  // A plain link: the browser sends the employer's sign-in cookie and saves the file, no script involved.
  const exportButton = h(
    'a',
    { class: 'btn btn-primary', href: `/api/admin/payroll/export?month=${selectedMonth}`, download: '', title: t('payroll.exportHelp') },
    icon('download'),
    h('span', { text: t('payroll.export') }),
  );

  const box = h('div', { 'aria-live': 'polite' });
  const worker = h('select', { id: 'pr-worker' }, ...workers.map((w) => h('option', { value: w.id, selected: w.id === selectedWorker, text: `${w.name} (${t(`role.${w.role}`)})` })));
  async function load() {
    selectedWorker = worker.value;
    box.replaceChildren(skeleton('list'));
    try {
      box.replaceChildren(renderPayslip(await api(`/workers/${selectedWorker}/payslips/${selectedMonth}`)));
    } catch (error) {
      box.replaceChildren(errorState(error, load));
    }
  }
  worker.addEventListener('change', load);
  await load();

  return h(
    'div',
    { class: 'stack' },
    h('div', { class: 'row row-between' }, h('h1', { text: t('payroll.title') }), exportButton),
    h('p', { class: 'muted', text: t('payroll.intro') }),
    tabs,
    h('p', { class: 'summary-line', role: 'status', text: summaryLine(roster.summary) }),
    rosterTable(roster.rows),
    h('h2', { text: t('payroll.slipTitle') }),
    h('div', { class: 'row' }, field(t('skills.worker'), worker)),
    box,
  );
}
