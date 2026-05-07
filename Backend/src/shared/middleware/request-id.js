/**
 * Request-id middleware.
 *
 * For every incoming request:
 *   - if the client sent `X-Request-Id` (proxy / curl), use it,
 *   - otherwise generate a fresh UUID.
 * Then attach it to `req.id` and echo it back in the response header.
 *
 * `req.id` is the stable identifier that pino-http picks up via its
 * `genReqId` option, so every log line associated with a request shares
 * the same `reqId` field. Customer-side support tickets reference this
 * id from the response header to find the matching server logs.
 */
import crypto from 'node:crypto';

const MAX_INCOMING_LENGTH = 200;

export function requestId() {
  return (req, res, next) => {
    const incoming = req.headers['x-request-id'];
    const isUsable =
      typeof incoming === 'string' &&
      incoming.length > 0 &&
      incoming.length <= MAX_INCOMING_LENGTH;

    req.id = isUsable ? incoming : crypto.randomUUID();
    res.setHeader('X-Request-Id', req.id);
    next();
  };
}
