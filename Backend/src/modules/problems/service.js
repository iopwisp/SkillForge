/**
 * Problems service — list / detail / favorite toggle.
 */
import { HttpError } from '../../shared/errors.js';
import * as q from './queries.js';

const VALID_DIFFICULTIES = new Set(['EASY', 'MEDIUM', 'HARD']);
const VALID_TYPES = new Set(['ALGORITHM', 'SQL', 'BACKEND', 'FRONTEND']);

export function listProblems({ search, difficulty, category, status, page, pageSize, tag, type, userId }) {
  const offset = (Math.max(parseInt(page || '1', 10), 1) - 1) * parseInt(pageSize || '50', 10);
  const limit = Math.min(parseInt(pageSize || '50', 10), 200);

  const where = [];
  const args = [];
  if (search) {
    where.push('(p.title LIKE ? OR p.tags LIKE ?)');
    args.push(`%${search}%`, `%${search}%`);
  }
  if (difficulty && VALID_DIFFICULTIES.has(String(difficulty).toUpperCase())) {
    where.push('p.difficulty = ?');
    args.push(String(difficulty).toUpperCase());
  }
  if (type && VALID_TYPES.has(String(type).toUpperCase())) {
    where.push('p.problem_type = ?');
    args.push(String(type).toUpperCase());
  }
  if (category) {
    where.push('c.slug = ?');
    args.push(String(category));
  }
  if (tag) {
    where.push('p.tags LIKE ?');
    args.push(`%${tag}%`);
  }

  const { rows, total } = q.listProblems({
    where, args, userId: userId || 0, limit, offset,
  });

  const items = rows.map(toProblemSummary).filter((p) => {
    if (status === 'solved') return p.status === 'solved';
    if (status === 'attempted') return p.status === 'attempted';
    if (status === 'todo') return p.status === null;
    return true;
  });

  return { items, total, page: parseInt(page || '1', 10), pageSize: limit };
}

export function getProblemDetail(slug, userId) {
  const p = q.findProblemBySlug(slug);
  if (!p) throw new HttpError(404, 'Problem not found');

  const u = userId || 0;
  const solved = q.userHasSolvedProblem(u, p.id);
  const attempted = q.userHasAttemptedProblem(u, p.id);
  const favorited = q.userHasFavorited(u, p.id);

  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    description: p.description,
    difficulty: p.difficulty,
    problemType: p.problem_type || 'ALGORITHM',
    category: p.category_slug
      ? { slug: p.category_slug, name: p.category_name }
      : null,
    tags: parseTags(p.tags),
    examples: safeJson(p.examples_json, []),
    constraints: p.constraints || '',
    hints: safeJson(p.hints_json, []),
    starterCode: safeJson(p.starter_code_json, {}),
    sqlSetup: p.sql_setup || null,
    functionName: p.function_name || null,
    timeLimitMs: p.time_limit_ms,
    memoryLimitMb: p.memory_limit_mb,
    isPremium: !!p.is_premium,
    totalSubmissions: p.total_submissions,
    acceptedSubmissions: p.accepted_submissions,
    acceptanceRate: p.total_submissions
      ? +(p.accepted_submissions / p.total_submissions * 100).toFixed(1)
      : 0,
    status: solved ? 'solved' : attempted ? 'attempted' : null,
    favorited,
  };
}

export function toggleFavorite(userId, slug) {
  const p = q.findProblemIdBySlug(slug);
  if (!p) throw new HttpError(404, 'Problem not found');
  if (q.userHasFavorited(userId, p.id)) {
    q.removeFavorite(userId, p.id);
    return { favorited: false };
  }
  q.addFavorite(userId, p.id);
  return { favorited: true };
}

/* ─── used by other modules ─────────────────────────────────────────────── */

/** Find a problem by slug. Returns the raw row for callers that need full data
 *  (e.g. submissions module needs sql_setup, test_cases_json, function_name).
 *  Returns null when not found. */
export const getProblemBySlug = (slug) => q.findProblemBySlug(slug) || null;

/** Counter bump called from submissions service after a submission lands. */
export function recordSubmission(problemId, { accepted }) {
  q.incrementTotalSubmissions(problemId);
  if (accepted) q.incrementAcceptedSubmissions(problemId);
}

/* ─── helpers ───────────────────────────────────────────────────────────── */

function toProblemSummary(r) {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    difficulty: r.difficulty,
    problemType: r.problem_type || 'ALGORITHM',
    tags: parseTags(r.tags),
    category: r.category_slug ? { slug: r.category_slug, name: r.category_name } : null,
    isPremium: !!r.is_premium,
    totalSubmissions: r.total_submissions,
    acceptedSubmissions: r.accepted_submissions,
    acceptanceRate: r.total_submissions
      ? +(r.accepted_submissions / r.total_submissions * 100).toFixed(1)
      : 0,
    status: r.solved ? 'solved' : r.attempted ? 'attempted' : null,
    favorited: !!r.favorited,
  };
}

function parseTags(s) {
  return s ? s.split(',').map((t) => t.trim()).filter(Boolean) : [];
}

function safeJson(s, fallback) {
  if (!s) return fallback;
  try { return JSON.parse(s); }
  catch { return fallback; }
}
