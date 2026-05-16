/**
 * Per-user / per-IP rate limiter helpers.
 *
 * `userRateLimit({ windowMs, max })` returns an Express middleware
 * keyed off `req.user?.id` (set by requireAuth) with a fallback to
 * `req.ip` for unauthenticated callers. The limiter is automatically
 * skipped when `NODE_ENV=test` so the integration suite's tight loops
 * don't trip 429 ceilings.
 *
 * These limiters protect the judge-bound endpoints (submit / run /
 * exam submit / contest submit) where a single misbehaving client
 * could otherwise queue-flood the workers — see the senior audit
 * findings C-5.
 */
import rateLimit from 'express-rate-limit';

export function userRateLimit({ windowMs, max }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV === 'test',
    keyGenerator: (req) => (req.user?.id ? `u:${req.user.id}` : req.ip),
  });
}
