/**
 * HTTP routes for /api/courses/*.
 *
 * Read endpoints sit behind `requireAuth`; create/update/delete sit behind
 * `requireRole(INSTRUCTOR, ADMIN)`. The owner-vs-admin half of the
 * mutation gate lives in `courses.service` so any future caller goes
 * through the same check (per ADR 0007).
 */
import { Router } from 'express';

import { asyncHandler, fromZod } from '../../shared/errors.js';
import { requireAuth, requireRole, ROLES } from '../auth/middleware.js';
import {
  AttachProblemSchema, CreateCourseSchema, UpdateCourseSchema,
} from './schemas.js';
import * as courses from './service.js';

const router = Router();
const requireInstructor = requireRole(ROLES.INSTRUCTOR, ROLES.ADMIN);

/* ─── read ──────────────────────────────────────────────────────────────── */

router.get('/', requireAuth, asyncHandler(async (req, res) => {
  res.json(await courses.listCourses(req.user));
}));

// Browse catalog: every course in the installation with a limited
// shape (no problems list) for any authenticated user. Mounted BEFORE
// the `/:slug` catch-all so Express matches the literal path first.
router.get('/public', requireAuth, asyncHandler(async (_req, res) => {
  res.json(await courses.browseCourses());
}));

router.get('/:slug', requireAuth, asyncHandler(async (req, res) => {
  res.json(await courses.getCourse(req.user, req.params.slug));
}));

// Live instructor dashboard — real-time progress matrix
router.get('/:slug/live', requireInstructor, asyncHandler(async (req, res) => {
  const { examSlug, groupSlug, stuckMinutes } = req.query;
  res.json(await courses.getLiveDashboard(req.user, req.params.slug, {
    examSlug: examSlug || undefined,
    groupSlug: groupSlug || undefined,
    stuckMinutes: stuckMinutes ? Number(stuckMinutes) : undefined,
  }));
}));

router.get('/:slug/gradebook', requireInstructor, asyncHandler(async (req, res) => {
  res.json(await courses.getGradebook(req.user, req.params.slug));
}));

router.get('/:slug/gradebook.csv', requireInstructor, asyncHandler(async (req, res) => {
  const gradebook = await courses.getGradebook(req.user, req.params.slug);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.slug}-gradebook.csv"`);
  res.send(courses.gradebookToCsv(gradebook));
}));

/* ─── write (INSTRUCTOR / ADMIN; owner-or-ADMIN inside service) ─────────── */

router.post('/', requireInstructor, asyncHandler(async (req, res) => {
  const parsed = CreateCourseSchema.safeParse(req.body);
  if (!parsed.success) throw fromZod(parsed.error);
  res.status(201).json(await courses.createCourse(req.user, parsed.data));
}));

router.put('/:slug', requireInstructor, asyncHandler(async (req, res) => {
  const parsed = UpdateCourseSchema.safeParse(req.body);
  if (!parsed.success) throw fromZod(parsed.error);
  res.json(await courses.updateCourse(req.user, req.params.slug, parsed.data));
}));

router.delete('/:slug', requireInstructor, asyncHandler(async (req, res) => {
  await courses.deleteCourse(req.user, req.params.slug);
  res.json({ ok: true });
}));

router.post('/:slug/problems', requireInstructor, asyncHandler(async (req, res) => {
  const parsed = AttachProblemSchema.safeParse(req.body);
  if (!parsed.success) throw fromZod(parsed.error);
  res.status(201).json(await courses.attachProblem(req.user, req.params.slug, parsed.data));
}));

router.delete('/:slug/problems/:problemSlug', requireInstructor, asyncHandler(async (req, res) => {
  await courses.detachProblem(req.user, req.params.slug, req.params.problemSlug);
  res.json({ ok: true });
}));

export default router;
