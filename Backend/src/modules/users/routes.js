/**
 * HTTP routes for /api/users/*.
 */
import { Router } from 'express';

import { fromZod } from '../../shared/errors.js';
import { ChangePasswordSchema } from '../auth/schemas.js';
import { optionalAuth, requireAuth } from '../auth/middleware.js';
import { UpdateProfileSchema } from './schemas.js';
import * as users from './service.js';

const router = Router();

router.get('/stats', (_req, res) => {
  res.json(users.getSiteStats());
});

router.get('/leaderboard', (_req, res) => {
  res.json(users.getLeaderboard());
});

router.get('/profile/:username', optionalAuth, (req, res) => {
  res.json(users.getPublicProfile(req.params.username));
});

router.get('/me/dashboard', requireAuth, (req, res) => {
  res.json(users.getDashboard(req.user));
});

router.get('/me/favorites', requireAuth, (req, res) => {
  res.json(users.getFavorites(req.user.id));
});

router.patch('/me', requireAuth, (req, res) => {
  const parsed = UpdateProfileSchema.safeParse(req.body);
  if (!parsed.success) throw fromZod(parsed.error);
  res.json(users.updateProfile(req.user, parsed.data));
});

router.post('/me/password', requireAuth, (req, res) => {
  const parsed = ChangePasswordSchema.safeParse(req.body);
  if (!parsed.success) throw fromZod(parsed.error);
  users.changePassword(req.user, parsed.data);
  res.json({ ok: true });
});

export default router;
