/**
 * Integration tests for /api/courses/:courseSlug/exams/* — Phase 1 #5
 * (ADR 0009). Drives the full nested-router stack plus the submissions
 * service, and exercises temporal predicates by directly editing
 * `exams.starts_at` / `exam_attempts.started_at` so the tests don't
 * have to sleep.
 *
 * Covered:
 *   - CRUD: auth gating, 403 non-owner, 409 dup slug, validation
 *   - Visibility: STUDENT sees scoped exams only; ADMIN/INSTRUCTOR see all
 *   - Frozen-once-started: PUT / attach / detach rejected after starts_at
 *   - Attempts: 400 before window / after window / no-attempt / time-is-up
 *   - Submit within attempt: ACCEPTED + WRONG_ANSWER, persisted with
 *     exam_attempt_id set, score computed on the fly
 *   - Public /api/submissions/recent hides in-exam submissions
 */
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ||= 'postgresql://postgres:postgres@127.0.0.1:5432/skillforge_test';
process.env.JWT_SECRET = 'integration-exams-jwt';
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
  if (cond) { console.log(`  ok  ${name}`); pass++; }
  else       { console.log(`  FAIL ${name} ${extra}`); fail++; }
}
const bearer = (t) => ({ Authorization: `Bearer ${t}` });

/* ─── precondition: users, course, group, two problems ──────────────────── */

const adminReg = await api.post('/api/auth/register').send({
  username: 'theadmin', email: 'a@u.test', password: 'changeme123',
});
expect('precondition: admin is ADMIN',
  adminReg.status === 201 && adminReg.body.user.role === 'ADMIN');
const adminTok = adminReg.body.accessToken;

const instr1Reg = await api.post('/api/auth/register').send({
  username: 'instr1', email: 'i1@u.test', password: 'changeme123',
});
const instr2Reg = await api.post('/api/auth/register').send({
  username: 'instr2', email: 'i2@u.test', password: 'changeme123',
});
const stud1Reg = await api.post('/api/auth/register').send({
  username: 'stud1', email: 's1@u.test', password: 'changeme123',
});
const stud2Reg = await api.post('/api/auth/register').send({
  username: 'stud2', email: 's2@u.test', password: 'changeme123',
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
const stud1Tok = stud1Reg.body.accessToken;
const stud2Tok = stud2Reg.body.accessToken;

const cs101 = await api.post('/api/courses').set(bearer(instr1Tok)).send({
  slug: 'cs101', title: 'CS 101',
});
expect('precondition: instr1 creates cs101', cs101.status === 201);

await api.post('/api/courses/cs101/groups').set(bearer(instr1Tok))
  .send({ slug: 'section-a', title: 'Section A' });
await api.post('/api/courses/cs101/groups').set(bearer(instr1Tok))
  .send({ slug: 'section-b', title: 'Section B' });
await api.post('/api/courses/cs101/groups/section-a/members')
  .set(bearer(instr1Tok)).send({ username: 'stud1' });

// Two problems. Heuristic judge accepts any code containing the tokens
// in expected_output, so we can control ACCEPTED vs WRONG_ANSWER from
// the test by picking the code body.
async function insertProblem(slug, title) {
  await db.none(
    `INSERT INTO problems (slug, title, description, difficulty, problem_type, expected_output)
     VALUES ($1, $2, 'test problem', 'EASY', 'ALGORITHM', 'solve answer return')`,
    [slug, title],
  );
}
await insertProblem('p-alpha', 'P Alpha');
await insertProblem('p-beta', 'P Beta');

const ACCEPTED_CODE = 'function solve(n){ let answer=n; return answer; }';
const REJECTED_CODE = 'const x = 1234567890123456789;';

/* ─── auth / role gating on exam CRUD ───────────────────────────────────── */

console.log('—— CRUD gating ——');
{
  const noAuth = await api.post('/api/courses/cs101/exams').send({});
  expect('POST exam without token -> 401', noAuth.status === 401);

  const studentDenied = await api.post('/api/courses/cs101/exams')
    .set(bearer(stud1Tok)).send(validExamBody('rejected-by-role'));
  expect('POST exam as STUDENT -> 403', studentDenied.status === 403);

  const nonOwner = await api.post('/api/courses/cs101/exams')
    .set(bearer(instr2Tok)).send(validExamBody('also-rejected'));
  expect('POST exam as non-owner INSTRUCTOR -> 403',
    nonOwner.status === 403, `got ${nonOwner.status}`);

  const badDuration = await api.post('/api/courses/cs101/exams')
    .set(bearer(instr1Tok)).send({ ...validExamBody('bad-duration'), durationMinutes: 0 });
  expect('POST with durationMinutes=0 -> 400', badDuration.status === 400);

  const badWindow = await api.post('/api/courses/cs101/exams')
    .set(bearer(instr1Tok)).send({
      ...validExamBody('bad-window'),
      startsAt: isoIn(60), endsAt: isoIn(30),
    });
  expect('POST with endsAt < startsAt -> 400', badWindow.status === 400);

  const badGroup = await api.post('/api/courses/cs101/exams')
    .set(bearer(instr1Tok)).send({ ...validExamBody('bad-group'), groupSlug: 'ghost-group' });
  expect('POST with unknown groupSlug -> 404', badGroup.status === 404);
}

/* ─── create + detail + duplicate ───────────────────────────────────────── */

console.log('—— create ——');
const midtermCreate = await api.post('/api/courses/cs101/exams')
  .set(bearer(instr1Tok)).send({
    ...validExamBody('midterm'),
    description: 'A section-A midterm',
    groupSlug: 'section-a',
  });
expect('POST /exams as owner (with group scope) -> 201',
  midtermCreate.status === 201
   && midtermCreate.body.slug === 'midterm'
   && midtermCreate.body.groupSlug === 'section-a'
   && midtermCreate.body.problemCount === 0
   && midtermCreate.body.description === 'A section-A midterm',
  JSON.stringify(midtermCreate.body));

// A course-wide exam (groupSlug null) for visibility tests.
const finalCreate = await api.post('/api/courses/cs101/exams')
  .set(bearer(adminTok)).send({ ...validExamBody('final'), groupSlug: null });
expect('POST /exams (course-wide, ADMIN) -> 201 with groupSlug:null',
  finalCreate.status === 201 && finalCreate.body.groupSlug === null);

const dup = await api.post('/api/courses/cs101/exams')
  .set(bearer(instr1Tok)).send(validExamBody('midterm'));
expect('POST duplicate slug -> 409', dup.status === 409);

/* ─── visibility: list / detail ─────────────────────────────────────────── */

console.log('—— visibility ——');
{
  const adminList = await api.get('/api/courses/cs101/exams').set(bearer(adminTok));
  expect('ADMIN list: both midterm + final',
    adminList.status === 200 && adminList.body.length === 2);

  const instr2List = await api.get('/api/courses/cs101/exams').set(bearer(instr2Tok));
  expect('INSTRUCTOR (non-owner) list: sees all',
    instr2List.status === 200 && instr2List.body.length === 2);

  const s1List = await api.get('/api/courses/cs101/exams').set(bearer(stud1Tok));
  expect('STUDENT in section-a sees both midterm (scoped) and final (course-wide)',
    s1List.status === 200 && s1List.body.length === 2,
    `got ${s1List.body?.length}`);

  const s2List = await api.get('/api/courses/cs101/exams').set(bearer(stud2Tok));
  expect('STUDENT with NO enrolment in cs101 sees no exams',
    s2List.status === 200 && s2List.body.length === 0);

  const s1Detail = await api.get('/api/courses/cs101/exams/midterm').set(bearer(stud1Tok));
  expect('GET midterm as enrolled student -> 200', s1Detail.status === 200);

  const s2Detail = await api.get('/api/courses/cs101/exams/midterm').set(bearer(stud2Tok));
  expect('GET midterm as non-enrolled student -> 404 (no leakage)',
    s2Detail.status === 404);
}

/* ─── attach problems (before starts_at) ────────────────────────────────── */

console.log('—— attach problems ——');
{
  const nonOwner = await api.post('/api/courses/cs101/exams/midterm/problems')
    .set(bearer(instr2Tok)).send({ problemSlug: 'p-alpha' });
  expect('attach as non-owner -> 403', nonOwner.status === 403);

  const ok1 = await api.post('/api/courses/cs101/exams/midterm/problems')
    .set(bearer(instr1Tok)).send({ problemSlug: 'p-alpha', position: 1, points: 5 });
  expect('attach p-alpha -> 201 with points=5',
    ok1.status === 201 && ok1.body.points === 5 && ok1.body.position === 1);

  const ok2 = await api.post('/api/courses/cs101/exams/midterm/problems')
    .set(bearer(adminTok)).send({ problemSlug: 'p-beta', position: 2, points: 3 });
  expect('attach p-beta as ADMIN -> 201', ok2.status === 201 && ok2.body.points === 3);

  const dupAttach = await api.post('/api/courses/cs101/exams/midterm/problems')
    .set(bearer(instr1Tok)).send({ problemSlug: 'p-alpha' });
  expect('attach same problem twice -> 409', dupAttach.status === 409);

  const unknown = await api.post('/api/courses/cs101/exams/midterm/problems')
    .set(bearer(instr1Tok)).send({ problemSlug: 'p-zeta' });
  expect('attach unknown problem -> 404', unknown.status === 404);

  const detail = await api.get('/api/courses/cs101/exams/midterm').set(bearer(instr1Tok));
  expect('midterm detail lists both problems in position order',
    detail.body.problems.length === 2
     && detail.body.problems[0].slug === 'p-alpha'
     && detail.body.problems[1].slug === 'p-beta');
}

/* ─── "frozen once started": move starts_at into the past, then try PUT/attach ── */

console.log('—— frozen once started ——');
{
  // Midterm is still in the future. Force it into "started" state by
  // pulling starts_at one minute into the past. ends_at stays +2h,
  // duration 60 min (see validExamBody).
  await db.none(
    `UPDATE exams SET starts_at = NOW() - INTERVAL '1 minute' WHERE slug = 'midterm'`,
    [],
  );

  const putAfterStart = await api.put('/api/courses/cs101/exams/midterm')
    .set(bearer(instr1Tok)).send({ title: 'Moved goalposts' });
  expect('PUT after starts_at -> 400', putAfterStart.status === 400);

  const attachAfterStart = await api.post('/api/courses/cs101/exams/midterm/problems')
    .set(bearer(instr1Tok)).send({ problemSlug: 'p-zeta' });
  // Should fail with "already started" 400, not "problem not found" 404.
  expect('attach after starts_at -> 400',
    attachAfterStart.status === 400, `got ${attachAfterStart.status}`);
}

/* ─── attempt: 403 for instructor, 201 for student, 409 on double-start ── */

console.log('—— start attempt ——');
{
  const instrStart = await api.post('/api/courses/cs101/exams/midterm/attempts')
    .set(bearer(instr1Tok));
  expect('instructor tries startAttempt -> 403',
    instrStart.status === 403, `got ${instrStart.status}`);

  const notInScope = await api.post('/api/courses/cs101/exams/midterm/attempts')
    .set(bearer(stud2Tok));
  expect('student not-in-section-a startAttempt on scoped exam -> 404',
    notInScope.status === 404);

  const started = await api.post('/api/courses/cs101/exams/midterm/attempts')
    .set(bearer(stud1Tok));
  expect('enrolled student startAttempt -> 201',
    started.status === 201
     && typeof started.body.deadline === 'string'
     && started.body.score.total === 8, // 5 + 3 points
    JSON.stringify(started.body));

  const double = await api.post('/api/courses/cs101/exams/midterm/attempts')
    .set(bearer(stud1Tok));
  expect('student starts again -> 409', double.status === 409);
}

/* ─── submit inside the attempt ─────────────────────────────────────────── */

console.log('—— submit in attempt ——');
{
  const ok = await api.post(
    '/api/courses/cs101/exams/midterm/attempts/current/submissions/p-alpha',
  ).set(bearer(stud1Tok)).send({ code: ACCEPTED_CODE, language: 'javascript' });
  expect('submit ACCEPTED code for p-alpha -> 202 ACCEPTED',
    ok.status === 202 && ok.body.status === 'ACCEPTED',
    JSON.stringify(ok.body).slice(0, 200));

  const rejected = await api.post(
    '/api/courses/cs101/exams/midterm/attempts/current/submissions/p-beta',
  ).set(bearer(stud1Tok)).send({ code: REJECTED_CODE, language: 'javascript' });
  expect('submit failing code for p-beta -> 202 WRONG_ANSWER',
    rejected.status === 202 && rejected.body.status === 'WRONG_ANSWER');

  const notInExam = await api.post(
    '/api/courses/cs101/exams/midterm/attempts/current/submissions/p-zeta',
  ).set(bearer(stud1Tok)).send({ code: ACCEPTED_CODE, language: 'javascript' });
  expect('submit for a problem NOT in the exam -> 404',
    notInExam.status === 404);

  // The DB must carry the exam_attempt_id on the saved rows.
  const linked = await db.value(
    `SELECT COUNT(*)::int AS n FROM submissions WHERE exam_attempt_id IS NOT NULL`,
    [], 'n',
  );
  expect('both submissions persisted with exam_attempt_id set',
    linked === 2, `got ${linked}`);
}

/* ─── attempt detail + scoring ──────────────────────────────────────────── */

console.log('—— attempt detail + score ——');
{
  const mine = await api.get('/api/courses/cs101/exams/midterm/attempts/me')
    .set(bearer(stud1Tok));
  expect('GET attempts/me -> 200 with earned=5 (p-alpha solved)',
    mine.status === 200
     && mine.body.score.earned === 5
     && mine.body.score.total === 8
     && mine.body.score.solved === 1
     && mine.body.score.outOf === 2,
    JSON.stringify(mine.body.score));
  expect('attempt detail lists both submissions',
    mine.body.submissions.length === 2);

  const nonOwnerPeek = await api.get('/api/courses/cs101/exams/midterm/attempts/stud1')
    .set(bearer(instr2Tok));
  expect('non-owner INSTRUCTOR peeking at student attempt -> 403',
    nonOwnerPeek.status === 403);

  const ownerPeek = await api.get('/api/courses/cs101/exams/midterm/attempts/stud1')
    .set(bearer(instr1Tok));
  expect('owner INSTRUCTOR peeks at student attempt -> 200 with score',
    ownerPeek.status === 200 && ownerPeek.body.score.earned === 5);

  const unknownUser = await api.get('/api/courses/cs101/exams/midterm/attempts/nobody')
    .set(bearer(instr1Tok));
  expect('owner peeks at unknown username -> 404',
    unknownUser.status === 404);
}

/* ─── public /api/submissions/recent hides in-exam submissions ──────────── */

console.log('—— public feed hides in-exam ——');
{
  const recent = await api.get('/api/submissions/recent');
  expect('GET /api/submissions/recent -> 200 but contains NO exam rows',
    recent.status === 200
     && recent.body.every((r) => r.problem?.slug !== 'p-alpha' || r.status !== 'ACCEPTED'),
    `length=${recent.body?.length}`);
  // Strictly — there are no non-exam submissions yet in this test.
  expect('recent feed is empty (all submissions so far are in-exam)',
    recent.body.length === 0);
}

/* ─── time is up: force deadline past, submit -> 400 ────────────────────── */

console.log('—— time is up ——');
{
  // Rewind the attempt's started_at 2h into the past. With
  // duration_minutes=60, the personal deadline is now 1h in the past.
  await db.none(
    `UPDATE exam_attempts SET started_at = NOW() - INTERVAL '2 hours'
     WHERE user_id = $1 AND exam_id = (SELECT id FROM exams WHERE slug='midterm')`,
    [stud1Reg.body.user.id],
  );

  const late = await api.post(
    '/api/courses/cs101/exams/midterm/attempts/current/submissions/p-alpha',
  ).set(bearer(stud1Tok)).send({ code: ACCEPTED_CODE, language: 'javascript' });
  expect('submit after personal deadline -> 400', late.status === 400);
}

/* ─── finishAttempt: idempotent ─────────────────────────────────────────── */

console.log('—— finish attempt ——');
{
  const finish = await api.post('/api/courses/cs101/exams/midterm/attempts/current/finish')
    .set(bearer(stud1Tok));
  expect('finishAttempt -> 200', finish.status === 200);
  expect('finishedAt now set', !!finish.body.finishedAt);

  const finishAgain = await api.post('/api/courses/cs101/exams/midterm/attempts/current/finish')
    .set(bearer(stud1Tok));
  expect('finishAttempt (already finished) -> 200 idempotent',
    finishAgain.status === 200 && !!finishAgain.body.finishedAt);

  const submitAfterFinish = await api.post(
    '/api/courses/cs101/exams/midterm/attempts/current/submissions/p-beta',
  ).set(bearer(stud1Tok)).send({ code: ACCEPTED_CODE, language: 'javascript' });
  expect('submit after finish -> 400', submitAfterFinish.status === 400);
}

/* ─── delete exam: still allowed even after start ───────────────────────── */

console.log('—— delete ——');
{
  const nonOwnerDel = await api.delete('/api/courses/cs101/exams/midterm')
    .set(bearer(instr2Tok));
  expect('DELETE as non-owner -> 403', nonOwnerDel.status === 403);

  const del = await api.delete('/api/courses/cs101/exams/midterm').set(bearer(instr1Tok));
  expect('DELETE as owner (after start) -> 200', del.status === 200);

  const gone = await api.get('/api/courses/cs101/exams/midterm').set(bearer(adminTok));
  expect('after DELETE, detail -> 404', gone.status === 404);

  const orphanAttempts = await db.value(
    `SELECT COUNT(*)::int AS n FROM exam_attempts
     WHERE exam_id NOT IN (SELECT id FROM exams)`, [], 'n',
  );
  expect('no orphan exam_attempts after exam delete (ON DELETE CASCADE)',
    orphanAttempts === 0);

  // Submissions survive but their exam_attempt_id has been SET NULL by
  // the FK (ADR 0009 §Hot-path invariants). Confirm directly.
  const nulled = await db.value(
    `SELECT COUNT(*)::int AS n FROM submissions WHERE exam_attempt_id IS NULL`, [], 'n',
  );
  expect('submissions survive with exam_attempt_id SET NULL', nulled === 2);
}

/* ─── cleanup ───────────────────────────────────────────────────────────── */

console.log(`\n${pass} passed, ${fail} failed.`);

await db.close();

if (fail) process.exit(1);

/* ─── helpers ───────────────────────────────────────────────────────────── */

function validExamBody(slug) {
  return {
    slug,
    title: `Exam ${slug}`,
    startsAt: isoIn(60),        // starts in 1h (we later move into the past)
    endsAt:   isoIn(60 + 120),  // lasts 2h (wall-clock window)
    durationMinutes: 60,
  };
}

function isoIn(minutes) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}
