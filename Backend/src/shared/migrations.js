import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { pool } from './db.js';
import { logger } from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, '..', '..', 'db', 'migrations');
const MIGRATION_RE = /^(\d+)_.*\.sql$/;

export async function runMigrations() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Serialise concurrent boots (api + worker, two replicas of the
    // same service, etc.) so two processes don't both see a missing
    // version and both try to INSERT the same row. The session-scoped
    // advisory lock auto-releases on disconnect; we also unlock
    // explicitly in the finally block.
    await client.query(`SELECT pg_advisory_lock(723318)`);

    const appliedRows = await client.query(`SELECT version FROM schema_migrations`);
    const applied = new Set(appliedRows.rows.map((row) => row.version));

    const files = (await fs.readdir(migrationsDir))
      .filter((name) => MIGRATION_RE.test(name))
      .sort((a, b) => a.localeCompare(b));

    const seenVersions = new Set();
    for (const file of files) {
      const [, version] = file.match(MIGRATION_RE);
      if (seenVersions.has(version)) {
        throw new Error(`Duplicate migration version detected: ${version}`);
      }
      seenVersions.add(version);
      if (applied.has(version)) continue;

      const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
      logger.info({ version, file }, 'Applying database migration');

      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(
          `INSERT INTO schema_migrations (version) VALUES ($1)`,
          [version],
        );
        await client.query('COMMIT');
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // Ignore rollback failures and surface the original error.
        }
        throw error;
      }
    }
  } finally {
    try {
      await client.query(`SELECT pg_advisory_unlock(723318)`);
    } catch {
      // The session is being released anyway; the lock will drop on
      // disconnect even if this call fails.
    }
    client.release();
  }
}
