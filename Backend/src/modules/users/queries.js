/**
 * SQL for the users module.
 *
 * NOTE: Several queries here join submissions/problems/favorites/categories
 * for dashboards and profile pages. We allow these JOINs as read-only "view"
 * queries inside the users module (analogous to a dashboard read-model).
 * This is a pragmatic compromise: keeping perfectly tenant-isolated services
 * would require multiple round-trips for each dashboard. When we move to
 * Postgres (ADR 0002), these can become materialized views or a dedicated
 * read-model module.
 */
import { db } from '../../shared/db.js';

/* ─── stats ─────────────────────────────────────────────────────────────── */

export const getSiteStats = (executor = db) =>
  executor.maybeOne(`
    SELECT
      (SELECT COUNT(*)::int FROM users) AS total_users,
      (SELECT COUNT(DISTINCT user_id)::int FROM submissions WHERE status = 'ACCEPTED') AS active_solvers
  `);

/* ─── leaderboard ───────────────────────────────────────────────────────── */

export const getLeaderboard = (executor = db) =>
  executor.many(`
    SELECT
      u.id, u.username, u.full_name, u.avatar_url, u.rating, u.created_at,
      (
        SELECT COUNT(DISTINCT s.problem_id)::int
        FROM submissions s
        WHERE s.user_id = u.id AND s.status = 'ACCEPTED'
      ) AS solved
    FROM users u
    ORDER BY u.rating DESC, solved DESC, u.id ASC
    LIMIT 100
  `);

/* ─── profile (read-only, used by /profile/:username) ───────────────────── */

export const findUserByUsername = (username, executor = db) =>
  executor.maybeOne(`SELECT * FROM users WHERE username = $1`, [username]);

export const findUserById = (id, executor = db) =>
  executor.maybeOne(`SELECT * FROM users WHERE id = $1`, [id]);

export const getSubmissionTotalsForUser = (userId, executor = db) =>
  executor.maybeOne(`
    SELECT
      COUNT(*)::int AS total,
      COALESCE(SUM(CASE WHEN status = 'ACCEPTED' THEN 1 ELSE 0 END), 0)::int AS accepted
    FROM submissions
    WHERE user_id = $1
  `, [userId]);

export const getSolvedByDifficulty = (userId, executor = db) =>
  executor.many(`
    SELECT p.difficulty, COUNT(DISTINCT s.problem_id)::int AS solved
    FROM submissions s
    JOIN problems p ON p.id = s.problem_id
    WHERE s.user_id = $1 AND s.status = 'ACCEPTED'
    GROUP BY p.difficulty
  `, [userId]);

export const getTotalsByDifficulty = (executor = db) =>
  executor.many(`
    SELECT difficulty, COUNT(*)::int AS n
    FROM problems
    GROUP BY difficulty
  `);

export const getRecentSubmissionsBrief = (userId, limit, executor = db) =>
  executor.many(`
    SELECT s.id, s.status, s.created_at, p.slug AS problem_slug, p.title AS problem_title, p.difficulty
    FROM submissions s
    JOIN problems p ON p.id = s.problem_id
    WHERE s.user_id = $1
    ORDER BY s.created_at DESC
    LIMIT $2
  `, [userId, limit]);

export const getActivityCalendar = (userId, executor = db) =>
  executor.many(`
    SELECT created_at::date::text AS day, COUNT(*)::int AS n
    FROM submissions
    WHERE user_id = $1 AND created_at::date >= CURRENT_DATE - 180
    GROUP BY day
    ORDER BY day ASC
  `, [userId]);

/* ─── dashboard (read-only) ─────────────────────────────────────────────── */

export const getRecentSubmissionsDetailed = (userId, limit, executor = db) =>
  executor.many(`
    SELECT s.id, s.status, s.created_at, s.runtime_ms, s.memory_kb, s.language,
           p.slug AS problem_slug, p.title AS problem_title, p.difficulty
    FROM submissions s
    JOIN problems p ON p.id = s.problem_id
    WHERE s.user_id = $1
    ORDER BY s.created_at DESC
    LIMIT $2
  `, [userId, limit]);

export const getRecommendedProblems = (userId, limit, executor = db) =>
  executor.many(`
    SELECT p.id, p.slug, p.title, p.difficulty, p.tags
    FROM problems p
    WHERE p.id NOT IN (
      SELECT problem_id
      FROM submissions
      WHERE user_id = $1 AND status = 'ACCEPTED'
    )
    ORDER BY p.id ASC
    LIMIT $2
  `, [userId, limit]);

export const getAcceptedDays = async (userId, executor = db) =>
  (await executor.many(`
    SELECT DISTINCT created_at::date::text AS day
    FROM submissions
    WHERE user_id = $1 AND status = 'ACCEPTED'
    ORDER BY day DESC
  `, [userId])).map((row) => row.day);

/* ─── favorites (read-only) ─────────────────────────────────────────────── */

export const getFavoritesForUser = (userId, executor = db) =>
  executor.many(`
    SELECT p.id, p.slug, p.title, p.difficulty, p.tags,
           c.slug AS category_slug, c.name AS category_name
    FROM favorites f
    JOIN problems p ON p.id = f.problem_id
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE f.user_id = $1
    ORDER BY f.created_at DESC
  `, [userId]);

/* ─── profile updates ───────────────────────────────────────────────────── */

export function updateProfileColumns(userId, updates, executor = db) {
  if (!updates.length) return Promise.resolve();

  const assignments = updates.map((update, index) => `${update.column} = $${index + 1}`);
  assignments.push('updated_at = NOW()');

  const values = updates.map((update) => update.value);
  values.push(userId);

  return executor.none(
    `UPDATE users SET ${assignments.join(', ')} WHERE id = $${values.length}`,
    values,
  );
}

export function bumpRating(userId, delta, executor = db) {
  return executor.none(`UPDATE users SET rating = rating + $1 WHERE id = $2`, [delta, userId]);
}

/* ─── role management (ADR 0006) ────────────────────────────────────────── */

export function updateRole(userId, role, executor = db) {
  return executor.none(
    `UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2`,
    [role, userId],
  );
}

/** Count of users currently holding the ADMIN role. Used by the
 *  "cannot demote the last ADMIN" safeguard in users.service.setRole. */
export const countAdmins = async (executor = db) => {
  const row = await executor.maybeOne(
    `SELECT COUNT(*)::int AS n FROM users WHERE role = 'ADMIN'`,
  );
  return row?.n ?? 0;
};
