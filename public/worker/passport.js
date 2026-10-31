import { api } from '../shared/api.js';
import { expiryChip, verifiedChip } from '../shared/badges.js';
import { busy, cancelButton, field, h, iconButton, openDialog, showError, toast } from '../shared/dom.js';
import { dayLabel } from '../shared/format.js';
import { icon } from '../shared/icons.js';
import { t } from '../shared/i18n.js';
import { emptyState } from '../shared/states.js';

const TYPES = ['training', 'certification', 'experience'];

/** One passport entry card, shared look with the employer's skills table. */
export function entryCard(entry) {
  return h(
    'li',
    { class: 'card card-tight stack-sm' },
    h('h3', { text: entry.title }),
    h('p', { class: 'muted', text: `${t(`passport.type.${entry.type}`)} · ${entry.issuer} · ${dayLabel(entry.issuedOn, false)}` }),
    entry.expiresOn ? h('p', { text: t('passport.expires', { date: dayLabel(entry.expiresOn, false) }) }) : null,
    h('div', { class: 'row' }, verifiedChip(entry.verified), entry.expiry !== 'none' ? expiryChip(entry.expiry) : null),
  );
}

function openAddDialog(onAdded) {
  const type = h('select', { id: 'pp-type' }, ...TYPES.map((v) => h('option', { value: v, text: t(`passport.type.${v}`) })));
  const title = h('input', { id: 'pp-title', maxlength: 80, required: true });
  const issuer = h('input', { id: 'pp-issuer', maxlength: 80, required: true });
  const issued = h('input', { id: 'pp-issued', type: 'date', required: true });
  const expires = h('input', { id: 'pp-expires', type: 'date' });
  openDialog({
    title: t('passport.add'),
    body: [field(t('passport.typeLabel'), type), field(t('passport.titleLabel'), title), field(t('passport.issuer'), issuer), field(t('passport.issued'), issued), field(t('passport.expiresLabel'), expires, t('passport.expiresHint'))],
    actions: (close) => [
      cancelButton(close),
      iconButton('check', t('common.save'), {
        class: 'btn btn-primary',
        onclick: async (event) => {
          await busy(event.currentTarget, async () => {
            try {
              await api('/passport', { method: 'POST', body: { type: type.value, title: title.value, issuer: issuer.value, issuedOn: issued.value, expiresOn: expires.value || undefined } });
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

function sharePanel(shareToken, rerender) {
  const link = shareToken ? `${location.origin}/p/${shareToken}` : null;
  const act = (method, message) => async (event) => {
    await busy(event.currentTarget, async () => {
      try {
        await api('/passport/share', { method });
        toast(message);
        rerender();
      } catch (error) {
        showError(error);
      }
    });
  };
  return h(
    'section',
    { class: 'card stack-sm', 'aria-labelledby': 'share-title' },
    h('h2', { id: 'share-title', class: 'row' }, icon('share'), t('passport.shareTitle')),
    h('p', { class: 'muted', text: t(link ? 'passport.shareOn' : 'passport.shareOff') }),
    link ? h('p', { class: 'link-box', text: link }) : null,
    h(
      'div',
      { class: 'row' },
      link
        ? [
            navigator.clipboard ? iconButton('copy', t('common.copy'), { onclick: () => navigator.clipboard.writeText(link).then(() => toast(t('common.copied'))) }) : null,
            h('a', { class: 'btn', href: link, target: '_blank', rel: 'noopener' }, icon('print'), t('passport.printView')),
            iconButton('x', t('passport.stopShare'), { class: 'btn btn-danger', onclick: act('DELETE', t('passport.stopped')) }),
          ]
        : iconButton('share', t('passport.startShare'), { class: 'btn btn-primary', onclick: act('POST', t('passport.shared')) }),
    ),
  );
}

/** Passport tab: skills and certificates that follow the worker, with expiry warnings. */
export async function renderPassport(session, rerender) {
  const { entries, shareToken } = await api('/passport');
  const attention = entries.filter((e) => e.expiry === 'expiring' || e.expiry === 'expired');
  return h(
    'div',
    { class: 'stack' },
    h('h1', { text: t('passport.title') }),
    h('p', { class: 'muted', text: t('passport.intro') }),
    ...attention.map((e) =>
      h('div', { class: 'banner', role: 'note' }, icon('alert'), h('p', { text: t(e.expiry === 'expired' ? 'passport.expiredWarn' : 'passport.expiringWarn', { title: e.title, date: dayLabel(e.expiresOn, false) }) })),
    ),
    entries.length === 0
      ? emptyState({ iconName: 'badge', title: t('empty.passport.title'), text: t('empty.passport.text') })
      : h('ul', { class: 'stack' }, ...entries.map(entryCard)),
    iconButton('plus', t('passport.add'), { class: 'btn btn-primary btn-lg btn-block', onclick: () => openAddDialog(rerender) }),
    sharePanel(shareToken, rerender),
  );
}
