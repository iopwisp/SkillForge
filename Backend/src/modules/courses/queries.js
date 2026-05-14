/**
 * SQL for the courses module.
 *
 * Owns reads/writes for the `courses` and `course_problems` tables. Joins
 * with `users` (for the owner avatar/username on detail) and `problems`
 * (for the syllabus list on detail) are read-only and stay inside this
 * module per the same "view query" pragma as users/queries.js.
 *
 * Extra read-only "view" queries JOIN through `groups`, `group_members`,
 * `exams`, `exam_problems`, `exam_attempts`, and `submissions` to power
 * both the STUDENT visibility narrowing from ADR 0008 and the course
 * gradebook from ADR 0010. They don't import anything from those modules —
 * just SELECT across tables.
 *
 * Cross-module writes are NOT allowed here. Anything that mutates the
 * `users` or `problems` tables goes through that module's service.js.
 */
import { db } from '../../shared/db.js';

/* ─── courses ───────────────────────────────────────────────────────────── */

export const listCourses = (executor = db) =>
  executor.many(`
    SELECT
      c.id, c.slug, c.title, c.description,
      c.owner_id, c.created_at, c.updated_at,
      u.username AS owner_username, u.full_name AS owner_full_name,
      (SELECT COUNT(*)::int FROM course_problems cp WHERE cp.course_id = c.id) AS problem_count
    FROM courses c
    JOIN users u ON u.id = c.owner_id
    ORDER BY c.created_at DESC, c.id DESC
  `);

/**
 * Subset of `listCourses` restricted to courses the given user is
 * enrolled in via at least one `group_members` row. Powers
 * `GET /api/courses` for STUDENTs (ADR 0008 §Course-visibility).
 */
export const listCoursesForStudent = (userId, executor = db) =>
  executor.many(`
    SELECT DISTINCT
      c.id, c.slug, c.title, c.description,
      c.owner_id, c.created_at, c.updated_at,
      u.username AS owner_username, u.full_name AS owner_full_name,
      (SELECT COUNT(*)::int FROM course_problems cp WHERE cp.course_id = c.id) AS problem_count
    FROM courses c
    JOIN users u ON u.id = c.owner_id
    JOIN groups g ON g.course_id = c.id
    JOIN group_members gm ON gm.group_id = g.id
    WHERE gm.user_id = $1
    ORDER BY c.created_at DESC, c.id DESC
  `, [userId]);

export const isStudentInCourse = async (userId, courseId, executor = db) => {
  const row = await executor.maybeOne(`
    SELECT 1 AS one
    FROM group_members gm
    JOIN groups g ON g.id = gm.group_id
    WHERE gm.user_id = $1 AND g.course_id = $2
    LIMIT 1
  `, [userId, courseId]);
  return !!row;
};

export const findCourseBySlug = (slug, executor = db) =>
  executor.maybeOne(`
    SELECT
      c.id, c.slug, c.title, c.description,
      c.owner_id, c.created_at, c.updated_at,
      u.username AS owner_username, u.full_name AS owner_full_name
    FROM courses c
    JOIN users u ON u.id = c.owner_id
    WHERE c.slug = $1
  `, [slug]);

export const findCourseIdBySlug = async (slug, executor = db) => {
  const row = await executor.maybeOne(
    `SELECT id FROM courses WHERE slug = $1`, [slug],
  );
  return row?.id ?? null;
};

export async function insertCourse(
  { slug, title, description, ownerId },
  executor = db,
) {
  return executor.maybeOne(`
    INSERT INTO courses (slug, title, description, owner_id)
    VALUES ($1, $2, $3, $4)
    RETURNING id, slug, title, description, owner_id, created_at, updated_at
  `, [slug, title, description ?? null, ownerId]);
}

/**
 * Apply a partial update to a course. Caller passes the columns it wants
 * changed via `fields` (e.g. `{ title: '...', description: '...' }`).
 * Touches `updated_at` automatically.
 */
export async function updateCourse(courseId, fields, executor = db) {
  const cols = [];
  const args = [];
  if (fields.title !== undefined)       { cols.push('title');       args.push(fields.title); }
  if (fields.description !== undefined) { cols.push('description'); args.push(fields.description); }
  if (cols.length === 0) return; // caller guarantees at least one field — schema guard
  const setSql = cols.map((c, i) => `${c} = $${i + 1}`).join(', ');
  args.push(courseId);
  await executor.none(
    `UPDATE courses SET ${setSql}, updated_at = NOW() WHERE id = $${args.length}`,
    args,
  );
}

export const deleteCourse = (courseId, executor = db) =>
  executor.none(`DELETE FROM courses WHERE id = $1`, [courseId]);

/* ─── course_problems ───────────────────────────────────────────────────── */

/**
 * Attach a problem to a course. Returns the inserted row, or `null` if
 * the link already exists (ON CONFLICT DO NOTHING). The service maps the
 * null case to a 409 so the API contract is "create-only".
 */
export async function attachProblem(
  { courseId, problemId, position },
  executor = db,
) {
  return executor.maybeOne(`
    INSERT INTO course_problems (course_id, problem_id, position)
    VALUES ($1, $2, $3)
    ON CONFLICT (course_id, problem_id) DO NOTHING
    RETURNING course_id, problem_id, position, added_at
  `, [courseId, problemId, position ?? 0]);
}

export const detachProblem = (courseId, problemId, executor = db) =>
  executor.maybeOne(`
    DELETE FROM course_problems
    WHERE course_id = $1 AND problem_id = $2
    RETURNING problem_id
  `, [courseId, problemId]);

/**
 * Canonical sort: position ASC, added_at ASC, problem_id ASC. Frontend
 * mirrors this order so the syllabus list never flickers between renders.
 */
export const getProblemsForCourse = (courseId, executor = db) =>
  executor.many(`
    SELECT
      p.id, p.slug, p.title, p.difficulty, p.problem_type, p.tags,
      cp.position, cp.added_at
    FROM course_problems cp
    JOIN problems p ON p.id = cp.problem_id
    WHERE cp.course_id = $1
    ORDER BY cp.position ASC, cp.added_at ASC, p.id ASC
  `, [courseId]);

/* ─── gradebook (read-only joins across groups + exams + submissions) ────── */

/**
 * Every enrolled student in the course, one row per user, with their
 * group memberships aggregated in slug order so the service can both
 * render them and decide which group-scoped exams apply.
 */
export const listEnrolledStudents = (courseId, executor = db) =>
  executor.many(`
    SELECT
      u.id AS user_id, u.username, u.full_name, u.avatar_url,
      ARRAY_AGG(g.slug ORDER BY g.slug) AS group_slugs,
      ARRAY_AGG(g.title ORDER BY g.slug) AS group_titles
    FROM group_members gm
    JOIN groups g ON g.id = gm.group_id
    JOIN users u ON u.id = gm.user_id
    WHERE g.course_id = $1
    GROUP BY u.id, u.username, u.full_name, u.avatar_url
    ORDER BY u.username ASC, u.id ASC
  `, [courseId]);

/**
 * Canonical exam list for the gradebook. `group_slug = NULL` means a
 * course-wide exam; otherwise only students in that group should receive
 * a score column value for it.
 */
export const listGradebookExams = (courseId, executor = db) =>
  executor.many(`
    SELECT
      e.id, e.slug, e.title, e.starts_at, e.ends_at, e.duration_minutes,
      g.slug AS group_slug,
      COUNT(ep.problem_id)::int AS problem_count,
      COALESCE(SUM(ep.points), 0)::int AS total_points
    FROM exams e
    LEFT JOIN groups g ON g.id = e.group_id
    LEFT JOIN exam_problems ep ON ep.exam_id = e.id
    WHERE e.course_id = $1
    GROUP BY e.id, g.slug
    ORDER BY e.starts_at ASC, e.id ASC
  `, [courseId]);

/**
 * One row per started attempt in the course with the on-demand score
 * collapsed into earned points + solved problem count.
 */
export const listGradebookAttempts = (courseId, executor = db) =>
  executor.many(`
    SELECT
      ea.user_id, ea.exam_id, ea.started_at, ea.finished_at,
      COALESCE(SUM(CASE WHEN accepted.problem_id IS NOT NULL THEN ep.points ELSE 0 END), 0)::int AS earned_points,
      COALESCE(COUNT(accepted.problem_id), 0)::int AS solved_count
    FROM exam_attempts ea
    JOIN exams e ON e.id = ea.exam_id
    LEFT JOIN exam_problems ep ON ep.exam_id = e.id
    LEFT JOIN LATERAL (
      SELECT s.problem_id
      FROM submissions s
      WHERE s.exam_attempt_id = ea.id
        AND s.problem_id = ep.problem_id
        AND s.status = 'ACCEPTED'
      LIMIT 1
    ) accepted ON TRUE
    WHERE e.course_id = $1
    GROUP BY ea.id, ea.user_id, ea.exam_id, ea.started_at, ea.finished_at
    ORDER BY ea.user_id ASC, ea.exam_id ASC
  `, [courseId]);

/* ─── Live dashboard (read-only view queries) ────────────────────────────── */

/**
 * Enrolled students for the live dashboard, optionally filtered by group.
 * Read-only view query joining `group_members`, `groups`, and `users`.
 */
export async function listLiveStudents(courseId, groupSlug, executor = db) {
  const params = [courseId];
  let groupFilter = '';
  if (groupSlug) {
    groupFilter = ' AND g.slug = $2';
    params.push(groupSlug);
  }
  return executor.many(`
    SELECT DISTINCT u.id, u.username, u.full_name, g.slug AS group_slug
    FROM group_members gm
    JOIN groups g ON g.id = gm.group_id AND g.course_id = $1${groupFilter}
    JOIN users u ON u.id = gm.user_id
    ORDER BY g.slug, u.username
  `, params);
}

/**
 * Problems for the live dashboard — course problems or exam problems.
 * Read-only view query joining `exam_problems`/`course_problems` with `problems`.
 */
export async function listLiveProblems(courseId, examSlug, executor = db) {
  if (examSlug) {
    return executor.many(`
      SELECT p.slug, p.title, ep.position
      FROM exam_problems ep
      JOIN exams e ON e.id = ep.exam_id AND e.course_id = $1 AND e.slug = $2
      JOIN problems p ON p.id = ep.problem_id
      ORDER BY ep.position
    `, [courseId, examSlug]);
  }
  return executor.many(`
    SELECT p.slug, p.title, cp.position
    FROM course_problems cp
    JOIN problems p ON p.id = cp.problem_id
    WHERE cp.course_id = $1
    ORDER BY cp.position
  `, [courseId]);
}

/**
 * Aggregated submission matrix for the live dashboard.
 * Returns (user_id, problem_slug, attempts, last_submit_at, has_accepted)
 * grouped per student×problem. Read-only view query.
 */
export async function getLiveSubmissionMatrix(courseId, { problemSlugs, studentIds, examSlug }, executor = db) {
  if (!studentIds.length || !problemSlugs.length) return [];

  const params = [courseId, studentIds, problemSlugs];
  // In practice mode, exclude exam and contest submissions.
  // In exam mode, include all submissions for those problems (no filter).
  const examFilter = examSlug
    ? ''
    : ' AND s.exam_attempt_id IS NULL AND s.contest_participation_id IS NULL';

  return executor.many(`
    SELECT
      s.user_id,
      p.slug AS problem_slug,
      COUNT(*)::int AS attempts,
      MAX(s.created_at) AS last_submit_at,
      BOOL_OR(s.status = 'ACCEPTED') AS has_accepted
    FROM submissions s
    JOIN problems p ON p.id = s.problem_id
    WHERE s.user_id = ANY($2)
      AND p.slug = ANY($3)
      AND EXISTS (
        SELECT 1 FROM course_problems cp
        WHERE cp.course_id = $1 AND cp.problem_id = p.id
      )${examFilter}
    GROUP BY s.user_id, p.slug
  `, params);
}

/**
 * Find an exam within a course by slug. Read-only view query.
 */
export const findExamInCourse = (courseId, examSlug, executor = db) =>
  executor.maybeOne(`
    SELECT id, slug, title FROM exams WHERE course_id = $1 AND slug = $2
  `, [courseId, examSlug]);

/**
 * Find a group within a course by slug. Read-only view query.
 */
export const findGroupInCourse = (courseId, groupSlug, executor = db) =>
  executor.maybeOne(`
    SELECT id, slug, title FROM groups WHERE course_id = $1 AND slug = $2
  `, [courseId, groupSlug]);

/* ─── browse (public catalog shape, any authenticated user) ─────────────── */

/**
 * Read-only view query backing the "Browse all" tab on `/courses`.
 *
 * Returns every course in the installation with a limited shape —
 * title/description/owner/groupCount/studentCount — and explicitly
 * does NOT include the problems list. STUDENTs still can't see the
 * syllabus of courses they're not enrolled in (ADR 0008); this query
 * is designed as a discoverability surface so students can find an
 * instructor and ask for an invite code.
 *
 * `studentCount` counts distinct users that are a member of at least
 * one group in the course.
 */
export const listAllCoursesForBrowse = (executor = db) =>
  executor.many(`
    SELECT
      c.id, c.slug, c.title, c.description,
      c.owner_id, c.created_at, c.updated_at,
      u.username AS owner_username, u.full_name AS owner_full_name,
      (SELECT COUNT(*)::int FROM groups g WHERE g.course_id = c.id) AS group_count,
      (
        SELECT COUNT(DISTINCT gm.user_id)::int
        FROM groups g
        JOIN group_members gm ON gm.group_id = g.id
        WHERE g.course_id = c.id
      ) AS student_count
    FROM courses c
    JOIN users u ON u.id = c.owner_id
    ORDER BY c.created_at DESC, c.id DESC
  `);
