/**
 * Submissions service — owns the submit / run flows, persistence, and
 * read-side history endpoints.
 *
 * Cross-module dependencies (allowed per ADR 0003):
 *   - judge/service.runJudge  — picks SQL/JS/heuristic and produces a verdict
 *   - problems/service.getProblemBySlug + recordSubmission
 *   - users/service.bumpRating
 */
import { db } from '../../shared/db.js';
import { HttpError } from '../../shared/errors.js';
import { runJudge } from '../judge/service.js';
import * as problems from '../problems/service.js';
import * as users from '../users/service.js';
import * as q from './queries.js';

const RECENT_ACTIVITY_LIMIT = 20;
const MY_HISTORY_LIMIT = 200;
const MY_PROBLEM_HISTORY_LIMIT = 50;

const RATING_BY_DIFFICULTY = { HARD: 25, MEDIUM: 12, EASY: 5 };

/* ─── submit / run ──────────────────────────────────────────────────────── */

/**
 * Submit code: runs the judge, persists the submission, updates problem
 * counters and (on first solve) the user's rating — all in one transaction.
 */
export function submit({ user, slug, code, language }) {
  const problem = problems.getProblemBySlug(slug);
  if (!problem) throw new HttpError(404, 'Problem not found');

  const result = runJudge(problem, code, language);
  const accepted = result.status === 'ACCEPTED';

  const submissionId = db.transaction(() => {
    const info = q.insertSubmission({
      userId: user.id,
      problemId: problem.id,
      language,
      code,
      status: result.status,
      runtimeMs: result.runtimeMs,
      memoryKb: result.memoryKb,
      testsPassed: result.testsPassed,
      testsTotal: result.testsTotal,
      output: result.output,
      error: result.error,
      beats: result.beats,
    });
    problems.recordSubmission(problem.id, { accepted });
    if (accepted) {
      const acceptedCount = q.countAcceptedForUserProblem(user.id, problem.id);
      if (acceptedCount === 1) {
        const delta = RATING_BY_DIFFICULTY[problem.difficulty] ?? RATING_BY_DIFFICULTY.EASY;
        users.bumpRating(user.id, delta);
      }
    }
    return info.lastInsertRowid;
  })();

  return submissionToJson({
    ...result,
    id: submissionId,
    language,
    code,
    problem,
  });
}

/** Run the judge on sample tests without persisting anything. */
export function run({ slug, code, language }) {
  const problem = problems.getProblemBySlug(slug);
  if (!problem) throw new HttpError(404, 'Problem not found');
  const result = runJudge(problem, code, language);
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

export function getMyHistory(userId) {
  return q.getMySubmissions(userId, MY_HISTORY_LIMIT).map(submissionToJson);
}

export function getMyHistoryForProblem(userId, slug) {
  const problem = problems.getProblemBySlug(slug);
  if (!problem) throw new HttpError(404, 'Problem not found');
  return q.getMySubmissionsForProblem(userId, problem.id, MY_PROBLEM_HISTORY_LIMIT)
    .map(submissionToJson);
}

export function getRecentActivity() {
  return q.getRecentActivity(RECENT_ACTIVITY_LIMIT).map((r) => ({
    id: r.id,
    status: r.status,
    language: r.language,
    createdAt: r.created_at,
    user: { id: r.user_id, username: r.username, avatarUrl: r.avatar_url },
    problem: { slug: r.problem_slug, title: r.problem_title, difficulty: r.difficulty },
  }));
}

/* ─── serialization ─────────────────────────────────────────────────────── */

function submissionToJson(r) {
  return {
    id: r.id,
    status: r.status,
    language: r.language,
    code: r.code,
    runtimeMs: r.runtime_ms ?? r.runtimeMs,
    memoryKb: r.memory_kb ?? r.memoryKb,
    testsPassed: r.tests_passed ?? r.testsPassed,
    testsTotal: r.tests_total ?? r.testsTotal,
    output: r.output,
    error: r.error,
    beats: r.beats_pct ?? r.beats,
    createdAt: r.created_at ?? new Date().toISOString(),
    problem: r.problem_slug
      ? { slug: r.problem_slug, title: r.problem_title, difficulty: r.difficulty }
      : r.problem
        ? { slug: r.problem.slug, title: r.problem.title, difficulty: r.problem.difficulty }
        : undefined,
  };
}
