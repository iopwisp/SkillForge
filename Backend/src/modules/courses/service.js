/**
 * Courses service — CRUD over the `courses` table plus the syllabus
 * link via `course_problems`.
 *
 * Cross-module dependencies (allowed per ADR 0003):
 *   - problems.service.getProblemBySlug — to resolve problem slugs to ids
 *     when attaching/detaching a problem to/from a course.
 *
 * Permissions (per ADR 0007):
 *   - Read: any authenticated user can list/get courses (the route layer
 *     enforces requireAuth).
 *   - Gradebook read: owner of the course OR ADMIN.
 *   - Create: route layer requires INSTRUCTOR or ADMIN before reaching here.
 *   - Mutate (update/delete/attach/detach): owner of the course OR ADMIN.
 *     Enforced by the local `assertCanMutate(actor, course)` helper, NOT
 *     by the route layer, so any future caller (CLI, admin scripts) goes
 *     through the same gate.
 */
import { withTransaction } from '../../shared/db.js';
import { HttpError } from '../../shared/errors.js';
import * as audit from '../audit/service.js';
import * as problems from '../problems/service.js';
import * as q from './queries.js';

/* ─── read ──────────────────────────────────────────────────────────────── */

const STUDENT = 'STUDENT';

/**
 * List courses visible to `actor`:
 *   - STUDENT: only courses they're enrolled in via at least one group.
 *   - INSTRUCTOR / ADMIN: every course.
 * (ADR 0008 §Course-visibility.)
 */
export async function listCourses(actor) {
  const rows = actor.role === STUDENT
    ? await q.listCoursesForStudent(actor.id)
    : await q.listCourses();
  return rows.map(toCourseSummary);
}

/**
 * Return the detailed course page, or 404 if it does not exist OR if
 * the actor is a STUDENT who is not enrolled in any of the course's
 * groups. We return 404 rather than 403 for the "not enrolled" case so
 * the existence of unrelated courses doesn't leak through the auth
 * layer (ADR 0008 §Course-visibility).
 */
export async function getCourse(actor, slug) {
  const c = await q.findCourseBySlug(slug);
  if (!c) throw new HttpError(404, 'Course not found');
  if (actor.role === STUDENT && !(await q.isStudentInCourse(actor.id, c.id))) {
    throw new HttpError(404, 'Course not found');
  }
  const problemsRows = await q.getProblemsForCourse(c.id);
  return {
    ...toCourseSummary({ ...c, problem_count: problemsRows.length }),
    description: c.description,
    problems: problemsRows.map(toCourseProblem),
  };
}

export async function getGradebook(actor, slug) {
  const course = await q.findCourseBySlug(slug);
  if (!course) throw new HttpError(404, 'Course not found');
  assertCanMutate(actor, course, 'view this gradebook');

  const [students, exams, attempts] = await Promise.all([
    q.listEnrolledStudents(course.id),
    q.listGradebookExams(course.id),
    q.listGradebookAttempts(course.id),
  ]);

  return {
    course: {
      ...toCourseSummary(course),
      description: course.description,
      studentCount: students.length,
    },
    exams: exams.map(toGradebookExam),
    rows: buildGradebookRows(students, exams, attempts),
  };
}

export function gradebookToCsv(gradebook) {
  const headers = [
    'username',
    'full_name',
    'groups',
    ...gradebook.exams.map((exam) => exam.slug),
    'total',
  ];

  const lines = [
    headers.map(csvCell).join(','),
    ...gradebook.rows.map((row) => ([
      row.student.username,
      row.student.fullName ?? '',
      row.groups.map((group) => group.slug).join(';'),
      ...row.scores.map(formatGradebookCsvScore),
      `${row.total.earned}/${row.total.total}`,
    ].map(csvCell).join(','))),
  ];

  return `${lines.join('\n')}\n`;
}

/* ─── write ─────────────────────────────────────────────────────────────── */

export async function createCourse(actor, { slug, title, description }) {
  return withTransaction(async (tx) => {
    if (await q.findCourseIdBySlug(slug, tx)) {
      throw new HttpError(409, `A course with slug "${slug}" already exists`);
    }
    await q.insertCourse({ slug, title, description, ownerId: actor.id }, tx);
    await audit.recordEvent(actor, {
      action: 'CREATE',
      entityType: 'COURSE',
      entityKey: slug,
      details: { title },
    }, { db: tx });
    return getCourseInTx(slug, tx);
  });
}

export async function updateCourse(actor, slug, fields) {
  return withTransaction(async (tx) => {
    const course = await q.findCourseBySlug(slug, tx);
    if (!course) throw new HttpError(404, 'Course not found');
    assertCanMutate(actor, course);
    await q.updateCourse(course.id, fields, tx);
    await audit.recordEvent(actor, {
      action: 'UPDATE',
      entityType: 'COURSE',
      entityKey: slug,
      details: { fields: Object.keys(fields) },
    }, { db: tx });
    return getCourseInTx(slug, tx);
  });
}

export async function deleteCourse(actor, slug) {
  return withTransaction(async (tx) => {
    const course = await q.findCourseBySlug(slug, tx);
    if (!course) throw new HttpError(404, 'Course not found');
    assertCanMutate(actor, course);
    await audit.recordEvent(actor, {
      action: 'DELETE',
      entityType: 'COURSE',
      entityKey: slug,
      details: {},
    }, { db: tx });
    await q.deleteCourse(course.id, tx);
  });
}

export async function attachProblem(actor, slug, { problemSlug, position }) {
  const course = await q.findCourseBySlug(slug);
  if (!course) throw new HttpError(404, 'Course not found');
  assertCanMutate(actor, course);

  const problem = await problems.getProblemBySlug(problemSlug);
  if (!problem) throw new HttpError(404, `Problem "${problemSlug}" not found`);

  const inserted = await q.attachProblem({
    courseId: course.id, problemId: problem.id, position,
  });
  if (!inserted) {
    throw new HttpError(409, `Problem "${problemSlug}" is already in course "${slug}"`);
  }
  await audit.recordEvent(actor, {
    action: 'ATTACH',
    entityType: 'COURSE_PROBLEM',
    entityKey: `${slug}:${problemSlug}`,
    details: { courseSlug: slug, problemSlug, position: inserted.position },
  });
  return {
    courseSlug: slug,
    problem: { slug: problem.slug, title: problem.title, difficulty: problem.difficulty },
    position: inserted.position,
    addedAt: inserted.added_at,
  };
}

export async function detachProblem(actor, slug, problemSlug) {
  const course = await q.findCourseBySlug(slug);
  if (!course) throw new HttpError(404, 'Course not found');
  assertCanMutate(actor, course);

  const problem = await problems.getProblemBySlug(problemSlug);
  if (!problem) throw new HttpError(404, `Problem "${problemSlug}" not found`);

  const removed = await q.detachProblem(course.id, problem.id);
  if (!removed) {
    throw new HttpError(404, `Problem "${problemSlug}" is not in course "${slug}"`);
  }
  await audit.recordEvent(actor, {
    action: 'DETACH',
    entityType: 'COURSE_PROBLEM',
    entityKey: `${slug}:${problemSlug}`,
    details: { courseSlug: slug, problemSlug },
  });
}

/* ─── live dashboard ────────────────────────────────────────────────────── */

/**
 * Live instructor dashboard — real-time student × problem progress matrix.
 * Read model over submissions + group_members + course_problems.
 * Same access pattern as getGradebook (owner-or-ADMIN).
 */
export async function getLiveDashboard(actor, slug, { examSlug, groupSlug, stuckMinutes = 5 } = {}) {
  const course = await q.findCourseBySlug(slug);
  if (!course) throw new HttpError(404, 'Course not found');
  assertCanMutate(actor, course, 'view live dashboard');

  // Validate stuckMinutes
  const threshold = Number(stuckMinutes);
  if (!Number.isInteger(threshold) || threshold < 1) {
    throw new HttpError(400, 'stuckMinutes must be a positive integer');
  }

  // Validate exam filter if provided
  let exam = null;
  if (examSlug) {
    exam = await q.findExamInCourse(course.id, examSlug);
    if (!exam) throw new HttpError(404, 'Exam not found in this course');
  }

  // Validate group filter if provided
  let group = null;
  if (groupSlug) {
    group = await q.findGroupInCourse(course.id, groupSlug);
    if (!group) throw new HttpError(404, 'Group not found in this course');
  }

  // Execute queries in parallel
  const [students, problems] = await Promise.all([
    q.listLiveStudents(course.id, groupSlug),
    q.listLiveProblems(course.id, examSlug),
  ]);

  const studentIds = students.map((s) => s.id);
  const problemSlugs = problems.map((p) => p.slug);

  const rawMatrix = await q.getLiveSubmissionMatrix(course.id, {
    problemSlugs, studentIds, examSlug,
  });

  // Build matrix map and derive statuses
  const now = Date.now();
  const thresholdMs = threshold * 60 * 1000;
  const matrix = {};
  const summary = { totalStudents: students.length, solved: 0, attempting: 0, stuck: 0, idle: 0 };

  // Index raw results
  const rawMap = new Map();
  for (const row of rawMatrix) {
    rawMap.set(`${row.user_id}:${row.problem_slug}`, row);
  }

  // Compute statuses
  for (const student of students) {
    for (const problem of problems) {
      const key = `${student.id}:${problem.slug}`;
      const row = rawMap.get(key);
      const cell = deriveCell(row, now, thresholdMs);
      matrix[key] = cell;
      summary[cell.status.toLowerCase()]++;
    }
  }

  return {
    course: { slug: course.slug, title: course.title },
    exam: exam ? { slug: exam.slug, title: exam.title } : null,
    group: group ? { slug: group.slug, title: group.title } : null,
    students: students.map((s) => ({
      id: s.id,
      username: s.username,
      fullName: s.full_name,
      groupSlug: s.group_slug,
    })),
    problems: problems.map((p) => ({
      slug: p.slug,
      title: p.title,
      position: p.position,
    })),
    matrix,
    summary,
  };
}

/** Pure status derivation — exported for testing. */
export function deriveCell(row, nowMs, thresholdMs) {
  if (!row || row.attempts === 0) {
    return { status: 'IDLE', lastSubmitAt: null, attempts: 0 };
  }
  if (row.has_accepted) {
    return { status: 'SOLVED', lastSubmitAt: row.last_submit_at, attempts: row.attempts };
  }
  const lastMs = new Date(row.last_submit_at).getTime();
  const elapsed = nowMs - lastMs;
  if (elapsed < thresholdMs) {
    return { status: 'ATTEMPTING', lastSubmitAt: row.last_submit_at, attempts: row.attempts };
  }
  return { status: 'STUCK', lastSubmitAt: row.last_submit_at, attempts: row.attempts };
}

/* ─── helpers ───────────────────────────────────────────────────────────── */

/**
 * Owner-or-ADMIN gate for any mutation on a specific course. Throws 403.
 * Routes have already enforced "must be INSTRUCTOR or ADMIN" by the time
 * we get here; this helper handles the "owner-vs-everyone-else" half.
 */
function assertCanMutate(actor, course, action = 'modify this course') {
  if (actor.role === 'ADMIN') return;
  if (course.owner_id === actor.id) return;
  throw new HttpError(403, `Only the course owner or an ADMIN can ${action}`);
}

async function getCourseInTx(slug, tx) {
  const c = await q.findCourseBySlug(slug, tx);
  const problemsRows = await q.getProblemsForCourse(c.id, tx);
  return {
    ...toCourseSummary({ ...c, problem_count: problemsRows.length }),
    description: c.description,
    problems: problemsRows.map(toCourseProblem),
  };
}

function toCourseSummary(r) {
  return {
    slug: r.slug,
    title: r.title,
    owner: {
      id: r.owner_id,
      username: r.owner_username,
      fullName: r.owner_full_name,
    },
    problemCount: r.problem_count ?? 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toCourseProblem(r) {
  return {
    slug: r.slug,
    title: r.title,
    difficulty: r.difficulty,
    problemType: r.problem_type,
    tags: r.tags ? r.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
    position: r.position,
    addedAt: r.added_at,
  };
}

function toGradebookExam(r) {
  return {
    slug: r.slug,
    title: r.title,
    groupSlug: r.group_slug ?? null,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    durationMinutes: r.duration_minutes,
    problemCount: r.problem_count,
    totalPoints: r.total_points,
  };
}

function buildGradebookRows(students, exams, attempts) {
  const attemptsByKey = new Map(
    attempts.map((attempt) => [`${attempt.user_id}:${attempt.exam_id}`, attempt]),
  );

  return students.map((student) => {
    const groups = toStudentGroups(student);
    const groupSlugs = new Set(groups.map((group) => group.slug));

    let totalEarned = 0;
    let totalPossible = 0;
    let applicableExamCount = 0;
    let attemptedExamCount = 0;

    const scores = exams.map((exam) => {
      const applicable = exam.group_slug == null || groupSlugs.has(exam.group_slug);
      if (!applicable) {
        return {
          examSlug: exam.slug,
          applicable: false,
          attempted: false,
          startedAt: null,
          finishedAt: null,
          score: null,
        };
      }

      applicableExamCount += 1;
      totalPossible += exam.total_points;

      const attempt = attemptsByKey.get(`${student.user_id}:${exam.id}`);
      if (attempt) totalEarned += attempt.earned_points;
      if (attempt) attemptedExamCount += 1;

      return {
        examSlug: exam.slug,
        applicable: true,
        attempted: !!attempt,
        startedAt: attempt?.started_at ?? null,
        finishedAt: attempt?.finished_at ?? null,
        score: {
          earned: attempt?.earned_points ?? 0,
          total: exam.total_points,
          solved: attempt?.solved_count ?? 0,
          outOf: exam.problem_count,
        },
      };
    });

    return {
      student: {
        id: student.user_id,
        username: student.username,
        fullName: student.full_name,
        avatarUrl: student.avatar_url,
      },
      groups,
      scores,
      total: {
        earned: totalEarned,
        total: totalPossible,
        applicableExams: applicableExamCount,
        attemptedExams: attemptedExamCount,
      },
    };
  });
}

function toStudentGroups(student) {
  const slugs = Array.isArray(student.group_slugs) ? student.group_slugs : [];
  const titles = Array.isArray(student.group_titles) ? student.group_titles : [];
  return slugs.map((slug, index) => ({
    slug,
    title: titles[index] ?? null,
  }));
}

function formatGradebookCsvScore(scoreEntry) {
  if (!scoreEntry.applicable || !scoreEntry.score) return '';
  return `${scoreEntry.score.earned}/${scoreEntry.score.total}`;
}

function csvCell(value) {
  const text = String(value ?? '');
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}
