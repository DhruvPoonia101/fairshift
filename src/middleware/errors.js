import { AppError, notFound } from '../lib/errors.js';

export const apiNotFound = (req, res, next) => next(notFound('No such endpoint.'));

/**
 * Last-resort handler: known errors keep their status and code; everything else becomes a
 * generic 500 so no stack trace, file path or request data ever reaches the client.
 */
export function errorHandler(logError = console.error) {
  return (err, req, res, next) => {
    if (res.headersSent) return;
    if (err instanceof AppError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
      return;
    }
    if (err?.type === 'entity.too.large') {
      res.status(413).json({ error: { code: 'too_large', message: 'Request is too large.' } });
      return;
    }
    if (err?.type === 'entity.parse.failed') {
      res.status(400).json({ error: { code: 'bad_json', message: 'Request body is not valid JSON.' } });
      return;
    }
    logError(`Unhandled error: ${err?.name ?? 'Error'}`);
    res.status(500).json({ error: { code: 'server_error', message: 'Something went wrong. Please try again.' } });
  };
}
