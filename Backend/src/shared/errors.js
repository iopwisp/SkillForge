/**
 * HTTP error class. Throw from a service to short-circuit a request with a
 * specific status code and JSON body. Caught by the global error middleware
 * in `src/index.js`.
 *
 *   throw new HttpError(404, 'Problem not found');
 *   throw new HttpError(400, 'username taken', { code: 'USERNAME_TAKEN' });
 */
export class HttpError extends Error {
  constructor(status, message, details = undefined) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}

/** Convenience: 400 Bad Request from a zod parse failure. */
export function fromZod(error) {
  const issue = error.issues?.[0];
  return new HttpError(400, issue?.message || 'Bad Request');
}

/**
 * Wrap an async Express handler so that rejected promises become `next(err)`.
 * Express 4 does not auto-forward async errors; this is the smallest safe
 * wrapper. Drop when we move to Express 5.
 */
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
