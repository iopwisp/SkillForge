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
 *
 * Submit is two-phase per ADR 0013:
 *   - `insertPending`        — phase A (HTTP), persists the row with
 *                              status='PENDING' and the optional
 *                              idempotency_key.
 *   - `findIdempotent`       — phase A retry path: look up a previous
 *                              submission by the (idempotency_key,
 *                              user_id, problem_id) tuple and 200 it
 *                              instead of re-inserting.
 *   - `findById`             — polling endpoint and worker lookup.
 *   - `updateWithResult`     — phase B (worker), writes the final
 *                              verdict and a `finished_at` timestamp.
 *   - `markFailed`           — phase B fallback when the judge crashes
 *                              uncatchably.
 */
import { db } from '../../shared/db.js';

/** Phase A: persist a PENDING row and return its id. */
export async function insertPending({
  userId, problemId, language, code,
  examAttemptId = null,
  contestParticipationId = null,
  idempotencyKey = null,
}, executor = db) {
  return executor.maybeOne(`
    INSERT INTO submissions
      (user_id, problem_id, language, code, status,
       exam_attempt_id, contest_participation_id, idempotency_key)
    VALUES ($1, $2, $3, $4, 'PENDING', $5, $6, $7)
    RETURNING id
  `, [userId, problemId, language, code, examAttemptId, contestParticipationId, idempotencyKey]);
}

/**
 * Phase A retry path: did this user already submit *this* code-attempt
 * (same Idempotency-Key) for *this* problem? If yes, return the existing
 * row id + status so the caller can short-circuit and skip the duplicate
 * insert + duplicate enqueue. Returns null if the key is unused.
 *
 * The (idempotency_key, user_id, problem_id) check is intentionally
 * tighter than the bare UNIQUE on idempotency_key alone: two students
 * sharing a key by accident is a user error, not a duplicate, and the
 * partial UNIQUE index will surface it as a 23505 we map to 409 in
 * the service.
 */
export async function findIdempotent({
  userId, problemId, idempotencyKey,
}, executor = db) {
  return executor.maybeOne(`
    SELECT s.*, p.slug AS problem_slug, p.title AS problem_title, p.difficulty
    FROM submissions s
    JOIN problems p ON p.id = s.problem_id
    WHERE s.idempotency_key = $1
      AND s.user_id = $2
      AND s.problem_id = $3
    LIMIT 1
  `, [idempotencyKey, userId, problemId]);
}

/** Used by the worker (looks up the row to grade) and the polling
 *  endpoint (returns the row to the client). */
export async function findById(submissionId, executor = db) {
  return executor.maybeOne(`
    SELECT s.*, p.slug AS problem_slug, p.title AS problem_title, p.difficulty
    FROM submissions s
    JOIN problems p ON p.id = s.problem_id
    WHERE s.id = $1
  `, [submissionId]);
}

/** Phase B: update with the final verdict from the judge. Stamps
 *  `finished_at` so we can surface "judging took N ms" stats later. */
export async function updateWithResult(submissionId, {
  status, runtimeMs, memoryKb, testsPassed, testsTotal,
  output, error, beats,
}, executor = db) {
  await executor.none(`
    UPDATE submissions
       SET status = $2,
           runtime_ms = $3,
           memory_kb = $4,
           tests_passed = $5,
           tests_total = $6,
           output = $7,
           error = $8,
           beats_pct = $9,
           finished_at = NOW()
     WHERE id = $1
  `, [
    submissionId, status, runtimeMs, memoryKb, testsPassed, testsTotal,
    output, error, beats,
  ]);
}

/**
 * Phase B fallback: the worker hit an unhandled exception that wasn't
 * caught inside the judge. Marks the submission as a JUDGE_ERROR (a
 * status outside the normal verdict set) and stores the error message.
 * The frontend treats this as "could not run, try again" — the run is
 * not counted toward problem stats or rating.
 */
export async function markFailed(submissionId, errorMessage, executor = db) {
  await executor.none(`
    UPDATE submissions
       SET status = 'JUDGE_ERROR',
           error = $2,
           finished_at = NOW()
     WHERE id = $1
  `, [submissionId, errorMessage]);
}

export async function countAcceptedForUserProblem(userId, problemId, executor = db) {
  const row = await executor.maybeOne(`
    SELECT COUNT(*)::int AS n
    FROM submissions
    WHERE user_id = $1 AND problem_id = $2 AND status = 'ACCEPTED'
  `, [userId, problemId]);
  return row?.n ?? 0;
}

/* ─── history (per-user) ────────────────────────────────────────────────── */

export const getMySubmissions = (userId, limit, executor = db) =>
  executor.many(`
    SELECT s.*, p.slug AS problem_slug, p.title AS problem_title, p.difficulty
    FROM submissions s
    JOIN problems p ON p.id = s.problem_id
    WHERE s.user_id = $1
    ORDER BY s.created_at DESC
    LIMIT $2
  `, [userId, limit]);

export const getMySubmissionsForProblem = (userId, problemId, limit, executor = db) =>
  executor.many(`
    SELECT s.*, p.slug AS problem_slug, p.title AS problem_title, p.difficulty
    FROM submissions s
    JOIN problems p ON p.id = s.problem_id
    WHERE s.user_id = $1 AND s.problem_id = $2
    ORDER BY s.created_at DESC
    LIMIT $3
  `, [userId, problemId, limit]);

/* ─── public activity feed ──────────────────────────────────────────────── */

/**
 * In-exam submissions are hidden from the public feed so the feed
 * cannot spoil answers while an exam is running (ADR 0009
 * §"Hot-path invariants"). Contest submissions are filtered out for
 * the same reason — a live or virtual contest attempt should not
 * appear in the global practice feed (per contest-mode R6.6).
 * Practice submissions pass through as before (both link columns NULL).
 */
export const getRecentActivity = (limit, executor = db) =>
  executor.many(`
    SELECT s.id, s.status, s.created_at, s.language,
           u.id AS user_id, u.username, u.avatar_url,
           p.slug AS problem_slug, p.title AS problem_title, p.difficulty
    FROM submissions s
    JOIN users u ON u.id = s.user_id
    JOIN problems p ON p.id = s.problem_id
    WHERE s.exam_attempt_id IS NULL
      AND s.contest_participation_id IS NULL
    ORDER BY s.created_at DESC
    LIMIT $1
  `, [limit]);
