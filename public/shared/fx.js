/**
 * Pointer and scroll effects for the landing page. Small, no library, and only transform and opacity ever change
 * (through CSS custom properties that landing.css and motion.css read).
 *
 *  - The 3D scene tilts toward the pointer (at most 8 degrees); cards tilt a little (at most 4) with a highlight that follows the pointer.
 *  - Primary buttons marked `.magnetic` move up to 6 px toward the pointer.
 *  - Sections marked `[data-reveal]` fade up in turn as they scroll into view.
 *  - The scene stops animating while the tab is hidden or the scene is off screen.
 *
 * Tilt, highlight and magnetic buttons need a fine pointer that can hover; none of this runs under reduced motion
 * (the reveal is then skipped too, so everything is simply shown). The maths is exported and pure, so it is tested.
 */

export const SCENE_TILT_DEG = 8;
export const CARD_TILT_DEG = 4;
export const MAGNET_PX = 6;
const MAGNET_REACH_PX = 48;

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/** Where the pointer is inside a rectangle, from -1 (left / top edge) to 1 (right / bottom edge), 0 in the middle. */
export function unit(pointer, start, size) {
  return size > 0 ? clamp(((pointer - start) / size) * 2 - 1, -1, 1) : 0;
}

/** Tilt in degrees for a pointer position: the pointer on the right turns the right side away, on top tips the top away. */
export function tiltFor({ x, y, left, top, width, height }, maxDeg) {
  const ux = unit(x, left, width);
  const uy = unit(y, top, height);
  return { rx: Math.round(-uy * maxDeg * 100) / 100 + 0, ry: Math.round(ux * maxDeg * 100) / 100 + 0 }; // + 0 turns -0 into 0
}

/** How far a button moves (px) toward a pointer that is near it; nothing when the pointer is further than `reach` from its edge. */
export function magnetFor({ x, y, left, top, width, height }, max = MAGNET_PX, reach = MAGNET_REACH_PX) {
  const outsideX = Math.max(left - x, 0, x - (left + width));
  const outsideY = Math.max(top - y, 0, y - (top + height));
  if (Math.hypot(outsideX, outsideY) > reach) return { tx: 0, ty: 0 };
  return { tx: Math.round(unit(x, left, width) * max * 100) / 100, ty: Math.round(unit(y, top, height) * max * 100) / 100 };
}

/** Delay in ms for the nth block of a reveal, so a row of cards arrives one after another (capped so none waits long). */
export const revealDelay = (index) => Math.min(index, 5) * 80;

const FINE_HOVER = '(hover: hover) and (pointer: fine)';
const matches = (query) => {
  try {
    return window.matchMedia(query).matches;
  } catch {
    return false;
  }
};

function frameThrottle(fn) {
  let pending = null;
  return (event) => {
    pending = event;
    if (pending && !fn.queued) {
      fn.queued = true;
      requestAnimationFrame(() => {
        fn.queued = false;
        fn(pending);
      });
    }
  };
}

function initScene(scene) {
  const stage = scene.querySelector('.stage');
  const watch = new IntersectionObserver(([entry]) => scene.toggleAttribute('data-paused', !entry.isIntersecting || document.hidden), { threshold: 0.05 });
  watch.observe(scene);
  document.addEventListener('visibilitychange', () => scene.toggleAttribute('data-paused', document.hidden));
  if (!matches(FINE_HOVER)) return;
  const hero = scene.closest('.hero') ?? scene;
  const move = frameThrottle((event) => {
    const rect = scene.getBoundingClientRect();
    const { rx, ry } = tiltFor({ x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, width: rect.width, height: rect.height }, SCENE_TILT_DEG);
    stage.style.setProperty('--rx', `${rx}deg`);
    stage.style.setProperty('--ry', `${ry}deg`);
  });
  hero.addEventListener('pointermove', move);
  hero.addEventListener('pointerleave', () => {
    stage.style.removeProperty('--rx');
    stage.style.removeProperty('--ry');
  });
}

function initCards() {
  if (!matches(FINE_HOVER)) return;
  document.addEventListener('pointermove', (event) => {
    const card = event.target.closest?.('[data-tilt], [data-shine]');
    if (!card) return;
    const rect = card.getBoundingClientRect();
    if (card.hasAttribute('data-tilt')) {
      const { rx, ry } = tiltFor({ x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, width: rect.width, height: rect.height }, CARD_TILT_DEG);
      card.style.setProperty('--trx', `${rx}deg`);
      card.style.setProperty('--try', `${ry}deg`);
    }
    card.style.setProperty('--mx', `${Math.round(event.clientX - rect.left)}px`);
    card.style.setProperty('--my', `${Math.round(event.clientY - rect.top)}px`);
  });
  document.addEventListener('pointerout', (event) => {
    const card = event.target.closest?.('[data-tilt]');
    if (card && !card.contains(event.relatedTarget)) {
      card.style.removeProperty('--trx');
      card.style.removeProperty('--try');
    }
  });
}

function initMagnetic() {
  if (!matches(FINE_HOVER)) return;
  const move = frameThrottle((event) => {
    for (const button of document.querySelectorAll('.magnetic')) {
      const rect = button.getBoundingClientRect();
      const { tx, ty } = magnetFor({ x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, width: rect.width, height: rect.height });
      button.style.setProperty('--tx', `${tx}px`);
      button.style.setProperty('--ty', `${ty}px`);
    }
  });
  document.addEventListener('pointermove', move);
}

/** Blocks that start below the fold wait invisibly, then fade up (with a small stagger) as they come into view. */
function initReveal(root) {
  const blocks = [...root.querySelectorAll('[data-reveal]')].filter((el) => el.getBoundingClientRect().top > window.innerHeight);
  if (blocks.length === 0 || typeof IntersectionObserver !== 'function') return;
  const seen = new Map();
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const el = entry.target;
      const order = seen.get(el.parentElement) ?? 0;
      seen.set(el.parentElement, order + 1);
      el.style.setProperty('--d', `${revealDelay(order)}ms`);
      el.classList.add('fx-in');
      el.classList.remove('fx-wait');
      observer.unobserve(el);
    }
  }, { threshold: 0 }); // any part in view reveals it, so a block at the very end of the page can never stay hidden
  for (const el of blocks) {
    el.classList.add('fx-wait');
    observer.observe(el);
  }
}

/** Starts every effect that the device and the person's settings allow. */
export function startFx(root = document) {
  if (matches('(prefers-reduced-motion: reduce)')) return;
  const scene = root.getElementById?.('scene') ?? root.querySelector('#scene');
  if (scene && typeof IntersectionObserver === 'function') initScene(scene);
  initCards();
  initMagnetic();
  initReveal(root);
}
