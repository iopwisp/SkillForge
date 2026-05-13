/**
 * Idempotently create the `skillforge_test` database used by integration
 * tests (and by the existing auth-providers test).
 *
 * Connects to the `postgres` maintenance DB on the same host:port as
 * DATABASE_URL (defaults to localhost:5432, postgres/postgres) and
 * issues a CREATE DATABASE if one is missing.
 *
 * Run: `node scripts/ensure-test-db.mjs`. Safe to run repeatedly.
 */
import 'dotenv/config';
import pg from 'pg';

const dsn = process.env.TEST_DATABASE_URL
  || process.env.DATABASE_URL
  || 'postgresql://postgres:postgres@127.0.0.1:5432/skillforge_test';

const url = new URL(dsn);
const dbName = url.pathname.replace(/^\//, '') || 'skillforge_test';
url.pathname = '/postgres';

const client = new pg.Client({ connectionString: url.toString() });
await client.connect();
const exists = await client.query(
  'SELECT 1 FROM pg_database WHERE datname = $1',
  [dbName],
);
if (exists.rows.length === 0) {
  // pg parameters are not supported by CREATE DATABASE, so identifier-quote.
  await client.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
  console.log(`Created database "${dbName}"`);
} else {
  console.log(`Database "${dbName}" already exists`);
}
await client.end();
