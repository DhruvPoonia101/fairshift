/** An error that is safe to show to the client. Anything else becomes a generic 500. */
export class AppError extends Error {
  /**
   * @param {number} status HTTP status
   * @param {string} code stable machine-readable code (also an i18n key on the client)
   * @param {string} message short English message
   * @param {object} [details] safe extra data, e.g. invalid field names
   */
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (code, message, details) => new AppError(400, code, message, details);
export const unauthorized = (message = 'Please sign in.') => new AppError(401, 'unauthorized', message);
export const forbidden = (message = 'You cannot do that.') => new AppError(403, 'forbidden', message);
export const notFound = (message = 'Not found.') => new AppError(404, 'not_found', message);
export const conflict = (code, message) => new AppError(409, code, message);
export const unprocessable = (code, message, details) => new AppError(422, code, message, details);
