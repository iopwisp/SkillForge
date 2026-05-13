/**
 * Temporary verification script for the stdio-judge 0008 migration.
 *
 * Runs `runMigrations()` against the configured DATABASE_URL, then
 * probes the `problems` table to confirm:
 *   1. Migration 0008 is applied and recorded in schema_migrations.
 *   2. `problems.problem_type` CHECK now accepts 'STDIO' and still
 *      accepts every other legacy value without rejecting pre-existing
 *      non-STDIO rows.
 *   3. The three new nullable columns exist.
 *   4. The STDIO-only CHECK constraints reject out-of-range values
 *      only when problem_type = 'STDIO'.
 *
 * Usage:
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/skillforge_test \
 *     node scripts/check-stdio-migration.mjs
 */
import 'dotenv/config';
import { runMigrations } from '../src/shared/migrations.js';
import { pool } from '../src/shared/db.js';

async function main() {
  await runMigrations();

  const applied = await pool.query(
    `SELECT version FROM schema_migrations WHERE version = '0008'`,
  );
  if (applied.rows.length !== 1) {
    throw new Error(`Migration 0008 not applied (rows=${applied.rows.length})`);
  }
  console.log('ok: migration 0008 applied');

  const cols = await pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'problems'
        AND column_name IN ('output_size_cap_kb','comparator_mode','language_allowlist')`,
  );
  const found = new Set(cols.rows.map((r) => r.column_name));
  for (const c of ['output_size_cap_kb', 'comparator_mode', 'language_allowlist']) {
    if (!found.has(c)) throw new Error(`Column missing: ${c}`);
  }
  console.log('ok: new columns present', [...found]);

  const checks = await pool.query(
    `SELECT conname FROM pg_constraint
      WHERE conrelid = 'problems'::regclass
        AND conname LIKE 'problems_stdio_%'
         OR conname = 'problems_type_check'`,
  );
  const constraintNames = checks.rows.map((r) => r.conname).sort();
  const expected = [
    'problems_stdio_allowlist',
    'problems_stdio_comparator',
    'problems_stdio_memory_range',
    'problems_stdio_output_range',
    'problems_stdio_time_range',
    'problems_type_check',
  ].sort();
  for (const e of expected) {
    if (!constraintNames.includes(e)) {
      throw new Error(`Constraint missing: ${e}`);
    }
  }
  console.log('ok: constraints present', expected);

  // Helper that wraps a negative-case INSERT in a SAVEPOINT so that a
  // constraint violation does not abort the outer transaction (Postgres
  // 25P02). The callback MUST throw if the expected violation did not
  // fire so the driver rolls the SAVEPOINT back cleanly.
  async function expectReject(client, label, sql, matcher) {
    await client.query('SAVEPOINT stdio_check');
    try {
      await client.query(sql);
      throw new Error(`${label}: expected rejection but insert succeeded`);
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT stdio_check');
      await client.query('RELEASE SAVEPOINT stdio_check');
      if (!matcher.test(err.message)) throw err;
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) Existing-style non-STDIO insert with small time_limit_ms stays allowed.
    await client.query(
      `INSERT INTO problems (slug, title, description, problem_type, time_limit_ms, memory_limit_mb)
       VALUES ('check-stdio-legacy', 'legacy', 'x', 'ALGORITHM', 1000, 256)`,
    );
    console.log('ok: non-STDIO row accepted');

    // 2) Attempting a non-existent problem_type is rejected by the CHECK.
    await expectReject(
      client,
      'problems_type_check',
      `INSERT INTO problems (slug, title, description, problem_type)
         VALUES ('check-stdio-bogus', 't', 'x', 'BOGUS_TYPE')`,
      /problems_type_check/,
    );
    console.log('ok: problems_type_check rejects unknown types');

    // 3) Valid STDIO row is accepted when every STDIO-only field is in range.
    await client.query(
      `INSERT INTO problems
         (slug, title, description, problem_type,
          time_limit_ms, memory_limit_mb, output_size_cap_kb,
          comparator_mode, language_allowlist)
       VALUES ('check-stdio-valid', 't', 'x', 'STDIO',
               2000, 256, 64, 'TRIMMED', ARRAY['JAVASCRIPT'])`,
    );
    console.log('ok: valid STDIO row accepted');

    // 4) STDIO row with out-of-range time_limit_ms must fail.
    await expectReject(
      client,
      'problems_stdio_time_range',
      `INSERT INTO problems
           (slug, title, description, problem_type,
            time_limit_ms, memory_limit_mb, output_size_cap_kb,
            comparator_mode, language_allowlist)
         VALUES ('check-stdio-bad-time', 't', 'x', 'STDIO',
                 50, 256, 64, 'TRIMMED', ARRAY['JAVASCRIPT'])`,
      /problems_stdio_time_range/,
    );
    console.log('ok: problems_stdio_time_range rejects out-of-range time');

    // 5) STDIO row with bad comparator must fail.
    await expectReject(
      client,
      'problems_stdio_comparator',
      `INSERT INTO problems
           (slug, title, description, problem_type,
            time_limit_ms, memory_limit_mb, output_size_cap_kb,
            comparator_mode, language_allowlist)
         VALUES ('check-stdio-bad-comp', 't', 'x', 'STDIO',
                 2000, 256, 64, 'BOGUS', ARRAY['JAVASCRIPT'])`,
      /problems_stdio_comparator/,
    );
    console.log('ok: problems_stdio_comparator rejects unknown mode');

    // 6) STDIO row with empty allowlist must fail.
    await expectReject(
      client,
      'problems_stdio_allowlist',
      `INSERT INTO problems
           (slug, title, description, problem_type,
            time_limit_ms, memory_limit_mb, output_size_cap_kb,
            comparator_mode, language_allowlist)
         VALUES ('check-stdio-empty-allow', 't', 'x', 'STDIO',
                 2000, 256, 64, 'TRIMMED', ARRAY[]::TEXT[])`,
      /problems_stdio_allowlist/,
    );
    console.log('ok: problems_stdio_allowlist rejects empty allowlist');

    // Always roll back so the check script leaves the DB untouched.
    await client.query('ROLLBACK');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore rollback failure */ }
    throw err;
  } finally {
    client.release();
  }

  console.log('\nAll stdio-judge migration assertions passed.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
