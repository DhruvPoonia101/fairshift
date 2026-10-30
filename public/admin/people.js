import { api } from '../shared/api.js';
import { chip, h } from '../shared/dom.js';
import { hoursMinutes } from '../shared/format.js';
import { icon } from '../shared/icons.js';
import { t } from '../shared/i18n.js';

const LEVEL = { red: ['danger', 'alert'], amber: ['warn', 'clock'] };
const BAND = { high: ['danger', 'alert'], medium: ['warn', 'info'] };

function fatigueItem(person) {
  const [kind, iconName] = LEVEL[person.level];
  const reasons = person.flags.map((f) =>
    h('li', { text: t(`fatigue.rule.${f.rule}`, { ...f.params, time: hoursMinutes(f.params.minutes ?? 0) }) }),
  );
  return h(
    'li',
    { class: 'card person' },
    h('div', { class: 'row row-between' }, h('h3', { text: person.name }), chip(kind, iconName, t(`fatigue.level.${person.level}`))),
    h('p', { class: 'muted', text: `${t(`role.${person.role}`)} · ${person.site}` }),
    h('ul', {}, ...reasons),
  );
}

function attritionItem(person) {
  const [kind, iconName] = BAND[person.band];
  const reasons = person.reasons.map((r) =>
    h('li', {}, h('span', { class: 'pts', text: `+${r.points}` }), h('span', { text: t(`reason.${r.key}`, r.params) })),
  );
  return h(
    'li',
    { class: 'card person' },
    h('div', { class: 'row row-between' }, h('h3', { text: person.name }), chip(kind, iconName, t('people.checkin'))),
    h('p', { class: 'muted', text: `${t(`role.${person.role}`)} · ${person.site} · ${t('people.score', { score: person.score })}` }),
    h('ul', { class: 'reasons' }, ...reasons),
  );
}

/** Fatigue alerts and the explainable "who needs a supportive check-in" list. */
export async function renderPeople() {
  const d = await api('/admin/dashboard');
  const empty = (key) => h('p', { class: 'muted', text: t(key) });
  return h(
    'div',
    { class: 'stack' },
    h('h1', { text: t('people.title') }),
    h(
      'section',
      { class: 'stack', 'aria-labelledby': 'fatigue-title' },
      h('h2', { id: 'fatigue-title', class: 'row' }, icon('moon'), t('people.fatigueTitle')),
      h('p', { class: 'muted', text: t('people.fatigueIntro') }),
      d.fatigue.length > 0 ? h('ul', { class: 'grid' }, ...d.fatigue.map(fatigueItem)) : empty('people.fatigueNone'),
    ),
    h(
      'section',
      { class: 'stack', 'aria-labelledby': 'risk-title' },
      h('h2', { id: 'risk-title', class: 'row' }, icon('trend'), t('people.riskTitle')),
      h('div', { class: 'banner ok' }, icon('shield'), h('p', { text: t('people.riskIntro') })),
      d.attrition.length > 0 ? h('ul', { class: 'grid' }, ...d.attrition.map(attritionItem)) : empty('people.riskNone'),
    ),
  );
}
