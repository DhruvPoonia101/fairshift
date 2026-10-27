import { api } from '../shared/api.js';
import { h } from '../shared/dom.js';
import { dayLabel, hoursMinutes } from '../shared/format.js';
import { icon } from '../shared/icons.js';
import { t } from '../shared/i18n.js';

const NS = 'http://www.w3.org/2000/svg';
const CHART = { width: 560, height: 200, top: 22, bottom: 28, gap: 6 };

function svgEl(name, attrs = {}, text) {
  const el = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  if (text !== undefined) el.textContent = text;
  return el;
}

/** 14-day attendance bars as inline SVG (no chart library). */
function trendChart(trend, totalWorkers, today) {
  const max = Math.max(totalWorkers, ...trend.map((d) => d.present), 1);
  const plotHeight = CHART.height - CHART.top - CHART.bottom;
  const slot = CHART.width / trend.length;
  const svg = svgEl('svg', {
    class: 'chart',
    viewBox: `0 0 ${CHART.width} ${CHART.height}`,
    role: 'img',
    'aria-label': t('overview.chartLabel', { from: dayLabel(trend[0].date, false), to: dayLabel(trend.at(-1).date, false), total: totalWorkers }),
  });
  svg.append(svgEl('line', { class: 'grid-line', x1: 0, x2: CHART.width, y1: CHART.top + plotHeight, y2: CHART.top + plotHeight }));
  trend.forEach((day, index) => {
    const height = (day.present / max) * plotHeight;
    const x = index * slot + CHART.gap / 2;
    const bar = svgEl('rect', {
      class: `bar${day.date === today ? ' today' : ''}`,
      x,
      y: CHART.top + plotHeight - height,
      width: slot - CHART.gap,
      height,
      rx: 3,
    });
    bar.append(svgEl('title', {}, `${dayLabel(day.date)}: ${day.present}`));
    svg.append(bar, svgEl('text', { x: x + (slot - CHART.gap) / 2, y: CHART.top + plotHeight - height - 5 }, day.present));
    svg.append(svgEl('text', { x: x + (slot - CHART.gap) / 2, y: CHART.height - 8 }, day.date.slice(8)));
  });
  return svg;
}

function kpi({ iconName, value, label, href }) {
  return h(href ? 'a' : 'div', { class: 'card kpi', href }, h('span', { class: 'row' }, icon(iconName), h('span', { text: label })), h('span', { class: 'big', text: value }));
}

function trendTable(trend) {
  return h(
    'div',
    { class: 'table-wrap' },
    h(
      'table',
      {},
      h('thead', {}, h('tr', {}, h('th', { scope: 'col', text: t('payslip.col.date') }), h('th', { scope: 'col', text: t('overview.present') }))),
      h('tbody', {}, ...trend.map((d) => h('tr', {}, h('th', { scope: 'row', text: dayLabel(d.date) }), h('td', { text: String(d.present) })))),
    ),
  );
}

/** Overview: the five numbers an employer checks first, plus the 14-day trend. */
export async function renderOverview() {
  const d = await api('/admin/dashboard');
  const k = d.kpis;
  return h(
    'div',
    { class: 'stack' },
    h('h1', { text: t('overview.title') }),
    k.certificatesNeedingAttention > 0
      ? h('a', { class: 'banner', href: '#skills' }, icon('badge'), h('p', { text: t('overview.certAlert', { count: k.certificatesNeedingAttention }) }))
      : null,
    h(
      'div',
      { class: 'grid' },
      kpi({ iconName: 'users', value: `${k.presentToday} / ${k.totalWorkers}`, label: t('overview.presentToday') }),
      kpi({ iconName: 'clock', value: hoursMinutes(k.overtimeMinutesWeek), label: t('overview.overtimeWeek') }),
      kpi({ iconName: 'alert', value: String(k.openGrievances), label: t('overview.openGrievances'), href: '#grievances' }),
      kpi({ iconName: 'moon', value: String(k.fatigueFlagged), label: t('overview.fatigue'), href: '#people' }),
      kpi({ iconName: 'trend', value: String(k.atRisk), label: t('overview.atRisk'), href: '#people' }),
    ),
    h(
      'section',
      { class: 'card stack-sm', 'aria-labelledby': 'trend-title' },
      h('h2', { id: 'trend-title', class: 'row' }, icon('chart'), t('overview.trend')),
      trendChart(d.trend, k.totalWorkers, d.today),
      h('details', {}, h('summary', { text: t('overview.showTable') }), trendTable(d.trend)),
    ),
  );
}
