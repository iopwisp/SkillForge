/**
 * Integration tests for the installation-level audit log.
 *
 * Scope:
 *   - GET /api/audit-log
 *   - successful privileged mutations append events
 *   - failed mutations do not append events
 *   - ADMIN-only visibility + basic filters
 */
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ||= 'postgresql://postgres:postgres@127.0.0.1:5432/skillforge_test';
process.env.JWT_SECRET = 'integration-audit-log-jwt';
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
    exam_attempts, exam_problems, exams,
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

/* ─── precondition ───────────────────────────────────────────────────────── */

const adminReg = await api.post('/api/auth/register').send({
  username: 'theadmin', email: 'admin@u.test', password: 'changeme123',
});
expect('precondition: first user is ADMIN',
  adminReg.status === 201 && adminReg.body.user.role === 'ADMIN');
const adminTok = adminReg.body.accessToken;

const instrReg = await api.post('/api/auth/register').send({
  username: 'instr1', email: 'instr1@u.test', password: 'changeme123',
});
const studentReg = await api.post('/api/auth/register').send({
  username: 'student1', email: 'student1@u.test', password: 'changeme123',
});
const studentTok = studentReg.body.accessToken;

await insertCategory('backend', 'Backend');

const promote = await api.put(`/api/users/${instrReg.body.user.id}/role`)
  .set(bearer(adminTok))
  .send({ role: 'INSTRUCTOR' });
expect('precondition: promote instr1 to INSTRUCTOR', promote.status === 200);

const instrTok = (await api.post('/api/auth/login').send({
  emailOrUsername: 'instr1', password: 'changeme123',
})).body.accessToken;

/* ─── create a few audited events ───────────────────────────────────────── */

await api.post('/api/courses').set(bearer(instrTok)).send({
  slug: 'cs101', title: 'CS 101',
});

await api.post('/api/problems').set(bearer(instrTok)).send(problemPayload('http-status-map'));

await api.post('/api/courses/cs101/problems').set(bearer(instrTok)).send({
  problemSlug: 'http-status-map',
});

await api.post('/api/courses/cs101/groups').set(bearer(instrTok)).send({
  slug: 'section-a', title: 'Section A',
});

await api.post('/api/courses/cs101/exams').set(bearer(instrTok)).send({
  slug: 'midterm',
  title: 'Midterm',
  startsAt: isoIn(60),
  endsAt: isoIn(180),
  durationMinutes: 60,
});

const failedDelete = await api.delete('/api/problems/http-status-map')
  .set(bearer(instrTok));
expect('precondition: deleting referenced problem fails -> 409', failedDelete.status === 409);

/* ─── permissions ───────────────────────────────────────────────────────── */

console.log('—— permissions ——');
{
  const noAuth = await api.get('/api/audit-log');
  expect('GET /api/audit-log without token -> 401', noAuth.status === 401);

  const studentDenied = await api.get('/api/audit-log').set(bearer(studentTok));
  expect('GET /api/audit-log as STUDENT -> 403', studentDenied.status === 403);

  const instructorDenied = await api.get('/api/audit-log').set(bearer(instrTok));
  expect('GET /api/audit-log as INSTRUCTOR -> 403', instructorDenied.status === 403);
}

/* ─── list + content ────────────────────────────────────────────────────── */

console.log('—— list + content ——');
{
  const all = await api.get('/api/audit-log').set(bearer(adminTok));
  expect('ADMIN gets audit log -> 200', all.status === 200);
  expect('successful mutations produced 6 events total',
    all.body.total === 6 && all.body.items.length === 6,
    JSON.stringify({ total: all.body.total, len: all.body.items?.length }));

  expect('events are newest-first (last action is CREATE EXAM)',
    all.body.items[0].action === 'CREATE'
      && all.body.items[0].entityType === 'EXAM'
      && all.body.items[0].entityKey === 'cs101:midterm',
    JSON.stringify(all.body.items[0]));

  const roleEvent = all.body.items.find((item) => item.entityType === 'USER_ROLE');
  expect('role change event snapshots actor and details',
    roleEvent
      && roleEvent.actor.username === 'theadmin'
      && roleEvent.actor.role === 'ADMIN'
      && roleEvent.details.targetUsername === 'instr1'
      && roleEvent.details.previousRole === 'STUDENT'
      && roleEvent.details.newRole === 'INSTRUCTOR',
    JSON.stringify(roleEvent));

  const attachEvent = all.body.items.find((item) => item.entityType === 'COURSE_PROBLEM');
  expect('course-problem attach event stores entity key and detail payload',
    attachEvent
      && attachEvent.action === 'ATTACH'
      && attachEvent.entityKey === 'cs101:http-status-map'
      && attachEvent.details.problemSlug === 'http-status-map',
    JSON.stringify(attachEvent));

  expect('failed delete did not create a DELETE PROBLEM event',
    !all.body.items.some((item) => item.action === 'DELETE' && item.entityType === 'PROBLEM'));
}

/* ─── filters ───────────────────────────────────────────────────────────── */

console.log('—— filters ——');
{
  const byActor = await api.get('/api/audit-log')
    .set(bearer(adminTok))
    .query({ actorUsername: 'instr1' });
  expect('actorUsername filter narrows to instructor-authored events',
    byActor.status === 200
      && byActor.body.total === 5
      && byActor.body.items.every((item) => item.actor.username === 'instr1'),
    JSON.stringify(byActor.body.items.map((item) => item.actor.username)));

  const byEntityAndAction = await api.get('/api/audit-log')
    .set(bearer(adminTok))
    .query({ entityType: 'COURSE', action: 'create' });
  expect('entityType + action filter finds the course create event',
    byEntityAndAction.status === 200
      && byEntityAndAction.body.total === 1
      && byEntityAndAction.body.items[0].entityKey === 'cs101',
    JSON.stringify(byEntityAndAction.body.items));

  const byKey = await api.get('/api/audit-log')
    .set(bearer(adminTok))
    .query({ entityKey: 'http-status-map' });
  expect('entityKey filter matches related problem events',
    byKey.status === 200
      && byKey.body.total === 2
      && byKey.body.items.every((item) => item.entityKey.includes('http-status-map')),
    JSON.stringify(byKey.body.items.map((item) => item.entityKey)));
}

console.log(`\n${pass} passed, ${fail} failed.`);

await db.close();

if (fail) process.exit(1);

async function insertCategory(slug, name) {
  await db.none(
    `INSERT INTO categories (slug, name) VALUES ($1, $2)`,
    [slug, name],
  );
}

function problemPayload(slug) {
  return {
    slug,
    title: `Problem ${slug}`,
    description: 'Map common HTTP status codes.',
    difficulty: 'EASY',
    problemType: 'BACKEND',
    categorySlug: 'backend',
    tags: ['http', 'maps'],
    examples: [{ input: '200', output: '"OK"' }],
    constraints: 'Return a string.',
    hints: ['Use a plain object map.'],
    starterCode: {
      javascript: 'function getStatusLabel(code) {\n  // your code here\n}\n',
    },
    functionName: 'getStatusLabel',
    testCases: [
      { name: 'ok', args: [200], expected: 'OK' },
    ],
    timeLimitMs: 1000,
    memoryLimitMb: 256,
    isPremium: false,
  };
}

function isoIn(minutes) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}
