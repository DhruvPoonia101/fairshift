import { ApiError, api } from '../shared/api.js';
import { severityChip, statusChip } from '../shared/badges.js';
import { busy, field, h, iconButton, openDialog, showError, toast } from '../shared/dom.js';
import { dateTimeIst } from '../shared/format.js';
import { icon } from '../shared/icons.js';
import { t } from '../shared/i18n.js';
import { outbox } from '../shared/outbox.js';
import { outboxPanel, staleNotice } from '../shared/outbox-ui.js';
import { photoPicker } from './photo-picker.js';
import { formatTrackingCode } from '../shared/tracking-code.js';
import { emptyState } from '../shared/states.js';
import { dictationButton } from '../shared/voice.js';

function categoryPicker(categories) {
  const radios = categories.map((c, index) =>
    h(
      'label',
      { class: 'cat' },
      h('input', { type: 'radio', name: 'category', value: c.id, required: index === 0 }),
      h('span', { class: 'cat-face' }, icon(c.icon), h('span', { text: t(`cat.${c.id}`) })),
    ),
  );
  return h('fieldset', { class: 'stack-sm' }, h('legend', { text: t('report.pick') }), h('div', { class: 'cats' }, ...radios));
}

function showTrackingCode(code, waiting) {
  openDialog({
    title: t(waiting ? 'outbox.reportSavedAnon' : 'report.sentAnon'),
    body: [
      waiting ? h('p', { text: t('outbox.savedToast') }) : null,
      h('p', { text: t('report.codeHelp') }),
      h('p', { class: 'track-code', text: code }),
      h('p', { class: 'muted', text: t('report.codeKeep') }),
    ],
    actions: (close) => [
      navigator.clipboard
        ? iconButton('copy', t('common.copy'), { onclick: () => navigator.clipboard.writeText(code).then(() => toast(t('common.copied'))) })
        : null,
      iconButton('check', t('common.done'), { class: 'btn btn-primary', onclick: close }),
    ],
  });
}

function trackForm() {
  const input = h('input', { id: 'track-code', autocomplete: 'off', autocapitalize: 'characters', maxlength: 20 });
  const result = h('div', { 'aria-live': 'polite' });
  const button = iconButton('qr', t('report.check'), { class: 'btn' });
  button.addEventListener('click', () =>
    busy(button, async () => {
      try {
        const found = await api('/grievances/track', { method: 'POST', body: { code: input.value } });
        result.replaceChildren(
          h(
            'div',
            { class: 'stack-sm' },
            h('div', { class: 'row' }, statusChip(found.status), h('span', { class: 'muted', text: t(`cat.${found.category}`) })),
            found.resolutionNote ? h('p', { text: `${t('report.note')}: ${found.resolutionNote}` }) : null,
          ),
        );
      } catch (error) {
        result.replaceChildren(h('p', { role: 'alert', text: t(error.status === 404 ? 'report.notFound' : 'err.generic') }));
      }
    }),
  );
  return h(
    'section',
    { class: 'card stack-sm', 'aria-labelledby': 'track-title' },
    h('h2', { id: 'track-title', class: 'row' }, icon('eyeOff'), t('report.trackTitle')),
    field(t('report.codeLabel'), input),
    button,
    result,
  );
}

function myReports(items) {
  if (items.length === 0) return emptyState({ iconName: 'alert', title: t('empty.reports.title'), text: t('empty.reports.text') });
  return h(
    'ul',
    { class: 'stack item-list' },
    ...items.map((g) =>
      h(
        'li',
        { class: 'card card-tight' },
        h('div', { class: 'row' }, statusChip(g.status), severityChip(g.severity), h('span', { class: 'muted', text: dateTimeIst(g.createdAt) })),
        h('p', { text: g.text }),
        g.resolutionNote ? h('p', { class: 'banner ok' }, icon('check'), h('span', { text: `${t('report.note')}: ${g.resolutionNote}` })) : null,
      ),
    ),
  );
}

/** Report tab: pick an icon, say it by text or voice, optionally stay anonymous. */
export async function renderReport(session, rerender) {
  let copy;
  try {
    copy = await outbox.cachedApi('/grievances');
  } catch (error) {
    if (error instanceof ApiError) throw error;
    copy = { data: { items: [] }, stale: true, savedAt: null, none: true }; // no signal and nothing saved: the form still works
  }
  const { items } = copy.data;
  const text = h('textarea', { id: 'report-text', maxlength: 1000, required: true });
  const anon = h('input', { type: 'checkbox', id: 'report-anon' });
  const mic = dictationButton(text);
  const picker = photoPicker();
  const submit =iconButton('check', t('report.send'), { class: 'btn btn-primary btn-lg btn-block', type: 'submit' });

  const form = h(
    'form',
    { class: 'card stack' },
    categoryPicker(session.sector.categories),
    field(t('report.describe'), text, mic ? t('report.hintVoice') : t('report.hintType')),
    mic,
    picker.el,
    h('label', { class: 'check', for: 'report-anon' }, anon, h('span', {}, h('strong', { text: t('report.anon') }), h('span', { class: 'hint', text: ` ${t('report.anonHelp')}` }))),
    submit,
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    busy(submit, async () => {
      const category = new FormData(form).get('category');
      if (!category) {
        toast(t('report.pick'), 'alert');
        return;
      }
      try {
        // An anonymous report gets its tracking code on this phone, at once, so it can be shown even with no signal.
        const sent = await outbox.submit('report', { category, text: text.value, anonymous: anon.checked, photo: picker.value() });
        const waiting = sent.status === 'queued';
        if (sent.item.trackingCode) showTrackingCode(formatTrackingCode(sent.item.trackingCode), waiting);
        else toast(t(waiting ? 'outbox.savedToast' : 'report.sent'), waiting ? 'clock' : 'check');
        form.reset();
        picker.clear();
        rerender();
      } catch (error) {
        showError(error);
      }
    });
  });

  return h(
    'div',
    { class: 'stack' },
    h('h1', { text: t('report.title') }),
    h('p', { class: 'muted', text: t('report.intro') }),
    copy.stale && !copy.none ? staleNotice(copy.savedAt) : null,
    outboxPanel(),
    form,
    trackForm(),
    h('h2', { class: 'row' }, icon('alert'), t('report.mine')),
    myReports(items),
  );
}
