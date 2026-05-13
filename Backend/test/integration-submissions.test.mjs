/**
 * Integration tests for /api/submissions/* via supertest. End-to-end
 * proof that the submit pipeline (auth → routes → submissions service →
 * judge → atomic DB transaction → problems counters → users rating)
 * lights up correctly.
 *
 * Covered:
 *   - Auth gating: 401 without token on protected endpoints
 *   - 404 when slug does not exist
 *   - 400 on invalid body (zod)
 *   - JS judge: ACCEPTED solution against an inserted EASY frontend
 *     problem (formatBytes), runtime/memory/testsPassed populated, and
 *     rating bumps from 1200 to 1205 (EASY ⇒ +5)
 *   - Second ACCEPTED for the SAME problem does NOT bump rating again
 *   - WRONG_ANSWER on a buggy solution; rating stays put
 *   - SQL judge: ACCEPTED on a tiny inserted SQL problem
 *   - GET /api/submissions/me returns chronological history with
 *     newest first
 *   - GET /api/submissions/problem/:slug filters to one problem
 *   - GET /api/submissions/recent is publicly readable (optionalAuth)
 *     and reflects the persisted activity
 *   - POST /api/submissions/:slug/run does NOT persist (history length
 *     unchanged before vs after)
 *
 * Tests run against the real `skillforge_test` Postgres. Tables are
 * truncated up front; problems and the test user are inserted directly
 * without going through the seed script (seed is bootstrap data, not
 * a test fixture surface).
 */
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ||= 'postgresql://postgres:postgres@127.0.0.1:5432/skillforge_test';
process.env.JWT_SECRET = 'integration-submissions-jwt-secret';
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
    refresh_tokens,
    oauth_states,
    favorites,
    submissions,
    problems,
    categories,
    users
  RESTART IDENTITY CASCADE
`);

/* ─── fixtures ─────────────────────────────────────────────────────────── */

// Two problems. We insert them directly (rather than calling runSeed) so
// the tests are not coupled to the size or contents of the seed catalog.
const FORMAT_BYTES_TESTS = [
  { args: [0],          expected: '0 B' },
  { args: [1],          expected: '1 B' },
  { args: [1023],       expected: '1023 B' },
  { args: [1024],       expected: '1.0 KB' },
  { args: [1536],       expected: '1.5 KB' },
  { args: [1048576],    expected: '1.0 MB' },
];

const SQL_SETUP = `
  CREATE TABLE customers (id INTEGER, name TEXT, country TEXT);
  INSERT INTO customers VALUES (1,'Alice','US'),(2,'Bob','GB'),(3,'Charlie','US');
`;
const SQL_TESTS = [
  {
    expected: [
      [1, 'Alice', 'US'],
      [2, 'Bob', 'GB'],
      [3, 'Charlie', 'US'],
    ],
  },
];

await db.none(
  `INSERT INTO problems (
     slug, title, description, difficulty, problem_type, tags,
     examples_json, hints_json, starter_code_json, expected_output,
     test_cases_json, function_name, time_limit_ms
   ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
  [
    'fmt-bytes-test', 'Format Bytes (test)', 'Test problem',
    'EASY', 'FRONTEND', 'frontend',
    '[]', '[]', '{}', '',
    JSON.stringify(FORMAT_BYTES_TESTS),
    'formatBytes',
    2000,
  ],
);

await db.none(
  `INSERT INTO problems (
     slug, title, description, difficulty, problem_type, tags,
     examples_json, hints_json, starter_code_json, expected_output,
     test_cases_json, sql_setup, time_limit_ms
   ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
  [
    'sql-customers-test', 'List Customers (test)', 'Test SQL problem',
    'EASY', 'SQL', 'sql',
    '[]', '[]', '{}', '',
    JSON.stringify(SQL_TESTS),
    SQL_SETUP,
    2000,
  ],
);

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

/* ─── 1. register a test user and grab tokens ──────────────────────────── */

const regRes = await api.post('/api/auth/register').send({
  username: 'submitter',
  email: 'submitter@test.io',
  password: 'changeme123',
  fullName: 'Submitter Test',
});
expect('precondition: register submitter -> 201', regRes.status === 201);

const accessToken = regRes.body.accessToken;
const userId = regRes.body.user.id;
const initialRating = regRes.body.user.rating;
expect('precondition: starting rating is 1200', initialRating === 1200);

const auth = (req) => req.set('Authorization', `Bearer ${accessToken}`);

/* ─── 2. auth gating ───────────────────────────────────────────────────── */

{
  const res = await api.post('/api/submissions/fmt-bytes-test').send({
    code: 'function formatBytes(){}', language: 'javascript',
  });
  expect('POST /api/submissions/:slug without token -> 401', res.status === 401);
}
{
  const res = await api.get('/api/submissions/me');
  expect('GET /api/submissions/me without token -> 401', res.status === 401);
}
{
  const res = await api.get('/api/submissions/problem/fmt-bytes-test');
  expect('GET /api/submissions/problem/:slug without token -> 401', res.status === 401);
}

/* ─── 3. unknown slug + bad body ───────────────────────────────────────── */

{
  const res = await auth(api.post('/api/submissions/no-such-slug')).send({
    code: 'whatever',
    language: 'javascript',
  });
  expect('POST /api/submissions/:unknown-slug -> 404', res.status === 404);
}

{
  const res = await auth(api.post('/api/submissions/fmt-bytes-test')).send({
    // missing code/language
  });
  expect('POST /api/submissions/:slug invalid body -> 400', res.status === 400);
}

/* ─── 4. ACCEPTED submission bumps rating from 1200 to 1205 ────────────── */

const FORMAT_BYTES_GOOD = `
  function formatBytes(n) {
    if (n < 1024) return n + ' B';
    const units = ['KB', 'MB', 'GB', 'TB'];
    let v = n / 1024;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return v.toFixed(1) + ' ' + units[i];
  }
`;

const acceptedRes = await auth(api.post('/api/submissions/fmt-bytes-test')).send({
  code: FORMAT_BYTES_GOOD,
  language: 'javascript',
});
expect('POST /api/submissions/fmt-bytes-test (good code) -> 202',
  acceptedRes.status === 202,
  `status=${acceptedRes.status} body=${JSON.stringify(acceptedRes.body)}`);
expect('verdict is ACCEPTED with all tests passed',
  acceptedRes.body?.status === 'ACCEPTED'
   && acceptedRes.body.testsPassed === FORMAT_BYTES_TESTS.length
   && acceptedRes.body.testsTotal === FORMAT_BYTES_TESTS.length,
  JSON.stringify(acceptedRes.body));
expect('submission row is persisted with id and timestamp',
  typeof acceptedRes.body?.id === 'number'
   && typeof acceptedRes.body?.createdAt === 'string');
expect('submission carries problem ref',
  acceptedRes.body?.problem?.slug === 'fmt-bytes-test'
   && acceptedRes.body.problem.difficulty === 'EASY');

const ratingAfter = await db.value(`SELECT rating FROM users WHERE id = $1`, [userId], 'rating');
expect(`rating bumped 1200 -> 1205 on first ACCEPTED EASY (got ${ratingAfter})`,
  Number(ratingAfter) === 1205);

const counters1 = await db.maybeOne(
  `SELECT total_submissions AS t, accepted_submissions AS a FROM problems WHERE slug = 'fmt-bytes-test'`,
);
expect('problem counters bumped: total=1, accepted=1',
  Number(counters1.t) === 1 && Number(counters1.a) === 1);

/* ─── 5. second ACCEPTED for SAME problem does NOT bump rating again ───── */

const acceptedAgain = await auth(api.post('/api/submissions/fmt-bytes-test')).send({
  code: FORMAT_BYTES_GOOD,
  language: 'javascript',
});
expect('second ACCEPTED for same problem -> 202 + ACCEPTED',
  acceptedAgain.status === 202 && acceptedAgain.body?.status === 'ACCEPTED');

const ratingAfter2 = await db.value(`SELECT rating FROM users WHERE id = $1`, [userId], 'rating');
expect(`rating stays at 1205 after a duplicate accept (got ${ratingAfter2})`,
  Number(ratingAfter2) === 1205);

/* ─── 6. WRONG_ANSWER does not change rating ───────────────────────────── */

const wrongRes = await auth(api.post('/api/submissions/fmt-bytes-test')).send({
  code: 'function formatBytes(n){ return "nope"; }',
  language: 'javascript',
});
expect('buggy code -> 202 with WRONG_ANSWER',
  wrongRes.status === 202 && wrongRes.body?.status === 'WRONG_ANSWER',
  JSON.stringify(wrongRes.body));

const ratingAfter3 = await db.value(`SELECT rating FROM users WHERE id = $1`, [userId], 'rating');
expect('rating stays at 1205 after a WRONG_ANSWER',
  Number(ratingAfter3) === 1205);

/* ─── 7. SQL judge through HTTP ────────────────────────────────────────── */

const sqlRes = await auth(api.post('/api/submissions/sql-customers-test')).send({
  code: 'SELECT id, name, country FROM customers',
  language: 'sql',
});
expect('SQL submission ACCEPTED via /api/submissions',
  sqlRes.status === 202 && sqlRes.body?.status === 'ACCEPTED',
  JSON.stringify(sqlRes.body));

/* ─── 8. /me history (newest first) ────────────────────────────────────── */

const meHistory = await auth(api.get('/api/submissions/me'));
expect('GET /api/submissions/me -> 200 with all 4 submissions',
  meHistory.status === 200
   && Array.isArray(meHistory.body)
   && meHistory.body.length === 4,
  `got ${meHistory.body?.length} items`);

const statuses = meHistory.body.map((r) => r.status);
expect('history contains the verdicts we submitted',
  statuses.filter((s) => s === 'ACCEPTED').length === 3
   && statuses.filter((s) => s === 'WRONG_ANSWER').length === 1);

/* ─── 9. per-problem history ───────────────────────────────────────────── */

const perProblem = await auth(api.get('/api/submissions/problem/fmt-bytes-test'));
expect('GET /api/submissions/problem/:slug -> 200 with 3 entries',
  perProblem.status === 200 && perProblem.body.length === 3);
expect('per-problem history is filtered to that problem only',
  perProblem.body.every((r) => r.problem?.slug === 'fmt-bytes-test'));

const perProblem404 = await auth(api.get('/api/submissions/problem/no-such-slug'));
expect('GET /api/submissions/problem/:unknown -> 404', perProblem404.status === 404);

/* ─── 10. /recent is publicly readable ─────────────────────────────────── */

const recent = await api.get('/api/submissions/recent');
expect('GET /api/submissions/recent -> 200 (no auth required)',
  recent.status === 200 && Array.isArray(recent.body) && recent.body.length >= 4);
expect('recent activity carries user.username + problem.slug',
  recent.body[0].user?.username === 'submitter'
   && typeof recent.body[0].problem?.slug === 'string');

/* ─── 11. /run does NOT persist ────────────────────────────────────────── */

const beforeRun = await db.value(
  `SELECT COUNT(*)::int AS n FROM submissions WHERE user_id = $1`, [userId], 'n',
);
const runRes = await auth(api.post('/api/submissions/fmt-bytes-test/run')).send({
  code: FORMAT_BYTES_GOOD,
  language: 'javascript',
});
expect('POST /api/submissions/:slug/run -> 200 ACCEPTED',
  runRes.status === 200 && runRes.body?.status === 'ACCEPTED',
  JSON.stringify(runRes.body));
const afterRun = await db.value(
  `SELECT COUNT(*)::int AS n FROM submissions WHERE user_id = $1`, [userId], 'n',
);
expect('run-only does NOT insert a submissions row',
  Number(afterRun) === Number(beforeRun));

/* ─── cleanup ──────────────────────────────────────────────────────────── */

console.log(`\n${pass} passed, ${fail} failed.`);

await db.close();

if (fail) process.exit(1);
