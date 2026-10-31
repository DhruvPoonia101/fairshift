import { busy, field, h, iconButton, showError, toast } from '../shared/dom.js';
import { icon } from '../shared/icons.js';
import { t } from '../shared/i18n.js';
import { outbox } from '../shared/outbox.js';
import { outboxPanel } from '../shared/outbox-ui.js';
import { dictationButton } from '../shared/voice.js';

const SUBJECTS = [
  { id: 'manager', icon: 'user' },
  { id: 'policies', icon: 'building' },
  { id: 'conditions', icon: 'shield' },
];
const FACES = ['😞', '😕', '😐', '🙂', '😄'];

function subjectBlock({ id, icon: iconName }) {
  const faces = FACES.map((emoji, index) =>
    h(
      'label',
      { class: 'face' },
      h('input', { type: 'radio', name: id, value: index + 1 }),
      h('span', { class: 'face-inner' }, h('span', { class: 'emoji', 'aria-hidden': 'true', text: emoji }), h('span', { text: t(`feedback.rate.${index + 1}`) })),
    ),
  );
  const text = h('textarea', { id: `fb-${id}`, name: `${id}-text`, maxlength: 300 });
  return h(
    'fieldset',
    { class: 'card stack-sm' },
    h('legend', { class: 'row' }, icon(iconName), t(`feedback.subject.${id}`, { manager: t('term.manager') })),
    h('div', { class: 'faces' }, ...faces),
    field(t('feedback.comment'), text),
    dictationButton(text),
  );
}

/** Feedback tab: emoji ratings about the manager, policies and conditions. No name is stored. */
export async function renderFeedback() {
  const submit = iconButton('check', t('feedback.send'), { class: 'btn btn-primary btn-lg btn-block', type: 'submit' });
  const form = h('form', { class: 'stack' }, ...SUBJECTS.map(subjectBlock), submit);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    busy(submit, async () => {
      const data = new FormData(form);
      const rated = SUBJECTS.filter((s) => data.get(s.id));
      if (rated.length === 0) {
        toast(t('feedback.rateFirst'), 'alert');
        return;
      }
      try {
        // Feedback is anonymous: it is sent with no sign-in on the request, and kept with no name if there is no signal.
        let waiting = false;
        for (const s of rated) {
          const sent = await outbox.submit('feedback', { subject: s.id, rating: Number(data.get(s.id)), text: data.get(`${s.id}-text`) });
          waiting ||= sent.status === 'queued';
        }
        form.reset();
        toast(t(waiting ? 'outbox.savedToast' : 'feedback.thanks'), waiting ? 'clock' : 'check');
      } catch (error) {
        showError(error);
      }
    });
  });
  return h(
    'div',
    { class: 'stack' },
    h('h1', { text: t('feedback.title') }),
    h('div', { class: 'banner ok' }, icon('lock'), h('p', { text: t('feedback.privacy') })),
    outboxPanel(),
    form,
  );
}
