import { api } from '../shared/api.js';
import { busy, cancelButton, field, h, iconButton, openDialog, showError, toast } from '../shared/dom.js';
import { istMonths, monthLabel } from '../shared/format.js';
import { icon } from '../shared/icons.js';
import { t } from '../shared/i18n.js';
import { renderPayslip } from '../shared/payslip.js';
import { stopSpeaking } from '../shared/voice.js';

let selectedMonth = null;

/** "Something looks wrong" opens a grievance already filled in with the month. */
function openDispute(month) {
  const text = h('textarea', { id: 'dispute-text', maxlength: 1000 });
  text.value = t('payslip.disputePrefill', { month: monthLabel(month) });
  openDialog({
    title: t('payslip.dispute'),
    body: [h('p', { class: 'muted', text: t('payslip.disputeHelp') }), field(t('report.describe'), text)],
    actions: (close) => [
      cancelButton(close),
      iconButton('check', t('common.send'), {
        class: 'btn btn-primary',
        onclick: async (event) => {
          await busy(event.currentTarget, async () => {
            try {
              await api('/grievances', { method: 'POST', body: { category: 'pay', text: text.value, source: 'payslip', month } });
              close();
              toast(t('payslip.disputeSent'));
            } catch (error) {
              showError(error);
            }
          });
        },
      }),
    ],
  });
}

/** Pay tab: this month or last month, every line explained, readable aloud. */
export async function renderPay(session) {
  const { current, previous } = istMonths();
  selectedMonth ??= current;
  const box = h('div', { 'aria-live': 'polite' });
  const toggles = h('div', { class: 'row', role: 'group', 'aria-label': t('pay.month') });

  async function load() {
    stopSpeaking();
    for (const button of toggles.children) button.setAttribute('aria-pressed', String(button.dataset.month === selectedMonth));
    box.replaceChildren(h('p', { class: 'muted', text: t('common.loading') }));
    try {
      const slip = await api(`/workers/${session.user.id}/payslips/${selectedMonth}`);
      box.replaceChildren(renderPayslip(slip, { onDispute: () => openDispute(selectedMonth) }));
    } catch (error) {
      showError(error);
      box.replaceChildren(h('p', { class: 'muted', text: t('err.generic') }));
    }
  }

  for (const month of [current, previous]) {
    toggles.append(
      h('button', { type: 'button', class: 'btn', 'data-month': month, 'aria-pressed': 'false', onclick: () => { selectedMonth = month; load(); } }, icon('calendar'), monthLabel(month)),
    );
  }
  await load();
  return h('div', { class: 'stack' }, h('h1', { text: t('pay.title') }), h('p', { class: 'muted', text: t('pay.intro') }), toggles, box);
}
