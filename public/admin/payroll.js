import { api } from '../shared/api.js';
import { showError, field, h } from '../shared/dom.js';
import { istMonths, monthLabel } from '../shared/format.js';
import { t } from '../shared/i18n.js';
import { renderPayslip } from '../shared/payslip.js';

let selectedWorker = null;
let selectedMonth = null;

/** Payroll check: the same plain-words payslip the worker sees, so disputes can be settled on facts. */
export async function renderPayroll() {
  const { workers } = await api('/admin/workers');
  const { current, previous } = istMonths();
  selectedWorker ??= workers[0]?.id;
  selectedMonth ??= current;

  const box = h('div', { 'aria-live': 'polite' });
  const worker = h('select', { id: 'pr-worker' }, ...workers.map((w) => h('option', { value: w.id, selected: w.id === selectedWorker, text: `${w.name} (${t(`role.${w.role}`)})` })));
  const month = h('select', { id: 'pr-month' }, ...[current, previous].map((m) => h('option', { value: m, selected: m === selectedMonth, text: monthLabel(m) })));

  async function load() {
    selectedWorker = worker.value;
    selectedMonth = month.value;
    try {
      box.replaceChildren(renderPayslip(await api(`/workers/${selectedWorker}/payslips/${selectedMonth}`)));
    } catch (error) {
      showError(error);
    }
  }
  worker.addEventListener('change', load);
  month.addEventListener('change', load);
  await load();

  return h(
    'div',
    { class: 'stack' },
    h('h1', { text: t('payroll.title') }),
    h('p', { class: 'muted', text: t('payroll.intro') }),
    h('div', { class: 'row' }, field(t('skills.worker'), worker), field(t('pay.month'), month)),
    box,
  );
}
