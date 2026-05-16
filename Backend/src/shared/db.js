import { Pool } from 'pg';

const DEFAULT_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:5432/skillforge';

function createExecutor(client) {
  return {
    async query(text, params = []) {
      return client.query(text, params);
    },

    async exec(text) {
      return client.query(text);
    },

    async maybeOne(text, params = []) {
      const result = await client.query(text, params);
      return result.rows[0] ?? null;
    },

    /**
     * Exactly-one helper. Throws if the query returns zero rows. Useful in
     * tests and service layers where a missing row is a programming error
     * that should surface loudly rather than return a silent null.
     */
    async one(text, params = []) {
      const result = await client.query(text, params);
      if (result.rows.length === 0) {
        throw new Error(`db.one: expected exactly one row, got 0`);
      }
      return result.rows[0];
    },

    async many(text, params = []) {
      const result = await client.query(text, params);
      return result.rows;
    },

    async none(text, params = []) {
      await client.query(text, params);
    },

    async value(text, params = [], column) {
      const row = await this.maybeOne(text, params);
      if (!row) return null;
      if (column) return row[column] ?? null;
      const [firstValue] = Object.values(row);
      return firstValue ?? null;
    },
  };
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL || DEFAULT_DATABASE_URL,
  // 20 is the historical pg-pool default; bumping it up to a few
  // hundred under load (or down to ~2 for tests) is a single env var.
  max: parseInt(process.env.PG_POOL_SIZE || '20', 10),
});

export const db = {
  ...createExecutor(pool),
  async close() {
    await pool.end();
  },
};

export async function withTransaction(fn) {
  const client = await pool.connect();
  const tx = createExecutor(client);
  try {
    await client.query('BEGIN');
    const result = await fn(tx);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Ignore rollback failures and surface the original error.
    }
    throw error;
  } finally {
    client.release();
  }
}

export function placeholders(startAt, count) {
  return Array.from({ length: count }, (_, index) => `$${startAt + index}`).join(', ');
}

export default db;
