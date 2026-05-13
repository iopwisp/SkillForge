/**
 * Integration tests for /api/auth/* via supertest. Drives the full
 * express stack (routes → service → providers → queries → Postgres) so a
 * regression in any of those layers breaks here, not just inside a unit
 * test that mocks the DB.
 *
 * Covered:
 *   - POST /api/auth/register: 201 + tokens; 409 on duplicate; 400 on bad body
 *   - POST /api/auth/login: 200 (by username and by email); 401 on wrong pw
 *     and unknown user with identical message (no enumeration)
 *   - GET  /api/auth/me: 401 without token, 401 on garbage token, 200 with
 *     a valid access token (returns the public-shaped user without
 *     password_hash)
 *   - POST /api/auth/refresh: rotates, double-use returns 401, missing body
 *     returns 400, /me works with the new access token
 *   - POST /api/auth/logout: revokes the refresh token (subsequent refresh
 *     returns 401)
 *   - GET  /api/auth/providers: lists local + google, with google.enabled
 *     reflecting the absence of GOOGLE_CLIENT_ID
 *   - GET  /api/health: returns UP
 *
 * Tests run against the real `skillforge_test` Postgres (same as the rest
 * of the test suite). The shared schema is migrated and the relevant
 * tables are truncated up front.
 */
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ||= 'postgresql://postgres:postgres@127.0.0.1:5432/skillforge_test';
process.env.JWT_SECRET = 'integration-auth-jwt-secret';
process.env.AUTH_PROVIDERS = 'local,google';
delete process.env.GOOGLE_CLIENT_ID;
delete process.env.GOOGLE_CLIENT_SECRET;

const request = (await import('supertest')).default;
const { db } = await import('../src/shared/db.js');
const { runMigrations } = await import('../src/shared/migrations.js');
const { createApp } = await import('../src/app.js');

await runMigrations();
await db.exec(`
  TRUNCATE TABLE
    refresh_tokens,
    oauth_states,
    favorites,
    submissions,
    problems,
    categories,
    users
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

/* ─── 0. health ────────────────────────────────────────────────────────── */

{
  const res = await api.get('/api/health');
  expect('GET /api/health -> 200 UP',
    res.status === 200 && res.body?.status === 'UP',
    `status=${res.status} body=${JSON.stringify(res.body)}`);
}

/* ─── 1. register ──────────────────────────────────────────────────────── */

const REG_BODY = {
  username: 'alice_int',
  email: 'alice.int@test.io',
  password: 'changeme123',
  fullName: 'Alice Integration',
};

const regRes = await api.post('/api/auth/register').send(REG_BODY);
expect('POST /api/auth/register -> 201',
  regRes.status === 201,
  `status=${regRes.status} body=${JSON.stringify(regRes.body)}`);
expect('register response carries access + refresh tokens',
  typeof regRes.body?.accessToken === 'string'
   && typeof regRes.body?.refreshToken === 'string'
   && regRes.body?.tokenType === 'Bearer'
   && typeof regRes.body?.expiresIn === 'number');
expect('register response.user is public-shaped (no password_hash)',
  regRes.body?.user
   && regRes.body.user.username === 'alice_int'
   && regRes.body.user.email === 'alice.int@test.io'
   && regRes.body.user.fullName === 'Alice Integration'
   && regRes.body.user.rating === 1200
   && regRes.body.user.password_hash === undefined);
// First user on a fresh installation is bootstrapped as ADMIN — see ADR 0006.
expect('first user on a fresh install is ADMIN',
  regRes.body.user.role === 'ADMIN',
  `got role=${regRes.body.user?.role}`);

const secondReg = await api.post('/api/auth/register').send({
  username: 'bob_int',
  email: 'bob.int@test.io',
  password: 'changeme123',
  fullName: 'Bob Integration',
});
expect('second user registers successfully',
  secondReg.status === 201, `status=${secondReg.status}`);
expect('second user defaults to STUDENT (ADR 0006)',
  secondReg.body.user?.role === 'STUDENT',
  `got role=${secondReg.body.user?.role}`);

const dupRes = await api.post('/api/auth/register').send({
  username: 'alice_int', email: 'other@test.io', password: 'changeme123',
});
expect('POST /api/auth/register duplicate username -> 409',
  dupRes.status === 409,
  `status=${dupRes.status} body=${JSON.stringify(dupRes.body)}`);

const badBodyRes = await api.post('/api/auth/register').send({
  username: 'al', email: 'not-an-email', password: '123',
});
expect('POST /api/auth/register invalid body -> 400',
  badBodyRes.status === 400,
  `status=${badBodyRes.status} body=${JSON.stringify(badBodyRes.body)}`);

/* ─── 2. login ─────────────────────────────────────────────────────────── */

const loginUsername = await api.post('/api/auth/login').send({
  emailOrUsername: 'alice_int', password: 'changeme123',
});
expect('POST /api/auth/login by username -> 200 with same user id',
  loginUsername.status === 200 && loginUsername.body.user?.id === regRes.body.user.id);

const loginEmail = await api.post('/api/auth/login').send({
  emailOrUsername: 'alice.int@test.io', password: 'changeme123',
});
expect('POST /api/auth/login by email -> 200 with same user id',
  loginEmail.status === 200 && loginEmail.body.user?.id === regRes.body.user.id);

const wrongPw = await api.post('/api/auth/login').send({
  emailOrUsername: 'alice_int', password: 'WRONG-pw',
});
expect('POST /api/auth/login wrong password -> 401',
  wrongPw.status === 401);

const unknownUser = await api.post('/api/auth/login').send({
  emailOrUsername: 'noone_here', password: 'whatever-pw',
});
expect('POST /api/auth/login unknown user -> 401',
  unknownUser.status === 401);

expect('wrong-password and unknown-user share message (no enumeration)',
  wrongPw.body?.error === unknownUser.body?.error
   && /invalid/i.test(wrongPw.body?.error || ''));

/* ─── 3. /me ───────────────────────────────────────────────────────────── */

const meNoToken = await api.get('/api/auth/me');
expect('GET /api/auth/me without token -> 401', meNoToken.status === 401);

const meBadToken = await api.get('/api/auth/me')
  .set('Authorization', 'Bearer not-a-valid-token');
expect('GET /api/auth/me with bad token -> 401', meBadToken.status === 401);

const meOk = await api.get('/api/auth/me')
  .set('Authorization', `Bearer ${regRes.body.accessToken}`);
expect('GET /api/auth/me with valid token -> 200 + public user',
  meOk.status === 200
   && meOk.body?.id === regRes.body.user.id
   && meOk.body?.username === 'alice_int'
   && meOk.body?.password_hash === undefined,
  `status=${meOk.status} body=${JSON.stringify(meOk.body)}`);

/* ─── 4. refresh: rotation + double-use rejection ──────────────────────── */

const refreshMissing = await api.post('/api/auth/refresh').send({});
expect('POST /api/auth/refresh without token -> 400',
  refreshMissing.status === 400);

const refreshOk = await api.post('/api/auth/refresh').send({
  refreshToken: regRes.body.refreshToken,
});
expect('POST /api/auth/refresh -> 200 + new tokens',
  refreshOk.status === 200
   && typeof refreshOk.body?.accessToken === 'string'
   && typeof refreshOk.body?.refreshToken === 'string'
   && refreshOk.body.refreshToken !== regRes.body.refreshToken);

const refreshReuse = await api.post('/api/auth/refresh').send({
  refreshToken: regRes.body.refreshToken,
});
expect('POST /api/auth/refresh re-using a rotated token -> 401',
  refreshReuse.status === 401);

const meAfterRefresh = await api.get('/api/auth/me')
  .set('Authorization', `Bearer ${refreshOk.body.accessToken}`);
expect('GET /api/auth/me with refreshed access token -> 200',
  meAfterRefresh.status === 200 && meAfterRefresh.body?.id === regRes.body.user.id);

/* ─── 5. logout: revokes refresh token ─────────────────────────────────── */

const logoutRes = await api.post('/api/auth/logout').send({
  refreshToken: refreshOk.body.refreshToken,
});
expect('POST /api/auth/logout -> 200', logoutRes.status === 200 && logoutRes.body?.ok === true);

const refreshAfterLogout = await api.post('/api/auth/refresh').send({
  refreshToken: refreshOk.body.refreshToken,
});
expect('POST /api/auth/refresh after logout -> 401',
  refreshAfterLogout.status === 401);

/* ─── 6. providers discovery ───────────────────────────────────────────── */

{
  const res = await api.get('/api/auth/providers');
  expect('GET /api/auth/providers -> 200', res.status === 200);
  const list = Array.isArray(res.body) ? res.body : [];
  const local = list.find((p) => p.name === 'local');
  const google = list.find((p) => p.name === 'google');
  expect('providers list includes local (password, enabled=true)',
    local && local.type === 'password' && local.enabled === true);
  expect('providers list includes google (oauth2, enabled=false without GOOGLE_CLIENT_ID)',
    google && google.type === 'oauth2' && google.enabled === false);
}

/* ─── 7. unknown route -> 404 ──────────────────────────────────────────── */

{
  const res = await api.get('/api/does-not-exist');
  expect('GET /api/does-not-exist -> 404', res.status === 404);
}

/* ─── cleanup ──────────────────────────────────────────────────────────── */

console.log(`\n${pass} passed, ${fail} failed.`);

await db.close();

if (fail) process.exit(1);
