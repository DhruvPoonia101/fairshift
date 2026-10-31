import { icon } from './icons.js';
import { t } from './i18n.js';

/**
 * Builds an element. Children and `text` are always added as text nodes, never parsed as HTML,
 * so user-supplied strings cannot inject markup.
 * @param {string} tag
 * @param {Record<string, unknown>} [props] `class`, `text`, `onclick`-style handlers, or attributes
 * @param {...(Node | string | null | false)} children
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child);
  }
  return el;
}

/**
 * Replaces everything inside `parent` with `children`. Unlike the DOM's own replaceChildren, which turns a
 * null, undefined or false argument into the TEXT "null" / "undefined" / "false", this skips them (as h() does),
 * so `fill(slot, condition ? button : null)` shows nothing when the condition is false.
 * @param {{ replaceChildren: (...nodes: (Node | string)[]) => void }} parent
 * @param {...(Node | string | null | undefined | false)} children
 */
export function fill(parent, ...children) {
  parent.replaceChildren(...children.flat().filter((child) => child !== null && child !== undefined && child !== false));
}

/** Button with a leading icon and a visible text label. */
export function iconButton(iconName, label, props = {}) {
  const { class: cls = 'btn', ...rest } = props;
  return h('button', { type: 'button', class: cls, ...rest }, icon(iconName), h('span', { text: label }));
}

/** Chip with icon and text, so meaning never depends on colour alone. */
export function chip(kind, iconName, text) {
  return h('span', { class: `chip chip-${kind}` }, icon(iconName), h('span', { text }));
}

let toastRegion = null;
let dialogCount = 0;

/** Short message in a polite live region (announced by screen readers). */
export function toast(message, iconName = 'check') {
  toastRegion ??= document.getElementById('toasts');
  const el = h('div', { class: 'toast' }, icon(iconName), h('span', { text: message }));
  toastRegion.append(el);
  setTimeout(() => el.remove(), 5000);
}

/**
 * Modal dialog built on <dialog>, which traps focus, closes on Esc and returns focus to the opener.
 * @param {object} options
 * @param {string} options.title
 * @param {Node[]} options.body
 * @param {(close: () => void) => Node[]} options.actions buttons for the footer
 * @param {() => void} [options.onClose]
 */
export function openDialog({ title, body, actions, onClose }) {
  dialogCount += 1;
  const titleId = `dialog-title-${dialogCount}`; // unique, so a dialog opened from another one is named correctly
  const dialog = h('dialog', { 'aria-labelledby': titleId });
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    onClose?.();
    dialog.remove();
  };
  const close = () => {
    dialog.close();
    dispose(); // do not depend on the 'close' event alone
  };
  dialog.append(
    h(
      'div',
      { class: 'stack' },
      h('h2', { id: titleId, text: title }),
      ...body,
      h('div', { class: 'row' }, ...actions(close)),
    ),
  );
  dialog.addEventListener('close', dispose); // also covers the Esc key
  document.body.append(dialog);
  dialog.showModal();
  return { dialog, close };
}

export function cancelButton(close) {
  return iconButton('x', t('common.cancel'), { onclick: close });
}

/** Label + control pair with an optional hint. Returns the wrapper; the control keeps its own id. */
export function field(labelText, control, hint) {
  const id = control.id || `f-${Math.random().toString(36).slice(2, 8)}`;
  control.id = id;
  if (hint) control.setAttribute('aria-describedby', `${id}-hint`);
  return h(
    'div',
    { class: 'field' },
    h('label', { for: id, text: labelText }),
    control,
    hint ? h('span', { id: `${id}-hint`, class: 'hint', text: hint }) : null,
  );
}

/** Translated message for an API error code, or a generic one. */
export function errorMessage(error) {
  const key = `err.${error?.code}`;
  const message = t(key);
  return message === key ? t('err.generic') : message;
}

export const showError = (error) => toast(errorMessage(error), 'alert');

/** Disables a button while an async action runs, so a double tap cannot send twice. */
export async function busy(button, action) {
  button.disabled = true;
  try {
    return await action();
  } finally {
    button.disabled = false;
  }
}
