/**
 * HTTP routes for /api/submissions/*.
 *
 * Submit is two-phase per ADR 0013: this route is the *thin* HTTP entry
 * point that delegates everything (PENDING insert + enqueue, idempotent
 * dedupe, etc.) to `submissions.service.submit`. The status code is
 * 202 Accepted to signal "we have received the work" — even in inline
 * mode where the verdict is already there, 202 is still correct: the
 * resource is created and the body carries the current state.
 *
 * The `Idempotency-Key` header is optional. The header value must be a
 * URL-safe ASCII string up to 64 chars (UUIDv4 fits comfortably). We
 * validate it here so a hostile / oversized header can't sneak past
 * into the DB.
 */
import { Router } from 'express';

import { asyncHandler, fromZod, HttpError } from '../../shared/errors.js';
import { userRateLimit } from '../../shared/middleware/rate-limit.js';
import { optionalAuth, requireAuth } from '../auth/middleware.js';
import { RunSchema, SubmitSchema } from './schemas.js';
import * as submissions from './service.js';

const router = Router();

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._~:-]{8,64}$/;

// Per-user limits on the judge-bound endpoints. The limiter sits AFTER
// `requireAuth` so it can key on `req.user.id` and so a 401 path doesn't
// burn limiter quota.
const submitLimiter = userRateLimit({ windowMs: 60_000, max: 60 });
const runLimiter = userRateLimit({ windowMs: 60_000, max: 30 });

function readIdempotencyKey(req) {
  const raw = req.get('Idempotency-Key');
  if (!raw) return null;
  if (!IDEMPOTENCY_KEY_PATTERN.test(raw)) {
    throw new HttpError(400, 'Invalid Idempotency-Key (must be URL-safe ASCII, 8–64 chars)');
  }
  return raw;
}

/** POST /api/submissions/:slug — submit code for a problem. */
router.post('/:slug', requireAuth, submitLimiter, asyncHandler(async (req, res) => {
  const parsed = SubmitSchema.safeParse(req.body);
  if (!parsed.success) throw fromZod(parsed.error);
  const idempotencyKey = readIdempotencyKey(req);
  const result = await submissions.submit({
    user: req.user,
    slug: req.params.slug,
    code: parsed.data.code,
    language: parsed.data.language,
    idempotencyKey,
  });
  res.status(202).json(result);
}));

/** POST /api/submissions/:slug/run — run sample only, do NOT persist. */
router.post('/:slug/run', requireAuth, runLimiter, asyncHandler(async (req, res) => {
  const parsed = RunSchema.safeParse(req.body);
  if (!parsed.success) throw fromZod(parsed.error);
  res.json(await submissions.run({
    slug: req.params.slug,
    code: parsed.data.code,
    language: parsed.data.language,
    stdin: parsed.data.stdin,
  }));
}));

/** GET /api/submissions/me — current user's submissions across all problems. */
router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  res.json(await submissions.getMyHistory(req.user.id));
}));

/** GET /api/submissions/problem/:slug — current user's submissions for a problem. */
router.get('/problem/:slug', requireAuth, asyncHandler(async (req, res) => {
  res.json(await submissions.getMyHistoryForProblem(req.user.id, req.params.slug));
}));

/** GET /api/submissions/recent — public-ish recent activity feed. */
router.get('/recent', optionalAuth, asyncHandler(async (_req, res) => {
  res.json(await submissions.getRecentActivity());
}));

/**
 * GET /api/submissions/:id — polling endpoint for the async submit
 * pipeline. Returns the current row state for the caller's own
 * submissions; 404 if it doesn't exist OR doesn't belong to them
 * (no existence-leakage). The response shape matches the submit POST
 * but without the user's source code.
 */
router.get('/:id', requireAuth, asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Invalid submission id');
  res.json(await submissions.getOneForUser(req.user.id, id));
}));

export default router;
