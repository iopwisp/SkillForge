/**
 * SQL for the exams module.
 *
 * Owns `exams`, `exam_problems`, `exam_attempts`. Like groups/queries.js,
 * this file also holds a handful of read-only "view" queries against
 * other modules' tables:
 *
 *   - `findCourseRefBySlug`     → courses (id + owner for authz)
 *   - `findGroupIdByCourseSlug` → groups  (scope restriction on create)
 *   - `findUserIdByUsername`    → users   (resolve roster usernames)
 *   - `isStudentEnrolled`       → group_members + groups (visibility)
 *   - `solvedProblemsInAttempt` → submissions (on-demand scoring)
 *
 * Writes to other modules still flow through their service.js (ADR 0003).
 */
import { db } from '../../shared/db.js';

/* ─── cross-module read helpers ─────────────────────────────────────────── */

export const findCourseRefBySlug = (slug, executor = db) =>
  executor.maybeOne(
    `SELECT id, owner_id FROM courses WHERE slug = $1`, [slug],
  );

export const findGroupIdByCourseAndSlug = async (courseId, groupSlug, executor = db) => {
  const row = await executor.maybeOne(
    `SELECT id FROM groups WHERE course_id = $1 AND slug = $2`,
    [courseId, groupSlug],
  );
  return row?.id ?? null;
};

export const findUserIdByUsername = async (username, executor = db) => {
  const row = await executor.maybeOne(
    `SELECT id FROM users WHERE username = $1`, [username],
  );
  return row?.id ?? null;
};

/**
 * True iff the user is in at least one group of the given course
 * (general course enrolment), or specifically in the given group
 * when `groupId` is non-null.
 */
export const isStudentEnrolled = async (userId, courseId, groupId = null, executor = db) => {
  if (groupId != null) {
    const row = await executor.maybeOne(
      `SELECT 1 AS one FROM group_members WHERE group_id = $1 AND user_id = $2`,
      [groupId, userId],
    );
    return !!row;
  }
  const row = await executor.maybeOne(`
    SELECT 1 AS one
    FROM group_members gm
    JOIN groups g ON g.id = gm.group_id
    WHERE gm.user_id = $1 AND g.course_id = $2
    LIMIT 1
  `, [userId, courseId]);
  return !!row;
};

/* ─── exams ─────────────────────────────────────────────────────────────── */

export const findExamByCourseAndSlug = (courseId, examSlug, executor = db) =>
  executor.maybeOne(`
    SELECT e.id, e.course_id, e.group_id, e.slug, e.title, e.description,
           e.starts_at, e.ends_at, e.duration_minutes,
           e.created_at, e.updated_at,
           g.slug AS group_slug
    FROM exams e
    LEFT JOIN groups g ON g.id = e.group_id
    WHERE e.course_id = $1 AND e.slug = $2
  `, [courseId, examSlug]);

export const listExamsForCourse = (courseId, executor = db) =>
  executor.many(`
    SELECT e.id, e.slug, e.title, e.description,
           e.starts_at, e.ends_at, e.duration_minutes,
           e.created_at, e.updated_at,
           g.slug AS group_slug,
           (SELECT COUNT(*)::int FROM exam_problems ep WHERE ep.exam_id = e.id) AS problem_count
    FROM exams e
    LEFT JOIN groups g ON g.id = e.group_id
    WHERE e.course_id = $1
    ORDER BY e.starts_at ASC, e.id ASC
  `, [courseId]);

/**
 * Subset of `listExamsForCourse` narrowed to exams a STUDENT can see:
 *   - course-wide exams (group_id IS NULL) iff the student is enrolled
 *     in any group of the course
 *   - per-group exams iff the student is a member of that group
 */
export const listExamsForCourseAndStudent = (courseId, userId, executor = db) =>
  executor.many(`
    SELECT e.id, e.slug, e.title, e.description,
           e.starts_at, e.ends_at, e.duration_minutes,
           e.created_at, e.updated_at,
           g.slug AS group_slug,
           (SELECT COUNT(*)::int FROM exam_problems ep WHERE ep.exam_id = e.id) AS problem_count
    FROM exams e
    LEFT JOIN groups g ON g.id = e.group_id
    WHERE e.course_id = $1
      AND (
        (e.group_id IS NULL AND EXISTS (
          SELECT 1 FROM group_members gm
          JOIN groups gg ON gg.id = gm.group_id
          WHERE gm.user_id = $2 AND gg.course_id = e.course_id
        ))
        OR (e.group_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM group_members gm
          WHERE gm.user_id = $2 AND gm.group_id = e.group_id
        ))
      )
    ORDER BY e.starts_at ASC, e.id ASC
  `, [courseId, userId]);

export async function insertExam(
  { courseId, groupId, slug, title, description, startsAt, endsAt, durationMinutes },
  executor = db,
) {
  return executor.maybeOne(`
    INSERT INTO exams
      (course_id, group_id, slug, title, description, starts_at, ends_at, duration_minutes)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id, course_id, group_id, slug, title, description,
              starts_at, ends_at, duration_minutes, created_at, updated_at
  `, [
    courseId, groupId ?? null, slug, title, description ?? null,
    startsAt, endsAt, durationMinutes,
  ]);
}

export async function updateExam(examId, fields, executor = db) {
  const cols = [];
  const args = [];
  const addCol = (name, value) => {
    cols.push(`${name} = $${args.length + 1}`);
    args.push(value);
  };
  if (fields.title !== undefined)           addCol('title',            fields.title);
  if (fields.description !== undefined)     addCol('description',      fields.description);
  if (fields.startsAt !== undefined)        addCol('starts_at',        fields.startsAt);
  if (fields.endsAt !== undefined)          addCol('ends_at',          fields.endsAt);
  if (fields.durationMinutes !== undefined) addCol('duration_minutes', fields.durationMinutes);
  if (fields.groupId !== undefined)         addCol('group_id',         fields.groupId);
  if (cols.length === 0) return;
  args.push(examId);
  await executor.none(
    `UPDATE exams SET ${cols.join(', ')}, updated_at = NOW() WHERE id = $${args.length}`,
    args,
  );
}

export const deleteExam = (examId, executor = db) =>
  executor.none(`DELETE FROM exams WHERE id = $1`, [examId]);

/* ─── exam_problems ─────────────────────────────────────────────────────── */

export async function attachProblemToExam(
  { examId, problemId, position, points },
  executor = db,
) {
  return executor.maybeOne(`
    INSERT INTO exam_problems (exam_id, problem_id, position, points)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (exam_id, problem_id) DO NOTHING
    RETURNING exam_id, problem_id, position, points
  `, [examId, problemId, position ?? 0, points ?? 1]);
}

export const detachProblemFromExam = (examId, problemId, executor = db) =>
  executor.maybeOne(`
    DELETE FROM exam_problems
    WHERE exam_id = $1 AND problem_id = $2
    RETURNING problem_id
  `, [examId, problemId]);

export const listProblemsForExam = (examId, executor = db) =>
  executor.many(`
    SELECT
      p.id, p.slug, p.title, p.difficulty, p.problem_type, p.tags,
      ep.position, ep.points
    FROM exam_problems ep
    JOIN problems p ON p.id = ep.problem_id
    WHERE ep.exam_id = $1
    ORDER BY ep.position ASC, p.id ASC
  `, [examId]);

/* ─── exam_attempts ─────────────────────────────────────────────────────── */

export const findAttemptByExamAndUser = (examId, userId, executor = db) =>
  executor.maybeOne(`
    SELECT id, exam_id, user_id, started_at, finished_at
    FROM exam_attempts
    WHERE exam_id = $1 AND user_id = $2
  `, [examId, userId]);

export async function insertAttempt({ examId, userId }, executor = db) {
  return executor.maybeOne(`
    INSERT INTO exam_attempts (exam_id, user_id)
    VALUES ($1, $2)
    ON CONFLICT (exam_id, user_id) DO NOTHING
    RETURNING id, exam_id, user_id, started_at, finished_at
  `, [examId, userId]);
}

export const markAttemptFinished = (attemptId, executor = db) =>
  executor.none(
    `UPDATE exam_attempts SET finished_at = NOW() WHERE id = $1 AND finished_at IS NULL`,
    [attemptId],
  );

/**
 * Return { problemId, points, solved } for every problem in the exam,
 * where `solved` is true iff the given attempt has at least one
 * ACCEPTED submission for that problem.
 */
export const solvedProblemsInAttempt = (attemptId, examId, executor = db) =>
  executor.many(`
    SELECT
      ep.problem_id,
      ep.points,
      EXISTS (
        SELECT 1 FROM submissions s
        WHERE s.exam_attempt_id = $1
          AND s.problem_id = ep.problem_id
          AND s.status = 'ACCEPTED'
      ) AS solved
    FROM exam_problems ep
    WHERE ep.exam_id = $2
  `, [attemptId, examId]);

/** All submissions a student made within the given attempt. Ordered oldest-first
 *  so the UI can replay the attempt timeline. */
export const submissionsInAttempt = (attemptId, executor = db) =>
  executor.many(`
    SELECT s.id, s.status, s.language, s.code, s.created_at, s.tests_passed, s.tests_total,
           s.runtime_ms, s.memory_kb, s.output, s.error,
           p.slug AS problem_slug, p.title AS problem_title, p.difficulty
    FROM submissions s
    JOIN problems p ON p.id = s.problem_id
    WHERE s.exam_attempt_id = $1
    ORDER BY s.created_at ASC, s.id ASC
  `, [attemptId]);
