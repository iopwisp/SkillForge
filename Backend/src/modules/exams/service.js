/**
 * Exams service — scheduled timed assessments on top of courses + groups.
 *
 * Cross-module dependencies (allowed per ADR 0003):
 *   - problems.service.getProblemBySlug — resolve slugs on attach
 *   - submissions.service.submit        — reuse the judge + persistence
 *                                         pipeline for exam submissions
 *
 * Permissions & timing live here (ADR 0009 §Permissions):
 *   - Mutation endpoints: route layer requires INSTRUCTOR/ADMIN, this
 *     service adds owner-or-ADMIN via `assertCanManageCourse`.
 *   - "Exam frozen once started" is enforced by `assertNotStarted` on
 *     PUT + attach + detach.
 *   - Read endpoints narrow for STUDENT via `isStudentEnrolled` and the
 *     dedicated `listExamsForCourseAndStudent` query.
 *   - startAttempt / submitInAttempt / finishAttempt enforce the in-window
 *     + in-scope + personal-deadline invariants.
 */
import { db, withTransaction } from '../../shared/db.js';
import { HttpError } from '../../shared/errors.js';
import * as audit from '../audit/service.js';
import * as submissions from '../submissions/service.js';
import { submissionToJson } from '../submissions/service.js';
import * as q from './queries.js';

const ADMIN = 'ADMIN';
const STUDENT = 'STUDENT';

/* ─── read ──────────────────────────────────────────────────────────────── */

export async function listExams(actor, courseSlug) {
  const course = await resolveCourseOr404(courseSlug);
  const rows = actor.role === STUDENT
    ? await q.listExamsForCourseAndStudent(course.id, actor.id)
    : await q.listExamsForCourse(course.id);
  return rows.map(toExamSummary);
}

export async function getExam(actor, courseSlug, examSlug) {
  const { course, exam } = await resolveExamOr404(courseSlug, examSlug);
  await assertStudentCanSee(actor, course, exam);
  const problems = await q.listProblemsForExam(exam.id);
  return {
    ...toExamSummary({ ...exam, problem_count: problems.length }),
    description: exam.description,
    problems: problems.map(toExamProblem),
  };
}

/* ─── mutation (create / update / delete) ───────────────────────────────── */

export async function createExam(actor, courseSlug, payload) {
  const course = await resolveCourseOr404(courseSlug);
  assertCanManageCourse(actor, course);

  const groupId = await resolveGroupId(course.id, payload.groupSlug);

  return withTransaction(async (tx) => {
    const existing = await q.findExamByCourseAndSlug(course.id, payload.slug, tx);
    if (existing) {
      throw new HttpError(409, `An exam with slug "${payload.slug}" already exists in this course`);
    }
    const inserted = await q.insertExam({
      courseId: course.id,
      groupId,
      slug: payload.slug,
      title: payload.title,
      description: payload.description,
      startsAt: payload.startsAt,
      endsAt: payload.endsAt,
      durationMinutes: payload.durationMinutes,
    }, tx);
    await audit.recordEvent(actor, {
      action: 'CREATE',
      entityType: 'EXAM',
      entityKey: `${courseSlug}:${payload.slug}`,
      details: { courseSlug, examSlug: payload.slug, groupSlug: payload.groupSlug ?? null },
    }, { db: tx });
    return toExamDetail(inserted, [], await groupSlugFromId(groupId, tx));
  });
}

export async function updateExam(actor, courseSlug, examSlug, fields) {
  const { course, exam } = await resolveExamOr404(courseSlug, examSlug);
  assertCanManageCourse(actor, course);
  assertNotStarted(exam, 'edited');

  return withTransaction(async (tx) => {
    const groupId = fields.groupSlug !== undefined
      ? await resolveGroupId(course.id, fields.groupSlug, tx)
      : undefined;

    const patch = { ...fields };
    if (patch.groupSlug !== undefined) {
      patch.groupId = groupId;
      delete patch.groupSlug;
    }
    await q.updateExam(exam.id, patch, tx);
    await audit.recordEvent(actor, {
      action: 'UPDATE',
      entityType: 'EXAM',
      entityKey: `${courseSlug}:${examSlug}`,
      details: { courseSlug, examSlug, fields: Object.keys(fields) },
    }, { db: tx });

    const updated = await q.findExamByCourseAndSlug(course.id, examSlug, tx);
    const problems = await q.listProblemsForExam(exam.id, tx);
    return toExamDetail(updated, problems, updated.group_slug);
  });
}

export async function deleteExam(actor, courseSlug, examSlug) {
  const { course, exam } = await resolveExamOr404(courseSlug, examSlug);
  assertCanManageCourse(actor, course);
  await audit.recordEvent(actor, {
    action: 'DELETE',
    entityType: 'EXAM',
    entityKey: `${courseSlug}:${examSlug}`,
    details: { courseSlug, examSlug },
  });
  await q.deleteExam(exam.id);
}

/* ─── attach / detach problems (frozen once started) ────────────────────── */

export async function attachProblemToExam(actor, courseSlug, examSlug, payload) {
  const { course, exam } = await resolveExamOr404(courseSlug, examSlug);
  assertCanManageCourse(actor, course);
  assertNotStarted(exam, 'edited');

  const problem = await getProblemOr404(payload.problemSlug);
  const inserted = await q.attachProblemToExam({
    examId: exam.id,
    problemId: problem.id,
    position: payload.position,
    points: payload.points,
  });
  if (!inserted) {
    throw new HttpError(409, `Problem "${payload.problemSlug}" is already in this exam`);
  }
  await audit.recordEvent(actor, {
    action: 'ATTACH',
    entityType: 'EXAM_PROBLEM',
    entityKey: `${courseSlug}:${examSlug}:${payload.problemSlug}`,
    details: {
      courseSlug,
      examSlug,
      problemSlug: payload.problemSlug,
      position: inserted.position,
      points: inserted.points,
    },
  });
  return {
    examSlug,
    problem: { slug: problem.slug, title: problem.title, difficulty: problem.difficulty },
    position: inserted.position,
    points: inserted.points,
  };
}

export async function detachProblemFromExam(actor, courseSlug, examSlug, problemSlug) {
  const { course, exam } = await resolveExamOr404(courseSlug, examSlug);
  assertCanManageCourse(actor, course);
  assertNotStarted(exam, 'edited');

  const problem = await getProblemOr404(problemSlug);
  const removed = await q.detachProblemFromExam(exam.id, problem.id);
  if (!removed) {
    throw new HttpError(404, `Problem "${problemSlug}" is not in this exam`);
  }
  await audit.recordEvent(actor, {
    action: 'DETACH',
    entityType: 'EXAM_PROBLEM',
    entityKey: `${courseSlug}:${examSlug}:${problemSlug}`,
    details: { courseSlug, examSlug, problemSlug },
  });
}

/* ─── attempts ──────────────────────────────────────────────────────────── */

/** Student starts their one attempt for this exam. */
export async function startAttempt(actor, courseSlug, examSlug) {
  const { course, exam } = await resolveExamOr404(courseSlug, examSlug);

  // Any authenticated user can try to start, but they must actually
  // be in scope — students in the right group (or generally enrolled
  // if exam.group_id is null). Instructors don't get an attempt row.
  if (actor.role !== STUDENT) {
    throw new HttpError(403, 'Only students can start an exam attempt');
  }
  if (!(await q.isStudentEnrolled(actor.id, course.id, exam.group_id))) {
    throw new HttpError(404, 'Exam not found');
  }

  const now = Date.now();
  if (now < new Date(exam.starts_at).getTime()) {
    throw new HttpError(400, 'Exam has not started yet');
  }
  if (now >= new Date(exam.ends_at).getTime()) {
    throw new HttpError(400, 'Exam window has closed');
  }

  const attempt = await q.insertAttempt({ examId: exam.id, userId: actor.id });
  if (!attempt) {
    throw new HttpError(409, 'You have already started an attempt for this exam');
  }
  return describeAttempt(exam, attempt, /* includeSubmissions */ false);
}

/** Student submits code inside their active attempt for one of the
 *  exam's problems. Runs the regular judge pipeline via the submissions
 *  service, which persists the row with `exam_attempt_id` set. */
export async function submitInAttempt(
  actor, courseSlug, examSlug, problemSlug, { code, language },
) {
  const { course, exam } = await resolveExamOr404(courseSlug, examSlug);
  if (actor.role !== STUDENT) {
    throw new HttpError(403, 'Only students can submit inside an exam attempt');
  }
  if (!(await q.isStudentEnrolled(actor.id, course.id, exam.group_id))) {
    throw new HttpError(404, 'Exam not found');
  }

  const attempt = await q.findAttemptByExamAndUser(exam.id, actor.id);
  if (!attempt) {
    throw new HttpError(400, 'You have not started this exam yet');
  }
  if (attempt.finished_at) {
    throw new HttpError(400, 'Your attempt is already finished');
  }
  const deadline = personalDeadline(exam, attempt);
  if (Date.now() >= deadline.getTime()) {
    throw new HttpError(400, 'Your time is up');
  }

  // Problem must belong to the exam; otherwise 404 so the student can't
  // use the exam endpoint to submit arbitrary problems.
  const examProblems = await q.listProblemsForExam(exam.id);
  if (!examProblems.some((p) => p.slug === problemSlug)) {
    throw new HttpError(404, `Problem "${problemSlug}" is not part of this exam`);
  }

  return submissions.submit({
    user: actor,
    slug: problemSlug,
    code,
    language,
    examAttemptId: attempt.id,
  });
}

export async function finishAttempt(actor, courseSlug, examSlug) {
  const { exam } = await resolveExamOr404(courseSlug, examSlug);
  const attempt = await q.findAttemptByExamAndUser(exam.id, actor.id);
  if (!attempt) throw new HttpError(404, 'No attempt to finish');
  if (attempt.finished_at) return describeAttempt(exam, attempt, true);
  await q.markAttemptFinished(attempt.id);
  const fresh = await q.findAttemptByExamAndUser(exam.id, actor.id);
  return describeAttempt(exam, fresh, true);
}

/** View *my* attempt (the student's own).  */
export async function getMyAttempt(actor, courseSlug, examSlug) {
  const { course, exam } = await resolveExamOr404(courseSlug, examSlug);
  await assertStudentCanSee(actor, course, exam);
  const attempt = await q.findAttemptByExamAndUser(exam.id, actor.id);
  if (!attempt) throw new HttpError(404, 'No attempt started yet');
  return describeAttempt(exam, attempt, true);
}

/** View someone else's attempt — owner-or-ADMIN only. */
export async function getAttemptForUser(actor, courseSlug, examSlug, username) {
  const { course, exam } = await resolveExamOr404(courseSlug, examSlug);
  assertCanManageCourse(actor, course);

  const userId = await q.findUserIdByUsername(username);
  if (!userId) throw new HttpError(404, `User "${username}" not found`);
  const attempt = await q.findAttemptByExamAndUser(exam.id, userId);
  if (!attempt) throw new HttpError(404, `"${username}" has not started this exam`);
  return {
    ...(await describeAttempt(exam, attempt, true)),
    user: { id: userId, username },
  };
}

/* ─── internals ─────────────────────────────────────────────────────────── */

async function resolveCourseOr404(courseSlug) {
  const course = await q.findCourseRefBySlug(courseSlug);
  if (!course) throw new HttpError(404, 'Course not found');
  return course;
}

async function resolveExamOr404(courseSlug, examSlug) {
  const course = await resolveCourseOr404(courseSlug);
  const exam = await q.findExamByCourseAndSlug(course.id, examSlug);
  if (!exam) throw new HttpError(404, 'Exam not found');
  return { course, exam };
}

async function resolveGroupId(courseId, groupSlug, executor) {
  if (groupSlug == null) return null;
  const id = await q.findGroupIdByCourseAndSlug(courseId, groupSlug, executor);
  if (id == null) throw new HttpError(404, `Group "${groupSlug}" not found in this course`);
  return id;
}

async function groupSlugFromId(groupId, executor) {
  if (groupId == null) return null;
  const row = await executor.maybeOne(`SELECT slug FROM groups WHERE id = $1`, [groupId]);
  return row?.slug ?? null;
}

async function getProblemOr404(slug) {
  // Read-only view query on problems — same pragma as groups/queries.js
  // `findCourseRefBySlug`. Pulling problems.service in here is possible
  // but would widen the cross-module surface of exams for no gain.
  const row = await db.maybeOne(
    `SELECT id, slug, title, difficulty FROM problems WHERE slug = $1`, [slug],
  );
  if (!row) throw new HttpError(404, `Problem "${slug}" not found`);
  return row;
}

function assertCanManageCourse(actor, course) {
  if (actor.role === ADMIN) return;
  if (course.owner_id === actor.id) return;
  throw new HttpError(403, 'Only the course owner or an ADMIN can manage this exam');
}

function assertNotStarted(exam, verb) {
  if (Date.now() >= new Date(exam.starts_at).getTime()) {
    throw new HttpError(400, `Exam has already started and cannot be ${verb}`);
  }
}

async function assertStudentCanSee(actor, course, exam) {
  if (actor.role !== STUDENT) return;
  const ok = await q.isStudentEnrolled(actor.id, course.id, exam.group_id);
  if (!ok) throw new HttpError(404, 'Exam not found');
}

function personalDeadline(exam, attempt) {
  const started = new Date(attempt.started_at).getTime();
  const byDuration = started + exam.duration_minutes * 60 * 1000;
  const byWindow = new Date(exam.ends_at).getTime();
  return new Date(Math.min(byDuration, byWindow));
}

async function describeAttempt(exam, attempt, includeSubmissions) {
  const [score, subs] = await Promise.all([
    scoreAttempt(attempt.id, exam.id),
    includeSubmissions ? q.submissionsInAttempt(attempt.id) : Promise.resolve([]),
  ]);
  const now = Date.now();
  const deadline = personalDeadline(exam, attempt);
  const finishedAt = attempt.finished_at
    ? new Date(attempt.finished_at)
    : (now >= deadline.getTime() ? deadline : null);

  return {
    examSlug: exam.slug,
    startedAt: attempt.started_at,
    finishedAt,
    deadline,
    timeLeftMs: finishedAt ? 0 : Math.max(0, deadline.getTime() - now),
    score,
    submissions: subs.map((r) => submissionToJson(r, { includeCode: false })),
  };
}

async function scoreAttempt(attemptId, examId) {
  const rows = await q.solvedProblemsInAttempt(attemptId, examId);
  const totalPoints = rows.reduce((sum, r) => sum + r.points, 0);
  const earnedPoints = rows.reduce((sum, r) => sum + (r.solved ? r.points : 0), 0);
  return {
    earned: earnedPoints,
    total: totalPoints,
    solved: rows.filter((r) => r.solved).length,
    outOf: rows.length,
  };
}

/* ─── serialisers ───────────────────────────────────────────────────────── */

function toExamSummary(r) {
  return {
    slug: r.slug,
    title: r.title,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    durationMinutes: r.duration_minutes,
    groupSlug: r.group_slug ?? null,
    problemCount: r.problem_count ?? 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toExamDetail(r, problems, groupSlug) {
  return {
    ...toExamSummary({ ...r, group_slug: groupSlug, problem_count: problems.length }),
    description: r.description ?? null,
    problems: problems.map(toExamProblem),
  };
}

function toExamProblem(r) {
  return {
    slug: r.slug,
    title: r.title,
    difficulty: r.difficulty,
    problemType: r.problem_type,
    tags: r.tags ? r.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
    position: r.position,
    points: r.points,
  };
}
