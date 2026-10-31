import { OFFLINE } from '../config/constants.js';
import { unprocessable } from './errors.js';

/**
 * Decides what to believe about a time the phone claims. `capturedAt` is the moment the worker did the
 * thing (a check-in, a report); `receivedAt` is when we got it. Both are kept, and a record that arrived
 * with a capture time is marked "recorded offline" so the employer can tell.
 *
 * - No capture time: an ordinary online request, captured = received.
 * - In the future (beyond a small clock-skew allowance), or older than 48 hours: refused.
 * - A few seconds "in the future" is clock skew, so it is read as "now".
 * @param {number | undefined} capturedAt epoch ms from the client
 * @param {number} now epoch ms on our clock
 */
export function resolveCapture(capturedAt, now) {
  if (capturedAt === undefined) return { capturedAt: now, receivedAt: now, recordedOffline: false };
  if (capturedAt > now + OFFLINE.CLOCK_SKEW_TOLERANCE_MS) {
    throw unprocessable('captured_in_future', 'The time on the phone is ahead of the server.');
  }
  if (capturedAt < now - OFFLINE.MAX_CAPTURE_AGE_MS) {
    throw unprocessable('captured_too_old', 'This was recorded too long ago to be accepted.');
  }
  return { capturedAt: Math.min(capturedAt, now), receivedAt: now, recordedOffline: true };
}
