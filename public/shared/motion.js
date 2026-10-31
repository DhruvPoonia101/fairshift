/**
 * Motion that CSS cannot do: numbers that count up and the Decent Work Score gauge that sweeps. Everything that
 * decides what is shown (the easing, which number to animate, every frame's text) is pure and tested; the DOM part
 * at the bottom is thin.
 *
 * The rules this file keeps:
 *  - Once per element, about 700 ms (COUNT_MS), then the element holds EXACTLY the text it started with: the last
 *    frame is the original string itself, never a recomputed one.
 *  - Screen readers get the final value at once: while it counts, the final text sits in a visually hidden span and
 *    the moving digits are aria-hidden, and aria-live is switched off until the end.
 *  - Nothing runs under prefers-reduced-motion: reduce.
 */

export const COUNT_MS = 700;
const SVG_NS = 'http://www.w3.org/2000/svg';
const NUMBER = /\d[\d,]*(?:\.\d+)?/;

/** Fast start, gentle stop. 0 -> 0 and 1 -> 1. */
export const easeOutCubic = (progress) => 1 - (1 - Math.min(1, Math.max(0, progress))) ** 3;

/**
 * What to animate in a piece of text: its first number. "₹20,169.45" counts the amount, "82 out of 100" counts the
 * 82, "3 / 12" counts the 3. Text with no number, or a zero, is left alone (there is nothing to count up to).
 * @returns {{ text: string, prefix: string, suffix: string, value: number, decimals: number, grouped: boolean } | null}
 */
export function planCount(text) {
  const found = NUMBER.exec(text);
  if (!found) return null;
  const value = Number.parseFloat(found[0].replaceAll(',', ''));
  if (!Number.isFinite(value) || value <= 0) return null;
  const point = found[0].indexOf('.');
  return {
    text,
    prefix: text.slice(0, found.index),
    suffix: text.slice(found.index + found[0].length),
    value,
    decimals: point < 0 ? 0 : found[0].length - point - 1,
    grouped: found[0].includes(','),
  };
}

const formatters = new Map();
function formatter(decimals, grouped) {
  const key = `${decimals}${grouped}`;
  if (!formatters.has(key)) {
    formatters.set(key, new Intl.NumberFormat('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: grouped }));
  }
  return formatters.get(key);
}

/** The text at `progress` (0 to 1). At 1 it is the original string, byte for byte. */
export function countFrame(plan, progress) {
  if (progress >= 1) return plan.text;
  return `${plan.prefix}${formatter(plan.decimals, plan.grouped).format(plan.value * easeOutCubic(progress))}${plan.suffix}`;
}

/** The gauge's dash pattern at `progress`: the filled part grows from 0, the gap is unchanged. At 1 it is the original attribute. */
export function dashFrame(original, progress) {
  if (progress >= 1) return original;
  const [filled, gap] = original.trim().split(/\s+/).map(Number);
  if (!Number.isFinite(filled) || !Number.isFinite(gap)) return original;
  return `${(filled * easeOutCubic(progress)).toFixed(3)} ${gap}`;
}

/**
 * Calls `onFrame(progress)` on every animation frame for `duration` ms, then `onDone` (after a final frame at exactly 1).
 * The clock and the frame scheduler are arguments so tests can run it without a browser.
 */
export function runTimeline({ duration = COUNT_MS, now = () => performance.now(), requestFrame = (fn) => requestAnimationFrame(fn), onFrame, onDone }) {
  const start = now();
  onFrame(0);
  const tick = () => {
    const progress = Math.min(1, (now() - start) / duration);
    onFrame(progress);
    if (progress < 1) requestFrame(tick);
    else onDone?.();
  };
  requestFrame(tick);
}

export function prefersReducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

// ---- DOM -----------------------------------------------------------------------------------------------------------

function animateCount(el) {
  if (el.dataset.counted) return;
  el.dataset.counted = '1';
  const plan = planCount(el.textContent);
  if (!plan) return;

  if (el.namespaceURI === SVG_NS) {
    // A number inside an SVG (the gauge): the SVG has its own aria-label with the value, so just change the digits.
    runTimeline({ onFrame: (p) => { el.textContent = countFrame(plan, p); } });
    return;
  }
  const hadLive = el.getAttribute('aria-live');
  el.setAttribute('aria-live', 'off');
  const final = document.createElement('span');
  final.className = 'visually-hidden';
  final.textContent = plan.text;
  const moving = document.createElement('span');
  moving.setAttribute('aria-hidden', 'true');
  el.replaceChildren(final, moving);
  runTimeline({
    onFrame: (p) => { moving.textContent = countFrame(plan, p); },
    onDone: () => {
      el.textContent = plan.text; // exactly what it was, as one plain text node
      if (hadLive === null) el.removeAttribute('aria-live');
      else el.setAttribute('aria-live', hadLive);
    },
  });
}

function sweepGauge(path) {
  if (path.dataset.swept) return;
  path.dataset.swept = '1';
  const original = path.getAttribute('stroke-dasharray');
  if (!original) return;
  runTimeline({
    onFrame: (p) => path.setAttribute('stroke-dasharray', dashFrame(original, p)),
    onDone: () => path.setAttribute('stroke-dasharray', original),
  });
}

function within(scope, selector) {
  return [...(scope.matches?.(selector) ? [scope] : []), ...scope.querySelectorAll(selector)];
}

/** Starts the count-ups and gauge sweeps for what is on screen now and for every screen drawn into `root` later. */
export function startMotion(root) {
  if (!root || prefersReducedMotion()) return null;
  const play = (scope) => {
    within(scope, '[data-count]').forEach(animateCount);
    within(scope, '.gauge-fill').forEach(sweepGauge);
  };
  const observer = new MutationObserver((records) => {
    for (const record of records) for (const node of record.addedNodes) if (node.nodeType === 1) play(node);
  });
  observer.observe(root, { childList: true, subtree: true });
  play(root);
  return observer;
}
