import { api } from '../shared/api.js';
import { complianceChip } from '../shared/badges.js';
import { field, h } from '../shared/dom.js';
import { istMonths, money, monthLabel } from '../shared/format.js';
import { icon } from '../shared/icons.js';
import { t } from '../shared/i18n.js';

let selected = 'previous';

const reasonText = (reason) => t(`compliance.reason.${reason.key}`, reason.params);

function row(item) {
  return h(
    'tr',
    {},
    h('th', { scope: 'row', text: item.name }),
    h('td', {}, complianceChip(item.status)),
    h('td', { text: money(item.expectedPaise) }),
    h('td', { text: item.paidPaise === null ? '–' : money(item.paidPaise) }),
    h('td', { class: 'shortfall', text: item.shortfallPaise > 0 ? money(item.shortfallPaise) : '–' }),
    h('td', { class: 'cell-wide' }, h('ul', { class: 'stack-sm' }, ...item.reasons.map((r) => h('li', { text: reasonText(r) })))),
  );
}

/** Pay compliance: payslips where what was paid does not match the pay rules, with the shortfall. */
export async function renderCompliance(session, rerender) {
  const { current, previous } = istMonths();
  const month = selected === 'current' ? current : previous;
  const report = await api(`/admin/compliance?month=${month}`);

  const picker = h(
    'select',
    { id: 'comp-month' },
    h('option', { value: 'previous', selected: selected === 'previous', text: monthLabel(previous) }),
    h('option', { value: 'current', selected: selected === 'current', text: monthLabel(current) }),
  );
  picker.addEventListener('change', () => {
    selected = picker.value;
    rerender();
  });

  const heads = ['worker', 'status', 'expected', 'paid', 'short', 'why'].map((k) => h('th', { scope: 'col', text: t(`complianceAdmin.col.${k}`) }));
  return h(
    'div',
    { class: 'stack' },
    h('h1', { text: t('complianceAdmin.title') }),
    h('p', { class: 'muted', text: t('complianceAdmin.intro') }),
    h('div', { class: 'banner', role: 'note' }, icon('scale'), h('p', { text: t('compliance.note') })),
    field(t('complianceAdmin.month'), picker),
    h('p', { role: 'status', text: t('complianceAdmin.summary', report.summary) }),
    report.items.length === 0
      ? h('p', { class: 'muted', text: t('complianceAdmin.none') })
      : h('div', { class: 'card table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ...heads)), h('tbody', {}, ...report.items.map(row)))),
  );
}
