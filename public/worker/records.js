import { recordsWithWaitingDispute } from '../shared/actions.js';
import { disputeChip } from '../shared/badges.js';
import { busy, cancelButton, chip, field, h, iconButton, openDialog, showError, toast } from '../shared/dom.js';
import { dateTimeIst, dayLabel, hoursMinutes, timeIst } from '../shared/format.js';
import { icon } from '../shared/icons.js';
import { t } from '../shared/i18n.js';
import { outbox } from '../shared/outbox.js';
import { outboxPanel, staleNotice } from '../shared/outbox-ui.js';
import { emptyState } from '../shared/states.js';

const IST = 'Asia/Kolkata';
const DAY_MS = 24 * 60 * 60_000;
const CATEGORIES = ['forgot_checkout', 'wrong_time', 'wrong_site', 'other'];
const ACTOR_ICON = { worker: 'user', admin: 'building', system: 'gear' };

const hhmm = (ms) => new Intl.DateTimeFormat('en-GB', { timeZone: IST, hour: '2-digit', minute: '2-digit', hour12: false }).format(ms);
const istMs = (day, time) => Date.parse(`${day}T${time}:00+05:30`);

/** "17:30" on the day of the record, or the next day if that would be before the check-in (night shifts). */
function timeAfter(day, time, notBeforeMs) {
  const same = istMs(day, time);
  return same > notBeforeMs ? same : same + DAY_MS;
}

const recordText = (r) => (r ? `${timeIst(r.checkIn)} – ${r.checkOut ? timeIst(r.checkOut) : '…'}` : '');

function openContestDialog(record, sites, onSent) {
  // "Forgot to check out" only fits a record with no check-out (or one the system closed); "time is wrong" fits a finished one.
  const finished = record.checkOut !== null;
  const offered = CATEGORIES.filter((c) => (c === 'forgot_checkout' ? !finished || record.autoClosed : c === 'wrong_time' ? finished : true));
  const category = h('select', { id: 'dp-category' }, ...offered.map((c) => h('option', { value: c, text: t(`dispute.cat.${c}`) })));
  const inTime = h('input', { id: 'dp-in', type: 'time', value: hhmm(record.checkIn), required: true });
  const outTime = h('input', { id: 'dp-out', type: 'time', value: record.checkOut ? hhmm(record.checkOut) : '' });
  const site = h('select', { id: 'dp-site' }, ...sites.map((s) => h('option', { value: s.id, selected: s.id === record.siteId, text: s.name })));
  const note = h('textarea', { id: 'dp-note', maxlength: 500 });
  const groups = {
    in: field(t('dispute.checkIn'), inTime),
    out: field(t('dispute.checkOut'), outTime),
    site: field(t('dispute.site'), site),
  };
  const show = () => {
    const c = category.value;
    groups.in.hidden = c !== 'wrong_time';
    groups.out.hidden = !['wrong_time', 'forgot_checkout'].includes(c);
    groups.site.hidden = c !== 'wrong_site';
  };
  category.addEventListener('change', show);
  show();

  function buildBody() {
    const body = { shiftId: record.id, category: category.value };
    if (note.value.trim()) body.note = note.value.trim();
    if (category.value === 'forgot_checkout') body.checkOutAt = timeAfter(record.date, outTime.value, record.checkIn);
    if (category.value === 'wrong_time') {
      const newIn = inTime.value !== hhmm(record.checkIn) ? istMs(record.date, inTime.value) : null;
      if (newIn !== null) body.checkInAt = newIn;
      if (outTime.value && outTime.value !== hhmm(record.checkOut ?? 0)) {
        body.checkOutAt = timeAfter(record.date, outTime.value, newIn ?? record.checkIn);
      }
    }
    if (category.value === 'wrong_site') body.siteId = site.value;
    return body;
  }

  openDialog({
    title: t('dispute.title'),
    body: [
      h('p', { class: 'muted', text: `${dayLabel(record.date)} · ${recordText(record)} · ${record.site}` }),
      field(t('dispute.category'), category),
      groups.in,
      groups.out,
      groups.site,
      field(t('dispute.note'), note),
    ],
    actions: (close) => [
      cancelButton(close),
      iconButton('check', t('dispute.send'), {
        class: 'btn btn-primary',
        onclick: async (event) => {
          await busy(event.currentTarget, async () => {
            try {
              // Sent now with a signal; without one it is kept, with the time the worker filed it.
              const { status } = await outbox.submit('dispute', buildBody());
              close();
              toast(t(status === 'sent' ? 'dispute.sent' : 'outbox.savedToast'), status === 'sent' ? 'check' : 'clock');
              onSent();
            } catch (error) {
              showError(error);
            }
          });
        },
      }),
    ],
  });
}

function recordCard(record, sites, onSent, waiting) {
  const flags = [
    record.recordedOffline ? chip('info', 'wifiOff', t('offline.badge')) : null,
    waiting.has(record.id) ? chip('info', 'clock', t('outbox.status.queued')) : null,
    record.checkOut === null ? chip('warn', 'clock', t('records.notFinished')) : null,
    record.autoClosed ? chip('warn', 'gear', t('records.autoClosed')) : null,
    record.corrected ? chip('ok', 'check', t('records.corrected')) : null,
    record.openDisputeId ? chip('info', 'alert', t('records.open')) : null,
  ];
  const minutes = record.checkOut ? Math.floor((record.checkOut - record.checkIn) / 60_000) : 0;
  return h(
    'li',
    { class: 'card card-tight stack-sm' },
    h('div', { class: 'row row-between' }, h('h3', { text: dayLabel(record.date) }), record.checkOut ? h('span', { text: hoursMinutes(minutes) }) : null),
    h('p', { class: 'muted', text: `${recordText(record)} · ${record.site}` }),
    h('div', { class: 'row' }, ...flags),
    record.openDisputeId || waiting.has(record.id) ? null : iconButton('alert', t('records.contest'), { onclick: () => openContestDialog(record, sites, onSent) }),
  );
}

/** One entry of the change history: who, what, when, and the note if there is one. */
function timelineEntry(entry) {
  const text = t(`dispute.timeline.${entry.action}`, { before: recordText(entry.before), after: recordText(entry.after) });
  return h(
    'li',
    {},
    icon(ACTOR_ICON[entry.actorRole]),
    h(
      'div',
      { class: 'stack-sm' },
      h('p', {}, h('strong', { text: text })),
      h('p', { class: 'hint', text: `${t(`dispute.by.${entry.actorRole}`)} · ${dateTimeIst(entry.at)}` }),
      entry.note ? h('p', { text: `${t('dispute.decisionNote')}: ${entry.note}` }) : null,
    ),
  );
}

function disputeCard(d) {
  return h(
    'li',
    { class: 'card stack-sm' },
    h('div', { class: 'row row-between' }, h('h3', { text: t(`dispute.cat.${d.category}`) }), disputeChip(d.status)),
    h('p', { class: 'muted', text: `${t('dispute.original')}: ${recordText(d.original)}${d.claimed ? ` · ${t('dispute.claimed')}: ${recordText(d.claimed)}` : ''}` }),
    d.note ? h('p', { text: d.note }) : null,
    h('ol', { class: 'timeline', 'aria-label': t('records.timeline') }, ...d.timeline.map(timelineEntry)),
  );
}

/** Attendance records inside the dispute window, the worker's disputes with timelines, and the audit trail. */
export async function renderRecords(session, rerender) {
  const [recordsCopy, disputesCopy] = await Promise.all([outbox.cachedApi('/attendance/records'), outbox.cachedApi('/disputes')]);
  const { records, sites, windowDays } = recordsCopy.data;
  const { items, audit } = disputesCopy.data;
  const waiting = recordsWithWaitingDispute(outbox.items());
  const savedAt = Math.min(recordsCopy.savedAt ?? Infinity, disputesCopy.savedAt ?? Infinity);
  return h(
    'div',
    { class: 'stack' },
    h('h1', { text: t('records.title') }),
    recordsCopy.stale || disputesCopy.stale ? staleNotice(savedAt) : null,
    outboxPanel(),
    h('p', { class: 'muted', text: t('records.intro', { days: windowDays }) }),
    records.length === 0
      ? emptyState({ iconName: 'calendar', title: t('empty.records.title'), text: t('empty.records.text', { days: windowDays }) })
      : h('ul', { class: 'stack' }, ...records.map((r) => recordCard(r, sites, rerender, waiting))),
    h('h2', { class: 'row' }, icon('alert'), t('records.mine')),
    items.length === 0 ? emptyState({ iconName: 'shield', title: t('empty.disputes.title'), text: t('empty.disputes.text') }) : h('ul', { class: 'stack' }, ...items.map(disputeCard)),
    h(
      'details',
      { class: 'card' },
      h('summary', { class: 'row', text: t('records.audit') }),
      h('p', { class: 'hint', text: t('records.auditIntro') }),
      audit.length === 0 ? h('p', { class: 'muted', text: t('records.noAudit') }) : h('ol', { class: 'timeline' }, ...audit.map(timelineEntry)),
    ),
  );
}
