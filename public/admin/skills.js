import { api } from '../shared/api.js';
import { expiryChip, verifiedChip } from '../shared/badges.js';
import { busy, cancelButton, field, h, iconButton, openDialog, showError, toast } from '../shared/dom.js';
import { dayLabel } from '../shared/format.js';
import { icon } from '../shared/icons.js';
import { t } from '../shared/i18n.js';

const TYPES = ['training', 'certification', 'experience'];

async function openAddDialog(onAdded) {
  const { workers } = await api('/admin/workers');
  const worker = h('select', { id: 'sk-worker' }, ...workers.map((w) => h('option', { value: w.id, text: `${w.name} (${t(`role.${w.role}`)})` })));
  const type = h('select', { id: 'sk-type' }, ...TYPES.map((v) => h('option', { value: v, text: t(`passport.type.${v}`) })));
  const title = h('input', { id: 'sk-title', maxlength: 80, required: true });
  const issuer = h('input', { id: 'sk-issuer', maxlength: 80, required: true });
  const issued = h('input', { id: 'sk-issued', type: 'date', required: true });
  const expires = h('input', { id: 'sk-expires', type: 'date' });
  openDialog({
    title: t('skills.add'),
    body: [field(t('skills.worker'), worker), field(t('passport.typeLabel'), type), field(t('passport.titleLabel'), title), field(t('passport.issuer'), issuer), field(t('passport.issued'), issued), field(t('passport.expiresLabel'), expires, t('passport.expiresHint'))],
    actions: (close) => [
      cancelButton(close),
      iconButton('check', t('common.save'), {
        class: 'btn btn-primary',
        onclick: async (event) => {
          await busy(event.currentTarget, async () => {
            try {
              await api(`/admin/workers/${worker.value}/passport`, {
                method: 'POST',
                body: { type: type.value, title: title.value, issuer: issuer.value, issuedOn: issued.value, expiresOn: expires.value || undefined },
              });
              close();
              toast(t('passport.added'));
              onAdded();
            } catch (error) {
              showError(error);
            }
          });
        },
      }),
    ],
  });
}

function entryRow(entry, onVerified) {
  const verify = iconButton('shield', t('skills.verify'), {
    onclick: async (event) => {
      await busy(event.currentTarget, async () => {
        try {
          await api(`/admin/passport/${entry.id}/verify`, { method: 'POST' });
          toast(t('skills.verified'));
          onVerified();
        } catch (error) {
          showError(error);
        }
      });
    },
  });
  return h(
    'tr',
    {},
    h('th', { scope: 'row', text: entry.workerName }),
    h('td', { text: entry.title }),
    h('td', { text: `${t(`passport.type.${entry.type}`)} · ${entry.issuer}` }),
    h('td', { text: entry.expiresOn ? dayLabel(entry.expiresOn, false) : '–' }),
    h('td', {}, h('div', { class: 'row' }, verifiedChip(entry.verified), entry.expiry !== 'none' ? expiryChip(entry.expiry) : null)),
    h('td', {}, entry.verified ? null : verify),
  );
}

/** Skill passport admin: verify entries, add training, and see certificates about to expire. */
export async function renderSkills(session, rerender) {
  const { entries } = await api('/admin/passport');
  const attention = entries.filter((e) => e.expiry === 'expiring' || e.expiry === 'expired');
  const heads = ['worker', 'title', 'issuer', 'expires', 'status', 'action'].map((k) => h('th', { scope: 'col', text: t(`skills.col.${k}`) }));
  return h(
    'div',
    { class: 'stack' },
    h('h1', { text: t('skills.title') }),
    ...attention.map((e) =>
      h('div', { class: 'banner', role: 'note' }, icon('alert'), h('p', { text: t(e.expiry === 'expired' ? 'skills.expiredWarn' : 'skills.expiringWarn', { name: e.workerName, title: e.title, date: dayLabel(e.expiresOn, false) }) })),
    ),
    h('div', { class: 'row' }, iconButton('plus', t('skills.add'), { class: 'btn btn-primary', onclick: () => openAddDialog(rerender) })),
    h('div', { class: 'card table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ...heads)), h('tbody', {}, ...entries.map((e) => entryRow(e, rerender))))),
  );
}
