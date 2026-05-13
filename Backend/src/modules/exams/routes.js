/**
 * HTTP routes for exams, nested under /api/courses/:courseSlug/exams.
 *
 * Mounted in app.js with `mergeParams: true` so `:courseSlug` from the
 * parent path is visible to each handler. All routes require an auth'd
 * user; mutation endpoints additionally require INSTRUCTOR/ADMIN, with
 * owner-or-ADMIN enforced in the service (ADR 0009 §Permissions).
 */
import { Router } from 'express';

import { asyncHandler, fromZod } from '../../shared/errors.js';
import { requireAuth, requireRole, ROLES } from '../auth/middleware.js';
import {
  AttachExamProblemSchema, CreateExamSchema, SubmitInAttemptSchema, UpdateExamSchema,
} from './schemas.js';
import * as exams from './service.js';

const router = Router({ mergeParams: true });

const requireInstructor = requireRole(ROLES.INSTRUCTOR, ROLES.ADMIN);

/* ─── list + detail ─────────────────────────────────────────────────────── */

router.get('/', requireAuth, asyncHandler(async (req, res) => {
  res.json(await exams.listExams(req.user, req.params.courseSlug));
}));

router.get('/:examSlug', requireAuth, asyncHandler(async (req, res) => {
  res.json(await exams.getExam(req.user, req.params.courseSlug, req.params.examSlug));
}));

/* ─── CRUD (INSTRUCTOR/ADMIN; owner-or-ADMIN inside service) ─────────────── */

router.post('/', requireInstructor, asyncHandler(async (req, res) => {
  const parsed = CreateExamSchema.safeParse(req.body);
  if (!parsed.success) throw fromZod(parsed.error);
  res.status(201).json(
    await exams.createExam(req.user, req.params.courseSlug, parsed.data),
  );
}));

router.put('/:examSlug', requireInstructor, asyncHandler(async (req, res) => {
  const parsed = UpdateExamSchema.safeParse(req.body);
  if (!parsed.success) throw fromZod(parsed.error);
  res.json(
    await exams.updateExam(
      req.user, req.params.courseSlug, req.params.examSlug, parsed.data,
    ),
  );
}));

router.delete('/:examSlug', requireInstructor, asyncHandler(async (req, res) => {
  await exams.deleteExam(req.user, req.params.courseSlug, req.params.examSlug);
  res.json({ ok: true });
}));

router.post('/:examSlug/problems', requireInstructor, asyncHandler(async (req, res) => {
  const parsed = AttachExamProblemSchema.safeParse(req.body);
  if (!parsed.success) throw fromZod(parsed.error);
  res.status(201).json(
    await exams.attachProblemToExam(
      req.user, req.params.courseSlug, req.params.examSlug, parsed.data,
    ),
  );
}));

router.delete('/:examSlug/problems/:problemSlug', requireInstructor, asyncHandler(async (req, res) => {
  await exams.detachProblemFromExam(
    req.user, req.params.courseSlug, req.params.examSlug, req.params.problemSlug,
  );
  res.json({ ok: true });
}));

/* ─── attempts (student-facing) ─────────────────────────────────────────── */

router.post('/:examSlug/attempts', requireAuth, asyncHandler(async (req, res) => {
  res.status(201).json(
    await exams.startAttempt(req.user, req.params.courseSlug, req.params.examSlug),
  );
}));

router.post(
  '/:examSlug/attempts/current/submissions/:problemSlug',
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = SubmitInAttemptSchema.safeParse(req.body);
    if (!parsed.success) throw fromZod(parsed.error);
    // 202: submission goes through the same async judge pipeline as
    // regular submits (PENDING → worker finalize). ADR 0013.
    res.status(202).json(
      await exams.submitInAttempt(
        req.user,
        req.params.courseSlug,
        req.params.examSlug,
        req.params.problemSlug,
        parsed.data,
      ),
    );
  }),
);

router.post('/:examSlug/attempts/current/finish', requireAuth, asyncHandler(async (req, res) => {
  res.json(
    await exams.finishAttempt(req.user, req.params.courseSlug, req.params.examSlug),
  );
}));

router.get('/:examSlug/attempts/me', requireAuth, asyncHandler(async (req, res) => {
  res.json(
    await exams.getMyAttempt(req.user, req.params.courseSlug, req.params.examSlug),
  );
}));

router.get('/:examSlug/attempts/:username', requireInstructor, asyncHandler(async (req, res) => {
  res.json(
    await exams.getAttemptForUser(
      req.user, req.params.courseSlug, req.params.examSlug, req.params.username,
    ),
  );
}));

export default router;
