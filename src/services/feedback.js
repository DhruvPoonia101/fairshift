import {
  FEEDBACK_SUBJECTS,
  FEEDBACK_WINDOW_DAYS,
  K_ANONYMITY_MIN,
  RATING_MAX,
  RATING_MIN,
} from '../config/constants.js';
import { newId } from '../lib/random.js';
import { addDays, dayKey } from '../lib/time.js';

const ONE_DECIMAL = 10;

/**
 * Summarises one subject. Below K_ANONYMITY_MIN responses nothing is revealed, not even the count.
 * @param {string} subject
 * @param {Array<{rating: number, text: string}>} items
 */
export function summariseBucket(subject, items) {
  if (items.length < K_ANONYMITY_MIN) {
    return { subject, suppressed: true, count: null };
  }
  const distribution = Array.from({ length: RATING_MAX - RATING_MIN + 1 }, () => 0);
  let sum = 0;
  for (const { rating } of items) {
    distribution[rating - RATING_MIN] += 1;
    sum += rating;
  }
  return {
    subject,
    suppressed: false,
    count: items.length,
    average: Math.round((sum / items.length) * ONE_DECIMAL) / ONE_DECIMAL,
    distribution,
    // Alphabetical, so the order never reveals who wrote first.
    comments: items.map((i) => i.text).filter(Boolean).sort((a, b) => a.localeCompare(b)),
  };
}

/** @param {{ store: object, clock: { now: () => number } }} deps */
export function createFeedbackService({ store, clock }) {
  return {
    /**
     * Stores a rating with NO worker id, no IP and only the day (not the time).
     * The prototype cannot stop one worker voting twice; production would use blind tokens.
     */
    async submit(orgId, { subject, rating, text }, { id, capturedAt } = {}) {
      await store.feedback.insert({
        id: id ?? newId('fb'),
        orgId,
        subject,
        rating,
        text,
        // The day it was given. Anonymous feedback sent late keeps the day the worker gave it, and is
        // deliberately NOT marked "offline": a flag would shrink the group it hides in.
        day: dayKey(capturedAt ?? clock.now()),
      });
    },

    /** Per-subject aggregates for the last 90 days, with k-anonymity applied. */
    async aggregate(orgId) {
      const since = addDays(dayKey(clock.now()), -(FEEDBACK_WINDOW_DAYS - 1));
      const all = (await store.feedback.query(orgId)).filter((f) => f.day >= since);
      return FEEDBACK_SUBJECTS.map((subject) =>
        summariseBucket(subject, all.filter((f) => f.subject === subject)),
      );
    },
  };
}
