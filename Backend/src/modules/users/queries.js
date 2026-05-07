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

export const getSiteStats = () =>
  db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM users) AS total_users,
      (SELECT COUNT(DISTINCT user_id) FROM submissions WHERE status = 'ACCEPTED') AS active_solvers
  `).get();

/* ─── leaderboard ───────────────────────────────────────────────────────── */

export const getLeaderboard = () =>
  db.prepare(`
    SELECT
      u.id, u.username, u.full_name, u.avatar_url, u.rating, u.created_at,
      (SELECT COUNT(DISTINCT s.problem_id)
         FROM submissions s
        WHERE s.user_id = u.id AND s.status = 'ACCEPTED') AS solved
    FROM users u
    ORDER BY u.rating DESC, solved DESC, u.id ASC
    LIMIT 100
  `).all();

/* ─── profile (read-only, used by /profile/:username) ───────────────────── */

export const findUserByUsername = (username) =>
  db.prepare(`SELECT * FROM users WHERE username = ?`).get(username);

export const findUserById = (id) =>
  db.prepare(`SELECT * FROM users WHERE id = ?`).get(id);

export const getSubmissionTotalsForUser = (userId) =>
  db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'ACCEPTED' THEN 1 ELSE 0 END) AS accepted
    FROM submissions WHERE user_id = ?
  `).get(userId);

export const getSolvedByDifficulty = (userId) =>
  db.prepare(`
    SELECT p.difficulty, COUNT(DISTINCT s.problem_id) AS solved
    FROM submissions s JOIN problems p ON p.id = s.problem_id
    WHERE s.user_id = ? AND s.status = 'ACCEPTED'
    GROUP BY p.difficulty
  `).all(userId);

export const getTotalsByDifficulty = () =>
  db.prepare(`
    SELECT difficulty, COUNT(*) AS n FROM problems GROUP BY difficulty
  `).all();

export const getRecentSubmissionsBrief = (userId, limit) =>
  db.prepare(`
    SELECT s.id, s.status, s.created_at, p.slug AS problem_slug, p.title AS problem_title, p.difficulty
    FROM submissions s JOIN problems p ON p.id = s.problem_id
    WHERE s.user_id = ?
    ORDER BY s.created_at DESC LIMIT ?
  `).all(userId, limit);

export const getActivityCalendar = (userId) =>
  db.prepare(`
    SELECT date(created_at) AS day, COUNT(*) AS n
    FROM submissions
    WHERE user_id = ? AND date(created_at) >= date('now', '-180 days')
    GROUP BY day ORDER BY day ASC
  `).all(userId);

/* ─── dashboard (read-only) ─────────────────────────────────────────────── */

export const getRecentSubmissionsDetailed = (userId, limit) =>
  db.prepare(`
    SELECT s.id, s.status, s.created_at, s.runtime_ms, s.memory_kb, s.language,
           p.slug AS problem_slug, p.title AS problem_title, p.difficulty
    FROM submissions s JOIN problems p ON p.id = s.problem_id
    WHERE s.user_id = ?
    ORDER BY s.created_at DESC LIMIT ?
  `).all(userId, limit);

export const getRecommendedProblems = (userId, limit) =>
  db.prepare(`
    SELECT p.id, p.slug, p.title, p.difficulty, p.tags
    FROM problems p
    WHERE p.id NOT IN (
      SELECT problem_id FROM submissions
       WHERE user_id = ? AND status = 'ACCEPTED'
    )
    ORDER BY p.id ASC
    LIMIT ?
  `).all(userId, limit);

export const getAcceptedDays = (userId) =>
  db.prepare(`
    SELECT DISTINCT date(created_at) AS day
    FROM submissions
    WHERE user_id = ? AND status = 'ACCEPTED'
    ORDER BY day DESC
  `).all(userId).map(r => r.day);

/* ─── favorites (read-only) ─────────────────────────────────────────────── */

export const getFavoritesForUser = (userId) =>
  db.prepare(`
    SELECT p.id, p.slug, p.title, p.difficulty, p.tags,
           c.slug as category_slug, c.name as category_name
    FROM favorites f
    JOIN problems p ON p.id = f.problem_id
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE f.user_id = ?
    ORDER BY f.created_at DESC
  `).all(userId);

/* ─── profile updates ───────────────────────────────────────────────────── */

export function updateProfileColumns(userId, sets, args) {
  // sets is an array of "col = ?" strings, args matches.
  if (!sets.length) return;
  sets.push(`updated_at = datetime('now')`);
  args.push(userId);
  db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...args);
}

export function bumpRating(userId, delta) {
  db.prepare(`UPDATE users SET rating = rating + ? WHERE id = ?`).run(delta, userId);
}
