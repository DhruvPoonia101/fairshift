import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEMO_ROLES } from '../src/config/sectors.js';
import { TOUR_KEY, TOUR_STEPS, createTour, isOnStep } from '../public/shared/tour.js';

const memoryStorage = (initial = {}) => {
  const data = { ...initial };
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); } };
};
const blockedStorage = () => ({
  getItem: () => { throw new Error('blocked'); },
  setItem: () => { throw new Error('blocked'); },
});

test('the tour has three steps in order: worker contests, employer approves, worker sees the result', () => {
  assert.deepEqual(TOUR_STEPS.map((s) => [s.id, s.role]), [['contest', 'worker'], ['approve', 'admin'], ['result', 'worker']]);
  for (const step of TOUR_STEPS) assert.ok(DEMO_ROLES.includes(step.demoRole), `${step.id} uses a real demo account`);
  assert.deepEqual(TOUR_STEPS.map((s) => s.url), ['/worker/#records', '/admin/#disputes', '/worker/#records']);
});

test('it is off until started; start puts it on step 1 of 3', () => {
  const tour = createTour(memoryStorage(), () => 1000);
  assert.equal(tour.isActive(), false);
  assert.equal(tour.view().current, null);
  tour.start();
  const view = tour.view();
  assert.deepEqual([view.active, view.number, view.total, view.current.id, view.isFirst, view.isLast], [true, 1, 3, 'contest', true, false]);
});

test('next and back move one step and stop at the ends', () => {
  const tour = createTour(memoryStorage());
  tour.start();
  tour.back();
  assert.equal(tour.view().number, 1, 'back on step 1 stays on step 1');
  tour.next();
  assert.equal(tour.view().current.id, 'approve');
  tour.next();
  assert.deepEqual([tour.view().current.id, tour.view().isLast], ['result', true]);
  tour.back();
  assert.equal(tour.view().current.id, 'approve');
});

test('next after the last step finishes the tour; skip ends it without finishing', () => {
  const finished = createTour(memoryStorage());
  finished.start();
  finished.next();
  finished.next();
  finished.next();
  assert.equal(finished.isActive(), false);
  assert.equal(finished.state().finished, true);

  const skipped = createTour(memoryStorage());
  skipped.start();
  skipped.next();
  skipped.skip();
  assert.equal(skipped.isActive(), false);
  assert.equal(skipped.state().finished, false);
  assert.equal(skipped.next().active, false, 'next does nothing when the tour is off');
});

test('the step survives moving between the worker and employer pages (same storage, new tour object)', () => {
  const storage = memoryStorage();
  const first = createTour(storage);
  first.start();
  first.next();
  const onAnotherPage = createTour(storage);
  assert.equal(onAnotherPage.view().current.id, 'approve');
  onAnotherPage.next();
  assert.equal(createTour(storage).view().current.id, 'result');
});

test('starting again restarts from step 1', () => {
  const tour = createTour(memoryStorage());
  tour.start();
  tour.next();
  tour.start();
  assert.equal(tour.view().number, 1);
});

test('corrupt or hand-edited storage can never leave the tour on a step that does not exist', () => {
  const cases = [
    ['{nope', false],
    ['null', false],
    [JSON.stringify({ active: true, step: 99 }), true],
    [JSON.stringify({ active: true, step: -4 }), true],
    [JSON.stringify({ active: true, step: 'two' }), true],
    [JSON.stringify({ active: 'yes', step: 1 }), false],
  ];
  for (const [raw, active] of cases) {
    const view = createTour(memoryStorage({ [TOUR_KEY]: raw })).view();
    assert.equal(view.active, active, raw);
    if (active) assert.ok(view.step >= 0 && view.step < TOUR_STEPS.length && view.current, raw);
  }
  assert.equal(createTour(memoryStorage({ [TOUR_KEY]: JSON.stringify({ active: true, step: 99 }) })).view().number, 3);
});

test('blocked or missing storage does not throw; the tour just is not remembered', () => {
  for (const storage of [blockedStorage(), null]) {
    const tour = createTour(storage);
    assert.equal(tour.isActive(), false);
    assert.doesNotThrow(() => {
      tour.start();
      tour.next();
      tour.back();
      tour.skip();
    });
  }
});

test('isOnStep matches the screen of a step, with or without a trailing slash', () => {
  const [contest, approve] = TOUR_STEPS;
  assert.equal(isOnStep({ pathname: '/worker/', hash: '#records' }, contest), true);
  assert.equal(isOnStep({ pathname: '/worker', hash: '#records' }, contest), true);
  assert.equal(isOnStep({ pathname: '/worker/', hash: '#pay' }, contest), false);
  assert.equal(isOnStep({ pathname: '/admin/', hash: '#disputes' }, contest), false);
  assert.equal(isOnStep({ pathname: '/admin/', hash: '#disputes' }, approve), true);
});
