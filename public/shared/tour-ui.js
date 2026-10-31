import { api } from './api.js';
import { h, iconButton, openDialog, showError, toast } from './dom.js';
import { icon } from './icons.js';
import { t } from './i18n.js';
import { TOUR_STEPS, createTour, isOnStep, tourStorage } from './tour.js';

/** The tour's on-screen part: an intro dialog on the landing page and a guide panel on the real screens. */

const tour = createTour(tourStorage());
const ONE_MINUTE_MS = 60_000;
const DEMO_SHIFT_EXTENSION_MS = 60 * ONE_MINUTE_MS;

/** Sign in as both demo accounts up front (the two sessions live side by side), so every step is one click away. */
async function signInDemoAccounts() {
  for (const role of new Set(TOUR_STEPS.map((step) => step.demoRole))) {
    await api(`/demo-login/${role}`, { method: 'POST' });
  }
}

function goTo(step) {
  location.assign(step.url);
}

/** Landing page: what the tour will show, with a way out. Starting signs in and opens step 1. */
export function openTourIntro() {
  openDialog({
    title: t('tour.introTitle'),
    body: [
      h('p', { text: t('tour.introBody') }),
      h('ol', { class: 'stack-sm tour-list' }, ...TOUR_STEPS.map((step) => h('li', {}, h('strong', { text: t(`tour.step.${step.id}.title`) }), h('span', { class: 'muted', text: ` ${t(`tour.step.${step.id}.short`)}` })))),
    ],
    actions: (close) => [
      iconButton('x', t('tour.skip'), { onclick: close }),
      iconButton('check', t('tour.start'), {
        class: 'btn btn-primary',
        onclick: async (event) => {
          event.currentTarget.disabled = true;
          try {
            await signInDemoAccounts();
            tour.start();
            goTo(TOUR_STEPS[0]);
          } catch (error) {
            event.currentTarget.disabled = false;
            showError(error);
          }
        },
      }),
    ],
  });
}

/** Step 1 in one click: contest the newest finished day, claiming one more hour of work. */
async function fileDemoDispute() {
  const { records } = await api('/attendance/records', { as: 'worker' });
  const record = records.find((r) => r.checkOut !== null && !r.openDisputeId);
  if (!record) return t('tour.noRecord');
  const claimed = Math.min(record.checkOut + DEMO_SHIFT_EXTENSION_MS, Date.now() - ONE_MINUTE_MS);
  await api('/disputes', { method: 'POST', as: 'worker', body: { shiftId: record.id, category: 'wrong_time', checkOutAt: claimed, note: t('tour.demoNote') } });
  return t('tour.filed');
}

/** Step 2 in one click: approve the dispute made during this tour. */
async function approveDemoDispute(startedAt) {
  const { items } = await api('/admin/disputes', { as: 'admin' });
  const target = items.find((d) => ['submitted', 'under_review'].includes(d.status) && d.createdAt >= (startedAt ?? 0) - ONE_MINUTE_MS);
  if (!target) return t('tour.needStep1');
  await api(`/admin/disputes/${target.id}/decision`, { method: 'POST', as: 'admin', body: { decision: 'approve', note: t('tour.demoApprove') } });
  return t('tour.approved');
}

/** Step 3: the pay change recorded when the correction was approved, read from the worker's own audit trail. */
async function readResult() {
  const { audit } = await api('/disputes', { as: 'worker' });
  const approval = audit.find((entry) => entry.action === 'dispute_approved' && entry.details?.payslip);
  if (!approval) return t('tour.noResult');
  const { netBeforePaise, netAfterPaise } = approval.details.payslip;
  return t('tour.result', { beforePaise: netBeforePaise, afterPaise: netAfterPaise });
}

const STEP_ACTIONS = {
  contest: { labelKey: 'tour.doContest', run: () => fileDemoDispute() },
  approve: { labelKey: 'tour.doApprove', run: (view) => approveDemoDispute(view.startedAt) },
};

function buildPanel() {
  const panel = h('section', { class: 'tour', role: 'region', 'aria-labelledby': 'tour-title' });
  let removeKey = () => {};

  const close = () => {
    removeKey();
    panel.remove();
    document.body.classList.remove('tour-active');
  };

  function render() {
    const view = tour.view();
    if (!view.active) {
      close();
      return;
    }
    const step = view.current;
    const action = STEP_ACTIONS[step.id];
    const message = h('p', { class: 'tour-message', role: 'status' });
    const showMessage = (text) => {
      message.textContent = text ?? '';
    };

    const buttons = [
      action
        ? iconButton('check', t(action.labelKey), {
            class: 'btn btn-primary',
            onclick: async (event) => {
              event.currentTarget.disabled = true;
              try {
                showMessage(await action.run(view));
              } catch (error) {
                showError(error);
              } finally {
                event.currentTarget.disabled = false;
              }
            },
          })
        : null,
      !isOnStep(location, step) ? iconButton('pin', t('tour.goToStep'), { onclick: () => goTo(step) }) : null,
      step.id === 'result' ? h('a', { class: 'btn', href: '/worker/#pay' }, icon('wallet'), t('tour.showPay')) : null,
      view.isFirst ? null : iconButton('arrowLeft', t('tour.back'), { onclick: () => { tour.back(); goTo(TOUR_STEPS[tour.view().step]); render(); } }),
      iconButton('check', t(view.isLast ? 'tour.finish' : 'tour.next'), {
        class: view.isLast ? 'btn btn-primary' : 'btn',
        onclick: () => {
          const moved = tour.next();
          if (!moved.active) {
            close();
            toast(t('tour.done'));
            return;
          }
          goTo(TOUR_STEPS[moved.step]);
          render();
        },
      }),
      iconButton('x', t('tour.skip'), { onclick: () => { tour.skip(); close(); } }),
    ];

    panel.replaceChildren(
      h('div', { class: 'row row-between' }, h('p', { class: 'tour-progress', text: t('tour.stepOf', { n: view.number, total: view.total }) }), icon('compass')),
      h('progress', { value: view.number, max: view.total, 'aria-label': t('tour.stepOf', { n: view.number, total: view.total }) }),
      h('h2', { id: 'tour-title', tabindex: '-1', text: t(`tour.step.${step.id}.title`) }),
      h('p', { text: t(`tour.step.${step.id}.text`) }),
      message,
      h('div', { class: 'tour-actions' }, ...buttons),
    );
    if (step.id === 'result') readResult().then(showMessage, () => showMessage(t('tour.noResult')));
    panel.querySelector('#tour-title').focus({ preventScroll: true });
  }

  const onKey = (event) => {
    if (event.key === 'Escape' && !document.querySelector('dialog[open]')) {
      tour.skip();
      close();
    }
  };
  document.addEventListener('keydown', onKey);
  removeKey = () => document.removeEventListener('keydown', onKey);
  document.addEventListener('langchange', render);
  return { panel, render };
}

/** On a real screen: show the guide panel if a tour is running. Skippable with the button or Esc. */
export function mountTour() {
  if (!tour.isActive()) return;
  const { panel, render } = buildPanel();
  document.body.append(panel);
  document.body.classList.add('tour-active');
  render();
}
