/**
 * Integration tests for `PUT /api/users/:id/role` — the admin-only role
 * management endpoint introduced in Phase 1 #2 (ADR 0006).
 *
 * Drives the full stack (routes → requireRole(ADMIN) → service →
 * transaction → queries → Postgres). Covered:
 *
 *   - 401 without Bearer token, 401 with garbage token
 *   - 403 with a STUDENT token
 *   - 403 with an INSTRUCTOR token (only ADMIN may change roles)
 *   - 400 on invalid role string (zod), invalid id, missing body
 *   - 404 on unknown user id
 *   - 200 on STUDENT → INSTRUCTOR promotion (DB updated)
 *   - 200 on INSTRUCTOR → ADMIN promotion
 *   - 400 on demoting the last ADMIN to STUDENT (self-demote)
 *   - 200 on demoting the last ADMIN once another ADMIN exists
 *   - 200 idempotent: setting the same role is a no-op
 */
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ||= 'postgresql://postgres:postgres@127.0.0.1:5432/skillforge_test';
process.env.JWT_SECRET = 'integration-users-roles-jwt';
process.env.AUTH_PROVIDERS = 'local';
delete process.env.GOOGLE_CLIENT_ID;
delete process.env.GOOGLE_CLIENT_SECRET;

const request = (await import('supertest')).default;
const { db } = await import('../src/shared/db.js');
const { runMigrations } = await import('../src/shared/migrations.js');
const { createApp } = await import('../src/app.js');

await runMigrations();
await db.exec(`
  TRUNCATE TABLE
    refresh_tokens, oauth_states, favorites, submissions, problems, categories, users
  RESTART IDENTITY CASCADE
`);

const app = createApp();
const api = request(app);

let pass = 0;
let fail = 0;
function expect(name, cond, extra = '') {
  if (cond) {
    console.log(`  ok  ${name}`);
    pass++;
  } else {
    console.log(`  FAIL ${name} ${extra}`);
    fail++;
  }
}

const bearer = (token) => ({ Authorization: `Bearer ${token}` });

/* ─── precondition: register three users — admin, bob, charlie ──────────── */

const adminReg = await api.post('/api/auth/register').send({
  username: 'theadmin', email: 'admin@u.test', password: 'changeme123',
});
expect('precondition: register admin -> 201',
  adminReg.status === 201 && adminReg.body.user.role === 'ADMIN');

const bobReg = await api.post('/api/auth/register').send({
  username: 'bob', email: 'bob@u.test', password: 'changeme123',
});
expect('precondition: register bob -> 201 STUDENT',
  bobReg.status === 201 && bobReg.body.user.role === 'STUDENT');

const charlieReg = await api.post('/api/auth/register').send({
  username: 'charlie', email: 'charlie@u.test', password: 'changeme123',
});
expect('precondition: register charlie -> 201 STUDENT',
  charlieReg.status === 201 && charlieReg.body.user.role === 'STUDENT');

const adminTok = adminReg.body.accessToken;
const bobTok = bobReg.body.accessToken;
const charlieTok = charlieReg.body.accessToken;
const adminId = adminReg.body.user.id;
const bobId = bobReg.body.user.id;
const charlieId = charlieReg.body.user.id;

/* ─── auth gating ───────────────────────────────────────────────────────── */

console.log('—— auth gating ——');
{
  const noAuth = await api.put(`/api/users/${bobId}/role`).send({ role: 'INSTRUCTOR' });
  expect('PUT /api/users/:id/role without token -> 401',
    noAuth.status === 401, `got ${noAuth.status}`);

  const garbage = await api.put(`/api/users/${bobId}/role`)
    .set(bearer('not-a-real-jwt')).send({ role: 'INSTRUCTOR' });
  expect('PUT /api/users/:id/role with garbage token -> 401',
    garbage.status === 401, `got ${garbage.status}`);

  const studentDenied = await api.put(`/api/users/${bobId}/role`)
    .set(bearer(charlieTok)).send({ role: 'INSTRUCTOR' });
  expect('PUT /api/users/:id/role with STUDENT token -> 403',
    studentDenied.status === 403, `got ${studentDenied.status}`);
}

/* ─── promote bob STUDENT -> INSTRUCTOR ─────────────────────────────────── */

console.log('—— promote ——');
{
  const res = await api.put(`/api/users/${bobId}/role`)
    .set(bearer(adminTok)).send({ role: 'INSTRUCTOR' });
  expect('admin promotes bob STUDENT -> INSTRUCTOR -> 200',
    res.status === 200 && res.body.role === 'INSTRUCTOR' && res.body.id === bobId,
    `got ${res.status} ${JSON.stringify(res.body)}`);

  const dbRole = await db.value(`SELECT role FROM users WHERE id = $1`, [bobId], 'role');
  expect('DB confirms bob.role = INSTRUCTOR', dbRole === 'INSTRUCTOR', `got ${dbRole}`);

  // Bob's existing access token still works for non-role-gated routes
  // (the JWT carries his old role but requireRole always re-reads from DB
  // via findUserById so the new INSTRUCTOR role takes effect immediately).
  // We don't assert on a role-gated route here — none exist yet; that
  // test arrives with the courses module.

  // INSTRUCTOR is still NOT allowed to call PUT /role — only ADMIN is.
  const instructorDenied = await api.put(`/api/users/${charlieId}/role`)
    .set(bearer(bobTok)).send({ role: 'INSTRUCTOR' });
  expect('PUT /api/users/:id/role with INSTRUCTOR token -> 403',
    instructorDenied.status === 403, `got ${instructorDenied.status}`);
}

/* ─── promote bob INSTRUCTOR -> ADMIN ───────────────────────────────────── */

{
  const res = await api.put(`/api/users/${bobId}/role`)
    .set(bearer(adminTok)).send({ role: 'ADMIN' });
  expect('admin promotes bob INSTRUCTOR -> ADMIN -> 200',
    res.status === 200 && res.body.role === 'ADMIN');

  const adminCount = await db.value(
    `SELECT COUNT(*)::int AS n FROM users WHERE role = 'ADMIN'`, [], 'n',
  );
  expect('admin count is now 2', adminCount === 2, `got ${adminCount}`);
}

/* ─── idempotent: same role is a no-op ──────────────────────────────────── */

{
  const res = await api.put(`/api/users/${bobId}/role`)
    .set(bearer(adminTok)).send({ role: 'ADMIN' });
  expect('setting role to current value is idempotent (200 + role unchanged)',
    res.status === 200 && res.body.role === 'ADMIN');
}

/* ─── input validation ──────────────────────────────────────────────────── */

console.log('—— validation ——');
{
  const badRole = await api.put(`/api/users/${charlieId}/role`)
    .set(bearer(adminTok)).send({ role: 'GOD' });
  expect('PUT with role="GOD" (not in enum) -> 400',
    badRole.status === 400, `got ${badRole.status}`);

  const noBody = await api.put(`/api/users/${charlieId}/role`)
    .set(bearer(adminTok)).send({});
  expect('PUT with empty body -> 400',
    noBody.status === 400, `got ${noBody.status}`);

  const badId = await api.put('/api/users/abc/role')
    .set(bearer(adminTok)).send({ role: 'INSTRUCTOR' });
  expect('PUT with non-numeric id -> 400',
    badId.status === 400, `got ${badId.status}`);

  const negativeId = await api.put('/api/users/-5/role')
    .set(bearer(adminTok)).send({ role: 'INSTRUCTOR' });
  expect('PUT with negative id -> 400',
    negativeId.status === 400, `got ${negativeId.status}`);

  const unknown = await api.put('/api/users/9999999/role')
    .set(bearer(adminTok)).send({ role: 'INSTRUCTOR' });
  expect('PUT with unknown user id -> 404',
    unknown.status === 404, `got ${unknown.status}`);
}

/* ─── last-admin safeguard ──────────────────────────────────────────────── */

console.log('—— last-ADMIN safeguard ——');

// Currently we have two admins (theadmin + bob). Demote bob first; that's
// allowed because there's still one admin left.
{
  const res = await api.put(`/api/users/${bobId}/role`)
    .set(bearer(adminTok)).send({ role: 'STUDENT' });
  expect('demote bob ADMIN -> STUDENT (other admin still exists) -> 200',
    res.status === 200 && res.body.role === 'STUDENT');

  const adminCount = await db.value(
    `SELECT COUNT(*)::int AS n FROM users WHERE role = 'ADMIN'`, [], 'n',
  );
  expect('admin count is now 1 (only theadmin)', adminCount === 1);
}

// Now theadmin is the only admin. Trying to self-demote must be rejected.
{
  const res = await api.put(`/api/users/${adminId}/role`)
    .set(bearer(adminTok)).send({ role: 'STUDENT' });
  expect('self-demote of the last ADMIN -> 400',
    res.status === 400, `got ${res.status} ${JSON.stringify(res.body)}`);
  expect('error message mentions "last ADMIN"',
    /last admin/i.test(res.body?.error || ''),
    `got ${res.body?.error}`);

  const stillAdmin = await db.value(`SELECT role FROM users WHERE id = $1`, [adminId], 'role');
  expect('theadmin remained ADMIN after the rejected self-demote',
    stillAdmin === 'ADMIN', `got ${stillAdmin}`);
}

// Promote charlie to ADMIN. Now self-demote of theadmin should succeed.
{
  const promote = await api.put(`/api/users/${charlieId}/role`)
    .set(bearer(adminTok)).send({ role: 'ADMIN' });
  expect('admin promotes charlie -> ADMIN', promote.status === 200);

  const selfDemote = await api.put(`/api/users/${adminId}/role`)
    .set(bearer(adminTok)).send({ role: 'STUDENT' });
  expect('self-demote ADMIN -> STUDENT now that another ADMIN exists -> 200',
    selfDemote.status === 200 && selfDemote.body.role === 'STUDENT',
    `got ${selfDemote.status} ${JSON.stringify(selfDemote.body)}`);

  // theadmin's existing token should now no longer give them admin
  // capability — requireRole reads from DB, not from JWT.
  const cantPromoteAnymore = await api.put(`/api/users/${bobId}/role`)
    .set(bearer(adminTok)).send({ role: 'INSTRUCTOR' });
  expect('demoted theadmin can no longer call /role -> 403',
    cantPromoteAnymore.status === 403,
    `got ${cantPromoteAnymore.status}`);
}

/* ─── cleanup ───────────────────────────────────────────────────────────── */

console.log(`\n${pass} passed, ${fail} failed.`);

await db.close();

if (fail) process.exit(1);
