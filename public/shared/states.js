import { ApiError } from './api.js';
import { errorMessage, h, iconButton } from './dom.js';
import { icon } from './icons.js';
import { t } from './i18n.js';

/**
 * The three states every screen can be in besides "ready": loading, empty and failed.
 * Skeletons reserve roughly the space of the real content, so nothing jumps when it arrives.
 */

const SHAPES = {
  list: ['title', 'card', 'card', 'card'],
  cards: ['title', 'row', 'card', 'card'],
  table: ['title', 'line', 'row', 'row', 'row', 'row'],
};

/** Grey placeholder blocks, announced politely as "Loading…" to screen readers. */
export function skeleton(kind = 'list') {
  return h(
    'div',
    { class: 'skeleton', role: 'status', 'aria-busy': 'true' },
    h('span', { class: 'visually-hidden', text: t('common.loading') }),
    ...SHAPES[kind].map((shape) => h('div', { class: `skel skel-${shape}`, 'aria-hidden': 'true' })),
  );
}

/**
 * A friendly "nothing here yet": what it means and, where useful, what to do next.
 * @param {{ iconName?: string, title: string, text?: string, action?: Node | null }} content
 */
export function emptyState({ iconName = 'info', title, text, action = null }) {
  return h(
    'section',
    { class: 'state' },
    icon(iconName),
    h('h2', { text: title }),
    text ? h('p', { class: 'muted', text }) : null,
    action,
  );
}

/** What went wrong, in words, with a button to try again in place (no full reload). */
export function errorState(error, onRetry) {
  // No answer at all (not even an error from the server) means no signal: say so, rather than "something went wrong".
  const noSignal = !(error instanceof ApiError);
  return h(
    'section',
    { class: 'state state-error', role: 'alert' },
    icon(noSignal ? 'wifiOff' : 'alert'),
    h('h2', { text: t(noSignal ? 'state.offlineTitle' : 'state.errorTitle') }),
    noSignal ? null : h('p', { text: errorMessage(error) }),
    h('p', { class: 'hint', text: t(noSignal ? 'state.offlineHint' : 'state.errorHint') }),
    iconButton('trend', t('common.retry'), { class: 'btn btn-primary', onclick: onRetry }),
  );
}
