/**
 * HTTP routes for groups, nested under /api/courses/:courseSlug/groups.
 *
 * The router is mounted in `app.js` with `mergeParams: true` so that
 * `req.params.courseSlug` (from the parent mount path) is visible to
 * every handler in this file. See ADR 0008 §URL-shape.
 *
 * Routes:
 *   GET    /                                    — list groups (role-narrowed)
 *   GET    /:groupSlug                          — one group + members
 *   POST   /                                    — create group (owner/admin)
 *   PUT    /:groupSlug                          — rename group (owner/admin)
 *   DELETE /:groupSlug                          — delete group (owner/admin)
 *   GET    /:groupSlug/members                  — list members (role-narrowed)
 *   POST   /:groupSlug/members                  — add by username (owner/admin)
 *   DELETE /:groupSlug/members/:username        — remove member  (owner/admin)
 *   GET    /:groupSlug/invite                   — read invite code (owner/admin)
 *   POST   /:groupSlug/invite                   — generate/regenerate (owner/admin)
 *   DELETE /:groupSlug/invite                   — disable invite code (owner/admin)
 */
import { Router } from 'express';

import { asyncHandler, fromZod } from '../../shared/errors.js';
import { requireAuth, requireRole, ROLES } from '../auth/middleware.js';
import {
  AddMemberSchema, CreateGroupSchema, UpdateGroupSchema,
} from './schemas.js';
import * as groups from './service.js';

const router = Router({ mergeParams: true });

const requireInstructor = requireRole(ROLES.INSTRUCTOR, ROLES.ADMIN);

/* ─── read ──────────────────────────────────────────────────────────────── */

router.get('/', requireAuth, asyncHandler(async (req, res) => {
  res.json(await groups.listGroups(req.user, req.params.courseSlug));
}));

router.get('/:groupSlug', requireAuth, asyncHandler(async (req, res) => {
  res.json(await groups.getGroup(req.user, req.params.courseSlug, req.params.groupSlug));
}));

router.get('/:groupSlug/members', requireAuth, asyncHandler(async (req, res) => {
  res.json(await groups.listMembers(req.user, req.params.courseSlug, req.params.groupSlug));
}));

/* ─── mutate (INSTRUCTOR/ADMIN — owner-or-ADMIN enforced in service) ────── */

router.post('/', requireInstructor, asyncHandler(async (req, res) => {
  const parsed = CreateGroupSchema.safeParse(req.body);
  if (!parsed.success) throw fromZod(parsed.error);
  res.status(201).json(
    await groups.createGroup(req.user, req.params.courseSlug, parsed.data),
  );
}));

router.put('/:groupSlug', requireInstructor, asyncHandler(async (req, res) => {
  const parsed = UpdateGroupSchema.safeParse(req.body);
  if (!parsed.success) throw fromZod(parsed.error);
  res.json(
    await groups.updateGroup(req.user, req.params.courseSlug, req.params.groupSlug, parsed.data),
  );
}));

router.delete('/:groupSlug', requireInstructor, asyncHandler(async (req, res) => {
  await groups.deleteGroup(req.user, req.params.courseSlug, req.params.groupSlug);
  res.json({ ok: true });
}));

router.post('/:groupSlug/members', requireInstructor, asyncHandler(async (req, res) => {
  const parsed = AddMemberSchema.safeParse(req.body);
  if (!parsed.success) throw fromZod(parsed.error);
  res.status(201).json(
    await groups.addMember(req.user, req.params.courseSlug, req.params.groupSlug, parsed.data),
  );
}));

router.delete('/:groupSlug/members/:username', requireInstructor, asyncHandler(async (req, res) => {
  await groups.removeMember(
    req.user, req.params.courseSlug, req.params.groupSlug, req.params.username,
  );
  res.json({ ok: true });
}));

/* ─── invite codes (self-enrolment, owner/ADMIN-managed) ────────────────── */

router.get('/:groupSlug/invite', requireInstructor, asyncHandler(async (req, res) => {
  res.json(
    await groups.getInvite(req.user, req.params.courseSlug, req.params.groupSlug),
  );
}));

router.post('/:groupSlug/invite', requireInstructor, asyncHandler(async (req, res) => {
  res.status(201).json(
    await groups.generateInvite(req.user, req.params.courseSlug, req.params.groupSlug),
  );
}));

router.delete('/:groupSlug/invite', requireInstructor, asyncHandler(async (req, res) => {
  res.json(
    await groups.disableInvite(req.user, req.params.courseSlug, req.params.groupSlug),
  );
}));

export default router;
