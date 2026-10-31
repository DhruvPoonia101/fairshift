import { chip, errorMessage, h, iconButton, openDialog, toast } from './dom.js';
import { dateTimeIst } from './format.js';
import { t } from './i18n.js';
import { outbox } from './outbox.js';
import { icon } from './icons.js';
import { formatTrackingCode } from './tracking-code.js';

/**
 * What the worker sees of the offline outbox: a banner ("You're offline, 2 actions waiting"), the list of waiting
 * actions with a status each, and the "Sync now" button. Every button is a full-size touch target (.btn, 48 px).
 * Status is always an icon AND a word, never colour alone.
 */

const STATUS_CHIP = {
  queued: ['info', 'clock'],
  syncing: ['info', 'refresh'],
  synced: ['ok', 'check'],
  failed: ['danger', 'alert'],
};

/** Calls `paint` now and on every change, and stops by itself once its element has left the page. */
function live(element, paint) {
  let attached = false;
  const update = () => {
    if (element.isConnected) attached = true;
    else if (attached) {
      off();
      document.removeEventListener('langchange', update);
      return;
    }
    paint();
  };
  const off = outbox.onChange(update);
  document.addEventListener('langchange', update);
  paint();
}

function itemTitle(item) {
  const { labelKey, categoryKey, subjectKey, method } = item.display;
  const detail = categoryKey ?? subjectKey ?? null;
  const how = method ? t(`outbox.method.${method}`) : null;
  return [t(labelKey), detail ? t(detail, { manager: t('term.manager') }) : how].filter(Boolean).join(' · ');
}

function reason(item) {
  if (item.status !== 'failed' && !item.lastError) return null;
  const code = item.lastError?.code;
  if (code === 'unauthorized' || code === 'wrong_account') return t('outbox.reason.signin');
  if (item.status === 'queued') return t('outbox.reason.retrying');
  const text = errorMessage({ code });
  return code === 'network' ? t('outbox.reason.network') : text;
}

function itemCard(item) {
  const [kind, iconName] = STATUS_CHIP[item.status];
  const note = reason(item);
  return h(
    'li',
    { class: 'card card-tight stack-sm outbox-item', 'data-status': item.status },
    h('div', { class: 'row row-between' }, h('strong', { text: itemTitle(item) }), chip(kind, iconName, t(`outbox.status.${item.status}`))),
    h('p', { class: 'hint', text: t('outbox.madeAt', { time: dateTimeIst(item.capturedAt) }) }),
    item.trackingCode
      ? h('div', { class: 'stack-sm' }, h('p', { class: 'track-code', text: formatTrackingCode(item.trackingCode) }), h('p', { class: 'hint', text: t('outbox.codeKeep') }))
      : null,
    note ? h('p', { class: item.status === 'failed' ? 'outbox-error' : 'muted', text: note }) : null,
    item.status === 'failed'
      ? h(
          'div',
          { class: 'row' },
          iconButton('refresh', t('outbox.retry'), { class: 'btn btn-primary', onclick: () => outbox.retry(item.id) }),
          iconButton('x', t('outbox.remove'), { onclick: () => outbox.discard(item.id) }),
        )
      : null,
  );
}

/** The waiting and finished actions, newest last (the order they will be sent in). */
export function outboxList() {
  const list = h('ul', { class: 'stack outbox-list' });
  live(list, () => list.replaceChildren(...outbox.items().map(itemCard)));
  return list;
}

async function syncNow() {
  const summary = await outbox.syncNow();
  if (summary?.synced > 0) toast(t('outbox.sentToast', { count: summary.synced }));
  else if (!outbox.isOnline()) toast(t('outbox.stillOffline'), 'alert');
}

const syncButton = (cls = 'btn') => iconButton('refresh', t('outbox.syncNow'), { class: cls, onclick: syncNow });

/** The full list in a dialog (opened from the banner). */
export function openOutboxDialog() {
  openDialog({
    title: t('outbox.title'),
    body: [h('p', { class: 'muted', text: t('outbox.intro') }), outboxList()],
    actions: (close) => [syncButton(), iconButton('check', t('common.done'), { class: 'btn btn-primary', onclick: close })],
  });
}

/** "You're offline, 2 actions waiting": at the top of every worker screen, only when there is something to say. */
export function mountOutboxBanner(host = document.getElementById('outbox-banner')) {
  live(host, () => {
    const state = outbox.describe();
    host.hidden = !state.show;
    if (!state.show) return host.replaceChildren();
    const lead = { offline: 'wifiOff', signin: 'lock', failed: 'alert' }[state.state] ?? 'refresh';
    const actions = [];
    if (state.state === 'signin') {
      actions.push(iconButton('lock', t('outbox.signInAgain'), { class: 'btn btn-primary', onclick: () => location.assign('/?need=worker') }));
    } else if (outbox.isOnline() && state.state === 'failed') {
      actions.push(iconButton('refresh', t('outbox.retry'), { class: 'btn btn-primary', onclick: () => outbox.retryFailed() }));
    } else if (outbox.isOnline() && state.state !== 'syncing') {
      actions.push(syncButton('btn btn-primary'));
    }
    if (outbox.items().length > 0) actions.push(iconButton('list', t('outbox.details'), { onclick: openOutboxDialog }));
    host.className = `outbox-banner outbox-${state.state}`;
    return host.replaceChildren(
      h('div', { class: 'row outbox-message' }, h('span', { class: 'outbox-lead' }, icon(lead)), h('strong', { text: t(state.messageKey, state.params) })),
      h('div', { class: 'row' }, ...actions),
    );
  });
}


/** The same list on the Home screen, so a worker who just acted can see what is waiting. */
export function outboxPanel() {
  const panel = h('section', { class: 'card stack outbox-panel', 'aria-labelledby': 'outbox-title' });
  live(panel, () => {
    const hasItems = outbox.items().length > 0;
    panel.hidden = !hasItems;
    if (!hasItems) return panel.replaceChildren();
    const anyLeft = outbox.items().some((i) => i.status !== 'synced');
    return panel.replaceChildren(
      h('h2', { id: 'outbox-title', class: 'row' }, icon('refresh'), t(anyLeft ? 'outbox.title' : 'outbox.titleSent')),
      outboxList(),
      outbox.isOnline() ? syncButton() : h('p', { class: 'hint', text: t('outbox.stillOffline') }),
    );
  });
  return panel;
}

/** "Showing the copy saved at 10:15": for a screen filled from the phone's saved copy. */
export function staleNotice(savedAt) {
  return h('div', { class: 'banner', role: 'note' }, icon('wifiOff'), h('p', { text: t('outbox.savedCopy', { time: dateTimeIst(savedAt) }) }));
}
