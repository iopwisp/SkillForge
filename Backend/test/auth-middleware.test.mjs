/**
 * Unit-ish coverage for the auth middleware itself: ROLES constant +
 * requireRole(...) factory + requireAuth/optionalAuth wiring.
 *
 * We mount a tiny standalone Express app with a couple of role-gated
 * endpoints (rather than touching `createApp()` from `src/app.js`,
 * which has no role-gated routes yet — those land in subsequent
 * Phase 1 commits). Real Postgres is used so the JWT → findUserById
 * lookup is exercised end-to-end, including a STUDENT vs ADMIN check.
 */
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ||= 'postgresql://postgres:postgres@127.0.0.1:5432/skillforge_test';
process.env.JWT_SECRET = 'auth-middleware-test-secret';
process.env.AUTH_PROVIDERS = 'local';
delete process.env.GOOGLE_CLIENT_ID;
delete process.env.GOOGLE_CLIENT_SECRET;

const request = (await import('supertest')).default;
const { default: express } = await import('express');

const { db } = await import('../src/shared/db.js');
const { runMigrations } = await import('../src/shared/migrations.js');
const auth = await import('../src/modules/auth/service.js');
const {
  ROLES, requireAuth, optionalAuth, requireRole,
} = await import('../src/modules/auth/middleware.js');

await runMigrations();
await db.exec(`
  TRUNCATE TABLE
    refresh_tokens, oauth_states, favorites, submissions, problems, categories, users
  RESTART IDENTITY CASCADE
`);

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

/* ─── 1. ROLES constant ─────────────────────────────────────────────────── */

expect('ROLES has STUDENT, INSTRUCTOR and ADMIN, all string-equal to themselves',
  ROLES.STUDENT === 'STUDENT' && ROLES.INSTRUCTOR === 'INSTRUCTOR' && ROLES.ADMIN === 'ADMIN');

expect('ROLES is frozen — accidental mutation must throw / fail silently',
  Object.isFrozen(ROLES));

/* ─── 2. requireRole input validation ───────────────────────────────────── */

let threw = null;
try { requireRole(); } catch (e) { threw = e; }
expect('requireRole() with no arguments throws (would otherwise allow everyone)',
  threw instanceof Error && /no roles/i.test(threw.message),
  String(threw));

threw = null;
try { requireRole('AMDIN'); } catch (e) { threw = e; }
expect('requireRole("AMDIN") (typo) throws — must use ROLES.* constants',
  threw instanceof Error && /unknown role/i.test(threw.message),
  String(threw));

threw = null;
try { requireRole(ROLES.STUDENT); } catch (e) { threw = e; }
expect('requireRole(ROLES.STUDENT) constructs without throwing',
  threw === null);

/* ─── 3. live HTTP behaviour: register two users (ADMIN + STUDENT) ──────── */

// Use the real auth.register because it implements the
// "first user becomes ADMIN" bootstrap from ADR 0006.
const adminAuth = await auth.register({
  username: 'admin1', email: 'admin@test.io', password: 'changeme123',
});
expect('first registered user is ADMIN', adminAuth.user.role === 'ADMIN',
  `role=${adminAuth.user.role}`);

const studentAuth = await auth.register({
  username: 'student1', email: 'student@test.io', password: 'changeme123',
});
expect('second registered user is STUDENT', studentAuth.user.role === 'STUDENT',
  `role=${studentAuth.user.role}`);

/* ─── 4. mini express app with role-gated routes ────────────────────────── */

const app = express();
app.use(express.json());

app.get('/auth-required', requireAuth, (req, res) => {
  res.json({ id: req.user.id, role: req.user.role });
});
app.get('/optional', optionalAuth, (req, res) => {
  res.json({ user: req.user ? { id: req.user.id, role: req.user.role } : null });
});
app.get('/admin-only', requireRole(ROLES.ADMIN), (req, res) => {
  res.json({ id: req.user.id, role: req.user.role });
});
app.get('/teach-only', requireRole(ROLES.INSTRUCTOR, ROLES.ADMIN), (req, res) => {
  res.json({ id: req.user.id, role: req.user.role });
});
app.use((err, _req, res, _next) => {
  // Surface unexpected throws as 500 so tests can assert on them.
  res.status(500).json({ error: err.message });
});

const api = request(app);

/* ─── 5. requireAuth ────────────────────────────────────────────────────── */

{
  const noAuth = await api.get('/auth-required');
  expect('GET /auth-required without token -> 401', noAuth.status === 401);

  const garbage = await api.get('/auth-required').set('Authorization', 'Bearer not-a-real-token');
  expect('GET /auth-required with garbage token -> 401', garbage.status === 401);

  const ok = await api.get('/auth-required').set('Authorization', `Bearer ${adminAuth.accessToken}`);
  expect('GET /auth-required with valid admin token -> 200',
    ok.status === 200 && ok.body.role === 'ADMIN');
}

/* ─── 6. optionalAuth ───────────────────────────────────────────────────── */

{
  const anon = await api.get('/optional');
  expect('GET /optional without token -> 200 with user=null',
    anon.status === 200 && anon.body.user === null);

  const ok = await api.get('/optional').set('Authorization', `Bearer ${studentAuth.accessToken}`);
  expect('GET /optional with student token -> 200 with role=STUDENT',
    ok.status === 200 && ok.body.user?.role === 'STUDENT');
}

/* ─── 7. requireRole(ADMIN) ─────────────────────────────────────────────── */

{
  const noAuth = await api.get('/admin-only');
  expect('GET /admin-only without token -> 401', noAuth.status === 401);

  const garbage = await api.get('/admin-only').set('Authorization', 'Bearer wrong');
  expect('GET /admin-only with garbage token -> 401', garbage.status === 401);

  const studentDenied = await api.get('/admin-only')
    .set('Authorization', `Bearer ${studentAuth.accessToken}`);
  expect('GET /admin-only with STUDENT token -> 403',
    studentDenied.status === 403,
    `got ${studentDenied.status} ${JSON.stringify(studentDenied.body)}`);

  const adminOk = await api.get('/admin-only')
    .set('Authorization', `Bearer ${adminAuth.accessToken}`);
  expect('GET /admin-only with ADMIN token -> 200',
    adminOk.status === 200 && adminOk.body.role === 'ADMIN');
}

/* ─── 8. requireRole(INSTRUCTOR, ADMIN) ─────────────────────────────────── */

{
  const studentDenied = await api.get('/teach-only')
    .set('Authorization', `Bearer ${studentAuth.accessToken}`);
  expect('GET /teach-only with STUDENT token -> 403',
    studentDenied.status === 403);

  const adminOk = await api.get('/teach-only')
    .set('Authorization', `Bearer ${adminAuth.accessToken}`);
  expect('GET /teach-only with ADMIN token (multi-role allow) -> 200',
    adminOk.status === 200);
}

/* ─── cleanup ───────────────────────────────────────────────────────────── */

console.log(`\n${pass} passed, ${fail} failed.`);

await db.close();

if (fail) process.exit(1);
