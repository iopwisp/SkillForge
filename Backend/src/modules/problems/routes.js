/**
 * HTTP routes for /api/problems/*.
 */
import { Router } from 'express';

import { asyncHandler, fromZod } from '../../shared/errors.js';
import {
  optionalAuth, requireAuth, requireRole, ROLES,
} from '../auth/middleware.js';
import { CreateProblemSchema, UpdateProblemSchema } from './schemas.js';
import * as problems from './service.js';

const router = Router();
const requireInstructor = requireRole(ROLES.INSTRUCTOR, ROLES.ADMIN);

router.get('/', optionalAuth, asyncHandler(async (req, res) => {
  res.json(await problems.listProblems({
    ...req.query,
    userId: req.user?.id,
  }));
}));

router.post('/', requireInstructor, asyncHandler(async (req, res) => {
  const parsed = CreateProblemSchema.safeParse(req.body);
  if (!parsed.success) throw fromZod(parsed.error);
  res.status(201).json(await problems.createProblem({ ...parsed.data, actor: req.user }));
}));

router.get('/:slug/edit', requireInstructor, asyncHandler(async (req, res) => {
  res.json(await problems.getProblemEditorDetail(req.params.slug));
}));

router.get('/:slug', optionalAuth, asyncHandler(async (req, res) => {
  res.json(await problems.getProblemDetail(req.params.slug, req.user?.id));
}));

router.put('/:slug', requireInstructor, asyncHandler(async (req, res) => {
  const parsed = UpdateProblemSchema.safeParse(req.body);
  if (!parsed.success) throw fromZod(parsed.error);
  res.json(await problems.updateProblem(req.user, req.params.slug, parsed.data));
}));

router.delete('/:slug', requireInstructor, asyncHandler(async (req, res) => {
  await problems.deleteProblem(req.user, req.params.slug);
  res.json({ ok: true });
}));

router.post('/:slug/favorite', requireAuth, asyncHandler(async (req, res) => {
  res.json(await problems.toggleFavorite(req.user.id, req.params.slug));
}));

export default router;
