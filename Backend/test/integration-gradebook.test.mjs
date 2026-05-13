/**
 * Integration tests for the owner/admin-only course gradebook endpoints:
 *   - GET /api/courses/:slug/gradebook
 *   - GET /api/courses/:slug/gradebook.csv
 *
 * The gradebook is built from enrolments + exams + attempts + submissions
 * without a cache table, so this suite drives the real course/group/exam
 * flow and then asserts the read model matches it.
 */
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ||= 'postgresql://postgres:postgres@127.0.0.1:5432/skillforge_test';
process.env.JWT_SECRET = 'integration-gradebook-jwt';
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

/* ─── precondition: users + course + groups + exams ─────────────────────── */

const adminReg = await api.post('/api/auth/register').send({
  username: 'theadmin', email: 'admin@u.test', password: 'changeme123',
});
expect('precondition: admin registered', adminReg.status === 201 && adminReg.body.user.role === 'ADMIN');
const adminTok = adminReg.body.accessToken;

const ownerReg = await api.post('/api/auth/register').send({
  username: 'owner1', email: 'owner1@u.test', password: 'changeme123',
});
const otherInstrReg = await api.post('/api/auth/register').send({
  username: 'instr2', email: 'instr2@u.test', password: 'changeme123',
});
const stud1Reg = await api.post('/api/auth/register').send({
  username: 'stud1', email: 'stud1@u.test', password: 'changeme123',
});
const stud2Reg = await api.post('/api/auth/register').send({
  username: 'stud2', email: 'stud2@u.test', password: 'changeme123',
});

for (const id of [ownerReg.body.user.id, otherInstrReg.body.user.id]) {
  const r = await api.put(`/api/users/${id}/role`)
    .set(bearer(adminTok)).send({ role: 'INSTRUCTOR' });
  expect(`precondition: promote #${id} to INSTRUCTOR`, r.status === 200);
}

const ownerTok = (await api.post('/api/auth/login').send({
  emailOrUsername: 'owner1', password: 'changeme123',
})).body.accessToken;
const otherInstrTok = (await api.post('/api/auth/login').send({
  emailOrUsername: 'instr2', password: 'changeme123',
})).body.accessToken;
const stud1Tok = stud1Reg.body.accessToken;

const course = await api.post('/api/courses').set(bearer(ownerTok)).send({
  slug: 'cs101', title: 'CS 101', description: 'gradebook demo',
});
expect('precondition: owner creates course', course.status === 201);

await api.post('/api/courses/cs101/groups').set(bearer(ownerTok))
  .send({ slug: 'section-a', title: 'Section A' });
await api.post('/api/courses/cs101/groups').set(bearer(ownerTok))
  .send({ slug: 'section-b', title: 'Section B' });
await api.post('/api/courses/cs101/groups/section-a/members').set(bearer(ownerTok))
  .send({ username: 'stud1' });
await api.post('/api/courses/cs101/groups/section-b/members').set(bearer(ownerTok))
  .send({ username: 'stud2' });

async function insertProblem(slug, title) {
  await db.none(
    `INSERT INTO problems (slug, title, description, difficulty, problem_type, expected_output)
     VALUES ($1, $2, 'gradebook problem', 'EASY', 'ALGORITHM', 'solve answer return')`,
    [slug, title],
  );
}
await insertProblem('p-alpha', 'P Alpha');
await insertProblem('p-beta', 'P Beta');
await insertProblem('p-gamma', 'P Gamma');

const ACCEPTED_CODE = 'function solve(n){ const answer=n; return answer; }';
const REJECTED_CODE = 'const x = 1234567890123456789;';

const midterm = await api.post('/api/courses/cs101/exams').set(bearer(ownerTok)).send({
  slug: 'midterm',
  title: 'Midterm',
  groupSlug: 'section-a',
  startsAt: isoIn(60),
  endsAt: isoIn(180),
  durationMinutes: 60,
});
expect('precondition: create group-scoped midterm', midterm.status === 201);

const finalExam = await api.post('/api/courses/cs101/exams').set(bearer(ownerTok)).send({
  slug: 'final',
  title: 'Final',
  groupSlug: null,
  startsAt: isoIn(60),
  endsAt: isoIn(180),
  durationMinutes: 60,
});
expect('precondition: create course-wide final', finalExam.status === 201);

await api.post('/api/courses/cs101/exams/midterm/problems').set(bearer(ownerTok))
  .send({ problemSlug: 'p-alpha', position: 1, points: 5 });
await api.post('/api/courses/cs101/exams/midterm/problems').set(bearer(ownerTok))
  .send({ problemSlug: 'p-beta', position: 2, points: 3 });
await api.post('/api/courses/cs101/exams/final/problems').set(bearer(ownerTok))
  .send({ problemSlug: 'p-gamma', position: 1, points: 10 });

await db.none(`
  UPDATE exams
  SET starts_at = NOW() - INTERVAL '10 minutes',
      ends_at = NOW() + INTERVAL '110 minutes'
  WHERE slug IN ('midterm', 'final')
`);

const stud1MidtermAttempt = await api.post('/api/courses/cs101/exams/midterm/attempts')
  .set(bearer(stud1Tok));
expect('precondition: stud1 starts midterm', stud1MidtermAttempt.status === 201);

await api.post('/api/courses/cs101/exams/midterm/attempts/current/submissions/p-alpha')
  .set(bearer(stud1Tok)).send({ code: ACCEPTED_CODE, language: 'javascript' });
await api.post('/api/courses/cs101/exams/midterm/attempts/current/submissions/p-beta')
  .set(bearer(stud1Tok)).send({ code: REJECTED_CODE, language: 'javascript' });

const stud2FinalAttempt = await api.post('/api/courses/cs101/exams/final/attempts')
  .set(bearer(stud2Reg.body.accessToken));
expect('precondition: stud2 starts final', stud2FinalAttempt.status === 201);

await api.post('/api/courses/cs101/exams/final/attempts/current/submissions/p-gamma')
  .set(bearer(stud2Reg.body.accessToken)).send({ code: ACCEPTED_CODE, language: 'javascript' });

/* ─── auth + permission gate ─────────────────────────────────────────────── */

console.log('—— auth / permissions ——');
{
  const noAuth = await api.get('/api/courses/cs101/gradebook');
  expect('GET gradebook without token -> 401', noAuth.status === 401);

  const studentDenied = await api.get('/api/courses/cs101/gradebook').set(bearer(stud1Tok));
  expect('GET gradebook as STUDENT -> 403', studentDenied.status === 403);

  const otherInstrDenied = await api.get('/api/courses/cs101/gradebook')
    .set(bearer(otherInstrTok));
  expect('GET gradebook as non-owner INSTRUCTOR -> 403', otherInstrDenied.status === 403);

  const csvDenied = await api.get('/api/courses/cs101/gradebook.csv')
    .set(bearer(otherInstrTok));
  expect('GET gradebook.csv as non-owner INSTRUCTOR -> 403', csvDenied.status === 403);
}

/* ─── JSON gradebook ─────────────────────────────────────────────────────── */

console.log('—— json gradebook ——');
{
  const ownerView = await api.get('/api/courses/cs101/gradebook').set(bearer(ownerTok));
  expect('owner GET gradebook -> 200', ownerView.status === 200);
  expect('gradebook course block includes slug/title/studentCount',
    ownerView.body.course.slug === 'cs101'
      && ownerView.body.course.title === 'CS 101'
      && ownerView.body.course.studentCount === 2,
    JSON.stringify(ownerView.body.course));

  expect('gradebook exposes both exams in starts_at order',
    ownerView.body.exams.length === 2
      && ownerView.body.exams[0].slug === 'midterm'
      && ownerView.body.exams[0].totalPoints === 8
      && ownerView.body.exams[1].slug === 'final'
      && ownerView.body.exams[1].totalPoints === 10,
    JSON.stringify(ownerView.body.exams));

  expect('gradebook has one row per enrolled student',
    ownerView.body.rows.length === 2
      && ownerView.body.rows.map((r) => r.student.username).join(',') === 'stud1,stud2',
    JSON.stringify(ownerView.body.rows.map((r) => r.student.username)));

  const stud1 = ownerView.body.rows.find((row) => row.student.username === 'stud1');
  const stud1Midterm = stud1.scores.find((score) => score.examSlug === 'midterm');
  const stud1Final = stud1.scores.find((score) => score.examSlug === 'final');
  expect('stud1 row shows section-a membership',
    stud1.groups.length === 1 && stud1.groups[0].slug === 'section-a',
    JSON.stringify(stud1.groups));
  expect('stud1 midterm score is 5/8 with one solved problem',
    stud1Midterm.applicable === true
      && stud1Midterm.attempted === true
      && stud1Midterm.score.earned === 5
      && stud1Midterm.score.total === 8
      && stud1Midterm.score.solved === 1
      && stud1Midterm.score.outOf === 2,
    JSON.stringify(stud1Midterm));
  expect('stud1 final is applicable but unattempted -> 0/10',
    stud1Final.applicable === true
      && stud1Final.attempted === false
      && stud1Final.score.earned === 0
      && stud1Final.score.total === 10,
    JSON.stringify(stud1Final));
  expect('stud1 total sums applicable exams only -> 5/18',
    stud1.total.earned === 5
      && stud1.total.total === 18
      && stud1.total.applicableExams === 2
      && stud1.total.attemptedExams === 1,
    JSON.stringify(stud1.total));

  const stud2 = ownerView.body.rows.find((row) => row.student.username === 'stud2');
  const stud2Midterm = stud2.scores.find((score) => score.examSlug === 'midterm');
  const stud2Final = stud2.scores.find((score) => score.examSlug === 'final');
  expect('stud2 row shows section-b membership',
    stud2.groups.length === 1 && stud2.groups[0].slug === 'section-b',
    JSON.stringify(stud2.groups));
  expect('stud2 does not receive the section-a midterm score cell',
    stud2Midterm.applicable === false
      && stud2Midterm.attempted === false
      && stud2Midterm.score === null,
    JSON.stringify(stud2Midterm));
  expect('stud2 final score is 10/10',
    stud2Final.applicable === true
      && stud2Final.attempted === true
      && stud2Final.score.earned === 10
      && stud2Final.score.total === 10,
    JSON.stringify(stud2Final));
  expect('stud2 total excludes non-applicable midterm -> 10/10',
    stud2.total.earned === 10
      && stud2.total.total === 10
      && stud2.total.applicableExams === 1
      && stud2.total.attemptedExams === 1,
    JSON.stringify(stud2.total));

  const adminView = await api.get('/api/courses/cs101/gradebook').set(bearer(adminTok));
  expect('ADMIN can also read the gradebook', adminView.status === 200);
}

/* ─── CSV gradebook ──────────────────────────────────────────────────────── */

console.log('—— csv gradebook ——');
{
  const csv = await api.get('/api/courses/cs101/gradebook.csv').set(bearer(ownerTok));
  expect('owner GET gradebook.csv -> 200', csv.status === 200);
  expect('gradebook.csv returns text/csv',
    /text\/csv/.test(csv.headers['content-type']),
    String(csv.headers['content-type']));
  expect('gradebook.csv suggests a course-specific filename',
    csv.headers['content-disposition'] === 'attachment; filename="cs101-gradebook.csv"',
    String(csv.headers['content-disposition']));

  const lines = csv.text.trim().split('\n');
  expect('csv header contains username/groups/exams/total',
    lines[0] === 'username,full_name,groups,midterm,final,total',
    lines[0]);
  expect('csv row for stud1 shows 5/8, 0/10, total 5/18',
    lines.includes('stud1,stud1,section-a,5/8,0/10,5/18'),
    csv.text);
  expect('csv row for stud2 leaves non-applicable midterm blank',
    lines.includes('stud2,stud2,section-b,,10/10,10/10'),
    csv.text);
}

/* ─── cleanup ────────────────────────────────────────────────────────────── */

console.log(`\n${pass} passed, ${fail} failed.`);

await db.close();

if (fail) process.exit(1);

function isoIn(minutes) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}
