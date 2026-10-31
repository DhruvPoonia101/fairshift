import { h, iconButton } from '../shared/dom.js';
import { t } from '../shared/i18n.js';
import { preparePhoto } from '../shared/photo.js';

const MESSAGE = { photo_not_image: 'photo.badType', photo_too_big: 'photo.tooBig', photo_unreadable: 'photo.failed' };

/**
 * The optional "Add photo" row of the report form: choose or take a picture, see it, remove it. The picture is
 * shrunk on this phone (shared/photo.js); `value()` is the base64 JPEG to send, or null.
 * The note under it says photos can show faces or places.
 */
export function photoPicker() {
  let photo = null;
  const input = h('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true' });
  const status = h('p', { class: 'hint', role: 'status' });
  const preview = h('div', { class: 'photo-preview', hidden: true });
  const add = iconButton('camera', t('photo.add'), { class: 'btn', 'aria-describedby': 'photo-note', onclick: () => input.click() });
  const note = h('p', { id: 'photo-note', class: 'hint', text: t('photo.privacy') });

  function show(next) {
    photo = next;
    if (!next) {
      preview.hidden = true;
      preview.replaceChildren();
      return;
    }
    const remove = iconButton('x', t('photo.remove'), { class: 'btn', onclick: () => { show(null); status.textContent = ''; add.focus(); } });
    preview.replaceChildren(h('img', { src: next.dataUrl, alt: t('photo.previewAlt'), width: next.width, height: next.height }), h('div', { class: 'stack-sm' }, h('p', { class: 'hint', text: t('photo.ready', { kb: Math.max(1, Math.round(next.bytes / 1024)) }) }), remove));
    preview.hidden = false;
  }

  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = ''; // so choosing the same picture again still fires
    if (!file) return;
    status.textContent = t('photo.working');
    add.disabled = true;
    try {
      show(await preparePhoto(file));
      status.textContent = '';
    } catch (error) {
      show(null);
      status.textContent = t(MESSAGE[error.message] ?? 'photo.failed');
    } finally {
      add.disabled = false;
    }
  });

  return {
    el: h('div', { class: 'stack-sm photo-row' }, h('div', { class: 'row' }, add, input), status, preview, note),
    value: () => photo?.base64 ?? null,
    clear: () => { show(null); status.textContent = ''; },
  };
}
