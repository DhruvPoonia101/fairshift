import { h, chip, iconButton } from './dom.js';
import { dayLabel, hoursMinutes, money, timeIst } from './format.js';
import { icon } from './icons.js';
import { t } from './i18n.js';
import { canSpeak, speak, stopSpeaking } from './voice.js';

const LINE_ICONS = {
  regular: 'calendar',
  overtime: 'clock',
  pf: 'piggy',
  esi: 'shield',
  esi_not_applicable: 'shield',
  advance: 'hand',
};

/** Plain-words explanation of one payslip line; the numbers come from the server's calculation. */
function explain(line) {
  const base = t(`payslip.explain.${line.key}`, { ...line.params, amountPaise: line.amountPaise });
  const carry = line.key === 'advance' && line.params.carriedPaise > 0 ? t('payslip.explain.advanceCarry', line.params) : '';
  return `${base} ${carry}`.trim();
}

function lineItem(line) {
  const sign = line.kind === 'earning' ? '+' : '−';
  const text = explain(line);
  return h(
    'li',
    { class: 'card payline' },
    h(
      'div',
      { class: 'row row-between' },
      h('h3', { class: 'row' }, icon(LINE_ICONS[line.key]), t(`payslip.line.${line.key}`)),
      h('strong', { class: 'big-sm', text: `${sign} ${money(line.amountPaise)}` }),
    ),
    h('p', { text }),
    canSpeak
      ? iconButton('speaker', t('payslip.readLine'), { onclick: () => speak(`${t(`payslip.line.${line.key}`)}. ${text}`) })
      : null,
  );
}

const COMPLIANCE_KIND = { ok: ['ok', 'check'], underpaid: ['danger', 'alert'], review: ['info', 'clock'] };

const bigChip = (kind, iconName, text) => Object.assign(chip(kind, iconName, text), { className: `chip chip-${kind} chip-lg` });
const reasonText = (reason) => t(`compliance.reason.${reason.key}`, reason.params);
const complianceSpeech = (c) => [t(`compliance.${c.status}`), ...c.reasons.map(reasonText)].join('. ');

/** "Paid correctly" or "Underpaid, here is why": a big icon + text badge, the reasons, and read-aloud. */
function complianceCard(c) {
  const [kind, iconName] = COMPLIANCE_KIND[c.status];
  const amounts =
    c.status === 'underpaid'
      ? h(
          'dl',
          { class: 'amounts' },
          h('dt', { text: t('compliance.expected') }),
          h('dd', { text: money(c.expectedPaise) }),
          h('dt', { text: t('compliance.paid') }),
          h('dd', { text: money(c.paidPaise) }),
          h('dt', { text: t('compliance.short') }),
          h('dd', { class: 'short', text: money(c.shortfallPaise) }),
        )
      : null;
  return h(
    'section',
    { class: `card stack-sm compliance ${c.status}`, 'aria-labelledby': 'comp-title' },
    h('h2', { id: 'comp-title', class: 'row' }, icon('scale'), t('compliance.title')),
    h('p', { role: 'status' }, bigChip(kind, iconName, t(`compliance.${c.status}`))),
    c.reasons.length > 0 ? h('ul', { class: 'stack-sm' }, ...c.reasons.map((r) => h('li', { text: reasonText(r) }))) : null,
    amounts,
    h('p', { class: 'hint', text: t('compliance.note') }),
    canSpeak ? iconButton('speaker', t('compliance.readAloud'), { onclick: () => speak(complianceSpeech(c)) }) : null,
  );
}

function dayTable(days) {
  const head = ['date', 'in', 'out', 'hours', 'overtime'].map((k) => h('th', { scope: 'col', text: t(`payslip.col.${k}`) }));
  const rows = days.map((d) =>
    h(
      'tr',
      {},
      h('th', { scope: 'row', text: dayLabel(d.date) }),
      h('td', { text: timeIst(d.checkIn) }),
      h('td', { text: timeIst(d.checkOut) }),
      h('td', { text: hoursMinutes(d.totalMinutes) }),
      h('td', { text: d.overtimeMinutes > 0 ? hoursMinutes(d.overtimeMinutes) : '–' }),
    ),
  );
  return h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ...head)), h('tbody', {}, ...rows)));
}

/**
 * Renders a payslip so every line is explained in plain words, can be read aloud, and links to a dispute.
 * @param {object} slip response of GET /api/workers/:id/payslips/:month
 * @param {{ onDispute?: () => void }} [options]
 */
export function renderPayslip(slip, { onDispute } = {}) {
  const earnings = slip.lines.filter((l) => l.kind === 'earning');
  const deductions = slip.lines.filter((l) => l.kind === 'deduction');
  const summary = t('payslip.summary', { netPaise: slip.netPaise, grossPaise: slip.grossPaise, deductionsPaise: slip.deductionsPaise });
  const readAll = () =>
    speak([summary, complianceSpeech(slip.compliance), ...slip.lines.map((l) => `${t(`payslip.line.${l.key}`)}. ${explain(l)}`)].join(' '));

  return h(
    'div',
    { class: 'stack' },
    h(
      'section',
      { class: 'card stack-sm', 'aria-labelledby': 'net-title' },
      h('h2', { id: 'net-title', class: 'row' }, icon('wallet'), t('payslip.netTitle')),
      h('p', { class: 'big', text: money(slip.netPaise) }),
      h('p', { class: 'muted', text: t('payslip.totals', { grossPaise: slip.grossPaise, deductionsPaise: slip.deductionsPaise }) }),
      slip.pendingShift ? chip('info', 'clock', t('payslip.pending')) : null,
      h(
        'div',
        { class: 'row' },
        canSpeak ? iconButton('speaker', t('payslip.readAll'), { class: 'btn btn-primary', onclick: readAll }) : null,
        canSpeak ? iconButton('x', t('payslip.stopReading'), { onclick: stopSpeaking }) : null,
      ),
    ),
    complianceCard(slip.compliance),
    h('h2', { class: 'row' }, icon('plus'), t('payslip.earnings')),
    h('ul', { class: 'stack' }, ...earnings.map(lineItem)),
    h('h2', { class: 'row' }, icon('dash'), t('payslip.deductions')),
    h('ul', { class: 'stack' }, ...deductions.map(lineItem)),
    h(
      'details',
      { class: 'card' },
      h('summary', { class: 'row', text: t('payslip.daysTitle', { count: slip.days.length }) }),
      slip.days.length > 0 ? dayTable(slip.days) : h('p', { class: 'muted', text: t('payslip.noDays') }),
    ),
    onDispute ? iconButton('alert', t('payslip.dispute'), { class: 'btn btn-danger btn-lg btn-block', onclick: onDispute }) : null,
  );
}
