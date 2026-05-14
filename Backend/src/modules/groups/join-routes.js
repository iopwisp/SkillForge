/**
 * Top-level invite-code self-enrolment route.
 *
 * Mounted at `/api/groups/join` (flat, NOT nested under a course) because
 * the whole point of an invite code is that the student doesn't know the
 * course slug yet — they just have the code. The route is authenticated
 * but NOT role-gated: any logged-in user may redeem a code. Owner /
 * admin checks live on the sibling invite-management endpoints.
 */
import { Router } from 'express';

import { asyncHandler, fromZod } from '../../shared/errors.js';
import { requireAuth } from '../auth/middleware.js';
import { JoinByInviteCodeSchema } from './schemas.js';
import * as groups from './service.js';

const router = Router();

router.post('/', requireAuth, asyncHandler(async (req, res) => {
  const parsed = JoinByInviteCodeSchema.safeParse(req.body);
  if (!parsed.success) throw fromZod(parsed.error);
  res.json(await groups.joinByInviteCode(req.user, parsed.data.code));
}));

export default router;
