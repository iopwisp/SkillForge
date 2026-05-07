/**
 * SQL for the submissions module.
 *
 * Owns all reads/writes to the `submissions` table. Cross-table reads
 * (joins with users + problems for the activity feed and per-user history)
 * are read-only and acceptable in this module.
 *
 * Counter updates on `problems` and rating updates on `users` are NOT done
 * here — those go through `problems.service.recordSubmission` and
 * `users.service.bumpRating` respectively (ADR 0003).
 */
import { db } from '../../shared/db.js';

export function insertSubmission({
  userId, problemId, language, code, status,
  runtimeMs, memoryKb, testsPassed, testsTotal,
  output, error, beats,
}) {
  return db.prepare(`
    INSERT INTO submissions
      (user_id, problem_id, language, code, status,
       runtime_ms, memory_kb, tests_passed, tests_total,
       output, error, beats_pct)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId, problemId, language, code, status,
    runtimeMs, memoryKb, testsPassed, testsTotal,
    output, error, beats
  );
}

export const countAcceptedForUserProblem = (userId, problemId) =>
  db.prepare(`
    SELECT COUNT(*) AS n
    FROM submissions
    WHERE user_id = ? AND problem_id = ? AND status = 'ACCEPTED'
  `).get(userId, problemId).n;

/* ─── history (per-user) ────────────────────────────────────────────────── */

export const getMySubmissions = (userId, limit) =>
  db.prepare(`
    SELECT s.*, p.slug AS problem_slug, p.title AS problem_title, p.difficulty
    FROM submissions s
    JOIN problems p ON p.id = s.problem_id
    WHERE s.user_id = ?
    ORDER BY s.created_at DESC
    LIMIT ?
  `).all(userId, limit);

export const getMySubmissionsForProblem = (userId, problemId, limit) =>
  db.prepare(`
    SELECT s.*, p.slug AS problem_slug, p.title AS problem_title, p.difficulty
    FROM submissions s
    JOIN problems p ON p.id = s.problem_id
    WHERE s.user_id = ? AND s.problem_id = ?
    ORDER BY s.created_at DESC
    LIMIT ?
  `).all(userId, problemId, limit);

/* ─── public activity feed ──────────────────────────────────────────────── */

export const getRecentActivity = (limit) =>
  db.prepare(`
    SELECT s.id, s.status, s.created_at, s.language,
           u.id as user_id, u.username, u.avatar_url,
           p.slug as problem_slug, p.title as problem_title, p.difficulty
    FROM submissions s
    JOIN users u ON u.id = s.user_id
    JOIN problems p ON p.id = s.problem_id
    ORDER BY s.created_at DESC
    LIMIT ?
  `).all(limit);
