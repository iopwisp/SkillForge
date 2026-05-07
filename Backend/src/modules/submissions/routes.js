/**
 * HTTP routes for /api/submissions/*.
 */
import { Router } from 'express';

import { fromZod } from '../../shared/errors.js';
import { optionalAuth, requireAuth } from '../auth/middleware.js';
import { SubmitSchema } from './schemas.js';
import * as submissions from './service.js';

const router = Router();

/** POST /api/submissions/:slug — submit code for a problem. */
router.post('/:slug', requireAuth, (req, res) => {
  const parsed = SubmitSchema.safeParse(req.body);
  if (!parsed.success) throw fromZod(parsed.error);
  const result = submissions.submit({
    user: req.user,
    slug: req.params.slug,
    code: parsed.data.code,
    language: parsed.data.language,
  });
  res.status(201).json(result);
});

/** POST /api/submissions/:slug/run — run sample only, do NOT persist. */
router.post('/:slug/run', requireAuth, (req, res) => {
  const parsed = SubmitSchema.safeParse(req.body);
  if (!parsed.success) throw fromZod(parsed.error);
  res.json(submissions.run({
    slug: req.params.slug,
    code: parsed.data.code,
    language: parsed.data.language,
  }));
});

/** GET /api/submissions/me — current user's submissions across all problems. */
router.get('/me', requireAuth, (req, res) => {
  res.json(submissions.getMyHistory(req.user.id));
});

/** GET /api/submissions/problem/:slug — current user's submissions for a problem. */
router.get('/problem/:slug', requireAuth, (req, res) => {
  res.json(submissions.getMyHistoryForProblem(req.user.id, req.params.slug));
});

/** GET /api/submissions/recent — public-ish recent activity feed. */
router.get('/recent', optionalAuth, (_req, res) => {
  res.json(submissions.getRecentActivity());
});

export default router;
