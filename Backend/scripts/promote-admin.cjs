/**
 * One-off helper to promote a user to ADMIN on the Render Postgres.
 *
 * Usage:
 *   DATABASE_URL=... node scripts/promote-admin.cjs <email>
 */
const { Client } = require('pg');

const url = process.env.DATABASE_URL;
const email = process.argv[2];

if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}
if (!email) {
  console.error('Usage: node promote-admin.cjs <email>');
  process.exit(1);
}

(async () => {
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    const before = await c.query(
      'SELECT id, username, email, role FROM users WHERE email = $1',
      [email],
    );
    console.log('before:', JSON.stringify(before.rows, null, 2));

    if (before.rows.length === 0) {
      console.log('User not found. Listing all users in DB:');
      const all = await c.query(
        'SELECT id, username, email, role FROM users ORDER BY id LIMIT 50',
      );
      for (const r of all.rows) {
        console.log(' ', r.id, r.username, r.email, r.role);
      }
      return;
    }

    const upd = await c.query(
      'UPDATE users SET role = $1 WHERE email = $2 RETURNING id, username, email, role',
      ['ADMIN', email],
    );
    console.log('after:', JSON.stringify(upd.rows, null, 2));
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.error('error:', e.message);
  process.exit(1);
});
