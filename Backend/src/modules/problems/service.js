/**
 * Problems service — public list/detail/favorite plus instructor problem CRUD.
 */
import { withTransaction } from '../../shared/db.js';
import { fromZod, HttpError } from '../../shared/errors.js';
import * as audit from '../audit/service.js';
import { CreateProblemSchema } from './schemas.js';
import * as q from './queries.js';

const VALID_DIFFICULTIES = new Set(['EASY', 'MEDIUM', 'HARD']);
const VALID_TYPES = new Set(['ALGORITHM', 'SQL', 'BACKEND', 'FRONTEND', 'STDIO']);

export async function listProblems({ search, difficulty, category, status, page, pageSize, tag, type, userId }) {
  const offset = (Math.max(parseInt(page || '1', 10), 1) - 1) * parseInt(pageSize || '50', 10);
  const limit = Math.min(parseInt(pageSize || '50', 10), 200);

  const where = [];
  const args = [];
  if (search) {
    where.push('(p.title ILIKE ? OR p.tags ILIKE ?)');
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
    where.push('p.tags ILIKE ?');
    args.push(`%${tag}%`);
  }

  // Push the status filter into SQL so pagination is computed against
  // the filtered set. The previous in-Node filter caused page sizes
  // to shrink unpredictably (page=1 of 50 could return 3 items if 47
  // rows were filtered out post-query) and `total` to be wrong.
  const u = userId || 0;
  if (status === 'solved') {
    where.push(`EXISTS (
      SELECT 1 FROM submissions s
      WHERE s.user_id = ? AND s.problem_id = p.id AND s.status = 'ACCEPTED'
    )`);
    args.push(u);
  } else if (status === 'attempted') {
    where.push(`EXISTS (
      SELECT 1 FROM submissions s
      WHERE s.user_id = ? AND s.problem_id = p.id
    ) AND NOT EXISTS (
      SELECT 1 FROM submissions s2
      WHERE s2.user_id = ? AND s2.problem_id = p.id AND s2.status = 'ACCEPTED'
    )`);
    args.push(u, u);
  } else if (status === 'todo') {
    where.push(`NOT EXISTS (
      SELECT 1 FROM submissions s
      WHERE s.user_id = ? AND s.problem_id = p.id
    )`);
    args.push(u);
  }

  const { rows, total } = await q.listProblems({
    where, args, userId: u, limit, offset,
  });

  const items = rows.map(toProblemSummary);

  return { items, total, page: parseInt(page || '1', 10), pageSize: limit };
}

export async function getProblemDetail(slug, userId) {
  const p = await q.findProblemBySlug(slug);
  if (!p) throw new HttpError(404, 'Problem not found');

  const u = userId || 0;
  const [solved, attempted, favorited] = await Promise.all([
    q.userHasSolvedProblem(u, p.id),
    q.userHasAttemptedProblem(u, p.id),
    q.userHasFavorited(u, p.id),
  ]);

  const result = {
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

  // STDIO public shape: expose SAMPLE test cases only, plus per-problem
  // limits, comparator, and language allowlist. HIDDEN cases MUST NOT appear.
  if (p.problem_type === 'STDIO') {
    const allCases = safeJson(p.test_cases_json, []);
    result.sampleTestCases = allCases
      .filter((tc) => tc.visibility === 'SAMPLE')
      .map((tc) => ({ stdin: tc.stdin, expected_stdout: tc.expected_stdout, name: tc.name || undefined }));
    result.comparatorMode = p.comparator_mode;
    result.languageAllowlist = p.language_allowlist;
    result.outputSizeCapKb = p.output_size_cap_kb;
  }

  return result;
}

export async function toggleFavorite(userId, slug) {
  const p = await q.findProblemIdBySlug(slug);
  if (!p) throw new HttpError(404, 'Problem not found');
  if (await q.userHasFavorited(userId, p.id)) {
    await q.removeFavorite(userId, p.id);
    return { favorited: false };
  }
  await q.addFavorite(userId, p.id);
  return { favorited: true };
}

export async function getProblemEditorDetail(slug) {
  const p = await q.findProblemBySlug(slug);
  if (!p) throw new HttpError(404, 'Problem not found');
  return toProblemEditorDetail(p);
}

export async function createProblem(payload) {
  return withTransaction(async (tx) => {
    if (await q.findProblemIdBySlug(payload.slug, tx)) {
      throw new HttpError(409, `A problem with slug "${payload.slug}" already exists`);
    }

    // Apply per-type defaults for timeLimitMs / memoryLimitMb / STDIO
    // knobs. These live in the service rather than the schema because
    // STDIO and the other problem types want different defaults, and
    // zod `.default()` fires before `applyStdioDefaults` sees the payload.
    if (payload.problemType === 'STDIO') {
      applyStdioDefaults(payload);
      validateStdioRanges(payload);
    } else {
      payload.timeLimitMs ??= 1000;
      payload.memoryLimitMb ??= 256;
    }

    const category = await resolveCategoryOr404(payload.categorySlug, tx);
    await q.insertProblem(toProblemDbRecord(payload, category.id), tx);
    await audit.recordEvent(payload.actor, {
      action: 'CREATE',
      entityType: 'PROBLEM',
      entityKey: payload.slug,
      details: {
        problemType: payload.problemType,
        categorySlug: payload.categorySlug,
      },
    }, { db: tx });

    const created = await q.findProblemBySlug(payload.slug, tx);
    return toProblemEditorDetail(created);
  });
}

export async function updateProblem(actor, slug, fields) {
  return withTransaction(async (tx) => {
    const existing = await q.findProblemBySlug(slug, tx);
    if (!existing) throw new HttpError(404, 'Problem not found');

    // Reject STDIO ↔ non-STDIO type transitions (R12.1)
    if (existing.problem_type === 'STDIO' && fields.problemType && fields.problemType !== 'STDIO') {
      throw new HttpError(400, 'Cannot change problem type from STDIO to another type', { code: 'TYPE_CHANGE_NOT_ALLOWED' });
    }
    if (existing.problem_type !== 'STDIO' && fields.problemType === 'STDIO') {
      throw new HttpError(400, 'Cannot change problem type to STDIO from another type', { code: 'TYPE_CHANGE_NOT_ALLOWED' });
    }

    const merged = {
      ...toProblemEditorDetail(existing),
      ...fields,
    };
    const parsed = CreateProblemSchema.safeParse(merged);
    if (!parsed.success) throw fromZod(parsed.error);

    // Apply per-type defaults for STDIO or other types.
    const effectiveType = fields.problemType || existing.problem_type;
    if (effectiveType === 'STDIO') {
      applyStdioDefaults(parsed.data);
      validateStdioRanges(parsed.data);
    } else {
      parsed.data.timeLimitMs ??= existing.time_limit_ms ?? 1000;
      parsed.data.memoryLimitMb ??= existing.memory_limit_mb ?? 256;
    }

    const category = await resolveCategoryOr404(parsed.data.categorySlug, tx);
    await q.updateProblem(existing.id, toProblemDbRecord(parsed.data, category.id), tx);
    await audit.recordEvent(actor, {
      action: 'UPDATE',
      entityType: 'PROBLEM',
      entityKey: slug,
      details: { fields: Object.keys(fields) },
    }, { db: tx });

    const updated = await q.findProblemBySlug(slug, tx);
    return toProblemEditorDetail(updated);
  });
}

export async function deleteProblem(actor, slug) {
  return withTransaction(async (tx) => {
    const existing = await q.findProblemBySlug(slug, tx);
    if (!existing) throw new HttpError(404, 'Problem not found');

    const usage = await q.getProblemUsage(existing.id, tx);
    if ((usage?.course_refs ?? 0) > 0 || (usage?.exam_refs ?? 0) > 0 || (usage?.submission_refs ?? 0) > 0) {
      throw new HttpError(
        409,
        `Cannot delete problem "${slug}" while it is referenced by courses, exams, or submissions`,
      );
    }

    await audit.recordEvent(actor, {
      action: 'DELETE',
      entityType: 'PROBLEM',
      entityKey: slug,
      details: {},
    }, { db: tx });
    await q.deleteProblem(existing.id, tx);
  });
}

/* ─── used by other modules ─────────────────────────────────────────────── */

/** Find a problem by slug. Returns the raw row for callers that need full data
 *  (e.g. submissions module needs sql_setup, test_cases_json, function_name).
 *  Returns null when not found. */
export const getProblemBySlug = async (slug) => q.findProblemBySlug(slug) || null;

/** Counter bump called from submissions service after a submission lands. */
export async function recordSubmission(problemId, { accepted }, { db: executor } = {}) {
  await q.incrementTotalSubmissions(problemId, executor);
  if (accepted) await q.incrementAcceptedSubmissions(problemId, executor);
}

/* ─── STDIO helpers ──────────────────────────────────────────────────── */

function applyStdioDefaults(payload) {
  payload.timeLimitMs ??= 2000;
  payload.memoryLimitMb ??= 256;
  payload.outputSizeCapKb ??= 64;
  payload.comparatorMode ??= 'TRIMMED';
}

function validateStdioRanges(payload) {
  if (payload.timeLimitMs < 100 || payload.timeLimitMs > 10000) {
    throw new HttpError(400, 'timeLimitMs must be between 100 and 10000', { field: 'timeLimitMs' });
  }
  if (payload.memoryLimitMb < 16 || payload.memoryLimitMb > 512) {
    throw new HttpError(400, 'memoryLimitMb must be between 16 and 512', { field: 'memoryLimitMb' });
  }
  if (payload.outputSizeCapKb < 1 || payload.outputSizeCapKb > 1024) {
    throw new HttpError(400, 'outputSizeCapKb must be between 1 and 1024', { field: 'outputSizeCapKb' });
  }
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

function toProblemEditorDetail(p) {
  const base = {
    slug: p.slug,
    title: p.title,
    description: p.description,
    difficulty: p.difficulty,
    problemType: p.problem_type || 'ALGORITHM',
    categorySlug: p.category_slug,
    tags: parseTags(p.tags),
    examples: safeJson(p.examples_json, []),
    constraints: p.constraints || '',
    hints: safeJson(p.hints_json, []),
    starterCode: safeJson(p.starter_code_json, {}),
    expectedOutput: p.expected_output || '',
    testCases: safeJson(p.test_cases_json, []),
    sqlSetup: p.sql_setup || '',
    functionName: p.function_name || '',
    timeLimitMs: p.time_limit_ms,
    memoryLimitMb: p.memory_limit_mb,
    isPremium: !!p.is_premium,
    createdAt: p.created_at,
  };
  // Include STDIO-specific fields only when they have values,
  // so they don't interfere with zod validation on non-STDIO problems.
  if (p.output_size_cap_kb != null) base.outputSizeCapKb = p.output_size_cap_kb;
  if (p.comparator_mode != null) base.comparatorMode = p.comparator_mode;
  if (p.language_allowlist != null) base.languageAllowlist = p.language_allowlist;
  return base;
}

async function resolveCategoryOr404(slug, executor) {
  const category = await q.findCategoryBySlug(slug, executor);
  if (!category) throw new HttpError(404, `Category "${slug}" not found`);
  return category;
}

function toProblemDbRecord(payload, categoryId) {
  return {
    slug: payload.slug,
    title: payload.title,
    description: payload.description,
    difficulty: payload.difficulty,
    problemType: payload.problemType,
    categoryId,
    tags: (payload.tags || []).join(','),
    examplesJson: JSON.stringify(payload.examples || []),
    constraints: payload.constraints || '',
    hintsJson: JSON.stringify(payload.hints || []),
    starterCodeJson: JSON.stringify(payload.starterCode || {}),
    expectedOutput: payload.expectedOutput?.trim() || '',
    testCasesJson: payload.testCases?.length ? JSON.stringify(payload.testCases) : null,
    sqlSetup: payload.sqlSetup?.trim() || null,
    functionName: payload.functionName?.trim() || null,
    timeLimitMs: payload.timeLimitMs,
    memoryLimitMb: payload.memoryLimitMb,
    isPremium: payload.isPremium,
    outputSizeCapKb: payload.outputSizeCapKb ?? null,
    comparatorMode: payload.comparatorMode ?? null,
    languageAllowlist: payload.languageAllowlist ?? null,
  };
}

function parseTags(s) {
  return s ? s.split(',').map((t) => t.trim()).filter(Boolean) : [];
}

function safeJson(s, fallback) {
  if (!s) return fallback;
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}
