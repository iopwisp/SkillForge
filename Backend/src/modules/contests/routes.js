
/**
 * HTTP routes for contests, mounted at `/api/contests`.
 *
 * Per design.md §Endpoint Map:
 *   - Management (create/update/attach/detach/editorial) requires
 *     INSTRUCTOR or ADMIN.
 *   - Delete and finalize-ratings are ADMIN-only.
 *   - All other endpoints require an authenticated user.
 *   - `?unfrozen=true` on standings is parsed here and forwarded; the
 *     service enforces that only ADMIN gets the unfrozen view.
 *
 * Contest submissions return 202 because they go through the shared
 * async judge pipeline (ADR 0013) — the PENDING row is created in this
 * request, the verdict lands later via the worker.
 *
 * Helper handlers for the user-scoped routes (`/api/users/:username/
 * contests` and `/api/users/:username/contest-rating`) are exported at
 * the bottom of the file; they are wired into `app.js` in task 10.1.
 */
import { Router } from 'express';

import { asyncHandler, fromZod, HttpError } from '../../shared/errors.js';
import { userRateLimit } from '../../shared/middleware/rate-limit.js';
import { requireAuth, requireRole, ROLES } from '../auth/middleware.js';
import {
  AttachProblemSchema,
  ContestListQuerySchema,
  ContestSubmissionSchema,
  CreateContestSchema,
  EditorialSchema,
  UpdateContestSchema,
} from './schemas.js';
import * as service from './service.js';

const router = Router();

const requireInstructor = requireRole(ROLES.INSTRUCTOR, ROLES.ADMIN);
const requireAdmin = requireRole(ROLES.ADMIN);
const contestSubmitLimiter = userRateLimit({ windowMs: 60_000, max: 60 });

// Mirror of the Idempotency-Key handling in submissions/routes.js so
// the contest submit endpoint can also collapse network retries.
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._~:-]{8,64}$/;
function readIdempotencyKey(req) {
  const raw = req.get('Idempotency-Key');
  if (!raw) return null;
  if (!IDEMPOTENCY_KEY_PATTERN.test(raw)) {
    throw new HttpError(400, 'Invalid Idempotency-Key (must be URL-safe ASCII, 8–64 chars)');
  }
  return raw;
}

/* ─── list + detail ─────────────────────────────────────────────────────── */

router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const parsed = ContestListQuerySchema.safeParse(req.query);
  if (!parsed.success) throw fromZod(parsed.error);
  res.json(await service.listContests(req.user, parsed.data));
}));

router.get('/:slug', requireAuth, asyncHandler(async (req, res) => {
  res.json(await service.getContest(req.user, req.params.slug));
}));

/* ─── contest CRUD (INSTRUCTOR/ADMIN; delete is ADMIN-only) ─────────────── */

router.post('/', requireInstructor, asyncHandler(async (req, res) => {
  const parsed = CreateContestSchema.safeParse(req.body);
  if (!parsed.success) throw fromZod(parsed.error);
  res.status(201).json(await service.createContest(req.user, parsed.data));
}));

router.put('/:slug', requireInstructor, asyncHandler(async (req, res) => {
  const parsed = UpdateContestSchema.safeParse(req.body);
  if (!parsed.success) throw fromZod(parsed.error);
  res.json(await service.updateContest(req.user, req.params.slug, parsed.data));
}));

router.delete('/:slug', requireAdmin, asyncHandler(async (req, res) => {
  await service.deleteContest(req.user, req.params.slug);
  res.json({ ok: true });
}));

/* ─── problem attachment (INSTRUCTOR/ADMIN, frozen once started) ────────── */

router.post('/:slug/problems', requireInstructor, asyncHandler(async (req, res) => {
  const parsed = AttachProblemSchema.safeParse(req.body);
  if (!parsed.success) throw fromZod(parsed.error);
  res.status(201).json(
    await service.attachProblem(req.user, req.params.slug, parsed.data),
  );
}));

router.delete('/:slug/problems/:letter', requireInstructor, asyncHandler(async (req, res) => {
  await service.detachProblem(req.user, req.params.slug, req.params.letter);
  res.json({ ok: true });
}));

/* ─── registration + participation ──────────────────────────────────────── */

router.post('/:slug/register', requireAuth, asyncHandler(async (req, res) => {
  res.status(201).json(await service.register(req.user, req.params.slug));
}));

router.delete('/:slug/register', requireAuth, asyncHandler(async (req, res) => {
  await service.unregister(req.user, req.params.slug);
  res.json({ ok: true });
}));

router.post('/:slug/participate', requireAuth, asyncHandler(async (req, res) => {
  // `?virtual=true` toggles virtual participation. Anything else (missing,
  // `false`, or unrelated values) means a live participation attempt.
  const virtual = req.query.virtual === 'true';
  res.status(201).json(
    await service.participate(req.user, req.params.slug, { virtual }),
  );
}));

/* ─── contest submissions (async, 202 per ADR 0013) ─────────────────────── */

router.post('/:slug/submissions/:letter', requireAuth, contestSubmitLimiter, asyncHandler(async (req, res) => {
  const parsed = ContestSubmissionSchema.safeParse(req.body);
  if (!parsed.success) throw fromZod(parsed.error);
  res.status(202).json(
    await service.submitInContest(
      req.user, req.params.slug, req.params.letter, parsed.data,
      { idempotencyKey: readIdempotencyKey(req) },
    ),
  );
}));

/* ─── standings ────────────────────────────────────────────────────────── */

router.get('/:slug/standings', requireAuth, asyncHandler(async (req, res) => {
  // `unfrozen=true` is merely a request; the service enforces that only
  // ADMIN gets the unfrozen view, so a STUDENT asking politely still
  // sees the frozen response during the freeze window.
  const unfrozen = req.query.unfrozen === 'true';
  const since = typeof req.query.since === 'string' ? req.query.since : undefined;
  res.json(
    await service.getStandings(req.user, req.params.slug, { unfrozen, since }),
  );
}));

/* ─── editorial ────────────────────────────────────────────────────────── */

router.put('/:slug/editorial', requireInstructor, asyncHandler(async (req, res) => {
  const parsed = EditorialSchema.safeParse(req.body);
  if (!parsed.success) throw fromZod(parsed.error);
  res.json(await service.publishEditorial(req.user, req.params.slug, parsed.data));
}));

router.get('/:slug/editorial', requireAuth, asyncHandler(async (req, res) => {
  res.json(await service.getEditorial(req.user, req.params.slug));
}));

/* ─── rating finalization (ADMIN-only) ─────────────────────────────────── */

router.post('/:slug/finalize-ratings', requireAdmin, asyncHandler(async (req, res) => {
  res.json(await service.finalizeContestRatings(req.params.slug));
}));

export default router;

/* ─── user-scoped helpers (wired in app.js under /api/users) ────────────── */

/**
 * GET /api/users/:username/contests — participation history for a user.
 * The actual route mount lives in `app.js` (task 10.1). This handler is
 * exported here so the contest module stays the sole owner of all
 * contest-reading logic.
 */
export async function getUserContestHistoryHandler(req, res) {
  const result = await service.getUserContestHistory(req.params.username);
  res.json(result);
}

/**
 * GET /api/users/:username/contest-rating — current Glicko-2 rating +
 * history for a user. Paired with `getUserContestHistoryHandler`; same
 * rationale for living here instead of in the users module.
 */
export async function getUserContestRatingHandler(req, res) {
  const result = await service.getContestRating(req.params.username);
  res.json(result);
}
