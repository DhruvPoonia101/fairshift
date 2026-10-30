import { api } from '../shared/api.js';
import { disputeChip } from '../shared/badges.js';
import { busy, cancelButton, field, h, iconButton, openDialog, showError, toast } from '../shared/dom.js';
import { dateIst, dateTimeIst, hoursMinutes, monthLabel, timeIst } from '../shared/format.js';
import { icon } from '../shared/icons.js';
import { t } from '../shared/i18n.js';

const recordText = (r) => (r ? `${timeIst(r.checkIn)} – ${r.checkOut ? timeIst(r.checkOut) : '…'}` : '–');

/** What the approval changed: the day's hours, rest warnings and pay. Shown so the employer sees the effect. */
function showRecalculation(r) {
  openDialog({
    title: t('disputesAdmin.approved'),
    body: [
      h('p', { text: t('disputesAdmin.recalc.day', { time: hoursMinutes(r.totalMinutes), overtime: hoursMinutes(r.overtimeMinutes) }) }),
      h('p', { text: r.fatigue.rules.length === 0 ? t('disputesAdmin.recalc.fatigueNone') : t('disputesAdmin.recalc.fatigue', { count: r.fatigue.rules.length }) }),
      h('p', { text: t('disputesAdmin.recalc.pay', { month: monthLabel(r.payslip.month), beforePaise: r.payslip.netBeforePaise, afterPaise: r.payslip.netAfterPaise }) }),
    ],
    actions: (close) => [iconButton('check', t('common.done'), { class: 'btn btn-primary', onclick: close })],
  });
}

function openDecisionDialog(dispute, decision, onDone) {
  const approve = decision === 'approve';
  const note = h('textarea', { id: 'dd-note', maxlength: 500 });
  openDialog({
    title: t(approve ? 'disputesAdmin.approveTitle' : 'disputesAdmin.rejectTitle'),
    body: [
      h('p', { class: 'muted', text: `${recordText(dispute.original)} → ${recordText(dispute.claimed)}` }),
      field(t('disputesAdmin.decisionNote'), note, t(approve ? 'disputesAdmin.noteOptional' : 'disputesAdmin.noteRequired')),
    ],
    actions: (close) => [
      cancelButton(close),
      iconButton(approve ? 'check' : 'x', t(approve ? 'disputesAdmin.approve' : 'disputesAdmin.reject'), {
        class: approve ? 'btn btn-primary' : 'btn btn-danger',
        onclick: async (event) => {
          await busy(event.currentTarget, async () => {
            try {
              const result = await api(`/admin/disputes/${dispute.id}/decision`, { method: 'POST', body: { decision, note: note.value } });
              close();
              if (result.recalculation) showRecalculation(result.recalculation);
              else toast(t('disputesAdmin.rejected'));
              onDone();
            } catch (error) {
              showError(error);
            }
          });
        },
      }),
    ],
  });
}

function actions(dispute, onDone) {
  if (!['submitted', 'under_review'].includes(dispute.status)) return null;
  const startReview = iconButton('clock', t('disputesAdmin.startReview'), {
    onclick: async (event) => {
      await busy(event.currentTarget, async () => {
        try {
          await api(`/admin/disputes/${dispute.id}/review`, { method: 'POST' });
          toast(t('disputesAdmin.reviewStarted'));
          onDone();
        } catch (error) {
          showError(error);
        }
      });
    },
  });
  return h(
    'div',
    { class: 'row' },
    dispute.status === 'submitted' ? startReview : null,
    iconButton('check', t('disputesAdmin.approve'), { onclick: () => openDecisionDialog(dispute, 'approve', onDone) }),
    iconButton('x', t('disputesAdmin.reject'), { class: 'btn btn-danger', onclick: () => openDecisionDialog(dispute, 'reject', onDone) }),
  );
}

function history(dispute) {
  return h(
    'details',
    {},
    h('summary', { text: t('disputesAdmin.history') }),
    h(
      'ol',
      { class: 'timeline' },
      ...dispute.timeline.map((e) =>
        h(
          'li',
          {},
          icon(e.actorRole === 'worker' ? 'user' : e.actorRole === 'admin' ? 'building' : 'gear'),
          h('div', {}, h('strong', { text: t(`dispute.timeline.${e.action}`, { before: recordText(e.before), after: recordText(e.after) }) }), h('p', { class: 'hint', text: `${t(`dispute.by.${e.actorRole}`)} · ${dateTimeIst(e.at)}` })),
        ),
      ),
    ),
  );
}

function row(dispute, onDone) {
  const siteChange = dispute.sites.claimed && dispute.sites.claimed !== dispute.sites.original ? ` · ${dispute.sites.original} → ${dispute.sites.claimed}` : '';
  return h(
    'tr',
    {},
    h('th', { scope: 'row', text: dispute.worker?.name ?? '' }),
    h('td', { text: dateIst(dispute.original.checkIn) }),
    h('td', { text: t(`dispute.cat.${dispute.category}`) }),
    h('td', { text: recordText(dispute.original) }),
    h('td', { text: dispute.claimed ? `${recordText(dispute.claimed)}${siteChange}` : '–' }),
    h('td', { class: 'cell-wide' }, h('p', { text: dispute.note }), dispute.decisionNote ? h('p', { class: 'muted', text: `${t('dispute.decisionNote')}: ${dispute.decisionNote}` }) : null, history(dispute)),
    h('td', {}, disputeChip(dispute.status)),
    h('td', {}, actions(dispute, onDone)),
  );
}

/** Attendance dispute queue: open ones first. Approving corrects the record and recalculates; every change is audited. */
export async function renderDisputes(session, rerender) {
  const { items } = await api('/admin/disputes');
  const heads = ['worker', 'day', 'reason', 'recorded', 'claimed', 'note', 'status', 'action'].map((k) => h('th', { scope: 'col', text: t(`disputesAdmin.col.${k}`) }));
  return h(
    'div',
    { class: 'stack' },
    h('h1', { text: t('disputesAdmin.title') }),
    h('div', { class: 'banner ok' }, icon('shield'), h('p', { text: t('disputesAdmin.intro') })),
    items.length === 0
      ? h('p', { class: 'muted', text: t('disputesAdmin.none') })
      : h('div', { class: 'card table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ...heads)), h('tbody', {}, ...items.map((d) => row(d, rerender))))),
  );
}
