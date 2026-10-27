import { api } from '../shared/api.js';
import { chip, h } from '../shared/dom.js';
import { number } from '../shared/format.js';
import { icon } from '../shared/icons.js';
import { t } from '../shared/i18n.js';

const SUBJECT_ICONS = { manager: 'user', policies: 'building', conditions: 'shield' };

function distribution(bucket) {
  return h(
    'ul',
    { class: 'stack-sm' },
    ...bucket.distribution.map((count, index) =>
      h(
        'li',
        { class: 'row' },
        h('span', { text: t('feedback.stars', { n: index + 1 }) }),
        h('progress', { value: count, max: bucket.count, 'aria-label': t('feedback.starsCount', { n: index + 1, count }) }),
        h('span', { text: String(count) }),
      ),
    ),
  );
}

function bucketCard(bucket) {
  const title = h('h2', { class: 'row' }, icon(SUBJECT_ICONS[bucket.subject]), t(`feedback.subject.${bucket.subject}`, { manager: t('term.manager') }));
  if (bucket.suppressed) {
    return h('section', { class: 'card stack-sm' }, title, h('div', { class: 'banner' }, icon('lock'), h('p', { text: t('feedbackAdmin.notEnough') })));
  }
  return h(
    'section',
    { class: 'card stack-sm' },
    title,
    h('p', { class: 'big', text: t('feedbackAdmin.average', { avg: number(bucket.average) }) }),
    h('p', { class: 'muted', text: t('feedbackAdmin.count', { count: bucket.count }) }),
    distribution(bucket),
    bucket.comments.length > 0 ? h('ul', { class: 'stack-sm' }, ...bucket.comments.map((c) => h('li', { text: `“${c}”` }))) : null,
  );
}

/** Anonymous feedback, only for groups of 3 or more answers (k-anonymity). */
export async function renderFeedback() {
  const { buckets, themes } = await api('/admin/feedback');
  return h(
    'div',
    { class: 'stack' },
    h('h1', { text: t('feedbackAdmin.title') }),
    h('div', { class: 'banner ok' }, icon('lock'), h('p', { text: t('feedbackAdmin.privacy') })),
    h('div', { class: 'grid' }, ...buckets.map(bucketCard)),
    h(
      'section',
      { class: 'card stack-sm', 'aria-labelledby': 'themes-title' },
      h('h2', { id: 'themes-title', class: 'row' }, icon('info'), t('feedbackAdmin.themes')),
      h('p', { class: 'muted', text: t(`feedbackAdmin.source.${themes.source}`) }),
      themes.summary ? h('p', { text: themes.summary }) : null,
      themes.themes.length > 0
        ? h('ul', { class: 'row' }, ...themes.themes.map((x) => h('li', {}, chip('info', 'info', `${t(`theme.${x.theme}`)}: ${x.count}`))))
        : h('p', { class: 'muted', text: t('feedbackAdmin.noThemes') }),
    ),
  );
}
