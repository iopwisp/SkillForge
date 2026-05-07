/**
 * SQL for the problems module.
 *
 * Owns: problems, favorites (toggle from problem context), and the
 * read-only JOINs against submissions/categories used to compute the
 * "solved/attempted" flags on the list and detail views.
 *
 * The users module also reads `favorites` for the dashboard (`/me/favorites`).
 * That tiny duplication is acceptable; we'd promote favorites to its own
 * module only if the logic gets non-trivial.
 */
import { db } from '../../shared/db.js';

export function listProblems({ where, args, userId, limit, offset }) {
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const totalRow = db.prepare(`
    SELECT COUNT(*) as n
    FROM problems p
    LEFT JOIN categories c ON c.id = p.category_id
    ${whereSql}
  `).get(...args);

  const rows = db.prepare(`
    SELECT
      p.id, p.slug, p.title, p.difficulty, p.problem_type, p.tags, p.is_premium,
      p.total_submissions, p.accepted_submissions, p.created_at,
      c.slug as category_slug, c.name as category_name,
      EXISTS(SELECT 1 FROM submissions s
              WHERE s.user_id = ? AND s.problem_id = p.id AND s.status = 'ACCEPTED') as solved,
      EXISTS(SELECT 1 FROM submissions s
              WHERE s.user_id = ? AND s.problem_id = p.id) as attempted,
      EXISTS(SELECT 1 FROM favorites f
              WHERE f.user_id = ? AND f.problem_id = p.id) as favorited
    FROM problems p
    LEFT JOIN categories c ON c.id = p.category_id
    ${whereSql}
    ORDER BY p.id ASC
    LIMIT ? OFFSET ?
  `).all(userId, userId, userId, ...args, limit, offset);

  return { rows, total: totalRow.n };
}

export const findProblemBySlug = (slug) =>
  db.prepare(`
    SELECT p.*, c.slug as category_slug, c.name as category_name
    FROM problems p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.slug = ?
  `).get(slug);

export const findProblemIdBySlug = (slug) =>
  db.prepare(`SELECT id FROM problems WHERE slug = ?`).get(slug);

export const userHasSolvedProblem = (userId, problemId) =>
  !!db.prepare(`SELECT 1 FROM submissions
                 WHERE user_id = ? AND problem_id = ? AND status = 'ACCEPTED'`)
    .get(userId, problemId);

export const userHasAttemptedProblem = (userId, problemId) =>
  !!db.prepare(`SELECT 1 FROM submissions WHERE user_id = ? AND problem_id = ?`)
    .get(userId, problemId);

export const userHasFavorited = (userId, problemId) =>
  !!db.prepare(`SELECT 1 FROM favorites WHERE user_id = ? AND problem_id = ?`)
    .get(userId, problemId);

export function addFavorite(userId, problemId) {
  db.prepare(`INSERT INTO favorites (user_id, problem_id) VALUES (?, ?)`)
    .run(userId, problemId);
}

export function removeFavorite(userId, problemId) {
  db.prepare(`DELETE FROM favorites WHERE user_id = ? AND problem_id = ?`)
    .run(userId, problemId);
}

/* ─── counters (called from submissions service) ────────────────────────── */

export function incrementTotalSubmissions(problemId) {
  db.prepare(`UPDATE problems SET total_submissions = total_submissions + 1 WHERE id = ?`)
    .run(problemId);
}

export function incrementAcceptedSubmissions(problemId) {
  db.prepare(`UPDATE problems SET accepted_submissions = accepted_submissions + 1 WHERE id = ?`)
    .run(problemId);
}
