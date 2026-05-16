/**
 * Submissions service — owns the submit / run flows, persistence, and
 * read-side history endpoints.
 *
 * Submit is two-phase per ADR 0013:
 *
 *   Phase A — `submit({ user, slug, code, language, examAttemptId,
 *                       contestParticipationId, idempotencyKey })`
 *     Persists a PENDING row, deduplicates on Idempotency-Key if
 *     present, and enqueues a judge job. Returns immediately with
 *     `{ id, status: 'PENDING', ... }` — the verdict is filled in by
 *     the worker. In `JUDGE_QUEUE=inline` mode the enqueue step is a
 *     direct call into `finalize()`, so the response *does* carry a
 *     final verdict; that path is what tests + dev rely on.
 *
 *   Phase B — `finalize(submissionId)`
 *     Loads the row, runs the judge, and atomically updates the row +
 *     problem counters + (on first solve) the user's rating. Called by
 *     the BullMQ worker in production, called inline from `submit()`
 *     in dev/test. If the row is linked to a contest participation
 *     (contest-mode task 13.1), we also notify the contests service
 *     after a successful finalize so it can recompute the participant's
 *     standing — but NOT on `JUDGE_ERROR`, which leaves the standing
 *     untouched per R17.4.
 *
 * Cross-module dependencies (allowed per ADR 0003):
 *   - judge/service.runJudge  — picks SQL/JS/heuristic and produces a verdict
 *   - problems/service.getProblemBySlug + recordSubmission
 *   - users/service.bumpRating
 *   - contests/service.onContestSubmissionFinalized (lazy-loaded to
 *     avoid a circular import — contests.service depends on us too).
 */
import { withTransaction } from '../../shared/db.js';
import { HttpError } from '../../shared/errors.js';
import { logger } from '../../shared/logger.js';
import {
  enqueueJudgeJob, setJudgeJobProcessor, getQueueMode,
} from '../../shared/queue.js';
import { runJudge } from '../judge/service.js';
import { canonicalLanguage } from '../judge/stdio-prepare.js';
import * as problems from '../problems/service.js';
import * as users from '../users/service.js';
import * as q from './queries.js';

const RECENT_ACTIVITY_LIMIT = 20;
const MY_HISTORY_LIMIT = 200;
const MY_PROBLEM_HISTORY_LIMIT = 50;

const RATING_BY_DIFFICULTY = { HARD: 25, MEDIUM: 12, EASY: 5 };

/* ─── submit / run ──────────────────────────────────────────────────────── */

/**
 * Phase A. Persist a PENDING submission row + enqueue a judge job.
 *
 * - In `inline` queue mode, the enqueue step calls `finalize()`
 *   immediately on the same event loop, so the row already carries the
 *   final verdict by the time we re-`findById` it. Tests rely on this.
 * - In `bullmq` mode, enqueue returns once the job is durably on Redis;
 *   the row is still PENDING and the client polls `GET /api/submissions/:id`.
 *
 * The Idempotency-Key path (per ADR 0013) collapses a network retry of
 * the same logical "Submit" click onto the original row instead of
 * creating a duplicate. Two students sharing a key by accident triggers
 * a 23505 inside the partial UNIQUE index, which we map to 409.
 */
export async function submit({
  user, slug, code, language,
  examAttemptId = null,
  contestParticipationId = null,
  idempotencyKey = null,
}) {
  const problem = await problems.getProblemBySlug(slug);
  if (!problem) throw new HttpError(404, 'Problem not found');

  // Fast-path: same Idempotency-Key for the same user+problem → return
  // the existing submission as-is.
  if (idempotencyKey) {
    const prior = await q.findIdempotent({
      userId: user.id, problemId: problem.id, idempotencyKey,
    });
    if (prior) return submissionToJson(prior);
  }

  // STDIO language-allowlist gate: reject before any row is inserted.
  if (problem.problem_type === 'STDIO') {
    assertLanguageAllowed(problem, language);
  }

  let inserted;
  try {
    inserted = await q.insertPending({
      userId: user.id,
      problemId: problem.id,
      language,
      code,
      examAttemptId,
      contestParticipationId,
      idempotencyKey,
    });
  } catch (e) {
    if (isUniqueViolation(e, 'idempotency_key')) {
      // Race: a concurrent request just inserted with the same key.
      // Either it was the same user+problem (collapse to that row) or
      // it was a different user (the key got reused, that's a 409).
      const existing = await q.findIdempotent({
        userId: user.id, problemId: problem.id, idempotencyKey,
      });
      if (existing) return submissionToJson(existing);
      throw new HttpError(409, 'Idempotency-Key is already in use by a different submission');
    }
    throw e;
  }

  try {
    // The `contestParticipationId` is threaded into the job metadata
    // as well as the DB row. The worker only re-reads the row to drive
    // `finalize()`, so the metadata is purely informational today — but
    // it's useful for log correlation and keeps the contract explicit
    // per contest-mode R17.1.
    await enqueueJudgeJob(inserted.id, { contestParticipationId });
  } catch (e) {
    // We already inserted a PENDING row; if the enqueue itself fails the
    // submission would be stuck PENDING forever. Mark it failed and
    // surface a 503 so the frontend can retry rather than appear hung.
    logger.error({ err: e, submissionId: inserted.id }, 'enqueueJudgeJob failed');
    await q.markFailed(inserted.id, `Could not enqueue judge job: ${e.message}`)
      .catch((markErr) => logger.error({ err: markErr }, 'failed to mark stuck submission as JUDGE_ERROR'));
    throw new HttpError(503, 'Judge queue is unavailable, please retry');
  }

  // In inline mode, finalize() has already written the final verdict;
  // re-read so the response includes runtimeMs / status / etc.
  const final = await q.findById(inserted.id);
  return submissionToJson({ ...final, code });
}

/**
 * Phase B. Called by the worker (or directly by the inline queue
 * adapter) for a given submission id. Runs the judge and atomically:
 *   - UPDATE submissions ... finished_at = NOW()
 *   - problems.recordSubmission(...)
 *   - users.bumpRating(...) on first solve
 *
 * Idempotent against the PENDING → final transition: if the row already
 * has a non-PENDING status (because some earlier worker already
 * finalized it, e.g. a job re-delivery), we no-op. Concurrent finalize
 * calls for the same submission are not expected (BullMQ jobId equals
 * submissionId so jobs deduplicate at enqueue time), but the no-op
 * keeps us correct under retry storms anyway.
 */
export async function finalize(submissionId) {
  const row = await q.findById(submissionId);
  if (!row) {
    logger.warn({ submissionId }, 'finalize: submission not found, skipping');
    return null;
  }
  if (row.status !== 'PENDING') {
    logger.debug({ submissionId, status: row.status }, 'finalize: already finalized, skipping');
    return row;
  }

  const problem = await problems.getProblemBySlug(row.problem_slug);
  if (!problem) {
    // Problem deleted between submit and judge — mark JUDGE_ERROR rather
    // than crash the worker.
    await q.markFailed(submissionId, 'Problem was deleted before the submission could be judged');
    return null;
  }

  let result;
  try {
    result = await runJudge(problem, row.code, row.language);
  } catch (e) {
    logger.error({ submissionId, err: e }, 'judge threw uncaught');
    await q.markFailed(submissionId, `Judge crashed: ${e.message}`);
    return null;
  }

  const accepted = result.status === 'ACCEPTED';

  await withTransaction(async (tx) => {
    await q.updateWithResult(submissionId, {
      status: result.status,
      runtimeMs: result.runtimeMs,
      memoryKb: result.memoryKb,
      testsPassed: result.testsPassed,
      testsTotal: result.testsTotal,
      output: result.output,
      error: result.error,
      beats: result.beats,
    }, tx);

    await problems.recordSubmission(problem.id, { accepted }, { db: tx });

    if (accepted) {
      const acceptedCount = await q.countAcceptedForUserProblem(row.user_id, problem.id, tx);
      if (acceptedCount === 1) {
        const delta = RATING_BY_DIFFICULTY[problem.difficulty] ?? RATING_BY_DIFFICULTY.EASY;
        await users.bumpRating(row.user_id, delta, { db: tx });
      }
    }
  });

  // Contest-mode task 13.1: if this submission belongs to a contest
  // participation, let contests.service recompute the participant's
  // standing. `JUDGE_ERROR` must NOT alter the standing (R17.4), so
  // we skip the hook on that verdict. The import is lazy to avoid a
  // circular dependency at module-load time (contests.service imports
  // submissions.service for `submit`).
  if (row.contest_participation_id && result.status !== 'JUDGE_ERROR') {
    try {
      const { onContestSubmissionFinalized } = await import('../contests/service.js');
      await onContestSubmissionFinalized(submissionId);
    } catch (hookErr) {
      // Never let a standing-recompute failure propagate — the
      // submission row itself is already finalized and the standing
      // can be recomputed on the next read. Surface a warning so ops
      // can correlate.
      logger.warn({ err: hookErr, submissionId }, 'contest finalize hook failed');
    }
  }

  return q.findById(submissionId);
}

// Wire the inline queue adapter at import time. This is the only place
// the queue learns who its processor is — keeps the dependency graph
// flowing one way (queue knows nothing about submissions).
setJudgeJobProcessor(finalize);

/** Run the judge on sample tests without persisting anything. */
export async function run({ slug, code, language, stdin }) {
  const problem = await problems.getProblemBySlug(slug);
  if (!problem) throw new HttpError(404, 'Problem not found');

  if (problem.problem_type === 'STDIO') {
    // Language allowlist gate (R4.6)
    assertLanguageAllowed(problem, language);

    // Stdin size gate (R4.5)
    if (stdin) {
      const stdinBytes = Buffer.byteLength(stdin, 'utf8');
      const cap = Math.min((problem.output_size_cap_kb || 64) * 1024, 1024 * 1024);
      if (stdinBytes > cap) {
        throw new HttpError(413, 'stdin exceeds size limit', { code: 'STDIN_TOO_LARGE' });
      }
    }

    // STDIO Run flow — pass stdin to the judge (R4.3)
    const result = await runJudge(problem, code, language, { kind: 'run', stdin: stdin || '' });
    return result;
  }

  // Non-STDIO: existing behavior
  // Note: runJudge is async for Python/Java/Go (Docker mode); without
  // await the response goes back as `{status: undefined, ...}` and the
  // client thinks the run "succeeded" with empty output.
  const result = await runJudge(problem, code, language);
  return {
    status: result.status,
    runtimeMs: result.runtimeMs,
    memoryKb: result.memoryKb,
    testsPassed: result.testsPassed,
    testsTotal: result.testsTotal,
    output: result.output,
    error: result.error,
  };
}

/* ─── history ───────────────────────────────────────────────────────────── */

export async function getMyHistory(userId) {
  return (await q.getMySubmissions(userId, MY_HISTORY_LIMIT)).map(submissionToJson);
}

export async function getMyHistoryForProblem(userId, slug) {
  const problem = await problems.getProblemBySlug(slug);
  if (!problem) throw new HttpError(404, 'Problem not found');
  return (await q.getMySubmissionsForProblem(userId, problem.id, MY_PROBLEM_HISTORY_LIMIT))
    .map(submissionToJson);
}

export async function getRecentActivity() {
  return (await q.getRecentActivity(RECENT_ACTIVITY_LIMIT)).map((r) => ({
    id: r.id,
    status: r.status,
    language: r.language,
    createdAt: r.created_at,
    user: { id: r.user_id, username: r.username, avatarUrl: r.avatar_url },
    problem: { slug: r.problem_slug, title: r.problem_title, difficulty: r.difficulty },
  }));
}

/**
 * Polling endpoint payload. Returns the current submission state for
 * the owner. Strips the body code from the JSON so we don't ship the
 * student's source on every poll.
 */
export async function getOneForUser(userId, submissionId) {
  const row = await q.findById(submissionId);
  if (!row) throw new HttpError(404, 'Submission not found');
  if (row.user_id !== userId) throw new HttpError(404, 'Submission not found');
  return submissionToJson(row, { includeCode: false });
}

/* ─── operational ──────────────────────────────────────────────────────── */

/** Useful for /api/health and tests; returns either 'inline' or 'bullmq'. */
export function getJudgeQueueMode() {
  return getQueueMode();
}

/* ─── serialization ─────────────────────────────────────────────────────── */

export function submissionToJson(r, { includeCode = true } = {}) {
  const base = {
    id: r.id,
    status: r.status,
    language: r.language,
    code: includeCode ? r.code : undefined,
    runtimeMs: r.runtime_ms ?? r.runtimeMs,
    memoryKb: r.memory_kb ?? r.memoryKb,
    testsPassed: r.tests_passed ?? r.testsPassed,
    testsTotal: r.tests_total ?? r.testsTotal,
    output: r.output,
    error: r.error,
    beats: r.beats_pct ?? r.beats,
    createdAt: r.created_at ?? new Date().toISOString(),
    finishedAt: r.finished_at ?? null,
    problem: r.problem_slug
      ? { slug: r.problem_slug, title: r.problem_title, difficulty: r.difficulty }
      : r.problem
        ? { slug: r.problem.slug, title: r.problem.title, difficulty: r.problem.difficulty }
        : undefined,
  };

  // For STDIO submissions, parse output and expose perTestResults
  // with HIDDEN-safe filtering (R5.3, R5.6, R10.5, R10.6).
  // Detect by checking if output is JSON with a perTestResults array,
  // so we don't need the problem_type on the submission row.
  if (r.output) {
    try {
      const parsed = JSON.parse(r.output);
      if (parsed && Array.isArray(parsed.perTestResults)) {
        base.perTestResults = parsed.perTestResults.map(sanitizePerTestResult);
      }
    } catch {
      // Not JSON — leave output as-is (function-style / SQL submissions)
    }
  }

  return base;
}

/**
 * Sanitize a per-test result for the wire:
 * - HIDDEN cases NEVER include stdin, expected_stdout, or actual_output.
 * - SAMPLE cases include actual_output only on non-ACCEPTED verdicts.
 */
function sanitizePerTestResult(r) {
  const safe = {
    index: r.index,
    verdict: r.verdict,
    time_ms: r.time_ms,
    memory_mb: r.memory_mb,
    stdout_bytes: r.stdout_bytes,
    visibility: r.visibility,
    stderr_tail: r.stderr_tail,
  };
  // Only include actual_output for SAMPLE cases (never for HIDDEN)
  if (r.visibility === 'SAMPLE' && r.actual_output !== undefined) {
    safe.actual_output = r.actual_output;
  }
  return safe;
}

/* ─── helpers ───────────────────────────────────────────────────────────── */

function assertLanguageAllowed(problem, language) {
  const canonical = canonicalLanguage(language);
  const allowlist = problem.language_allowlist || [];
  if (!canonical || !allowlist.includes(canonical)) {
    throw new HttpError(400, `Language "${language}" is not allowed for this problem`, { code: 'LANGUAGE_NOT_ALLOWED' });
  }
}

function isUniqueViolation(err, columnHint) {
  // pg uses SQLSTATE 23505 for unique-violation. The constraint name on
  // our partial unique index is `uniq_submissions_idempotency_key`.
  if (!err || err.code !== '23505') return false;
  if (!columnHint) return true;
  const detail = `${err.constraint || ''} ${err.detail || ''} ${err.message || ''}`;
  return detail.includes(columnHint) || detail.includes('uniq_submissions_idempotency_key');
}
