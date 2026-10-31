/**
 * The judge tour: three steps across the real worker and employer screens, using the demo accounts.
 * This file is only the step list and the state machine (pure, no DOM), so it can be tested; the
 * on-screen panel is in tour-ui.js. State lives in sessionStorage, so it survives moving between
 * the worker and employer pages, and goes away when the tab closes.
 */

export const TOUR_KEY = 'fairshift.tour';

/** 1) a worker contests a day, 2) the employer approves it, 3) the worker sees the corrected pay and audit trail. */
export const TOUR_STEPS = Object.freeze([
  Object.freeze({ id: 'contest', role: 'worker', demoRole: 'worker-construction', url: '/worker/#records' }),
  Object.freeze({ id: 'approve', role: 'admin', demoRole: 'admin-construction', url: '/admin/#disputes' }),
  Object.freeze({ id: 'result', role: 'worker', demoRole: 'worker-construction', url: '/worker/#records' }),
]);

const LAST = TOUR_STEPS.length - 1;
const INACTIVE = Object.freeze({ active: false, step: 0, startedAt: null, finished: false });

/** Corrupt or hand-edited storage can never put the tour on a step that does not exist. */
function normaliseState(value) {
  if (!value || value.active !== true) return { ...INACTIVE, finished: value?.finished === true };
  const step = Number.isInteger(value.step) ? Math.min(Math.max(value.step, 0), LAST) : 0;
  return { active: true, step, startedAt: Number.isFinite(value.startedAt) ? value.startedAt : null, finished: false };
}

/** The tab's own storage, or null where the browser blocks it (the tour then simply does not resume). */
export function tourStorage() {
  try {
    return sessionStorage;
  } catch {
    return null;
  }
}

/** True when the page address is the step's screen (ignoring a trailing slash on the path). */
export function isOnStep(location, step) {
  const path = (value) => value.replace(/\/$/, '');
  const [stepPath, stepHash] = step.url.split('#');
  return path(location.pathname) === path(stepPath) && location.hash === `#${stepHash}`;
}

/**
 * @param {Pick<Storage, 'getItem' | 'setItem'> | null} storage
 * @param {() => number} [now]
 */
export function createTour(storage, now = Date.now) {
  const read = () => {
    try {
      return normaliseState(JSON.parse(storage.getItem(TOUR_KEY)));
    } catch {
      return { ...INACTIVE };
    }
  };
  const write = (state) => {
    try {
      storage.setItem(TOUR_KEY, JSON.stringify(state));
    } catch {
      // Blocked storage: the tour still works on this page.
    }
    return state;
  };

  return {
    state: read,
    isActive: () => read().active,
    /** Where the tour is, for drawing the panel. */
    view() {
      const state = read();
      return {
        ...state,
        total: TOUR_STEPS.length,
        number: state.step + 1,
        current: state.active ? TOUR_STEPS[state.step] : null,
        isFirst: state.step === 0,
        isLast: state.step === LAST,
      };
    },
    start: () => write({ active: true, step: 0, startedAt: now(), finished: false }),
    /** Moves on; after the last step the tour ends (and says it finished, as opposed to skipped). */
    next() {
      const state = read();
      if (!state.active) return state;
      return write(state.step >= LAST ? { ...INACTIVE, finished: true } : { ...state, step: state.step + 1 });
    },
    back() {
      const state = read();
      return state.active && state.step > 0 ? write({ ...state, step: state.step - 1 }) : state;
    },
    skip: () => write({ ...INACTIVE }),
  };
}
