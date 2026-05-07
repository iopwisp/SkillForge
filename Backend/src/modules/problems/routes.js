/**
 * HTTP routes for /api/problems/*.
 */
import { Router } from 'express';

import { optionalAuth, requireAuth } from '../auth/middleware.js';
import * as problems from './service.js';

const router = Router();

router.get('/', optionalAuth, (req, res) => {
  res.json(problems.listProblems({
    ...req.query,
    userId: req.user?.id,
  }));
});

router.get('/:slug', optionalAuth, (req, res) => {
  res.json(problems.getProblemDetail(req.params.slug, req.user?.id));
});

router.post('/:slug/favorite', requireAuth, (req, res) => {
  res.json(problems.toggleFavorite(req.user.id, req.params.slug));
});

export default router;
