/**
 * Integration tests for instructor/admin problem CRUD.
 *
 * Scope:
 *   - POST /api/problems
 *   - GET  /api/problems/:slug/edit
 *   - PUT  /api/problems/:slug
 *   - DELETE /api/problems/:slug
 *
 * Per the current product decision, any INSTRUCTOR may edit/delete any
 * problem; there is no per-problem owner column.
 */
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ||= 'postgresql://postgres:postgres@127.0.0.1:5432/skillforge_test';
process.env.JWT_SECRET = 'integration-problem-creator-jwt';
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

/* ─── precondition: users + categories ───────────────────────────────────── */

const adminReg = await api.post('/api/auth/register').send({
  username: 'theadmin', email: 'admin@u.test', password: 'changeme123',
});
expect('precondition: first user is ADMIN',
  adminReg.status === 201 && adminReg.body.user.role === 'ADMIN');
const adminTok = adminReg.body.accessToken;

const instr1Reg = await api.post('/api/auth/register').send({
  username: 'instr1', email: 'instr1@u.test', password: 'changeme123',
});
const instr2Reg = await api.post('/api/auth/register').send({
  username: 'instr2', email: 'instr2@u.test', password: 'changeme123',
});
const studentReg = await api.post('/api/auth/register').send({
  username: 'student1', email: 'student1@u.test', password: 'changeme123',
});

for (const id of [instr1Reg.body.user.id, instr2Reg.body.user.id]) {
  const r = await api.put(`/api/users/${id}/role`)
    .set(bearer(adminTok)).send({ role: 'INSTRUCTOR' });
  expect(`precondition: promote #${id} to INSTRUCTOR`, r.status === 200);
}

const instr1Tok = (await api.post('/api/auth/login').send({
  emailOrUsername: 'instr1', password: 'changeme123',
})).body.accessToken;
const instr2Tok = (await api.post('/api/auth/login').send({
  emailOrUsername: 'instr2', password: 'changeme123',
})).body.accessToken;
const studentTok = studentReg.body.accessToken;

await insertCategory('backend', 'Backend');
await insertCategory('sql', 'SQL');
await insertCategory('arrays', 'Arrays');

/* ─── auth / role gating ─────────────────────────────────────────────────── */

console.log('—— auth / role gating ——');
{
  const noAuth = await api.post('/api/problems').send(backendProblem('http-status-map'));
  expect('POST /api/problems without token -> 401', noAuth.status === 401);

  const studentDenied = await api.post('/api/problems')
    .set(bearer(studentTok)).send(backendProblem('student-cannot-create'));
  expect('POST /api/problems as STUDENT -> 403', studentDenied.status === 403);
}

/* ─── create + edit fetch ────────────────────────────────────────────────── */

console.log('—— create + edit fetch ——');
{
  const created = await api.post('/api/problems')
    .set(bearer(instr1Tok)).send(backendProblem('http-status-map'));
  expect('INSTRUCTOR creates backend problem -> 201',
    created.status === 201
      && created.body.slug === 'http-status-map'
      && created.body.problemType === 'BACKEND'
      && created.body.categorySlug === 'backend'
      && created.body.functionName === 'getStatusLabel'
      && Array.isArray(created.body.testCases)
      && created.body.testCases.length === 2
      && !!created.body.createdAt,
    JSON.stringify(created.body));

  const editAsInstructor = await api.get('/api/problems/http-status-map/edit')
    .set(bearer(instr1Tok));
  expect('GET /:slug/edit as INSTRUCTOR -> 200 with authoring fields',
    editAsInstructor.status === 200
      && editAsInstructor.body.categorySlug === 'backend'
      && editAsInstructor.body.starterCode.javascript.includes('getStatusLabel')
      && editAsInstructor.body.hints.length === 1,
    JSON.stringify(editAsInstructor.body));

  const editAsStudent = await api.get('/api/problems/http-status-map/edit')
    .set(bearer(studentTok));
  expect('GET /:slug/edit as STUDENT -> 403', editAsStudent.status === 403);

  const publicDetail = await api.get('/api/problems/http-status-map');
  expect('public detail does not leak authoring-only testCases',
    publicDetail.status === 200
      && !Object.prototype.hasOwnProperty.call(publicDetail.body, 'testCases')
      && publicDetail.body.functionName === 'getStatusLabel');

  const dup = await api.post('/api/problems')
    .set(bearer(instr2Tok)).send(backendProblem('http-status-map'));
  expect('duplicate slug -> 409', dup.status === 409);

  const missingCategory = await api.post('/api/problems')
    .set(bearer(instr1Tok)).send({
      ...backendProblem('ghost-category-problem'),
      categorySlug: 'ghost',
    });
  expect('unknown categorySlug -> 404', missingCategory.status === 404);

  const badSql = await api.post('/api/problems')
    .set(bearer(instr1Tok)).send({
      slug: 'sql-missing-setup',
      title: 'Broken SQL',
      description: 'Missing setup',
      difficulty: 'EASY',
      problemType: 'SQL',
      categorySlug: 'sql',
      tags: ['sql'],
      starterCode: {},
      hints: [],
      examples: [],
      constraints: '',
      timeLimitMs: 1000,
      memoryLimitMb: 256,
      isPremium: false,
    });
  expect('invalid SQL problem payload -> 400', badSql.status === 400);
}

/* ─── update ─────────────────────────────────────────────────────────────── */

console.log('—— update ——');
{
  const updatedByOtherInstructor = await api.put('/api/problems/http-status-map')
    .set(bearer(instr2Tok))
    .send({ title: 'HTTP Status Labels', hints: ['Use a dictionary map.'] });
  expect('different INSTRUCTOR can update the problem -> 200',
    updatedByOtherInstructor.status === 200
      && updatedByOtherInstructor.body.title === 'HTTP Status Labels'
      && updatedByOtherInstructor.body.hints[0] === 'Use a dictionary map.',
    JSON.stringify(updatedByOtherInstructor.body));

  const emptyPut = await api.put('/api/problems/http-status-map')
    .set(bearer(instr1Tok)).send({});
  expect('PUT with empty body -> 400', emptyPut.status === 400);

  const invalidTypeSwitch = await api.put('/api/problems/http-status-map')
    .set(bearer(instr1Tok)).send({ problemType: 'SQL' });
  expect('switching to SQL without sqlSetup/testCases -> 400',
    invalidTypeSwitch.status === 400, JSON.stringify(invalidTypeSwitch.body));

  const unknownCategory = await api.put('/api/problems/http-status-map')
    .set(bearer(instr1Tok)).send({ categorySlug: 'ghost' });
  expect('PUT unknown categorySlug -> 404', unknownCategory.status === 404);
}

/* ─── delete safeguards ──────────────────────────────────────────────────── */

console.log('—— delete safeguards ——');
{
  await api.post('/api/courses').set(bearer(instr1Tok)).send({
    slug: 'cs101', title: 'CS 101',
  });
  await api.post('/api/courses/cs101/problems').set(bearer(instr1Tok)).send({
    problemSlug: 'http-status-map',
  });

  const attachedDelete = await api.delete('/api/problems/http-status-map')
    .set(bearer(instr2Tok));
  expect('DELETE blocked while problem is attached to a course -> 409',
    attachedDelete.status === 409);

  const examProblemCreate = await api.post('/api/problems')
    .set(bearer(instr1Tok)).send(backendProblem('route-param-extract'));
  expect('precondition: create exam-attached problem', examProblemCreate.status === 201);

  await api.post('/api/courses/cs101/exams').set(bearer(instr1Tok)).send({
    slug: 'midterm',
    title: 'Midterm',
    startsAt: isoIn(60),
    endsAt: isoIn(180),
    durationMinutes: 60,
  });
  await api.post('/api/courses/cs101/exams/midterm/problems').set(bearer(instr1Tok)).send({
    problemSlug: 'route-param-extract',
    points: 5,
  });

  const examDelete = await api.delete('/api/problems/route-param-extract')
    .set(bearer(instr2Tok));
  expect('DELETE blocked while problem is attached to an exam -> 409',
    examDelete.status === 409);

  const submissionProblem = await api.post('/api/problems')
    .set(bearer(instr1Tok)).send(algorithmProblem('sum-pair-check'));
  expect('precondition: create algorithm problem for submissions', submissionProblem.status === 201);

  const accepted = await api.post('/api/submissions/sum-pair-check')
    .set(bearer(studentTok))
    .send({ code: 'function solve(){ const answer = true; return answer; }', language: 'javascript' });
  expect('precondition: student submits to sum-pair-check', accepted.status === 202);

  const submissionDelete = await api.delete('/api/problems/sum-pair-check')
    .set(bearer(instr2Tok));
  expect('DELETE blocked while problem has submissions -> 409',
    submissionDelete.status === 409);
}

/* ─── successful delete + unknowns ──────────────────────────────────────── */

console.log('—— successful delete ——');
{
  const freeProblem = await api.post('/api/problems')
    .set(bearer(instr1Tok)).send(backendProblem('temporary-problem'));
  expect('precondition: create unused temporary problem', freeProblem.status === 201);

  const deleted = await api.delete('/api/problems/temporary-problem')
    .set(bearer(instr2Tok));
  expect('different INSTRUCTOR can delete an unused problem -> 200',
    deleted.status === 200 && deleted.body.ok === true);

  const gone = await api.get('/api/problems/temporary-problem/edit')
    .set(bearer(instr1Tok));
  expect('deleted problem edit view -> 404', gone.status === 404);

  const missingDelete = await api.delete('/api/problems/no-such-problem')
    .set(bearer(instr1Tok));
  expect('DELETE unknown problem -> 404', missingDelete.status === 404);
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

function backendProblem(slug) {
  return {
    slug,
    title: `Problem ${slug}`,
    description: 'Map common HTTP codes to labels.',
    difficulty: 'EASY',
    problemType: 'BACKEND',
    categorySlug: 'backend',
    tags: ['http', 'maps'],
    examples: [
      { input: '200', output: '"OK"' },
    ],
    constraints: 'Return a string label.',
    hints: ['Use an object lookup.'],
    starterCode: {
      javascript: 'function getStatusLabel(code) {\n  // your code here\n}\n',
    },
    functionName: 'getStatusLabel',
    testCases: [
      { name: 'ok', args: [200], expected: 'OK' },
      { name: 'created', args: [201], expected: 'Created' },
    ],
    timeLimitMs: 1000,
    memoryLimitMb: 256,
    isPremium: false,
  };
}

function algorithmProblem(slug) {
  return {
    slug,
    title: `Algorithm ${slug}`,
    description: 'Return a truthy answer.',
    difficulty: 'EASY',
    problemType: 'ALGORITHM',
    categorySlug: 'arrays',
    tags: ['array'],
    examples: [
      { input: '[]', output: 'true' },
    ],
    constraints: 'Any implementation is fine.',
    hints: ['Return the answer token.'],
    starterCode: {
      javascript: 'function solve() {\n  // your code here\n}\n',
    },
    expectedOutput: 'solve answer return true',
    timeLimitMs: 1000,
    memoryLimitMb: 256,
    isPremium: false,
  };
}

function isoIn(minutes) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}
