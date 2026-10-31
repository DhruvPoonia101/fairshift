import { OFFLINE } from '../config/constants.js';
import { badRequest, AppError } from '../lib/errors.js';
import { fingerprintOf } from '../services/idempotency.js';

const KEY_HEADER = 'idempotency-key';
const OWNER_HEADER = 'x-fairshift-owner';

/** The Idempotency-Key header, or undefined. A key of the wrong shape is a client bug and is refused. */
export function readIdempotencyKey(req) {
  const key = req.get(KEY_HEADER);
  if (key === undefined) return undefined;
  if (!OFFLINE.IDEMPOTENCY_KEY_PATTERN.test(key)) throw badRequest('invalid_idempotency_key', 'The Idempotency-Key is not valid.');
  return key;
}

/**
 * A queued action names the worker who made it (x-fairshift-owner). If someone else is signed in on that
 * phone when it is sent, it must not be filed under them: it waits for the right person to sign in.
 */
export function assertOwner(req, res, next) {
  const owner = req.get(OWNER_HEADER);
  if (owner !== undefined && req.user && owner !== req.user.id) {
    return next(new AppError(409, 'wrong_account', 'This was made by someone else on this phone.'));
  }
  return next();
}

/**
 * Runs `task` once per Idempotency-Key and sends its outcome. A repeat of the same request gets the
 * stored outcome with `Idempotent-Replayed: true`; without a key the task simply runs.
 * `task` receives `idFor(prefix)`: a stable id for what it creates, or undefined when there is no key.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {{ idempotency: object, kind: string, scope: string, orgId: string, body: object }} options
 * @param {(helpers: { idFor: (prefix: string) => string | undefined }) => Promise<{ status: number, body: object }>} task
 */
export async function respondIdempotent(req, res, { idempotency, kind, scope, orgId, body }, task) {
  const key = readIdempotencyKey(req);
  const ref = { orgId, scope, kind, key };
  const outcome = await idempotency.run({ ...ref, fingerprint: fingerprintOf(kind, body) }, () =>
    task({ idFor: (prefix) => (key ? idempotency.idFor(prefix, ref) : undefined) }),
  );
  if (outcome.replayed) res.set('Idempotent-Replayed', 'true');
  res.status(outcome.status).json(outcome.body);
}
