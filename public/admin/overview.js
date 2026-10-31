import { api } from '../shared/api.js';
import { busy, cancelButton, chip, h, iconButton, openDialog, showError, toast } from '../shared/dom.js';
import { dayLabel, hoursMinutes, number } from '../shared/format.js';
import { icon, toneOf } from '../shared/icons.js';
import { t } from '../shared/i18n.js';

const NS = 'http://www.w3.org/2000/svg';
const CHART = { width: 560, height: 200, top: 22, bottom: 28, gap: 6 };
const GAUGE = { cx: 60, cy: 62, radius: 50 };
const BAND_CHIP = { healthy: ['ok', 'check'], needs_attention: ['warn', 'alert'], at_risk: ['danger', 'flame'], unknown: ['info', 'info'] };

function svgEl(name, attrs = {}, text) {
  const el = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  if (text !== undefined) el.textContent = text;
  return el;
}

/** A point on the gauge arc for a value 0-100 (0 at the left end, 100 at the right end). */
function gaugePoint(value, radius) {
  const angle = Math.PI * (1 - value / 100);
  return [GAUGE.cx + radius * Math.cos(angle), GAUGE.cy - radius * Math.sin(angle)];
}

/** Half-circle gauge. The band is also written in words, and the 60 and 80 marks are drawn, so colour is never the only cue. */
function gauge(result) {
  const { cx, cy, radius } = GAUGE;
  const arc = `M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`;
  const length = Math.PI * radius;
  const svg = svgEl('svg', {
    class: 'gauge',
    viewBox: '0 0 120 78',
    role: 'img',
    'aria-label': result.score === null ? t('dws.noScore') : t('dws.gaugeLabel', { score: result.score, band: t(`dws.band.${result.band}`) }),
  });
  svg.append(svgEl('path', { class: 'gauge-track', d: arc }));
  if (result.score !== null) {
    svg.append(svgEl('path', { class: `gauge-fill band-${result.band}`, d: arc, 'stroke-dasharray': `${(length * result.score) / 100} ${length}` }));
  }
  for (const mark of [result.bands.needsAttentionMin, result.bands.healthyMin]) {
    const [x1, y1] = gaugePoint(mark, radius - 8);
    const [x2, y2] = gaugePoint(mark, radius + 8);
    svg.append(svgEl('line', { class: 'gauge-tick', x1, y1, x2, y2 }));
  }
  svg.append(svgEl('text', { class: 'gauge-score', 'data-count': '', x: cx, y: cy - 6 },result.score === null ? '–' : String(result.score)));
  svg.append(svgEl('text', { class: 'gauge-of', x: cx, y: cy + 8 }, '/ 100'));
  return svg;
}

function componentRow(c) {
  const name = t(`dws.component.${c.id}`);
  const unavailable = t(c.detail.key === 'not_enough_responses' ? 'dws.notEnoughResponses' : 'dws.missing');
  return h(
    'li',
    { class: 'stack-sm' },
    h('div', { class: 'row row-between' }, h('strong', { text: name }), h('span', { class: 'muted', text: t('dws.weight', { weight: c.weight }) })),
    c.available
      ? h('div', { class: 'row score-row' }, h('progress', { value: c.score, max: 100, 'aria-label': `${name}: ${t('dws.componentScore', { score: c.score })}` }), h('span', { class: 'score-num', text: t('dws.componentScore', { score: c.score }) }))
      : h('p', { class: 'muted row' }, icon('lock'), unavailable),
  );
}

function driverItem(d) {
  return h(
    'li',
    { class: 'stack-sm' },
    h('div', { class: 'row row-between' }, h('strong', { text: t(`dws.component.${d.id}`) }), h('span', { class: 'chip chip-warn', text: t('dws.pointsLost', { points: number(d.pointsLost) }) })),
    h('p', { text: t(`dws.driver.${d.id}`, d.detail.params) }),
  );
}

function scoreTrend(trend) {
  const known = trend.filter((p) => p.score !== null);
  if (known.length === 0) return h('p', { class: 'muted', text: t('dws.trendNone') });
  const width = CHART.width;
  const height = 140;
  const pad = 22;
  const x = (i) => pad + (i * (width - 2 * pad)) / (trend.length - 1);
  const y = (score) => height - pad - (score / 100) * (height - 2 * pad);
  const svg = svgEl('svg', {
    class: 'chart',
    viewBox: `0 0 ${width} ${height}`,
    role: 'img',
    'aria-label': t('dws.trendLabel', { from: dayLabel(trend[0].date, false), to: dayLabel(trend.at(-1).date, false), first: known[0].score, last: known.at(-1).score }),
  });
  for (const level of [0, 50, 100]) svg.append(svgEl('line', { class: 'grid-line', x1: pad, x2: width - pad, y1: y(level), y2: y(level) }));
  const points = trend.map((p, i) => (p.score === null ? null : `${x(i)},${y(p.score)}`)).filter(Boolean).join(' ');
  svg.append(svgEl('polyline', { class: 'trend-line', points }));
  trend.forEach((p, i) => {
    if (p.score === null) return;
    const dot = svgEl('circle', { class: 'trend-dot', cx: x(i), cy: y(p.score), r: 3.5 });
    dot.append(svgEl('title', {}, `${dayLabel(p.date)}: ${p.score}`));
    svg.append(dot);
  });
  svg.append(svgEl('text', { x: pad, y: height - 4 }, dayLabel(trend[0].date, false)), svgEl('text', { x: width - pad, y: height - 4 }, dayLabel(trend.at(-1).date, false)));
  return svg;
}

function scoreTable(trend) {
  return h(
    'div',
    { class: 'table-wrap' },
    h(
      'table',
      {},
      h('thead', {}, h('tr', {}, h('th', { scope: 'col', text: t('dws.table.date') }), h('th', { scope: 'col', text: t('dws.table.score') }))),
      h('tbody', {}, ...trend.map((p) => h('tr', {}, h('th', { scope: 'row', text: dayLabel(p.date) }), h('td', { text: p.score === null ? '–' : String(p.score) })))),
    ),
  );
}

function howCalculated(result) {
  const lines = ['pay', 'rest', 'grievances', 'sentiment', 'attendance'].map((id) => h('li', { text: t(`dws.how.${id}`) }));
  return h(
    'details',
    { class: 'stack-sm' },
    h('summary', { class: 'row', text: t('dws.how') }),
    h('div', { class: 'stack-sm' },
      h('p', { text: t('dws.how.intro') }),
      h('ul', { class: 'stack-sm bullets' }, ...lines),
      h('p', { text: t('dws.how.missing') }),
      h('p', { text: t('dws.how.bands', { healthy: result.bands.healthyMin, attention: result.bands.needsAttentionMin, healthyBelow: result.bands.healthyMin - 1 }) }),
    ),
  );
}

/** The prominent score card: gauge, band in words, component bars, top drivers, trend, and how it is calculated. */
function scoreCard(result) {
  const [kind, iconName] = BAND_CHIP[result.band];
  const bandChip = chip(kind, iconName, t(`dws.band.${result.band}`));
  bandChip.classList.add('chip-lg');
  return h(
    'section',
    { class: 'card card-hero stack score-card', 'aria-labelledby': 'dws-title' },
    h('h2', { id: 'dws-title', class: 'row' }, icon('scale'), t('dws.title')),
    h('p', { class: 'muted', text: t('dws.intro') }),
    h(
      'div',
      { class: 'score-top' },
      gauge(result),
      h('div', { class: 'stack-sm' }, h('p', { class: 'big', 'data-count': '', text: result.score === null ? t('dws.noScore') : t('dws.scoreOf', { score: result.score }) }), bandChip, h('p', { class: 'hint', text: t('dws.coverage', { coverage: Math.round(result.coverage * 100) }) })),
    ),
    h('div', { class: 'score-cols' },
      h('section', { class: 'stack-sm', 'aria-labelledby': 'dws-comp' }, h('h3', { id: 'dws-comp', text: t('dws.components') }), h('ul', { class: 'stack' }, ...result.components.map(componentRow))),
      h('section', { class: 'stack-sm', 'aria-labelledby': 'dws-drv' }, h('h3', { id: 'dws-drv', text: t('dws.drivers') }), result.drivers.length > 0 ? h('ol', { class: 'stack' }, ...result.drivers.map(driverItem)) : h('p', { class: 'muted', text: t('dws.noDrivers') })),
    ),
    h('section', { class: 'stack-sm', 'aria-labelledby': 'dws-trend' }, h('h3', { id: 'dws-trend', text: t('dws.trend') }), scoreTrend(result.trend), h('details', {}, h('summary', { text: t('overview.showTable') }), scoreTable(result.trend))),
    howCalculated(result),
  );
}

function kpi({ iconName, value, label, href }) {
  return h(href ? 'a' : 'div', { class: 'card kpi', href }, h('span', { class: 'row', 'data-tone': toneOf(iconName) }, icon(iconName, 'tinted'), h('span', { text: label })), h('span', { class: 'big', 'data-count': '', text: value }));
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
    const bar = svgEl('rect', { class: `bar${day.date === today ? ' today' : ''}`, x, y: CHART.top + plotHeight - height, width: slot - CHART.gap, height, rx: 3 });
    bar.append(svgEl('title', {}, `${dayLabel(day.date)}: ${day.present}`));
    svg.append(bar, svgEl('text', { x: x + (slot - CHART.gap) / 2, y: CHART.top + plotHeight - height - 5 }, day.present));
    svg.append(svgEl('text', { x: x + (slot - CHART.gap) / 2, y: CHART.height - 8 }, day.date.slice(8)));
  });
  return svg;
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

/** Demo mode only: wipes this organisation's demo data and creates it again with dates anchored to today. */
function resetPanel(onDone) {
  const open = () =>
    openDialog({
      title: t('demo.resetTitle'),
      body: [h('p', { text: t('demo.resetBody') })],
      actions: (close) => [
        cancelButton(close),
        iconButton('gear', t('demo.resetConfirm'), {
          class: 'btn btn-danger',
          onclick: async (event) => {
            await busy(event.currentTarget, async () => {
              try {
                await api('/admin/demo/reset', { method: 'POST', body: { confirm: true } });
                close();
                toast(t('demo.resetDone'));
                onDone();
              } catch (error) {
                showError(error);
              }
            });
          },
        }),
      ],
    });
  return h('section', { class: 'card stack-sm', 'aria-labelledby': 'demo-title' }, h('h2', { id: 'demo-title', class: 'row' }, icon('gear'), t('demo.title')), h('p', { class: 'muted', text: t('demo.note') }), iconButton('gear', t('demo.reset'), { class: 'btn btn-danger', onclick: open }));
}

/** Overview: the Decent Work Score, the numbers an employer checks first, and the 14-day attendance trend. */
export async function renderOverview(session, rerender) {
  const [d, score] = await Promise.all([api('/admin/dashboard'), api('/admin/decent-work')]);
  const k = d.kpis;
  return h(
    'div',
    { class: 'stack' },
    h('h1', { text: t('overview.title') }),
    scoreCard(score),
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
    session.demoMode ? resetPanel(rerender) : null,
  );
}
