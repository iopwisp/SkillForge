/**
 * Integration tests for /api/courses/* — Phase 1 #3 (ADR 0007).
 *
 * Drives the full stack (routes → requireRole(INSTRUCTOR, ADMIN) →
 * service.assertCanMutate → queries → Postgres). Covered:
 *
 *   - Read endpoints: 401 unauth, 200 for any authenticated user, 404 unknown
 *   - Create:    401 unauth, 403 STUDENT, 201 INSTRUCTOR/ADMIN, 409 dup slug,
 *                400 invalid slug / missing title / oversize title
 *   - Update:    403 non-owner INSTRUCTOR, 200 owner, 200 ADMIN-override,
 *                400 empty body, 404 unknown
 *   - Delete:    403 non-owner, 200 owner, 404 already-deleted
 *   - Attach:    201 owner, 409 duplicate, 404 unknown problem, 403 non-owner
 *   - Detach:    200 owner, 404 not-attached, 403 non-owner
 *   - GET detail reflects attached problems with position + slug + difficulty
 */
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ||= 'postgresql://postgres:postgres@127.0.0.1:5432/skillforge_test';
process.env.JWT_SECRET = 'integration-courses-jwt';
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
    group_members, groups,
    course_problems, courses,
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

/* ─── precondition: users + problems ────────────────────────────────────── */

// First user becomes ADMIN (ADR 0006).
const adminReg = await api.post('/api/auth/register').send({
  username: 'theadmin', email: 'admin@u.test', password: 'changeme123',
});
expect('precondition: register admin', adminReg.status === 201 && adminReg.body.user.role === 'ADMIN');
const adminTok = adminReg.body.accessToken;

// Subsequent users are STUDENT.
const inst1Reg = await api.post('/api/auth/register').send({
  username: 'instr1', email: 'instr1@u.test', password: 'changeme123',
});
const inst2Reg = await api.post('/api/auth/register').send({
  username: 'instr2', email: 'instr2@u.test', password: 'changeme123',
});
const studentReg = await api.post('/api/auth/register').send({
  username: 'student1', email: 'student1@u.test', password: 'changeme123',
});

// Promote instr1 + instr2 to INSTRUCTOR.
for (const id of [inst1Reg.body.user.id, inst2Reg.body.user.id]) {
  const r = await api.put(`/api/users/${id}/role`)
    .set(bearer(adminTok)).send({ role: 'INSTRUCTOR' });
  expect(`precondition: promote user #${id} to INSTRUCTOR`, r.status === 200 && r.body.role === 'INSTRUCTOR');
}

// Re-login so the access tokens carry up-to-date user state. Tokens
// minted before promotion still work (requireRole reads from the DB)
// but it's nicer for tests to grab fresh ones.
const inst1Login = await api.post('/api/auth/login').send({
  emailOrUsername: 'instr1', password: 'changeme123',
});
const inst2Login = await api.post('/api/auth/login').send({
  emailOrUsername: 'instr2', password: 'changeme123',
});
const inst1Tok = inst1Login.body.accessToken;
const inst2Tok = inst2Login.body.accessToken;
const studentTok = studentReg.body.accessToken;

// Insert two problems directly so the syllabus tests have something to
// attach. Skip the whole seed; this is faster and keeps the test tied
// only to the contract (slugs).
async function insertProblem(slug, title) {
  await db.none(
    `INSERT INTO problems (slug, title, description, difficulty, problem_type, expected_output)
     VALUES ($1, $2, 'integration-test problem', 'EASY', 'ALGORITHM', 'whatever')`,
    [slug, title],
  );
}
await insertProblem('p-alpha', 'P Alpha');
await insertProblem('p-beta', 'P Beta');

/* ─── read endpoints ────────────────────────────────────────────────────── */

console.log('—— read ——');
{
  const noAuth = await api.get('/api/courses');
  expect('GET /api/courses without token -> 401', noAuth.status === 401);

  const noAuthDetail = await api.get('/api/courses/anything');
  expect('GET /api/courses/:slug without token -> 401', noAuthDetail.status === 401);

  const empty = await api.get('/api/courses').set(bearer(studentTok));
  expect('GET /api/courses with student token returns 200 + empty list',
    empty.status === 200 && Array.isArray(empty.body) && empty.body.length === 0,
    `got ${empty.status} ${JSON.stringify(empty.body)}`);

  const missing = await api.get('/api/courses/does-not-exist').set(bearer(studentTok));
  expect('GET /api/courses/unknown -> 404', missing.status === 404);
}

/* ─── create ────────────────────────────────────────────────────────────── */

console.log('—— create ——');
{
  const noAuth = await api.post('/api/courses').send({ slug: 'x', title: 'X' });
  expect('POST /api/courses without token -> 401', noAuth.status === 401);

  const studentDenied = await api.post('/api/courses')
    .set(bearer(studentTok)).send({ slug: 'cs101', title: 'CS 101' });
  expect('POST /api/courses as STUDENT -> 403',
    studentDenied.status === 403, `got ${studentDenied.status}`);

  const adminCreate = await api.post('/api/courses')
    .set(bearer(adminTok)).send({
      slug: 'admin-course', title: 'Admin Course', description: 'admin-owned',
    });
  expect('POST /api/courses as ADMIN -> 201 owned by admin',
    adminCreate.status === 201
     && adminCreate.body.slug === 'admin-course'
     && adminCreate.body.owner.username === 'theadmin'
     && adminCreate.body.problemCount === 0,
    JSON.stringify(adminCreate.body));

  const inst1Create = await api.post('/api/courses')
    .set(bearer(inst1Tok)).send({
      slug: 'cs101', title: 'CS 101', description: 'instr1-owned',
    });
  expect('POST /api/courses as INSTRUCTOR -> 201 owned by self',
    inst1Create.status === 201
     && inst1Create.body.slug === 'cs101'
     && inst1Create.body.owner.username === 'instr1');

  const dup = await api.post('/api/courses')
    .set(bearer(inst1Tok)).send({ slug: 'cs101', title: 'Duplicate' });
  expect('POST /api/courses with duplicate slug -> 409', dup.status === 409);

  const badSlug = await api.post('/api/courses')
    .set(bearer(inst1Tok)).send({ slug: 'BAD slug!!', title: 'X' });
  expect('POST /api/courses with invalid slug -> 400', badSlug.status === 400);

  const noTitle = await api.post('/api/courses')
    .set(bearer(inst1Tok)).send({ slug: 'no-title' });
  expect('POST /api/courses missing title -> 400', noTitle.status === 400);

  const emptyTitle = await api.post('/api/courses')
    .set(bearer(inst1Tok)).send({ slug: 'empty-title', title: '' });
  expect('POST /api/courses with empty title -> 400', emptyTitle.status === 400);
}

/* ─── list + detail ─────────────────────────────────────────────────────── */

console.log('—— list + detail ——');
{
  // Admin always sees every course (ADR 0008 §Course-visibility).
  const list = await api.get('/api/courses').set(bearer(adminTok));
  expect('GET /api/courses (ADMIN) returns the two created courses',
    list.status === 200 && list.body.length === 2,
    `got ${list.body?.length}`);
  expect('list rows are summary-shaped (slug, title, owner, problemCount)',
    list.body.every((c) => c.slug && c.title && c.owner?.username && c.problemCount === 0));

  const detail = await api.get('/api/courses/cs101').set(bearer(adminTok));
  expect('GET /api/courses/cs101 (ADMIN) returns 200 with empty problems[]',
    detail.status === 200
     && detail.body.slug === 'cs101'
     && Array.isArray(detail.body.problems)
     && detail.body.problems.length === 0);

  // STUDENT hasn't been added to any group, so they see NOTHING
  // (ADR 0008 §Course-visibility). cs101 yields 404, not 403, so
  // "not enrolled" is indistinguishable from "does not exist".
  const studentList = await api.get('/api/courses').set(bearer(studentTok));
  expect('GET /api/courses (STUDENT, not enrolled anywhere) -> empty',
    studentList.status === 200 && studentList.body.length === 0);

  const studentDetail = await api.get('/api/courses/cs101').set(bearer(studentTok));
  expect('GET /api/courses/cs101 (STUDENT, not enrolled) -> 404',
    studentDetail.status === 404,
    `got ${studentDetail.status}`);
}

/* ─── update ────────────────────────────────────────────────────────────── */

console.log('—— update ——');
{
  const otherInstrDenied = await api.put('/api/courses/cs101')
    .set(bearer(inst2Tok)).send({ title: 'Hijack' });
  expect('PUT /api/courses/:slug as non-owner INSTRUCTOR -> 403',
    otherInstrDenied.status === 403, `got ${otherInstrDenied.status}`);

  const ownerUpdate = await api.put('/api/courses/cs101')
    .set(bearer(inst1Tok)).send({ title: 'CS 101 — Spring' });
  expect('PUT /api/courses/:slug as owner -> 200 with new title',
    ownerUpdate.status === 200 && ownerUpdate.body.title === 'CS 101 — Spring');

  const adminOverride = await api.put('/api/courses/cs101')
    .set(bearer(adminTok)).send({ description: 'admin override description' });
  expect('PUT /api/courses/:slug as ADMIN (not owner) -> 200',
    adminOverride.status === 200 && adminOverride.body.description === 'admin override description');

  const empty = await api.put('/api/courses/cs101')
    .set(bearer(inst1Tok)).send({});
  expect('PUT with empty body -> 400', empty.status === 400);

  const unknown = await api.put('/api/courses/no-such-course')
    .set(bearer(inst1Tok)).send({ title: 'irrelevant' });
  expect('PUT unknown course -> 404', unknown.status === 404);
}

/* ─── attach problems ───────────────────────────────────────────────────── */

console.log('—— attach problems ——');
{
  const noOwner = await api.post('/api/courses/cs101/problems')
    .set(bearer(inst2Tok)).send({ problemSlug: 'p-alpha' });
  expect('POST attach as non-owner -> 403', noOwner.status === 403);

  const ok1 = await api.post('/api/courses/cs101/problems')
    .set(bearer(inst1Tok)).send({ problemSlug: 'p-alpha', position: 1 });
  expect('POST attach p-alpha at position 1 -> 201',
    ok1.status === 201 && ok1.body.problem.slug === 'p-alpha' && ok1.body.position === 1);

  const ok2 = await api.post('/api/courses/cs101/problems')
    .set(bearer(adminTok)).send({ problemSlug: 'p-beta', position: 2 });
  expect('POST attach p-beta at position 2 as ADMIN -> 201',
    ok2.status === 201 && ok2.body.problem.slug === 'p-beta');

  const dup = await api.post('/api/courses/cs101/problems')
    .set(bearer(inst1Tok)).send({ problemSlug: 'p-alpha' });
  expect('POST attach same problem twice -> 409', dup.status === 409);

  const unknownProblem = await api.post('/api/courses/cs101/problems')
    .set(bearer(inst1Tok)).send({ problemSlug: 'p-zeta' });
  expect('POST attach unknown problem -> 404',
    unknownProblem.status === 404, `got ${unknownProblem.status}`);

  const unknownCourse = await api.post('/api/courses/no-such/problems')
    .set(bearer(inst1Tok)).send({ problemSlug: 'p-alpha' });
  expect('POST attach to unknown course -> 404', unknownCourse.status === 404);

  const detail = await api.get('/api/courses/cs101').set(bearer(adminTok));
  expect('GET cs101 detail now includes both attached problems in position order',
    detail.status === 200
     && detail.body.problems.length === 2
     && detail.body.problems[0].slug === 'p-alpha'
     && detail.body.problems[1].slug === 'p-beta',
    JSON.stringify(detail.body.problems));
  expect('attached problem rows carry difficulty + position + tags array',
    detail.body.problems[0].difficulty === 'EASY'
     && detail.body.problems[0].position === 1
     && Array.isArray(detail.body.problems[0].tags));

  const list = await api.get('/api/courses').set(bearer(adminTok));
  const cs101 = list.body.find((c) => c.slug === 'cs101');
  expect('list view reflects updated problemCount=2',
    cs101 && cs101.problemCount === 2, `got ${cs101?.problemCount}`);
}

/* ─── detach problems ───────────────────────────────────────────────────── */

console.log('—— detach problems ——');
{
  const noOwner = await api.delete('/api/courses/cs101/problems/p-alpha')
    .set(bearer(inst2Tok));
  expect('DELETE attach as non-owner -> 403', noOwner.status === 403);

  const ok = await api.delete('/api/courses/cs101/problems/p-alpha')
    .set(bearer(inst1Tok));
  expect('DELETE attach as owner -> 200',
    ok.status === 200 && ok.body.ok === true);

  const again = await api.delete('/api/courses/cs101/problems/p-alpha')
    .set(bearer(inst1Tok));
  expect('DELETE attach when not-attached -> 404', again.status === 404);

  const detail = await api.get('/api/courses/cs101').set(bearer(adminTok));
  expect('detail no longer lists p-alpha (only p-beta remains)',
    detail.body.problems.length === 1 && detail.body.problems[0].slug === 'p-beta');
}

/* ─── delete course ─────────────────────────────────────────────────────── */

console.log('—— delete course ——');
{
  const noOwner = await api.delete('/api/courses/cs101').set(bearer(inst2Tok));
  expect('DELETE /api/courses/:slug as non-owner -> 403', noOwner.status === 403);

  const ok = await api.delete('/api/courses/cs101').set(bearer(inst1Tok));
  expect('DELETE /api/courses/:slug as owner -> 200',
    ok.status === 200 && ok.body.ok === true);

  const gone = await api.get('/api/courses/cs101').set(bearer(adminTok));
  expect('after delete, GET /api/courses/cs101 -> 404', gone.status === 404);

  const noLinkLeft = await db.value(
    `SELECT COUNT(*)::int AS n FROM course_problems
     WHERE course_id NOT IN (SELECT id FROM courses)`, [], 'n',
  );
  expect('orphan course_problems are gone (ON DELETE CASCADE)', noLinkLeft === 0);

  const again = await api.delete('/api/courses/cs101').set(bearer(inst1Tok));
  expect('DELETE again -> 404', again.status === 404);
}

/* ─── ownership preservation: deleting a course-owner is blocked by FK ───
 *
 * We don't expose a "delete user" endpoint yet, but the FK contract from
 * ADR 0007 ("user that owns courses cannot be deleted") still has to hold
 * at the database level. At this point admin still owns `admin-course`,
 * so a direct DELETE must be rejected. */

console.log('—— FK guard ——');
{
  const adminId = adminReg.body.user.id;
  let blocked = null;
  try {
    await db.exec(`DELETE FROM users WHERE id = ${adminId}`);
  } catch (e) {
    blocked = e;
  }
  expect('DELETE FROM users on a course-owner is rejected by Postgres FK',
    blocked && /violates foreign key/i.test(blocked.message),
    String(blocked));

  // Sanity: the user row is still there after the rollback.
  const stillHere = await db.value(`SELECT username FROM users WHERE id = $1`, [adminId], 'username');
  expect('admin user row survived the rejected DELETE', stillHere === 'theadmin');
}

/* ─── cleanup ───────────────────────────────────────────────────────────── */

console.log(`\n${pass} passed, ${fail} failed.`);

await db.close();

if (fail) process.exit(1);
