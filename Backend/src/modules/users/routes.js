/**
 * HTTP routes for /api/users/*.
 */
import { Router } from 'express';

import { asyncHandler, fromZod, HttpError } from '../../shared/errors.js';
import { ChangePasswordSchema } from '../auth/schemas.js';
import { optionalAuth, requireAuth, requireRole, ROLES } from '../auth/middleware.js';
import { UpdateProfileSchema, UpdateRoleSchema } from './schemas.js';
import * as users from './service.js';

const router = Router();

router.get('/stats', asyncHandler(async (_req, res) => {
  res.json(await users.getSiteStats());
}));

router.get('/leaderboard', asyncHandler(async (_req, res) => {
  res.json(await users.getLeaderboard());
}));

router.get('/profile/:username', optionalAuth, asyncHandler(async (req, res) => {
  res.json(await users.getPublicProfile(req.params.username));
}));

router.get('/me/dashboard', requireAuth, asyncHandler(async (req, res) => {
  res.json(await users.getDashboard(req.user));
}));

router.get('/me/favorites', requireAuth, asyncHandler(async (req, res) => {
  res.json(await users.getFavorites(req.user.id));
}));

router.patch('/me', requireAuth, asyncHandler(async (req, res) => {
  const parsed = UpdateProfileSchema.safeParse(req.body);
  if (!parsed.success) throw fromZod(parsed.error);
  res.json(await users.updateProfile(req.user, parsed.data));
}));

router.post('/me/password', requireAuth, asyncHandler(async (req, res) => {
  const parsed = ChangePasswordSchema.safeParse(req.body);
  if (!parsed.success) throw fromZod(parsed.error);
  await users.changePassword(req.user, parsed.data);
  res.json({ ok: true });
}));

/**
 * Admin-only: change another user's role. Implements ADR 0006 §promotion.
 * The "cannot demote the last ADMIN" safeguard lives in users.service.setRole
 * so it covers both this HTTP path and any future CLI/script that calls the
 * service directly.
 */
router.put('/:id/role', requireRole(ROLES.ADMIN), asyncHandler(async (req, res) => {
  const parsed = UpdateRoleSchema.safeParse(req.body);
  if (!parsed.success) throw fromZod(parsed.error);
  const targetId = parseInt(req.params.id, 10);
  if (!Number.isInteger(targetId) || targetId <= 0) {
    throw new HttpError(400, 'Invalid user id');
  }
  res.json(await users.setRole(req.user, targetId, parsed.data.role));
}));

export default router;
