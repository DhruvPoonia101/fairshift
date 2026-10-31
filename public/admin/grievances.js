import { api } from '../shared/api.js';
import { severityChip, statusChip } from '../shared/badges.js';
import { busy, cancelButton, chip, field, h, iconButton, openDialog, showError, toast } from '../shared/dom.js';
import { dateIst, dateTimeIst } from '../shared/format.js';
import { icon } from '../shared/icons.js';
import { t } from '../shared/i18n.js';
import { emptyState } from '../shared/states.js';

const NEXT = { open: ['open', 'in_review', 'resolved'], in_review: ['in_review', 'resolved'], resolved: [] };
let filter = 'unresolved';

function openUpdateDialog(item, onSaved) {
  const status = h('select', { id: 'g-status' }, ...NEXT[item.status].map((s) => h('option', { value: s, text: t(`status.${s}`) })));
  const note = h('textarea', { id: 'g-note', maxlength: 500 });
  note.value = item.resolutionNote;
  openDialog({
    title: t('grievances.update'),
    body: [
      h('blockquote', { class: 'card card-tight', text: item.text }),
      field(t('grievances.status'), status),
      field(t('grievances.note'), note, t('grievances.noteHint')),
    ],
    actions: (close) => [
      cancelButton(close),
      iconButton('check', t('common.save'), {
        class: 'btn btn-primary',
        onclick: async (event) => {
          await busy(event.currentTarget, async () => {
            try {
              await api(`/admin/grievances/${item.id}`, { method: 'PATCH', body: { status: status.value, note: note.value } });
              close();
              toast(t('grievances.saved'));
              onSaved();
            } catch (error) {
              showError(error);
            }
          });
        },
      }),
    ],
  });
}

function row(item, onSaved) {
  return h(
    'tr',
    {},
    h('td', { text: item.anonymous ? dateIst(item.createdAt) : dateTimeIst(item.createdAt) }),
    h('td', {}, item.anonymous ? chip('info', 'eyeOff', t('grievances.anonymous')) : h('span', { text: item.worker?.name ?? '' })),
    h('td', {}, h('span', { class: 'row' }, icon(item.category === 'pay' ? 'wallet' : 'alert'), t(`cat.${item.category}`))),
    h('td', { class: 'cell-wide' }, h('p', { text: item.text }), item.recordedOffline ? chip('info', 'wifiOff', t('offline.badge')) : null, item.resolutionNote ? h('p', { class: 'muted', text: `${t('report.note')}: ${item.resolutionNote}` }) : null),
    h('td', {}, severityChip(item.severity)),
    h('td', {}, statusChip(item.status)),
    h('td', {}, item.status === 'resolved' ? null : iconButton('check', t('grievances.update'), { onclick: () => openUpdateDialog(item, onSaved) })),
  );
}

/** Grievances and safety reports. Anonymous ones never show a name; staff only see status and text. */
export async function renderGrievances(session, rerender) {
  const { items } = await api('/admin/grievances');
  const visible = items.filter((g) => (filter === 'unresolved' ? g.status !== 'resolved' : filter === 'all' || g.status === filter));
  const select = h('select', { id: 'g-filter' }, ...['unresolved', 'all', 'open', 'in_review', 'resolved'].map((v) => h('option', { value: v, selected: v === filter, text: t(v === 'unresolved' || v === 'all' ? `grievances.filter.${v}` : `status.${v}`) })));
  select.addEventListener('change', () => {
    filter = select.value;
    rerender();
  });
  const heads = ['when', 'from', 'category', 'text', 'severity', 'status', 'action'].map((k) => h('th', { scope: 'col', text: t(`grievances.col.${k}`) }));
  return h(
    'div',
    { class: 'stack' },
    h('h1', { text: t('grievances.title') }),
    h('div', { class: 'banner ok' }, icon('lock'), h('p', { text: t('grievances.privacy') })),
    field(t('grievances.show'), select),
    visible.length === 0
      ? emptyState({ iconName: 'check', title: t('empty.grievances.title'), text: t('empty.grievances.text') })
      : h('div', { class: 'card table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ...heads)), h('tbody', {}, ...visible.map((g) => row(g, rerender))))),
  );
}
