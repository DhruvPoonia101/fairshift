import { api } from '../shared/api.js';
import { h, iconButton } from '../shared/dom.js';
import { dayLabel } from '../shared/format.js';
import { icon } from '../shared/icons.js';
import { t } from '../shared/i18n.js';

function siteCard(site) {
  return h(
    'section',
    { class: 'card qr-card stack-sm', 'aria-labelledby': `site-${site.id}` },
    h('h2', { id: `site-${site.id}`, class: 'row' }, icon('pin'), site.name),
    // The QR is an image from our own origin; the cookie authorises it, so no token is in the URL.
    h('img', { src: `/api/admin/sites/${site.id}/qr.svg`, width: 256, height: 256, alt: t('attendance.qrAlt', { site: site.name }) }),
    h('p', { class: 'muted', text: t('attendance.codeLabel') }),
    h('p', { class: 'code-big', 'aria-label': site.code.split('').join(' '), text: site.code }),
    h('p', { class: 'hint', text: t('attendance.validFor', { date: dayLabel(site.validDay) }) }),
  );
}

/** Attendance: today's rotating QR and typed code for each site, ready to print or show on a screen. */
export async function renderAttendance() {
  const { sites } = await api('/admin/sites');
  return h(
    'div',
    { class: 'stack' },
    h('h1', { text: t('attendance.title') }),
    h('p', { class: 'muted', text: t('attendance.intro', { site: t('term.site') }) }),
    h('div', { class: 'row no-print' }, iconButton('print', t('common.print'), { onclick: () => window.print() })),
    h('div', { class: 'grid' }, ...sites.map(siteCard)),
  );
}
