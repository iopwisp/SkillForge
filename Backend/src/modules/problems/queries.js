/**
 * SQL for the problems module.
 *
 * Owns: problems, favorites (toggle from problem context), and the
 * read-only JOINs against submissions/categories/course_problems/
 * exam_problems used to compute list/detail state and safe-delete guards.
 *
 * The users module also reads `favorites` for the dashboard (`/me/favorites`).
 * That tiny duplication is acceptable; we'd promote favorites to its own
 * module only if the logic gets non-trivial.
 */
import { db } from '../../shared/db.js';

export async function listProblems({ where, args, userId, limit, offset }, executor = db) {
  const totalWhereSql = where.length ? `WHERE ${bindWhere(where, 1)}` : '';
  const totalRow = await executor.maybeOne(`
    SELECT COUNT(*)::int AS n
    FROM problems p
    LEFT JOIN categories c ON c.id = p.category_id
    ${totalWhereSql}
  `, args);

  const rowsWhereSql = where.length ? `WHERE ${bindWhere(where, 4)}` : '';
  const rows = await executor.many(`
    SELECT
      p.id, p.slug, p.title, p.difficulty, p.problem_type, p.tags, p.is_premium,
      p.total_submissions, p.accepted_submissions, p.created_at,
      c.slug AS category_slug, c.name AS category_name,
      EXISTS(
        SELECT 1
        FROM submissions s
        WHERE s.user_id = $1 AND s.problem_id = p.id AND s.status = 'ACCEPTED'
      ) AS solved,
      EXISTS(
        SELECT 1
        FROM submissions s
        WHERE s.user_id = $2 AND s.problem_id = p.id
      ) AS attempted,
      EXISTS(
        SELECT 1
        FROM favorites f
        WHERE f.user_id = $3 AND f.problem_id = p.id
      ) AS favorited
    FROM problems p
    LEFT JOIN categories c ON c.id = p.category_id
    ${rowsWhereSql}
    ORDER BY p.id ASC
    LIMIT $${4 + args.length} OFFSET $${5 + args.length}
  `, [userId, userId, userId, ...args, limit, offset]);

  return { rows, total: totalRow?.n ?? 0 };
}

export const findProblemBySlug = (slug, executor = db) =>
  executor.maybeOne(`
    SELECT p.*, c.slug AS category_slug, c.name AS category_name
    FROM problems p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.slug = $1
  `, [slug]);

export const findProblemIdBySlug = (slug, executor = db) =>
  executor.maybeOne(`SELECT id FROM problems WHERE slug = $1`, [slug]);

export const findCategoryBySlug = (slug, executor = db) =>
  executor.maybeOne(
    `SELECT id, slug, name FROM categories WHERE slug = $1`,
    [slug],
  );

export async function insertProblem({
  slug,
  title,
  description,
  difficulty,
  problemType,
  categoryId,
  tags,
  examplesJson,
  constraints,
  hintsJson,
  starterCodeJson,
  expectedOutput,
  testCasesJson,
  sqlSetup,
  functionName,
  timeLimitMs,
  memoryLimitMb,
  isPremium,
  outputSizeCapKb,
  comparatorMode,
  languageAllowlist,
}, executor = db) {
  return executor.maybeOne(`
    INSERT INTO problems (
      slug, title, description, difficulty, problem_type, category_id, tags,
      examples_json, constraints, hints_json, starter_code_json, expected_output,
      test_cases_json, sql_setup, function_name, time_limit_ms, memory_limit_mb, is_premium,
      output_size_cap_kb, comparator_mode, language_allowlist
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7,
      $8, $9, $10, $11, $12,
      $13, $14, $15, $16, $17, $18,
      $19, $20, $21
    )
    RETURNING id, slug
  `, [
    slug, title, description, difficulty, problemType, categoryId, tags,
    examplesJson, constraints, hintsJson, starterCodeJson, expectedOutput,
    testCasesJson, sqlSetup, functionName, timeLimitMs, memoryLimitMb, isPremium,
    outputSizeCapKb ?? null, comparatorMode ?? null, languageAllowlist ?? null,
  ]);
}

export async function updateProblem(problemId, fields, executor = db) {
  const cols = [];
  const args = [];
  const addCol = (name, value) => {
    cols.push(`${name} = $${args.length + 1}`);
    args.push(value);
  };

  if (fields.title !== undefined) addCol('title', fields.title);
  if (fields.description !== undefined) addCol('description', fields.description);
  if (fields.difficulty !== undefined) addCol('difficulty', fields.difficulty);
  if (fields.problemType !== undefined) addCol('problem_type', fields.problemType);
  if (fields.categoryId !== undefined) addCol('category_id', fields.categoryId);
  if (fields.tags !== undefined) addCol('tags', fields.tags);
  if (fields.examplesJson !== undefined) addCol('examples_json', fields.examplesJson);
  if (fields.constraints !== undefined) addCol('constraints', fields.constraints);
  if (fields.hintsJson !== undefined) addCol('hints_json', fields.hintsJson);
  if (fields.starterCodeJson !== undefined) addCol('starter_code_json', fields.starterCodeJson);
  if (fields.expectedOutput !== undefined) addCol('expected_output', fields.expectedOutput);
  if (fields.testCasesJson !== undefined) addCol('test_cases_json', fields.testCasesJson);
  if (fields.sqlSetup !== undefined) addCol('sql_setup', fields.sqlSetup);
  if (fields.functionName !== undefined) addCol('function_name', fields.functionName);
  if (fields.timeLimitMs !== undefined) addCol('time_limit_ms', fields.timeLimitMs);
  if (fields.memoryLimitMb !== undefined) addCol('memory_limit_mb', fields.memoryLimitMb);
  if (fields.isPremium !== undefined) addCol('is_premium', fields.isPremium);
  if (fields.outputSizeCapKb !== undefined) addCol('output_size_cap_kb', fields.outputSizeCapKb);
  if (fields.comparatorMode !== undefined) addCol('comparator_mode', fields.comparatorMode);
  if (fields.languageAllowlist !== undefined) addCol('language_allowlist', fields.languageAllowlist);
  if (cols.length === 0) return;

  args.push(problemId);
  await executor.none(
    `UPDATE problems SET ${cols.join(', ')} WHERE id = $${args.length}`,
    args,
  );
}

export const deleteProblem = (problemId, executor = db) =>
  executor.none(`DELETE FROM problems WHERE id = $1`, [problemId]);

export const getProblemUsage = (problemId, executor = db) =>
  executor.maybeOne(`
    SELECT
      (SELECT COUNT(*)::int FROM course_problems WHERE problem_id = $1) AS course_refs,
      (SELECT COUNT(*)::int FROM exam_problems WHERE problem_id = $1) AS exam_refs,
      (SELECT COUNT(*)::int FROM submissions WHERE problem_id = $1) AS submission_refs
  `, [problemId]);

export async function userHasSolvedProblem(userId, problemId, executor = db) {
  return !!(await executor.maybeOne(`
    SELECT 1
    FROM submissions
    WHERE user_id = $1 AND problem_id = $2 AND status = 'ACCEPTED'
  `, [userId, problemId]));
}

export async function userHasAttemptedProblem(userId, problemId, executor = db) {
  return !!(await executor.maybeOne(
    `SELECT 1 FROM submissions WHERE user_id = $1 AND problem_id = $2`,
    [userId, problemId],
  ));
}

export async function userHasFavorited(userId, problemId, executor = db) {
  return !!(await executor.maybeOne(
    `SELECT 1 FROM favorites WHERE user_id = $1 AND problem_id = $2`,
    [userId, problemId],
  ));
}

export function addFavorite(userId, problemId, executor = db) {
  return executor.none(`
    INSERT INTO favorites (user_id, problem_id)
    VALUES ($1, $2)
    ON CONFLICT (user_id, problem_id) DO NOTHING
  `, [userId, problemId]);
}

export function removeFavorite(userId, problemId, executor = db) {
  return executor.none(`DELETE FROM favorites WHERE user_id = $1 AND problem_id = $2`, [userId, problemId]);
}

/* ─── counters (called from submissions service) ────────────────────────── */

export function incrementTotalSubmissions(problemId, executor = db) {
  return executor.none(
    `UPDATE problems SET total_submissions = total_submissions + 1 WHERE id = $1`,
    [problemId],
  );
}

export function incrementAcceptedSubmissions(problemId, executor = db) {
  return executor.none(
    `UPDATE problems SET accepted_submissions = accepted_submissions + 1 WHERE id = $1`,
    [problemId],
  );
}

function bindWhere(clauses, startAt) {
  let index = startAt;
  return clauses
    .map((clause) => clause.replace(/\?/g, () => `$${index++}`))
    .join(' AND ');
}
